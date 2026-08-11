import { lstat, mkdtemp, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { authorityDigest } from "../wire.js";
import { canonicalizeCertificationOperatorConfigV2, parseCertificationOperatorConfigV2 } from "./config.js";
import { createCertificationConfigCommitment, recomputeCertificationConfigCommitment } from "./commitment.js";
import { assertUnlinkedCreationParent, certificationWorkspaceRoot, readConfinedFile, readUnlinkedFile } from "./filesystem.js";
import { CERTIFICATION_SCENARIO_IDS, type CertificationScenarioId } from "./scenarios.js";

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
    return Object.freeze({ status: "resumed", workspace, configDigest, identifiers: existing.identifiers });
  }

  const creationParent = await assertUnlinkedCreationParent(workspace);
  const staging = await mkdtemp(path.join(creationParent, `.${path.basename(workspace)}.staging-`));
  const stageOwner = randomBytes(32).toString("hex");
  try {
    await writeFile(path.join(staging, ".stage-owner"), stageOwner, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await writeFile(path.join(staging, "config.json"), `${canonicalConfig}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await writeFile(path.join(staging, "initialization.json"), `${JSON.stringify(initialization)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await input.hooks?.beforePublish?.();
    await rename(staging, workspace);
    await unlink(path.join(workspace, ".stage-owner"));
  } catch (error) {
    await removeOwnedStage(staging, workspace, stageOwner);
    const winnerInfo = await lstat(workspace).catch(inner => (inner as NodeJS.ErrnoException).code === "ENOENT" ? undefined : Promise.reject(inner));
    if (winnerInfo) {
      const root = await certificationWorkspaceRoot(workspace);
      const existingConfig = parseCertificationOperatorConfigV2(JSON.parse((await readConfinedFile(root, root, "config.json")).toString("utf8")));
      const existing = parseCertificationInitialization(JSON.parse((await readConfinedFile(root, root, "initialization.json")).toString("utf8")));
      validateCertificationInitialization(existingConfig, existing);
      if (existing.configDigest === configDigest) {
        return Object.freeze({ status: "resumed", workspace, configDigest, identifiers: existing.identifiers });
      }
    }
    throw error;
  }
  return Object.freeze({ status: "initialized", workspace, configDigest, identifiers });
}

async function removeOwnedStage(staging: string, workspace: string, owner: string): Promise<void> {
  if (path.dirname(staging) !== path.dirname(workspace) || !path.basename(staging).startsWith(`.${path.basename(workspace)}.staging-`)) return;
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
