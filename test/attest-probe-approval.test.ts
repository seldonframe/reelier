// Fix-wave F2 (final-review S2): the declared probe's exfiltration mitigation
// is the approval-hash binding of `attest:` — which only exists when the step
// executed via a matching `approve:` hash. On the flag path
// (--allow-writes/--yes) no human ever reviewed the probe's args template, so
// the probe MUST NOT dispatch: attest degrades to response-derived with
// reason "probe-requires-approval", and the step still executes normally
// (fail-open preserved).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSkill } from "../src/runner.js";
import { parseSkill } from "../src/skill.js";
import { computeApprovalHash } from "../src/approval.js";
import type { Tool } from "../src/tools.js";
import type { Observation } from "../src/assert.js";

function obsOf(body: unknown): Observation {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}

const SKILL = `---
name: probe-approval-t
description: d
---
## Steps

### Step 1 — update thing
- intent: update
- action: fake.update {"id":"x1"}
- assert: status == 200
- attest: {"tool":"fake.read","args":{"id":"x1"},"projection":["etag"]}
- effect: idempotent-write
`;

/** Stamp a CURRENT approve: hash (attest bound in), exactly as cmdApprove would. */
function withApprove(src: string): string {
  const s = parseSkill(src).steps[0];
  const hash = computeApprovalHash({ emit: undefined, actionTool: s.actionTool, actionArgs: s.actionArgs, attest: s.attest, expect: s.expect });
  return `${src}- approve: ${hash}\n`;
}

function world(): { tools: Record<string, Tool>; probeCalls: () => number; writeCalls: () => number } {
  let probes = 0;
  let writes = 0;
  let etag = "e1";
  return {
    tools: {
      "fake.read": { effect: "read", run: async () => { probes++; return obsOf({ etag }); } },
      "fake.update": { effect: "idempotent-write", run: async () => { writes++; etag = "e2"; return obsOf({ id: "x1" }); } },
    },
    probeCalls: () => probes,
    writeCalls: () => writes,
  };
}

test("F2: declared probe fires on the APPROVED path (no flags) — pre+post, exact", async () => {
  const w = world();
  const rec = await runSkill(parseSkill(withApprove(SKILL)), { tools: w.tools, dryRun: true });
  assert.equal(rec.steps[0].outcome, "passed");
  assert.equal(w.writeCalls(), 1);
  assert.equal(w.probeCalls(), 2, "pre + post probe must both fire on the approved path");
  const a = rec.steps[0].attest!;
  assert.equal(a.method, "declared-probe");
  assert.equal(a.confidence, "exact");
});

test("F2: declared probe NEVER dispatches on the flag path — attest degrades to response-derived with probe-requires-approval", async () => {
  const w = world();
  const rec = await runSkill(parseSkill(SKILL), { tools: w.tools, allowWrites: true, dryRun: true });
  assert.equal(rec.steps[0].outcome, "passed", "the step still executes normally — fail-open preserved");
  assert.equal(w.writeCalls(), 1);
  assert.equal(w.probeCalls(), 0, "an unreviewed attest: declaration must never fire its probe");
  const a = rec.steps[0].attest!;
  assert.equal(a.method, "response-derived");
  assert.match(a.reason!, /probe-requires-approval/);
});

test("F2: flag-path degrade keeps the response-derived reason when nothing is derivable either", async () => {
  const w = world();
  w.tools["fake.update"] = { effect: "idempotent-write", run: async () => obsOf([1, 2]) }; // nothing derivable
  const rec = await runSkill(parseSkill(SKILL), { tools: w.tools, allowWrites: true, dryRun: true });
  const a = rec.steps[0].attest!;
  assert.equal(a.method, "response-derived");
  assert.equal(a.confidence, "absent");
  assert.match(a.reason!, /no-derivable-state/);
  assert.match(a.reason!, /probe-requires-approval/);
  assert.equal(w.probeCalls(), 0);
});

// Fix-wave F4: a write dispatch that THROWS after a successful pre-probe must
// not discard the captured pre evidence — the call went out (the side effect
// may have landed server-side) even though no observation came back.
test("F4: throwing write tool => failed step still carries a pre-only attest with reason dispatch-failed", async () => {
  const w = world();
  w.tools["fake.update"] = { effect: "idempotent-write", run: async () => { throw new Error("ETIMEDOUT"); } };
  const rec = await runSkill(parseSkill(withApprove(SKILL)), { tools: w.tools, dryRun: true });
  assert.equal(rec.steps[0].outcome, "failed");
  assert.match(rec.steps[0].failures.join("\n"), /Tool execution failed: ETIMEDOUT/);
  assert.equal(w.probeCalls(), 1, "only the pre-probe fired — no post-probe after a throw");
  const a = rec.steps[0].attest!;
  assert.equal(a.method, "declared-probe");
  assert.equal(a.confidence, "partial");
  assert.ok(a.pre, "the captured pre evidence must be preserved");
  assert.equal(a.post, undefined);
  assert.equal(a.reason, "dispatch-failed");
});

test("F4: throwing write tool with a FAILED pre-probe records no attest (nothing was captured)", async () => {
  const w = world();
  w.tools["fake.read"] = { effect: "read", run: async () => { throw new Error("probe down"); } };
  w.tools["fake.update"] = { effect: "idempotent-write", run: async () => { throw new Error("ETIMEDOUT"); } };
  const rec = await runSkill(parseSkill(withApprove(SKILL)), { tools: w.tools, dryRun: true });
  assert.equal(rec.steps[0].outcome, "failed");
  assert.equal(rec.steps[0].attest, undefined);
});
