// Local run-shape priors (F5) — a baseline computed from a skill's OWN
// previous runs, already sitting on the operator's disk at
// .reelier/runs/<skill>.jsonl, and the difference between the latest run and
// that baseline. Spec: docs/specs/run-shape-priors.md.
//
// WHAT THIS IS ALLOWED TO SAY. A deviation, and only a deviation: "this run
// dispatched 400 writes; the previous 4 dispatched between 1 and 2". Never a
// cause, never a verdict. This module and its renderer must never emit
// "anomaly", "unsafe", "verified", "something went wrong", or any word that
// converts a difference into a fault (the ban is pinned in
// test/priors-render.test.ts). A run that departs from its own history has
// departed from its own history; that is the entire claim.
//
// WHAT IT MUST NEVER DO. Change an outcome, an exit code, or any check or
// gate predicate. This is a recorder (never-list #5), and a prior computed
// from history is not evidence about the run in front of you.
//
// SCOPE. n=1: one tenant, one skill, one disk. No network, no transmission,
// no cross-skill or cross-tenant comparison, and no authoring cost — the
// operator declares nothing and the run-shape signals exist the moment there
// are four runs (`gap` and `silence`, computed over the intervals BETWEEN
// runs, need five).
import type { RunRecord, StepRecord } from "./runner.js";

/**
 * Prior runs required before ANY baseline is computed.
 *
 * Three, because it is the smallest sample where the median is an OBSERVED
 * value rather than an interpolation, and where one outlier cannot take the
 * center with it: at n=3 the median is the middle order statistic and
 * survives one arbitrary corruption. At n=2 the "median" is the midpoint of
 * the two, so a single bad run drags the baseline halfway to itself and the
 * MAD is merely half the gap between them — both statistics are *defined*
 * and neither *means* anything. Below three we say exactly that
 * (`insufficient-history`) rather than invent a baseline from one sample.
 */
export const MIN_PRIOR_RUNS = 3;

/**
 * How many of the most recent prior runs the baseline is computed over.
 *
 * Bounded, because a baseline over the file's whole life answers the wrong
 * question: a skill that legitimately changed shape 200 runs ago must not
 * hold its own present hostage. Twenty is large enough that the MAD has
 * something to work with and small enough that a regime change washes out of
 * the window within a few weeks of daily runs.
 */
export const MAX_BASELINE_RUNS = 20;

/**
 * How far outside the prior window a value must land before it is reported.
 * Deliberately conservative: this surface speaks rarely or it becomes noise
 * the operator learns to ignore, and an ignored line is strictly worse than
 * no line at all.
 */
export const DEVIATION_MADS = 3;

export interface MetricBaseline {
  /** Robust center of the prior window. */
  median: number;
  /** Median absolute deviation about `median`. 0 when the window is constant — which for integer counts is the common case, not the edge one. */
  mad: number;
  min: number;
  max: number;
  /** Sample size the three figures above were computed from. */
  n: number;
}

export type RunShapeMetric =
  | "steps"
  | "passed"
  | "unchecked"
  | "skipped"
  | "failed"
  | "writes"
  | "duration"
  | "gap"
  | "silence";

export interface RunShapeSignal {
  metric: RunShapeMetric;
  /** How the renderer should format `latest` and the baseline figures. */
  unit: "count" | "ms";
  /** What the baseline was computed over — prior RUNS, or the GAPS between them. */
  sample: "runs" | "gaps";
  latest: number;
  baseline: MetricBaseline;
  /** See `deviatesFromBaseline`. A difference from this skill's own history — never a fault. */
  deviates: boolean;
}

/**
 * Whether the run this report is ABOUT is the newest record in the file it
 * was computed from.
 *
 * It is not always: `--fail N` mock runs are excluded from the sample and
 * from being the subject (§4), so a mock run appended after a real one leaves
 * the subject one record back from the end of the file. Every caller that
 * says or implies "this run" — the `reelier run` surface's entire claim — has
 * to know that, and it must be a fact the report carries rather than one each
 * caller re-derives from the raw records: the caller that forgets prints an
 * older run's numbers under this run's headline.
 */
type SubjectPosition = {
  /** False when the newest record on disk was excluded, so the subject is an EARLIER run than the last one recorded. */
  subjectIsNewestRecord: boolean;
};

export type RunShapeReport =
  | { kind: "no-runs" }
  | ({ kind: "insufficient-history"; latestStartedAt: string; priorRuns: number; required: number } & SubjectPosition)
  | ({
      kind: "baseline";
      latestStartedAt: string;
      priorRuns: number;
      signals: RunShapeSignal[];
      /**
       * Three-valued, deliberately: `undefined` means at least one of the two
       * records carries no `skillContentSha256` (an optional field), so this
       * is UNKNOWN. Never render unknown as "unchanged" — never-list #1.
       */
      skillChanged: boolean | undefined;
    } & SubjectPosition);

export interface RunShapeOptions {
  /**
   * The instant the report is being read, epoch ms. Supplying it adds the
   * `silence` signal (time since the latest run started). `reelier run`
   * supplies nothing: at the end of a run there is no silence to measure.
   */
  now?: number;
}

// ---------------------------------------------------------------------------
// The robust statistics
// ---------------------------------------------------------------------------

/** Middle order statistic (odd n) or the midpoint of the middle two (even n). Throws on an empty sample rather than return NaN. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median: empty sample");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * median(|x - median(x)|). The spread measure this module uses instead of a
 * standard deviation, for the same reason it uses a median instead of a
 * mean: with four or five samples a single 400-write run destroys both, and
 * the baseline then hides exactly the next event it exists to surface.
 */
export function medianAbsoluteDeviation(values: readonly number[]): number {
  if (values.length === 0) throw new Error("medianAbsoluteDeviation: empty sample");
  const center = median(values);
  return median(values.map((v) => Math.abs(v - center)));
}

function baselineOf(values: readonly number[]): MetricBaseline {
  return {
    median: median(values),
    mad: medianAbsoluteDeviation(values),
    min: Math.min(...values),
    max: Math.max(...values),
    n: values.length,
  };
}

/**
 * THE DEVIATION RULE, stated once: a value deviates iff it lands MORE THAN
 * `DEVIATION_MADS` median-absolute-deviations OUTSIDE the closed range the
 * prior window actually spanned.
 *
 * Two properties this shape buys that a bare |x − median| > k·MAD test loses
 * on samples this small:
 *
 *  - It cannot flag a value the skill has already produced. Window
 *    [1,1,1,2,2] has median 1 and MAD 0, so the bare test calls a run with 2
 *    writes a departure — while two of the last five runs dispatched exactly
 *    2. Noise on this surface is worse than silence.
 *  - It degrades honestly when MAD is 0. The threshold becomes 0 and the
 *    rule reduces to "outside everything the previous runs did", which is
 *    exactly the honest claim available when every prior run agreed.
 *
 * The median is not decoration here: MAD is defined about it, so the center
 * sets the scale even though the range sets the position.
 *
 * `direction` is "both" for every completed measurement — a write count that
 * collapsed to 0 is as reportable as one that spiked to 400. It is "high"
 * only for `silence`, which is not a completed measurement at all: it is
 * counted from the latest run to right now, so between runs it necessarily
 * passes through every value from 0 upward. A two-sided test would report
 * "silence 1h against a daily cadence" every time an operator looked shortly
 * after a run — which is the clock, not a departure. Only the high side of
 * silence carries information.
 */
export function deviatesFromBaseline(
  latest: number,
  baseline: MetricBaseline,
  direction: "both" | "high" = "both"
): boolean {
  const above = latest > baseline.max ? latest - baseline.max : 0;
  const below = direction === "high" || latest >= baseline.min ? 0 : baseline.min - latest;
  return Math.max(above, below) > DEVIATION_MADS * baseline.mad;
}

// ---------------------------------------------------------------------------
// Deriving one run's shape from a run record
// ---------------------------------------------------------------------------

interface RunShape {
  steps: number;
  passed: number;
  unchecked: number;
  skipped: number;
  failed: number;
  writes: number;
  duration: number;
}

/**
 * Every count comes from `steps[]`, never from `totals`, for the reason
 * already documented at `recordTotals` in footprint.ts: the per-step
 * outcomes were always recorded correctly even in the versions whose
 * rollup that summed them was not.
 *
 * NOTE — there is deliberately no "distinct tools touched" signal:
 * `StepRecord` carries no tool name (see docs/specs/run-shape-priors.md
 * §2.1). Inferring one from the skill file as it stands today, or from step
 * titles, would be a claim about prior runs that nothing observed.
 *
 * The guards are not paranoia: this function is fed by JSON.parse over a
 * file a human can edit. A malformed record must degrade to a zero-shaped
 * run, never propagate NaN into a median and never throw — the report is
 * advisory and must never be the thing that breaks a run that has already
 * happened.
 */
function shapeOf(record: RunRecord): RunShape {
  const steps: StepRecord[] = Array.isArray(record.steps) ? record.steps : [];
  const shape: RunShape = { steps: steps.length, passed: 0, unchecked: 0, skipped: 0, failed: 0, writes: 0, duration: 0 };
  for (const step of steps) {
    if (step.outcome === "passed") shape.passed++;
    else if (step.outcome === "unchecked") shape.unchecked++;
    else if (step.outcome === "skipped") shape.skipped++;
    else if (step.outcome === "failed") shape.failed++;
    // `write` is present iff a write-effect step actually dispatched its
    // tool call — a refused or mocked step never gets one (runner.ts).
    if (step.write !== undefined) shape.writes++;
    if (typeof step.ms === "number" && Number.isFinite(step.ms)) shape.duration += step.ms;
  }
  return shape;
}

/** Epoch ms of a record's start, or undefined when the stamp is unparseable. */
function startedMs(record: RunRecord): number | undefined {
  const t = Date.parse(record.startedAt);
  return Number.isNaN(t) ? undefined : t;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const RUN_METRICS: ReadonlyArray<{ metric: RunShapeMetric; of: keyof RunShape; unit: "count" | "ms" }> = [
  { metric: "steps", of: "steps", unit: "count" },
  { metric: "passed", of: "passed", unit: "count" },
  { metric: "unchecked", of: "unchecked", unit: "count" },
  { metric: "skipped", of: "skipped", unit: "count" },
  { metric: "failed", of: "failed", unit: "count" },
  { metric: "writes", of: "writes", unit: "count" },
  { metric: "duration", of: "duration", unit: "ms" },
];

/**
 * Baseline the latest run in `records` against the ones before it.
 *
 * `records` is the skill's own run-record file in append order (what
 * `readRunRecords` returns) — oldest first, newest last.
 */
export function computeRunShape(records: readonly RunRecord[], options: RunShapeOptions = {}): RunShapeReport {
  // A `--fail N` run is a synthetic local recovery test, not a receipt —
  // `reelier push` already refuses to push one. It is neither a baseline
  // sample nor a subject: including it would poison the outcome counts with
  // failures nobody observed.
  const usable = records.filter((r) => !Array.isArray(r.mockFailures) || r.mockFailures.length === 0);
  if (usable.length === 0) return { kind: "no-runs" };

  const latest = usable[usable.length - 1];
  // The subject is the newest USABLE record, which is not the same thing as
  // the newest record: when a mock run was appended after it, the run this
  // report describes is NOT the last run that happened. See SubjectPosition —
  // the fact travels with the report because "this run" is a claim only the
  // caller can make, and only when this is true.
  const subjectIsNewestRecord = latest === records[records.length - 1];
  const priors = usable.slice(0, -1).slice(-MAX_BASELINE_RUNS);
  if (priors.length < MIN_PRIOR_RUNS) {
    return {
      kind: "insufficient-history",
      latestStartedAt: latest.startedAt,
      priorRuns: priors.length,
      required: MIN_PRIOR_RUNS,
      subjectIsNewestRecord,
    };
  }

  const latestShape = shapeOf(latest);
  const priorShapes = priors.map(shapeOf);
  const signals: RunShapeSignal[] = RUN_METRICS.map(({ metric, of, unit }) => {
    const baseline = baselineOf(priorShapes.map((s) => s[of]));
    return { metric, unit, sample: "runs" as const, latest: latestShape[of], baseline, deviates: deviatesFromBaseline(latestShape[of], baseline) };
  });

  // Gaps: consecutive start-to-start intervals among the prior window. A gap
  // whose endpoints are unparseable or non-monotonic is DROPPED, never
  // clamped — same discipline as attest-render.ts's measuredWindowMs: the
  // figure is omitted rather than invented. `MIN_PRIOR_RUNS` gaps therefore
  // needs one more prior run than the run-shape signals do, so a four-run
  // history has no gap signal at all and says nothing rather than baselining
  // on two samples.
  const priorGaps: number[] = [];
  for (let i = 1; i < priors.length; i++) {
    const a = startedMs(priors[i - 1]);
    const b = startedMs(priors[i]);
    if (a !== undefined && b !== undefined && b - a >= 0) priorGaps.push(b - a);
  }
  if (priorGaps.length >= MIN_PRIOR_RUNS) {
    const baseline = baselineOf(priorGaps);
    const latestStart = startedMs(latest);
    const prevStart = startedMs(priors[priors.length - 1]);
    if (latestStart !== undefined && prevStart !== undefined && latestStart - prevStart >= 0) {
      const gap = latestStart - prevStart;
      signals.push({ metric: "gap", unit: "ms", sample: "gaps", latest: gap, baseline, deviates: deviatesFromBaseline(gap, baseline) });
    }
    if (options.now !== undefined && latestStart !== undefined && options.now - latestStart >= 0) {
      const silence = options.now - latestStart;
      signals.push({
        metric: "silence",
        unit: "ms",
        sample: "gaps",
        latest: silence,
        baseline,
        deviates: deviatesFromBaseline(silence, baseline, "high"),
      });
    }
  }

  // Three-valued: a record with no `skillContentSha256` makes this UNKNOWN,
  // which is not the same fact as "unchanged" and is never rendered as one.
  const latestSha = latest.skillContentSha256;
  const priorSha = priors[priors.length - 1].skillContentSha256;
  const skillChanged = latestSha === undefined || priorSha === undefined ? undefined : latestSha !== priorSha;

  return {
    kind: "baseline",
    latestStartedAt: latest.startedAt,
    priorRuns: priors.length,
    signals,
    skillChanged,
    subjectIsNewestRecord,
  };
}
