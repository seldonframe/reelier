import type { AuthorityLatencyEvaluationV1 } from "./evaluation.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
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
  if (!value || value.v !== "reelier.factory-release-evidence/v1" || !DIGEST.test(value.tarballDigest) || !/^[0-9a-f]{7,64}$/i.test(value.commit)) throw new TypeError("factory release evidence is invalid");
  if (!value.runner || !["linux", "windows"].includes(value.runner.os) || !/^v?\d+\.\d+\.\d+/.test(value.runner.nodeVersion) || !value.runner.hardwareClass || value.liveProviderStatus !== "absent" || value.namedHostConformance !== "unchecked") throw new TypeError("factory release evidence claims are invalid");
  const latency = value.latency;
  if (!latency || !["insufficient-samples", "measured"].includes(latency.baselineStatus) || !Number.isSafeInteger(latency.sampleCount) || !Number.isSafeInteger(latency.minimumSampleCount) || latency.sloStatus !== "absent" || latency.regressionBudgetStatus !== "absent") throw new TypeError("factory latency evidence is invalid");
  if (latency.baselineStatus === "insufficient-samples" && latency.percentiles !== undefined) throw new TypeError("insufficient latency evidence cannot carry percentiles");
  if (latency.baselineStatus === "measured" && (!latency.percentiles || Object.values(latency.percentiles).some(item => !Number.isFinite(item) || item < 0))) throw new TypeError("measured latency evidence requires percentiles");
  return Object.freeze({ ...value, runner: Object.freeze({ ...value.runner }), latency: Object.freeze({ ...latency, ...(latency.percentiles ? { percentiles: Object.freeze({ ...latency.percentiles }) } : {}) }) });
}

export function verifyFactoryReleaseEvidence(value: unknown, expected: Readonly<{ tarballDigest: string }>): FactoryReleaseEvidenceV1 {
  const evidence = createFactoryReleaseEvidence(value as FactoryReleaseEvidenceV1);
  if (!expected || !DIGEST.test(expected.tarballDigest) || evidence.tarballDigest !== expected.tarballDigest) throw new TypeError("factory release tarball digest mismatch");
  return evidence;
}
