import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const matrix = await import(pathToFileURL(resolve("conformance/semantic-matrix/v0/check.mjs")).href);
const grokBuild = JSON.parse(readFileSync(resolve("conformance/agent-adapter/v0/fixtures/grok-build-observed.json"), "utf8"));
const grokBot = JSON.parse(readFileSync(resolve("conformance/agent-adapter/v0/fixtures/grok-bot-observed.json"), "utf8"));

const eveReport = {
  v: "reelier.continuity-eve-conformance-report/v1",
  status: "passed",
  maturity: "reproduced",
  reelierCommit: "a".repeat(40),
  authorityAdapterContractDigest: `sha256:${"b".repeat(64)}`,
  eveVersion: "0.37.1",
  nodeVersion: "v24.9.0",
  checks: [
    { id: "generic-candidate", status: "passed", detail: "candidate passed" },
    { id: "eve-process-matrix", status: "passed", detail: "process matrix passed" },
    { id: "focused-continuity", status: "passed", detail: "continuity passed" },
  ],
  artifacts: {
    ledgerHeadDigest: `sha256:${"c".repeat(64)}`,
    receiptGraphDigest: `sha256:${"d".repeat(64)}`,
    reportDigest: `sha256:${"e".repeat(64)}`,
  },
  nonClaims: {
    contentCorrectness: "not-proved",
    grokBot: "not-tested",
    productionReadiness: "not-proved",
    safety: "not-proved",
    topology: "not-proved",
    trafficCompleteness: "not-proved",
  },
};

test("semantic matrix runs universal checks and preserves fixture-only Grok evidence", () => {
  const report = matrix.runSemanticMatrix({
    v: "reelier.semantic-matrix-input/v0",
    candidates: [
      { harnessId: "grok-build", adapterPath: "agent-adapter/v0", candidate: grokBuild },
      { harnessId: "grok-bot", adapterPath: "agent-adapter/v0", candidate: grokBot },
      { harnessId: "eve", adapterPath: "continuity-adapter/v1/eve-fixture", report: eveReport },
    ],
  });

  assert.equal(report.v, "reelier.semantic-matrix-report/v0");
  assert.equal(report.harnesses.length, 5);
  assert.equal(report.aggregate.status, "failed");
  assert.equal(report.harnesses.find((row: any) => row.harnessId === "grok-build").evidenceMaturity, "fixture-only");
  assert.equal(report.harnesses.find((row: any) => row.harnessId === "eve").evidenceMaturity, "continuity-proven");
  for (const id of ["codex", "claude-code"]) {
    const row = report.harnesses.find((candidate: any) => candidate.harnessId === id);
    assert.equal(row.overallStatus, "unsupported");
    assert.equal(row.executionStatus, "not-tested");
  }
  const grokChecks = report.semanticChecks.filter((check: any) => ["grok-build", "grok-bot"].includes(check.harnessId));
  assert.equal(grokChecks.length, 14);
  assert.ok(grokChecks.every((check: any) => check.status === "passed"));
});

test("semantic matrix refuses unknown harnesses and does not synthesize missing candidates", () => {
  assert.throws(() => matrix.runSemanticMatrix({
    v: "reelier.semantic-matrix-input/v0",
    candidates: [{ harnessId: "made-up", adapterPath: "agent-adapter/v0", candidate: grokBuild }],
  }), /closed|harness/i);
});
