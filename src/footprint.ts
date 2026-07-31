// Run footprint — "what shape did this run have?" A single receipt proves one
// run happened; the footprint is the small set of counts (steps, outcomes,
// writes dispatched, distinct resources touched, escalations, heal levels)
// that let a later run be compared against this one's own recent history.
// It proves *shape changed*, never *something is wrong* — a footprint is not
// a verdict, just a count. Pure + no IO — derivation is recorder-side and
// must never break a run, so `deriveFootprint` is total over every record
// shape this codebase has ever written, including partial and pre-0.20.0
// ones. `ms` is recorded on the footprint but is deliberately never a
// comparison input, the same discipline `src/diff.ts:10` already holds for
// timing.

import type { RunRecord, StepRecord } from "./runner.js";

export interface RunFootprint {
  skill: string;
  finishedAt: string;
  ms: number;
  steps: number;
  passed: number;
  failed: number;
  unchecked: number;
  skipped: number;
  writesDispatched: number;
  distinctWriteResources: number;
  escalations: number;
  healL0: number;
  healL1: number;
  healL2: number;
  mocked: number;
  manifestIgnored: boolean;
}

/**
 * Per-record totals, honest across a mixed history: a record written before
 * 0.2.0 has no `totals.unchecked`/`totals.skipped` field (and its old
 * `totals.passed` counted "passed" OR "unchecked" together) — for those,
 * derive the split from the per-step outcomes instead, which were always
 * recorded correctly even when the rollup that summed them wasn't. Shared
 * between the CLI's bench summary and `deriveFootprint`, so this rule lives
 * in exactly one place.
 */
export function recordTotals(r: RunRecord): { passed: number; unchecked: number; skipped: number; failed: number } {
  const steps = Array.isArray(r?.steps) ? r.steps : [];
  const totals = r?.totals;
  if (totals && typeof totals === "object" && totals.unchecked !== undefined) {
    return {
      passed: totals.passed ?? 0,
      unchecked: totals.unchecked,
      skipped: totals.skipped ?? 0,
      failed: totals.failed ?? 0,
    };
  }
  let passed = 0;
  let unchecked = 0;
  let skipped = 0;
  let failed = 0;
  for (const s of steps) {
    if (s.outcome === "passed") passed++;
    else if (s.outcome === "unchecked") unchecked++;
    else if (s.outcome === "skipped") skipped++;
    else if (s.outcome === "failed") failed++;
  }
  return { passed, unchecked, skipped, failed };
}

/**
 * Derive a `RunFootprint` from a `RunRecord`. Total by construction: guards
 * every field before reading it, so a missing `steps`, a non-array `steps`,
 * a missing `totals`, or `{}` all yield a footprint of zeroes rather than a
 * throw. Never uses a non-null assertion. Called recorder-side on records
 * going back before 0.20.0 — derivation must never be the reason a run
 * breaks.
 */
export function deriveFootprint(record: RunRecord): RunFootprint {
  const steps: StepRecord[] = Array.isArray(record?.steps) ? record.steps : [];
  const totals = recordTotals(record);

  let writesDispatched = 0;
  const writeResourceIds = new Set<string>();
  let escalations = 0;
  let healL0 = 0;
  let healL1 = 0;
  let healL2 = 0;
  let mocked = 0;

  for (const s of steps) {
    if (s.write) {
      writesDispatched++;
      const id = s.write.resource?.id;
      if (typeof id === "string" && id.length > 0) writeResourceIds.add(id);
    }
    if (s.llm) escalations++;
    if (s.level === 1) healL1++;
    else if (s.level === 2) healL2++;
    else healL0++;
    if (s.mocked) mocked++;
  }

  return {
    skill: record?.skill ?? "",
    finishedAt: record?.finishedAt ?? "",
    ms: record?.totals?.ms ?? 0,
    steps: steps.length,
    passed: totals.passed,
    failed: totals.failed,
    unchecked: totals.unchecked,
    skipped: totals.skipped,
    writesDispatched,
    distinctWriteResources: writeResourceIds.size,
    escalations,
    healL0,
    healL1,
    healL2,
    mocked,
    manifestIgnored: record?.manifestIgnored === true,
  };
}
