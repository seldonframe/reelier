import type { AuthorityLatencyTraceV1 } from "../host/latency.js";

export interface AuthorityLatencyEvaluationV1 {
  readonly v: "reelier.authority-latency-evaluation/v1";
  readonly baselineStatus: "insufficient-samples" | "measured";
  readonly sampleCount: number;
  readonly minimumSampleCount: number;
  readonly sloStatus: "absent";
  readonly regressionBudgetStatus: "absent";
  readonly percentiles?: Readonly<{ p50Ms: number; p95Ms: number; p99Ms: number }>;
}

/** Evaluates only aggregate traces; it deliberately has no SLO or regression verdict. */
export function evaluateLatencyEvidence(samples: readonly AuthorityLatencyTraceV1[], options: Readonly<{ minimumSampleCount?: number }> = {}): AuthorityLatencyEvaluationV1 {
  if (!Array.isArray(samples)) throw new TypeError("latency samples are required");
  const minimumSampleCount = options.minimumSampleCount ?? 30;
  if (!Number.isSafeInteger(minimumSampleCount) || minimumSampleCount < 1) throw new TypeError("minimum latency sample count is invalid");
  for (const sample of samples) {
    if (!sample || sample.v !== "reelier.authority-latency-trace/v1" || !Number.isFinite(sample.totalMs) || sample.totalMs < 0) throw new TypeError("latency sample is invalid");
  }
  const base = { v: "reelier.authority-latency-evaluation/v1" as const, sampleCount: samples.length, minimumSampleCount, sloStatus: "absent" as const, regressionBudgetStatus: "absent" as const };
  if (samples.length < minimumSampleCount) return Object.freeze({ ...base, baselineStatus: "insufficient-samples" as const });
  const totals = samples.map(sample => sample.totalMs).sort((left, right) => left - right);
  return Object.freeze({ ...base, baselineStatus: "measured" as const, percentiles: Object.freeze({ p50Ms: percentile(totals, 0.5), p95Ms: percentile(totals, 0.95), p99Ms: percentile(totals, 0.99) }) });
}

function percentile(values: readonly number[], fraction: number): number { return values[Math.max(0, Math.ceil(values.length * fraction) - 1)]!; }
