// test/attest-declared-probe.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSkill } from "../src/runner.js";
import { parseSkill } from "../src/skill.js";
import { computeApprovalHash } from "../src/approval.js";
import type { Tool } from "../src/tools.js";
import type { Observation } from "../src/assert.js";

/** Stamp a CURRENT approve: hash (attest bound in) — since fix-wave F2 the
 * declared probe only dispatches for a step executed via a matching approve:
 * hash, so these probe-mechanics tests run on the approved path. */
function withApprove(src: string): string {
  const s = parseSkill(src).steps[0];
  const hash = computeApprovalHash({ emit: undefined, actionTool: s.actionTool, actionArgs: s.actionArgs, attest: s.attest, expect: s.expect });
  return `${src}- approve: ${hash}\n`;
}

function obsOf(body: unknown): Observation {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}

const SKILL = (attest: string) => `---
name: probe-t
description: d
---
## Steps

### Step 1 — update thing
- intent: update
- action: fake.update {"id":"x1","value":"new"}
- assert: status == 200
${attest}
- effect: idempotent-write
`;

const ATTEST = `- attest: {"tool":"fake.read","args":{"id":"x1"},"projection":["etag","value"]}`;

function world(initial: { etag: string; value: string }) {
  // a tiny mutable resource: read returns current state; update mutates it
  const state = { ...initial };
  const calls: string[] = [];
  const tools: Record<string, Tool> = {
    "fake.read": { effect: "read", run: async () => { calls.push("read"); return obsOf({ etag: state.etag, value: state.value }); } },
    "fake.update": { effect: "idempotent-write", run: async () => { calls.push("update"); state.etag = "e2"; state.value = "new"; return obsOf({ id: "x1", etag: state.etag }); } },
  };
  return { tools, calls, state };
}

test("declared-probe: pre+post captured, exact confidence, honest delta", async () => {
  const w = world({ etag: "e1", value: "old" });
  const rec = await runSkill(parseSkill(withApprove(SKILL(ATTEST))), { tools: w.tools, allowWrites: true, dryRun: true });
  const a = rec.steps[0].attest!;
  assert.equal(a.method, "declared-probe");
  assert.equal(a.confidence, "exact");
  assert.ok(a.pre && a.post && a.pre.hash !== a.post.hash);
  assert.deepEqual(a.delta, { changed: 2, fields: ["body.etag", "body.value"] });
  assert.deepEqual(w.calls, ["read", "update", "read"]); // pre-probe BEFORE dispatch, post after
  assert.equal(a.selector, "fake.read");
  // raw values never recorded:
  const flat = JSON.stringify(a);
  for (const raw of ["e1", "e2", "old", "new"]) assert.ok(!flat.includes(`"${raw}"`), `leaked ${raw}`);
});

test("selector records the tool name only — the args template never appears in the record", async () => {
  const w = world({ etag: "e1", value: "old" });
  const rec = await runSkill(parseSkill(withApprove(SKILL(ATTEST))), { tools: w.tools, allowWrites: true, dryRun: true });
  const a = rec.steps[0].attest!;
  assert.equal(a.selector, "fake.read");
  const flat = JSON.stringify(rec);
  // the probe's declared args template (e.g. {"id":"x1"}) must never leak into the record,
  // even though it's perfectly fine to appear in the skill source itself.
  assert.ok(!flat.includes(`{"id":"x1"}`), "args template leaked into serialized record");
  assert.ok(!flat.includes("fake.read {"), "old selector-with-args format leaked into serialized record");
});

test("no-change write yields exact with delta.changed 0 and no fields", async () => {
  const w = world({ etag: "e2", value: "new" }); // update is a no-op state-wise except etag... make it truly no-op:
  w.tools["fake.update"] = { effect: "idempotent-write", run: async () => obsOf({ id: "x1" }) };
  const rec = await runSkill(parseSkill(withApprove(SKILL(ATTEST))), { tools: w.tools, allowWrites: true, dryRun: true });
  assert.deepEqual(rec.steps[0].attest!.delta, { changed: 0 });
});

test("probe timeout degrades to absent + reason, write still executes", async () => {
  const w = world({ etag: "e1", value: "old" });
  w.tools["fake.read"] = { effect: "read", run: () => new Promise(() => {}) }; // hangs forever
  const rec = await runSkill(parseSkill(withApprove(SKILL(ATTEST))), { tools: w.tools, allowWrites: true, dryRun: true, probeTimeoutMs: 50 });
  const a = rec.steps[0].attest!;
  assert.equal(a.confidence, "absent");
  assert.match(a.reason!, /probe/);
  assert.ok(w.calls.includes("update"), "the write must have dispatched despite probe failure");
  assert.equal(rec.steps[0].outcome, "passed");
});

test("unknown probe tool / non-read probe tool degrade with reasons, never fail the step", async () => {
  const w1 = world({ etag: "e1", value: "old" });
  const rec1 = await runSkill(parseSkill(withApprove(SKILL(`- attest: {"tool":"nope.read","args":{}}`))), { tools: w1.tools, allowWrites: true, dryRun: true });
  assert.equal(rec1.steps[0].attest!.confidence, "absent");
  assert.match(rec1.steps[0].attest!.reason!, /probe-tool-unknown/);
  assert.equal(rec1.steps[0].outcome, "passed");

  const w2 = world({ etag: "e1", value: "old" });
  const rec2 = await runSkill(parseSkill(withApprove(SKILL(`- attest: {"tool":"fake.update","args":{}}`))), { tools: w2.tools, allowWrites: true, dryRun: true });
  assert.match(rec2.steps[0].attest!.reason!, /probe-not-read/);
});

test("one-sided capture (post-probe fails) is partial, pre kept", async () => {
  const w = world({ etag: "e1", value: "old" });
  let reads = 0;
  w.tools["fake.read"] = { effect: "read", run: async () => { reads++; if (reads > 1) throw new Error("boom"); return obsOf({ etag: "e1", value: "old" }); } };
  const rec = await runSkill(parseSkill(withApprove(SKILL(ATTEST))), { tools: w.tools, allowWrites: true, dryRun: true });
  const a = rec.steps[0].attest!;
  assert.equal(a.confidence, "partial");
  assert.ok(a.pre && !a.post && !a.delta);
  assert.match(a.reason!, /probe-failed/);
});

test("attest on a read step is ignored: no probe calls, no attest", async () => {
  const w = world({ etag: "e1", value: "old" });
  const readSkill = SKILL(ATTEST).replace("- effect: idempotent-write", "- effect: read").replace('fake.update {"id":"x1","value":"new"}', 'fake.read {"id":"x1"}');
  const rec = await runSkill(parseSkill(readSkill), { tools: w.tools, dryRun: true });
  assert.equal(rec.steps[0].attest, undefined);
  assert.equal(w.calls.filter((c) => c === "read").length, 1); // only the action itself
});

test("declared-probe: explicit projection over a boolean field round-trips into the hash", async () => {
  const state = { active: true };
  const calls: string[] = [];
  const tools: Record<string, Tool> = {
    "fake.read": { effect: "read", run: async () => { calls.push("read"); return obsOf({ active: state.active }); } },
    "fake.update": { effect: "idempotent-write", run: async () => { calls.push("update"); state.active = false; return obsOf({ id: "x1" }); } },
  };
  const attest = `- attest: {"tool":"fake.read","args":{"id":"x1"},"projection":["active"]}`;
  const rec = await runSkill(parseSkill(withApprove(SKILL(attest))), { tools, allowWrites: true, dryRun: true });
  const a = rec.steps[0].attest!;
  assert.equal(a.confidence, "exact");
  assert.ok(a.pre!.hash !== a.post!.hash, "changed boolean must change the hash");
  assert.deepEqual(a.delta, { changed: 1, fields: ["body.active"] });
});
