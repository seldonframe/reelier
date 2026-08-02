import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir, rename, symlink, unlink } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { authorityCanonicalBytes } from "../../src/authority/wire.js";
import {
  CAPABILITY_LIFETIME_MS,
  type LedgerState,
  type ReservationIntent,
  type ReservationSnapshot,
  type TransitionEvent,
} from "../../src/authority/ledger.js";
import {
  FsAuthorityLedger,
  dispatchFaultPoints,
  ledgerFaultPoints,
  reservationFaultPoints,
  resultFaultPoints,
} from "../../src/authority/host/fs-ledger.js";

const t0 = Date.parse("2026-08-02T12:00:00.000Z");
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const kernelTimedTransition: TransitionEvent = { to: "dispatched" };
const callerTimedTransition: TransitionEvent = {
  to: "dispatched",
  // @ts-expect-error lifecycle time is kernel-owned, never caller-authored
  at: new Date(t0).toISOString(),
};
void kernelTimedTransition;
void callerTimedTransition;

function intent(overrides: Partial<ReservationIntent> = {}): ReservationIntent {
  const scalar = {
    tenant: "tenant_1",
    requester: "requester_1",
    requestId: "request_1",
    requestKey: digest("7"),
    capabilityId: "capability_1",
    outcomeKey: digest("3"),
    effectDigest: digest("4"),
    issuedAt: new Date(t0).toISOString(),
    expiresAt: new Date(t0 + CAPABILITY_LIFETIME_MS).toISOString(),
    limitSlots: [
      { key: digest("5"), maximum: 2 },
      { key: digest("6"), maximum: 1 },
    ],
    ...overrides,
  };
  const canonicalRequestBytes = overrides.canonicalRequestBytes === undefined
    ? requestWireBytes(scalar.requestId)
    : Buffer.from(overrides.canonicalRequestBytes);
  const capabilityBytes = overrides.capabilityBytes === undefined
    ? capabilityWireBytes(scalar)
    : Buffer.from(overrides.capabilityBytes);
  return {
    ...scalar,
    canonicalRequestBytes,
    capabilityBytes,
    canonicalRequestDigest: `sha256:${createHash("sha256").update(canonicalRequestBytes).digest("hex")}`,
    capabilityDigest: `sha256:${createHash("sha256").update(capabilityBytes).digest("hex")}`,
  };
}

function requestWireBytes(requestId: string, sourceRef = "ref_1"): Buffer {
  return authorityCanonicalBytes({ v: "reelier.outcome-request/v1", requestId, sourceRefs: { source: sourceRef }, choices: {} });
}

function capabilityWireBytes(value: Pick<ReservationIntent, "capabilityId" | "requestKey" | "outcomeKey" | "effectDigest" | "issuedAt" | "expiresAt">): Buffer {
  return authorityCanonicalBytes({ v: "reelier.compiled-capability/v1", capabilityId: value.capabilityId, requestKey: value.requestKey, outcomeKey: value.outcomeKey, effectDigest: value.effectDigest, issuedAt: value.issuedAt, expiresAt: value.expiresAt });
}

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "reelier-authority-ledger-"));
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await tempRoot();
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

async function spawnReserve(root: string, candidate: ReservationIntent): Promise<unknown> {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "dist-test/src/authority/host/fs-ledger.js")).href;
  const encoded = Buffer.from(JSON.stringify({
    ...candidate,
    canonicalRequestBytes: Buffer.from(candidate.canonicalRequestBytes).toString("base64"),
    capabilityBytes: Buffer.from(candidate.capabilityBytes).toString("base64"),
  })).toString("base64");
  const source = `
    import { FsAuthorityLedger } from ${JSON.stringify(moduleUrl)};
    const value = JSON.parse(Buffer.from(process.argv[1], "base64").toString("utf8"));
    value.canonicalRequestBytes = Buffer.from(value.canonicalRequestBytes, "base64");
    value.capabilityBytes = Buffer.from(value.capabilityBytes, "base64");
    const result = await new FsAuthorityLedger(process.argv[2], { now: () => ${t0} }).reserve(value);
    process.stdout.write(JSON.stringify(result));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source, encoded, root], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(`child ${code}: ${stderr}`)));
  });
}

async function rewriteJournal(root: string, mutate: (event: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const journal = path.join(root, "journal");
  const names = (await readdir(journal)).sort();
  const events = await Promise.all(names.map(async name => JSON.parse(await readFile(path.join(journal, name), "utf8")) as Record<string, unknown>));
  for (const name of names) await unlink(path.join(journal, name));
  let previousDigest: string | null = null;
  for (const original of events) {
    const event = mutate({ ...original, previousDigest });
    const bytes = authorityCanonicalBytes(event);
    const eventDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const name = `${String(event.sequence).padStart(16, "0")}-${eventDigest.slice(7)}`;
    await writeFile(path.join(journal, name), bytes);
    previousDigest = eventDigest;
  }
}

test("100 real processes converge on one committed reservation and one dispatch eligibility", { timeout: 120_000 }, async () => {
  await withRoot(async root => {
    const results = await Promise.all(Array.from({ length: 100 }, () => spawnReserve(root, intent())));
    const successes = results as Array<{ ok: boolean; status: string; dispatchEligible: boolean; reservation: { reservationId: string } }>;
    assert.equal(successes.every(result => result.ok), true, JSON.stringify(successes.filter(result => !result.ok)));
    assert.equal(new Set(successes.map(result => result.reservation.reservationId)).size, 1);
    assert.equal(successes.filter(result => result.dispatchEligible).length, 1);
    const recovered = await new FsAuthorityLedger(root, { now: () => t0 }).recover();
    assert.equal(recovered.ok, true);
    if (recovered.ok) assert.equal(recovered.reservations.length, 1);
  });
});

test("cross-process collisions use ingress, semantic, capability, then limit precedence", { timeout: 60_000 }, async () => {
  await withRoot(async root => {
    const first = intent();
    const identical = await Promise.all([spawnReserve(root, first), spawnReserve(root, first)]) as Array<{ ok: boolean; reservation: { reservationId: string } }>;
    assert.equal(identical[0].reservation.reservationId, identical[1].reservation.reservationId);

    const requestConflict = await spawnReserve(root, intent({
      canonicalRequestBytes: requestWireBytes("request_1", "different_ref"),
      outcomeKey: digest("8"),
      capabilityId: "capability_2",
    })) as { ok: boolean; reason: string };
    assert.deepEqual({ ok: requestConflict.ok, reason: requestConflict.reason }, { ok: false, reason: "idempotency-conflict" });

    const semantic = await spawnReserve(root, intent({
      requestId: "request_2",
      capabilityId: "capability_3",
    })) as { ok: boolean; reason: string };
    assert.deepEqual({ ok: semantic.ok, reason: semantic.reason }, { ok: false, reason: "semantic-duplicate" });

    const capability = await spawnReserve(root, intent({
      requestId: "request_3",
      outcomeKey: digest("d"),
    })) as { ok: boolean; reason: string };
    assert.deepEqual({ ok: capability.ok, reason: capability.reason }, { ok: false, reason: "capability-integrity" });

    const limited = await Promise.all(["4", "5"].map((suffix, index) => spawnReserve(root, intent({
      requestId: `request_${suffix}`,
      outcomeKey: digest(index ? "8" : "7"), capabilityId: `capability_${suffix}`,
      limitSlots: [{ key: digest("f"), maximum: 1 }],
    })))) as Array<{ ok: boolean; reason?: string }>;
    assert.equal(limited.filter(result => result.ok).length, 1);
    assert.deepEqual(limited.find(result => !result.ok)?.reason, "limit-exceeded");
  });
});

test("the global ingress key treats a different authenticated definition alias as conflict", async () => {
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    assert.equal((await ledger.reserve(intent({ definitionAlias: "definition_1" }))).ok, true);
    const conflict = await ledger.reserve(intent({ definitionAlias: "definition_2", capabilityId: "capability_2", outcomeKey: digest("8") }));
    assert.deepEqual(conflict, { ok: false, reason: "idempotency-conflict" });
  });
});

test("a caller cannot widen an already committed fixed-window maximum", async () => {
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const shared = digest("f");
    assert.equal((await ledger.reserve(intent({ limitSlots: [{ key: shared, maximum: 1 }] }))).ok, true);
    const widened = await ledger.reserve(intent({
      requestId: "request_widen",
      outcomeKey: digest("e"), capabilityId: "capability_widen",
      limitSlots: [{ key: shared, maximum: 100 }],
    }));
    assert.deepEqual(widened, { ok: false, reason: "limit-exceeded" });
  });
});

test("recovery binds every committed limit assignment one-to-one to its signed intent slot", async () => {
  const mutations: Array<[string, (assignments: Array<{ key: string; index: number; maximum: number }>) => Array<{ key: string; index: number; maximum: number }>]> = [
    ["different key", assignments => [{ ...assignments[0], key: digest("9") }, assignments[1]]],
    ["larger maximum", assignments => [{ ...assignments[0], maximum: assignments[0].maximum + 1 }, assignments[1]]],
    ["smaller maximum", assignments => [{ ...assignments[0], maximum: assignments[0].maximum - 1, index: 0 }, assignments[1]]],
    ["duplicate and missing key", assignments => [assignments[0], { ...assignments[1], key: assignments[0].key, maximum: assignments[0].maximum }]],
    ["missing assignment", assignments => assignments.slice(0, 1)],
    ["extra assignment", assignments => [...assignments, { key: digest("9"), index: 0, maximum: 1 }]],
    ["negative index", assignments => [{ ...assignments[0], index: -1 }, assignments[1]]],
    ["index equal to maximum", assignments => [{ ...assignments[0], index: assignments[0].maximum }, assignments[1]]],
    ["noncanonical assignment order", assignments => [...assignments].reverse()],
  ];
  for (const [name, mutate] of mutations) await withRoot(async root => {
    assert.equal((await new FsAuthorityLedger(root, { now: () => t0 }).reserve(intent())).ok, true);
    await rewriteJournal(root, event => {
      if (event.type !== "reserve") return event;
      const reservation = event.reservation as ReservationSnapshot;
      return { ...event, reservation: { ...reservation, limitAssignments: mutate(reservation.limitAssignments.map(value => ({ ...value }))) } };
    });
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" }, name);
  });
});

test("transition timestamps are stamped from the single durable kernel observation", async () => {
  await withRoot(async root => {
    let now = t0;
    let transitionClockReads = 0;
    const ledger = new FsAuthorityLedger(root, { now: () => {
      if (now === t0) return now;
      transitionClockReads++;
      return now;
    } });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    now = t0 + 10;
    const transitioned = await ledger.transition(created.reservation.reservationId, "reserved", { to: "dispatched" });
    assert.equal(transitioned.ok, true);
    if (!transitioned.ok) return;
    assert.equal(transitionClockReads, 1);
    assert.equal(transitioned.reservation.updatedAt, new Date(t0 + 10).toISOString());
    assert.equal((await ledger.getHighWaterMark()).observedAt, transitioned.reservation.updatedAt);
  });
});

test("reservation time is stamped from the single durable kernel observation", async () => {
  await withRoot(async root => {
    let reads = 0;
    const ledger = new FsAuthorityLedger(root, { now: () => t0 + reads++ });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(reads, 1);
    assert.equal(created.reservation.updatedAt, new Date(t0).toISOString());
    assert.equal((await ledger.getHighWaterMark()).observedAt, created.reservation.updatedAt);
  });
});

test("recovery refuses a recomputed reservation timestamp that differs from durable high-water time", async () => {
  await withRoot(async root => {
    assert.equal((await new FsAuthorityLedger(root, { now: () => t0 }).reserve(intent())).ok, true);
    await rewriteJournal(root, event => {
      if (event.type !== "reserve") return event;
      const reservation = event.reservation as ReservationSnapshot;
      return { ...event, reservation: { ...reservation, updatedAt: new Date(t0 + 1).toISOString() } };
    });
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
  });
});

test("recovery refuses recomputed transition timestamps that differ from durable high-water time", async () => {
  for (const offset of [-1, 1]) await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal((await ledger.transition(created.reservation.reservationId, "reserved", { to: "dispatched" })).ok, true);
    await rewriteJournal(root, event => event.type === "transition" ? { ...event, at: new Date(t0 + offset).toISOString() } : event);
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" }, String(offset));
  });
});

test("clock rollback recovery makes dispatched work ambiguous at the durable high-water instant", async () => {
  await withRoot(async root => {
    let now = t0;
    const ledger = new FsAuthorityLedger(root, { now: () => now });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    now = t0 + 10;
    assert.equal((await ledger.transition(created.reservation.reservationId, "reserved", { to: "dispatched" })).ok, true);
    const recovered = await new FsAuthorityLedger(root, { now: () => t0 - 1 }).recover();
    assert.equal(recovered.ok, true);
    if (!recovered.ok) return;
    assert.equal(recovered.reservations[0].state, "ambiguous");
    assert.equal(recovered.reservations[0].updatedAt, new Date(t0 + 10).toISOString());
    assert.equal(recovered.highWaterMark, new Date(t0 + 10).toISOString());
  });
});

test("result digest presence is enforced by target state before journal mutation", async () => {
  const cases = [
    { target: "dispatched", digest: digest("a"), valid: false },
    { target: "ambiguous", digest: digest("a"), valid: false },
    { target: "acknowledged", digest: undefined, valid: false },
    { target: "acknowledged", digest: digest("0"), valid: false },
    { target: "definitive-failure", digest: undefined, valid: false },
    { target: "definitive-failure", digest: digest("0"), valid: false },
    { target: "reconciled", digest: undefined, valid: false },
    { target: "reconciled", digest: digest("0"), valid: false },
  ] as const;
  for (const value of cases) await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    let expected: LedgerState = "reserved";
    if (value.target !== "dispatched") {
      assert.equal((await ledger.transition(created.reservation.reservationId, "reserved", { to: "dispatched" })).ok, true);
      expected = "dispatched";
      if (value.target === "reconciled") {
        assert.equal((await ledger.transition(created.reservation.reservationId, "dispatched", { to: "acknowledged", resultDigest: digest("a") })).ok, true);
        expected = "acknowledged";
      }
    }
    const before = await readdir(path.join(root, "journal"));
    const invalidEvent = {
      to: value.target,
      ...(value.digest === undefined ? {} : { resultDigest: value.digest }),
    } as unknown as TransitionEvent;
    const result = await ledger.transition(created.reservation.reservationId, expected, invalidEvent);
    assert.deepEqual(result, { ok: false, reason: "corruption" }, value.target);
    assert.deepEqual(await readdir(path.join(root, "journal")), before, `${value.target} mutated the journal`);
  });
});

test("replay refuses target-specific result digest violations after canonical journal rewriting", async () => {
  const cases = [
    { target: "dispatched", resultDigest: digest("a") },
    { target: "ambiguous", resultDigest: digest("a") },
    { target: "acknowledged", resultDigest: undefined },
    { target: "definitive-failure", resultDigest: undefined },
  ] as const;
  for (const value of cases) await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal((await ledger.transition(created.reservation.reservationId, "reserved", { to: "dispatched" })).ok, true);
    if (value.target !== "dispatched") {
      const validEvent: TransitionEvent = value.target === "ambiguous"
        ? { to: "ambiguous" }
        : { to: value.target, resultDigest: digest("a") };
      assert.equal((await ledger.transition(created.reservation.reservationId, "dispatched", validEvent)).ok, true);
    }
    await rewriteJournal(root, event => event.type === "transition" && event.to === value.target
      ? { ...event, ...(value.resultDigest === undefined ? { resultDigest: undefined } : { resultDigest: value.resultDigest }) }
      : event);
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" }, value.target);
  });
});

test("verified reservation history preserves distinct acknowledgement and reconciliation evidence immutably", async () => {
  await withRoot(async root => {
    let now = t0;
    const ledger = new FsAuthorityLedger(root, { now: () => now });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const id = created.reservation.reservationId;
    now += 1;
    assert.equal((await ledger.transition(id, "reserved", { to: "dispatched" })).ok, true);
    now += 1;
    assert.equal((await ledger.transition(id, "dispatched", { to: "acknowledged", resultDigest: digest("a") })).ok, true);
    now += 1;
    assert.equal((await ledger.transition(id, "acknowledged", { to: "reconciled", resultDigest: digest("b") })).ok, true);
    const historyLedger = ledger as unknown as { getReservationHistory(reservationId: string): Promise<{
      reservation: ReservationSnapshot;
      entries: ReadonlyArray<{ sequence: number; from: LedgerState; to: LedgerState; at: string; eventDigest: string; resultDigest?: string }>;
    } | undefined> };
    const history = await historyLedger.getReservationHistory(id);
    assert.ok(history);
    assert.deepEqual(history.entries.map(entry => ({ from: entry.from, to: entry.to, at: entry.at, resultDigest: entry.resultDigest })), [
      { from: "issued", to: "reserved", at: new Date(t0).toISOString(), resultDigest: undefined },
      { from: "reserved", to: "dispatched", at: new Date(t0 + 1).toISOString(), resultDigest: undefined },
      { from: "dispatched", to: "acknowledged", at: new Date(t0 + 2).toISOString(), resultDigest: digest("a") },
      { from: "acknowledged", to: "reconciled", at: new Date(t0 + 3).toISOString(), resultDigest: digest("b") },
    ]);
    assert.equal(history.entries.every(entry => /^sha256:[0-9a-f]{64}$/.test(entry.eventDigest)), true);
    assert.equal(Object.isFrozen(history), true);
    assert.equal(Object.isFrozen(history.entries), true);
    assert.equal(Object.isFrozen(history.entries[0]), true);
    assert.throws(() => { (history.entries[0] as { at: string }).at = "changed"; }, TypeError);
    assert.deepEqual(await historyLedger.getReservationHistory(id), history);
  });
});

test("identical ingress bytes with a different transaction digest reuse the committed reservation without dispatch eligibility", async () => {
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const first = await ledger.reserve(intent());
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const divergent = intent({
      capabilityId: "different_capability",
      outcomeKey: digest("e"),
      effectDigest: digest("f"),
    });
    const retry = await ledger.reserve(divergent);
    assert.equal(retry.ok, true);
    if (!retry.ok) return;
    assert.equal(retry.status, "existing");
    assert.equal(retry.dispatchEligible, false);
    assert.equal(retry.reservation.reservationId, first.reservation.reservationId);
    assert.deepEqual(await ledger.reserve(divergent), retry, "the redundant transaction resolution must be durable");
    const recovered = await ledger.recover();
    assert.equal(recovered.ok, true);
    if (recovered.ok) assert.equal(recovered.reservations.length, 1);
  });
});

test("reservation scalar identities must equal the closed canonical request and capability preimages", async () => {
  const mutations: Array<[string, (value: ReservationIntent) => ReservationIntent]> = [
    ["requestId", value => ({ ...value, requestId: "detached_request" })],
    ["requestKey", value => ({ ...value, requestKey: digest("8") })],
    ["capabilityId", value => ({ ...value, capabilityId: "detached_capability" })],
    ["outcomeKey", value => ({ ...value, outcomeKey: digest("8") })],
    ["effectDigest", value => ({ ...value, effectDigest: digest("8") })],
    ["issuedAt", value => ({ ...value, issuedAt: new Date(t0 + 1).toISOString(), expiresAt: new Date(t0 + CAPABILITY_LIFETIME_MS + 1).toISOString() })],
    ["expiresAt", value => ({ ...value, issuedAt: new Date(t0 - 1).toISOString(), expiresAt: new Date(t0 + CAPABILITY_LIFETIME_MS - 1).toISOString() })],
  ];
  for (const [field, mutate] of mutations) await withRoot(async root => {
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).reserve(mutate(intent())), { ok: false, reason: "integrity-failure" }, field);
  });
  await withRoot(async root => {
    const noncanonicalRequest = Buffer.from(JSON.stringify({ requestId: "request_1", v: "reelier.outcome-request/v1", sourceRefs: { source: "ref_1" }, choices: {} }));
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).reserve(intent({ canonicalRequestBytes: noncanonicalRequest })), { ok: false, reason: "integrity-failure" });
  });
  await withRoot(async root => {
    const extraCapability = authorityCanonicalBytes({ v: "reelier.compiled-capability/v1", capabilityId: "capability_1", requestKey: digest("7"), outcomeKey: digest("3"), effectDigest: digest("4"), issuedAt: new Date(t0).toISOString(), expiresAt: new Date(t0 + CAPABILITY_LIFETIME_MS).toISOString(), extra: true });
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).reserve(intent({ capabilityBytes: extraCapability })), { ok: false, reason: "integrity-failure" });
  });
});

test("lifetime boundaries and monotonic wall-clock high-water are exact", async () => {
  await withRoot(async root => {
    let now = t0 - 1;
    const ledger = new FsAuthorityLedger(root, { now: () => now });
    assert.deepEqual(await ledger.reserve(intent()), { ok: false, reason: "not-yet-valid" });
    now = t0;
    const reserved = await ledger.reserve(intent());
    assert.equal(reserved.ok, true);
    if (!reserved.ok) return;
    now = t0 + CAPABILITY_LIFETIME_MS;
    assert.deepEqual(await ledger.transition(reserved.reservation.reservationId, "reserved", { to: "dispatched" }), { ok: false, reason: "expired" });
    now = t0 - 1;
    assert.deepEqual(await ledger.reserve(intent({ requestId: "rollback" })), { ok: false, reason: "clock-rollback" });
    now = t0;
    assert.equal((await ledger.getHighWaterMark()).observedAt, new Date(t0).toISOString());
  });
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 + CAPABILITY_LIFETIME_MS });
    assert.deepEqual(await ledger.reserve(intent()), { ok: false, reason: "expired" });
  });
});

test("transition is durable compare-and-transition over the exact legal graph", async () => {
  await withRoot(async root => {
    let now = t0;
    const ledger = new FsAuthorityLedger(root, { now: () => now });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const id = created.reservation.reservationId;
    assert.equal((await ledger.transition(id, "reserved", { to: "dispatched" })).ok, true);
    assert.deepEqual(await ledger.transition(id, "reserved", { to: "dispatched" }), { ok: false, reason: "state-conflict" });
    assert.deepEqual(await ledger.transition(id, "dispatched", { to: "reconciled", resultDigest: digest("a") }), { ok: false, reason: "illegal-transition" });
    assert.equal((await ledger.transition(id, "dispatched", { to: "acknowledged", resultDigest: digest("a") })).ok, true);
    assert.equal((await ledger.transition(id, "acknowledged", { to: "reconciled", resultDigest: digest("b") })).ok, true);
    assert.deepEqual(await ledger.transition(id, "reconciled", { to: "ambiguous" }), { ok: false, reason: "illegal-transition" });
    assert.equal((await ledger.getReservation(id))?.state, "reconciled");
  });

  const terminalTargets = ["acknowledged", "definitive-failure", "ambiguous"] as const;
  for (const target of terminalTargets) await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await ledger.reserve(intent({ requestId: `for_${target}` }));
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const id = created.reservation.reservationId;
    assert.equal((await ledger.transition(id, "reserved", { to: "dispatched" })).ok, true);
    const event = target === "ambiguous" ? { to: target } : { to: target, resultDigest: digest("a") };
    assert.equal((await ledger.transition(id, "dispatched", event)).ok, true);
  });
});

test("recovery turns a durable dispatched reservation without a result into ambiguous", async () => {
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    await ledger.transition(created.reservation.reservationId, "reserved", { to: "dispatched" });
    const recovered = await new FsAuthorityLedger(root, { now: () => t0 }).recover();
    assert.equal(recovered.ok, true);
    if (recovered.ok) assert.equal(recovered.reservations[0].state, "ambiguous");
  });
});

test("caller-owned bytes and returned snapshots are detached and immutable", async () => {
  await withRoot(async root => {
    const requestBytes = requestWireBytes("request_1");
    const capabilityBytes = capabilityWireBytes(intent());
    const requestBase64 = requestBytes.toString("base64");
    const capabilityBase64 = capabilityBytes.toString("base64");
    const slots = [{ key: digest("5"), maximum: 2 }];
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await ledger.reserve(intent({ canonicalRequestBytes: requestBytes, capabilityBytes, limitSlots: slots }));
    assert.equal(created.ok, true);
    if (!created.ok) return;
    requestBytes.fill(0); capabilityBytes.fill(0); slots[0].maximum = 999;
    const reread = await ledger.getReservation(created.reservation.reservationId);
    assert.equal(reread?.intent.canonicalRequestBase64, requestBase64);
    assert.equal(reread?.intent.capabilityBase64, capabilityBase64);
    assert.equal(reread?.intent.limitSlots[0].maximum, 2);
    assert.equal(Object.isFrozen(reread), true);
    assert.equal(Object.isFrozen(reread?.intent.limitSlots), true);
  });
});

test("faults at every durable reservation and transition point recover to prior state or safe committed state", { timeout: 120_000 }, async () => {
  const classified = [...reservationFaultPoints, ...dispatchFaultPoints, ...resultFaultPoints];
  assert.equal(new Set(classified).size, classified.length, "each fault point belongs to exactly one operation");
  assert.deepEqual([...classified].sort(), [...ledgerFaultPoints].sort(), "new fault points require an explicit operation classification");

  for (const point of reservationFaultPoints) await withRoot(async root => {
    let fired = false;
    const crashing = new FsAuthorityLedger(root, { now: () => t0, faultInjector: (observed: string) => {
      if (!fired && observed === point) { fired = true; throw new Error(`fault:${point}`); }
    } });
    try { await crashing.reserve(intent()); } catch (error) { assert.match(String(error), /fault:/); }
    assert.equal(fired, true, point);
    const recovered = await new FsAuthorityLedger(root, { now: () => t0 }).recover();
    if (!recovered.ok) assert.equal(recovered.reason, "corruption");
    else {
      assert.ok(recovered.reservations.length <= 1);
      if (recovered.reservations[0]) assert.equal(recovered.reservations[0].state, "reserved");
    }
  });

  for (const point of dispatchFaultPoints) await withRoot(async root => {
    const setup = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await setup.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    let fired = false;
    const crashing = new FsAuthorityLedger(root, { now: () => t0, faultInjector: (observed: string) => {
      if (!fired && observed === point) { fired = true; throw new Error(`fault:${point}`); }
    } });
    try { await crashing.transition(created.reservation.reservationId, "reserved", { to: "dispatched" }); } catch (error) { assert.match(String(error), /fault:/); }
    assert.equal(fired, true, point);
    const recovered = await new FsAuthorityLedger(root, { now: () => t0 }).recover();
    if (recovered.ok) assert.ok(["reserved", "ambiguous"].includes(recovered.reservations[0].state));
    else assert.equal(recovered.reason, "corruption");
  });

  for (const point of resultFaultPoints) await withRoot(async root => {
    const setup = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await setup.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    await setup.transition(created.reservation.reservationId, "reserved", { to: "dispatched" });
    let fired = false;
    const crashing = new FsAuthorityLedger(root, { now: () => t0, faultInjector: (observed: string) => {
      if (!fired && observed === point) { fired = true; throw new Error(`fault:${point}`); }
    } });
    try { await crashing.transition(created.reservation.reservationId, "dispatched", { to: "acknowledged", resultDigest: digest("a") }); } catch (error) { assert.match(String(error), /fault:/); }
    assert.equal(fired, true, point);
    const recovered = await new FsAuthorityLedger(root, { now: () => t0 }).recover();
    if (recovered.ok) assert.ok(["ambiguous", "acknowledged"].includes(recovered.reservations[0].state));
    else assert.equal(recovered.reason, "corruption");
  });
});

test("corruption, truncation, journal gaps, digest mismatch, traversal, and symlinks refuse", async () => {
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    const journal = path.join(root, "journal");
    const [entry] = await readdir(journal);
    await writeFile(path.join(journal, entry), "{");
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
  });
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    assert.equal((await ledger.reserve(intent())).ok, true);
    const claims = path.join(root, "claims");
    const [claim] = await readdir(claims);
    await unlink(path.join(claims, claim));
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
  });
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    assert.equal((await ledger.reserve(intent())).ok, true);
    const claims = path.join(root, "claims");
    const [claim] = await readdir(claims);
    const original = await readFile(path.join(claims, claim), "utf8");
    const withExtra = original.replace(',"transactionDigest"', ',"extra":true,"transactionDigest"');
    await writeFile(path.join(claims, claim), withExtra);
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
  });
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    assert.equal((await ledger.reserve(intent())).ok, true);
    const journal = path.join(root, "journal");
    const [entry] = await readdir(journal);
    const [prefix] = entry.split("-");
    await rename(path.join(journal, entry), path.join(journal, `${prefix}-${"f".repeat(64)}`));
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
  });
  await withRoot(async root => {
    await mkdir(path.join(root, "journal"), { recursive: true });
    await writeFile(path.join(root, "journal", `0000000000000002-${"a".repeat(64)}`), "{}\n");
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
  });
  await withRoot(async root => {
    assert.throws(() => new FsAuthorityLedger(path.join(root, "..", "escape"), { now: () => t0 }), /root|exist|directory/i);
  });
  await withRoot(async root => {
    const outside = await tempRoot();
    try {
      await symlink(outside, path.join(root, "journal"), process.platform === "win32" ? "junction" : "dir");
      assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});

test("clean-root recovery is empty and topology makes directory-sync honesty explicit", async () => {
  await withRoot(async root => {
    const recovered = await new FsAuthorityLedger(root, { now: () => t0 }).recover();
    assert.equal(recovered.ok, true);
    if (recovered.ok) {
      assert.deepEqual(recovered.reservations, []);
      assert.equal(recovered.topology.directorySync, process.platform === "win32" ? "best-effort" : "verified");
    }
  });
});

test("the process lock is bounded, never lease-stolen, and refuses foreign or corrupt owners", { timeout: 30_000 }, async () => {
  await withRoot(async root => {
    const lock = path.join(root, "lock");
    await mkdir(lock);
    const liveOwner = JSON.stringify({ host: hostname(), nonce: "a".repeat(64), pid: process.pid, v: 1 });
    await writeFile(path.join(lock, "owner.json"), liveOwner);
    const started = Date.now();
    const result = await new FsAuthorityLedger(root, { now: () => t0, lockTimeoutMs: 75 }).recover();
    assert.deepEqual(result, { ok: false, reason: "busy" });
    assert.ok(Date.now() - started < 2_000, "lock acquisition must be bounded");
    assert.equal(await readFile(path.join(lock, "owner.json"), "utf8"), liveOwner);
  });
  await withRoot(async root => {
    await mkdir(path.join(root, "lock"));
    await writeFile(path.join(root, "lock", "owner.json"), "{");
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0, lockTimeoutMs: 20 }).recover(), { ok: false, reason: "corruption" });
  });
  await withRoot(async root => {
    await mkdir(path.join(root, "lock"));
    await writeFile(path.join(root, "lock", "owner.json"), JSON.stringify({ host: "another-host", nonce: "b".repeat(64), pid: 999999, v: 1 }));
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0, lockTimeoutMs: 20 }).recover(), { ok: false, reason: "lock-owner-unverifiable" });
  });
});

test("a proved-dead same-host lock is reclaimed and recovery runs before reservation", async () => {
  await withRoot(async root => {
    await mkdir(path.join(root, "lock"));
    await writeFile(path.join(root, "lock", "owner.json"), JSON.stringify({ host: hostname(), nonce: "c".repeat(64), pid: 2_147_483_647, v: 1 }));
    const ledger = new FsAuthorityLedger(root, { now: () => t0, lockTimeoutMs: 100 });
    const result = await ledger.reserve(intent());
    assert.equal(result.ok, true);
    const recovered = await ledger.recover();
    assert.equal(recovered.ok, true);
    if (recovered.ok) assert.equal(recovered.reservations.length, 1);
  });
});

test("a crash-held lock is reclaimed only after the child process is proved dead", { timeout: 30_000 }, async () => {
  await withRoot(async root => {
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "dist-test/src/authority/host/fs-ledger.js")).href;
    const childSource = `
      import { FsAuthorityLedger } from ${JSON.stringify(moduleUrl)};
      const ledger = new FsAuthorityLedger(process.argv[1], { now: () => ${t0}, faultInjector(point) {
        if (point === "after-lock-acquire") process.exit(91);
      }});
      await ledger.recover();
    `;
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", childSource, root], { stdio: "ignore" });
      child.on("error", reject);
      child.on("close", resolve);
    });
    assert.equal(code, 91);
    const result = await new FsAuthorityLedger(root, { now: () => t0, lockTimeoutMs: 200 }).recover();
    assert.equal(result.ok, true);
  });
});
