import { CERTIFICATION_SCENARIOS, CERTIFICATION_SCENARIO_IDS, type CertificationScenarioId, type CertificationSecretSlot } from "./scenarios.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ID = /^[a-z][a-z0-9_]{2,127}$/;
const RUNNER_OPERATIONS = Object.freeze(["prepare", "authoritative-read", "compile", "reserve", "reread", "dispatch", "reconcile", "receipt", "cleanup"] as const);
const TEST_CASES = Object.freeze(["account-binding", "ambiguity", "cleanup", "normal", "redaction", "stale-state"] as const);

export interface CertificationRunnerManifestV1 {
  readonly v: "reelier.certification-runner-manifest/v1";
  readonly scenarioId: CertificationScenarioId;
  readonly runnerId: string;
  readonly endpointManifestDigest: string;
  readonly implementationDigest: string;
  readonly operations: typeof RUNNER_OPERATIONS;
}

export interface CertificationTestManifestV1 {
  readonly v: "reelier.certification-test-manifest/v1";
  readonly scenarioId: CertificationScenarioId;
  readonly suiteId: string;
  readonly runnerManifestDigest: string;
  readonly cases: typeof TEST_CASES;
}

export interface CertificationEndpointManifestV1 {
  readonly v: "reelier.certification-endpoint-manifest/v1";
  readonly scenarioId: CertificationScenarioId;
  readonly provider: "cloudflare" | "codex" | "fly" | "github" | "neon" | "slack" | "vercel";
  readonly resourceDigest: string;
  readonly credentialSlots: readonly CertificationSecretSlot[];
  readonly endpoints: readonly Readonly<{ endpointId: string; direction: "read" | "write"; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" }>[];
  readonly completeness: "unchecked";
}

export function parseCertificationEndpointManifest(value: unknown, expectedScenario?: CertificationScenarioId): CertificationEndpointManifestV1 {
  const raw = object(value, "certification endpoint manifest");
  closed(raw, ["v", "scenarioId", "provider", "resourceDigest", "credentialSlots", "endpoints", "completeness"], "certification endpoint manifest");
  const scenarioId = scenario(raw.scenarioId);
  const providers = ["cloudflare", "codex", "fly", "github", "neon", "slack", "vercel"] as const;
  const expectedSlots = CERTIFICATION_SCENARIOS[scenarioId].secretSlots;
  if (raw.v !== "reelier.certification-endpoint-manifest/v1" || (expectedScenario !== undefined && scenarioId !== expectedScenario) || typeof raw.provider !== "string" || !providers.includes(raw.provider as typeof providers[number]) || !digest(raw.resourceDigest) || !exactList(raw.credentialSlots, expectedSlots) || raw.completeness !== "unchecked" || !Array.isArray(raw.endpoints) || raw.endpoints.length === 0) throw new TypeError("certification endpoint manifest is invalid");
  const endpoints = raw.endpoints.map((value: unknown) => {
    const endpoint = object(value, "certification endpoint");
    closed(endpoint, ["endpointId", "direction", "method"], "certification endpoint");
    if (typeof endpoint.endpointId !== "string" || !/^[a-z][a-z0-9_.-]{2,127}$/.test(endpoint.endpointId) || (endpoint.direction !== "read" && endpoint.direction !== "write") || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(endpoint.method))) throw new TypeError("certification endpoint is invalid");
    return Object.freeze({ endpointId: endpoint.endpointId, direction: endpoint.direction, method: endpoint.method });
  });
  const identities = endpoints.map(endpoint => endpoint.endpointId);
  if (new Set(identities).size !== identities.length || identities.some((item, index) => index > 0 && identities[index - 1]! >= item)) throw new TypeError("certification endpoints must be unique and sorted");
  return Object.freeze({ v: raw.v, scenarioId, provider: raw.provider as CertificationEndpointManifestV1["provider"], resourceDigest: raw.resourceDigest, credentialSlots: Object.freeze([...expectedSlots]), endpoints: Object.freeze(endpoints), completeness: "unchecked" });
}

export function parseCertificationRunnerManifest(value: unknown, expectedScenario?: CertificationScenarioId): CertificationRunnerManifestV1 {
  const raw = object(value, "certification runner manifest");
  closed(raw, ["v", "scenarioId", "runnerId", "endpointManifestDigest", "implementationDigest", "operations"], "certification runner manifest");
  const scenarioId = scenario(raw.scenarioId);
  if (raw.v !== "reelier.certification-runner-manifest/v1" || (expectedScenario !== undefined && scenarioId !== expectedScenario) || typeof raw.runnerId !== "string" || !ID.test(raw.runnerId) || !digest(raw.endpointManifestDigest) || !digest(raw.implementationDigest) || !exactList(raw.operations, RUNNER_OPERATIONS)) throw new TypeError("certification runner manifest is invalid");
  return Object.freeze({ v: raw.v, scenarioId, runnerId: raw.runnerId, endpointManifestDigest: raw.endpointManifestDigest, implementationDigest: raw.implementationDigest, operations: RUNNER_OPERATIONS });
}

export function parseCertificationTestManifest(value: unknown, expectedScenario?: CertificationScenarioId, expectedRunnerDigest?: string): CertificationTestManifestV1 {
  const raw = object(value, "certification test manifest");
  closed(raw, ["v", "scenarioId", "suiteId", "runnerManifestDigest", "cases"], "certification test manifest");
  const scenarioId = scenario(raw.scenarioId);
  if (raw.v !== "reelier.certification-test-manifest/v1" || (expectedScenario !== undefined && scenarioId !== expectedScenario) || typeof raw.suiteId !== "string" || !ID.test(raw.suiteId) || !digest(raw.runnerManifestDigest) || (expectedRunnerDigest !== undefined && raw.runnerManifestDigest !== expectedRunnerDigest) || !exactList(raw.cases, TEST_CASES)) throw new TypeError("certification test manifest is invalid");
  return Object.freeze({ v: raw.v, scenarioId, suiteId: raw.suiteId, runnerManifestDigest: raw.runnerManifestDigest, cases: TEST_CASES });
}

function exactList(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}
function digest(value: unknown): value is string { return typeof value === "string" && DIGEST.test(value); }
function scenario(value: unknown): CertificationScenarioId { if (typeof value !== "string" || !(CERTIFICATION_SCENARIO_IDS as readonly string[]).includes(value)) throw new TypeError("certification manifest scenario is invalid"); return value as CertificationScenarioId; }
function object(value: unknown, label: string): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Record<string, any>; }
function closed(raw: Record<string, unknown>, keys: readonly string[], label: string): void { if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) throw new TypeError(`${label} is closed`); }
