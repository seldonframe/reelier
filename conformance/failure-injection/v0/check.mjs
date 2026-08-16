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
  return {
    authorization: "unchecked",
    dispatch: "absent",
    providerAcknowledgment: "absent",
    reconciliation: "absent",
    topology: "unchecked",
    completeness: "unchecked",
    ...overrides,
  };
}

const BASELINE = Object.freeze({
  principal: Object.freeze({
    expectedId: "principal:child",
    actualId: "principal:child",
    parentId: "principal:parent",
    hostBoundId: "principal:child",
    taskChoiceId: null,
  }),
  job: Object.freeze({ requestedId: "job:label", discoveredIds: Object.freeze(["job:label"]) }),
  target: Object.freeze({ requestedId: "repo:reelier#main", authorizedIds: Object.freeze(["repo:reelier#main"]) }),
  allocation: Object.freeze({ requested: 1, limit: 1 }),
  continuity: Object.freeze({
    phase: "idle",
    reservationCount: 0,
    retryAttempted: false,
    providerAcknowledged: false,
    expectedPostState: "label:present",
    observedPostState: "label:present",
  }),
  outcome: Object.freeze({ observedAt: "2026-08-16T12:00:00.000Z", freshUntil: "2026-08-16T12:05:00.000Z" }),
  evaluationTime: "2026-08-16T12:01:00.000Z",
  coverage: Object.freeze({
    available: true,
    malformed: false,
    inventoryComplete: true,
    routes: Object.freeze([Object.freeze({ routeId: "route:labels", wrapped: true })]),
  }),
});

const MUTATIONS = Object.freeze({
  "wrong-principal": (state) => { state.principal.actualId = "principal:other"; },
  "reused-parent-principal": (state) => { state.principal.actualId = state.principal.parentId; },
  "identity-injection-through-task-choices": (state) => { state.principal.taskChoiceId = "principal:injected"; },
  "undiscovered-job": (state) => { state.job.requestedId = "job:undiscovered"; },
  "unauthorized-repo-branch-target": (state) => { state.target.requestedId = "repo:other#admin"; },
  "budget-overflow": (state) => { state.allocation.requested = state.allocation.limit + 1; },
  "duplicate-retry": (state) => { state.continuity.reservationCount = 1; state.continuity.retryAttempted = true; },
  "crash-after-reservation": (state) => { state.continuity.phase = "reserved"; },
  "crash-after-dispatch": (state) => { state.continuity.phase = "dispatched"; },
  "stale-outcome": (state) => { state.evaluationTime = "2026-08-16T12:06:00.000Z"; },
  "provider-ack-without-matching-post-state": (state) => { state.continuity.providerAcknowledged = true; state.continuity.observedPostState = "label:absent"; },
  "hidden-unwrapped-route": (state) => { state.coverage.routes[0].wrapped = false; },
  "incomplete-route-inventory": (state) => { state.coverage.inventoryComplete = false; },
  "malformed-coverage": (state) => { state.coverage.malformed = true; },
  "unavailable-coverage": (state) => { state.coverage.available = false; },
});

function assertClosedObject(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new TypeError(`${label} must use the closed contract`);
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
}

function assertBaselineContract(state) {
  assertClosedObject(state, ["principal", "job", "target", "allocation", "continuity", "outcome", "evaluationTime", "coverage"], "state");
  assertClosedObject(state.principal, ["expectedId", "actualId", "parentId", "hostBoundId", "taskChoiceId"], "principal");
  for (const key of ["expectedId", "actualId", "parentId", "hostBoundId"]) assertString(state.principal[key], `principal.${key}`);
  if (state.principal.taskChoiceId !== null) assertString(state.principal.taskChoiceId, "principal.taskChoiceId");
  for (const [label, value] of [["job", state.job], ["target", state.target]]) {
    assertClosedObject(value, ["requestedId", label === "job" ? "discoveredIds" : "authorizedIds"], label);
    assertString(value.requestedId, `${label}.requestedId`);
    const ids = label === "job" ? value.discoveredIds : value.authorizedIds;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string" || id.length === 0)) throw new TypeError(`${label} identifiers are invalid`);
  }
  assertClosedObject(state.allocation, ["requested", "limit"], "allocation");
  if (!Number.isSafeInteger(state.allocation.requested) || state.allocation.requested < 0 || !Number.isSafeInteger(state.allocation.limit) || state.allocation.limit < 0) throw new TypeError("allocation values are invalid");
  assertClosedObject(state.continuity, ["phase", "reservationCount", "retryAttempted", "providerAcknowledged", "expectedPostState", "observedPostState"], "continuity");
  if (!["idle", "reserved", "dispatched"].includes(state.continuity.phase)) throw new TypeError("continuity.phase is invalid");
  if (!Number.isSafeInteger(state.continuity.reservationCount) || state.continuity.reservationCount < 0) throw new TypeError("continuity.reservationCount is invalid");
  if (typeof state.continuity.retryAttempted !== "boolean" || typeof state.continuity.providerAcknowledged !== "boolean") throw new TypeError("continuity flags are invalid");
  assertString(state.continuity.expectedPostState, "continuity.expectedPostState");
  assertString(state.continuity.observedPostState, "continuity.observedPostState");
  assertClosedObject(state.outcome, ["observedAt", "freshUntil"], "outcome");
  for (const [label, value] of [["outcome.observedAt", state.outcome.observedAt], ["outcome.freshUntil", state.outcome.freshUntil], ["evaluationTime", state.evaluationTime]]) {
    assertString(value, label);
    if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${label} is invalid`);
  }
  assertClosedObject(state.coverage, ["available", "malformed", "inventoryComplete", "routes"], "coverage");
  if (typeof state.coverage.available !== "boolean" || typeof state.coverage.malformed !== "boolean" || typeof state.coverage.inventoryComplete !== "boolean") throw new TypeError("coverage flags are invalid");
  if (!Array.isArray(state.coverage.routes) || state.coverage.routes.length === 0) throw new TypeError("coverage.routes is invalid");
  for (const route of state.coverage.routes) {
    assertClosedObject(route, ["routeId", "wrapped"], "coverage route");
    assertString(route.routeId, "coverage route id");
    if (typeof route.wrapped !== "boolean") throw new TypeError("coverage route wrapped is invalid");
  }
}

function evaluation(adapterPath, expectedLifecycle, disposition, lifecycleState, reasonCode, claimOverrides = {}, nonClaims = NON_CLAIMS) {
  return {
    adapterPath,
    expectedLifecycle,
    disposition,
    lifecycleState,
    claims: claims(claimOverrides),
    passEligibility: disposition === "passed",
    reasonCodes: reasonCode === undefined ? [] : [reasonCode],
    nonClaims: [...nonClaims],
  };
}

export function createFailureInjectionBaseline() {
  return structuredClone(BASELINE);
}

export function applyFailureInjectionMutation(baseline, caseId) {
  assertBaselineContract(baseline);
  const mutate = MUTATIONS[caseId];
  if (mutate === undefined) throw new TypeError("unknown failure-injection mutation");
  const mutated = structuredClone(baseline);
  mutate(mutated);
  assertBaselineContract(mutated);
  return mutated;
}

export function evaluateFailureInjectionState(state) {
  assertBaselineContract(state);
  if (state.principal.actualId !== state.principal.expectedId) {
    if (state.principal.actualId === state.principal.parentId) return evaluation("agent-adapter/v0", ["delegation", "refused"], "refused", "refused", "delegation-principal-not-attenuated", { authorization: "failed" });
    return evaluation("agent-adapter/v0", ["admission", "refused"], "refused", "refused", "authority-principal-mismatch", { authorization: "failed" });
  }
  if (state.principal.taskChoiceId !== null && state.principal.taskChoiceId !== state.principal.hostBoundId) return evaluation("agent-adapter/v0", ["admission", "refused"], "refused", "refused", "host-bound-identity-override", { authorization: "failed" });
  if (!state.job.discoveredIds.includes(state.job.requestedId)) return evaluation("agent-adapter/v0", ["admission", "refused"], "refused", "refused", "job-not-discovered", { authorization: "failed" });
  if (!state.target.authorizedIds.includes(state.target.requestedId)) return evaluation("agent-adapter/v0", ["admission", "refused"], "refused", "refused", "target-not-authorized", { authorization: "failed" });
  if (state.allocation.requested > state.allocation.limit) return evaluation("agent-adapter/v0", ["delegation", "refused"], "refused", "refused", "allocation-budget-exceeded", { authorization: "failed" });
  if (state.continuity.retryAttempted && state.continuity.reservationCount > 0) return evaluation("continuity-adapter/v1", ["reservation", "reconciliation"], "reconciliation-required", "reconciling", "duplicate-retry-requires-reconciliation", { authorization: "verified", dispatch: "unchecked", providerAcknowledgment: "unchecked", reconciliation: "unchecked" });
  if (state.continuity.phase === "reserved") return evaluation("continuity-adapter/v1", ["reservation", "reconciliation"], "ambiguous", "reserved", "reservation-recovery-required", { authorization: "verified", reconciliation: "unchecked" });
  if (state.continuity.phase === "dispatched") return evaluation("continuity-adapter/v1", ["reservation", "dispatch", "reconciliation"], "ambiguous", "dispatched", "dispatch-outcome-ambiguous", { authorization: "verified", dispatch: "verified", providerAcknowledgment: "unchecked", reconciliation: "unchecked" });
  if (Date.parse(state.evaluationTime) > Date.parse(state.outcome.freshUntil)) return evaluation("continuity-adapter/v1", ["admission", "refused"], "refused", "refused", "outcome-stale", { authorization: "failed" });
  if (state.continuity.providerAcknowledged && state.continuity.observedPostState !== state.continuity.expectedPostState) return evaluation("continuity-adapter/v1", ["dispatch", "provider-acknowledgment", "reconciliation"], "reconciliation-required", "reconciling", "provider-post-state-mismatch", { authorization: "verified", dispatch: "verified", providerAcknowledgment: "verified", reconciliation: "failed" }, [...NON_CLAIMS, "content-correctness-not-proved"]);
  if (state.coverage.malformed) return evaluation("coverage-envelope/v0", ["coverage-evaluation", "unsupported"], "unsupported", "unsupported", "coverage-malformed", { topology: "failed", completeness: "failed" }, COVERAGE_NON_CLAIMS);
  if (!state.coverage.available) return evaluation("coverage-envelope/v0", ["coverage-evaluation", "unsupported"], "unsupported", "unsupported", "coverage-unavailable", { topology: "absent", completeness: "absent" }, COVERAGE_NON_CLAIMS);
  if (state.coverage.routes.some((route) => !route.wrapped)) return evaluation("coverage-envelope/v0", ["coverage-evaluation", "unsupported"], "unsupported", "unsupported", "route-unwrapped", { topology: "failed", completeness: "failed" }, COVERAGE_NON_CLAIMS);
  if (!state.coverage.inventoryComplete) return evaluation("coverage-envelope/v0", ["coverage-evaluation", "not-tested"], "not-tested", "not-tested", "route-inventory-incomplete", { topology: "unchecked", completeness: "unchecked" }, COVERAGE_NON_CLAIMS);
  return evaluation("agent-adapter/v0", ["admission", "dispatch", "reconciliation"], "passed", "reconciled", undefined, { authorization: "verified", dispatch: "verified", providerAcknowledgment: "verified", reconciliation: "verified", topology: "verified", completeness: "verified" });
}

export function validateFailureInjectionEvaluation(state, result) {
  try {
    return JSON.stringify(canonical(result)) === JSON.stringify(canonical(evaluateFailureInjectionState(state)));
  } catch {
    return false;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function buildFailureInjectionReport() {
  const baseline = createFailureInjectionBaseline();
  const cases = Object.keys(MUTATIONS).map((caseId) => {
    const result = evaluateFailureInjectionState(applyFailureInjectionMutation(baseline, caseId));
    if (result.passEligibility || result.disposition === "passed" || result.reasonCodes.length !== 1) throw new TypeError(`mutation ${caseId} did not produce a reason-specific non-passing evaluation`);
    return {
      caseId,
      harnessId: "harness-neutral",
      adapterPath: result.adapterPath,
      expectedLifecycle: result.expectedLifecycle,
      observedResult: { disposition: result.disposition, lifecycleState: result.lifecycleState, claims: result.claims },
      passEligibility: result.passEligibility,
      reasonCodes: result.reasonCodes,
      nonClaims: result.nonClaims,
    };
  });
  return { v: VERSION, status: "failed", cases };
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
