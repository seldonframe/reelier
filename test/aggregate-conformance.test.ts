import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const agent = await import(pathToFileURL(resolve("conformance/agent-adapter/v0/check.mjs")).href);
const continuity = await import(pathToFileURL(resolve("conformance/continuity-adapter/v1/check.mjs")).href);
const aggregate = await import(pathToFileURL(resolve("conformance/aggregate/v0/check.mjs")).href);
const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;
const aggregateSchema = JSON.parse(readFileSync(resolve("conformance/aggregate/v0/report.schema.json"), "utf8"));
const validateStandaloneAggregate = new Ajv2020({ allErrors: true, strict: true }).compile(aggregateSchema);
const standaloneAgentSourceAjv = new Ajv2020({ allErrors: true, strict: true });
standaloneAgentSourceAjv.addSchema(aggregateSchema);
const validateStandaloneAgentSource = standaloneAgentSourceAjv.compile({
  $ref: `${aggregateSchema.$id}#/$defs/agentAdapterSourceReport`,
});

const agentCandidate = JSON.parse(readFileSync(resolve("conformance/agent-adapter/v0/fixtures/grok-build-observed.json"), "utf8"));
const agentReport = agent.checkCandidate(agentCandidate);

const genuineEveReport = {
  v: "reelier.continuity-eve-conformance-report/v1",
  status: "passed",
  maturity: "reproduced",
  reelierCommit: "a".repeat(40),
  authorityAdapterContractDigest: `sha256:${"b".repeat(64)}`,
  eveVersion: "0.37.1",
  nodeVersion: "v24.9.0",
  checks: [
    { id: "generic-candidate", status: "passed", detail: "public continuity adapter candidate checks passed" },
    { id: "eve-process-matrix", status: "passed", detail: "real Eve process matrix passed" },
    { id: "focused-continuity", status: "passed", detail: "focused continuity suites passed" },
  ],
  artifacts: { ledgerHeadDigest: `sha256:${"c".repeat(64)}`, receiptGraphDigest: `sha256:${"d".repeat(64)}`, reportDigest: `sha256:${"e".repeat(64)}` },
  nonClaims: { contentCorrectness: "not-proved", grokBot: "not-tested", productionReadiness: "not-proved", safety: "not-proved", topology: "not-proved", trafficCompleteness: "not-proved" },
};

test("aggregate preserves fixture-only v0 evidence without making it pass", () => {
  const report = aggregate.aggregateReports([{ harnessId: "xai.grok-build", adapterPath: "agent-adapter/v0", report: agentReport }]);
  const row = report.harnesses[0];
  assert.equal(report.status, "failed");
  assert.equal(row.evidenceMaturity, "fixture-only");
  assert.equal(row.coverageStatus, "observed-only");
  assert.equal(row.executionStatus, "not-tested");
  assert.equal(row.outcomeStatus, "not-tested");
  assert.equal(row.nonClaims.routeEnforcement, "not-proved");
  assert.ok(row.reasons.length > 0);
});

test("aggregate classifies Eve continuity as continuity-proven, not execution-proven", () => {
  const report = aggregate.aggregateReports([{ harnessId: "eve", adapterPath: "continuity-adapter/v1/eve-fixture", report: genuineEveReport }]);
  const row = report.harnesses[0];
  assert.equal(row.evidenceMaturity, "continuity-proven");
  assert.equal(row.coverageStatus, "coverage-unknown");
  assert.equal(row.executionStatus, "not-tested");
  assert.equal(row.outcomeStatus, "not-tested");
  assert.equal(report.status, "failed");
  assert.equal(row.nonClaims.agentAdapterExecution, "not-proved");
});

test("aggregate rejects empty, contradictory, and dishonest passing reports", () => {
  const validRow = aggregate.aggregateReports([{ harnessId: "xai.grok-build", adapterPath: "agent-adapter/v0", report: agentReport }]).harnesses[0];
  const base = { v: "reelier.aggregate-conformance-report/v0", status: "failed", harnesses: [validRow] };
  assert.equal(aggregate.validateAggregateReport({ ...base, harnesses: [] }), false);
  assert.equal(aggregate.validateAggregateReport({ ...base, status: "passed" }), false);
  assert.equal(aggregate.validateAggregateReport({ ...base, harnesses: [{ ...validRow, overallStatus: "execution-proven" }] }), false);
  assert.equal(aggregate.validateAggregateReport({ ...base, status: "passed", harnesses: [{ ...validRow, evidenceMaturity: "execution-proven", coverageStatus: "enforced", executionStatus: "execution-proven", outcomeStatus: "verified", overallStatus: "execution-proven" }] }), true);
});

test("aggregate validates source contracts and binds source identity", () => {
  const mismatched = aggregate.aggregateReports([{ harnessId: "other-adapter", adapterPath: "agent-adapter/v0", report: agentReport }]);
  assert.equal(mismatched.harnesses[0].overallStatus, "unsupported");
  const forged = structuredClone(agentReport);
  forged.status = "passed";
  forged.checks[0].status = "failed";
  const rejected = aggregate.aggregateReports([{ harnessId: "xai.grok-build", adapterPath: "agent-adapter/v0", report: forged }]);
  assert.equal(rejected.harnesses[0].overallStatus, "unsupported");
});

test("aggregate rejects an agent report with an unexpected top-level property", () => {
  const forged = { ...agentReport, unexpected: true };
  const report = aggregate.aggregateReports([{ harnessId: "xai.grok-build", adapterPath: "agent-adapter/v0", report: forged }]);
  assert.equal(report.harnesses[0].overallStatus, "unsupported");
  assert.equal(report.status, "failed");
});

test("aggregate closes the agent-adapter source report check vector", () => {
  const mutations = [
    ["invented id", (report: any) => { report.checks[0].id = "invented-passing-check"; }],
    ["duplicate and missing id", (report: any) => { report.checks[1].id = report.checks[0].id; }],
    ["wrong passing detail", (report: any) => { report.checks[0].detail = "invented passing detail"; }],
    ["inconsistent source status", (report: any) => { report.status = "failed"; }],
    ["mismatched failed detail", (report: any) => { report.status = "failed"; report.checks[0].status = "failed"; }],
  ] as const;
  for (const [label, mutate] of mutations) {
    const forged = structuredClone(agentReport);
    mutate(forged);
    assert.equal(validateStandaloneAgentSource(forged), false, label);
    const report = aggregate.aggregateReports([{ harnessId: "xai.grok-build", adapterPath: "agent-adapter/v0", report: forged }]);
    assert.equal(report.harnesses[0].overallStatus, "unsupported", label);
  }
});

test("aggregate accepts a genuine failed closed agent-adapter vector", () => {
  const failedCandidate = structuredClone(agentCandidate);
  const delegation = failedCandidate.transcript.find((event: any) => event.operation === "delegations.request");
  delegation.request.childPrincipalId = failedCandidate.session.principalId;
  const failedReport = agent.checkCandidate(failedCandidate);
  assert.equal(failedReport.status, "failed");
  assert.equal(validateStandaloneAgentSource(failedReport), true, JSON.stringify(validateStandaloneAgentSource.errors));
  const report = aggregate.aggregateReports([{ harnessId: "xai.grok-build", adapterPath: "agent-adapter/v0", report: failedReport }]);
  assert.equal(report.harnesses[0].overallStatus, "failed");
});

test("unknown-like aggregate states are never passing", () => {
  for (const state of ["unknown", "uncovered", "unchecked", "absent", "pending", "not-tested", "unsupported", "failed", "continuity-only"] as const) {
    assert.equal(aggregate.isPassingStatus(state), false, state);
  }
});

test("aggregate CLI usage and parse failures emit standalone-schema-valid non-passing evidence", () => {
  for (const args of [[], [resolve("conformance/aggregate/v0/missing-input.json")]]) {
    const cli = spawnSync(process.execPath, [resolve("conformance/aggregate/v0/check.mjs"), ...args], { encoding: "utf8" });
    assert.equal(cli.status, args.length === 0 ? 2 : 1);
    const report = JSON.parse(cli.stdout);
    assert.equal(validateStandaloneAggregate(report), true, JSON.stringify(validateStandaloneAggregate.errors));
    assert.equal(report.status, "failed");
    assert.equal(report.harnesses.length, 5);
    assert.ok(report.harnesses.every((row: any) => row.executionStatus === "not-tested" && row.outcomeStatus === "not-tested"));
    assert.ok(report.harnesses.every((row: any) => row.overallStatus !== "execution-proven"));
  }
});
