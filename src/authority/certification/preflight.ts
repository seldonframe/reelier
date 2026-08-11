import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../wire.js";
import { parseCertificationOperatorConfigV2, type CertificationOperatorConfigV2 } from "./config.js";
import { parseCertificationInitialization } from "./initializer.js";
import { CERTIFICATION_SCENARIOS, CERTIFICATION_SCENARIO_IDS, type CertificationScenarioId, type CertificationSecretSlot } from "./scenarios.js";

export interface CertificationInputArtifact { readonly name: string; readonly digest: string }
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
  readonly authorization: "absent";
  readonly completeness: "unchecked";
  readonly missing: readonly string[];
  readonly ok: boolean;
  readonly digest: string;
}

export async function preflightCertification(input: Readonly<{ workspace: string; scenario?: string; all?: boolean }>): Promise<CertificationPreflightV2> {
  const workspace = path.resolve(input.workspace);
  const config = parseCertificationOperatorConfigV2(JSON.parse(await readFile(path.join(workspace, "config.json"), "utf8")));
  const initialization = parseCertificationInitialization(JSON.parse(await readFile(path.join(workspace, "initialization.json"), "utf8")));
  if (authorityDigest(config) !== initialization.configDigest) throw new TypeError("certification workspace config digest mismatch");
  const scenarios = selectScenarios(config, input.scenario, input.all);
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
  const inputs = Object.freeze({ runners: await inspectInputSet(workspace, "runners"), tests: await inspectInputSet(workspace, "tests") });
  const topology = scenarios.includes("fly-topology") ? (config.metadata.flyTopology ? "configured" as const : "absent" as const) : "absent" as const;
  const missing = [
    ...resources.filter(item => item.status === "missing").map(item => `resource:${item.scenario}`),
    ...cleanup.filter(item => item.status === "missing").map(item => `cleanup:${item.scenario}`),
    ...credentialReferences.filter(item => item.status === "missing").map(item => `credential-reference:${item.slot}`),
    ...(inputs.runners.status === "absent" ? ["inputs:runners"] : []),
    ...(inputs.tests.status === "absent" ? ["inputs:tests"] : []),
    ...(scenarios.includes("fly-topology") && topology === "absent" ? ["topology:metadata"] : []),
    "trust:human-signature",
  ].sort();
  const body = {
    v: "reelier.certification-preflight/v2" as const,
    configDigest: initialization.configDigest,
    scenarios,
    resources,
    cleanup,
    credentialReferences,
    inputs,
    topology,
    trust: "unchecked" as const,
    authorization: "absent" as const,
    completeness: "unchecked" as const,
    missing: Object.freeze(missing),
    ok: missing.length === 0,
  };
  return Object.freeze({ ...body, digest: authorityDigest(body) });
}

function selectScenarios(config: CertificationOperatorConfigV2, scenario?: string, all?: boolean): readonly CertificationScenarioId[] {
  if (scenario && all) throw new TypeError("certification scenario and all selection are mutually exclusive");
  if (!scenario) return Object.freeze([...config.scenarios]);
  if (!(CERTIFICATION_SCENARIO_IDS as readonly string[]).includes(scenario)) throw new TypeError("certification scenario is unknown");
  if (!(config.scenarios as readonly string[]).includes(scenario)) throw new TypeError("certification scenario was not selected during initialization");
  return Object.freeze([scenario as CertificationScenarioId]);
}

async function inspectInputSet(workspace: string, kind: "runners" | "tests"): Promise<CertificationInputSet> {
  const directory = path.join(workspace, "inputs", kind);
  let names: string[];
  try { names = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}\.json$/.test(entry.name)).map(entry => entry.name).sort(); }
  catch { names = []; }
  const artifacts = await Promise.all(names.map(async name => Object.freeze({ name, digest: `sha256:${createHash("sha256").update(await readFile(path.join(directory, name))).digest("hex")}` })));
  return Object.freeze({ status: artifacts.length ? "configured" : "absent", artifacts: Object.freeze(artifacts) });
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
