// One escalation event moves two counters (`runner.ts:1443` returns
// `{ level: 1, llm: usage, … }` from a single L1 heal), and a near-always-zero
// counter has a window of [0,0,0,0] — median 0, MAD 0 — so the deviation rule
// reports the first time either is ever non-zero. That combination is the
// realistic case, and left alone it prints two lines saying the same thing on
// the surface every user sees by default.
//
// These tests pin the collapse and, more importantly, pin its limits: two
// counters that moved by different amounts are two facts, and a FAILED
// escalation — which moves `escalations` and no heal level — is the whole
// reason both metrics exist and must keep its own line.
//
// A separate file from test/priors-render.test.ts on purpose: that file pins
// the copy law and is required to pass unmodified.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRunShape } from "../src/priors.js";
import { renderRunShapeDeviationLines, renderRunShapeReportLines } from "../src/priors-render.js";
import type { RunRecord, StepRecord, StepOutcome } from "../src/runner.js";

const DAY = 24 * 3_600_000;
const T0 = Date.parse("2026-03-01T00:00:00.000Z");
const WIDTH = 4;

function dayStamp(i: number): string {
  return new Date(T0 + i * DAY).toISOString();
}

interface Spec {
  /** Steps that escalated AND healed at L1 — the runner writes both fields together. */
  healedL1?: number;
  /** Steps that escalated AND healed at L2. */
  healedL2?: number;
  /** Steps that escalated and did NOT heal: an `llm` block, still at level 0. */
  failedEscalations?: number;
}

/**
 * A run of WIDTH steps, all passing, all 0ms, differing only in how many
 * steps escalated and where they landed. Every record is the same width so
 * `steps`, `passed` and the rest cannot move and confuse the assertions.
 */
function record(day: number, spec: Spec = {}): RunRecord {
  const healedL1 = spec.healedL1 ?? 0;
  const healedL2 = spec.healedL2 ?? 0;
  const failed = spec.failedEscalations ?? 0;
  const steps: StepRecord[] = Array.from({ length: WIDTH }, (_, i) => {
    const escalated = i < healedL1 + healedL2 + failed;
    const level: 0 | 1 | 2 = i < healedL1 ? 1 : i < healedL1 + healedL2 ? 2 : 0;
    return {
      n: i + 1,
      title: `step ${i + 1}`,
      level,
      outcome: "passed" as StepOutcome,
      ms: 0,
      failures: [],
      ...(escalated ? { llm: { inputTokens: 1, outputTokens: 1 } } : {}),
    };
  });
  return {
    skill: "fixture",
    startedAt: dayStamp(day),
    finishedAt: dayStamp(day),
    passed: true,
    steps,
    totals: { steps: WIDTH, passed: WIDTH, unchecked: 0, skipped: 0, failed: 0, ms: 0, llmInputTokens: 0, llmOutputTokens: 0 },
  };
}

/** Four clean priors — the realistic all-zero window — then one run that did something. */
function afterCleanHistory(latest: Spec): string[] {
  const records = [record(0), record(1), record(2), record(3), record(4, latest)];
  return renderRunShapeDeviationLines(computeRunShape(records));
}

function marked(lines: string[]): string[] {
  return lines.filter((l) => l.startsWith("  ! "));
}

test("the realistic case: four clean priors, then one step heals at L1 — ONE line, not two", () => {
  // The window is [0,0,0,0] for both counters, so both deviate on the first
  // non-zero value. Before the collapse this printed an `escalations: 1` line
  // and a `healed L1: 1` line describing the same single step.
  const lines = afterCleanHistory({ healedL1: 1 });
  assert.deepEqual(marked(lines), ["  ! escalations: 1, healed L1: 1 (previous 4 runs: median 0, min 0, max 0)"], lines.join("\n"));
});

test("a FAILED escalation keeps its own line — that distinction is why both metrics exist", () => {
  // A step that burned tokens and stayed at L0: `escalations` moves, no heal
  // level does. Collapsing this into a heal line would report a heal that did
  // not happen, so the group never forms and the line stands alone.
  const lines = afterCleanHistory({ failedEscalations: 1 });
  assert.deepEqual(marked(lines), ["  ! escalations: 1 (previous 4 runs: median 0, min 0, max 0)"], lines.join("\n"));
  assert.equal(lines.join("\n").includes("healed"), false, "nothing healed, so nothing may say it did");
});

test("both heal levels moving still collapse, because their movements sum to the escalation's", () => {
  const lines = afterCleanHistory({ healedL1: 2, healedL2: 1 });
  assert.deepEqual(
    marked(lines),
    ["  ! escalations: 3, healed L1: 2, healed L2: 1 (previous 4 runs: median 0, min 0, max 0)"],
    lines.join("\n")
  );
});

test("movements that do NOT sum stay separate — two amounts are two facts", () => {
  // Three steps escalated; one healed at L1 and two did not heal at all.
  // `escalations` moved 3 and `healedL1` moved 1, so the line "escalations: 3,
  // healed L1: 1" would invite reading the 3 as three heals. Two rows.
  const lines = afterCleanHistory({ healedL1: 1, failedEscalations: 2 });
  assert.deepEqual(
    marked(lines),
    [
      "  ! escalations: 3 (previous 4 runs: median 0, min 0, max 0)",
      "  ! healed L1: 1 (previous 4 runs: median 0, min 0, max 0)",
    ],
    lines.join("\n")
  );
});

test("a heal level that deviates while escalations does NOT is untouched by the collapse", () => {
  // Every prior run escalated once and healed at L1; this run escalated once
  // and healed at L2 instead. `escalations` is flat at 1 and does not deviate,
  // so there is no group and both heal rows report as themselves.
  const records = [
    record(0, { healedL1: 1 }),
    record(1, { healedL1: 1 }),
    record(2, { healedL1: 1 }),
    record(3, { healedL1: 1 }),
    record(4, { healedL2: 1 }),
  ];
  assert.deepEqual(
    marked(renderRunShapeDeviationLines(computeRunShape(records))),
    [
      "  ! healed L1: 0 (previous 4 runs: median 1, min 1, max 1)",
      "  ! healed L2: 1 (previous 4 runs: median 0, min 0, max 0)",
    ]
  );
});

test("the standalone report still prints a row per signal — it collapses nothing", () => {
  // `reelier baseline` answers a different question: the whole picture,
  // including what did not move. Hiding a row there would answer a question
  // nobody asked.
  const records = [record(0), record(1), record(2), record(3), record(4, { healedL1: 1 })];
  const lines = renderRunShapeReportLines(computeRunShape(records), "gbrain");
  const text = lines.join("\n");
  assert.ok(text.includes("  ! escalations 1          previous 4 runs: median 0, min 0, max 0"), text);
  assert.ok(text.includes("  ! healed L1   1          previous 4 runs: median 0, min 0, max 0"), text);
  assert.ok(text.includes("    healed L2   0          previous 4 runs: median 0, min 0, max 0"), text);
});

test("the collapsed line is still a difference and never a fault", () => {
  const text = afterCleanHistory({ healedL1: 1 }).join("\n");
  for (const forbidden of [/anomal/i, /unsafe/i, /\bverified\b/i, /went wrong/i, /\bdetected\b/i, /\bfailure\b/i, /\balert/i]) {
    assert.equal(forbidden.test(text), false, `"${forbidden}" must never appear on this surface:\n${text}`);
  }
  assert.match(text, /changes no outcome and no exit code/);
});
