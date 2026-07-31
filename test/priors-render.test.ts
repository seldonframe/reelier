// The strings F5 local run-shape priors puts in front of an operator
// (docs/specs/run-shape-priors.md §1). These are stable API and the honesty
// rules live here as much as in the math: a deviation is a difference, and
// this surface is never allowed to make it sound like anything else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRunShape } from "../src/priors.js";
import { fmtElapsed, renderRunShapeDeviationLines, renderRunShapeReportLines } from "../src/priors-render.js";
import type { RunRecord, StepRecord, StepOutcome } from "../src/runner.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-03-01T00:00:00.000Z");

function dayStamp(i: number): string {
  return new Date(T0 + i * DAY).toISOString();
}

function record(spec: { writes?: number; ms?: number; startedAt?: string; skillSha?: string; steps?: number }): RunRecord {
  const count = spec.steps ?? 1;
  const writes = spec.writes ?? 0;
  const totalMs = spec.ms ?? 0;
  const per = Math.floor(totalMs / count);
  const steps: StepRecord[] = Array.from({ length: count }, (_, i) => ({
    n: i + 1,
    title: `step ${i + 1}`,
    level: 0,
    outcome: "passed" as StepOutcome,
    ms: i === count - 1 ? totalMs - per * (count - 1) : per,
    failures: [],
    ...(i < writes ? { write: { idempotencyKey: `k${i}`, approved: true } } : {}),
  }));
  const startedAt = spec.startedAt ?? dayStamp(0);
  return {
    skill: "fixture",
    startedAt,
    finishedAt: new Date(Date.parse(startedAt) + totalMs).toISOString(),
    passed: true,
    ...(spec.skillSha !== undefined ? { skillContentSha256: spec.skillSha } : {}),
    steps,
    totals: {
      steps: count,
      passed: count,
      unchecked: 0,
      skipped: 0,
      failed: 0,
      ms: totalMs,
      llmInputTokens: 0,
      llmOutputTokens: 0,
    },
  };
}

/** One record per write count, a day apart, all with the same step count. */
function writeHistory(counts: number[], skillShas?: string[]): RunRecord[] {
  const width = Math.max(1, ...counts);
  return counts.map((w, i) =>
    record({ steps: width, writes: w, startedAt: dayStamp(i), ...(skillShas ? { skillSha: skillShas[i] } : {}) })
  );
}

// --------------------------------------------------------------------------
// Elapsed formatting
// --------------------------------------------------------------------------

test("fmtElapsed: sub-second is exact ms, sub-minute keeps a tenth, above that is two units", () => {
  assert.equal(fmtElapsed(0), "0ms");
  assert.equal(fmtElapsed(999), "999ms");
  assert.equal(fmtElapsed(1000), "1.0s");
  assert.equal(fmtElapsed(41_200), "41.2s");
  assert.equal(fmtElapsed(59_999), "60.0s");
  assert.equal(fmtElapsed(60_000), "1m");
  assert.equal(fmtElapsed(62_000), "1m 2s");
  assert.equal(fmtElapsed(HOUR), "1h");
  assert.equal(fmtElapsed(HOUR + 2 * 60_000), "1h 2m");
  assert.equal(fmtElapsed(9 * DAY), "9d");
  assert.equal(fmtElapsed(9 * DAY + 4 * HOUR), "9d 4h");
});

test("fmtElapsed: a negative elapsed is printed verbatim, never clamped to zero", () => {
  // Nothing in this module should produce one (backwards gaps are dropped
  // upstream), but if one ever arrives it must look wrong rather than look fine.
  assert.equal(fmtElapsed(-5), "-5ms");
});

// --------------------------------------------------------------------------
// The post-run surface speaks only on a deviation
// --------------------------------------------------------------------------

test("no deviation, too little history, or no runs at all -> the post-run surface prints NOTHING", () => {
  assert.deepEqual(renderRunShapeDeviationLines(computeRunShape([])), []);
  assert.deepEqual(renderRunShapeDeviationLines(computeRunShape(writeHistory([1, 1]))), []);
  assert.deepEqual(renderRunShapeDeviationLines(computeRunShape(writeHistory([1, 1, 1, 1]))), []);
});

test("the post-run deviation block, verbatim", () => {
  const lines = renderRunShapeDeviationLines(computeRunShape(writeHistory([1, 1, 2, 1, 400])));
  assert.deepEqual(lines, [
    "Run shape — this run vs this skill's own previous 4 runs:",
    "  ! writes: 400 (previous 4 runs: median 1, min 1, max 2)",
    "  A deviation is a difference from this skill's own history — not a fault, not a verdict. It changes no outcome and no exit code.",
  ]);
});

test("the skill-file note appears when the file changed, and NOT when it is unknown", () => {
  const changed = renderRunShapeDeviationLines(
    computeRunShape(writeHistory([1, 1, 2, 1, 400], ["a", "a", "a", "a", "b"]))
  );
  assert.ok(
    changed.includes(
      "  note: the skill file changed since the previous run — a shape difference may simply be the new skill."
    ),
    `expected the skill-file note, got:\n${changed.join("\n")}`
  );

  // No skillContentSha256 anywhere: unknown, so nothing is said. Silence
  // here is the point — "unchanged" would be a claim nobody observed.
  const unknown = renderRunShapeDeviationLines(computeRunShape(writeHistory([1, 1, 2, 1, 400])));
  assert.equal(unknown.some((l) => l.includes("skill file")), false);
});

// --------------------------------------------------------------------------
// The standalone report
// --------------------------------------------------------------------------

test("standalone report: no comparable runs", () => {
  assert.deepEqual(renderRunShapeReportLines(computeRunShape([]), "gbrain"), [
    "Run shape: gbrain",
    "  No comparable runs recorded. ('reelier run --fail N' mock runs are excluded — a mock run is a local recovery test, not a receipt.)",
  ]);
});

test("standalone report: too little history says exactly that, and computes no baseline", () => {
  assert.deepEqual(renderRunShapeReportLines(computeRunShape(writeHistory([1, 1, 1])), "gbrain"), [
    "Run shape: gbrain",
    `  latest run: ${dayStamp(2)}`,
    "  Not enough history for a baseline: 2 prior run(s), 3 required. No baseline computed.",
  ]);
});

test("standalone report: every signal is shown, deviating ones marked, with the legend and the disclaimer", () => {
  const lines = renderRunShapeReportLines(computeRunShape(writeHistory([1, 1, 2, 1, 400])), "gbrain");
  const text = lines.join("\n");

  assert.equal(lines[0], "Run shape: gbrain");
  assert.equal(lines[1], `  latest run: ${dayStamp(4)}`);
  assert.equal(lines[2], "  baseline:   this skill's own previous 4 runs");

  // Non-deviating signals are still shown — the point of the standalone
  // command is the whole picture, not just the exceptions.
  assert.ok(text.includes("    steps       400        previous 4 runs: median 400, min 400, max 400"), text);
  assert.ok(text.includes("  ! writes      400        previous 4 runs: median 1, min 1, max 2"), text);
  assert.ok(text.includes("    duration    0ms        previous 4 runs: median 0ms, min 0ms, max 0ms"), text);
  assert.ok(text.includes("    gap         1d         previous 3 gaps: median 1d, min 1d, max 1d"), text);

  assert.ok(
    text.includes(
      "  ! = outside everything the previous runs did, by more than 3 median-absolute-deviations."
    ),
    text
  );
  assert.ok(
    text.includes(
      "  A deviation is a difference, not a fault. This command executed nothing and checked nothing, and always exits 0."
    ),
    text
  );
});

test("standalone report: silence appears only with a reading instant, and explains itself when it does", () => {
  const runs = writeHistory([1, 1, 1, 1, 1]);
  const quiet = renderRunShapeReportLines(
    computeRunShape(runs, { now: Date.parse(runs[4].startedAt) + 9 * DAY }),
    "gbrain"
  ).join("\n");
  assert.ok(quiet.includes("  ! silence     9d         previous 3 gaps: median 1d, min 1d, max 1d"), quiet);
  assert.ok(quiet.includes("  silence = time since the latest run started."), quiet);

  const noNow = renderRunShapeReportLines(computeRunShape(runs), "gbrain").join("\n");
  assert.equal(noNow.includes("silence"), false);
});

// --------------------------------------------------------------------------
// The vocabulary ban — the whole product, in one test
// --------------------------------------------------------------------------

// Words that would turn an observed difference into a claim nobody earned.
// "verified" and "safe" are on the list because a receipt must never imply
// more than it proves (never-list #2); the rest are the vocabulary of a
// monitoring tool, which this is not.
const FORBIDDEN = [
  /anomal/i,
  /unsafe/i,
  /suspicious/i,
  /malicious/i,
  /\battack/i,
  /\bbreach/i,
  /went wrong/i,
  /\bdetected\b/i,
  /violation/i,
  /\bverified\b/i,
  /\bsafe\b/i,
  /\bincident\b/i,
  /\balert/i,
  /\bfailure\b/i,
  /PASSED/,
  /FAILED/,
  /\bERROR\b/,
];

test("no rendered line, on any surface or any report kind, ever calls a deviation a fault", () => {
  const cases = [
    computeRunShape([]),
    computeRunShape(writeHistory([1, 1])),
    computeRunShape(writeHistory([1, 1, 1, 1])),
    computeRunShape(writeHistory([1, 1, 2, 1, 400], ["a", "a", "a", "a", "b"])),
    computeRunShape(writeHistory([1, 1, 1, 1, 1]), { now: T0 + 99 * DAY }),
  ];
  for (const report of cases) {
    const text = [
      ...renderRunShapeDeviationLines(report),
      ...renderRunShapeReportLines(report, "gbrain"),
    ].join("\n");
    for (const pattern of FORBIDDEN) {
      assert.equal(pattern.test(text), false, `"${pattern}" must never appear on this surface:\n${text}`);
    }
  }
});

test("both surfaces state, in words, that a deviation changes no outcome and no exit code", () => {
  const report = computeRunShape(writeHistory([1, 1, 2, 1, 400]));
  assert.ok(renderRunShapeDeviationLines(report).some((l) => /changes no outcome and no exit code/.test(l)));
  assert.ok(renderRunShapeReportLines(report, "gbrain").some((l) => /always exits 0/.test(l)));
});
