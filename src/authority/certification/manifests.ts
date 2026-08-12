import { CERTIFICATION_SCENARIOS, CERTIFICATION_SCENARIO_IDS, type CertificationScenarioId, type CertificationSecretSlot } from "./scenarios.js";
import { CERTIFICATION_RUNNER_OPERATIONS, certificationRunnerRegistryDigest, getCertificationRunnerRegistryEntry, type CertificationProvider } from "./runner-registry.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ID = /^[a-z][a-z0-9_]{2,127}$/;
const TEXT = /^[A-Za-z0-9][A-Za-z0-9._~:/#-]{0,511}$/;
const RUNNER_OPERATIONS_V1 = Object.freeze(["prepare", "authoritative-read", "compile", "reserve", "reread", "dispatch", "reconcile", "receipt", "cleanup"] as const);
const TEST_CASES = Object.freeze(["account-binding", "ambiguity", "cleanup", "normal", "redaction", "stale-state"] as const);

export interface CertificationRunnerManifestV1 {
  readonly v: "reelier.certification-runner-manifest/v1";
  readonly scenarioId: CertificationScenarioId;
  readonly runnerId: string;
  readonly endpointManifestDigest: string;
  readonly implementationDigest: string;
  readonly operations: typeof RUNNER_OPERATIONS_V1;
  readonly executionReady: false;
  readonly dispatchable: false;
}
export interface CertificationRunnerManifestV2 {
  readonly v: "reelier.certification-runner-manifest/v2";
  readonly scenarioId: CertificationScenarioId;
  readonly runnerId: string;
  readonly endpointManifestDigest: string;
  readonly metadataDigest: string;
  readonly registryDigest: string;
  readonly operations: typeof CERTIFICATION_RUNNER_OPERATIONS;
  readonly executionReady: false;
  readonly dispatchable: false;
}
export type CertificationRunnerManifest = CertificationRunnerManifestV1 | CertificationRunnerManifestV2;

export interface CertificationTestManifestV1 {
  readonly v: "reelier.certification-test-manifest/v1";
  readonly scenarioId: CertificationScenarioId;
  readonly suiteId: string;
  readonly runnerManifestDigest: string;
  readonly cases: typeof TEST_CASES;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export interface CertificationEndpointV2 { readonly endpointId: string; readonly provider: CertificationProvider; readonly credentialSlot: CertificationSecretSlot; readonly accountCommitment: string; readonly resourceCommitment: string; readonly direction: "read" | "write"; readonly method: Method }
export interface CertificationEndpointManifestV1 {
  readonly v: "reelier.certification-endpoint-manifest/v1";
  readonly scenarioId: CertificationScenarioId;
  readonly provider: "cloudflare" | "codex" | "fly" | "github" | "neon" | "slack" | "vercel";
  readonly resourceDigest: string;
  readonly credentialSlots: readonly (CertificationSecretSlot | "cloudflareCredential")[];
  readonly endpoints: readonly Readonly<{ endpointId: string; direction: "read" | "write"; method: Method }>[];
  readonly completeness: "unchecked";
  readonly dispatchable: false;
}
export interface CertificationEndpointManifestV2 {
  readonly v: "reelier.certification-endpoint-manifest/v2";
  readonly scenarioId: CertificationScenarioId;
  readonly definitionAliases: readonly string[];
  readonly endpoints: readonly CertificationEndpointV2[];
  readonly completeness: "unchecked";
  readonly dispatchable: false;
}
export type CertificationEndpointManifest = CertificationEndpointManifestV1 | CertificationEndpointManifestV2;

export interface CertificationScenarioPlanV1 {
  readonly v: "reelier.certification-scenario-plan/v1";
  readonly scenarioId: CertificationScenarioId;
  readonly definitionAliases: readonly string[];
  readonly sourceRefs: Readonly<Record<string, string>>;
  readonly choices: Readonly<Record<string, unknown>>;
  readonly policyCommitments: readonly Readonly<{ schemaId: string; digest: string }>[];
  readonly cleanup: Readonly<{ recipeId: string; beforeStateDigest: string }>;
  readonly controlledCut: Readonly<{ case: "ambiguous-after-dispatch" }>;
  readonly runnerManifestDigest: string;
  readonly testManifestDigest: string;
  readonly endpointManifestDigest: string;
  readonly runnerRegistryDigest: string;
}

export function parseCertificationEndpointManifest(value: unknown, expectedScenario?: CertificationScenarioId): CertificationEndpointManifest {
  const raw = object(value, "certification endpoint manifest");
  if (raw.v === "reelier.certification-endpoint-manifest/v1") return parseEndpointV1(raw, expectedScenario);
  closed(raw, ["v", "scenarioId", "definitionAliases", "endpoints", "completeness", "dispatchable"], "certification endpoint manifest v2");
  const scenarioId = scenario(raw.scenarioId);
  if (expectedScenario !== undefined && scenarioId !== expectedScenario) throw new TypeError("certification endpoint manifest scenario is invalid");
  const registry = getCertificationRunnerRegistryEntry(scenarioId);
  if (!exactList(raw.definitionAliases, registry.definitionAliases) || raw.completeness !== "unchecked" || raw.dispatchable !== registry.dispatchable || !Array.isArray(raw.endpoints) || raw.endpoints.length !== registry.endpoints.length) throw new TypeError("certification endpoint manifest v2 is invalid");
  const endpoints = raw.endpoints.map((value: unknown, index: number) => {
    const endpoint = object(value, "certification endpoint v2");
    closed(endpoint, ["endpointId", "provider", "credentialSlot", "accountCommitment", "resourceCommitment", "direction", "method"], "certification endpoint v2");
    const expected = registry.endpoints[index]!;
    if (endpoint.endpointId !== expected.endpointId || endpoint.provider !== expected.provider || endpoint.credentialSlot !== expected.credentialSlot || endpoint.direction !== expected.direction || endpoint.method !== expected.method || !digest(endpoint.accountCommitment) || !digest(endpoint.resourceCommitment)) throw new TypeError("certification endpoint does not match reviewed static pack registration");
    return Object.freeze({ endpointId: expected.endpointId, provider: expected.provider, credentialSlot: expected.credentialSlot, accountCommitment: endpoint.accountCommitment, resourceCommitment: endpoint.resourceCommitment, direction: expected.direction, method: expected.method });
  });
  return Object.freeze({ v: "reelier.certification-endpoint-manifest/v2", scenarioId, definitionAliases: registry.definitionAliases, endpoints: Object.freeze(endpoints), completeness: "unchecked", dispatchable: false });
}

function parseEndpointV1(raw: Record<string, any>, expectedScenario?: CertificationScenarioId): CertificationEndpointManifestV1 {
  closed(raw, ["v", "scenarioId", "provider", "resourceDigest", "credentialSlots", "endpoints", "completeness"], "certification endpoint manifest v1");
  const scenarioId = scenario(raw.scenarioId);
  const providers = ["cloudflare", "codex", "fly", "github", "neon", "slack", "vercel"] as const;
  const expectedProvider = scenarioId.startsWith("cloudflare-") ? "cloudflare" : scenarioId.startsWith("codex-") ? "codex" : scenarioId.startsWith("fly-") ? "fly" : scenarioId.startsWith("github-") ? "github" : scenarioId.startsWith("neon-") ? "neon" : scenarioId.startsWith("slack-") ? "slack" : "vercel";
  const expectedSlots = CERTIFICATION_SCENARIOS[scenarioId].secretSlots.map(slot => slot === "cloudflareDnsCredential" || slot === "cloudflareBootstrapCredential" ? "cloudflareCredential" : slot);
  if ((expectedScenario !== undefined && scenarioId !== expectedScenario) || typeof raw.provider !== "string" || !providers.includes(raw.provider as typeof providers[number]) || raw.provider !== expectedProvider || !digest(raw.resourceDigest) || !exactList(raw.credentialSlots, expectedSlots) || raw.completeness !== "unchecked" || !Array.isArray(raw.endpoints) || raw.endpoints.length === 0) throw new TypeError("certification endpoint manifest v1 is invalid");
  const endpoints = raw.endpoints.map((value: unknown) => { const endpoint = object(value, "certification endpoint"); closed(endpoint, ["endpointId", "direction", "method"], "certification endpoint"); if (typeof endpoint.endpointId !== "string" || !/^[a-z][a-z0-9_.-]{2,127}$/.test(endpoint.endpointId) || (endpoint.direction !== "read" && endpoint.direction !== "write") || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(endpoint.method))) throw new TypeError("certification endpoint is invalid"); return Object.freeze({ endpointId: endpoint.endpointId, direction: endpoint.direction, method: endpoint.method as Method }); });
  const identities = endpoints.map(endpoint => endpoint.endpointId); if (new Set(identities).size !== identities.length || identities.some((item, index) => index > 0 && identities[index - 1]! >= item)) throw new TypeError("certification endpoints must be unique and sorted");
  return Object.freeze({ v: "reelier.certification-endpoint-manifest/v1", scenarioId, provider: raw.provider, resourceDigest: raw.resourceDigest, credentialSlots: Object.freeze([...expectedSlots]), endpoints: Object.freeze(endpoints), completeness: "unchecked", dispatchable: false });
}

export function parseCertificationRunnerManifest(value: unknown, expectedScenario?: CertificationScenarioId): CertificationRunnerManifest {
  const raw = object(value, "certification runner manifest");
  if (raw.v === "reelier.certification-runner-manifest/v1") {
    closed(raw, ["v", "scenarioId", "runnerId", "endpointManifestDigest", "implementationDigest", "operations"], "certification runner manifest v1");
    const scenarioId = scenario(raw.scenarioId);
    if ((expectedScenario !== undefined && scenarioId !== expectedScenario) || typeof raw.runnerId !== "string" || !ID.test(raw.runnerId) || !digest(raw.endpointManifestDigest) || !digest(raw.implementationDigest) || !exactList(raw.operations, RUNNER_OPERATIONS_V1)) throw new TypeError("certification runner manifest v1 is invalid");
    return Object.freeze({ v: "reelier.certification-runner-manifest/v1", scenarioId, runnerId: raw.runnerId, endpointManifestDigest: raw.endpointManifestDigest, implementationDigest: raw.implementationDigest, operations: RUNNER_OPERATIONS_V1, executionReady: false, dispatchable: false });
  }
  closed(raw, ["v", "scenarioId", "runnerId", "endpointManifestDigest", "metadataDigest", "registryDigest", "operations", "executionReady", "dispatchable"], "certification runner manifest v2");
  const scenarioId = scenario(raw.scenarioId);
  const registry = getCertificationRunnerRegistryEntry(scenarioId);
  if (raw.v !== "reelier.certification-runner-manifest/v2" || (expectedScenario !== undefined && scenarioId !== expectedScenario) || raw.runnerId !== registry.runnerId || !digest(raw.endpointManifestDigest) || raw.metadataDigest !== registry.metadataDigest || raw.registryDigest !== certificationRunnerRegistryDigest || !exactList(raw.operations, CERTIFICATION_RUNNER_OPERATIONS) || raw.executionReady !== false || raw.dispatchable !== false) throw new TypeError("certification runner manifest v2 does not match built-in registry metadata");
  return Object.freeze({ v: "reelier.certification-runner-manifest/v2", scenarioId, runnerId: registry.runnerId, endpointManifestDigest: raw.endpointManifestDigest, metadataDigest: registry.metadataDigest, registryDigest: certificationRunnerRegistryDigest, operations: CERTIFICATION_RUNNER_OPERATIONS, executionReady: false, dispatchable: false });
}

export function parseCertificationTestManifest(value: unknown, expectedScenario?: CertificationScenarioId, expectedRunnerDigest?: string): CertificationTestManifestV1 {
  const raw = object(value, "certification test manifest"); closed(raw, ["v", "scenarioId", "suiteId", "runnerManifestDigest", "cases"], "certification test manifest"); const scenarioId = scenario(raw.scenarioId);
  if (raw.v !== "reelier.certification-test-manifest/v1" || (expectedScenario !== undefined && scenarioId !== expectedScenario) || typeof raw.suiteId !== "string" || !ID.test(raw.suiteId) || !digest(raw.runnerManifestDigest) || (expectedRunnerDigest !== undefined && raw.runnerManifestDigest !== expectedRunnerDigest) || !exactList(raw.cases, TEST_CASES)) throw new TypeError("certification test manifest is invalid");
  return Object.freeze({ v: raw.v, scenarioId, suiteId: raw.suiteId, runnerManifestDigest: raw.runnerManifestDigest, cases: TEST_CASES });
}

export function parseCertificationScenarioPlan(value: unknown, selectedScenarios: readonly CertificationScenarioId[]): CertificationScenarioPlanV1 {
  const raw = object(value, "certification scenario plan");
  closed(raw, ["v", "scenarioId", "definitionAliases", "sourceRefs", "choices", "policyCommitments", "cleanup", "controlledCut", "runnerManifestDigest", "testManifestDigest", "endpointManifestDigest", "runnerRegistryDigest"], "certification scenario plan");
  const scenarioId = scenario(raw.scenarioId);
  if (raw.v !== "reelier.certification-scenario-plan/v1" || !selectedScenarios.includes(scenarioId)) throw new TypeError("certification scenario plan is not selected");
  const registry = getCertificationRunnerRegistryEntry(scenarioId);
  if (!exactList(raw.definitionAliases, registry.definitionAliases) || raw.runnerRegistryDigest !== certificationRunnerRegistryDigest) throw new TypeError("certification scenario plan registry or definition alias is invalid");
  const sourceRefs = stringRecord(raw.sourceRefs, "scenario source refs");
  const choices = safeChoices(raw.choices);
  if (!Array.isArray(raw.policyCommitments) || raw.policyCommitments.length === 0) throw new TypeError("certification policy commitments are invalid");
  const policyCommitments = raw.policyCommitments.map(value => { const item = object(value, "certification policy commitment"); closed(item, ["schemaId", "digest"], "certification policy commitment"); if (typeof item.schemaId !== "string" || !ID.test(item.schemaId) || !digest(item.digest)) throw new TypeError("certification policy commitment is invalid"); return Object.freeze({ schemaId: item.schemaId, digest: item.digest }); });
  const cleanup = object(raw.cleanup, "certification cleanup recipe"); closed(cleanup, ["recipeId", "beforeStateDigest"], "certification cleanup recipe"); if (typeof cleanup.recipeId !== "string" || !TEXT.test(cleanup.recipeId) || !digest(cleanup.beforeStateDigest)) throw new TypeError("certification cleanup recipe is invalid");
  const controlledCut = object(raw.controlledCut, "certification controlled cut"); closed(controlledCut, ["case"], "certification controlled cut"); if (controlledCut.case !== "ambiguous-after-dispatch") throw new TypeError("certification controlled-cut case is invalid");
  for (const [name, value] of [["runner", raw.runnerManifestDigest], ["test", raw.testManifestDigest], ["endpoint", raw.endpointManifestDigest]] as const) if (!digest(value)) throw new TypeError(`certification ${name} manifest digest is invalid`);
  return Object.freeze({ v: "reelier.certification-scenario-plan/v1", scenarioId, definitionAliases: registry.definitionAliases, sourceRefs, choices, policyCommitments: Object.freeze(policyCommitments), cleanup: Object.freeze({ recipeId: cleanup.recipeId, beforeStateDigest: cleanup.beforeStateDigest }), controlledCut: Object.freeze({ case: "ambiguous-after-dispatch" }), runnerManifestDigest: raw.runnerManifestDigest, testManifestDigest: raw.testManifestDigest, endpointManifestDigest: raw.endpointManifestDigest, runnerRegistryDigest: certificationRunnerRegistryDigest });
}

function safeChoices(value: unknown): Readonly<Record<string, unknown>> { const raw = object(value, "certification desired choices"); rejectAccessors(raw, "choices"); rejectDangerous(raw, "choices"); return deepFreeze(structuredClone(raw)); }
function rejectAccessors(value: unknown, label: string): void { if (!value || typeof value !== "object") return; for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) { if (descriptor.get || descriptor.set) throw new TypeError(`certification ${label} contains an accessor or executable field`); if ("value" in descriptor) rejectAccessors(descriptor.value, label); } }
function rejectDangerous(value: unknown, label: string): void { if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint" || value === undefined) throw new TypeError(`certification ${label} contains executable or unsupported data`); if (typeof value === "string") { if (/bearer\s|(?:password|secret|token|private[-_ ]?key)[:=]/i.test(value) || /(?:^|[._-])(cmd|command|callback|function|module|path|source|code)(?:$|[._-])/i.test(value)) throw new TypeError(`certification ${label} contains secret-shaped or executable data`); return; } if (Array.isArray(value)) { for (const item of value) rejectDangerous(item, label); return; } if (value && typeof value === "object") { const raw = value as Record<string, unknown>; for (const [key, item] of Object.entries(raw)) { if (/(?:secret|token|password|authorization|cookie|callback|function|module|path|command|sourcecode|code)/i.test(key)) throw new TypeError(`certification ${label} contains secret-shaped or executable fields`); rejectDangerous(item, label); } } }
function stringRecord(value: unknown, label: string): Readonly<Record<string, string>> { const raw = object(value, label); if (Object.keys(raw).length === 0) throw new TypeError(`${label} is invalid`); const result: Record<string, string> = {}; for (const key of Object.keys(raw).sort()) { if (!ID.test(key) || typeof raw[key] !== "string" || !TEXT.test(raw[key]) || /bearer|secret|token|password/i.test(raw[key])) throw new TypeError(`${label} contains secret-shaped or invalid data`); result[key] = raw[key]; } return Object.freeze(result); }
function deepFreeze<T>(value: T): T { if (value && typeof value === "object") { Object.freeze(value); for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); } return value; }
function exactList(value: unknown, expected: readonly string[]): boolean { return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]); }
function digest(value: unknown): value is string { return typeof value === "string" && DIGEST.test(value); }
function scenario(value: unknown): CertificationScenarioId { if (typeof value !== "string" || !(CERTIFICATION_SCENARIO_IDS as readonly string[]).includes(value)) throw new TypeError("certification manifest scenario is invalid"); return value as CertificationScenarioId; }
function object(value: unknown, label: string): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a closed plain object`); return value as Record<string, any>; }
function closed(raw: Record<string, unknown>, keys: readonly string[], label: string): void { const own = Reflect.ownKeys(raw); if (own.some(key => typeof key !== "string") || own.length !== keys.length || own.some(key => !keys.includes(key as string))) throw new TypeError(`${label} is closed`); }
