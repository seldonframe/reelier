import type { AuthorityLatencyEvaluationV1 } from "./evaluation.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const HARDWARE_CLASSES = new Set(["hermetic-test", "local-hermetic-injected-clock", "github-actions-linux-hermetic", "github-actions-windows-offline"]);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function closed(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) throw new TypeError(`${label} is not closed`);
  return value;
}

export interface FactoryReleaseEvidenceV1 {
  readonly v: "reelier.factory-release-evidence/v1";
  readonly tarballDigest: string;
  readonly commit: string;
  readonly runner: Readonly<{ os: "linux" | "windows"; nodeVersion: string; hardwareClass: string }>;
  readonly liveProviderStatus: "absent";
  readonly namedHostConformance: "unchecked";
  readonly latency: AuthorityLatencyEvaluationV1;
}

/** Closed offline evidence. It validates a supplied digest and never executes a provider operation. */
export function createFactoryReleaseEvidence(value: FactoryReleaseEvidenceV1): FactoryReleaseEvidenceV1 {
  const raw = closed(value, ["v", "tarballDigest", "commit", "runner", "liveProviderStatus", "namedHostConformance", "latency"], "factory release evidence");
  if (raw.v !== "reelier.factory-release-evidence/v1" || typeof raw.tarballDigest !== "string" || !DIGEST.test(raw.tarballDigest) || typeof raw.commit !== "string" || !/^[0-9a-f]{7,64}$/i.test(raw.commit)) throw new TypeError("factory release evidence is invalid");
  const runner = closed(raw.runner, ["os", "nodeVersion", "hardwareClass"], "factory runner");
  if ((runner.os !== "linux" && runner.os !== "windows") || typeof runner.nodeVersion !== "string" || !/^v(?:20|22|24)\.\d+\.\d+$/.test(runner.nodeVersion) || typeof runner.hardwareClass !== "string" || !HARDWARE_CLASSES.has(runner.hardwareClass) || raw.liveProviderStatus !== "absent" || raw.namedHostConformance !== "unchecked") throw new TypeError("factory release evidence runner claims are invalid");
  const latency = parseLatency(raw.latency);
  return Object.freeze({ v: raw.v, tarballDigest: raw.tarballDigest, commit: raw.commit, runner: Object.freeze({ os: runner.os, nodeVersion: runner.nodeVersion, hardwareClass: runner.hardwareClass }), liveProviderStatus: "absent", namedHostConformance: "unchecked", latency });
}

function parseLatency(value: unknown): AuthorityLatencyEvaluationV1 {
  const raw = isRecord(value) ? value : undefined;
  if (!raw) throw new TypeError("factory latency evidence is invalid");
  const measured = raw.baselineStatus === "measured";
  const keys = measured ? ["v", "baselineStatus", "sampleCount", "minimumSampleCount", "sloStatus", "regressionBudgetStatus", "percentiles"] : ["v", "baselineStatus", "sampleCount", "minimumSampleCount", "sloStatus", "regressionBudgetStatus"];
  closed(raw, keys, "factory latency evidence");
  if (raw.v !== "reelier.authority-latency-evaluation/v1" || (raw.baselineStatus !== "measured" && raw.baselineStatus !== "insufficient-samples") || raw.sloStatus !== "absent" || raw.regressionBudgetStatus !== "absent") throw new TypeError("factory latency evidence is invalid");
  if (!Number.isSafeInteger(raw.sampleCount) || !Number.isSafeInteger(raw.minimumSampleCount) || (raw.sampleCount as number) < 1 || (raw.minimumSampleCount as number) < 1) throw new TypeError("factory latency sample count is invalid");
  if (!measured) {
    if ((raw.sampleCount as number) >= (raw.minimumSampleCount as number)) throw new TypeError("insufficient latency sample count is incoherent");
    return Object.freeze({ v: raw.v, baselineStatus: "insufficient-samples", sampleCount: raw.sampleCount as number, minimumSampleCount: raw.minimumSampleCount as number, sloStatus: "absent", regressionBudgetStatus: "absent" });
  }
  if ((raw.sampleCount as number) < (raw.minimumSampleCount as number)) throw new TypeError("measured latency sample count is incoherent");
  const percentiles = closed(raw.percentiles, ["p50Ms", "p95Ms", "p99Ms"], "latency percentiles");
  if (![percentiles.p50Ms, percentiles.p95Ms, percentiles.p99Ms].every(item => typeof item === "number" && Number.isFinite(item) && item >= 0) || (percentiles.p50Ms as number) > (percentiles.p95Ms as number) || (percentiles.p95Ms as number) > (percentiles.p99Ms as number)) throw new TypeError("latency percentiles are invalid");
  return Object.freeze({ v: raw.v, baselineStatus: "measured", sampleCount: raw.sampleCount as number, minimumSampleCount: raw.minimumSampleCount as number, sloStatus: "absent", regressionBudgetStatus: "absent", percentiles: Object.freeze({ p50Ms: percentiles.p50Ms as number, p95Ms: percentiles.p95Ms as number, p99Ms: percentiles.p99Ms as number }) });
}

export function verifyFactoryReleaseEvidence(value: unknown, expected: Readonly<{ tarballDigest: string }>): FactoryReleaseEvidenceV1 {
  const evidence = createFactoryReleaseEvidence(value as FactoryReleaseEvidenceV1);
  if (!expected || !DIGEST.test(expected.tarballDigest) || evidence.tarballDigest !== expected.tarballDigest) throw new TypeError("factory release tarball digest mismatch");
  return evidence;
}
