// Cross-run diff — "did this run the SAME as the baseline?" A single receipt
// proves one run; this compares two run records of the same skill and reports
// where they diverged. It's the drift-detector for a recorded workflow used as
// an "immutable baseline" (record once, replay on a schedule, fail when it
// stops matching). Pure + no IO — the CLI/serve layers read the records.
//
// What counts as drift: a step's OUTCOME changed (passed→failed, etc.), a step
// was added/removed (the workflow's shape moved), OR a step that used to run
// clean now had to escalate to heal (same outcome, different level — the world
// moved underneath). Timing (ms) is never drift. StepRecord carries no bound
// values, so this compares structure + outcomes + healing level, never data —
// which is exactly right: "same steps, fresh data" is NOT drift.

import type { RunRecord, StepRecord, StepOutcome } from "./runner.js";

export type StepDiffKind = "same" | "outcome-changed" | "healed-differently" | "added" | "removed";

export interface StepSide {
  outcome: StepOutcome;
  level: 0 | 1 | 2;
}

export interface StepDiff {
  n: number;
  title: string;
  kind: StepDiffKind;
  baseline?: StepSide;
  candidate?: StepSide;
  note: string;
}

export type RunDiffVerdict = "same" | "drifted" | "skill-mismatch";

export interface RunDiff {
  verdict: RunDiffVerdict;
  skill: string;
  baselinePassed: boolean;
  candidatePassed: boolean;
  steps: StepDiff[];
  /** Every non-"same" step. */
  drift: StepDiff[];
  /** Outcome/structure changes — the run did something different. */
  hardDrift: StepDiff[];
  /** Same outcome, but reached via a different escalation level — the world moved underneath. */
  softDrift: StepDiff[];
  summary: string;
}

function side(s: StepRecord): StepSide {
  return { outcome: s.outcome, level: s.level };
}

/**
 * Compare a candidate run against a baseline run of the same skill. Steps are
 * aligned by step number `n`. Verdict is "same" only when every step is
 * byte-for-byte identical in outcome AND escalation level; any divergence is
 * "drifted" (with hard vs. soft split so a strict CI gate and a lenient one
 * can both read it). "skill-mismatch" when the two records aren't the same
 * skill (never silently compares apples to oranges).
 */
export function diffRunRecords(baseline: RunRecord, candidate: RunRecord): RunDiff {
  if (baseline.skill !== candidate.skill) {
    return {
      verdict: "skill-mismatch",
      skill: candidate.skill,
      baselinePassed: baseline.passed,
      candidatePassed: candidate.passed,
      steps: [],
      drift: [],
      hardDrift: [],
      softDrift: [],
      summary: `Not comparable: baseline is "${baseline.skill}", candidate is "${candidate.skill}".`,
    };
  }

  const b = new Map(baseline.steps.map((s) => [s.n, s]));
  const c = new Map(candidate.steps.map((s) => [s.n, s]));
  const allN = Array.from(new Set([...b.keys(), ...c.keys()])).sort((x, y) => x - y);

  const steps: StepDiff[] = allN.map((n) => {
    const bs = b.get(n);
    const cs = c.get(n);
    if (bs && !cs) {
      return { n, title: bs.title, kind: "removed", baseline: side(bs), note: `Step ${n} "${bs.title}" is gone in the candidate run.` };
    }
    if (!bs && cs) {
      return { n, title: cs.title, kind: "added", candidate: side(cs), note: `Step ${n} "${cs.title}" is new in the candidate run.` };
    }
    // both present
    const base = side(bs!);
    const cand = side(cs!);
    if (bs!.outcome !== cs!.outcome) {
      const trigger = cs!.why?.trigger ? ` — ${cs!.why.trigger}` : "";
      return { n, title: cs!.title, kind: "outcome-changed", baseline: base, candidate: cand, note: `Step ${n} "${cs!.title}": ${bs!.outcome} → ${cs!.outcome}${trigger}.` };
    }
    if (bs!.level !== cs!.level) {
      return { n, title: cs!.title, kind: "healed-differently", baseline: base, candidate: cand, note: `Step ${n} "${cs!.title}": still ${cs!.outcome}, but healed at L${cs!.level} (baseline was L${bs!.level}).` };
    }
    return { n, title: cs!.title, kind: "same", baseline: base, candidate: cand, note: `Step ${n} "${cs!.title}": ${cs!.outcome}, unchanged.` };
  });

  const drift = steps.filter((s) => s.kind !== "same");
  const hardDrift = steps.filter((s) => s.kind === "outcome-changed" || s.kind === "added" || s.kind === "removed");
  const softDrift = steps.filter((s) => s.kind === "healed-differently");
  const verdict: RunDiffVerdict = drift.length > 0 ? "drifted" : "same";

  let summary: string;
  if (verdict === "same") {
    summary = `SAME — ${steps.length} step(s), every outcome and escalation level identical to the baseline.`;
  } else {
    const parts: string[] = [];
    if (hardDrift.length) parts.push(`${hardDrift.length} outcome/structure change(s): ${hardDrift.map((s) => `#${s.n} ${s.kind}`).join(", ")}`);
    if (softDrift.length) parts.push(`${softDrift.length} step(s) needed a different escalation level (same outcome)`);
    summary = `DRIFTED — ${parts.join("; ")}.`;
  }

  return { verdict, skill: candidate.skill, baselinePassed: baseline.passed, candidatePassed: candidate.passed, steps, drift, hardDrift, softDrift, summary };
}
