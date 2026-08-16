import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const agent = await import(pathToFileURL(resolve("conformance/agent-adapter/v0/check.mjs")).href);
const continuity = await import(pathToFileURL(resolve("conformance/continuity-adapter/v1/check.mjs")).href);
const aggregate = await import(pathToFileURL(resolve("conformance/aggregate/v0/check.mjs")).href);

const agentCandidate = JSON.parse(readFileSync(resolve("conformance/agent-adapter/v0/fixtures/grok-build-observed.json"), "utf8"));
const agentReport = agent.checkCandidate(agentCandidate);

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
