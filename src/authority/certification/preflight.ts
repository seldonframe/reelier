import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../wire.js";
import { parseCertificationOperatorConfigV2, type CertificationOperatorConfigV2 } from "./config.js";
import { parseCertificationInitialization } from "./initializer.js";
import { CERTIFICATION_SCENARIOS, CERTIFICATION_SCENARIO_IDS, type CertificationScenarioId, type CertificationSecretSlot } from "./scenarios.js";
import { certificationWorkspaceRoot, confinedExistingDirectory, readConfinedFile } from "./filesystem.js";
import { createCertificationConfigCommitment } from "./commitment.js";

export interface CertificationInputArtifact { readonly scenario: CertificationScenarioId; readonly name: string; readonly digest: string }
export interface CertificationInputSet { readonly status: "configured" | "absent"; readonly artifacts: readonly CertificationInputArtifact[] }
export interface CertificationPreflightV2 {
  readonly v: "reelier.certification-preflight/v2";
  readonly configDigest: string;
  readonly scenarios: readonly CertificationScenarioId[];
  readonly resources: readonly { readonly scenario: CertificationScenarioId; readonly digest: string; readonly status: "configured" | "missing" }[];
  readonly cleanup: readonly { readonly scenario: CertificationScenarioId; readonly digest: string; readonly status: "configured" | "missing" }[];
  readonly credentialReferences: readonly { readonly slot: CertificationSecretSlot; readonly status: "configured" | "missing" }[];
  readonly inputs: Readonly<{ runners: CertificationInputSet; tests: CertificationInputSet }>;
  readonly topology: "configured" | "absent";
  readonly trust: "unchecked";
  readonly signatureStatus: "absent";
  readonly authorization: "absent";
  readonly completeness: "unchecked";
  readonly missing: readonly string[];
  readonly ok: boolean;
  readonly preparationReady: boolean;
  readonly digest: string;
}

export async function preflightCertification(input: Readonly<{ workspace: string; scenario?: string; all?: boolean }>): Promise<CertificationPreflightV2> {
  const workspace = path.resolve(input.workspace);
  const workspaceRoot = await certificationWorkspaceRoot(workspace);
  const config = parseCertificationOperatorConfigV2(JSON.parse((await readConfinedFile(workspaceRoot, workspaceRoot, "config.json")).toString("utf8")));
  const initialization = parseCertificationInitialization(JSON.parse((await readConfinedFile(workspaceRoot, workspaceRoot, "initialization.json")).toString("utf8")));
  const scenarios = selectScenarios(config, input.scenario, input.all);
  const fullCommitment = createCertificationConfigCommitment(config, config.scenarios);
  if (fullCommitment.configCommitmentDigest !== initialization.configDigest || fullCommitment.privateConfigDigest !== initialization.privateConfigDigest || fullCommitment.sanitizedProjectionDigest !== initialization.sanitizedProjectionDigest) throw new TypeError("certification workspace config commitment mismatch");
  const selectedCommitment = createCertificationConfigCommitment(config, scenarios);
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
  const inputs = Object.freeze({ runners: await inspectInputSet(workspaceRoot, "runners", scenarios), tests: await inspectInputSet(workspaceRoot, "tests", scenarios) });
  const topology = scenarios.includes("fly-topology") ? (config.metadata.flyTopology ? "configured" as const : "absent" as const) : "absent" as const;
  const missing = [
    ...resources.filter(item => item.status === "missing").map(item => `resource:${item.scenario}`),
    ...cleanup.filter(item => item.status === "missing").map(item => `cleanup:${item.scenario}`),
    ...credentialReferences.filter(item => item.status === "missing").map(item => `credential-reference:${item.slot}`),
    ...scenarios.filter(scenario => !inputs.runners.artifacts.some(item => item.scenario === scenario)).map(scenario => `inputs:runners:${scenario}`),
    ...scenarios.filter(scenario => !inputs.tests.artifacts.some(item => item.scenario === scenario)).map(scenario => `inputs:tests:${scenario}`),
    ...(scenarios.includes("fly-topology") && topology === "absent" ? ["topology:metadata"] : []),
  ].sort();
  const body = {
    v: "reelier.certification-preflight/v2" as const,
    configDigest: selectedCommitment.configCommitmentDigest,
    scenarios,
    resources,
    cleanup,
    credentialReferences,
    inputs,
    topology,
    trust: "unchecked" as const,
    signatureStatus: "absent" as const,
    authorization: "absent" as const,
    completeness: "unchecked" as const,
    missing: Object.freeze(missing),
    ok: missing.length === 0,
    preparationReady: missing.length === 0,
  };
  return Object.freeze({ ...body, digest: authorityDigest(body) });
}

function selectScenarios(config: CertificationOperatorConfigV2, scenario?: string, all?: boolean): readonly CertificationScenarioId[] {
  if (Boolean(scenario) === Boolean(all)) throw new TypeError("certification requires exactly one of scenario or all selection");
  if (!scenario) return Object.freeze([...config.scenarios]);
  if (!(CERTIFICATION_SCENARIO_IDS as readonly string[]).includes(scenario)) throw new TypeError("certification scenario is unknown");
  if (!(config.scenarios as readonly string[]).includes(scenario)) throw new TypeError("certification scenario was not selected during initialization");
  return Object.freeze([scenario as CertificationScenarioId]);
}

async function inspectInputSet(workspace: string, kind: "runners" | "tests", scenarios: readonly CertificationScenarioId[]): Promise<CertificationInputSet> {
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
  const artifacts = await Promise.all(mapped.map(async ({ scenario, name }) => Object.freeze({ scenario, name, digest: `sha256:${createHash("sha256").update(await readConfinedFile(workspace, directory, name)).digest("hex")}` })));
  const complete = scenarios.every(scenario => artifacts.some(item => item.scenario === scenario));
  return Object.freeze({ status: complete ? "configured" : "absent", artifacts: Object.freeze(artifacts) });
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
