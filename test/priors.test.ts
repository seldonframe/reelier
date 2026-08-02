// F5 local run-shape priors (docs/specs/run-shape-priors.md): the pure
// baseline/deviation computation over a skill's OWN prior run records.
//
// The honesty rules under test are the product, not a detail: too little
// history says so instead of inventing a baseline, a single past outlier
// never takes the center with it, and a value the skill has already produced
// is never called a departure.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRunShape,
  median,
  medianAbsoluteDeviation,
  deviatesFromBaseline,
  MIN_PRIOR_RUNS,
  MAX_BASELINE_RUNS,
  DEVIATION_MADS,
  type RunShapeReport,
  type RunShapeSignal,
} from "../src/priors.js";
import type { RunRecord, StepRecord, StepOutcome } from "../src/runner.js";

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-03-01T00:00:00.000Z");

/** Day `i` after T0, at midnight UTC. */
function dayStamp(i: number): string {
  return new Date(T0 + i * DAY).toISOString();
}

interface RunShapeSpec {
  /** Per-step outcomes, in order. Length becomes the `steps` signal. */
  outcomes?: StepOutcome[];
  /** How many of those steps carry a `write` block (a dispatched write). */
  writes?: number;
  /** Distinct `write.resource.id` values, attached to the first `writes` steps in order. */
  resourceIds?: string[];
  /** How many steps carry an `llm` block (an escalation that actually ran). */
  escalations?: number;
  /** How many steps are marked `mocked: true`. */
  mocked?: number;
  /** Heal level per step; every unnamed step is L0, which is what the runner records for a step that never escalated. */
  levels?: Array<0 | 1 | 2>;
  /** Total run duration, spread across the steps so their sum is exactly this. */
  ms?: number;
  startedAt?: string;
  skillSha?: string;
  mockFailures?: number[];
}

function record(spec: RunShapeSpec = {}): RunRecord {
  const outcomes = spec.outcomes ?? ["passed"];
  const writes = spec.writes ?? 0;
  const resourceIds = spec.resourceIds ?? [];
  const escalations = spec.escalations ?? 0;
  const mocked = spec.mocked ?? 0;
  const levels = spec.levels ?? [];
  const totalMs = spec.ms ?? 0;
  const per = Math.floor(totalMs / outcomes.length);
  const steps: StepRecord[] = outcomes.map((outcome, i) => ({
    n: i + 1,
    title: `step ${i + 1}`,
    level: levels[i] ?? 0,
    outcome,
    // The last step absorbs the remainder so sum(steps[].ms) is exactly
    // `ms` — the duration signal is that sum, not totals.ms.
    ms: i === outcomes.length - 1 ? totalMs - per * (outcomes.length - 1) : per,
    failures: [],
    ...(i < writes
      ? { write: { idempotencyKey: `k${i}`, approved: true, ...(i < resourceIds.length ? { resource: { id: resourceIds[i] } } : {}) } }
      : {}),
    ...(i < escalations ? { llm: { inputTokens: 1, outputTokens: 1 } } : {}),
    ...(i < mocked ? { mocked: true as const } : {}),
  }));
  const startedAt = spec.startedAt ?? dayStamp(0);
  return {
    skill: "fixture",
    startedAt,
    finishedAt: new Date(Date.parse(startedAt) + totalMs).toISOString(),
    passed: outcomes.every((o) => o !== "failed"),
    ...(spec.skillSha !== undefined ? { skillContentSha256: spec.skillSha } : {}),
    ...(spec.mockFailures !== undefined ? { mockFailures: spec.mockFailures } : {}),
    steps,
    totals: {
      steps: steps.length,
      passed: outcomes.filter((o) => o === "passed").length,
      unchecked: outcomes.filter((o) => o === "unchecked").length,
      skipped: outcomes.filter((o) => o === "skipped").length,
      failed: outcomes.filter((o) => o === "failed").length,
      ms: totalMs,
      llmInputTokens: 0,
      llmOutputTokens: 0,
    },
  };
}

/**
 * One record per entry in `counts`, a day apart, oldest first. Every record
 * has the SAME step count (the widest one needed) so that `writes` is the
 * only signal that moves — a test about writes must not accidentally trip
 * the `steps` signal too.
 */
function writeHistory(counts: number[]): RunRecord[] {
  const width = Math.max(1, ...counts);
  return counts.map((w, i) =>
    record({
      outcomes: Array.from({ length: width }, () => "passed" as StepOutcome),
      writes: w,
      startedAt: dayStamp(i),
    })
  );
}

/** `n` runs exactly one day apart, oldest first. */
function dailyRuns(n: number): RunRecord[] {
  return Array.from({ length: n }, (_, i) => record({ startedAt: dayStamp(i) }));
}

function baselineOf(report: RunShapeReport): Extract<RunShapeReport, { kind: "baseline" }> {
  assert.equal(report.kind, "baseline", `expected a baseline report, got ${report.kind}`);
  return report as Extract<RunShapeReport, { kind: "baseline" }>;
}

function signal(report: RunShapeReport, metric: RunShapeSignal["metric"]): RunShapeSignal {
  const base = baselineOf(report);
  const found = base.signals.find((s) => s.metric === metric);
  assert.ok(found, `expected a "${metric}" signal, got: ${base.signals.map((s) => s.metric).join(", ")}`);
  return found;
}

function deviatingMetrics(report: RunShapeReport): string[] {
  return baselineOf(report)
    .signals.filter((s) => s.deviates)
    .map((s) => s.metric);
}

// --------------------------------------------------------------------------
// The robust statistics themselves
// --------------------------------------------------------------------------

test("median: odd n is the middle OBSERVED value; even n is the midpoint of the middle two", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 1, 1, 100]), 1);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([7]), 7);
});

test("median is not a mean: one 400-write outlier does not move the center", () => {
  // The whole reason this module refuses a mean. mean([1,1,1,1,400]) = 80.8,
  // which would hide the very next 400-write run behind its own predecessor.
  assert.equal(median([1, 1, 1, 1, 400]), 1);
});

test("medianAbsoluteDeviation: 0 for a constant sample, and robust to one outlier", () => {
  assert.equal(medianAbsoluteDeviation([5, 5, 5, 5]), 0);
  // Deviations about median 12 are [2,1,0,1,78] -> median 1. The outlier
  // inflates neither the center nor the scale.
  assert.equal(medianAbsoluteDeviation([10, 11, 12, 13, 90]), 1);
});

test("median/MAD at n=3: the median is an observed value and the MAD survives one outlier", () => {
  // n=3 is MIN_PRIOR_RUNS precisely because of this: 900 is a third of the
  // sample and still moves neither statistic off the two honest values.
  assert.equal(median([10, 12, 900]), 12);
  assert.equal(medianAbsoluteDeviation([10, 12, 900]), 2);
});

test("median/MAD refuse an empty sample rather than return NaN", () => {
  assert.throws(() => median([]), /empty/i);
  assert.throws(() => medianAbsoluteDeviation([]), /empty/i);
});

test("deviatesFromBaseline: outside the observed range by MORE than DEVIATION_MADS MADs", () => {
  const b = { median: 100, mad: 10, min: 90, max: 120, n: 5 };
  assert.equal(DEVIATION_MADS, 3);
  assert.equal(deviatesFromBaseline(120, b), false, "the max itself is not outside the range");
  assert.equal(deviatesFromBaseline(150, b), false, "30 past the max is exactly 3 MADs, not more than 3");
  assert.equal(deviatesFromBaseline(151, b), true);
  assert.equal(deviatesFromBaseline(59, b), true, "the rule is symmetric — a collapse is as reportable as a spike");
});

test("deviatesFromBaseline: MAD 0 degrades to 'outside everything the previous runs did'", () => {
  const b = { median: 1, mad: 0, min: 1, max: 1, n: 4 };
  assert.equal(deviatesFromBaseline(1, b), false);
  assert.equal(deviatesFromBaseline(2, b), true);
  assert.equal(deviatesFromBaseline(0, b), true);
});

// --------------------------------------------------------------------------
// Too little history says so — it never invents a baseline
// --------------------------------------------------------------------------

test("no records at all -> no-runs, never a baseline", () => {
  assert.equal(computeRunShape([]).kind, "no-runs");
});

test("deferred-resolution records never become a run-shape sample or subject", () => {
  const executions = dailyRuns(4);
  const resolution = { ...record({ outcomes: ["unchecked"], startedAt: dayStamp(4) }), passed: false, deferredResolution: true as const };
  const report = computeRunShape([...executions, resolution]);
  assert.equal(report.kind, "baseline");
  if (report.kind === "baseline") {
    assert.equal(report.latestStartedAt, executions[3].startedAt);
    assert.equal(report.subjectIsNewestRecord, true);
  }
});

test("fewer than MIN_PRIOR_RUNS priors -> insufficient-history reporting the real counts", () => {
  assert.equal(MIN_PRIOR_RUNS, 3);
  for (const priors of [0, 1, 2]) {
    const report = computeRunShape(dailyRuns(priors + 1));
    assert.equal(report.kind, "insufficient-history", `${priors} priors must not produce a baseline`);
    if (report.kind !== "insufficient-history") return;
    assert.equal(report.priorRuns, priors);
    assert.equal(report.required, MIN_PRIOR_RUNS);
    assert.equal(report.latestStartedAt, dayStamp(priors));
  }
});

test("exactly MIN_PRIOR_RUNS priors -> a baseline (the boundary is pinned on both sides)", () => {
  const report = computeRunShape(dailyRuns(4));
  assert.equal(report.kind, "baseline");
  assert.equal(baselineOf(report).priorRuns, 3);
});

test("mock runs (--fail N) are excluded from the sample AND from being the subject", () => {
  const records = [
    ...dailyRuns(3),
    record({ outcomes: ["failed"], startedAt: dayStamp(3), mockFailures: [1] }),
  ];
  // Four records on disk, but the mock is neither the latest nor a prior:
  // with it removed there are 2 priors and one subject, which is too little.
  const report = computeRunShape(records);
  assert.equal(report.kind, "insufficient-history");
  if (report.kind !== "insufficient-history") return;
  assert.equal(report.priorRuns, 2);
  assert.equal(report.latestStartedAt, dayStamp(2), "the mock must not be the subject either");
});

test("a file of nothing but mock runs -> no-runs", () => {
  const records = [0, 1, 2, 3, 4].map((i) => record({ startedAt: dayStamp(i), mockFailures: [1] }));
  assert.equal(computeRunShape(records).kind, "no-runs");
});

// --------------------------------------------------------------------------
// Whose run is this? The subject is the newest USABLE record, which is not
// always the newest record on disk — and a caller whose whole claim is "this
// run" must be able to tell the difference without re-deriving it.
// --------------------------------------------------------------------------

test("subjectIsNewestRecord is true when the run being reported on IS the last record on disk", () => {
  assert.equal(baselineOf(computeRunShape(writeHistory([0, 0, 0, 0, 1]))).subjectIsNewestRecord, true);
});

test("subjectIsNewestRecord is FALSE when a mock run was appended after the subject", () => {
  // The file's newest record is a `--fail 1` mock run, which is excluded from
  // the sample and from being the subject. The deviation that survives (the
  // day-4 run's write) is real — it simply is not about the newest run, and
  // the report has to carry that fact or a caller will attribute it wrongly.
  const records = [
    ...writeHistory([0, 0, 0, 0, 1]),
    record({ outcomes: ["failed"], startedAt: dayStamp(5), mockFailures: [1] }),
  ];
  const report = computeRunShape(records);
  const base = baselineOf(report);
  assert.equal(base.subjectIsNewestRecord, false);
  assert.equal(base.latestStartedAt, dayStamp(4), "the subject is the day-4 real run, not the mock");
  assert.deepEqual(deviatingMetrics(report), ["writes"]);
});

test("insufficient-history carries subjectIsNewestRecord too — the excluded newest record is not the caller's to guess", () => {
  const records = [...dailyRuns(3), record({ outcomes: ["failed"], startedAt: dayStamp(3), mockFailures: [1] })];
  const report = computeRunShape(records);
  assert.equal(report.kind, "insufficient-history");
  if (report.kind !== "insufficient-history") return;
  assert.equal(report.subjectIsNewestRecord, false);
  assert.equal(computeRunShape(dailyRuns(3)).kind === "insufficient-history", true);
  const clean = computeRunShape(dailyRuns(3));
  if (clean.kind !== "insufficient-history") return;
  assert.equal(clean.subjectIsNewestRecord, true);
});

test("the baseline window is capped at MAX_BASELINE_RUNS most-recent priors", () => {
  assert.equal(MAX_BASELINE_RUNS, 20);
  // 30 ancient runs at 50 writes, then 20 recent ones at 1: the window must
  // hold only the recent regime, so its median is 1 and not 50.
  const counts = [...Array.from({ length: 30 }, () => 50), ...Array.from({ length: 20 }, () => 1), 1];
  const writes = signal(computeRunShape(writeHistory(counts)), "writes");
  assert.equal(writes.baseline.n, MAX_BASELINE_RUNS);
  assert.equal(writes.baseline.median, 1);
  assert.equal(writes.baseline.max, 1);
});

// --------------------------------------------------------------------------
// The headline signal
// --------------------------------------------------------------------------

test("400 writes against a history of 1 is a deviation, and nothing else is", () => {
  const report = computeRunShape(writeHistory([1, 1, 2, 1, 400]));
  const writes = signal(report, "writes");
  assert.equal(writes.latest, 400);
  assert.equal(writes.baseline.median, 1);
  assert.equal(writes.baseline.min, 1);
  assert.equal(writes.baseline.max, 2);
  assert.equal(writes.baseline.n, 4);
  assert.deepEqual(deviatingMetrics(report), ["writes"]);
});

test("one past outlier neither moves the reported center nor blinds the next departure", () => {
  // History [1,1,400,1]. A mean would report 100.75 as this skill's normal —
  // a number no run ever produced — and a mean+stddev rule would inflate its
  // scale (sd ~200, so 3sd ~600) enough to swallow the next spike entirely.
  // The median stays on a value that actually happened, the MAD stays 0, and
  // 800 is still reported.
  const writes = signal(computeRunShape(writeHistory([1, 1, 400, 1, 800])), "writes");
  assert.equal(writes.baseline.median, 1);
  assert.equal(writes.baseline.mad, 0);
  assert.ok(writes.deviates);
});

test("a repeat of a value the window already contains is NOT reported — the rule is stated once and holds", () => {
  // 400 happened once in [1,1,400,1], so a second 400 is not outside
  // anything the previous runs did. Consistency here is the point: the rule
  // that stops [1,1,1,2,2] from flagging a 2 is the same rule, and bending
  // it for a big number would make the surface unexplainable.
  const writes = signal(computeRunShape(writeHistory([1, 1, 400, 1, 400])), "writes");
  assert.equal(writes.deviates, false);
});

test("a value the skill has already produced is never called a departure", () => {
  // [1,1,1,2,2] has median 1 and MAD 0 — a bare |x-median| > k*MAD test would
  // flag this run's 2 writes, while two of the last five runs dispatched 2.
  const report = computeRunShape(writeHistory([1, 1, 1, 2, 2, 2]));
  assert.equal(signal(report, "writes").deviates, false);
  assert.deepEqual(deviatingMetrics(report), []);
});

test("zero writes against a history of writes deviates too — a collapse is reportable", () => {
  const writes = signal(computeRunShape(writeHistory([1, 1, 1, 1, 0])), "writes");
  assert.equal(writes.latest, 0);
  assert.ok(writes.deviates);
});

// --------------------------------------------------------------------------
// Every signal, derived from the shipped RunRecord shape
// --------------------------------------------------------------------------

test("the four outcome classes are four separate signals, never collapsed", () => {
  const priors = [0, 1, 2].map((i) =>
    record({ outcomes: ["passed", "passed", "unchecked", "skipped"], startedAt: dayStamp(i) })
  );
  const latest = record({ outcomes: ["passed", "failed", "failed", "failed"], startedAt: dayStamp(3) });
  const report = computeRunShape([...priors, latest]);
  assert.equal(signal(report, "passed").latest, 1);
  assert.equal(signal(report, "unchecked").latest, 0);
  assert.equal(signal(report, "skipped").latest, 0);
  assert.equal(signal(report, "failed").latest, 3);
  // unchecked never rolls into passed — the totals-honesty rule holds here too.
  assert.equal(signal(report, "passed").baseline.median, 2);
  assert.equal(signal(report, "unchecked").baseline.median, 1);
});

test("counts come from steps[], not from a legacy totals rollup that disagrees with it", () => {
  // A genuine 0.1.x-shaped record: totals.passed is the old "passed OR
  // unchecked" rollup and there is no unchecked/skipped field at all.
  const legacy = {
    skill: "fixture",
    startedAt: dayStamp(0),
    finishedAt: dayStamp(0),
    passed: true,
    steps: [
      { n: 1, title: "one", level: 0, outcome: "passed", ms: 10, failures: [] },
      { n: 2, title: "two", level: 0, outcome: "unchecked", ms: 5, failures: [] },
    ],
    totals: { steps: 2, passed: 2, failed: 0, ms: 15, llmInputTokens: 0, llmOutputTokens: 0 },
  } as unknown as RunRecord;
  const report = computeRunShape([0, 1, 2, 3].map((i) => ({ ...legacy, startedAt: dayStamp(i) })));
  assert.equal(signal(report, "passed").latest, 1);
  assert.equal(signal(report, "unchecked").latest, 1);
  assert.equal(signal(report, "passed").baseline.median, 1);
  assert.equal(signal(report, "duration").latest, 15);
});

test("duration is the sum of steps[].ms and carries the ms unit", () => {
  const priors = [0, 1, 2].map((i) => record({ outcomes: ["passed", "passed"], ms: 1000, startedAt: dayStamp(i) }));
  const latest = record({ outcomes: ["passed", "passed"], ms: 90_000, startedAt: dayStamp(3) });
  const duration = signal(computeRunShape([...priors, latest]), "duration");
  assert.equal(duration.latest, 90_000);
  assert.equal(duration.baseline.median, 1000);
  assert.equal(duration.unit, "ms");
  assert.equal(duration.sample, "runs");
  assert.ok(duration.deviates);
});

// --------------------------------------------------------------------------
// The five metrics F5 gained when `shapeOf` was replaced by `deriveFootprint`
// --------------------------------------------------------------------------

/** Every record the same width, so only the metric under test can move. */
const WIDTH = 6;

/**
 * One record per value, a day apart, oldest first, identical except for the
 * fields `carrying` turns that value into. The whole point is that the metric
 * under test is the ONLY thing that differs between the runs: a test that
 * accidentally moves `steps` too proves nothing about the metric it names.
 */
function shapeHistory(values: number[], carrying: (v: number) => RunShapeSpec): RunRecord[] {
  return values.map((v, i) =>
    record({ outcomes: Array.from({ length: WIDTH }, () => "passed" as StepOutcome), startedAt: dayStamp(i), ...carrying(v) })
  );
}

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `res-${i}`);
}

function levelsAt(level: 1 | 2, n: number): Array<0 | 1 | 2> {
  return Array.from({ length: WIDTH }, (_, i) => (i < n ? level : 0));
}

const NEW_METRICS: ReadonlyArray<{ metric: RunShapeSignal["metric"]; carrying: (v: number) => RunShapeSpec }> = [
  // Same six writes every run — only how many DISTINCT resources they landed
  // on changes, which is the difference between six updates to six records
  // and six updates to one.
  { metric: "writeResources", carrying: (v) => ({ writes: WIDTH, resourceIds: ids(v) }) },
  { metric: "escalations", carrying: (v) => ({ escalations: v }) },
  { metric: "healedL1", carrying: (v) => ({ levels: levelsAt(1, v) }) },
  { metric: "healedL2", carrying: (v) => ({ levels: levelsAt(2, v) }) },
];

test("each new metric is reported when it lands outside everything the previous runs did", () => {
  for (const { metric, carrying } of NEW_METRICS) {
    const report = computeRunShape(shapeHistory([0, 0, 0, 0, 4], carrying));
    assert.equal(signal(report, metric).latest, 4, metric);
    assert.equal(signal(report, metric).unit, "count", metric);
    assert.deepEqual(deviatingMetrics(report), [metric], `${metric} must be the only signal that moved`);
  }
});

test("each new metric stays quiet on a value the skill has already produced", () => {
  // The property `deviatesFromBaseline` exists to provide (§3): window
  // [0,1,1,0] contains 1, so a run at 1 is not outside anything — and a
  // surface that flagged it would be teaching the operator to ignore it.
  for (const { metric, carrying } of NEW_METRICS) {
    const report = computeRunShape(shapeHistory([0, 1, 1, 0, 1], carrying));
    assert.equal(signal(report, metric).latest, 1, metric);
    assert.equal(signal(report, metric).deviates, false, `${metric} repeated a value from its own window`);
    assert.deepEqual(deviatingMetrics(report), [], metric);
  }
});

test("writeResources moves independently of writes — same count of writes, collapsed onto one resource", () => {
  // Six writes every run either way. The prior runs spread them over six
  // records; this one put all six on the same record. `writes` cannot see
  // that at all, which is exactly why the resource count is its own signal.
  const report = computeRunShape(shapeHistory([6, 6, 6, 6, 1], (v) => ({ writes: WIDTH, resourceIds: ids(v) })));
  assert.equal(signal(report, "writes").latest, WIDTH);
  assert.equal(signal(report, "writes").deviates, false);
  assert.equal(signal(report, "writeResources").latest, 1);
  assert.deepEqual(deviatingMetrics(report), ["writeResources"]);
});

test("the metric set is exactly this — healL0, manifestIgnored and mocked are deliberately not in it", () => {
  // healL0 is `steps` minus the other two levels and carries no independent
  // information — including it would report the same movement a third time.
  // manifestIgnored is a boolean, and `deviatesFromBaseline` is defined over
  // numbers. `mocked` is unobservable on this surface entirely — see the test
  // below. All three live on RunFootprint for persistence and are not metrics.
  const metrics = baselineOf(computeRunShape(dailyRuns(6), { now: T0 + 6 * DAY })).signals.map((s) => s.metric);
  assert.deepEqual(metrics, [
    "steps",
    "passed",
    "unchecked",
    "skipped",
    "failed",
    "writes",
    "writeResources",
    "escalations",
    "healedL1",
    "healedL2",
    "duration",
    "gap",
    "silence",
  ]);
});

test("`mocked` is not a metric: every record that CAN carry a mocked step is one §4 excludes", () => {
  // The structural argument, pinned so nobody re-adds the row. A step gets
  // `mocked: true` only from executeStep's mock branch (runner.ts:853-858),
  // reachable only when `options.mockFailures[step.n]` is defined — and any
  // run with mockFailures writes the record-level `mockFailures` array, which
  // is exactly what §4's filter strips. So a `mocked` signal could never read
  // anything but a constant 0, forever, on the surface whose law is that
  // noise is worse than silence.
  //
  // Note the fixture sets BOTH fields, which is the only shape the runner can
  // actually produce. A test that set step-level `mocked` alone would pin
  // behaviour no record has ever had, and would read as coverage.
  const mockRun = record({
    outcomes: ["passed", "passed", "passed"],
    mocked: 3,
    mockFailures: [1],
    startedAt: dayStamp(4),
  });
  const report = computeRunShape([...dailyRuns(4), mockRun]);
  const base = baselineOf(report);
  assert.equal(base.subjectIsNewestRecord, false, "the record carrying the mocked steps is not even the subject");
  assert.equal(base.latestStartedAt, dayStamp(3));
  assert.equal(
    base.signals.map((s) => String(s.metric)).includes("mocked"),
    false,
    "a counter that can only ever be 0 here does not get a row"
  );
});

test("steps is its own signal (a skill that grew steps reports as a shape change)", () => {
  const priors = [0, 1, 2].map((i) => record({ outcomes: ["passed", "passed"], startedAt: dayStamp(i) }));
  const latest = record({ outcomes: ["passed", "passed", "passed", "passed", "passed"], startedAt: dayStamp(3) });
  const steps = signal(computeRunShape([...priors, latest]), "steps");
  assert.equal(steps.latest, 5);
  assert.equal(steps.unit, "count");
  assert.ok(steps.deviates);
});

// --------------------------------------------------------------------------
// Silence
// --------------------------------------------------------------------------

test("gap and silence need three GAPS, so four priors — with exactly three there is neither", () => {
  const threePriors = computeRunShape(dailyRuns(4), { now: T0 + 99 * DAY });
  assert.equal(baselineOf(threePriors).priorRuns, 3);
  assert.equal(
    baselineOf(threePriors).signals.some((s) => s.metric === "gap" || s.metric === "silence"),
    false,
    "two gaps is below MIN_PRIOR_RUNS — say nothing rather than baseline on two samples"
  );

  assert.equal(signal(computeRunShape(dailyRuns(5)), "gap").baseline.n, 3);
});

test("gap: this run's start minus the previous run's start, against the prior cadence", () => {
  const runs = dailyRuns(5);
  runs[4] = record({ startedAt: new Date(Date.parse(runs[3].startedAt) + 9 * DAY).toISOString() });
  const gap = signal(computeRunShape(runs), "gap");
  assert.equal(gap.latest, 9 * DAY);
  assert.equal(gap.baseline.median, DAY);
  assert.equal(gap.unit, "ms");
  assert.equal(gap.sample, "gaps");
  assert.ok(gap.deviates);
});

test("silence is emitted only when a reading instant is supplied — a run just finished has none", () => {
  const runs = dailyRuns(5);
  assert.equal(
    baselineOf(computeRunShape(runs)).signals.some((s) => s.metric === "silence"),
    false,
    "reelier run supplies no `now`: at the end of a run there is nothing to be silent about"
  );

  const latestStart = Date.parse(runs[4].startedAt);
  const silence = signal(computeRunShape(runs, { now: latestStart + 9 * DAY }), "silence");
  assert.equal(silence.latest, 9 * DAY);
  assert.equal(silence.baseline.median, DAY);
  assert.equal(silence.sample, "gaps");
  assert.ok(silence.deviates, "nine days of quiet against a daily cadence is the watcher's whole use case");
});

test("silence is ONE-SIDED: an hour after a daily-cadence run is the clock, not a departure", () => {
  // Silence is counted from the latest run to now, so between runs it passes
  // through every value from 0 upward. A two-sided test would fire on every
  // look taken shortly after a run — the single loudest way to make this
  // surface worthless. Only the high side of silence carries information.
  const runs = dailyRuns(5);
  const quiet = signal(computeRunShape(runs, { now: Date.parse(runs[4].startedAt) + HOUR }), "silence");
  assert.equal(quiet.latest, HOUR);
  assert.equal(quiet.baseline.min, DAY, "an hour IS below everything the previous gaps did — and still not reported");
  assert.equal(quiet.deviates, false);
});

test("deviatesFromBaseline: direction 'high' suppresses the low side and only the low side", () => {
  const b = { median: 100, mad: 0, min: 100, max: 100, n: 4 };
  assert.equal(deviatesFromBaseline(1, b), true, "two-sided is the default for every completed measurement");
  assert.equal(deviatesFromBaseline(1, b, "high"), false);
  assert.equal(deviatesFromBaseline(101, b, "high"), true);
});

test("gap stays two-sided — a run that came far EARLIER than usual is a completed measurement", () => {
  const runs = dailyRuns(5);
  runs[4] = record({ startedAt: new Date(Date.parse(runs[3].startedAt) + 60_000).toISOString() });
  const gap = signal(computeRunShape(runs), "gap");
  assert.equal(gap.latest, 60_000);
  assert.ok(gap.deviates, "unlike silence, a gap is measured between two runs that both happened");
});

test("unparseable or backwards timestamps are DROPPED from the gap sample, never clamped", () => {
  const runs = dailyRuns(8);
  // One clock-skewed record (starts before its predecessor) and one
  // unparseable stamp. Every gap touching them vanishes; three honest gaps
  // survive, which is exactly the minimum.
  runs[2] = { ...runs[2], startedAt: new Date(T0 - 4 * DAY).toISOString() };
  runs[5] = { ...runs[5], startedAt: "not-a-timestamp" };
  const report = computeRunShape(runs);
  const gap = signal(report, "gap");
  assert.equal(gap.baseline.n, 3);
  assert.ok(gap.baseline.min >= 0, "a negative gap must never reach the baseline");
  for (const s of baselineOf(report).signals) {
    assert.ok(Number.isFinite(s.latest), `${s.metric}.latest must be finite`);
    assert.ok(Number.isFinite(s.baseline.median), `${s.metric}.baseline.median must be finite`);
    assert.ok(Number.isFinite(s.baseline.mad), `${s.metric}.baseline.mad must be finite`);
  }
});

test("an unparseable latest timestamp drops gap and silence, and keeps every other signal", () => {
  const runs = dailyRuns(6);
  runs[5] = { ...runs[5], startedAt: "not-a-timestamp" };
  const report = computeRunShape(runs, { now: T0 + 99 * DAY });
  const metrics = baselineOf(report).signals.map((s) => s.metric);
  assert.equal(metrics.includes("gap"), false);
  assert.equal(metrics.includes("silence"), false);
  assert.ok(metrics.includes("writes"));
});

// --------------------------------------------------------------------------
// The skill-file note is three-valued
// --------------------------------------------------------------------------

test("skillChanged: true / false / undefined — a missing sha is UNKNOWN, never 'unchanged'", () => {
  const priors = [0, 1, 2].map((i) => record({ startedAt: dayStamp(i), skillSha: "aaa" }));

  assert.equal(baselineOf(computeRunShape([...priors, record({ startedAt: dayStamp(3), skillSha: "bbb" })])).skillChanged, true);
  assert.equal(baselineOf(computeRunShape([...priors, record({ startedAt: dayStamp(3), skillSha: "aaa" })])).skillChanged, false);
  assert.equal(baselineOf(computeRunShape([...priors, record({ startedAt: dayStamp(3) })])).skillChanged, undefined);

  const priorHasNone = computeRunShape([
    record({ startedAt: dayStamp(0), skillSha: "aaa" }),
    record({ startedAt: dayStamp(1), skillSha: "aaa" }),
    record({ startedAt: dayStamp(2) }),
    record({ startedAt: dayStamp(3), skillSha: "bbb" }),
  ]);
  assert.equal(baselineOf(priorHasNone).skillChanged, undefined);
});

// --------------------------------------------------------------------------
// It is a recorder: it computes, it never judges
// --------------------------------------------------------------------------

test("the report carries no verdict field — a deviation is a difference and nothing more", () => {
  const json = JSON.stringify(computeRunShape(writeHistory([1, 1, 1, 400]))).toLowerCase();
  for (const forbidden of ["anomal", "unsafe", "verified", "suspicious", "violation", "severity", "verdict", "alert"]) {
    assert.equal(json.includes(forbidden), false, `the report must not carry a "${forbidden}" field or value`);
  }
});

test("a malformed record (no steps array) is survived, not thrown on", () => {
  const broken = { skill: "fixture", startedAt: dayStamp(3), finishedAt: dayStamp(3), passed: true } as unknown as RunRecord;
  const report = computeRunShape([...dailyRuns(3), broken]);
  // The broken record contributes a zero-shaped run rather than taking the
  // whole report down: this surface is advisory and must never be the thing
  // that breaks a run which already happened.
  assert.equal(report.kind, "baseline");
  assert.equal(signal(report, "steps").latest, 0);
});
