import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAgentProjectV1,
  parseAuthorityCellSessionBindingV1,
  parseBootstrapReportV1,
  parseSupervisorStatusV1,
  verifyAuthorityCellSessionBindingV1,
} from "../src/bootstrap/index.js";

const digest = (char: string) => `sha256:${char.repeat(64)}`;
const project = () => ({
  v: "reelier.agent-project/v1", agentName: "my-agent", projectId: "project_1", tenant: "tenant_1",
  reelierVersion: "0.32.1", installedBuildDigest: digest("1"), packageTarballIntegrityDigest: null,
  authorityContractDigest: digest("2"), continuityContractDigest: digest("3"), outcomeProfileContractDigest: digest("4"),
  bootstrapContractDigest: digest("5"), initializationReportDigest: digest("6"), runtimeDescriptorDigest: digest("7"),
  routeCoverageDigest: digest("8"), profileGovernanceRef: "governance_1", profileGovernanceManifestDigest: digest("9"),
  profileTrustHeadDigest: digest("a"), authorityMode: "managed-cell",
});
const binding = () => ({
  v: "reelier.authority-cell-session-binding/v1", cellId: "cell_1", adapterContractDigest: digest("1"),
  authorityContractDigest: digest("2"), tenant: "tenant_1", principalId: "principal_1", taskId: "task_1",
  runtimeSessionId: "session_1", jobId: "job_1", jobCardDigest: digest("3"), grantId: "grant_1",
  grantDigest: digest("4"), allocationId: "allocation_1", profileDigest: digest("5"), activationDigest: digest("6"),
  profileTrustHeadDigest: digest("7"), expiresAt: "2026-08-15T13:00:00.000Z",
  bindingObservedAt: "2026-08-15T12:00:00.000Z", bindingFreshUntil: "2026-08-15T12:30:00.000Z",
  topologyEvidenceDigest: null, topologyFreshUntil: null,
});
const expectedBinding = () => ({
  observationTime: "2026-08-15T12:15:00.000Z", cellId: "cell_1", adapterContractDigest: digest("1"),
  authorityContractDigest: digest("2"), tenant: "tenant_1", principalId: "principal_1", taskId: "task_1",
  runtimeSessionId: "session_1", jobId: "job_1", jobCardDigest: digest("3"), grantId: "grant_1",
  grantDigest: digest("4"), allocationId: "allocation_1", profileDigest: digest("5"), activationDigest: digest("6"),
  profileTrustHeadDigest: digest("7"), principalSession: {
    tenant: "tenant_1", principalId: "principal_1", grantId: "grant_1", expiresAt: "2026-08-15T13:00:00.000Z",
  },
});

test("bootstrap parsers accept closed inert records and return frozen detached values", () => {
  const parsed = parseAgentProjectV1(project());
  assert.deepEqual(parsed, project());
  assert.ok(Object.isFrozen(parsed));
  assert.deepEqual(parseBootstrapReportV1({
    v: "reelier.bootstrap-report/v1", projectDigest: digest("1"), runtimeDescriptorDigest: digest("2"),
    routeCoverageDigest: digest("3"), initializedAt: "2026-08-15T12:00:00.000Z", canary: "verified",
    authority: "unavailable", recoveryCommand: "npx reelier@0.32.1 up", completeness: "not-proved",
  }).authority, "unavailable");
  assert.equal(parseSupervisorStatusV1({
    v: "reelier.supervisor-status/v1", observedAt: "2026-08-15T12:00:00.000Z",
    observedRoutes: 2, partialRoutes: 1, uncoveredRoutes: 1, unknownRoutes: 0,
    replayAvailable: 1, replayCandidates: 1, outcomesActivated: 0, outcomesUnavailable: 2, outcomesEnforced: 0,
    runtime: "externally-managed", completeness: "not-proved",
  }).completeness, "not-proved");
  assert.deepEqual(parseAuthorityCellSessionBindingV1(binding()), binding());
});

test("bootstrap parsers reject accessors, symbols, non-enumerable extras, and prototype substitution before getters execute", () => {
  const mutations: Array<() => unknown> = [
    () => { let reads = 0; const value = project(); Object.defineProperty(value, "agentName", { enumerable: true, get() { reads++; return "x"; } }); assert.throws(() => parseAgentProjectV1(value)); assert.equal(reads, 0); },
    () => { const value = project() as Record<PropertyKey, unknown>; value[Symbol("extra")] = true; return parseAgentProjectV1(value); },
    () => { const value = project(); Object.defineProperty(value, "secret", { value: "token", enumerable: false }); return parseAgentProjectV1(value); },
    () => parseAgentProjectV1(Object.assign(Object.create({ inherited: true }), project())),
  ];
  for (const mutate of mutations) assert.throws(mutate, TypeError);
});

test("project records refuse floating versions, secret-looking extras, invalid digest claims, and inconsistent governance", () => {
  for (const value of [
    { ...project(), reelierVersion: "latest" },
    { ...project(), token: "secret" },
    { ...project(), installedBuildDigest: "sha256:not-a-digest" },
    { ...project(), packageTarballIntegrityDigest: digest("0") },
    { ...project(), profileGovernanceRef: null },
    { ...project(), authorityMode: "local-cell" },
  ]) assert.throws(() => parseAgentProjectV1(value), TypeError);
});

test("reports cannot upgrade absent authority, completeness, or canary evidence", () => {
  const base = {
    v: "reelier.bootstrap-report/v1", projectDigest: digest("1"), runtimeDescriptorDigest: digest("2"),
    routeCoverageDigest: digest("3"), initializedAt: "2026-08-15T12:00:00.000Z", canary: "unchecked",
    authority: "unavailable", recoveryCommand: "npx reelier@0.32.1 up", completeness: "not-proved",
  };
  for (const value of [
    { ...base, canary: "certified" }, { ...base, authority: "safe" }, { ...base, completeness: "verified" },
    { ...base, recoveryCommand: "npx reelier@latest up" }, { ...base, recoveryCommand: "npx reelier@0.32.1 up && whoami" },
  ]) assert.throws(() => parseBootstrapReportV1(value), TypeError);
});

test("session binding verification joins every expected identity and principal session", () => {
  assert.deepEqual(verifyAuthorityCellSessionBindingV1(binding(), expectedBinding()), binding());
  const mutations: Array<[string, unknown]> = [
    ["adapterContractDigest", digest("8")], ["authorityContractDigest", digest("8")], ["grantId", "grant_2"],
    ["grantDigest", digest("8")], ["expiresAt", "2026-08-15T13:01:00.000Z"],
  ];
  for (const [key, value] of mutations) assert.throws(() => verifyAuthorityCellSessionBindingV1({ ...binding(), [key]: value }, expectedBinding()), TypeError, key);
  for (const [key, value] of [["grantId", "grant_2"], ["principalId", "principal_2"], ["tenant", "tenant_2"], ["expiresAt", "2026-08-15T12:59:59.000Z"]] as const) {
    const context = expectedBinding();
    assert.throws(() => verifyAuthorityCellSessionBindingV1(binding(), { ...context, principalSession: { ...context.principalSession, [key]: value } }), TypeError, `principal ${key}`);
  }
});

test("session binding refuses stale, expired, future, widened, and boundary-time observations", () => {
  for (const value of [
    { ...binding(), bindingObservedAt: "2026-08-15T12:16:00.000Z" },
    { ...binding(), bindingFreshUntil: "2026-08-15T12:15:00.000Z" },
    { ...binding(), bindingFreshUntil: "2026-08-15T13:00:00.001Z" },
    { ...binding(), expiresAt: "2026-08-15T12:14:59.999Z" },
    { ...binding(), topologyEvidenceDigest: digest("9"), topologyFreshUntil: null },
  ]) assert.throws(() => verifyAuthorityCellSessionBindingV1(value, expectedBinding()), TypeError);
  for (const observationTime of [binding().bindingFreshUntil, binding().expiresAt]) {
    assert.throws(() => verifyAuthorityCellSessionBindingV1(binding(), { ...expectedBinding(), observationTime }), TypeError);
  }
  assert.doesNotThrow(() => verifyAuthorityCellSessionBindingV1(binding(), { ...expectedBinding(), observationTime: binding().bindingObservedAt }));
});
