import { CERTIFICATION_SCENARIO_IDS, type CertificationScenarioId } from "./scenarios.js";

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
