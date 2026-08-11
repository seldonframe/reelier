import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../wire.js";
import { parseCertificationOperatorConfigV2 } from "./config.js";
import { parseCertificationInitialization } from "./initializer.js";
import { preflightCertification } from "./preflight.js";
import { sealCertificationReadiness } from "./readiness.js";
import { CERTIFICATION_SCENARIOS, CERTIFICATION_SCENARIO_IDS, type CertificationScenarioId } from "./scenarios.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CLAIMS = Object.freeze({ providerCertification: "unchecked" as const, signatureVerification: "unchecked" as const, completion: "unchecked" as const, completeness: "unchecked" as const });

export async function exportCertificationEvidence(input: Readonly<{ workspace: string; scenario?: string; all?: boolean }>): Promise<Readonly<{ digest: string; path: string }>> {
  const workspace = path.resolve(input.workspace);
  const config = parseCertificationOperatorConfigV2(JSON.parse(await readFile(path.join(workspace, "config.json"), "utf8")));
  const initialization = parseCertificationInitialization(JSON.parse(await readFile(path.join(workspace, "initialization.json"), "utf8")));
  const preflight = await preflightCertification(input);
  const readiness = (await sealCertificationReadiness(input)).candidate;
  const artifacts = Object.freeze({ config, initialization, preflight, readiness });
  const artifactDigests = Object.freeze({ config: authorityDigest(config), initialization: authorityDigest(initialization), preflight: authorityDigest(preflight), readiness: authorityDigest(readiness) });
  const manifest = Object.freeze({ v: "reelier.certification-export-manifest/v1" as const, artifactDigests, scenarios: preflight.scenarios, claims: CLAIMS });
  const body = Object.freeze({ v: "reelier.certification-export/v1" as const, manifest, artifacts });
  const digest = authorityDigest(body);
  const bundle = Object.freeze({ ...body, digest });
  const directory = path.join(workspace, "exports");
  const output = path.join(directory, `certification-export-${digest.replace(":", "-")}.json`);
  await mkdir(directory, { recursive: true });
  try { await writeFile(output, `${JSON.stringify(bundle)}\n`, { encoding: "utf8", flag: "wx", mode: 0o444 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(output, "utf8"));
    if (authorityDigest(stripDigest(existing)) !== digest || JSON.stringify(existing) !== JSON.stringify(bundle)) throw new TypeError("immutable certification export mismatch");
  }
  return Object.freeze({ digest, path: output });
}

export function verifyCertificationExport(value: unknown): Readonly<{
  digest: string;
  claims: typeof CLAIMS;
  authorization: "absent";
  dispatchable: false;
}> {
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
  const config = parseCertificationOperatorConfigV2(artifacts.config);
  const initialization = parseCertificationInitialization(artifacts.initialization);
  const preflight = parsePreflight(artifacts.preflight);
  const readiness = parseReadiness(artifacts.readiness);
  const parsedArtifacts = { config, initialization, preflight, readiness };
  for (const name of ["config", "initialization", "preflight", "readiness"] as const) {
    if (digests[name] !== authorityDigest(parsedArtifacts[name])) throw new TypeError(`certification export ${name} digest link mismatch`);
  }
  if (authorityDigest(config) !== initialization.configDigest || preflight.configDigest !== initialization.configDigest || readiness.configDigest !== initialization.configDigest) throw new TypeError("certification export config link mismatch");
  if (readiness.preflightDigest !== preflight.digest) throw new TypeError("certification export preflight link mismatch");
  if (authorityDigest(readiness.identifiers) !== authorityDigest(initialization.identifiers)) throw new TypeError("certification export identifier substitution");
  if (!same(scenarios, preflight.scenarios) || !same(scenarios, readiness.scenarios) || scenarios.some(scenario => !config.scenarios.includes(scenario))) throw new TypeError("certification export scenario link mismatch");
  const definitions = scenarios.map(scenario => CERTIFICATION_SCENARIOS[scenario]);
  const expectedResources = [...new Set(definitions.flatMap(definition => definition.resourceSections))].sort();
  const expectedCleanup = [...new Set(definitions.flatMap(definition => definition.cleanupCommitments))].sort();
  const expectedCredentials = [...new Set(definitions.flatMap(definition => definition.secretSlots))].sort();
  if (!same(expectedResources, preflight.resources.map((item: any) => item.scenario)) || !same(expectedCleanup, preflight.cleanup.map((item: any) => item.scenario)) || !same(expectedCredentials, preflight.credentialReferences.map((item: any) => item.slot))) throw new TypeError("certification export selected-scenario commitment substitution");
  if (JSON.stringify(readiness.commitments.resources) !== JSON.stringify(preflight.resources) || JSON.stringify(readiness.commitments.cleanup) !== JSON.stringify(preflight.cleanup) || JSON.stringify(readiness.commitments.credentials) !== JSON.stringify(preflight.credentialReferences) || JSON.stringify(readiness.commitments.runners) !== JSON.stringify(preflight.inputs.runners) || JSON.stringify(readiness.commitments.tests) !== JSON.stringify(preflight.inputs.tests) || readiness.commitments.topology !== preflight.topology) throw new TypeError("certification export readiness commitment link mismatch");
  for (const item of preflight.resources) if (item.digest !== authorityDigest(config.resources[item.scenario])) throw new TypeError("certification export resource substitution");
  for (const item of preflight.cleanup) if (item.digest !== authorityDigest(config.cleanup[item.scenario])) throw new TypeError("certification export cleanup substitution");
  for (const item of preflight.credentialReferences) if (item.status !== (config.secretReferences[item.slot as keyof typeof config.secretReferences] ? "configured" : "missing")) throw new TypeError("certification export credential-reference substitution");
  const rootDigest = assertDigest(root.digest, "certification export digest");
  if (rootDigest !== authorityDigest({ v: root.v, manifest, artifacts: parsedArtifacts })) throw new TypeError("certification export digest mismatch");
  return Object.freeze({ digest: rootDigest, claims: CLAIMS, authorization: "absent", dispatchable: false });
}

function parsePreflight(value: unknown): any {
  const raw = object(value, "certification preflight");
  closed(raw, ["v", "configDigest", "scenarios", "resources", "cleanup", "credentialReferences", "inputs", "topology", "trust", "authorization", "completeness", "missing", "ok", "digest"], "certification preflight");
  if (raw.v !== "reelier.certification-preflight/v2" || raw.trust !== "unchecked" || raw.authorization !== "absent" || raw.completeness !== "unchecked" || typeof raw.ok !== "boolean") throw new TypeError("certification preflight is invalid");
  assertDigest(raw.configDigest, "certification preflight config digest");
  const scenarios = scenarioList(raw.scenarios);
  const resources = commitmentList(raw.resources, "resources");
  const cleanup = commitmentList(raw.cleanup, "cleanup");
  const credentialReferences = credentialList(raw.credentialReferences);
  const inputs = object(raw.inputs, "certification preflight inputs"); closed(inputs, ["runners", "tests"], "certification preflight inputs");
  const parsedInputs = { runners: inputSet(inputs.runners), tests: inputSet(inputs.tests) };
  if (raw.topology !== "configured" && raw.topology !== "absent") throw new TypeError("certification preflight topology is invalid");
  const missing = stringList(raw.missing, "certification preflight missing");
  const body = { v: raw.v, configDigest: raw.configDigest, scenarios, resources, cleanup, credentialReferences, inputs: parsedInputs, topology: raw.topology, trust: raw.trust, authorization: raw.authorization, completeness: raw.completeness, missing, ok: raw.ok };
  if (assertDigest(raw.digest, "certification preflight digest") !== authorityDigest(body)) throw new TypeError("certification preflight digest mismatch");
  return Object.freeze({ ...body, digest: raw.digest });
}

function parseReadiness(value: unknown): any {
  const raw = object(value, "certification readiness candidate");
  closed(raw, ["v", "status", "authorization", "dispatchable", "completeness", "configDigest", "preflightDigest", "scenarios", "identifiers", "commitments"], "certification readiness candidate");
  if (raw.v !== "reelier.certification-readiness-candidate/v1" || raw.status !== "awaiting-human-signature" || raw.authorization !== "absent" || raw.dispatchable !== false || raw.completeness !== "unchecked") throw new TypeError("certification readiness candidate cannot confer authority");
  assertDigest(raw.configDigest, "readiness config digest"); assertDigest(raw.preflightDigest, "readiness preflight digest");
  const initialization = parseCertificationInitialization({ v: "reelier.certification-initialization/v1", configDigest: raw.configDigest, identifiers: raw.identifiers, completeness: "unchecked" });
  const commitments = object(raw.commitments, "readiness commitments");
  closed(commitments, ["resources", "cleanup", "credentials", "runners", "tests", "topology", "trust"], "readiness commitments");
  if (commitments.trust !== "unchecked" || (commitments.topology !== "configured" && commitments.topology !== "absent")) throw new TypeError("readiness commitments are invalid");
  return Object.freeze({ v: raw.v, status: raw.status, authorization: raw.authorization, dispatchable: raw.dispatchable, completeness: raw.completeness, configDigest: raw.configDigest, preflightDigest: raw.preflightDigest, scenarios: scenarioList(raw.scenarios), identifiers: initialization.identifiers, commitments: Object.freeze({ resources: commitmentList(commitments.resources, "resources"), cleanup: commitmentList(commitments.cleanup, "cleanup"), credentials: credentialList(commitments.credentials), runners: inputSet(commitments.runners), tests: inputSet(commitments.tests), topology: commitments.topology, trust: commitments.trust }) });
}

function commitmentList(value: unknown, label: string): readonly any[] { if (!Array.isArray(value)) throw new TypeError(`certification ${label} must be an array`); return Object.freeze(value.map(item => { const raw = object(item, `certification ${label} item`); closed(raw, ["scenario", "digest", "status"], `certification ${label} item`); const scenario = scenarioId(raw.scenario); assertDigest(raw.digest, `certification ${label} digest`); if (raw.status !== "configured" && raw.status !== "missing") throw new TypeError(`certification ${label} status is invalid`); return Object.freeze({ scenario, digest: raw.digest, status: raw.status }); })); }
function credentialList(value: unknown): readonly any[] { if (!Array.isArray(value)) throw new TypeError("certification credentials must be an array"); return Object.freeze(value.map(item => { const raw = object(item, "certification credential item"); closed(raw, ["slot", "status"], "certification credential item"); if (typeof raw.slot !== "string" || (raw.status !== "configured" && raw.status !== "missing")) throw new TypeError("certification credential item is invalid"); return Object.freeze({ slot: raw.slot, status: raw.status }); })); }
function inputSet(value: unknown): any { const raw = object(value, "certification input set"); closed(raw, ["status", "artifacts"], "certification input set"); if (raw.status !== "configured" && raw.status !== "absent" || !Array.isArray(raw.artifacts)) throw new TypeError("certification input set is invalid"); const artifacts = raw.artifacts.map(item => { const artifact = object(item, "certification input artifact"); closed(artifact, ["name", "digest"], "certification input artifact"); if (typeof artifact.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}\.json$/.test(artifact.name)) throw new TypeError("certification input artifact name is invalid"); assertDigest(artifact.digest, "certification input artifact digest"); return Object.freeze({ name: artifact.name, digest: artifact.digest }); }); if ((raw.status === "absent") !== (artifacts.length === 0)) throw new TypeError("certification input set status mismatch"); return Object.freeze({ status: raw.status, artifacts: Object.freeze(artifacts) }); }
function scenarioList(value: unknown): readonly CertificationScenarioId[] { if (!Array.isArray(value) || value.length === 0) throw new TypeError("certification export scenarios are invalid"); const result = value.map(scenarioId); if (new Set(result).size !== result.length || result.some((item, index) => index > 0 && result[index - 1] >= item)) throw new TypeError("certification export scenarios must be unique and sorted"); return Object.freeze(result); }
function scenarioId(value: unknown): CertificationScenarioId { if (typeof value !== "string" || !(CERTIFICATION_SCENARIO_IDS as readonly string[]).includes(value)) throw new TypeError("certification scenario is invalid"); return value as CertificationScenarioId; }
function stringList(value: unknown, label: string): readonly string[] { if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new TypeError(`${label} is invalid`); return Object.freeze([...value] as string[]); }
function assertDigest(value: unknown, label: string): string { if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function same(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((item, index) => item === right[index]); }
function stripDigest(value: any): unknown { const { digest: _digest, ...body } = value; return body; }
function object(value: unknown, label: string): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Record<string, any>; }
function closed(raw: Record<string, unknown>, keys: readonly string[], label: string): void { if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) throw new TypeError(`${label} is closed`); }
