import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION = "reelier.failure-injection-report/v0";
const schemaPath = fileURLToPath(new URL("./report.schema.json", import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);

const NON_CLAIMS = Object.freeze([
  "agent-adapter-execution-not-proved",
  "live-harness-execution-not-proved",
  "outcome-correctness-not-proved",
  "production-safety-not-proved",
]);
const COVERAGE_NON_CLAIMS = Object.freeze([
  "live-harness-execution-not-proved",
  "route-enforcement-not-proved",
  "traffic-completeness-not-proved",
  "production-safety-not-proved",
]);

function claims(overrides = {}) {
  return Object.freeze({
    authorization: "unchecked",
    dispatch: "absent",
    providerAcknowledgment: "absent",
    reconciliation: "absent",
    topology: "unchecked",
    completeness: "unchecked",
    ...overrides,
  });
}

function failureCase(caseId, adapterPath, expectedLifecycle, disposition, lifecycleState, reasonCodes, claimOverrides = {}, nonClaims = NON_CLAIMS) {
  return Object.freeze({
    caseId,
    harnessId: "harness-neutral",
    adapterPath,
    expectedLifecycle: Object.freeze(expectedLifecycle),
    observedResult: Object.freeze({ disposition, lifecycleState, claims: claims(claimOverrides) }),
    passEligibility: false,
    reasonCodes: Object.freeze(reasonCodes),
    nonClaims,
  });
}

const CASES = Object.freeze([
  failureCase("wrong-principal", "agent-adapter/v0", ["admission", "refused"], "refused", "refused", ["authority-principal-mismatch"], { authorization: "failed" }),
  failureCase("reused-parent-principal", "agent-adapter/v0", ["delegation", "refused"], "refused", "refused", ["delegation-principal-not-attenuated"], { authorization: "failed" }),
  failureCase("identity-injection-through-task-choices", "agent-adapter/v0", ["admission", "refused"], "refused", "refused", ["host-bound-identity-override"], { authorization: "failed" }),
  failureCase("undiscovered-job", "agent-adapter/v0", ["admission", "refused"], "refused", "refused", ["job-not-discovered"], { authorization: "failed" }),
  failureCase("unauthorized-repo-branch-target", "agent-adapter/v0", ["admission", "refused"], "refused", "refused", ["target-not-authorized"], { authorization: "failed" }),
  failureCase("budget-overflow", "agent-adapter/v0", ["delegation", "refused"], "refused", "refused", ["allocation-budget-exceeded"], { authorization: "failed" }),
  failureCase("duplicate-retry", "continuity-adapter/v1", ["reservation", "reconciliation"], "reconciliation-required", "reconciling", ["duplicate-retry-requires-reconciliation"], { authorization: "verified", dispatch: "unchecked", providerAcknowledgment: "unchecked", reconciliation: "unchecked" }),
  failureCase("crash-after-reservation", "continuity-adapter/v1", ["reservation", "reconciliation"], "ambiguous", "reserved", ["reservation-recovery-required"], { authorization: "verified", reconciliation: "unchecked" }),
  failureCase("crash-after-dispatch", "continuity-adapter/v1", ["reservation", "dispatch", "reconciliation"], "ambiguous", "dispatched", ["dispatch-outcome-ambiguous"], { authorization: "verified", dispatch: "verified", providerAcknowledgment: "unchecked", reconciliation: "unchecked" }),
  failureCase("stale-outcome", "continuity-adapter/v1", ["admission", "refused"], "refused", "refused", ["outcome-stale"], { authorization: "failed" }),
  failureCase("provider-ack-without-matching-post-state", "continuity-adapter/v1", ["dispatch", "provider-acknowledgment", "reconciliation"], "reconciliation-required", "reconciling", ["provider-post-state-mismatch"], { authorization: "verified", dispatch: "verified", providerAcknowledgment: "verified", reconciliation: "failed" }, Object.freeze([...NON_CLAIMS, "content-correctness-not-proved"])),
  failureCase("hidden-unwrapped-route", "coverage-envelope/v0", ["coverage-evaluation", "unsupported"], "unsupported", "unsupported", ["route-unwrapped"], { topology: "failed", completeness: "failed" }, COVERAGE_NON_CLAIMS),
  failureCase("incomplete-route-inventory", "coverage-envelope/v0", ["coverage-evaluation", "not-tested"], "not-tested", "not-tested", ["route-inventory-incomplete"], { topology: "unchecked", completeness: "unchecked" }, COVERAGE_NON_CLAIMS),
  failureCase("malformed-coverage", "coverage-envelope/v0", ["coverage-evaluation", "unsupported"], "unsupported", "unsupported", ["coverage-malformed"], { topology: "failed", completeness: "failed" }, COVERAGE_NON_CLAIMS),
  failureCase("unavailable-coverage", "coverage-envelope/v0", ["coverage-evaluation", "unsupported"], "unsupported", "unsupported", ["coverage-unavailable"], { topology: "absent", completeness: "absent" }, COVERAGE_NON_CLAIMS),
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function buildFailureInjectionReport() {
  return structuredClone({ v: VERSION, status: "failed", cases: CASES });
}

export function validateFailureInjectionReport(value) {
  if (!validateSchema(value)) return false;
  return JSON.stringify(canonical(value)) === JSON.stringify(canonical(buildFailureInjectionReport()));
}

function main() {
  const report = buildFailureInjectionReport();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
