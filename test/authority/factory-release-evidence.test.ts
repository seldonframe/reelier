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
