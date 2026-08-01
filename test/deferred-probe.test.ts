// The deferred probe (docs/specs/artifact-attestation-v1.md §8). Most sends DO
// produce a post-state, just late: a provider message-id, an event API, a
// bounce webhook. This binds the expectation at dispatch and resolves it when
// the provider's record appears.
//
// never-list #1 governs this file: `pending` is a state, not a result, and it
// must never read as a pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseSkill, SkillParseError } from "../src/skill.js";
import { runSkill } from "../src/runner.js";
import { computeApprovalHash } from "../src/approval.js";
import { buildResolutionRecord, pendingAttestations, resolveDeferred, selectUnresolved } from "../src/defer.js";
import type { Tool } from "../src/tools.js";

function skill(attestJson: string, approve?: string): string {
  return `---
name: deferred-fixture
description: a send whose post-state arrives late
---

### Step 1 — send a message
- intent: send it
- action: send_email {"to": "ops@example.com", "subject": "hi", "body": "b"}
- assert: status == 200
- effect: idempotent-write
- attest: ${attestJson}
${approve !== undefined ? `- approve: ${approve}\n` : ""}`;
}

const DEFERRED = `{"tool":"get_message","args":{"id":"m1"},"projection":["delivered"],"defer":"24h"}`;
const SYNC = `{"tool":"get_message","args":{"id":"m1"},"projection":["delivered"]}`;

function stamped(src: string): string {
  const s = parseSkill(src).steps[0];
  return computeApprovalHash({
    actionTool: s.actionTool, actionArgs: s.actionArgs, attest: s.attest, expect: s.expect, emit: s.emit,
  });
}

function tools() {
  const probeCalls: unknown[] = [];
  const reg: Record<string, Tool> = {
    send_email: { effect: "idempotent-write", run: async () => ({ status: 200, headers: {}, body: "{}" }) },
    get_message: {
      effect: "read",
      run: async (args) => {
        probeCalls.push(args);
        return { status: 200, headers: {}, body: JSON.stringify({ delivered: true }) };
      },
    },
  };
  return { reg, probeCalls };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-defer-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------
// Grammar
// ---------------------------------------------------------------------------

test("attest.defer parses a duration", () => {
  assert.equal(parseSkill(skill(DEFERRED)).steps[0].attest!.defer, "24h");
});

test("a sync attest leaves defer absent — never defaulted", () => {
  assert.equal(parseSkill(skill(SYNC)).steps[0].attest!.defer, undefined);
});

test("a malformed defer duration is rejected loudly, never silently treated as sync", () => {
  for (const bad of ['"0h"', '"1.5h"', '"90s"', '"soon"', '"24"', '400', '"400d"']) {
    assert.throws(
      () => parseSkill(skill(`{"tool":"get_message","args":{},"projection":["x"],"defer":${bad}}`)),
      SkillParseError,
      `expected rejection for defer=${bad}`
    );
  }
});

test("a deferred probe still requires a projection — there is nothing to resolve otherwise", () => {
  assert.throws(
    () => parseSkill(skill(`{"tool":"get_message","args":{},"defer":"24h"}`)),
    /projection/
  );
});

// ---------------------------------------------------------------------------
// Approval-hash compat
// ---------------------------------------------------------------------------

test("a defer-less attest hashes byte-identically to 0.29.0 (pinned literal)", () => {
  const s = parseSkill(skill(SYNC)).steps[0];
  assert.equal(
    computeApprovalHash({ actionTool: s.actionTool, actionArgs: s.actionArgs, attest: s.attest, expect: undefined, emit: undefined }),
    "sha256:2eb58a49ab4d44bba85dd8af32475c47b9f6475cf4af66843f2fcea4de8ba06a"
  );
});

test("adding defer changes the approval hash — a deadline nobody approved is not a deadline", () => {
  assert.notEqual(stamped(skill(SYNC)), stamped(skill(DEFERRED)));
});

// ---------------------------------------------------------------------------
// Runtime: pending at dispatch
// ---------------------------------------------------------------------------

test("a deferred probe records confidence 'pending' and does NOT dispatch the probe", async () => {
  await withTempDir(async (dir) => {
    const src = skill(DEFERRED, stamped(skill(DEFERRED)));
    const { reg, probeCalls } = tools();
    const record = await runSkill(parseSkill(src), { tools: reg, vars: {}, cwd: dir });
    const attest = record.steps[0].attest!;
    assert.equal(attest.confidence, "pending");
    assert.equal(attest.method, "declared-probe", "the enum is unchanged — no third method value");
    assert.equal(attest.selector, "get_message");
    assert.equal(probeCalls.length, 0, "the provider record does not exist yet — probing now proves nothing");
  });
});

test("a pending attest carries NO pre and NO post — a side that can never be compared is not evidence", async () => {
  // §8.2: the attest salt is per-run and unrecorded, so a `pre` captured now
  // could never be compared against a `post` captured by a later process.
  await withTempDir(async (dir) => {
    const src = skill(DEFERRED, stamped(skill(DEFERRED)));
    const record = await runSkill(parseSkill(src), { tools: tools().reg, vars: {}, cwd: dir });
    const attest = record.steps[0].attest!;
    assert.equal(attest.pre, undefined);
    assert.equal(attest.post, undefined);
    assert.equal(attest.delta, undefined);
  });
});

test("the deadline is stamped as an absolute instant resolved against dispatch", async () => {
  await withTempDir(async (dir) => {
    const src = skill(DEFERRED, stamped(skill(DEFERRED)));
    const before = Date.now();
    const record = await runSkill(parseSkill(src), { tools: tools().reg, vars: {}, cwd: dir });
    const until = Date.parse(record.steps[0].attest!.deferredUntil!);
    assert.ok(until >= before + 24 * 3600_000 - 5000 && until <= Date.now() + 24 * 3600_000 + 5000);
  });
});

test("pending never flips the step outcome — the recorder records, it does not block", async () => {
  await withTempDir(async (dir) => {
    const src = skill(DEFERRED, stamped(skill(DEFERRED)));
    const record = await runSkill(parseSkill(src), { tools: tools().reg, vars: {}, cwd: dir });
    assert.equal(record.steps[0].outcome, "passed");
    assert.equal(record.passed, true);
  });
});

test("a sync attest is completely unaffected — byte-identical behaviour", async () => {
  await withTempDir(async (dir) => {
    const src = skill(SYNC, stamped(skill(SYNC)));
    const { reg, probeCalls } = tools();
    const record = await runSkill(parseSkill(src), { tools: reg, vars: {}, cwd: dir });
    assert.equal(record.steps[0].attest!.confidence, "exact");
    assert.equal(probeCalls.length, 2, "sync probes still run pre and post");
    assert.equal(record.steps[0].attest!.deferredUntil, undefined);
  });
});

// ---------------------------------------------------------------------------
// Resolution (§8.2): a SECOND record, never an amendment
// ---------------------------------------------------------------------------

const PENDING = {
  step: 1,
  selector: "get_message",
  deferredUntil: "2026-08-02T09:00:00.000Z",
  approvalHash: "sha256:" + "a".repeat(64),
};

const T_BEFORE = Date.parse("2026-08-02T08:00:00.000Z");
const T_AFTER = Date.parse("2026-08-02T10:00:00.000Z");

test("pendingAttestations finds the deferred steps and the join keys they resolve back through", () => {
  const record = {
    steps: [
      { n: 1, attest: { method: "declared-probe", selector: "get_message", confidence: "pending", deferredUntil: PENDING.deferredUntil }, write: { approvalHash: PENDING.approvalHash } },
      { n: 2, attest: { method: "declared-probe", selector: "x", confidence: "exact" } },
      { n: 3 },
    ],
  } as never;
  const found = pendingAttestations(record);
  assert.equal(found.length, 1);
  assert.equal(found[0].step, 1);
  assert.equal(found[0].selector, "get_message");
  assert.equal(found[0].approvalHash, PENDING.approvalHash);
});

test("a probe that resolves the declared fields yields 'partial' — never 'exact'", () => {
  // §8.2 [Normative]: a resolution proves post-state AT RESOLUTION TIME, not a
  // delta across the write. Grading it `exact` would flatten the two.
  const out = resolveDeferred(PENDING, { ok: true, projected: { "body.delivered": "true" } }, T_BEFORE);
  assert.equal(out.confidence, "partial");
  assert.ok(out.post, "the resolution carries its own observation");
  assert.equal(out.pre, undefined, "there is no comparable pre side, and none is fabricated");
  assert.match(out.reason!, /resolution time/i);
});

test("a deadline that elapsed with nothing resolved becomes 'absent', never a pass and never pending forever", () => {
  const out = resolveDeferred(PENDING, { ok: false, reason: "probe-failed: 404" }, T_AFTER);
  assert.equal(out.confidence, "absent");
  assert.match(out.reason!, /deferred-deadline-elapsed/);
});

test("an elapsed deadline claims only that Reelier stopped waiting — never that the send failed", () => {
  const out = resolveDeferred(PENDING, undefined, T_AFTER);
  assert.equal(out.confidence, "absent");
  assert.doesNotMatch(out.reason!, /fail(ed)? to send|not delivered|send failed/i);
});

test("a probe that fails BEFORE the deadline stays pending — the provider may still be catching up", () => {
  const out = resolveDeferred(PENDING, { ok: false, reason: "probe-failed: 404" }, T_BEFORE);
  assert.equal(out.confidence, "pending");
});

test("a probe resolving no declared fields after the deadline is absent, not partial", () => {
  const out = resolveDeferred(PENDING, { ok: true, projected: {} }, T_AFTER);
  assert.equal(out.confidence, "absent");
});

// ---------------------------------------------------------------------------
// The resolution RECORD (§8.2): a second record, joined, never an amendment
// ---------------------------------------------------------------------------

test("a resolution record carries the resolved attest and the join keys, and asserts nothing", () => {
  const attest = resolveDeferred(PENDING, { ok: true, projected: { "body.delivered": "true" } }, T_BEFORE);
  const rec = buildResolutionRecord("deferred-fixture", [{ pending: PENDING, attest }], T_BEFORE, T_BEFORE + 12)!;

  assert.equal(rec.skill, "deferred-fixture");
  assert.equal(rec.steps.length, 1);
  const step = rec.steps[0];
  assert.equal(step.n, PENDING.step, "keeps the original step number it resolves");
  assert.equal(step.attest!.confidence, "partial");
  // The join back to the authorization and the emission — §8.2's whole point.
  assert.equal(step.write, undefined, "a resolution writes nothing");
  assert.match(step.title, /resolution/i);
  // A resolution makes no assertion; its claim IS the attest block. `unchecked`
  // is the honest-success state for "ran, zero assertions" (SPEC §4.3).
  assert.equal(step.outcome, "unchecked");
  assert.equal(step.failures.length, 0);
});

test("a resolution record is never marked as a mock run — push must not refuse the batch", () => {
  // `reelier push` refuses an entire batch carrying mockFailures. A resolution
  // record reusing that field would wedge the operator's push.
  const attest = resolveDeferred(PENDING, undefined, T_AFTER);
  const rec = buildResolutionRecord("s", [{ pending: PENDING, attest }], T_AFTER, T_AFTER)!;
  assert.equal(rec.mockFailures, undefined);
});

test("an all-elapsed resolution record still totals honestly and never claims a failure", () => {
  const attest = resolveDeferred(PENDING, undefined, T_AFTER);
  const rec = buildResolutionRecord("s", [{ pending: PENDING, attest }], T_AFTER, T_AFTER + 3)!;
  assert.equal(rec.steps[0].attest!.confidence, "absent");
  assert.equal(rec.totals.steps, 1);
  assert.equal(rec.totals.unchecked, 1);
  assert.equal(rec.totals.failed, 0, "the deadline elapsing is not a step failure");
});

test("resolving nothing produces no record at all", () => {
  assert.equal(buildResolutionRecord("s", [], T_AFTER, T_AFTER), undefined);
});

// ---------------------------------------------------------------------------
// Idempotence across ledger scans (§8.2's immutability, taken seriously)
// ---------------------------------------------------------------------------

test("every resolution outcome names WHICH deadline it resolved", () => {
  // The original record is immutable and says `pending` forever, so the only
  // way a later scan can tell resolved from unresolved is for the resolution
  // to carry the deadline it answered. Present on every arm, not just pending.
  for (const probe of [
    { ok: true as const, projected: { "body.delivered": "true" } },
    { ok: false as const, reason: "probe-failed: 404" },
  ]) {
    for (const now of [T_BEFORE, T_AFTER]) {
      assert.equal(resolveDeferred(PENDING, probe, now).deferredUntil, PENDING.deferredUntil);
    }
  }
});

function ledger(...steps: unknown[][]): never[] {
  return steps.map((s) => ({ steps: s })) as never;
}

const pendingStep = (n: number, until: string) => ({
  n, attest: { method: "declared-probe", selector: "get_message", confidence: "pending", deferredUntil: until },
});
const resolutionStep = (n: number, until: string, confidence: string) => ({
  n, attest: { method: "declared-probe", selector: "get_message", confidence, deferredUntil: until },
});

test("selectUnresolved skips a deadline a later record already resolved", () => {
  const recs = ledger(
    [pendingStep(1, "2026-08-02T09:00:00.000Z")],
    [resolutionStep(1, "2026-08-02T09:00:00.000Z", "partial")]
  );
  assert.deepEqual(selectUnresolved(recs), []);
});

test("selectUnresolved skips one resolved as absent too — a closed deadline is closed", () => {
  const recs = ledger(
    [pendingStep(1, "2026-08-02T09:00:00.000Z")],
    [resolutionStep(1, "2026-08-02T09:00:00.000Z", "absent")]
  );
  assert.deepEqual(selectUnresolved(recs), []);
});

test("selectUnresolved keeps a still-unresolved deadline, and distinguishes runs of the SAME step", () => {
  // Two dispatches of step 1 on different days are two different emissions,
  // and resolving one must never mark the other resolved.
  const recs = ledger(
    [pendingStep(1, "2026-08-02T09:00:00.000Z")],
    [pendingStep(1, "2026-08-03T09:00:00.000Z")],
    [resolutionStep(1, "2026-08-02T09:00:00.000Z", "partial")]
  );
  const left = selectUnresolved(recs);
  assert.equal(left.length, 1);
  assert.equal(left[0].deferredUntil, "2026-08-03T09:00:00.000Z");
});

test("a sync attest is never mistaken for a resolution — it carries no deadline", () => {
  const recs = ledger(
    [pendingStep(1, "2026-08-02T09:00:00.000Z")],
    [{ n: 1, attest: { method: "declared-probe", selector: "x", confidence: "exact" } }]
  );
  assert.equal(selectUnresolved(recs).length, 1);
});
