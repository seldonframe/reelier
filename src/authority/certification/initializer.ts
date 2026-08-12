import { lstat, mkdir, mkdtemp, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { authorityDigest } from "../wire.js";
import { canonicalizeCertificationOperatorConfigV2, parseCertificationOperatorConfigV2 } from "./config.js";
import { createCertificationConfigCommitment, recomputeCertificationConfigCommitment } from "./commitment.js";
import { assertUnlinkedCreationParent, certificationWorkspaceRoot, readConfinedFile, readUnlinkedFile } from "./filesystem.js";
import { CERTIFICATION_SCENARIO_IDS, type CertificationScenarioId } from "./scenarios.js";
import { CERTIFICATION_SCENARIOS } from "./scenarios.js";
import { parseCertificationEndpointManifest, type CertificationEndpointManifestV1 } from "./manifests.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ID = /^(?:task|job|grant|cell|signer)_[0-9a-f]{24}$/;

export interface CertificationIdentifiers {
  readonly taskId: string;
  readonly jobCardId: string;
  readonly rootGrantId: string;
  readonly authorityCellId: string;
  readonly signerId: string;
}

export interface CertificationInitialization {
  readonly v: "reelier.certification-initialization/v1";
  readonly configDigest: string;
  readonly privateConfigDigest: string;
  readonly sanitizedProjectionDigest: string;
  readonly scenarios: readonly CertificationScenarioId[];
  readonly identifiers: CertificationIdentifiers;
  readonly completeness: "unchecked";
}

export async function initializeCertification(input: Readonly<{ configPath: string; workspace?: string; hooks?: Readonly<{ beforePublish?: () => Promise<void> }> }>): Promise<Readonly<{
  status: "initialized" | "resumed";
  workspace: string;
  configDigest: string;
  identifiers: CertificationIdentifiers;
}>> {
  const configPath = path.resolve(input.configPath);
  const workspace = path.resolve(input.workspace ?? path.join(path.dirname(configPath), "certification"));
  const parsed = parseCertificationOperatorConfigV2(JSON.parse((await readUnlinkedFile(configPath)).toString("utf8")));
  const canonicalConfig = canonicalizeCertificationOperatorConfigV2(parsed);
  const commitment = createCertificationConfigCommitment(parsed, parsed.scenarios);
  const configDigest = commitment.configCommitmentDigest;
  const identifiers = deriveCertificationIdentifiers(configDigest);
  const initialization: CertificationInitialization = Object.freeze({
    v: "reelier.certification-initialization/v1",
    configDigest,
    privateConfigDigest: commitment.privateConfigDigest,
    sanitizedProjectionDigest: commitment.sanitizedProjectionDigest,
    scenarios: parsed.scenarios,
    identifiers,
    completeness: "unchecked",
  });

  const workspaceInfo = await lstat(workspace).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : Promise.reject(error));
  if (workspaceInfo) {
    const root = await certificationWorkspaceRoot(workspace);
    const existingConfig = parseCertificationOperatorConfigV2(JSON.parse((await readConfinedFile(root, root, "config.json")).toString("utf8")));
    const existing = parseCertificationInitialization(JSON.parse((await readConfinedFile(root, root, "initialization.json")).toString("utf8")));
    validateCertificationInitialization(existingConfig, existing);
    if (existing.configDigest !== configDigest) throw new TypeError("certification initialization cannot resume with substituted configuration or identifiers");
    await validateCellScaffold(root, existingConfig, existing);
    return Object.freeze({ status: "resumed", workspace, configDigest, identifiers: existing.identifiers });
  }

  const creationParent = await assertUnlinkedCreationParent(workspace);
  const staging = await mkdtemp(path.join(creationParent, `.${path.basename(workspace)}.staging-`));
  const stageOwner = randomBytes(32).toString("hex");
  try {
    await writeFile(path.join(staging, ".stage-owner"), stageOwner, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await writeFile(path.join(staging, "config.json"), `${canonicalConfig}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await writeFile(path.join(staging, "initialization.json"), `${JSON.stringify(initialization)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await writeCellScaffold(staging, parsed, initialization);
    await input.hooks?.beforePublish?.();
    await rename(staging, workspace);
    await unlink(path.join(workspace, ".stage-owner"));
  } catch (error) {
    await removeOwnedStage(staging, creationParent, path.basename(workspace), stageOwner);
    const winnerInfo = await lstat(workspace).catch(inner => (inner as NodeJS.ErrnoException).code === "ENOENT" ? undefined : Promise.reject(inner));
    if (winnerInfo) {
      const root = await certificationWorkspaceRoot(workspace);
      const existingConfig = parseCertificationOperatorConfigV2(JSON.parse((await readConfinedFile(root, root, "config.json")).toString("utf8")));
      const existing = parseCertificationInitialization(JSON.parse((await readConfinedFile(root, root, "initialization.json")).toString("utf8")));
      validateCertificationInitialization(existingConfig, existing);
      if (existing.configDigest === configDigest) {
        await validateCellScaffold(root, existingConfig, existing);
        return Object.freeze({ status: "resumed", workspace, configDigest, identifiers: existing.identifiers });
      }
    }
    throw error;
  }
  return Object.freeze({ status: "initialized", workspace, configDigest, identifiers });
}

const ENDPOINTS: Readonly<Record<CertificationScenarioId, readonly Readonly<{ endpointId: string; direction: "read" | "write"; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" }>[]>> = Object.freeze({
  "cloudflare-dns": [{ endpointId: "cloudflare.dns.get", direction: "read", method: "GET" }, { endpointId: "cloudflare.dns.update", direction: "write", method: "PUT" }],
  "cloudflare-vercel-secret": [{ endpointId: "cloudflare.tokens.create", direction: "write", method: "POST" }, { endpointId: "cloudflare.tokens.get", direction: "read", method: "GET" }, { endpointId: "vercel.environment.get", direction: "read", method: "GET" }, { endpointId: "vercel.environment.set", direction: "write", method: "POST" }],
  "codex-ten-principal": [{ endpointId: "codex.session.inspect", direction: "read", method: "GET" }, { endpointId: "codex.session.launch", direction: "write", method: "POST" }],
  "fly-topology": [{ endpointId: "fly.machines.inspect", direction: "read", method: "GET" }],
  "github-issue-labels": [{ endpointId: "github.issue.get", direction: "read", method: "GET" }, { endpointId: "github.issue.labels.set", direction: "write", method: "PUT" }],
  "neon-migration": [{ endpointId: "neon.branch.inspect", direction: "read", method: "GET" }, { endpointId: "neon.migration.apply", direction: "write", method: "POST" }],
  "slack-topic": [{ endpointId: "slack.channel.inspect", direction: "read", method: "GET" }, { endpointId: "slack.channel.topic.set", direction: "write", method: "POST" }],
  "vercel-promotion": [{ endpointId: "vercel.deployment.inspect", direction: "read", method: "GET" }, { endpointId: "vercel.deployment.promote", direction: "write", method: "POST" }],
});

function providerFor(scenario: CertificationScenarioId): CertificationEndpointManifestV1["provider"] { return scenario.startsWith("cloudflare-") ? "cloudflare" : scenario.startsWith("codex-") ? "codex" : scenario.startsWith("fly-") ? "fly" : scenario.startsWith("github-") ? "github" : scenario.startsWith("neon-") ? "neon" : scenario.startsWith("slack-") ? "slack" : "vercel"; }
function derivedPrincipalId(identifiers: CertificationIdentifiers): string { return `principal_${authorityDigest({ v: "reelier.certification-principal-id/v1", taskId: identifiers.taskId, authorityCellId: identifiers.authorityCellId }).slice(7, 31)}`; }
function endpointManifest(config: ReturnType<typeof parseCertificationOperatorConfigV2>, scenario: CertificationScenarioId): CertificationEndpointManifestV1 {
  const definition = CERTIFICATION_SCENARIOS[scenario];
  const resourceProjection = { resources: definition.resourceSections.map(section => config.resources[section]), metadata: definition.metadataSections.map(section => config.metadata[section]) };
  return parseCertificationEndpointManifest({ v: "reelier.certification-endpoint-manifest/v1", scenarioId: scenario, provider: providerFor(scenario), resourceDigest: authorityDigest(resourceProjection), credentialSlots: definition.secretSlots, endpoints: ENDPOINTS[scenario], completeness: "unchecked" }, scenario);
}
async function writeCellScaffold(stage: string, config: ReturnType<typeof parseCertificationOperatorConfigV2>, initialization: CertificationInitialization): Promise<void> {
  const root = path.join(stage, "authority");
  const directories = ["decisions", "delegation", "deployment", "endpoints", "ledger", "principals", "receipts", "trust"];
  await Promise.all(directories.map(directory => mkdir(path.join(root, directory), { recursive: true, mode: 0o700 })));
  const authorityConfig = { version: 1, tenant: initialization.identifiers.authorityCellId, requester: derivedPrincipalId(initialization.identifiers), definitions: initialization.scenarios.map(scenario => scenario.replaceAll("-", "_")), topology: "unknown", ledgerDir: "ledger", decisionDir: "decisions", receiptDir: "receipts", ingress: { principalRegistryFile: "principals/registry.jsonl" }, endpoints: [], deploymentPath: "deployment/manifest.json", jobCardTrustPinPath: "trust/job-card-trust-pin.json", completeness: "unchecked", dispatchable: false };
  await writeFile(path.join(root, "authority.yml"), `${JSON.stringify(authorityConfig)}\n`, { flag: "wx", mode: 0o600 });
  await writeFile(path.join(root, "principals", "registry.jsonl"), "", { flag: "wx", mode: 0o600 });
  await writeFile(path.join(root, "trust", "references.json"), `${JSON.stringify({ v: "reelier.certification-trust-references/v1", humanTrustRootFile: "human-trust-root.json", keyDescriptorsFile: "key-descriptors.json", readinessTrustEventsFile: "readiness-trust-events.json", currentTrustEventsFile: "current-trust-events.json", signedReadinessFile: "signed-readiness.json" })}\n`, { flag: "wx", mode: 0o600 });
  await writeFile(path.join(root, "deployment", "references.json"), `${JSON.stringify({ v: "reelier.certification-deployment-references/v1", manifestFile: "manifest.json", jobCardFile: "job-card.json", jobCardTrustPinFile: "../trust/job-card-trust-pin.json" })}\n`, { flag: "wx", mode: 0o600 });
  for (const scenario of initialization.scenarios) await writeFile(path.join(root, "endpoints", `${scenario}.json`), `${JSON.stringify(endpointManifest(config, scenario))}\n`, { flag: "wx", mode: 0o600 });
}
async function validateCellScaffold(root: string, config: ReturnType<typeof parseCertificationOperatorConfigV2>, initialization: CertificationInitialization): Promise<void> {
  const authority = await import("./filesystem.js").then(module => module.confinedExistingDirectory(root, ["authority"]));
  const endpoints = authority ? await import("./filesystem.js").then(module => module.confinedExistingDirectory(root, ["authority", "endpoints"])) : undefined;
  if (!authority || !endpoints) throw new TypeError("certification Authority Cell scaffold is incomplete");
  const rawConfig = JSON.parse((await readConfinedFile(root, authority, "authority.yml")).toString("utf8"));
  if (rawConfig.tenant !== initialization.identifiers.authorityCellId || rawConfig.requester !== derivedPrincipalId(initialization.identifiers) || rawConfig.dispatchable !== false || rawConfig.completeness !== "unchecked") throw new TypeError("certification Authority Cell scaffold identity is invalid");
  for (const scenario of initialization.scenarios) {
    const actual = parseCertificationEndpointManifest(JSON.parse((await readConfinedFile(root, endpoints, `${scenario}.json`)).toString("utf8")), scenario);
    if (authorityDigest(actual) !== authorityDigest(endpointManifest(config, scenario))) throw new TypeError("certification endpoint manifest was substituted");
  }
}

async function removeOwnedStage(staging: string, creationParent: string, workspaceBasename: string, owner: string): Promise<void> {
  if (path.dirname(staging) !== creationParent || !path.basename(staging).startsWith(`.${workspaceBasename}.staging-`)) return;
  const info = await lstat(staging).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : Promise.reject(error));
  if (!info || !info.isDirectory() || info.isSymbolicLink()) return;
  let observed: string;
  try { observed = (await readUnlinkedFile(path.join(staging, ".stage-owner"))).toString("utf8"); } catch { return; }
  if (observed !== owner) return;
  await rm(staging, { recursive: true, force: true });
}

export function parseCertificationInitialization(value: unknown): CertificationInitialization {
  const root = object(value, "certification initialization");
  closed(root, ["v", "configDigest", "privateConfigDigest", "sanitizedProjectionDigest", "scenarios", "identifiers", "completeness"], "certification initialization");
  if (root.v !== "reelier.certification-initialization/v1" || root.completeness !== "unchecked" || typeof root.configDigest !== "string" || !DIGEST.test(root.configDigest) || typeof root.privateConfigDigest !== "string" || !DIGEST.test(root.privateConfigDigest) || typeof root.sanitizedProjectionDigest !== "string" || !DIGEST.test(root.sanitizedProjectionDigest) || recomputeCertificationConfigCommitment(root.privateConfigDigest, root.sanitizedProjectionDigest) !== root.configDigest) throw new TypeError("certification initialization is invalid");
  const rawIdentifiers = object(root.identifiers, "certification identifiers");
  closed(rawIdentifiers, ["taskId", "jobCardId", "rootGrantId", "authorityCellId", "signerId"], "certification identifiers");
  const identifiers = Object.freeze({
    taskId: internalId(rawIdentifiers.taskId, "task_"),
    jobCardId: internalId(rawIdentifiers.jobCardId, "job_"),
    rootGrantId: internalId(rawIdentifiers.rootGrantId, "grant_"),
    authorityCellId: internalId(rawIdentifiers.authorityCellId, "cell_"),
    signerId: internalId(rawIdentifiers.signerId, "signer_"),
  });
  const scenarios = scenarioList(root.scenarios);
  return Object.freeze({ v: "reelier.certification-initialization/v1", configDigest: root.configDigest, privateConfigDigest: root.privateConfigDigest, sanitizedProjectionDigest: root.sanitizedProjectionDigest, scenarios, identifiers, completeness: "unchecked" });
}

export function deriveCertificationIdentifiers(configDigest: string): CertificationIdentifiers {
  if (!DIGEST.test(configDigest)) throw new TypeError("certification config digest is invalid");
  const id = (prefix: string, kind: string) => `${prefix}${authorityDigest({ v: "reelier.certification-id/v1", configDigest, kind }).slice(7, 31)}`;
  return Object.freeze({ taskId: id("task_", "task"), jobCardId: id("job_", "job-card"), rootGrantId: id("grant_", "root-grant"), authorityCellId: id("cell_", "authority-cell"), signerId: id("signer_", "signer") });
}

export function validateCertificationInitialization(config: ReturnType<typeof parseCertificationOperatorConfigV2>, initialization: CertificationInitialization): void {
  const commitment = createCertificationConfigCommitment(config, config.scenarios);
  const derived = deriveCertificationIdentifiers(commitment.configCommitmentDigest);
  if (initialization.configDigest !== commitment.configCommitmentDigest || initialization.privateConfigDigest !== commitment.privateConfigDigest || initialization.sanitizedProjectionDigest !== commitment.sanitizedProjectionDigest || authorityDigest(initialization.scenarios) !== authorityDigest(config.scenarios) || authorityDigest(initialization.identifiers) !== authorityDigest(derived)) {
    throw new TypeError("certification initialization cannot resume with substituted configuration or identifiers");
  }
}

function internalId(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !ID.test(value) || !value.startsWith(prefix)) throw new TypeError("certification identifier is invalid");
  return value;
}
function scenarioList(value: unknown): readonly CertificationScenarioId[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== "string" || !(CERTIFICATION_SCENARIO_IDS as readonly string[]).includes(item))) throw new TypeError("certification initialization scenarios are invalid");
  const scenarios = value as CertificationScenarioId[];
  if (new Set(scenarios).size !== scenarios.length || scenarios.some((item, index) => index > 0 && scenarios[index - 1] >= item)) throw new TypeError("certification initialization scenarios must be unique and sorted");
  return Object.freeze([...scenarios]);
}
function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Record<string, unknown>; }
function closed(raw: Record<string, unknown>, keys: readonly string[], label: string): void { if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) throw new TypeError(`${label} is closed`); }
