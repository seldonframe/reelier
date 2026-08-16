import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const checker = await import(pathToFileURL(resolve("conformance/failure-injection/v0/check.mjs")).href);
const schema = JSON.parse(readFileSync(resolve("conformance/failure-injection/v0/report.schema.json"), "utf8"));
const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

const expectedCases = Object.freeze({
  "wrong-principal": ["refused", "authority-principal-mismatch"],
  "reused-parent-principal": ["refused", "delegation-principal-not-attenuated"],
  "identity-injection-through-task-choices": ["refused", "host-bound-identity-override"],
  "undiscovered-job": ["refused", "job-not-discovered"],
  "unauthorized-repo-branch-target": ["refused", "target-not-authorized"],
  "budget-overflow": ["refused", "allocation-budget-exceeded"],
  "duplicate-retry": ["reconciliation-required", "duplicate-retry-requires-reconciliation"],
  "crash-after-reservation": ["ambiguous", "reservation-recovery-required"],
  "crash-after-dispatch": ["ambiguous", "dispatch-outcome-ambiguous"],
  "stale-outcome": ["refused", "outcome-stale"],
  "provider-ack-without-matching-post-state": ["reconciliation-required", "provider-post-state-mismatch"],
  "hidden-unwrapped-route": ["unsupported", "route-unwrapped"],
  "incomplete-route-inventory": ["not-tested", "route-inventory-incomplete"],
  "malformed-coverage": ["unsupported", "coverage-malformed"],
  "unavailable-coverage": ["unsupported", "coverage-unavailable"],
} as const);

test("every named mutation changes the baseline evaluation and cannot be marked passed", () => {
  const baseline = checker.createFailureInjectionBaseline();
  const baselineResult = checker.evaluateFailureInjectionState(baseline);
  assert.equal(baselineResult.disposition, "passed");
  assert.equal(baselineResult.passEligibility, true);

  for (const [caseId, expected] of Object.entries(expectedCases)) {
    const mutated = checker.applyFailureInjectionMutation(baseline, caseId);
    const actual = checker.evaluateFailureInjectionState(mutated);
    assert.notDeepEqual(actual, baselineResult, caseId);
    assert.notEqual(actual.disposition, "passed", caseId);
    assert.equal(actual.passEligibility, false, caseId);
    assert.equal(actual.disposition, expected[0], caseId);
    assert.deepEqual(actual.reasonCodes, [expected[1]], caseId);
  }
});

test("an evaluation is invalidated when its hermetic input is mutated", () => {
  const baseline = checker.createFailureInjectionBaseline();
  const baselineResult = checker.evaluateFailureInjectionState(baseline);
  assert.equal(checker.validateFailureInjectionEvaluation(baseline, baselineResult), true);

  const mutated = checker.applyFailureInjectionMutation(baseline, "wrong-principal");
  assert.equal(checker.validateFailureInjectionEvaluation(mutated, baselineResult), false);
  assert.equal(checker.validateFailureInjectionEvaluation(mutated, checker.evaluateFailureInjectionState(mutated)), true);
  assert.deepEqual(baseline, checker.createFailureInjectionBaseline(), "mutation must operate on a clone");
});

test("the executable matrix covers every planned failure injection without a passing result", () => {
  const report = checker.buildFailureInjectionReport();
  assert.equal(validateSchema(report), true, JSON.stringify(validateSchema.errors));
  assert.equal(checker.validateFailureInjectionReport(report), true);
  assert.equal(report.status, "failed");
  assert.deepEqual(report.cases.map((item: any) => item.caseId), Object.keys(expectedCases));

  for (const item of report.cases) {
    const expected = expectedCases[item.caseId as keyof typeof expectedCases];
    assert.ok(expected, item.caseId);
    assert.equal(item.observedResult.disposition, expected[0], item.caseId);
    assert.ok(item.reasonCodes.includes(expected[1]), item.caseId);
    assert.equal(item.passEligibility, false, item.caseId);
    assert.ok(item.harnessId.length > 0, item.caseId);
    assert.ok(item.adapterPath.length > 0, item.caseId);
    assert.ok(item.expectedLifecycle.length > 0, item.caseId);
    assert.ok(item.nonClaims.length > 0, item.caseId);
    assert.notEqual(item.observedResult.lifecycleState, "passed", item.caseId);
  }
});

test("authority, crash, receipt, and coverage cases preserve explicit evidence states", () => {
  const byId = Object.fromEntries(checker.buildFailureInjectionReport().cases.map((item: any) => [item.caseId, item]));
  assert.deepEqual(byId["wrong-principal"].expectedLifecycle, ["admission", "refused"]);
  assert.equal(byId["crash-after-reservation"].observedResult.claims.dispatch, "absent");
  assert.equal(byId["crash-after-dispatch"].observedResult.claims.dispatch, "verified");
  assert.equal(byId["crash-after-dispatch"].observedResult.claims.reconciliation, "unchecked");
  assert.equal(byId["provider-ack-without-matching-post-state"].observedResult.claims.providerAcknowledgment, "verified");
  assert.equal(byId["provider-ack-without-matching-post-state"].observedResult.claims.reconciliation, "failed");
  assert.equal(byId["hidden-unwrapped-route"].observedResult.claims.topology, "failed");
  assert.equal(byId["incomplete-route-inventory"].observedResult.claims.completeness, "unchecked");
  assert.equal(byId["malformed-coverage"].observedResult.claims.topology, "failed");
  assert.equal(byId["unavailable-coverage"].observedResult.claims.topology, "absent");
});

test("the semantic checker rejects closed-schema and eligibility upgrades", () => {
  const report = checker.buildFailureInjectionReport();
  assert.equal(checker.validateFailureInjectionReport({ ...report, surprise: true }), false);
  assert.equal(checker.validateFailureInjectionReport({ ...report, status: "passed" }), false);
  assert.equal(checker.validateFailureInjectionReport({ ...report, cases: report.cases.slice(1) }), false);
  assert.equal(checker.validateFailureInjectionReport({
    ...report,
    cases: report.cases.map((item: any, index: number) => index === 0 ? { ...item, passEligibility: true } : item),
  }), false);
  assert.equal(checker.validateFailureInjectionReport({
    ...report,
    cases: report.cases.map((item: any, index: number) => index === 6
      ? { ...item, observedResult: { ...item.observedResult, disposition: "refused" } }
      : item),
  }), false);
});

test("the standalone schema rejects an invented failure reason", () => {
  const report = checker.buildFailureInjectionReport();
  const cases = structuredClone(report.cases);
  cases[0].reasonCodes = ["invented-failure-reason"];
  assert.equal(validateSchema({ ...report, cases }), false);
});

test("the standalone schema rejects duplicated case IDs", () => {
  const report = checker.buildFailureInjectionReport();
  const cases = structuredClone(report.cases);
  cases[1].caseId = cases[0].caseId;
  assert.equal(validateSchema({ ...report, cases }), false);
});

test("the CLI emits the complete non-passing report without external inputs", () => {
  const result = spawnSync(process.execPath, [resolve("conformance/failure-injection/v0/check.mjs")], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.cases.length, 15);
  assert.equal(checker.validateFailureInjectionReport(report), true);
});
