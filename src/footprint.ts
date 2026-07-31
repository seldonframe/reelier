// Run footprint — "what shape did this run have?" A single receipt proves one
// run happened; the footprint is the small set of counts (steps, outcomes,
// writes dispatched, distinct resources touched, escalations, heal levels)
// that let a later run be compared against this one's own recent history.
// It proves *shape changed*, never *something is wrong* — a footprint is not
// a verdict, just a count. Pure + no IO — derivation is recorder-side and
// must never break a run, so `deriveFootprint` is total over the specific
// hazards this module guards against: a missing/non-array `steps`, a
// missing `totals`, partial and pre-0.20.0 records, and a `steps[]` entry
// that is null/undefined/not-an-object (readRunRecords is a bare
// `JSON.parse`, runner.ts:474-484 — `[null]` is valid JSON on disk). Every
// field this module reads off a step (`write`, `llm`, `mocked`) is
// re-checked for shape at the point of use, not just presence, because
// `write` and `llm` are dereferenced. `ms` is recorded on the footprint but
// is deliberately never a comparison input, the same discipline
// `src/diff.ts:10` already holds for timing.

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
 *
 * Moved from `cli.ts`'s private `deriveRecordTotals`, with one deliberate
 * widening: the original returned `r.totals.passed`/`.failed` verbatim on
 * the modern-shape branch (the one keyed on `totals.unchecked !== undefined`),
 * which is `undefined` on a record that HAS `totals` with `unchecked`
 * defined but `passed`/`failed` missing — a shape neither branch of the
 * original guarded against — and fed a `NaN` into `computeBenchSummary`'s
 * accumulator. `?? 0` here closes that gap; every other branch is
 * unchanged.
 */
export function recordTotals(r: RunRecord): { passed: number; unchecked: number; skipped: number; failed: number } {
  const steps: unknown[] = Array.isArray(r?.steps) ? r.steps : [];
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
    // Guard against a hand-edited or corrupted `steps[]` entry that is
    // null/undefined/not-an-object (readRunRecords does a bare JSON.parse —
    // `[null]` is valid JSON on disk, src/priors.ts:231-235 documents the
    // same threat model for the same class of function).
    if (!s || typeof s !== "object") continue;
    const outcome = (s as StepRecord).outcome;
    if (outcome === "passed") passed++;
    else if (outcome === "unchecked") unchecked++;
    else if (outcome === "skipped") skipped++;
    else if (outcome === "failed") failed++;
  }
  return { passed, unchecked, skipped, failed };
}

/**
 * Derive a `RunFootprint` from a `RunRecord`. Total by construction: guards
 * every field before reading it, so a missing `steps`, a non-array `steps`,
 * a `steps[]` entry that is null/undefined/not-an-object, a missing
 * `totals`, or `{}` all yield a footprint of zeroes rather than a throw.
 * `write` and `llm` are DEREFERENCED (`write.resource.id`), not just tested
 * for presence, so both are shape-checked (`typeof x === "object" && x !==
 * null`) before use — a presence-only check would throw on a hand-edited
 * `"write": null`. `mocked` is the literal `true`/absent per `StepRecord`,
 * so it is compared with `=== true`, not presence, so `"mocked": false`
 * cannot be counted as mocked. Never uses a non-null assertion. Called
 * recorder-side on records going back before 0.20.0 — derivation must never
 * be the reason a run breaks.
 *
 * `steps` counts raw array entries, including malformed ones — a corrupted
 * `steps[]` can inflate `steps` even though every other counter on such an
 * entry stays at zero. That is the one counter a corrupted file can move on
 * its own; a comparison should not read a `steps` move alone as "shape
 * changed" without also checking whether any other counter moved.
 */
export function deriveFootprint(record: RunRecord): RunFootprint {
  const rawSteps: unknown[] = Array.isArray(record?.steps) ? record.steps : [];
  const totals = recordTotals(record);

  let writesDispatched = 0;
  const writeResourceIds = new Set<string>();
  let escalations = 0;
  let healL0 = 0;
  let healL1 = 0;
  let healL2 = 0;
  let mocked = 0;

  for (const raw of rawSteps) {
    // Same guard as recordTotals: a hand-edited or corrupted step can be
    // null/undefined/not-an-object even though the array itself is present.
    if (!raw || typeof raw !== "object") continue;
    const s = raw as StepRecord;
    // `write` is dereferenced below (`.resource`), so a presence check
    // alone is not enough -- "write": null passes `!== undefined` and then
    // throws on `.resource`. Require it actually be an object.
    if (typeof s.write === "object" && s.write !== null) {
      writesDispatched++;
      const id = s.write.resource?.id;
      if (typeof id === "string" && id.length > 0) writeResourceIds.add(id);
    }
    // Same reasoning as `write`: `llm` is declared as an object, so a
    // "null"/"false" hand-edit must not count as an escalation.
    if (typeof s.llm === "object" && s.llm !== null) escalations++;
    // Explicit presence check, not a catch-all `else`: an absent, null, or
    // out-of-range `level` is not evidence the step "ran clean at L0" — it
    // is evidence of nothing, and must not be rendered as a pass.
    if (s.level === 0) healL0++;
    else if (s.level === 1) healL1++;
    else if (s.level === 2) healL2++;
    // `mocked` is declared as the literal `true` (never `false`) -- compare
    // to the value, not presence, so a hand-edited "mocked": false/null
    // cannot be counted as mocked.
    if (s.mocked === true) mocked++;
  }

  return {
    skill: typeof record?.skill === "string" ? record.skill : "",
    finishedAt: typeof record?.finishedAt === "string" ? record.finishedAt : "",
    ms: typeof record?.totals?.ms === "number" ? record.totals.ms : 0,
    steps: rawSteps.length,
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
