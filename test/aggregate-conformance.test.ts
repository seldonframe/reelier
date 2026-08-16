import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const agent = await import(pathToFileURL(resolve("conformance/agent-adapter/v0/check.mjs")).href);
const continuity = await import(pathToFileURL(resolve("conformance/continuity-adapter/v1/check.mjs")).href);
const aggregate = await import(pathToFileURL(resolve("conformance/aggregate/v0/check.mjs")).href);

const agentReport = agent.checkCandidate({
  v: "reelier.agent-adapter-candidate/v0",
  descriptor: {
    adapterId: "xai.grok-build", agentHost: "grok-build", transport: "https", execution: "fixture-only",
    identityBinding: "host-authenticated", providerCredentialAccess: "none",
    authorityContract: { status: "pending-freeze", digest: null },
    coverage: { supportedModes: ["observed", "enforced"], defaultMode: "observed" },
    operations: ["jobs.search", "jobs.load", "delegations.request", "delegations.status", "tasks.status", "outcomes.invoke", "outcomes.status"],
    hardCodedJobRefs: [],
  },
  session: { taskId: "task", principalId: "principal", allocationId: "allocation", remainingEffects: 2 },
  transcript: [], coverageProbes: [],
});

const eveReport = await continuity.checkContinuityAdapterCandidate(pathToFileURL(resolve("conformance/continuity-adapter/v1/fixtures/core-candidate.mjs")).href);

test("aggregate preserves fixture-only v0 evidence without making it pass", () => {
  const report = aggregate.aggregateReports([{ harnessId: "grok-build", adapterPath: "agent-adapter/v0", report: agentReport }]);
  const row = report.harnesses[0];
  assert.equal(report.status, "failed");
  assert.equal(row.evidenceMaturity, "fixture-only");
  assert.equal(row.coverageStatus, "observed-only");
  assert.equal(row.executionStatus, "not-tested");
  assert.equal(row.outcomeStatus, "not-tested");
  assert.ok(row.nonClaims.includes("observed route discovery is not write enforcement"));
  assert.ok(row.reasons.length > 0);
});

test("aggregate classifies Eve continuity as continuity-proven, not execution-proven", () => {
  const report = aggregate.aggregateReports([{ harnessId: "eve", adapterPath: "continuity-adapter/v1", report: eveReport }]);
  const row = report.harnesses[0];
  assert.equal(row.evidenceMaturity, "continuity-proven");
  assert.equal(row.coverageStatus, "coverage-unknown");
  assert.equal(row.executionStatus, "not-tested");
  assert.equal(row.outcomeStatus, "not-tested");
  assert.equal(report.status, "failed");
  assert.ok(row.nonClaims.includes("continuity does not prove universal agent-adapter execution"));
});

test("unknown-like aggregate states are never passing", () => {
  for (const state of ["coverage-unknown", "not-tested", "unsupported", "failed"] as const) {
    assert.equal(aggregate.isPassingStatus(state), false, state);
  }
});
