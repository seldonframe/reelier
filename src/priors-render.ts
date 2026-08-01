// Pure CLI-text formatter for a RunShapeReport (src/priors.ts). Sibling of
// attest-render.ts and under the same law: these strings are stable API, and
// what they are forbidden from saying matters more than what they say.
//
// The copy law, test-pinned in test/priors-render.test.ts: a deviation is a
// DIFFERENCE from this skill's own history. Never a cause, never a fault,
// never a verdict. "anomaly", "unsafe", "verified", "suspicious",
// "detected", "went wrong", "PASSED"/"FAILED" are all forbidden here — the
// operator reading this line will decide what it means, and this surface
// must not decide for them. Both surfaces say in words that nothing here
// moves an outcome or an exit code, because someone will eventually try to
// wire it into one.
import { DEVIATION_MADS, type MetricBaseline, type RunShapeMetric, type RunShapeReport, type RunShapeSignal } from "./priors.js";

/**
 * What a metric is CALLED in front of an operator, where that differs from
 * what it is called in the type. Only the differences are listed; a metric
 * whose identifier already reads as English is rendered verbatim.
 *
 * Two constraints on anything added here. It must fit the twelve-column row
 * below — a label that overflows silently breaks the alignment of every row
 * around it — and it must name a count, never characterise it: "resources"
 * and "healed L2" describe what was counted, which is all this surface is
 * allowed to say.
 */
const METRIC_LABELS: Partial<Record<RunShapeMetric, string>> = {
  // Sits directly under `writes`, which is what makes the short form
  // unambiguous: these are the distinct resources those writes landed on.
  writeResources: "resources",
  // "healed L1" is the phrasing `reelier run` already prints against a step
  // that escalated (cli.ts:453), so the two surfaces agree.
  healedL1: "healed L1",
  healedL2: "healed L2",
};

function label(metric: RunShapeMetric): string {
  return METRIC_LABELS[metric] ?? metric;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Human elapsed time. Sub-second stays exact (a run duration is often tens
 * of ms and rounding it to "0s" would erase the measurement), sub-minute
 * keeps a tenth, and anything longer collapses to its two most significant
 * units — a silence of nine days does not need its seconds.
 *
 * A negative elapsed is printed verbatim. Nothing in this module should
 * produce one (backwards gaps are dropped upstream, never clamped), and if
 * one ever arrives it must look wrong rather than look fine.
 */
export function fmtElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return `${ms}ms`;
  const t = Math.round(ms);
  if (t < SECOND) return `${t}ms`;
  if (t < MINUTE) return `${(t / SECOND).toFixed(1)}s`;
  const d = Math.floor(t / DAY);
  const h = Math.floor(t / HOUR) % 24;
  const m = Math.floor(t / MINUTE) % 60;
  const s = Math.floor(t / SECOND) % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtValue(value: number, unit: RunShapeSignal["unit"]): string {
  return unit === "ms" ? fmtElapsed(value) : String(value);
}

/** "previous 4 runs: median 1, min 1, max 2" — the sample, never a threshold. */
function baselineText(signal: RunShapeSignal): string {
  const { baseline, unit, sample } = signal;
  return (
    `previous ${baseline.n} ${sample}: median ${fmtValue(baseline.median, unit)}, ` +
    `min ${fmtValue(baseline.min, unit)}, max ${fmtValue(baseline.max, unit)}`
  );
}

/**
 * One escalation event moves two counters. `runner.ts:1443` returns
 * `{ level: 1, llm: usage, … }` from a single L1 heal, so `escalations` and
 * `healedL1` both go up by one — and because a near-always-zero counter has
 * a window of `[0,0,0,0]`, median 0 and MAD 0, the deviation rule reports the
 * FIRST time either is ever non-zero. Left alone, one step escalating prints
 * two lines saying the same thing on the surface every user sees by default,
 * and this module's own law is that noise here is worse than silence.
 *
 * So they collapse into one line — but only when the line is exactly true of
 * every counter in it. Three conditions, all required:
 *
 *  - `escalations` and at least one heal level both deviated;
 *  - the heal levels' movements SUM to the escalation movement, each measured
 *    against its own median, and every movement points the same way. Two
 *    counters that moved by different amounts moved for different reasons and
 *    are two facts, not one;
 *  - all of them were computed over an identical baseline window, so the
 *    single `previous N runs: …` clause the collapsed line prints is the real
 *    baseline of each counter named in it and not just of the first.
 *
 * Anything else prints separate rows. A FAILED escalation is the case that
 * makes keeping both metrics necessary: it moves `escalations` and no heal
 * level at all, so it fails the first condition and reports on its own —
 * which is the whole distinction the two metrics exist to carry.
 *
 * Only the exception surface collapses. `reelier baseline` prints a row per
 * signal by contract (it is the WHOLE picture, including what did not move),
 * so hiding a row there would answer a different question than the one asked.
 */
function sameWindow(a: MetricBaseline, b: MetricBaseline): boolean {
  return a.median === b.median && a.mad === b.mad && a.min === b.min && a.max === b.max && a.n === b.n;
}

function collapsibleEscalationGroup(deviating: readonly RunShapeSignal[]): RunShapeSignal[] | null {
  const escalations = deviating.find((s) => s.metric === "escalations");
  if (!escalations) return null;
  const heals = deviating.filter((s) => s.metric === "healedL1" || s.metric === "healedL2");
  if (heals.length === 0) return null;
  if (!heals.every((h) => sameWindow(h.baseline, escalations.baseline))) return null;
  const moved = (s: RunShapeSignal): number => s.latest - s.baseline.median;
  const escalationMove = moved(escalations);
  if (escalationMove === 0) return null;
  if (heals.reduce((sum, h) => sum + moved(h), 0) !== escalationMove) return null;
  if (!heals.every((h) => Math.sign(moved(h)) === Math.sign(escalationMove))) return null;
  // `signals` is built in RUN_METRICS order, so `escalations` precedes both
  // heal levels and this array is already in reading order.
  return [escalations, ...heals];
}

/** "escalations: 1, healed L1: 1" — every counter named, every value its own. */
function collapsedText(group: readonly RunShapeSignal[]): string {
  return group.map((s) => `${label(s.metric)}: ${fmtValue(s.latest, s.unit)}`).join(", ");
}

/**
 * The skill-file note, rendered ONLY when both records carried a
 * `skillContentSha256` and they differ. `undefined` (unknown) renders
 * nothing: a shape difference that is really the operator's own edit reads
 * very differently from one that is not, and claiming either without
 * evidence would be the same mistake in opposite directions.
 */
function skillChangedNote(report: RunShapeReport): string[] {
  return report.kind === "baseline" && report.skillChanged === true
    ? ["  note: the skill file changed since the previous run — a shape difference may simply be the new skill."]
    : [];
}

/**
 * Named, never implied: when the newest record in the file was excluded, the
 * run being reported on is NOT the last run that happened, and an operator
 * reading "latest run: <stamp>" has no way to know that from the stamp alone.
 * Mirrors the no-runs copy, which already says why a mock run is not a
 * receipt.
 */
function excludedNewestNote(report: RunShapeReport): string[] {
  return report.kind !== "no-runs" && !report.subjectIsNewestRecord
    ? [
        "  note: the newest record in this file is NOT the run above — 'reelier run --fail N' mock runs are excluded (a mock run is a local recovery test, not a receipt).",
      ]
    : [];
}

/**
 * The `reelier run` surface: an EXCEPTION report. Returns no lines at all
 * unless the latest run actually departed from the baseline — which is what
 * makes the zero-touch guarantee hold (docs/specs/run-shape-priors.md §7):
 * no history, too little history, or a run that matches its own history all
 * leave the run's output exactly as it was before this shipped.
 *
 * And nothing at all when the subject is not the newest record on disk. This
 * surface's entire claim is the words "this run": after `reelier run --fail
 * N`, the mock run that just happened is excluded from being the subject, so
 * the report describes an EARLIER run and its numbers belong to that run.
 * Printing them here would attribute a departure to a run that did not make
 * it. There is nothing honest to say instead — the run that just happened has
 * no baseline of its own — so the surface stays silent and `reelier baseline`
 * carries the whole picture, exclusion named.
 */
export function renderRunShapeDeviationLines(report: RunShapeReport): string[] {
  if (report.kind !== "baseline") return [];
  if (!report.subjectIsNewestRecord) return [];
  const deviating = report.signals.filter((s) => s.deviates);
  if (deviating.length === 0) return [];
  const group = collapsibleEscalationGroup(deviating);
  const lines: string[] = [];
  for (const s of deviating) {
    if (group?.includes(s)) {
      // Rendered once, at the position of the first counter in the group.
      if (s === group[0]) lines.push(`  ! ${collapsedText(group)} (${baselineText(s)})`);
      continue;
    }
    lines.push(`  ! ${label(s.metric)}: ${fmtValue(s.latest, s.unit)} (${baselineText(s)})`);
  }
  return [
    `Run shape — this run vs this skill's own previous ${report.priorRuns} runs:`,
    ...lines,
    ...skillChangedNote(report),
    "  A deviation is a difference from this skill's own history — not a fault, not a verdict. It changes no outcome and no exit code.",
  ];
}

/**
 * The `reelier baseline` surface: the WHOLE picture, including the signals
 * that did not move and including the honest "not enough history yet". A
 * cron reading only exceptions cannot tell "nothing departed" from "this
 * never ran"; this one can.
 */
export function renderRunShapeReportLines(report: RunShapeReport, skillName: string): string[] {
  const head = `Run shape: ${skillName}`;
  if (report.kind === "no-runs") {
    return [
      head,
      "  No comparable runs recorded. ('reelier run --fail N' mock runs are excluded — a mock run is a local recovery test, not a receipt.)",
    ];
  }
  if (report.kind === "insufficient-history") {
    return [
      head,
      `  latest run: ${report.latestStartedAt}`,
      ...excludedNewestNote(report),
      `  Not enough history for a baseline: ${report.priorRuns} prior run(s), ${report.required} required. No baseline computed.`,
    ];
  }
  // The legend has to describe the rows an operator can actually see. Every
  // row is two-sided EXCEPT silence, which is marked on the high side only
  // (priors.ts: it is counted to now, so between runs it passes through every
  // value from 0 upward) — so an hour of silence against a daily cadence sits
  // below everything the previous gaps did and is deliberately unmarked. A
  // legend that stopped at "outside everything the previous runs did" would
  // be stating a rule that visible row does not follow.
  const showsSilence = report.signals.some((s) => s.metric === "silence");
  return [
    head,
    `  latest run: ${report.latestStartedAt}`,
    ...excludedNewestNote(report),
    `  baseline:   this skill's own previous ${report.priorRuns} runs`,
    "",
    ...report.signals.map(
      (s) =>
        `${s.deviates ? "  ! " : "    "}${label(s.metric).padEnd(12)}${fmtValue(s.latest, s.unit).padEnd(11)}${baselineText(s)}`
    ),
    "",
    // The excluded-record clause is attached HERE, not only to the note at
    // the top, because this is the row where the omission could mislead:
    // silence is counted from the run above, so with a newer record on disk
    // "7d" must not be read as "this machine has been quiet for a week".
    ...(showsSilence
      ? [
          `  silence = time since the latest run started.${
            report.subjectIsNewestRecord ? "" : " The excluded newest record is not counted in it."
          }`,
        ]
      : []),
    ...skillChangedNote(report),
    `  ! = outside everything the previous runs did, by more than ${DEVIATION_MADS} median-absolute-deviations${
      showsSilence
        ? " — except silence, which is marked on the high side only: it is still running, so it passes through every value from 0 upward"
        : ""
    }.`,
    "  A deviation is a difference, not a fault. This command executed nothing and checked nothing, and always exits 0.",
  ];
}
