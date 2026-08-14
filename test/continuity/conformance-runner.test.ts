import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const { checkContinuityAdapterCandidate } = await import(pathToFileURL(resolve("conformance/continuity-adapter/v1/check.mjs")).href);

const candidate = pathToFileURL(resolve("conformance/continuity-adapter/v1/fixtures/core-candidate.mjs")).href;

test("core candidate passes the closed continuity adapter contract", async () => {
  const report = await checkContinuityAdapterCandidate(candidate);
  assert.equal(report.v, "reelier.continuity-adapter-conformance-report/v1");
  assert.equal(report.status, "passed");
  assert.equal(report.maturity, "reproduced");
  assert.equal(report.checks.every((item: { status: string }) => item.status === "passed"), true);
  assert.deepEqual(report.nonClaims, {
    contentCorrectness: "not-proved",
    productionReadiness: "not-proved",
    safety: "not-proved",
    topology: "not-proved",
    trafficCompleteness: "not-proved",
  });
});

test("runner fails a candidate that dispatches during open", async () => {
  const report = await checkContinuityAdapterCandidate(candidate, { mutation: "dispatch-on-open" });
  assert.equal(report.status, "failed");
  assert.equal(report.checks.find((item: { id: string }) => item.id === "resume-is-read-only")?.status, "failed");
});

test("runner fails identity override and evidence upgrade candidates", async () => {
  for (const mutation of ["identity-from-input", "unchecked-as-verified"] as const) {
    const report = await checkContinuityAdapterCandidate(candidate, { mutation });
    assert.equal(report.status, "failed");
  }
});
