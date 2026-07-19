import { test } from "node:test";
import assert from "node:assert/strict";
import { diffRunRecords } from "../src/diff.js";
import type { RunRecord, StepRecord, StepOutcome } from "../src/runner.js";

function step(n: number, outcome: StepOutcome, level: 0 | 1 | 2 = 0): StepRecord {
  return { n, title: `step ${n}`, level, outcome, ms: 1, failures: [] };
}

function run(skill: string, steps: StepRecord[]): RunRecord {
  const passed = steps.every((s) => s.outcome === "passed");
  return {
    skill,
    startedAt: "2026-07-19T00:00:00.000Z",
    finishedAt: "2026-07-19T00:00:01.000Z",
    passed,
    steps,
    totals: {
      steps: steps.length,
      passed: steps.filter((s) => s.outcome === "passed").length,
      unchecked: steps.filter((s) => s.outcome === "unchecked").length,
      skipped: steps.filter((s) => s.outcome === "skipped").length,
      failed: steps.filter((s) => s.outcome === "failed").length,
      ms: 1,
      llmInputTokens: 0,
      llmOutputTokens: 0,
    },
  };
}

test("identical runs → SAME", () => {
  const base = run("weekly-pull", [step(1, "passed"), step(2, "passed")]);
  const cand = run("weekly-pull", [step(1, "passed"), step(2, "passed")]);
  const d = diffRunRecords(base, cand);
  assert.equal(d.verdict, "same");
  assert.equal(d.drift.length, 0);
  assert.match(d.summary, /^SAME/);
});

test("timing/ms differences alone are NOT drift", () => {
  const base = run("weekly-pull", [step(1, "passed")]);
  const cand = run("weekly-pull", [{ ...step(1, "passed"), ms: 9999 }]);
  assert.equal(diffRunRecords(base, cand).verdict, "same");
});

test("a step outcome changing passed→failed → DRIFTED (hard)", () => {
  const base = run("weekly-pull", [step(1, "passed"), step(2, "passed")]);
  const cand = run("weekly-pull", [step(1, "passed"), step(2, "failed")]);
  const d = diffRunRecords(base, cand);
  assert.equal(d.verdict, "drifted");
  assert.equal(d.hardDrift.length, 1);
  assert.equal(d.hardDrift[0].n, 2);
  assert.equal(d.hardDrift[0].kind, "outcome-changed");
  assert.match(d.hardDrift[0].note, /passed → failed/);
  assert.match(d.summary, /DRIFTED/);
});

test("a removed step → DRIFTED (hard)", () => {
  const base = run("weekly-pull", [step(1, "passed"), step(2, "passed")]);
  const cand = run("weekly-pull", [step(1, "passed")]);
  const d = diffRunRecords(base, cand);
  assert.equal(d.verdict, "drifted");
  assert.equal(d.hardDrift[0].kind, "removed");
});

test("an added step → DRIFTED (hard)", () => {
  const base = run("weekly-pull", [step(1, "passed")]);
  const cand = run("weekly-pull", [step(1, "passed"), step(2, "passed")]);
  const d = diffRunRecords(base, cand);
  assert.equal(d.verdict, "drifted");
  assert.equal(d.hardDrift[0].kind, "added");
});

test("same outcome but a different escalation level → DRIFTED (soft, not hard)", () => {
  const base = run("weekly-pull", [step(1, "passed", 0)]);
  const cand = run("weekly-pull", [step(1, "passed", 1)]);
  const d = diffRunRecords(base, cand);
  assert.equal(d.verdict, "drifted");
  assert.equal(d.hardDrift.length, 0);
  assert.equal(d.softDrift.length, 1);
  assert.equal(d.candidatePassed, true); // it still passed — soft drift only
  assert.match(d.summary, /escalation level/);
});

test("different skills → skill-mismatch, never a silent comparison", () => {
  const d = diffRunRecords(run("a", [step(1, "passed")]), run("b", [step(1, "passed")]));
  assert.equal(d.verdict, "skill-mismatch");
  assert.equal(d.steps.length, 0);
});
