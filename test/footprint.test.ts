import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFootprint, recordTotals } from "../src/footprint.js";
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

test("deriveFootprint records ms as the sum of steps[].ms, not the totals rollup", () => {
  // `totals.ms` says 4242; the steps say 1 + 40. The sum is the measurement
  // and the rollup is a claim about it, so the sum wins -- the same reason
  // the outcome counts come from steps[]. ms is recorded, never compared.
  const f = deriveFootprint(
    run([step(1, "passed"), step(2, "passed", { ms: 40 })], {
      totals: { steps: 2, passed: 2, unchecked: 0, skipped: 0, failed: 0, ms: 4242, llmInputTokens: 0, llmOutputTokens: 0 },
    })
  );
  assert.equal(f.ms, 41);
});

test("deriveFootprint: a non-finite or non-numeric step ms cannot reach the footprint", () => {
  // A hand-edited record can carry `"ms": null` or a JSON-round-tripped
  // Infinity. A NaN on the footprint would poison a median downstream, so a
  // step whose ms is not a finite number contributes nothing rather than
  // making the whole duration unusable.
  const f = deriveFootprint(
    run([
      step(1, "passed", { ms: 10 }),
      step(2, "passed", { ms: Number.NaN }),
      step(3, "passed", { ms: Number.POSITIVE_INFINITY }),
      step(4, "passed", { ms: null as unknown as number }),
      step(5, "passed", { ms: "7" as unknown as number }),
    ])
  );
  assert.equal(f.ms, 10);
  assert.ok(Number.isFinite(f.ms));
});

test("deriveFootprint counts outcomes from steps[] even when a MODERN totals disagrees", () => {
  // `totals.unchecked` is present, so this is a post-0.2.0 record and
  // `recordTotals` would take the rollup at its word. The footprint does not:
  // per-step outcomes were always recorded correctly at every package
  // version, while the rollup is only sometimes trustworthy. One derivation,
  // and it is the authoritative one.
  const r = run([step(1, "passed"), step(2, "unchecked"), step(3, "failed")], {
    totals: { steps: 3, passed: 3, unchecked: 0, skipped: 0, failed: 0, ms: 5, llmInputTokens: 0, llmOutputTokens: 0 },
  });
  const f = deriveFootprint(r);
  assert.equal(f.passed, 1);
  assert.equal(f.unchecked, 1);
  assert.equal(f.failed, 1);
  assert.equal(f.skipped, 0);

  // recordTotals is NOT the same function and deliberately still reports what
  // the record itself claims -- `reelier bench` summarises a record's own
  // totals honestly, which is a different job from deriving its shape.
  assert.deepEqual(recordTotals(r), { passed: 3, unchecked: 0, skipped: 0, failed: 0 });
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
    // A hand-edited or corrupted steps[] entry: readRunRecords is a bare
    // JSON.parse (runner.ts:474-484), and null/undefined/a bare string are
    // all valid JSON array entries.
    { skill: "x", steps: [null], totals: { steps: 1, passed: 0, unchecked: 0, skipped: 0, failed: 0, ms: 0, llmInputTokens: 0, llmOutputTokens: 0 } },
    { skill: "x", steps: [null], totals: { steps: 1, passed: 1, ms: 1 } },
    { skill: "x", steps: [null, undefined, "x"] },
    { skill: "x", steps: [, ,] }, // sparse array -- entries are `undefined` on iteration
    // `write`/`llm` are dereferenced, not just tested for presence -- a
    // hand-edited "write": null or "llm": null must not throw.
    { skill: "x", steps: [step(1, "passed", { write: null as unknown as undefined })] },
    { skill: "x", steps: [step(1, "passed", { llm: null as unknown as undefined })] },
    { skill: "x", steps: [step(1, "passed", { mocked: false as unknown as true })] },
  ];
  for (const s of shapes) {
    assert.doesNotThrow(() => deriveFootprint(s as RunRecord), `threw on ${JSON.stringify(s)}`);
  }
  const empty = deriveFootprint({} as RunRecord);
  assert.equal(empty.steps, 0);
  assert.equal(empty.writesDispatched, 0);
});

test("deriveFootprint: a hand-edited write/llm/mocked that fails its declared shape counts as absent, not present", () => {
  const nullWrite = deriveFootprint(run([step(1, "passed", { write: null as unknown as undefined })]));
  assert.equal(nullWrite.writesDispatched, 0, "\"write\": null is not a dispatched write");
  assert.equal(nullWrite.distinctWriteResources, 0);

  const nullLlm = deriveFootprint(run([step(1, "passed", { llm: null as unknown as undefined })]));
  assert.equal(nullLlm.escalations, 0, "\"llm\": null is not an escalation");

  const falseMocked = deriveFootprint(run([step(1, "passed", { mocked: false as unknown as true })]));
  assert.equal(falseMocked.mocked, 0, "\"mocked\": false is not mocked");

  // An array IS an object, so a `typeof x === "object" && x !== null` guard
  // alone lets `"write": []` through and over-counts it as a dispatched
  // write. Neither field is ever an array in a record this package wrote.
  const arrayWrite = deriveFootprint(run([step(1, "passed", { write: [] as unknown as undefined })]));
  assert.equal(arrayWrite.writesDispatched, 0, "\"write\": [] is not a dispatched write");
  assert.equal(arrayWrite.distinctWriteResources, 0);
  assert.equal(deriveFootprint(run([step(1, "passed", { llm: [] as unknown as undefined })])).escalations, 0, "\"llm\": [] is not an escalation");

  // Truthy-but-not-an-object hand edits: a bare string or a number reaches
  // neither branch, and `write: 0` must not be read as "no write" by
  // accident of falsiness -- it must be rejected for its shape.
  for (const bogus of ["str", 0, 1, true] as unknown[]) {
    const f = deriveFootprint(run([step(1, "passed", { write: bogus as undefined, llm: bogus as undefined })]));
    assert.equal(f.writesDispatched, 0, `write: ${JSON.stringify(bogus)} is not a dispatched write`);
    assert.equal(f.escalations, 0, `llm: ${JSON.stringify(bogus)} is not an escalation`);
  }

  // A well-formed write/llm/mocked still counts, so the shape guard isn't
  // accidentally suppressing the real signal.
  const real = deriveFootprint(run([step(1, "passed", { write: { idempotencyKey: "k", approved: true, resource: { id: "A" } }, llm: { inputTokens: 1, outputTokens: 1 }, mocked: true })]));
  assert.equal(real.writesDispatched, 1);
  assert.equal(real.distinctWriteResources, 1);
  assert.equal(real.escalations, 1);
  assert.equal(real.mocked, 1);
});
