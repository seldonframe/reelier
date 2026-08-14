import test from "node:test";
import assert from "node:assert/strict";
import { createFactoryReleaseEvidence, verifyFactoryReleaseEvidence } from "../../src/authority/certification/factory-release-evidence.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

test("factory release evidence closes an offline tarball baseline without a live-provider or latency-SLO claim", () => {
  const evidence = createFactoryReleaseEvidence({
    v: "reelier.factory-release-evidence/v1",
    tarballDigest: digest("a"),
    commit: "5f6eed5",
    runner: { os: "linux", nodeVersion: "v22.0.0", hardwareClass: "hermetic-test" },
    liveProviderStatus: "absent",
    namedHostConformance: "unchecked",
    latency: {
      v: "reelier.authority-latency-evaluation/v1",
      baselineStatus: "insufficient-samples",
      sampleCount: 2,
      minimumSampleCount: 3,
      sloStatus: "absent",
      regressionBudgetStatus: "absent",
    },
  });

  assert.deepEqual(verifyFactoryReleaseEvidence(evidence, { tarballDigest: digest("a") }), evidence);
  assert.equal(evidence.latency.sloStatus, "absent");
  assert.equal(evidence.latency.regressionBudgetStatus, "absent");
  assert.equal(JSON.stringify(evidence).includes("credential"), false);
  assert.throws(() => verifyFactoryReleaseEvidence({ ...evidence, tarballDigest: digest("b") }, { tarballDigest: digest("a") }), /tarball/i);
});

test("factory release evidence rejects unclosed, incoherent, and dishonest latency claims", () => {
  const measured = {
    v: "reelier.factory-release-evidence/v1" as const,
    tarballDigest: digest("a"),
    commit: "5f6eed5",
    runner: { os: "linux" as const, nodeVersion: "v22.0.0", hardwareClass: "hermetic-test" },
    liveProviderStatus: "absent" as const,
    namedHostConformance: "unchecked" as const,
    latency: {
      v: "reelier.authority-latency-evaluation/v1" as const,
      baselineStatus: "measured" as const,
      sampleCount: 3,
      minimumSampleCount: 3,
      sloStatus: "absent" as const,
      regressionBudgetStatus: "absent" as const,
      percentiles: { p50Ms: 2, p95Ms: 3, p99Ms: 4 },
    },
  };
  assert.throws(() => createFactoryReleaseEvidence({ ...measured, secret: "must-not-pass" } as any), /closed/i);
  assert.throws(() => createFactoryReleaseEvidence({ ...measured, latency: { ...measured.latency, v: "wrong" } } as any), /latency/i);
  assert.throws(() => createFactoryReleaseEvidence({ ...measured, latency: { ...measured.latency, sampleCount: 0 } }), /sample/i);
  assert.throws(() => createFactoryReleaseEvidence({ ...measured, latency: { ...measured.latency, percentiles: { p50Ms: 5, p95Ms: 3, p99Ms: 4 } } }), /percentile/i);
  assert.throws(() => createFactoryReleaseEvidence({ ...measured, runner: { ...measured.runner, hardwareClass: "env:REELIER_TOKEN" } }), /runner|hardware/i);
  assert.throws(() => createFactoryReleaseEvidence({ ...measured, runner: { ...measured.runner, hardwareClass: "C:\\secrets\\token" } }), /runner|hardware/i);
  assert.throws(() => createFactoryReleaseEvidence({ ...measured, runner: { ...measured.runner, nodeVersion: "v22.0.0 token=secret" } }), /runner|node/i);
});
