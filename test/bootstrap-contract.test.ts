import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { types as utilTypes } from "node:util";
import {
  BOOTSTRAP_CONTRACT_V1,
  parseAgentProjectV1,
  parseAuthorityCellSessionBindingV1,
  parseBootstrapReportV1,
  parseSupervisorStatusV1,
  verifyAuthorityCellSessionBindingV1,
  verifyBootstrapContractV1,
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
    replayAvailable: 1, replayCandidates: 1, outcomesActivated: 0, outcomesUnavailable: 4, outcomesEnforced: 0,
    runtime: "externally-managed", completeness: "not-proved",
  }).completeness, "not-proved");
  assert.deepEqual(parseAuthorityCellSessionBindingV1(binding()), binding());
});

test("bootstrap parsers reject accessors, symbols, non-enumerable extras, and prototype substitution before getters execute", () => {
  let reads = 0;
  const accessor = project();
  Object.defineProperty(accessor, "agentName", { enumerable: true, get() { reads++; return "x"; } });
  assert.throws(() => parseAgentProjectV1(accessor), TypeError);
  assert.equal(reads, 0);
  const mutations: Array<() => unknown> = [
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

test("bootstrap contract verification binds the exact six schemas and evaluates no descriptor accessor", async () => {
  assert.deepEqual(BOOTSTRAP_CONTRACT_V1.members.map(member => member.path), [
    "agent-project.schema.json", "authority-cell-session-binding.schema.json", "bootstrap-report.schema.json",
    "route-coverage.schema.json", "runtime-descriptor.schema.json", "supervisor-status.schema.json",
  ]);
  const files = new Map<string, Uint8Array>();
  for (const member of BOOTSTRAP_CONTRACT_V1.members) files.set(member.path, await readFile(join(process.cwd(), "contract", "bootstrap", "v1", member.path)));
  assert.deepEqual(verifyBootstrapContractV1(BOOTSTRAP_CONTRACT_V1, files), BOOTSTRAP_CONTRACT_V1);
  const mutated = new Map(files);
  mutated.set("runtime-descriptor.schema.json", Buffer.from("{}\n"));
  assert.throws(() => verifyBootstrapContractV1(BOOTSTRAP_CONTRACT_V1, mutated), TypeError);
  let reads = 0;
  const accessor = { ...BOOTSTRAP_CONTRACT_V1 };
  Object.defineProperty(accessor, "digest", { enumerable: true, get() { reads++; return BOOTSTRAP_CONTRACT_V1.digest; } });
  assert.throws(() => verifyBootstrapContractV1(accessor, files), TypeError);
  assert.equal(reads, 0);
});

test("bootstrap parsing rejects top-level proxies without executing any proxy trap", () => {
  let traps = 0;
  const proxied = new Proxy(project(), {
    getPrototypeOf() { traps++; return Object.prototype; },
    ownKeys(target) { traps++; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { traps++; return Reflect.getOwnPropertyDescriptor(target, key); },
    get(target, key, receiver) { traps++; return Reflect.get(target, key, receiver); },
  });
  assert.equal(utilTypes.isProxy(proxied), true, "test witness is a real proxy");
  assert.throws(() => parseAgentProjectV1(proxied), TypeError);
  assert.equal(traps, 0);
});

test("bootstrap parsing rejects nested proxies without executing any proxy trap", () => {
  let traps = 0;
  const proxiedSession = new Proxy(expectedBinding().principalSession, {
    getPrototypeOf() { traps++; return Object.prototype; },
    ownKeys(target) { traps++; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { traps++; return Reflect.getOwnPropertyDescriptor(target, key); },
    get(target, key, receiver) { traps++; return Reflect.get(target, key, receiver); },
  });
  assert.equal(utilTypes.isProxy(proxiedSession), true, "nested witness is a real proxy");
  assert.throws(() => verifyAuthorityCellSessionBindingV1(binding(), { ...expectedBinding(), principalSession: proxiedSession }), TypeError);
  assert.equal(traps, 0);
});

test("supervisor status accepts uncovered-only rows and rejects impossible cross-lane aggregates", () => {
  const uncoveredOnly = {
    v: "reelier.supervisor-status/v1", observedAt: "2026-08-15T12:00:00.000Z",
    observedRoutes: 0, partialRoutes: 0, uncoveredRoutes: 1, unknownRoutes: 0,
    replayAvailable: 0, replayCandidates: 0, outcomesActivated: 0, outcomesUnavailable: 1, outcomesEnforced: 0,
    runtime: "externally-managed", completeness: "not-proved",
  };
  assert.deepEqual(parseSupervisorStatusV1(uncoveredOnly), uncoveredOnly);
  for (const value of [
    { ...uncoveredOnly, replayAvailable: 1, replayCandidates: 1 },
    { ...uncoveredOnly, outcomesActivated: 1, outcomesUnavailable: 1 },
    { ...uncoveredOnly, outcomesActivated: 0, outcomesUnavailable: 0 },
    { ...uncoveredOnly, outcomesEnforced: 1 },
  ]) assert.throws(() => parseSupervisorStatusV1(value), TypeError);
});
