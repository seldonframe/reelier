import { access, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../wire.js";
import { canonicalizeCertificationOperatorConfigV2, parseCertificationOperatorConfigV2 } from "./config.js";

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
  const parsed = parseCertificationOperatorConfigV2(JSON.parse(await readFile(configPath, "utf8")));
  const canonicalConfig = canonicalizeCertificationOperatorConfigV2(parsed);
  const configDigest = authorityDigest(parsed);
  const identifiers = deriveCertificationIdentifiers(configDigest);
  const initialization: CertificationInitialization = Object.freeze({
    v: "reelier.certification-initialization/v1",
    configDigest,
    identifiers,
    completeness: "unchecked",
  });

  if (await exists(workspace)) {
    const existingConfig = parseCertificationOperatorConfigV2(JSON.parse(await readFile(path.join(workspace, "config.json"), "utf8")));
    const existing = parseCertificationInitialization(JSON.parse(await readFile(path.join(workspace, "initialization.json"), "utf8")));
    if (authorityDigest(existingConfig) !== configDigest || existing.configDigest !== configDigest || authorityDigest(existing.identifiers) !== authorityDigest(identifiers)) {
      throw new TypeError("certification initialization cannot resume with substituted configuration or identifiers");
    }
    return Object.freeze({ status: "resumed", workspace, configDigest, identifiers: existing.identifiers });
  }

  await mkdir(path.dirname(workspace), { recursive: true });
  await removeInterruptedStages(path.dirname(workspace), `.${path.basename(workspace)}.staging-`);
  const staging = await mkdtemp(path.join(path.dirname(workspace), `.${path.basename(workspace)}.staging-`));
  try {
    await writeFile(path.join(staging, "config.json"), `${canonicalConfig}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await writeFile(path.join(staging, "initialization.json"), `${JSON.stringify(initialization)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await input.hooks?.beforePublish?.();
    await rename(staging, workspace);
  } catch (error) {
    if (path.dirname(staging) === path.dirname(workspace) && path.basename(staging).startsWith(`.${path.basename(workspace)}.staging-`)) {
      await rm(staging, { recursive: true, force: true });
    }
    if (await exists(workspace)) {
      const existingConfig = parseCertificationOperatorConfigV2(JSON.parse(await readFile(path.join(workspace, "config.json"), "utf8")));
      const existing = parseCertificationInitialization(JSON.parse(await readFile(path.join(workspace, "initialization.json"), "utf8")));
      if (authorityDigest(existingConfig) === configDigest && existing.configDigest === configDigest && authorityDigest(existing.identifiers) === authorityDigest(identifiers)) {
        return Object.freeze({ status: "resumed", workspace, configDigest, identifiers: existing.identifiers });
      }
    }
    throw error;
  }
  return Object.freeze({ status: "initialized", workspace, configDigest, identifiers });
}

export function parseCertificationInitialization(value: unknown): CertificationInitialization {
  const root = object(value, "certification initialization");
  closed(root, ["v", "configDigest", "identifiers", "completeness"], "certification initialization");
  if (root.v !== "reelier.certification-initialization/v1" || root.completeness !== "unchecked" || typeof root.configDigest !== "string" || !DIGEST.test(root.configDigest)) throw new TypeError("certification initialization is invalid");
  const rawIdentifiers = object(root.identifiers, "certification identifiers");
  closed(rawIdentifiers, ["taskId", "jobCardId", "rootGrantId", "authorityCellId", "signerId"], "certification identifiers");
  const identifiers = Object.freeze({
    taskId: internalId(rawIdentifiers.taskId, "task_"),
    jobCardId: internalId(rawIdentifiers.jobCardId, "job_"),
    rootGrantId: internalId(rawIdentifiers.rootGrantId, "grant_"),
    authorityCellId: internalId(rawIdentifiers.authorityCellId, "cell_"),
    signerId: internalId(rawIdentifiers.signerId, "signer_"),
  });
  return Object.freeze({ v: "reelier.certification-initialization/v1", configDigest: root.configDigest, identifiers, completeness: "unchecked" });
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
async function exists(file: string): Promise<boolean> { try { await access(file); return true; } catch { return false; } }
async function removeInterruptedStages(parent: string, prefix: string): Promise<void> {
  const cutoff = Date.now() - 5 * 60_000;
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (!entry.name.startsWith(prefix) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const candidate = path.resolve(parent, entry.name);
    if (path.dirname(candidate) !== path.resolve(parent) || !path.basename(candidate).startsWith(prefix)) continue;
    const info = await lstat(candidate);
    if (!info.isDirectory() || info.isSymbolicLink() || info.mtimeMs > cutoff) continue;
    await rm(candidate, { recursive: true, force: true });
  }
}
