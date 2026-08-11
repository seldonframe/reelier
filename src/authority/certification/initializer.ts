import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../wire.js";
import { canonicalizeCertificationOperatorConfigV2, parseCertificationOperatorConfigV2 } from "./config.js";
import { createCertificationConfigCommitment, recomputeCertificationConfigCommitment } from "./commitment.js";
import { assertUnlinkedCreationParent, certificationWorkspaceRoot, readConfinedFile, readUnlinkedFile } from "./filesystem.js";

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
    identifiers,
    completeness: "unchecked",
  });

  const workspaceInfo = await lstat(workspace).catch(error => (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : Promise.reject(error));
  if (workspaceInfo) {
    const root = await certificationWorkspaceRoot(workspace);
    const existingConfig = parseCertificationOperatorConfigV2(JSON.parse((await readConfinedFile(root, root, "config.json")).toString("utf8")));
    const existing = parseCertificationInitialization(JSON.parse((await readConfinedFile(root, root, "initialization.json")).toString("utf8")));
    const existingCommitment = createCertificationConfigCommitment(existingConfig, existingConfig.scenarios);
    if (existingCommitment.configCommitmentDigest !== configDigest || existing.configDigest !== configDigest || existing.privateConfigDigest !== commitment.privateConfigDigest || existing.sanitizedProjectionDigest !== commitment.sanitizedProjectionDigest || authorityDigest(existing.identifiers) !== authorityDigest(identifiers)) {
      throw new TypeError("certification initialization cannot resume with substituted configuration or identifiers");
    }
    return Object.freeze({ status: "resumed", workspace, configDigest, identifiers: existing.identifiers });
  }

  await mkdir(path.dirname(workspace), { recursive: true });
  const creationParent = await assertUnlinkedCreationParent(workspace);
  const staging = await mkdtemp(path.join(creationParent, `.${path.basename(workspace)}.staging-`));
  try {
    await writeFile(path.join(staging, "config.json"), `${canonicalConfig}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await writeFile(path.join(staging, "initialization.json"), `${JSON.stringify(initialization)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await input.hooks?.beforePublish?.();
    await rename(staging, workspace);
  } catch (error) {
    if (path.dirname(staging) === path.dirname(workspace) && path.basename(staging).startsWith(`.${path.basename(workspace)}.staging-`)) {
      await rm(staging, { recursive: true, force: true });
    }
    const winnerInfo = await lstat(workspace).catch(inner => (inner as NodeJS.ErrnoException).code === "ENOENT" ? undefined : Promise.reject(inner));
    if (winnerInfo) {
      const root = await certificationWorkspaceRoot(workspace);
      const existingConfig = parseCertificationOperatorConfigV2(JSON.parse((await readConfinedFile(root, root, "config.json")).toString("utf8")));
      const existing = parseCertificationInitialization(JSON.parse((await readConfinedFile(root, root, "initialization.json")).toString("utf8")));
      const existingCommitment = createCertificationConfigCommitment(existingConfig, existingConfig.scenarios);
      if (existingCommitment.configCommitmentDigest === configDigest && existing.configDigest === configDigest && existing.privateConfigDigest === commitment.privateConfigDigest && existing.sanitizedProjectionDigest === commitment.sanitizedProjectionDigest && authorityDigest(existing.identifiers) === authorityDigest(identifiers)) {
        return Object.freeze({ status: "resumed", workspace, configDigest, identifiers: existing.identifiers });
      }
    }
    throw error;
  }
  return Object.freeze({ status: "initialized", workspace, configDigest, identifiers });
}

export function parseCertificationInitialization(value: unknown): CertificationInitialization {
  const root = object(value, "certification initialization");
  closed(root, ["v", "configDigest", "privateConfigDigest", "sanitizedProjectionDigest", "identifiers", "completeness"], "certification initialization");
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
  return Object.freeze({ v: "reelier.certification-initialization/v1", configDigest: root.configDigest, privateConfigDigest: root.privateConfigDigest, sanitizedProjectionDigest: root.sanitizedProjectionDigest, identifiers, completeness: "unchecked" });
}

export function deriveCertificationIdentifiers(configDigest: string): CertificationIdentifiers {
  if (!DIGEST.test(configDigest)) throw new TypeError("certification config digest is invalid");
  const id = (prefix: string, kind: string) => `${prefix}${authorityDigest({ v: "reelier.certification-id/v1", configDigest, kind }).slice(7, 31)}`;
  return Object.freeze({ taskId: id("task_", "task"), jobCardId: id("job_", "job-card"), rootGrantId: id("grant_", "root-grant"), authorityCellId: id("cell_", "authority-cell"), signerId: id("signer_", "signer") });
}

function internalId(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !ID.test(value) || !value.startsWith(prefix)) throw new TypeError("certification identifier is invalid");
  return value;
}
function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Record<string, unknown>; }
function closed(raw: Record<string, unknown>, keys: readonly string[], label: string): void { if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) throw new TypeError(`${label} is closed`); }
