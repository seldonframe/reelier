import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const matrix = await import(pathToFileURL(resolve("conformance/semantic-matrix/v0/check.mjs")).href);
const grokBuild = JSON.parse(readFileSync(resolve("conformance/agent-adapter/v0/fixtures/grok-build-observed.json"), "utf8"));
const grokBot = JSON.parse(readFileSync(resolve("conformance/agent-adapter/v0/fixtures/grok-bot-observed.json"), "utf8"));
const eveCandidate = structuredClone(grokBuild);
eveCandidate.descriptor.adapterId = "eve";
eveCandidate.descriptor.agentHost = "eve";

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

test("Eve continuity evidence cannot be relabeled as agent-adapter evidence", () => {
  const report = matrix.runSemanticMatrix({
    v: "reelier.semantic-matrix-input/v0",
    candidates: [{ harnessId: "eve", adapterPath: "agent-adapter/v0", report: eveReport }],
  });
  const eve = report.harnesses.find((row: any) => row.harnessId === "eve");
  assert.equal(eve.overallStatus, "unsupported");
  assert.equal(eve.executionStatus, "not-tested");
  assert.equal(report.semanticChecks.some((check: any) => check.harnessId === "eve"), false);
});

test("Eve can select its agent candidate without hiding separate continuity evidence", () => {
  const report = matrix.runSemanticMatrix({
    v: "reelier.semantic-matrix-input/v0",
    candidates: [{
      harnessId: "eve",
      adapterPath: "agent-adapter/v0",
      candidate: eveCandidate,
      continuityEvidence: { adapterPath: "continuity-adapter/v1/eve-fixture", report: eveReport },
    }],
  });
  const eve = report.harnesses.find((row: any) => row.harnessId === "eve");
  assert.equal(eve.adapterPath, "agent-adapter/v0");
  assert.equal(eve.evidenceMaturity, "fixture-only");
  assert.equal(eve.executionStatus, "not-tested");
  assert.equal(eve.outcomeStatus, "not-tested");
  assert.deepEqual(eve.nonClaims, {
    routeEnforcement: "not-proved",
    agentAdapterExecution: "not-proved",
    liveHarnessExecution: "not-proved",
    outcomeCorrectness: "not-proved",
    productionSafety: "not-proved",
  });
  assert.equal(report.semanticChecks.filter((check: any) => check.harnessId === "eve").length, 7);
  assert.ok(report.semanticChecks.filter((check: any) => check.harnessId === "eve").every((check: any) => check.status === "passed"));
  assert.equal(report.continuityEvidence.length, 1);
  assert.equal(report.continuityEvidence[0].harnessId, "eve");
  assert.equal(report.continuityEvidence[0].adapterPath, "continuity-adapter/v1/eve-fixture");
  assert.equal(report.continuityEvidence[0].evidenceMaturity, "continuity-proven");
  assert.equal(report.continuityEvidence[0].executionStatus, "not-tested");
  assert.equal(report.continuityEvidence[0].nonClaims.agentAdapterExecution, "not-proved");
  assert.equal(report.status, "failed");
});

test("Eve agent candidate identity or contract mismatch refuses semantic evidence", () => {
  const wrongIdentity = structuredClone(eveCandidate);
  wrongIdentity.descriptor.adapterId = "xai.grok-build";
  const wrongHost = structuredClone(eveCandidate);
  wrongHost.descriptor.agentHost = "grok-build";
  const wrongContract = structuredClone(eveCandidate);
  wrongContract.descriptor.authorityContract = { status: "frozen", digest: `sha256:${"f".repeat(64)}` };
  for (const candidate of [wrongIdentity, wrongHost, wrongContract]) {
    const report = matrix.runSemanticMatrix({
      v: "reelier.semantic-matrix-input/v0",
      candidates: [{ harnessId: "eve", adapterPath: "agent-adapter/v0", candidate }],
    });
    const eve = report.harnesses.find((row: any) => row.harnessId === "eve");
    assert.equal(eve.overallStatus, "unsupported");
    assert.equal(eve.executionStatus, "not-tested");
    assert.equal(report.semanticChecks.some((check: any) => check.harnessId === "eve"), false);
  }
});

test("semantic matrix refuses unknown harnesses and does not synthesize missing candidates", () => {
  assert.throws(() => matrix.runSemanticMatrix({
    v: "reelier.semantic-matrix-input/v0",
    candidates: [{ harnessId: "made-up", adapterPath: "agent-adapter/v0", candidate: grokBuild }],
  }), /closed|harness/i);
});

test("matrix report has exactly the five unique harness identities and binds status to aggregate", () => {
  const report = matrix.runSemanticMatrix({ v: "reelier.semantic-matrix-input/v0", candidates: [] });
  assert.deepEqual(report.harnesses.map((row: any) => row.harnessId), ["codex", "claude-code", "eve", "grok-build", "grok-bot"]);
  assert.equal(new Set(report.harnesses.map((row: any) => row.harnessId)).size, 5);
  assert.equal(matrix.validateSemanticMatrixReport({ ...report, status: "passed" }), false);
  assert.equal(matrix.validateSemanticMatrixReport({ ...report, harnesses: [{ ...report.harnesses[0], harnessId: "other" }, ...report.harnesses.slice(1)] }), false);
});

test("invalid source reports cannot publish semantic checks", () => {
  const invalid = { v: "reelier.agent-adapter-conformance-report/v0", status: "passed", adapterId: "xai.grok-build", checks: [{ id: "forged", status: "passed", detail: "forged" }] };
  const report = matrix.runSemanticMatrix({ v: "reelier.semantic-matrix-input/v0", candidates: [{ harnessId: "grok-build", adapterPath: "agent-adapter/v0", report: invalid }] });
  assert.equal(report.harnesses.find((row: any) => row.harnessId === "grok-build").overallStatus, "unsupported");
  assert.equal(report.semanticChecks.some((check: any) => check.harnessId === "grok-build"), false);
});

test("listed missing evidence must be explicit and CLI failures remain schema-valid", () => {
  assert.throws(() => matrix.runSemanticMatrix({
    v: "reelier.semantic-matrix-input/v0",
    candidates: [{ harnessId: "codex", adapterPath: "agent-adapter/v0" }],
  }), /closed|missing/i);
  for (const args of [[], [resolve("conformance/semantic-matrix/v0/missing-input.json")]]) {
    const cli = spawnSync(process.execPath, [resolve("conformance/semantic-matrix/v0/check.mjs"), ...args], { encoding: "utf8" });
    assert.equal(cli.status, args.length === 0 ? 2 : 1);
    const failure = JSON.parse(cli.stdout);
    assert.equal(matrix.validateSemanticMatrixReport(failure), true);
    assert.equal(failure.status, "failed");
    assert.equal(failure.harnesses.length, 5);
    assert.ok(failure.harnesses.every((row: any) => row.reasons.length > 0));
  }
});

test("a passed matrix cannot contain unsupported top-level harness rows", () => {
  const passingRow = (harnessId: string) => ({
    harnessId,
    adapterPath: "agent-adapter/v0",
    evidenceMaturity: "execution-proven",
    coverageStatus: "enforced",
    executionStatus: "execution-proven",
    outcomeStatus: "verified",
    overallStatus: "execution-proven",
    nonClaims: {
      routeEnforcement: "not-proved",
      agentAdapterExecution: "not-proved",
      liveHarnessExecution: "not-proved",
      outcomeCorrectness: "not-proved",
      productionSafety: "not-proved",
    },
    reasons: ["fully passing aggregate fixture"],
  });
  const aggregate = {
    v: "reelier.aggregate-conformance-report/v0",
    status: "passed",
    harnesses: ["codex", "claude-code", "eve", "xai.grok-build", "xai.grok-bot"].map(passingRow),
  };
  const report = {
    v: "reelier.semantic-matrix-report/v0",
    status: "passed",
    aggregate,
    harnesses: ["codex", "claude-code", "eve", "grok-build", "grok-bot"].map(passingRow),
    semanticChecks: [],
    continuityEvidence: [],
  };
  assert.equal(matrix.validateSemanticMatrixReport(report), true);
  const dishonest = {
    ...report,
    harnesses: report.harnesses.map((row) => ({
      ...row,
      evidenceMaturity: "unsupported",
      coverageStatus: "coverage-unknown",
      executionStatus: "not-tested",
      outcomeStatus: "not-tested",
      overallStatus: "unsupported",
      reasons: ["missing candidate"],
    })),
  };
  assert.equal(matrix.validateSemanticMatrixReport(dishonest), false);
});

test("explicit missing evidence cannot coexist with a candidate or report", () => {
  for (const extra of [{ candidate: grokBuild }, { report: eveReport }]) {
    assert.throws(() => matrix.runSemanticMatrix({
      v: "reelier.semantic-matrix-input/v0",
      candidates: [{ harnessId: "codex", adapterPath: "agent-adapter/v0", missing: true, ...extra }],
    }), /invalid|oneOf/i);
  }
});
