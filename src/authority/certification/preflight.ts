import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../wire.js";
import { parseCertificationOperatorConfigV3, type CertificationOperatorConfigV3 } from "./config.js";
import { parseCertificationInitialization, validateCertificationInitialization, type CertificationIdentifiers } from "./initializer.js";
import { CERTIFICATION_SCENARIOS, CERTIFICATION_SCENARIO_IDS, type CertificationScenarioId, type CertificationSecretSlot } from "./scenarios.js";
import { certificationWorkspaceRoot, confinedExistingDirectory, readConfinedFile } from "./filesystem.js";
import { createCertificationSelectionCommitment } from "./commitment.js";
import { parseCertificationEndpointManifest, parseCertificationRunnerManifest, parseCertificationScenarioPlan, parseCertificationTestManifest } from "./manifests.js";
import { CERTIFICATION_PROVIDER_SCENARIO_IDS, certificationRunnerRegistryDigest } from "./runner-registry.js";
import { inertRecord } from "./inert.js";

export interface CertificationInputArtifact { readonly scenario: CertificationScenarioId; readonly name: string; readonly digest: string }
export interface CertificationInputSet { readonly status: "configured" | "absent"; readonly artifacts: readonly CertificationInputArtifact[] }
export interface CertificationPreflightV2 {
  readonly v: "reelier.certification-preflight/v2";
  readonly configDigest: string;
  readonly selectionDigest: string;
  readonly identifiers: CertificationIdentifiers;
  readonly scenarios: readonly CertificationScenarioId[];
  readonly resources: readonly { readonly scenario: CertificationScenarioId; readonly digest: string; readonly status: "configured" | "missing" }[];
  readonly cleanup: readonly { readonly scenario: CertificationScenarioId; readonly digest: string; readonly status: "configured" | "missing" }[];
  readonly credentialReferences: readonly { readonly slot: CertificationSecretSlot; readonly status: "configured" | "missing" }[];
  readonly inputs: Readonly<{ runners: CertificationInputSet; tests: CertificationInputSet; plans: CertificationInputSet; endpoints: CertificationInputSet }>;
  readonly runnerRegistryDigest: string;
  readonly topology: "configured" | "absent";
  readonly trust: "unchecked";
  readonly signatureStatus: "absent";
  readonly authorization: "absent";
  readonly completeness: "unchecked";
  readonly missing: readonly string[];
  readonly ok: boolean;
  readonly preparationReady: boolean;
  readonly executionReady: false;
  readonly dispatchable: false;
  readonly digest: string;
}

export async function preflightCertification(input: Readonly<{ workspace: string; scenario?: string; all?: boolean }>): Promise<CertificationPreflightV2> {
  const request = closedInput(input, ["workspace", "scenario", "all"], "certification preflight request");
  if (typeof request.workspace !== "string") throw new TypeError("certification preflight workspace is invalid");
  const workspace = path.resolve(request.workspace);
  const workspaceRoot = await certificationWorkspaceRoot(workspace);
  const config = parseCertificationOperatorConfigV3(JSON.parse((await readConfinedFile(workspaceRoot, workspaceRoot, "config.json")).toString("utf8")));
  const initialization = parseCertificationInitialization(JSON.parse((await readConfinedFile(workspaceRoot, workspaceRoot, "initialization.json")).toString("utf8")));
  const scenarios = selectScenarios(config, request.scenario as string | undefined, request.all as boolean | undefined);
  validateCertificationInitialization(config, initialization);
  const selectedCommitment = createCertificationSelectionCommitment(config, scenarios, initialization.configDigest);
  const definitions = scenarios.map(scenario => CERTIFICATION_SCENARIOS[scenario]);
  const resourceSections = unique(definitions.flatMap(definition => definition.resourceSections));
  const cleanupSections = unique(definitions.flatMap(definition => definition.cleanupCommitments));
  const secretSlots = unique(definitions.flatMap(definition => definition.secretSlots));
  const resources = Object.freeze(resourceSections.map(scenario => {
    const value = config.resources[scenario];
    return Object.freeze({ scenario, digest: authorityDigest(value), status: configured(value) ? "configured" as const : "missing" as const });
  }));
  const cleanup = Object.freeze(cleanupSections.map(scenario => {
    const value = config.cleanup[scenario];
    return Object.freeze({ scenario, digest: authorityDigest(value), status: configured(value) ? "configured" as const : "missing" as const });
  }));
  const credentialReferences = Object.freeze(secretSlots.map(slot => Object.freeze({ slot, status: config.secretReferences[slot] ? "configured" as const : "missing" as const })));
  const runnerScenarios = scenarios.filter(scenario => (CERTIFICATION_PROVIDER_SCENARIO_IDS as readonly string[]).includes(scenario));
  const runners = await inspectInputSet(workspaceRoot, "runners", runnerScenarios);
  const runnerDigests = new Map(runners.artifacts.map(item => [item.scenario, item.digest]));
  const tests = await inspectInputSet(workspaceRoot, "tests", runnerScenarios, runnerDigests);
  const testDigests = new Map(tests.artifacts.map(item => [item.scenario, item.digest]));
  const endpoints = await inspectEndpoints(workspaceRoot, runnerScenarios);
  const inputs = Object.freeze({ runners, tests, plans: await inspectPlans(workspaceRoot, config, runnerScenarios, runnerDigests, testDigests), endpoints });
  const topology = scenarios.includes("fly-topology") ? (config.metadata.flyTopology ? "configured" as const : "absent" as const) : "absent" as const;
  const missing = [
    ...resources.filter(item => item.status === "missing").map(item => `resource:${item.scenario}`),
    ...cleanup.filter(item => item.status === "missing").map(item => `cleanup:${item.scenario}`),
    ...credentialReferences.filter(item => item.status === "missing").map(item => `credential-reference:${item.slot}`),
    ...runnerScenarios.filter(scenario => !config.desiredState[scenario]).map(scenario => `desired-state:${scenario}`),
    ...runnerScenarios.filter(scenario => inputs.runners.status !== "configured" || inputs.runners.artifacts.filter(item => item.scenario === scenario).length !== 1).map(scenario => `inputs:runners:${scenario}`),
    ...runnerScenarios.filter(scenario => inputs.tests.status !== "configured" || inputs.tests.artifacts.filter(item => item.scenario === scenario).length !== 1).map(scenario => `inputs:tests:${scenario}`),
    ...runnerScenarios.filter(scenario => inputs.plans.status !== "configured" || inputs.plans.artifacts.filter(item => item.scenario === scenario).length !== 1).map(scenario => `inputs:plans:${scenario}`),
    ...runnerScenarios.filter(scenario => inputs.endpoints.status !== "configured" || inputs.endpoints.artifacts.filter(item => item.scenario === scenario).length !== 1).map(scenario => `inputs:endpoints:${scenario}`),
    ...(scenarios.includes("fly-topology") && topology === "absent" ? ["topology:metadata"] : []),
  ].sort();
  const body = {
    v: "reelier.certification-preflight/v2" as const,
    configDigest: initialization.configDigest,
    selectionDigest: selectedCommitment.selectionDigest,
    identifiers: initialization.identifiers,
    scenarios,
    resources,
    cleanup,
    credentialReferences,
    inputs,
    runnerRegistryDigest: certificationRunnerRegistryDigest,
    topology,
    // Static local path checks do not prove exclusive confinement against concurrent same-user mutation.
    trust: "unchecked" as const,
    signatureStatus: "absent" as const,
    authorization: "absent" as const,
    completeness: "unchecked" as const,
    missing: Object.freeze(missing),
    ok: missing.length === 0,
    preparationReady: missing.length === 0,
    executionReady: false as const,
    dispatchable: false as const,
  };
  return Object.freeze({ ...body, digest: authorityDigest(body) });
}

function closedInput(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  const raw = inertRecord(value, label);
  const keys = Object.keys(raw);
  if (!Object.hasOwn(raw, "workspace") || keys.some(key => !allowed.includes(key))) throw new TypeError(`${label} is closed and accepts no callback or executable dependencies`);
  return raw;
}

function selectScenarios(config: CertificationOperatorConfigV3, scenario?: string, all?: boolean): readonly CertificationScenarioId[] {
  if (Boolean(scenario) === Boolean(all)) throw new TypeError("certification requires exactly one of scenario or all selection");
  if (!scenario) return Object.freeze([...config.scenarios]);
  if (!(CERTIFICATION_SCENARIO_IDS as readonly string[]).includes(scenario)) throw new TypeError("certification scenario is unknown");
  if (!(config.scenarios as readonly string[]).includes(scenario)) throw new TypeError("certification scenario was not selected during initialization");
  return Object.freeze([scenario as CertificationScenarioId]);
}

async function inspectInputSet(workspace: string, kind: "runners" | "tests", scenarios: readonly CertificationScenarioId[], runnerDigests = new Map<CertificationScenarioId, string>()): Promise<CertificationInputSet> {
  const directory = await confinedExistingDirectory(workspace, ["inputs", kind]);
  if (!directory) return Object.freeze({ status: "absent", artifacts: Object.freeze([]) });
  let names: string[];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const selected = scenarios.some(scenario => entry.name === `${scenario}.json` || entry.name.startsWith(`${scenario}--`));
    if (selected && (entry.isSymbolicLink() || !entry.isFile())) throw new TypeError("selected certification artifact is linked, reparse-pointed, or not a regular file");
  }
  names = entries.filter(entry => entry.isFile() && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}\.json$/.test(entry.name)).map(entry => entry.name).sort();
  const mapped = names.flatMap(name => {
    const scenario = scenarios.find(candidate => name === `${candidate}.json` || name.startsWith(`${candidate}--`));
    return scenario ? [{ scenario, name }] : [];
  });
  const inspected = await Promise.all(mapped.map(async ({ scenario, name }) => {
    const bytes = await readConfinedFile(workspace, directory, name);
    let parsed: unknown;
    try { parsed = JSON.parse(bytes.toString("utf8")); } catch { return undefined; }
    try {
      if (kind === "runners") { const runner = parseCertificationRunnerManifest(parsed, scenario); if (runner.v !== "reelier.certification-runner-manifest/v2") return undefined; }
      else parseCertificationTestManifest(parsed, scenario, runnerDigests.get(scenario));
    } catch { return undefined; }
    return Object.freeze({ scenario, name, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` });
  }));
  const artifacts = inspected.filter((item): item is NonNullable<typeof item> => item !== undefined);
  const complete = scenarios.every(scenario =>
    entries.filter(entry => entry.name === `${scenario}.json` || entry.name.startsWith(`${scenario}--`)).length === 1
    && artifacts.filter(item => item.scenario === scenario).length === 1);
  return Object.freeze({ status: complete ? "configured" : "absent", artifacts: Object.freeze(artifacts) });
}

async function inspectEndpoints(workspace: string, scenarios: readonly CertificationScenarioId[]): Promise<CertificationInputSet> {
  const directory = await confinedExistingDirectory(workspace, ["authority", "endpoints"]);
  if (!directory) return Object.freeze({ status: "absent", artifacts: Object.freeze([]) });
  const entries = await readdir(directory, { withFileTypes: true });
  const artifacts: CertificationInputArtifact[] = [];
  for (const scenario of scenarios) {
    const matching = entries.filter(entry => entry.name === `${scenario}.json` || entry.name.startsWith(`${scenario}--`));
    if (matching.length !== 1) continue;
    for (const entry of matching) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      try {
        const bytes = await readConfinedFile(workspace, directory, entry.name);
        const endpoint = parseCertificationEndpointManifest(JSON.parse(bytes.toString("utf8")), scenario);
        if (endpoint.v !== "reelier.certification-endpoint-manifest/v2") continue;
        artifacts.push(Object.freeze({ scenario, name: entry.name, digest: authorityDigest(endpoint) }));
      } catch { continue; }
    }
  }
  artifacts.sort((left, right) => left.name.localeCompare(right.name));
  const complete = scenarios.every(scenario => artifacts.filter(item => item.scenario === scenario).length === 1);
  return Object.freeze({ status: complete ? "configured" : "absent", artifacts: Object.freeze(artifacts) });
}

async function inspectPlans(workspace: string, config: CertificationOperatorConfigV3, scenarios: readonly CertificationScenarioId[], runnerDigests: ReadonlyMap<CertificationScenarioId, string>, testDigests: ReadonlyMap<CertificationScenarioId, string>): Promise<CertificationInputSet> {
  const directory = await confinedExistingDirectory(workspace, ["inputs", "plans"]);
  const endpointDirectory = await confinedExistingDirectory(workspace, ["authority", "endpoints"]);
  if (!directory || !endpointDirectory) return Object.freeze({ status: "absent", artifacts: Object.freeze([]) });
  const entries = await readdir(directory, { withFileTypes: true });
  const artifacts: CertificationInputArtifact[] = [];
  for (const scenario of scenarios) {
    const matching = entries.filter(entry => entry.name === `${scenario}.json` || entry.name.startsWith(`${scenario}--`));
    if (matching.length !== 1 || !matching[0]!.isFile() || matching[0]!.isSymbolicLink()) continue;
    const name = matching[0]!.name;
    try {
      const bytes = await readConfinedFile(workspace, directory, name);
      const plan = parseCertificationScenarioPlan(JSON.parse(bytes.toString("utf8")), config, scenarios);
      const endpoint = parseCertificationEndpointManifest(JSON.parse((await readConfinedFile(workspace, endpointDirectory, `${scenario}.json`)).toString("utf8")), scenario);
      if (plan.runnerManifestDigest !== runnerDigests.get(scenario) || plan.testManifestDigest !== testDigests.get(scenario) || plan.endpointManifestDigest !== authorityDigest(endpoint) || plan.runnerRegistryDigest !== certificationRunnerRegistryDigest) continue;
      artifacts.push(Object.freeze({ scenario, name, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` }));
    } catch { continue; }
  }
  artifacts.sort((left, right) => left.name.localeCompare(right.name));
  return Object.freeze({ status: artifacts.length === scenarios.length ? "configured" : "absent", artifacts: Object.freeze(artifacts) });
}

function unique<T extends string>(values: readonly T[]): readonly T[] { return Object.freeze([...new Set(values)].sort() as T[]); }
function configured(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0 && value.every(configured);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).every(configured);
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0;
  if (typeof value !== "string" || value.length === 0) return false;
  const normalized = value.toLowerCase();
  return !normalized.startsWith("replace-") && !normalized.includes("_example") && !normalized.endsWith(".example.com") && !/^sha256:([0-9a-f])\1{63}$/.test(normalized);
}
