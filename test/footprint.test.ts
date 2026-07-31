import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFootprint } from "../src/footprint.js";
import type { RunRecord, StepRecord, StepOutcome } from "../src/runner.js";

function step(n: number, outcome: StepOutcome, extra: Partial<StepRecord> = {}): StepRecord {
  return { n, title: `step ${n}`, level: 0, outcome, ms: 1, failures: [], ...extra };
}

function run(steps: StepRecord[], extra: Partial<RunRecord> = {}): RunRecord {
  const passed = steps.filter((s) => s.outcome === "passed").length;
  const unchecked = steps.filter((s) => s.outcome === "unchecked").length;
  const skipped = steps.filter((s) => s.outcome === "skipped").length;
  const failed = steps.filter((s) => s.outcome === "failed").length;
  return {
    skill: "demo",
    startedAt: "2026-07-01T00:00:00.000Z",
    finishedAt: "2026-07-01T00:00:05.000Z",
    passed: failed === 0,
    steps,
    totals: { steps: steps.length, passed, unchecked, skipped, failed, ms: 5, llmInputTokens: 0, llmOutputTokens: 0 },
    ...extra,
  };
}

test("deriveFootprint counts outcomes, writes, resources, escalations and heal levels", () => {
  const r = run([
    step(1, "passed", { write: { idempotencyKey: "k1", approved: true, resource: { id: "A" } } }),
    step(2, "passed", { write: { idempotencyKey: "k2", approved: true, resource: { id: "A" } } }),
    step(3, "passed", { write: { idempotencyKey: "k3", approved: true, resource: { id: "B" } } }),
    // dispatched, but no resource could be extracted -- contributes a write, not a resource
    step(4, "passed", { write: { idempotencyKey: "k4", approved: true } }),
    step(5, "unchecked", { level: 1, llm: { inputTokens: 10, outputTokens: 2 } }),
    step(6, "failed", { level: 2, llm: { inputTokens: 5, outputTokens: 1 } }),
    step(7, "skipped"),
    step(8, "passed", { mocked: true }),
  ]);
  const f = deriveFootprint(r);
  assert.equal(f.skill, "demo");
  assert.equal(f.steps, 8);
  assert.equal(f.passed, 5);
  assert.equal(f.failed, 1);
  assert.equal(f.unchecked, 1);
  assert.equal(f.skipped, 1);
  assert.equal(f.writesDispatched, 4);
  assert.equal(f.distinctWriteResources, 2, "A and B -- the id-less write contributes nothing");
  assert.equal(f.escalations, 2);
  assert.equal(f.healL0, 6);
  assert.equal(f.healL1, 1);
  assert.equal(f.healL2, 1);
  assert.equal(f.mocked, 1);
  assert.equal(f.manifestIgnored, false);
});

test("deriveFootprint reads manifestIgnored as a boolean, and absent is false", () => {
  assert.equal(deriveFootprint(run([step(1, "passed")])).manifestIgnored, false);
  assert.equal(deriveFootprint(run([step(1, "passed")], { manifestIgnored: true })).manifestIgnored, true);
});

test("deriveFootprint records ms but it is not an outcome counter", () => {
  const f = deriveFootprint(run([step(1, "passed")], { totals: { steps: 1, passed: 1, unchecked: 0, skipped: 0, failed: 0, ms: 4242, llmInputTokens: 0, llmOutputTokens: 0 } }));
  assert.equal(f.ms, 4242);
});

test("deriveFootprint honours SPEC 4.4: a pre-0.2.0 record's dishonest totals are ignored", () => {
  // No totals.unchecked -> legacy shape. Its totals.passed rolled up passed OR unchecked.
  const legacy = {
    skill: "demo",
    startedAt: "2025-01-01T00:00:00.000Z",
    finishedAt: "2025-01-01T00:00:01.000Z",
    passed: true,
    steps: [step(1, "passed"), step(2, "unchecked"), step(3, "skipped")],
    totals: { steps: 3, passed: 2, ms: 1, llmInputTokens: 0, llmOutputTokens: 0 },
  } as unknown as RunRecord;
  const f = deriveFootprint(legacy);
  assert.equal(f.passed, 1, "derived from steps[].outcome, not the legacy rollup");
  assert.equal(f.unchecked, 1);
  assert.equal(f.skipped, 1);
  assert.equal(f.failed, 0);
});

test("deriveFootprint is total -- it never throws on a degenerate or partial record", () => {
  const shapes: unknown[] = [
    { skill: "x", startedAt: "", finishedAt: "", passed: true, steps: [], totals: { steps: 0, passed: 0, unchecked: 0, skipped: 0, failed: 0, ms: 0, llmInputTokens: 0, llmOutputTokens: 0 } },
    { skill: "x", finishedAt: "t", passed: true, steps: [{ n: 1, title: "t", level: 0, outcome: "passed", ms: 0, failures: [] }] },
    { skill: "x", passed: true, steps: [] },
    { skill: "x", passed: true },
    { steps: [{ n: 1 }] },
    {},
  ];
  for (const s of shapes) {
    assert.doesNotThrow(() => deriveFootprint(s as RunRecord), `threw on ${JSON.stringify(s)}`);
  }
  const empty = deriveFootprint({} as RunRecord);
  assert.equal(empty.steps, 0);
  assert.equal(empty.writesDispatched, 0);
});
