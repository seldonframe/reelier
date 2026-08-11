import path from "node:path";
import { authorityDigest } from "../wire.js";
import type { CertificationIdentifiers } from "./initializer.js";
import { preflightCertification, type CertificationInputSet, type CertificationPreflightV2 } from "./preflight.js";
import { CERTIFICATION_SCENARIOS, CERTIFICATION_SCENARIO_IDS, type CertificationScenarioId, type CertificationSecretSlot } from "./scenarios.js";
import { certificationWorkspaceRoot, publishPrivateContentAddressed, readConfinedFile, confinedExistingDirectory } from "./filesystem.js";

export interface CertificationReadinessCandidate {
  readonly v: "reelier.certification-readiness-candidate/v1";
  readonly status: "awaiting-human-signature";
  readonly preparationReady: true;
  readonly signatureStatus: "absent";
  readonly authorization: "absent";
  readonly dispatchable: false;
  readonly completeness: "unchecked";
  readonly configDigest: string;
  readonly selectionDigest: string;
  readonly preflightDigest: string;
  readonly scenarios: readonly CertificationScenarioId[];
  readonly identifiers: CertificationIdentifiers;
  readonly commitments: Readonly<{
    resources: readonly { readonly scenario: CertificationScenarioId; readonly digest: string; readonly status: "configured" | "missing" }[];
    cleanup: readonly { readonly scenario: CertificationScenarioId; readonly digest: string; readonly status: "configured" | "missing" }[];
    credentials: readonly { readonly slot: string; readonly status: "configured" | "missing" }[];
    runners: CertificationInputSet;
    tests: CertificationInputSet;
    topology: "configured" | "absent";
    signatureStatus: "absent";
  }>;
}

export async function sealCertificationReadiness(input: Readonly<{ workspace: string; scenario?: string; all?: boolean }>): Promise<Readonly<{ candidate: CertificationReadinessCandidate; digest: string; path: string }>> {
  const workspace = path.resolve(input.workspace);
  const root = await certificationWorkspaceRoot(workspace);
  const preflight = await preflightCertification(input);
  const created = createCertificationReadinessCandidate(preflight);
  const { candidate, digest } = created;
  const filename = `readiness-${digest.replace(":", "-")}.json`;
  const output = await publishPrivateContentAddressed(root, "readiness", filename, `${JSON.stringify(candidate)}\n`);
  const safeDirectory = await confinedExistingDirectory(root, ["readiness"]);
  if (!safeDirectory) throw new TypeError("certification readiness directory is absent after publication");
  const existing = JSON.parse((await readConfinedFile(root, safeDirectory, filename)).toString("utf8"));
  if (authorityDigest(existing) !== digest || JSON.stringify(existing) !== JSON.stringify(candidate)) throw new TypeError("immutable readiness candidate mismatch");
  return Object.freeze({ candidate, digest, path: output });
}

export function createCertificationReadinessCandidate(preflight: CertificationPreflightV2): Readonly<{ candidate: CertificationReadinessCandidate; digest: string }> {
  if (!preflight.preparationReady) throw new TypeError("certification preparation is incomplete and cannot be sealed");
  // This local candidate never upgrades preflight's unchecked trust into an authority claim.
  const candidate: CertificationReadinessCandidate = Object.freeze({
    v: "reelier.certification-readiness-candidate/v1",
    status: "awaiting-human-signature",
    preparationReady: true,
    signatureStatus: "absent",
    authorization: "absent",
    dispatchable: false,
    completeness: "unchecked",
    configDigest: preflight.configDigest,
    selectionDigest: preflight.selectionDigest,
    preflightDigest: preflight.digest,
    scenarios: preflight.scenarios,
    identifiers: preflight.identifiers,
    commitments: Object.freeze({ resources: preflight.resources, cleanup: preflight.cleanup, credentials: preflight.credentialReferences, runners: preflight.inputs.runners, tests: preflight.inputs.tests, topology: preflight.topology, signatureStatus: "absent" }),
  });
  const digest = authorityDigest(candidate);
  return Object.freeze({ candidate, digest });
}

/** Single deep parser for the Task2C2 readiness artifact and its exact preflight snapshot. */
export function parseCertificationReadinessCandidate(value: unknown, preflightValue: unknown): CertificationReadinessCandidate {
  const preflight = parseBoundPreflight(preflightValue);
  const raw = object(value, "certification readiness candidate");
  closed(raw, ["v", "status", "preparationReady", "signatureStatus", "authorization", "dispatchable", "completeness", "configDigest", "selectionDigest", "preflightDigest", "scenarios", "identifiers", "commitments"], "certification readiness candidate");
  if (raw.v !== "reelier.certification-readiness-candidate/v1" || raw.status !== "awaiting-human-signature" || raw.preparationReady !== true || raw.signatureStatus !== "absent" || raw.authorization !== "absent" || raw.dispatchable !== false || raw.completeness !== "unchecked") throw new TypeError("certification readiness candidate cannot confer authority");
  const commitmentsRaw = object(raw.commitments, "readiness commitments");
  closed(commitmentsRaw, ["resources", "cleanup", "credentials", "runners", "tests", "topology", "signatureStatus"], "readiness commitments");
  if (commitmentsRaw.signatureStatus !== "absent") throw new TypeError("readiness commitment signature status is invalid");
  const candidate: CertificationReadinessCandidate = Object.freeze({
    v: raw.v, status: raw.status, preparationReady: true, signatureStatus: raw.signatureStatus, authorization: raw.authorization, dispatchable: false, completeness: raw.completeness,
    configDigest: assertDigest(raw.configDigest, "readiness configuration root"), selectionDigest: assertDigest(raw.selectionDigest, "readiness selection digest"), preflightDigest: assertDigest(raw.preflightDigest, "readiness preflight digest"),
    scenarios: scenarioList(raw.scenarios), identifiers: parseIdentifiers(raw.identifiers),
    commitments: Object.freeze({ resources: commitmentList(commitmentsRaw.resources, "resources"), cleanup: commitmentList(commitmentsRaw.cleanup, "cleanup"), credentials: credentialList(commitmentsRaw.credentials), runners: inputSet(commitmentsRaw.runners), tests: inputSet(commitmentsRaw.tests), topology: enumValue(commitmentsRaw.topology, ["configured", "absent"], "readiness topology"), signatureStatus: "absent" }),
  });
  if (candidate.configDigest !== preflight.configDigest || candidate.selectionDigest !== preflight.selectionDigest || candidate.preflightDigest !== preflight.digest || authorityDigest(candidate.identifiers) !== authorityDigest(preflight.identifiers) || authorityDigest(candidate.scenarios) !== authorityDigest(preflight.scenarios)) throw new TypeError("certification readiness preflight generated identifier identity link is invalid");
  if (JSON.stringify(candidate.commitments.resources) !== JSON.stringify(preflight.resources) || JSON.stringify(candidate.commitments.cleanup) !== JSON.stringify(preflight.cleanup) || JSON.stringify(candidate.commitments.credentials) !== JSON.stringify(preflight.credentialReferences) || JSON.stringify(candidate.commitments.runners) !== JSON.stringify(preflight.inputs.runners) || JSON.stringify(candidate.commitments.tests) !== JSON.stringify(preflight.inputs.tests) || candidate.commitments.topology !== preflight.topology || candidate.commitments.signatureStatus !== preflight.signatureStatus) throw new TypeError("certification readiness commitment and preflight link is invalid");
  return candidate;
}

function parseBoundPreflight(value: unknown): CertificationPreflightV2 {
  const raw = object(value, "certification preflight");
  closed(raw, ["v", "configDigest", "selectionDigest", "identifiers", "scenarios", "resources", "cleanup", "credentialReferences", "inputs", "topology", "trust", "signatureStatus", "authorization", "completeness", "missing", "ok", "preparationReady", "digest"], "certification preflight");
  if (raw.v !== "reelier.certification-preflight/v2" || raw.trust !== "unchecked" || raw.signatureStatus !== "absent" || raw.authorization !== "absent" || raw.completeness !== "unchecked" || raw.ok !== true || raw.preparationReady !== true) throw new TypeError("certification readiness requires a complete unchecked preflight");
  const inputsRaw = object(raw.inputs, "certification preflight inputs");
  closed(inputsRaw, ["runners", "tests"], "certification preflight inputs");
  const body = Object.freeze({
    v: raw.v, configDigest: assertDigest(raw.configDigest, "preflight configuration root"), selectionDigest: assertDigest(raw.selectionDigest, "preflight selection digest"), identifiers: parseIdentifiers(raw.identifiers), scenarios: scenarioList(raw.scenarios), resources: commitmentList(raw.resources, "resources"), cleanup: commitmentList(raw.cleanup, "cleanup"), credentialReferences: credentialList(raw.credentialReferences), inputs: Object.freeze({ runners: inputSet(inputsRaw.runners), tests: inputSet(inputsRaw.tests) }), topology: enumValue(raw.topology, ["configured", "absent"], "preflight topology"), trust: "unchecked" as const, signatureStatus: "absent" as const, authorization: "absent" as const, completeness: "unchecked" as const, missing: stringList(raw.missing, "preflight missing"), ok: true as const, preparationReady: true as const,
  });
  if (body.missing.length !== 0) throw new TypeError("certification preflight semantic missing-requirements mismatch");
  const digest = assertDigest(raw.digest, "preflight digest");
  if (digest !== authorityDigest(body)) throw new TypeError("certification preflight digest is invalid");
  return Object.freeze({ ...body, digest });
}

function parseIdentifiers(value: unknown): CertificationIdentifiers { const raw = object(value, "certification identifiers"); closed(raw, ["taskId", "jobCardId", "rootGrantId", "authorityCellId", "signerId"], "certification identifiers"); const patterns: Record<keyof CertificationIdentifiers, RegExp> = { taskId: /^task_[0-9a-f]{24}$/, jobCardId: /^job_[0-9a-f]{24}$/, rootGrantId: /^grant_[0-9a-f]{24}$/, authorityCellId: /^cell_[0-9a-f]{24}$/, signerId: /^signer_[0-9a-f]{24}$/ }; for (const [key, pattern] of Object.entries(patterns) as [keyof CertificationIdentifiers, RegExp][]) if (typeof raw[key] !== "string" || !pattern.test(raw[key] as string)) throw new TypeError("certification identifier is invalid"); return Object.freeze({ taskId: raw.taskId, jobCardId: raw.jobCardId, rootGrantId: raw.rootGrantId, authorityCellId: raw.authorityCellId, signerId: raw.signerId }) as CertificationIdentifiers; }
function scenarioList(value: unknown): readonly CertificationScenarioId[] { if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== "string" || !(CERTIFICATION_SCENARIO_IDS as readonly string[]).includes(item))) throw new TypeError("certification scenarios are invalid"); const result = value as CertificationScenarioId[]; if (new Set(result).size !== result.length || result.some((item, index) => index > 0 && result[index - 1] >= item)) throw new TypeError("certification scenarios must be unique and sorted"); return Object.freeze([...result]); }
function commitmentList(value: unknown, label: string): readonly { scenario: CertificationScenarioId; digest: string; status: "configured" | "missing" }[] { if (!Array.isArray(value)) throw new TypeError(`certification ${label} commitments must be an array`); const result = value.map(item => { const raw = object(item, `certification ${label} commitment`); closed(raw, ["scenario", "digest", "status"], `certification ${label} commitment`); return Object.freeze({ scenario: scenarioId(raw.scenario), digest: assertDigest(raw.digest, `${label} commitment digest`), status: enumValue(raw.status, ["configured", "missing"], `${label} commitment status`) }); }); assertUniqueSorted(result.map(item => item.scenario), `${label} commitments`); return Object.freeze(result); }
function credentialList(value: unknown): readonly { slot: CertificationSecretSlot; status: "configured" | "missing" }[] { if (!Array.isArray(value)) throw new TypeError("certification credential commitments must be an array"); const allowed = new Set(Object.values(CERTIFICATION_SCENARIOS).flatMap(definition => definition.secretSlots)); const result = value.map(item => { const raw = object(item, "certification credential commitment"); closed(raw, ["slot", "status"], "certification credential commitment"); if (typeof raw.slot !== "string" || !allowed.has(raw.slot as CertificationSecretSlot)) throw new TypeError("certification credential slot is invalid"); return Object.freeze({ slot: raw.slot as CertificationSecretSlot, status: enumValue(raw.status, ["configured", "missing"], "credential commitment status") }); }); assertUniqueSorted(result.map(item => item.slot), "credential commitments"); return Object.freeze(result); }
function inputSet(value: unknown): CertificationInputSet { const raw = object(value, "certification input set"); closed(raw, ["status", "artifacts"], "certification input set"); if (!Array.isArray(raw.artifacts)) throw new TypeError("certification input artifacts must be an array"); const artifacts = raw.artifacts.map(item => { const artifact = object(item, "certification input artifact"); closed(artifact, ["scenario", "name", "digest"], "certification input artifact"); const scenario = scenarioId(artifact.scenario); if (typeof artifact.name !== "string" || !(artifact.name === `${scenario}.json` || artifact.name.startsWith(`${scenario}--`)) || !artifact.name.endsWith(".json")) throw new TypeError("certification input artifact name is invalid"); return Object.freeze({ scenario, name: artifact.name, digest: assertDigest(artifact.digest, "input artifact digest") }); }); assertUniqueSorted(artifacts.map(item => `${item.name}\0${item.digest}`), "input artifacts"); return Object.freeze({ status: enumValue(raw.status, ["configured", "absent"], "input status"), artifacts: Object.freeze(artifacts) }); }
function scenarioId(value: unknown): CertificationScenarioId { if (typeof value !== "string" || !(CERTIFICATION_SCENARIO_IDS as readonly string[]).includes(value)) throw new TypeError("certification scenario is invalid"); return value as CertificationScenarioId; }
function stringList(value: unknown, label: string): readonly string[] { if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new TypeError(`certification ${label} is invalid`); const result = value as string[]; assertUniqueSorted(result, label); return Object.freeze([...result]); }
function assertUniqueSorted(values: readonly string[], label: string): void { if (new Set(values).size !== values.length || values.some((item, index) => index > 0 && values[index - 1] >= item)) throw new TypeError(`certification ${label} must be unique and sorted`); }
function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T { if (typeof value !== "string" || !values.includes(value as T)) throw new TypeError(`certification ${label} is invalid`); return value as T; }
function assertDigest(value: unknown, label: string): string { if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function object(value: unknown, label: string): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Record<string, any>; }
function closed(raw: Record<string, unknown>, keys: readonly string[], label: string): void { if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) throw new TypeError(`${label} is closed`); }
