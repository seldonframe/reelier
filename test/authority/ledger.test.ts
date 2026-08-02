import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync,writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir, rename, symlink, unlink } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile,spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import { authenticateOutcomeRequest, authenticatedOutcomeRequestState } from "../../src/authority/keys.js";
import {
  CAPABILITY_LIFETIME_MS,
  type LedgerState,
  type ReservationIntent,
  type ReservationSnapshot,
  type TransitionEvent,
} from "../../src/authority/ledger.js";
import {
  FsAuthorityLedger as RawFsAuthorityLedger,
  dispatchFaultPoints,
  ledgerFaultPoints,
  reservationFaultPoints,
  resultFaultPoints,
  ingressFaultPoints,
  clockFaultPoints,
} from "../../src/authority/host/fs-ledger.js";

class FsAuthorityLedger extends RawFsAuthorityLedger {
  override async reserve(candidate: ReservationIntent) {
    try {
      const wire=JSON.parse(Buffer.from(candidate.canonicalRequestBytes).toString("utf8"));
      const authenticated=authenticateOutcomeRequest({tenant:candidate.tenant,requester:candidate.requester,definitionAlias:candidate.definitionAlias,request:wire});
      const binding=await this.bindIngress(authenticated);
      if("ingressClaimDigest" in binding)return super.reserve({...candidate,ingressClaimDigest:binding.ingressClaimDigest});
    } catch { /* malformed inputs remain direct integrity tests */ }
    return super.reserve(candidate);
  }
}

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
  const limits = overrides.limits ?? { maxEffectsPerWindow: 2, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 };
  const scalar = {
    tenant: "tenant_1",
    requester: "requester_1",
    definitionAlias: "definition_1",
    requestId: "request_1",
    requestKey: deriveRequestKey(overrides),
    ingressClaimDigest: digest("9"),
    decisionContextDigest: digest("7"),
    contractDigest: digest("a"), sourceBundleDigest: digest("b"), sourceSnapshotDigest: digest("c"), authorityStateDigest: digest("d"), limits,
    limitsDigest: "",
    capabilityId: "capability_1",
    outcomeKey: digest("3"),
    effectDigest: digest("4"),
    issuedAt: new Date(t0).toISOString(),
    expiresAt: new Date(t0 + CAPABILITY_LIFETIME_MS).toISOString(),
    limitSlots: [
      { kind: "contract-window" as const, key: digest("5"), maximum: limits.maxEffectsPerWindow },
      { kind: "source-trigger" as const, key: digest("6"), maximum: limits.maxEffectsPerSourceTrigger },
    ],
    ...overrides,
  };
  const canonicalRequestBytes = overrides.canonicalRequestBytes === undefined
    ? requestWireBytes(scalar.requestId)
    : Buffer.from(overrides.canonicalRequestBytes);
  const requestDigest = `sha256:${createHash("sha256").update(canonicalRequestBytes).digest("hex")}`;
  scalar.limitsDigest = authorityDigest({ v: "reelier.capability-limits/internal-v1", contractDigest: scalar.contractDigest, limits: scalar.limits });
  const capabilityBytes = overrides.capabilityBytes === undefined
    ? capabilityWireBytes({ ...scalar, requestDigest } as Parameters<typeof capabilityWireBytes>[0])
    : Buffer.from(overrides.capabilityBytes);
  return {
    ...scalar,
    canonicalRequestBytes,
    capabilityBytes,
    requestDigest, canonicalRequestDigest: requestDigest,
    capabilityDigest: `sha256:${createHash("sha256").update(capabilityBytes).digest("hex")}`,
  };
}

function deriveRequestKey(overrides:Partial<ReservationIntent>):string{return authenticatedOutcomeRequestState(authenticateOutcomeRequest({tenant:overrides.tenant??"tenant_1",requester:overrides.requester??"requester_1",definitionAlias:overrides.definitionAlias??"definition_1",request:{v:"reelier.outcome-request/v1",requestId:overrides.requestId??"request_1",sourceRefs:{source:"ref_1"},choices:{}}})).requestKey;}

function requestWireBytes(requestId: string, sourceRef = "ref_1"): Buffer {
  return authorityCanonicalBytes({ v: "reelier.outcome-request/v1", requestId, sourceRefs: { source: sourceRef }, choices: {} });
}

function capabilityWireBytes(value: Omit<ReservationIntent, "canonicalRequestBytes" | "capabilityBytes" | "canonicalRequestDigest" | "limitSlots">): Buffer {
  return authorityCanonicalBytes({ v: "reelier.compiled-capability/v1", tenant:value.tenant,requester:value.requester,definitionAlias:value.definitionAlias,requestDigest:value.requestDigest,requestKey:value.requestKey,contractDigest:value.contractDigest,sourceBundleDigest:value.sourceBundleDigest,sourceSnapshotDigest:value.sourceSnapshotDigest,authorityStateDigest:value.authorityStateDigest,limits:value.limits,limitsDigest:value.limitsDigest,capabilityId:value.capabilityId,outcomeKey:value.outcomeKey,effectDigest:value.effectDigest,issuedAt:value.issuedAt,expiresAt:value.expiresAt });
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
    import { authenticateOutcomeRequest } from ${JSON.stringify(new URL("../../src/authority/keys.js", pathToFileURL(path.join(process.cwd(), "dist-test/test/authority/ledger.test.js"))).href)};
    const value = JSON.parse(Buffer.from(process.argv[1], "base64").toString("utf8"));
    value.canonicalRequestBytes = Buffer.from(value.canonicalRequestBytes, "base64");
    value.capabilityBytes = Buffer.from(value.capabilityBytes, "base64");
    const ledger = new FsAuthorityLedger(process.argv[2], { now: () => ${t0} });
    const authenticated=authenticateOutcomeRequest({tenant:value.tenant,requester:value.requester,definitionAlias:value.definitionAlias,request:JSON.parse(Buffer.from(value.canonicalRequestBytes).toString("utf8"))});
    const binding=await ledger.bindIngress(authenticated);if(!binding.ok){process.stdout.write(JSON.stringify(binding));process.exit(0);}value.ingressClaimDigest=binding.ingressClaimDigest;
    const result = await ledger.reserve(value);
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
    assert.deepEqual({ ok: requestConflict.ok, reason: requestConflict.reason }, { ok: false, reason: "conflict" });

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
      limits: { maxEffectsPerWindow: 1, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 },
      limitSlots: [{ kind: "contract-window", key: digest("f"), maximum: 1 }, { kind: "source-trigger", key: digest("e"), maximum: 1 }],
    })))) as Array<{ ok: boolean; reason?: string }>;
    assert.equal(limited.filter(result => result.ok).length, 1);
    assert.deepEqual(limited.find(result => !result.ok)?.reason, "limit-exceeded");
  });
});

test("the global ingress key treats a different authenticated definition alias as conflict", async () => {
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    assert.equal((await ledger.reserve(intent({ definitionAlias: "definition_1" }))).ok, true);
    const recovered = new FsAuthorityLedger(root, { now: () => t0 });
    const retry = await recovered.reserve(intent({ definitionAlias: "definition_1" }));
    assert.equal(retry.ok && retry.status, "existing");
    const conflictRequest=authenticateOutcomeRequest({tenant:"tenant_1",requester:"requester_1",definitionAlias:"definition_2",request:{v:"reelier.outcome-request/v1",requestId:"request_1",sourceRefs:{source:"ref_1"},choices:{}}});
    const conflict = await recovered.bindIngress(conflictRequest);
    assert.equal(conflict.ok,false);if(!conflict.ok)assert.equal(conflict.reason,"conflict");
  });
});

test("a caller cannot widen an already committed fixed-window maximum", async () => {
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const shared = digest("f");
    assert.equal((await ledger.reserve(intent({ limits: { maxEffectsPerWindow: 1, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 }, limitSlots: [{ kind: "contract-window", key: shared, maximum: 1 }, { kind: "source-trigger", key: digest("6"), maximum: 1 }] }))).ok, true);
    const widened = await ledger.reserve(intent({
      requestId: "request_widen",
      outcomeKey: digest("e"), capabilityId: "capability_widen",
      limits: { maxEffectsPerWindow: 100, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 },
      limitSlots: [{ kind: "contract-window", key: shared, maximum: 100 }, { kind: "source-trigger", key: digest("7"), maximum: 1 }],
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

test("recovery refuses every new sealed scalar and canonical capability disagreement", async () => {
  const scalarMutations = ["definitionAlias", "contractDigest", "sourceBundleDigest", "sourceSnapshotDigest", "authorityStateDigest", "limitsDigest"] as const;
  for (const field of scalarMutations) await withRoot(async root => {
    assert.equal((await new FsAuthorityLedger(root, { now: () => t0 }).reserve(intent())).ok, true);
    await rewriteJournal(root, event => {
      if (event.type !== "reserve") return event;
      const reservation = event.reservation as ReservationSnapshot;
      const stored = { ...reservation.intent, [field]: field === "definitionAlias" ? "different_definition" : digest("9") };
      return { ...event, reservation: { ...reservation, intent: stored } };
    });
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" }, field);
  });
  await withRoot(async root => {
    assert.equal((await new FsAuthorityLedger(root, { now: () => t0 }).reserve(intent())).ok, true);
    await rewriteJournal(root, event => {
      if (event.type !== "reserve") return event;
      const reservation = event.reservation as ReservationSnapshot;
      const capability = JSON.parse(Buffer.from(reservation.intent.capabilityBase64, "base64").toString("utf8"));
      capability.sourceSnapshotDigest = digest("9");
      return { ...event, reservation: { ...reservation, intent: { ...reservation.intent, capabilityBase64: authorityCanonicalBytes(capability).toString("base64") } } };
    });
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
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
    { target: "acknowledged", resultDigest: digest("0") },
    { target: "reconciled", resultDigest: undefined },
    { target: "reconciled", resultDigest: digest("0") },
  ] as const;
  for (const value of cases) await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal((await ledger.transition(created.reservation.reservationId, "reserved", { to: "dispatched" })).ok, true);
    if (value.target === "reconciled") {
      assert.equal((await ledger.transition(created.reservation.reservationId, "dispatched", { to: "acknowledged", resultDigest: digest("a") })).ok, true);
      assert.equal((await ledger.transition(created.reservation.reservationId, "acknowledged", { to: "reconciled", resultDigest: digest("b") })).ok, true);
    } else if (value.target !== "dispatched") {
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
    ["definitionAlias", value => ({ ...value, definitionAlias: "detached_definition" })],
    ["requestDigest", value => ({ ...value, requestDigest: digest("8") })],
    ["requestId", value => ({ ...value, requestId: "detached_request" })],
    ["requestKey", value => ({ ...value, requestKey: digest("8") })],
    ["capabilityId", value => ({ ...value, capabilityId: "detached_capability" })],
    ["contractDigest", value => ({ ...value, contractDigest: digest("8") })],
    ["sourceBundleDigest", value => ({ ...value, sourceBundleDigest: digest("8") })],
    ["sourceSnapshotDigest", value => ({ ...value, sourceSnapshotDigest: digest("8") })],
    ["authorityStateDigest", value => ({ ...value, authorityStateDigest: digest("8") })],
    ["decisionContextDigest", value => ({ ...value, decisionContextDigest: "sha256:" + "0".repeat(64) })],
    ["limits", value => ({ ...value, limits: { ...value.limits!, maxBodyBytes: value.limits!.maxBodyBytes + 1 } })],
    ["limitsDigest", value => ({ ...value, limitsDigest: digest("8") })],
    ["outcomeKey", value => ({ ...value, outcomeKey: digest("8") })],
    ["effectDigest", value => ({ ...value, effectDigest: digest("8") })],
    ["issuedAt", value => ({ ...value, issuedAt: new Date(t0 + 1).toISOString(), expiresAt: new Date(t0 + CAPABILITY_LIFETIME_MS + 1).toISOString() })],
    ["expiresAt", value => ({ ...value, issuedAt: new Date(t0 - 1).toISOString(), expiresAt: new Date(t0 + CAPABILITY_LIFETIME_MS - 1).toISOString() })],
  ];
  for (const [field, mutate] of mutations) await withRoot(async root => {
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).reserve(mutate(intent())), { ok: false, reason: "integrity-failure" }, field);
  });
  for (const [label, limitSlots] of [
    ["missing source-trigger", [{ kind: "contract-window", key: digest("5"), maximum: 2 }]],
    ["wrong order", [{ kind: "source-trigger", key: digest("6"), maximum: 1 }, { kind: "contract-window", key: digest("5"), maximum: 2 }]],
    ["widened maximum", [{ kind: "contract-window", key: digest("5"), maximum: 3 }, { kind: "source-trigger", key: digest("6"), maximum: 1 }]],
  ] as const) await withRoot(async root => {
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).reserve(intent({ limitSlots })), { ok: false, reason: "integrity-failure" }, label);
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
    const slots = [{ kind: "contract-window" as const, key: digest("5"), maximum: 2 }, { kind: "source-trigger" as const, key: digest("6"), maximum: 1 }];
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
  const classified = [...reservationFaultPoints, ...dispatchFaultPoints, ...resultFaultPoints, ...ingressFaultPoints, ...clockFaultPoints];
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

test("pre-release v1 transaction records fail closed without inferred migration", async () => {
  await withRoot(async root => {
    assert.equal((await new FsAuthorityLedger(root, { now: () => t0 }).recover()).ok, true);
    const bytes = authorityCanonicalBytes({ v: "reelier.authority-ledger-transaction/v1", intent: {} });
    const name = createHash("sha256").update(bytes).digest("hex");
    await writeFile(path.join(root, "transactions", name), bytes);
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
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

test("ledger lock acquisition remains bounded when the ambient wall clock rolls backward",{timeout:10_000},async()=>{
  await withRoot(async root=>{
    const lock=path.join(root,"lock");await mkdir(lock);await writeFile(path.join(lock,"owner.json"),JSON.stringify({host:hostname(),nonce:"d".repeat(64),pid:process.pid,v:1}));
    const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href,run=promisify(execFile);
    const source='const {FsAuthorityLedger}=await import(process.argv[1]);let wall=1000;Date.now=()=>--wall;const result=await new FsAuthorityLedger(process.argv[2],{now:()=>1768478430000,lockTimeoutMs:1}).recover();process.stdout.write(JSON.stringify(result));';
    const output=await run(process.execPath,["--input-type=module","-e",source,moduleUrl,root],{timeout:2_000});assert.deepEqual(JSON.parse(output.stdout),{ok:false,reason:"busy"});
  });
});

test("volatile decisions-subtree audit retries never consult the ambient wall clock",async()=>{
  await withRoot(async root=>{
    await mkdir(path.join(root,"decisions"));const original=Date.now;let semanticClockCalls=0;Date.now=()=>{throw new Error("ambient wall clock consulted by retry deadline");};
    try{const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticClockCalls++;return t0;},lockTimeoutMs:20}).recover();assert.equal(result.ok,true);assert.equal(semanticClockCalls,0,"recovery/audit has no legitimate semantic-time read");}
    finally{Date.now=original;}
  });
});

const ledgerLockDurabilityPoints=["after-owner-file-sync","after-lock-directory-sync","before-lock-retire","after-lock-retire"] as const;

test("ledger lock publication and whole-lock retirement expose the exact durability fault order",async()=>{
  await withRoot(async root=>{const observed:string[]=[];assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0,faultInjector:(point:string)=>{if((ledgerLockDurabilityPoints as readonly string[]).includes(point))observed.push(point);}} as never).recover()).ok,true);assert.deepEqual(observed,ledgerLockDurabilityPoints);});
});

test("interrupted ledger owner publication never leaves an ownerless active lock",async()=>{
  for(const point of ["after-owner-file-sync","after-lock-directory-sync"] as const)await withRoot(async root=>{let fired=false;const ledger=new RawFsAuthorityLedger(root,{now:()=>t0,faultInjector:(observed:string)=>{if(!fired&&observed===point){fired=true;throw new Error(`fault:${point}`);}}} as never);await assert.rejects(()=>ledger.recover(),new RegExp(`fault:${point}`));assert.equal(fired,true,point);assert.equal(existsSync(path.join(root,"lock")),false,point);});
});

test("publication cleanup never deletes a replacement ledger lock owner",async()=>{
  await withRoot(async root=>{const ownerPath=path.join(root,"lock","owner.json"),replacement=authorityCanonicalBytes({host:"replacement-host",nonce:"e".repeat(64),pid:process.pid,v:1});let fired=false;const ledger=new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(!fired&&point==="after-owner-file-sync"){fired=true;writeFileSync(ownerPath,replacement);throw new Error("fault:replacement-owner");}}} as never);await assert.rejects(()=>ledger.recover(),/fault:replacement-owner/);assert.equal(fired,true);assert.deepEqual(await readFile(ownerPath),replacement,"cleanup must preserve a lock it no longer owns");assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"lock-owner-unverifiable"});assert.deepEqual(await readFile(ownerPath),replacement);});
});

test("failure before ledger lock retirement preserves the complete canonical active owner",async()=>{
  await withRoot(async root=>{let fired=false;const ledger=new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(!fired&&point==="before-lock-retire"){fired=true;throw new Error("fault:before-lock-retire");}}} as never);assert.equal((await ledger.recover()).ok,true);assert.equal(fired,true);const ownerBytes=await readFile(path.join(root,"lock","owner.json")),owner=JSON.parse(ownerBytes.toString("utf8"));assert.deepEqual(Object.keys(owner).sort(),["host","nonce","pid","v"]);assert.deepEqual(ownerBytes,authorityCanonicalBytes(owner));assert.equal(owner.host,hostname());assert.equal(owner.pid,process.pid);assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"busy"});});
});

test("a crash after whole-lock retirement leaves a validated non-blocking tombstone for bounded cleanup",{timeout:30_000},async()=>{
  await withRoot(async root=>{const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href,childSource=`import {FsAuthorityLedger} from ${JSON.stringify(moduleUrl)};const ledger=new FsAuthorityLedger(process.argv[1],{now:()=>${t0},faultInjector(point){if(point==="after-lock-retire")process.exit(92);}});await ledger.recover();`;let childPid:number|undefined;const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",childSource,root],{stdio:"ignore"});childPid=child.pid;child.on("error",reject);child.on("close",resolve);});assert.equal(code,92);assert.ok(Number.isSafeInteger(childPid));assert.equal(existsSync(path.join(root,"lock")),false,"atomic retirement never exposes an ownerless active lock");const retired=(await readdir(root)).filter(name=>/^\.authority-ledger-lock-\d+-[0-9a-f]{64}\.retired$/.test(name));assert.equal(retired.length,1);const ownerBytes=await readFile(path.join(root,retired[0],"owner.json")),owner=JSON.parse(ownerBytes.toString("utf8"));assert.deepEqual(Object.keys(owner).sort(),["host","nonce","pid","v"]);assert.equal(owner.v,1);assert.equal(owner.host,hostname());assert.equal(owner.pid,childPid);assert.match(owner.nonce,/^[0-9a-f]{64}$/);assert.deepEqual(ownerBytes,authorityCanonicalBytes(owner));const match=/^\.authority-ledger-lock-(\d+)-([0-9a-f]{64})\.retired$/.exec(retired[0]);assert.ok(match);assert.equal(Number(match[1]),owner.pid);assert.equal(match[2],owner.nonce);assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200}).recover()).ok,true);assert.equal(existsSync(path.join(root,retired[0])),false,"validated retired tombstone is cleaned before acquisition");});
});

test("ledger root audit refuses arbitrary and malformed lock-retirement tombstones",async()=>{
  for(const name of [".authority-ledger-lock-arbitrary.retired",`.authority-ledger-lock-999-${"a".repeat(64)}.retired`])await withRoot(async root=>{await mkdir(path.join(root,name));if(name.includes("-999-"))await writeFile(path.join(root,name,"owner.json"),"{");assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"},name);assert.equal(existsSync(path.join(root,name)),true,"unvalidated topology is never silently removed");});
});

test("canonical retired owner bytes that mismatch the tombstone name remain and fail closed",async()=>{
  await withRoot(async root=>{const name=`.authority-ledger-lock-999-${"a".repeat(64)}.retired`,directory=path.join(root,name),ownerBytes=authorityCanonicalBytes({host:hostname(),nonce:"b".repeat(64),pid:process.pid,v:1});await mkdir(directory);await writeFile(path.join(directory,"owner.json"),ownerBytes);assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.deepEqual(await readFile(path.join(directory,"owner.json")),ownerBytes);});
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

test("bindIngress atomically elects one exact owner and aliases or bytes cannot reuse its tuple", async () => {
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const exact = authenticateOutcomeRequest({ tenant: "tenant_1", requester: "requester_1", definitionAlias: "definition_1", request: { v: "reelier.outcome-request/v1", requestId: "request_1", sourceRefs: { source: "ref_1" }, choices: {} } });
    const results = await Promise.all(Array.from({ length: 100 }, () => ledger.bindIngress(exact)));
    assert.equal(results.filter(result => result.ok && result.status === "claimed").length, 1);
    assert.equal(results.filter(result => result.ok && result.status === "exact-existing").length, 99);
    const owner = results.find(result => result.ok && result.status === "claimed");assert.ok(owner?.ok);if(!owner?.ok)return;const ownerDigest=owner.ingressClaimDigest;
    assert.ok(results.every(result => "ingressClaimDigest" in result && result.ingressClaimDigest === ownerDigest));
    const aliasConflict = authenticateOutcomeRequest({ tenant: "tenant_1", requester: "requester_1", definitionAlias: "definition_2", request: { v: "reelier.outcome-request/v1", requestId: "request_1", sourceRefs: { source: "ref_1" }, choices: {} } });
    const bodyConflict = authenticateOutcomeRequest({ tenant: "tenant_1", requester: "requester_1", definitionAlias: "definition_1", request: { v: "reelier.outcome-request/v1", requestId: "request_1", sourceRefs: { source: "other" }, choices: {} } });
    assert.deepEqual(await ledger.bindIngress(aliasConflict), { ok: false, reason: "conflict", evaluationEligible: false, ingressClaimDigest: ownerDigest });
    assert.deepEqual(await ledger.bindIngress(bodyConflict), { ok: false, reason: "conflict", evaluationEligible: false, ingressClaimDigest: ownerDigest });
    assert.deepEqual(await ledger.lookupIngress(authenticatedOutcomeRequestState(exact).requestKey), { requestId: "request_1", requestKey: authenticatedOutcomeRequestState(exact).requestKey, definitionAlias: "definition_1", ingressClaimDigest: ownerDigest, bindingStatus: "bound" });
    assert.deepEqual(await readdir(path.join(root,"ingress")),[`${authenticatedOutcomeRequestState(exact).requestKey.slice(7)}.json`]);
    assert.deepEqual(await readdir(path.join(root, "transactions")).catch(() => []), []);
    assert.deepEqual(await readdir(path.join(root, "journal")).catch(() => []), []);
  });
});

test("observeClock durably advances, is idempotent at equality, and refuses rollback or invalid clocks", async () => {
  await withRoot(async root => {
    let now = t0;
    const ledger = new FsAuthorityLedger(root, { now: () => now });
    assert.deepEqual(await ledger.observeClock(), { ok: true, status: "advanced", observedAt: new Date(t0).toISOString() });
    assert.deepEqual(await ledger.observeClock(), { ok: true, status: "equal", observedAt: new Date(t0).toISOString() });
    now--;
    assert.deepEqual(await ledger.observeClock(), { ok: false, reason: "clock-rollback" });
    const restarted=await new FsAuthorityLedger(root,{now:()=>t0}).observeClock();assert.equal(restarted.ok,true);if(restarted.ok)assert.equal(restarted.status,"equal");
  });
  await withRoot(async root => assert.deepEqual(await new FsAuthorityLedger(root, { now: () => Number.NaN }).observeClock(), { ok: false, reason: "clock-unavailable" }));
  await withRoot(async root => assert.deepEqual(await new FsAuthorityLedger(root, { now: () => Number.MAX_SAFE_INTEGER }).observeClock(), { ok: false, reason: "clock-unavailable" }));
  await withRoot(async root => assert.deepEqual(await new FsAuthorityLedger(root, { now: () => { throw new Error("clock"); } }).observeClock(), { ok: false, reason: "clock-unavailable" }));
});

test("reserve requires the exact live ingress claim before writing any transaction", async () => {
  await withRoot(async root => {
    const authenticated = authenticateOutcomeRequest({ tenant: "tenant_1", requester: "requester_1", definitionAlias: "definition_1", request: { v: "reelier.outcome-request/v1", requestId: "request_1", sourceRefs: { source: "ref_1" }, choices: {} } });
    const state = authenticatedOutcomeRequestState(authenticated);
    const candidate = intent({ requestKey: state.requestKey, requestDigest: state.requestDigest, canonicalRequestBytes: Buffer.from(state.canonicalRequestBase64, "base64") });
    assert.deepEqual(await new RawFsAuthorityLedger(root, { now: () => t0 }).reserve({ ...candidate, ingressClaimDigest: digest("9") }), { ok: false, reason: "integrity-failure" });
    assert.deepEqual(await readdir(path.join(root, "transactions")).catch(() => []), []);
    const bound = await new FsAuthorityLedger(root, { now: () => t0 }).bindIngress(authenticated);
    assert.equal(bound.ok, true); if (!bound.ok) return;
    assert.equal((await new FsAuthorityLedger(root, { now: () => t0 }).reserve({ ...candidate, ingressClaimDigest: bound.ingressClaimDigest })).ok, true);
  });
});

test("new ingress and clock fault-point sets are complete and disjoint", () => {
  assert.deepEqual(ingressFaultPoints, ["ingress-before-create","ingress-after-create","ingress-before-write","ingress-after-write","ingress-before-file-sync","ingress-after-file-sync","ingress-before-close","ingress-after-close","ingress-before-directory-sync","ingress-after-directory-sync"]);
  assert.deepEqual(clockFaultPoints, ["clock-before-clock-high-water-write","clock-after-clock-high-water-write","clock-before-create","clock-after-create","clock-before-write","clock-after-write","clock-before-file-sync","clock-after-file-sync","clock-before-close","clock-after-close","clock-before-directory-sync","clock-after-directory-sync"]);
  const all=[...reservationFaultPoints,...dispatchFaultPoints,...resultFaultPoints,...ingressFaultPoints,...clockFaultPoints];
  assert.equal(new Set(all).size,all.length);
  assert.deepEqual([...all].sort(),[...ledgerFaultPoints].sort());
});

test("every ingress and standalone-clock crash boundary recovers only prior, committed, or corruption",{timeout:120_000},async()=>{
  const authenticated=authenticateOutcomeRequest({tenant:"tenant_1",requester:"requester_1",definitionAlias:"definition_1",request:{v:"reelier.outcome-request/v1",requestId:"request_1",sourceRefs:{source:"ref_1"},choices:{}}});
  for(const point of ingressFaultPoints)await withRoot(async root=>{let fired=false;const crashing=new RawFsAuthorityLedger(root,{now:()=>t0,faultInjector(observed){if(!fired&&observed===point){fired=true;throw new Error(`fault:${point}`);}}});try{await crashing.bindIngress(authenticated);}catch(error){assert.match(String(error),/fault:/);}assert.equal(fired,true,point);const recovered=await new RawFsAuthorityLedger(root,{now:()=>t0}).recover();if(!recovered.ok)assert.equal(recovered.reason,"corruption");else{const lookup=await new RawFsAuthorityLedger(root,{now:()=>t0}).lookupIngress(authenticatedOutcomeRequestState(authenticated).requestKey);assert.ok(lookup===undefined||lookup.bindingStatus==="bound");}});
  for(const point of clockFaultPoints)await withRoot(async root=>{assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0}).observeClock()).ok,true);let fired=false;const crashing=new RawFsAuthorityLedger(root,{now:()=>t0+1,faultInjector(observed){if(!fired&&observed===point){fired=true;throw new Error(`fault:${point}`);}}});try{await crashing.observeClock();}catch(error){assert.match(String(error),/fault:/);}assert.equal(fired,true,point);const recovered=await new RawFsAuthorityLedger(root,{now:()=>t0+1}).recover();if(!recovered.ok)assert.equal(recovered.reason,"corruption");else assert.ok([new Date(t0).toISOString(),new Date(t0+1).toISOString()].includes(recovered.highWaterMark!));});
});

test("ingress filename, bytes, digest linkage, and pre-v4 transactions fail closed on recovery",async()=>{
  await withRoot(async root=>{const authenticated=authenticateOutcomeRequest({tenant:"tenant_1",requester:"requester_1",definitionAlias:"definition_1",request:{v:"reelier.outcome-request/v1",requestId:"request_1",sourceRefs:{source:"ref_1"},choices:{}}});const state=authenticatedOutcomeRequestState(authenticated);assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0}).bindIngress(authenticated)).ok,true);await writeFile(path.join(root,"ingress",`${state.requestKey.slice(7)}.json`),"{");assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0}).recover(),{ok:false,reason:"corruption"});});
  await withRoot(async root=>{const ledger=new FsAuthorityLedger(root,{now:()=>t0});const created=await ledger.reserve(intent());assert.equal(created.ok,true);const ingress=await readdir(path.join(root,"ingress"));await unlink(path.join(root,"ingress",ingress[0]));assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0}).recover(),{ok:false,reason:"corruption"});});
  for(const version of ["v1","v2","v3"])await withRoot(async root=>{assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0}).recover()).ok,true);const bytes=authorityCanonicalBytes({v:`reelier.authority-ledger-transaction/${version}`,intent:{}});const name=createHash("sha256").update(bytes).digest("hex");await writeFile(path.join(root,"transactions",name),bytes);assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0}).recover(),{ok:false,reason:"corruption"});});
});

test("bindIngress refuses evaluation eligibility when any existing ingress record is corrupt",async()=>{
  await withRoot(async root=>{const first=authenticateOutcomeRequest({tenant:"tenant_1",requester:"requester_1",definitionAlias:"definition_1",request:{v:"reelier.outcome-request/v1",requestId:"request_1",sourceRefs:{source:"ref_1"},choices:{}}});const second=authenticateOutcomeRequest({tenant:"tenant_1",requester:"requester_1",definitionAlias:"definition_1",request:{v:"reelier.outcome-request/v1",requestId:"request_2",sourceRefs:{source:"ref_2"},choices:{}}});const ledger=new RawFsAuthorityLedger(root,{now:()=>t0});assert.equal((await ledger.bindIngress(first)).ok,true);await writeFile(path.join(root,"ingress",`${authenticatedOutcomeRequestState(first).requestKey.slice(7)}.json`),"{");assert.deepEqual(await ledger.bindIngress(second),{ok:false,reason:"corruption"});});
});

test("reservation linkage lookup returns only the verified ingress/capability/context edges needed by gate decision verification",async()=>{
  await withRoot(async root=>{
    const ledger=new FsAuthorityLedger(root,{now:()=>t0});
    const reserved=await ledger.reserve(intent());
    assert.equal(reserved.ok,true);if(!reserved.ok)return;
    const linkage=await ledger.lookupReservationLinkage(reserved.reservation.reservationId);
    assert.deepEqual(linkage,{
      reservationId:reserved.reservation.reservationId,
      ingressClaimDigest:reserved.reservation.intent.ingressClaimDigest,
      capabilityId:reserved.reservation.intent.capabilityId,
      capabilityDigest:reserved.reservation.intent.capabilityDigest,
      authorityStateDigest:reserved.reservation.intent.authorityStateDigest,
      decisionContextDigest:reserved.reservation.intent.decisionContextDigest,
      state:"reserved",
      updatedAt:new Date(t0).toISOString(),
    });
    assert.equal(Object.isFrozen(linkage),true);
    assert.equal("capabilityBase64" in linkage,false);
    assert.equal("canonicalRequestBase64" in linkage,false);
  });
});
