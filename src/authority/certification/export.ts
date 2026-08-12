import path from "node:path";
import { authorityDigest } from "../wire.js";
import { parseCertificationOperatorConfigV3 } from "./config.js";
import { deriveCertificationIdentifiers, parseCertificationInitialization, validateCertificationInitialization } from "./initializer.js";
import { preflightCertification } from "./preflight.js";
import { createCertificationReadinessCandidate, parseCertificationReadinessCandidate } from "./readiness.js";
import { CERTIFICATION_SCENARIOS, CERTIFICATION_SCENARIO_IDS, type CertificationScenarioId } from "./scenarios.js";
import { certificationWorkspaceRoot, confinedExistingDirectory, publishPrivateContentAddressed, readConfinedFile } from "./filesystem.js";
import { createCertificationSelectionCommitment, recomputeCertificationSelectionCommitment } from "./commitment.js";
import { CERTIFICATION_PROVIDER_SCENARIO_IDS, certificationRunnerRegistryDigest } from "./runner-registry.js";
import { inertArray, inertRecord } from "./inert.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
// Local filesystem checks are preparation evidence only; no export claim verifies exclusive confinement.
const CLAIMS = Object.freeze({ providerCertification: "unchecked" as const, signatureVerification: "unchecked" as const, completion: "unchecked" as const, completeness: "unchecked" as const });
const RESOURCE_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "cloudflare-dns": ["apiBaseUrl", "accountId", "zoneId", "recordId", "recordName"],
  "cloudflare-vercel-secret": ["cloudflareApiBaseUrl", "cloudflareAccountId", "tokenName", "vercelApiBaseUrl", "vercelAccountId", "projectId"],
  "github-issue-labels": ["apiBaseUrl", "owner", "repository", "issueNumber"],
  "neon-migration": ["apiBaseUrl", "accountId", "projectId", "branchId", "database", "role"],
  "slack-topic": ["apiBaseUrl", "teamId", "channelId"],
  "vercel-promotion": ["apiBaseUrl", "accountId", "projectId", "deploymentId", "domains"],
});

export async function exportCertificationEvidence(input: Readonly<{ workspace: string; scenario?: string; all?: boolean; hooks?: Readonly<{ afterPreflight?: () => Promise<void> }> }>): Promise<Readonly<{ digest: string; path: string }>> {
  const workspace = path.resolve(input.workspace);
  const workspaceRoot = await certificationWorkspaceRoot(workspace);
  const config = parseCertificationOperatorConfigV3(JSON.parse((await readConfinedFile(workspaceRoot, workspaceRoot, "config.json")).toString("utf8")));
  const initialization = parseCertificationInitialization(JSON.parse((await readConfinedFile(workspaceRoot, workspaceRoot, "initialization.json")).toString("utf8")));
  validateCertificationInitialization(config, initialization);
  const selection = { workspace, ...(input.scenario === undefined ? {} : { scenario: input.scenario }), ...(input.all === undefined ? {} : { all: input.all }) };
  const preflight = await preflightCertification(selection);
  await input.hooks?.afterPreflight?.();
  const readiness = createCertificationReadinessCandidate(preflight).candidate;
  const confirmation = await preflightCertification(selection);
  if (confirmation.digest !== preflight.digest) throw new TypeError("certification input drift changed the bound snapshot before publication");
  const commitment = createCertificationSelectionCommitment(config, preflight.scenarios, initialization.configDigest);
  if (commitment.selectionDigest !== preflight.selectionDigest || preflight.configDigest !== initialization.configDigest || authorityDigest(preflight.identifiers) !== authorityDigest(initialization.identifiers)) throw new TypeError("certification selection or initialization commitment changed before export");
  const projectedConfig = Object.freeze({
    v: "reelier.certification-export-config/v3" as const,
    configDigest: initialization.configDigest,
    sanitizedProjectionDigest: commitment.sanitizedProjectionDigest,
    selectionDigest: commitment.selectionDigest,
    scenarios: commitment.projection.scenarios,
    resources: commitment.projection.resources,
    cleanup: commitment.projection.cleanup,
    desiredState: commitment.projection.desiredState,
    metadata: commitment.projection.metadata,
    credentialReferences: commitment.projection.credentialReferences,
  });
  const artifacts = Object.freeze({ config: projectedConfig, initialization, preflight, readiness });
  const artifactDigests = Object.freeze({ config: authorityDigest(projectedConfig), initialization: authorityDigest(initialization), preflight: authorityDigest(preflight), readiness: authorityDigest(readiness) });
  const manifest = Object.freeze({ v: "reelier.certification-export-manifest/v1" as const, artifactDigests, scenarios: preflight.scenarios, claims: CLAIMS });
  const body = Object.freeze({ v: "reelier.certification-export/v1" as const, manifest, artifacts });
  const digest = authorityDigest(body);
  const bundle = Object.freeze({ ...body, digest });
  verifyCertificationExport(bundle);
  const root = workspaceRoot;
  const filename = `certification-export-${digest.replace(":", "-")}.json`;
  const output = await publishPrivateContentAddressed(root, "exports", filename, `${JSON.stringify(bundle)}\n`);
  const directory = await confinedExistingDirectory(root, ["exports"]);
  if (!directory) throw new TypeError("certification export directory is absent after publication");
  const existing = JSON.parse((await readConfinedFile(root, directory, filename)).toString("utf8"));
  if (JSON.stringify(existing) !== JSON.stringify(bundle)) throw new TypeError("immutable certification export mismatch");
  return Object.freeze({ digest, path: output });
}

export function verifyCertificationExport(value: unknown): Readonly<{ digest: string; claims: typeof CLAIMS; authorization: "absent"; dispatchable: false }> {
  const root = object(value, "certification export");
  closed(root, ["v", "manifest", "artifacts", "digest"], "certification export");
  if (root.v !== "reelier.certification-export/v1") throw new TypeError("certification export version is invalid");
  const manifest = object(root.manifest, "certification export manifest");
  closed(manifest, ["v", "artifactDigests", "scenarios", "claims"], "certification export manifest");
  if (manifest.v !== "reelier.certification-export-manifest/v1") throw new TypeError("certification export manifest version is invalid");
  const digests = object(manifest.artifactDigests, "certification export artifact links");
  closed(digests, ["config", "initialization", "preflight", "readiness"], "certification export artifact links");
  for (const digest of Object.values(digests)) assertDigest(digest, "certification export artifact link");
  const claims = object(manifest.claims, "certification export claims");
  closed(claims, ["providerCertification", "signatureVerification", "completion", "completeness"], "certification export claims");
  if (Object.keys(CLAIMS).some(key => claims[key] !== "unchecked")) throw new TypeError("certification export claims must remain unchecked");
  const scenarios = scenarioList(manifest.scenarios);
  const artifacts = object(root.artifacts, "certification export artifacts");
  closed(artifacts, ["config", "initialization", "preflight", "readiness"], "certification export artifacts");
  const config = parseProjectedConfig(artifacts.config, scenarios);
  const initialization = parseCertificationInitialization(artifacts.initialization);
  const preflight = parsePreflight(artifacts.preflight);
  const readiness = parseCertificationReadinessCandidate(artifacts.readiness, preflight);
  const parsedArtifacts = { config, initialization, preflight, readiness };
  for (const name of ["config", "initialization", "preflight", "readiness"] as const) if (digests[name] !== authorityDigest(parsedArtifacts[name])) throw new TypeError(`certification export ${name} digest link mismatch`);
  if (initialization.configDigest !== config.configDigest || preflight.configDigest !== config.configDigest || readiness.configDigest !== config.configDigest) throw new TypeError("certification export initialization root link mismatch");
  if (preflight.selectionDigest !== config.selectionDigest || readiness.selectionDigest !== config.selectionDigest) throw new TypeError("certification export selection commitment link mismatch");
  const derived = deriveCertificationIdentifiers(initialization.configDigest);
  if (authorityDigest(initialization.identifiers) !== authorityDigest(derived) || authorityDigest(preflight.identifiers) !== authorityDigest(initialization.identifiers) || authorityDigest(readiness.identifiers) !== authorityDigest(initialization.identifiers)) throw new TypeError("certification generated identifier continuity mismatch");
  if (readiness.preflightDigest !== preflight.digest) throw new TypeError("certification export preflight link mismatch");
  if (!same(scenarios, preflight.scenarios) || !same(scenarios, readiness.scenarios)) throw new TypeError("certification export scenario link mismatch");
  if (scenarios.some(scenario => !initialization.scenarios.includes(scenario))) throw new TypeError("certification export selection is not a subset of initialization scenarios");
  verifyPreflightSemantics(config, preflight);
  if (JSON.stringify(readiness.commitments.resources) !== JSON.stringify(preflight.resources) || JSON.stringify(readiness.commitments.cleanup) !== JSON.stringify(preflight.cleanup) || JSON.stringify(readiness.commitments.credentials) !== JSON.stringify(preflight.credentialReferences) || JSON.stringify(readiness.commitments.runners) !== JSON.stringify(preflight.inputs.runners) || JSON.stringify(readiness.commitments.tests) !== JSON.stringify(preflight.inputs.tests) || JSON.stringify(readiness.commitments.plans) !== JSON.stringify(preflight.inputs.plans) || JSON.stringify(readiness.commitments.endpoints) !== JSON.stringify(preflight.inputs.endpoints) || readiness.commitments.runnerRegistryDigest !== preflight.runnerRegistryDigest || readiness.commitments.topology !== preflight.topology || readiness.commitments.signatureStatus !== preflight.signatureStatus) throw new TypeError("certification export readiness commitment link mismatch");
  const rootDigest = assertDigest(root.digest, "certification export digest");
  if (rootDigest !== authorityDigest({ v: root.v, manifest, artifacts: parsedArtifacts })) throw new TypeError("certification export digest mismatch");
  return Object.freeze({ digest: rootDigest, claims: CLAIMS, authorization: "absent", dispatchable: false });
}

function parseProjectedConfig(value: unknown, manifestScenarios: readonly CertificationScenarioId[]): any {
  const raw = object(value, "certification export config");
  closed(raw, ["v", "configDigest", "sanitizedProjectionDigest", "selectionDigest", "scenarios", "resources", "cleanup", "desiredState", "metadata", "credentialReferences"], "certification export config");
  if (raw.v !== "reelier.certification-export-config/v3") throw new TypeError("certification export config version is invalid");
  const configDigest = assertDigest(raw.configDigest, "certification initialization config digest");
  const sanitizedProjectionDigest = assertDigest(raw.sanitizedProjectionDigest, "certification sanitized projection digest");
  const selectionDigest = assertDigest(raw.selectionDigest, "certification selection commitment digest");
  const scenarios = scenarioList(raw.scenarios); if (!same(scenarios, manifestScenarios)) throw new TypeError("certification export config scenario link mismatch");
  const definitions = scenarios.map(scenario => CERTIFICATION_SCENARIOS[scenario]);
  const expectedResources = unique(definitions.flatMap(definition => definition.resourceSections));
  const expectedCleanup = unique(definitions.flatMap(definition => definition.cleanupCommitments));
  const expectedMetadata = unique(definitions.flatMap(definition => definition.metadataSections));
  const expectedCredentials = unique(definitions.flatMap(definition => definition.secretSlots));
  const resourcesRaw = object(raw.resources, "certification export resources"); closed(resourcesRaw, expectedResources, "certification export resources");
  const resources: Record<string, unknown> = {};
  for (const section of expectedResources) resources[section] = projectedResource(section, resourcesRaw[section]);
  const cleanupRaw = object(raw.cleanup, "certification export cleanup"); closed(cleanupRaw, expectedCleanup, "certification export cleanup");
  const cleanup: Record<string, readonly string[]> = {};
  for (const section of expectedCleanup) cleanup[section] = stringList(cleanupRaw[section], `certification ${section} cleanup`);
  const desiredRaw = object(raw.desiredState, "certification export desired state");
  if (Object.keys(desiredRaw).some(key => !scenarios.includes(key as CertificationScenarioId))) throw new TypeError("certification export desired state selection mismatch");
  const desiredState = Object.freeze(Object.fromEntries(Object.keys(desiredRaw).sort().map(scenario => {
    const entries = inertArray(desiredRaw[scenario], `certification ${scenario} desired-state commitments`).map(item => {
      const entry = object(item, "certification desired-state field commitment");
      closed(entry, ["name", "type", "byteCount", "digest", "contentSensitivity"], "certification desired-state field commitment");
      if (typeof entry.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(entry.name) || !["array", "boolean", "null", "number", "object", "string"].includes(entry.type) || !Number.isSafeInteger(entry.byteCount) || entry.byteCount < 1 || entry.contentSensitivity !== "unchecked") throw new TypeError("certification desired-state field commitment is invalid");
      return Object.freeze({ name: entry.name, type: entry.type, byteCount: entry.byteCount, digest: assertDigest(entry.digest, "certification desired-state field digest"), contentSensitivity: "unchecked" as const });
    });
    if (entries.length === 0 || new Set(entries.map(item => item.name)).size !== entries.length || entries.some((item, index) => index > 0 && entries[index - 1]!.name >= item.name)) throw new TypeError("certification desired-state field commitments must be non-empty, unique, and sorted");
    return [scenario, Object.freeze(entries)];
  })));
  if (!Array.isArray(raw.metadata)) throw new TypeError("certification export metadata must be an array");
  const metadata = Object.freeze(raw.metadata.map((item: unknown) => { const entry = object(item, "certification export metadata item"); closed(entry, ["section", "digest", "status"], "certification export metadata item"); if (typeof entry.section !== "string" || entry.status !== "configured") throw new TypeError("certification export metadata item is invalid"); return Object.freeze({ section: entry.section, digest: assertDigest(entry.digest, "certification export metadata digest"), status: "configured" as const }); }));
  if (!same(metadata.map((item: any) => item.section), expectedMetadata)) throw new TypeError("certification export metadata selection mismatch");
  const credentialReferences = credentialList(raw.credentialReferences);
  if (!same(credentialReferences.map((item: any) => item.slot), expectedCredentials)) throw new TypeError("certification export credential selection mismatch");
  const projection = { v: "reelier.certification-sanitized-config/v1", scenarios, resources: Object.freeze(resources), cleanup: Object.freeze(cleanup), desiredState: Object.freeze(desiredState), metadata, credentialReferences };
  if (authorityDigest(projection) !== sanitizedProjectionDigest || recomputeCertificationSelectionCommitment(configDigest, sanitizedProjectionDigest) !== selectionDigest) throw new TypeError("certification sanitized projection digest or selection commitment mismatch");
  return Object.freeze({ v: raw.v, configDigest, sanitizedProjectionDigest, selectionDigest, scenarios, resources: projection.resources, cleanup: projection.cleanup, desiredState: projection.desiredState, metadata, credentialReferences });
}

function verifyPreflightSemantics(config: any, preflight: any): void {
  const resources = Object.entries(config.resources).map(([scenario, value]) => ({ scenario, digest: authorityDigest(value), status: configured(value) ? "configured" : "missing" })).sort(byScenario);
  const cleanup = Object.entries(config.cleanup).map(([scenario, value]) => ({ scenario, digest: authorityDigest(value), status: configured(value) ? "configured" : "missing" })).sort(byScenario);
  const credentialReferences = config.credentialReferences;
  const topology = config.scenarios.includes("fly-topology") ? (config.metadata.some((item: any) => item.section === "flyTopology") ? "configured" : "absent") : "absent";
  const runnerScenarios = config.scenarios.filter((scenario: string) => (CERTIFICATION_PROVIDER_SCENARIO_IDS as readonly string[]).includes(scenario));
  const missing = [
    ...resources.filter(item => item.status === "missing").map(item => `resource:${item.scenario}`),
    ...cleanup.filter(item => item.status === "missing").map(item => `cleanup:${item.scenario}`),
    ...credentialReferences.filter((item: any) => item.status === "missing").map((item: any) => `credential-reference:${item.slot}`),
    ...runnerScenarios.filter((scenario: string) => !preflight.inputs.runners.artifacts.some((item: any) => item.scenario === scenario)).map((scenario: string) => `inputs:runners:${scenario}`),
    ...runnerScenarios.filter((scenario: string) => !preflight.inputs.tests.artifacts.some((item: any) => item.scenario === scenario)).map((scenario: string) => `inputs:tests:${scenario}`),
    ...runnerScenarios.filter((scenario: string) => !preflight.inputs.plans.artifacts.some((item: any) => item.scenario === scenario)).map((scenario: string) => `inputs:plans:${scenario}`),
    ...runnerScenarios.filter((scenario: string) => !preflight.inputs.endpoints.artifacts.some((item: any) => item.scenario === scenario)).map((scenario: string) => `inputs:endpoints:${scenario}`),
    ...(config.scenarios.includes("fly-topology") && topology === "absent" ? ["topology:metadata"] : []),
  ].sort();
  const runnerStatus = runnerScenarios.every((scenario: string) => preflight.inputs.runners.artifacts.some((item: any) => item.scenario === scenario)) ? "configured" : "absent";
  const testStatus = runnerScenarios.every((scenario: string) => preflight.inputs.tests.artifacts.some((item: any) => item.scenario === scenario)) ? "configured" : "absent";
  const planStatus = runnerScenarios.every((scenario: string) => preflight.inputs.plans.artifacts.some((item: any) => item.scenario === scenario)) ? "configured" : "absent";
  const endpointStatus = runnerScenarios.every((scenario: string) => preflight.inputs.endpoints.artifacts.some((item: any) => item.scenario === scenario)) ? "configured" : "absent";
  if (JSON.stringify(preflight.resources) !== JSON.stringify(resources) || JSON.stringify(preflight.cleanup) !== JSON.stringify(cleanup) || JSON.stringify(preflight.credentialReferences) !== JSON.stringify(credentialReferences) || preflight.inputs.runners.status !== runnerStatus || preflight.inputs.tests.status !== testStatus || preflight.inputs.plans.status !== planStatus || preflight.inputs.endpoints.status !== endpointStatus || preflight.runnerRegistryDigest !== certificationRunnerRegistryDigest || preflight.topology !== topology || JSON.stringify(preflight.missing) !== JSON.stringify(missing) || preflight.ok !== (missing.length === 0) || preflight.preparationReady !== (missing.length === 0) || preflight.executionReady !== false || preflight.dispatchable !== false) throw new TypeError("certification preflight semantic mismatch");
}

function parsePreflight(value: unknown): any {
  const raw = object(value, "certification preflight");
  closed(raw, ["v", "configDigest", "selectionDigest", "identifiers", "scenarios", "resources", "cleanup", "credentialReferences", "inputs", "runnerRegistryDigest", "topology", "trust", "signatureStatus", "authorization", "completeness", "missing", "ok", "preparationReady", "executionReady", "dispatchable", "digest"], "certification preflight");
  if (raw.v !== "reelier.certification-preflight/v2" || raw.trust !== "unchecked" || raw.signatureStatus !== "absent" || raw.authorization !== "absent" || raw.completeness !== "unchecked" || typeof raw.ok !== "boolean" || typeof raw.preparationReady !== "boolean") throw new TypeError("certification preflight is invalid");
  assertDigest(raw.configDigest, "certification preflight config digest"); assertDigest(raw.selectionDigest, "certification preflight selection digest");
  const inputsRaw = object(raw.inputs, "certification preflight inputs"); closed(inputsRaw, ["runners", "tests", "plans", "endpoints"], "certification preflight inputs");
  const body = { v: raw.v, configDigest: raw.configDigest, selectionDigest: raw.selectionDigest, identifiers: parseIdentifiers(raw.identifiers), scenarios: scenarioList(raw.scenarios), resources: commitmentList(raw.resources, "resources"), cleanup: commitmentList(raw.cleanup, "cleanup"), credentialReferences: credentialList(raw.credentialReferences), inputs: { runners: inputSet(inputsRaw.runners), tests: inputSet(inputsRaw.tests), plans: inputSet(inputsRaw.plans), endpoints: inputSet(inputsRaw.endpoints) }, runnerRegistryDigest: assertDigest(raw.runnerRegistryDigest, "certification runner registry digest"), topology: enumValue(raw.topology, ["configured", "absent"], "preflight topology"), trust: raw.trust, signatureStatus: raw.signatureStatus, authorization: raw.authorization, completeness: raw.completeness, missing: stringList(raw.missing, "certification preflight missing"), ok: raw.ok, preparationReady: raw.preparationReady, executionReady: raw.executionReady, dispatchable: raw.dispatchable };
  if (assertDigest(raw.digest, "certification preflight digest") !== authorityDigest(body)) throw new TypeError("certification preflight digest mismatch");
  return Object.freeze({ ...body, digest: raw.digest });
}

function parseIdentifiers(value: unknown): any { const raw = object(value, "certification identifiers"); closed(raw, ["taskId", "jobCardId", "rootGrantId", "authorityCellId", "signerId"], "certification identifiers"); const patterns: Record<string, RegExp> = { taskId: /^task_[0-9a-f]{24}$/, jobCardId: /^job_[0-9a-f]{24}$/, rootGrantId: /^grant_[0-9a-f]{24}$/, authorityCellId: /^cell_[0-9a-f]{24}$/, signerId: /^signer_[0-9a-f]{24}$/ }; for (const [key, pattern] of Object.entries(patterns)) if (typeof raw[key] !== "string" || !pattern.test(raw[key])) throw new TypeError("certification generated identifier is invalid"); return Object.freeze({ taskId: raw.taskId, jobCardId: raw.jobCardId, rootGrantId: raw.rootGrantId, authorityCellId: raw.authorityCellId, signerId: raw.signerId }); }

function projectedResource(section: string, value: unknown): unknown { const raw = object(value, `certification ${section} resource`); const keys = RESOURCE_KEYS[section]; if (!keys) throw new TypeError("certification resource section is invalid"); closed(raw, keys, `certification ${section} resource`); return JSON.parse(JSON.stringify(raw)); }
function commitmentList(value: unknown, label: string): readonly any[] { if (!Array.isArray(value)) throw new TypeError(`certification ${label} must be an array`); return Object.freeze(value.map(item => { const raw = object(item, `certification ${label} item`); closed(raw, ["scenario", "digest", "status"], `certification ${label} item`); return Object.freeze({ scenario: scenarioId(raw.scenario), digest: assertDigest(raw.digest, `certification ${label} digest`), status: enumValue(raw.status, ["configured", "missing"], `${label} status`) }); })); }
function credentialList(value: unknown): readonly any[] { if (!Array.isArray(value)) throw new TypeError("certification credentials must be an array"); return Object.freeze(value.map(item => { const raw = object(item, "certification credential item"); closed(raw, ["slot", "status"], "certification credential item"); if (typeof raw.slot !== "string") throw new TypeError("certification credential slot is invalid"); return Object.freeze({ slot: raw.slot, status: enumValue(raw.status, ["configured", "missing"], "credential status") }); })); }
function inputSet(value: unknown): any { const raw = object(value, "certification input set"); closed(raw, ["status", "artifacts"], "certification input set"); if (!Array.isArray(raw.artifacts)) throw new TypeError("certification input artifacts are invalid"); const artifacts = raw.artifacts.map((item: unknown) => { const artifact = object(item, "certification input artifact"); closed(artifact, ["scenario", "name", "digest"], "certification input artifact"); const scenario = scenarioId(artifact.scenario); if (typeof artifact.name !== "string" || !(artifact.name === `${scenario}.json` || artifact.name.startsWith(`${scenario}--`)) || !artifact.name.endsWith(".json")) throw new TypeError("certification input artifact name is invalid"); return Object.freeze({ scenario, name: artifact.name, digest: assertDigest(artifact.digest, "certification input artifact digest") }); }); const status = enumValue(raw.status, ["configured", "absent"], "input status"); return Object.freeze({ status, artifacts: Object.freeze(artifacts) }); }
function scenarioList(value: unknown): readonly CertificationScenarioId[] { if (!Array.isArray(value) || value.length === 0) throw new TypeError("certification export scenarios are invalid"); const result = value.map(scenarioId); if (new Set(result).size !== result.length || result.some((item, index) => index > 0 && result[index - 1] >= item)) throw new TypeError("certification export scenarios must be unique and sorted"); return Object.freeze(result); }
function scenarioId(value: unknown): CertificationScenarioId { if (typeof value !== "string" || !(CERTIFICATION_SCENARIO_IDS as readonly string[]).includes(value)) throw new TypeError("certification scenario is invalid"); return value as CertificationScenarioId; }
function stringList(value: unknown, label: string): readonly string[] { if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new TypeError(`${label} is invalid`); return Object.freeze([...value] as string[]); }
function configured(value: unknown): boolean { if (Array.isArray(value)) return value.length > 0 && value.every(configured); if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).every(configured); if (typeof value === "number") return Number.isSafeInteger(value) && value > 0; if (typeof value !== "string" || !value) return false; const normalized = value.toLowerCase(); return !normalized.startsWith("replace-") && !normalized.includes("_example") && !normalized.endsWith(".example.com") && !/^sha256:([0-9a-f])\1{63}$/.test(normalized); }
function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T { if (typeof value !== "string" || !values.includes(value as T)) throw new TypeError(`certification ${label} is invalid`); return value as T; }
function unique<T extends string>(values: readonly T[]): readonly T[] { return Object.freeze([...new Set(values)].sort() as T[]); }
function byScenario(left: any, right: any): number { return left.scenario.localeCompare(right.scenario); }
function assertDigest(value: unknown, label: string): string { if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function same(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((item, index) => item === right[index]); }
function object(value: unknown, label: string): Record<string, any> { return inertRecord(value, label) as Record<string, any>; }
function closed(raw: Record<string, unknown>, keys: readonly string[], label: string): void { if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) throw new TypeError(`${label} is closed`); }
