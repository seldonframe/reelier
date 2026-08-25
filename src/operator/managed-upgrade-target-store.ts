import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  parseManagedUpgradeTargetManifestV1,
  type ManagedUpgradeTargetManifest,
} from "./autopilot-handoff-client.js";
import { recordConsequentialBoundaryV1, type ReviewedConsequentialOperationV1 } from "./managed-upgrade-intent.js";

export type ManagedUpgradeTargetBundleV1 = Readonly<{
  targetManifest: ManagedUpgradeTargetManifest;
  artifactBytes?: Uint8Array;
}>;

const MAX_MANIFEST_BYTES = 65_536;
const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;

function sha(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function checkedRoot(root: string): Promise<string> {
  const resolved = path.resolve(root);
  const canonical = await realpath(resolved);
  if (resolved !== canonical || !(await stat(canonical)).isDirectory()) throw new TypeError("Autopilot workspace root is linked or invalid");
  return canonical;
}

async function ensureDirectory(root: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true, mode: 0o700 });
  const canonical = await realpath(target);
  const relative = path.relative(root, canonical);
  if (canonical !== path.resolve(target) || relative.startsWith("..") || path.isAbsolute(relative)) throw new TypeError("Autopilot target directory is linked or escaped");
}

async function atomicWrite(target: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function optionalRead(target: string): Promise<Buffer | null> {
  try { return await readFile(target); } catch (error: unknown) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
}

async function firstDisplay(directory: string, operation: ReviewedConsequentialOperationV1): Promise<boolean> {
  const marker = path.join(directory, `shown-${operation}.marker`);
  try {
    const handle = await open(marker, "wx", 0o600);
    try { await handle.writeFile(`${operation}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
    return true;
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "EEXIST") return false;
    throw error;
  }
}

async function boundaryCta(directory: string, missionRef: string, operation: ReviewedConsequentialOperationV1, seen: Set<string>): Promise<string | null> {
  if (!(await firstDisplay(directory, operation))) return null;
  return recordConsequentialBoundaryV1({ missionRef, operation, seen });
}

async function bundleDirectory(root: string, missionRef: string): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(missionRef)) throw new TypeError("Autopilot mission reference is invalid");
  const operator = path.join(root, ".reelier", "operator");
  const targets = path.join(operator, "autopilot-targets");
  const mission = path.join(targets, missionRef);
  for (const directory of [path.join(root, ".reelier"), operator, targets, mission]) await ensureDirectory(root, directory);
  return mission;
}

export async function loadManagedUpgradeTargetBundleV1(input: Readonly<{ root: string; missionRef: string }>): Promise<ManagedUpgradeTargetBundleV1> {
  const root = await checkedRoot(input.root);
  const directory = await bundleDirectory(root, input.missionRef);
  const manifestPath = path.join(directory, "manifest.json");
  const details = await stat(manifestPath);
  if (!details.isFile() || details.size < 1 || details.size > MAX_MANIFEST_BYTES || await realpath(manifestPath) !== manifestPath) throw new TypeError("Autopilot target manifest is not a bounded unlinked file");
  const targetManifest = parseManagedUpgradeTargetManifestV1(JSON.parse(await readFile(manifestPath, "utf8")));
  if (targetManifest.missionRef !== input.missionRef) throw new TypeError("Autopilot target mission binding mismatch");
  if (targetManifest.version !== "reelier.managed-upgrade-target-manifest/v2" && targetManifest.version !== "reelier.managed-upgrade-target-manifest/v3") return Object.freeze({ targetManifest });
  const artifactPath = path.join(directory, "candidate.bin");
  const artifactDetails = await stat(artifactPath);
  if (!artifactDetails.isFile() || artifactDetails.size < 1 || artifactDetails.size > MAX_ARTIFACT_BYTES || await realpath(artifactPath) !== artifactPath) throw new TypeError("Autopilot candidate artifact is not a bounded unlinked file");
  const artifactBytes = await readFile(artifactPath);
  if (sha(artifactBytes) !== targetManifest.artifactDigest) throw new TypeError("Autopilot candidate artifact digest mismatch");
  return Object.freeze({ targetManifest, artifactBytes });
}

export async function stageManagedUpgradeTargetBundleV1(input: Readonly<{
  root: string;
  operation: ReviewedConsequentialOperationV1;
  targetManifest: ManagedUpgradeTargetManifest;
  artifactBytes?: Uint8Array;
  seen: Set<string>;
}>): Promise<Readonly<{ cta: string | null }>> {
  const root = await checkedRoot(input.root);
  const targetManifest = parseManagedUpgradeTargetManifestV1(input.targetManifest);
  const operations = "linearActions" in targetManifest ? [...targetManifest.githubActions, ...targetManifest.linearActions] : [...targetManifest.githubActions];
  if (!operations.includes(input.operation)) throw new TypeError("reviewed consequential operation is outside the exact target manifest");
  let artifactBytes: Uint8Array | undefined;
  if (targetManifest.version === "reelier.managed-upgrade-target-manifest/v2" || targetManifest.version === "reelier.managed-upgrade-target-manifest/v3") {
    if (!(input.artifactBytes instanceof Uint8Array) || input.artifactBytes.byteLength < 1 || input.artifactBytes.byteLength > MAX_ARTIFACT_BYTES) throw new TypeError("Autopilot candidate artifact is required");
    artifactBytes = new Uint8Array(input.artifactBytes);
    if (sha(artifactBytes) !== targetManifest.artifactDigest) throw new TypeError("Autopilot candidate artifact digest mismatch");
  } else if (input.artifactBytes !== undefined) {
    throw new TypeError("legacy Autopilot target cannot carry a candidate artifact");
  }
  const directory = await bundleDirectory(root, targetManifest.missionRef);
  const manifestBytes = Buffer.from(`${JSON.stringify(targetManifest)}\n`, "utf8");
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) throw new TypeError("Autopilot target manifest is too large");
  const manifestPath = path.join(directory, "manifest.json");
  const candidatePath = path.join(directory, "candidate.bin");
  const existingManifestBytes = await optionalRead(manifestPath);
  if (existingManifestBytes) {
    const existingManifest = parseManagedUpgradeTargetManifestV1(JSON.parse(existingManifestBytes.toString("utf8")));
    if (JSON.stringify(existingManifest) !== JSON.stringify(targetManifest)) throw new TypeError("existing Autopilot target conflicts with the exact reviewed manifest");
    const existing = await loadManagedUpgradeTargetBundleV1({ root, missionRef: targetManifest.missionRef });
    if (artifactBytes && (!existing.artifactBytes || sha(existing.artifactBytes) !== sha(artifactBytes))) throw new TypeError("existing Autopilot target artifact conflicts with the exact reviewed candidate");
    return Object.freeze({ cta: await boundaryCta(directory, targetManifest.missionRef, input.operation, input.seen) });
  }
  const orphanCandidate = await optionalRead(candidatePath);
  if (orphanCandidate && (!artifactBytes || sha(orphanCandidate) !== sha(artifactBytes))) throw new TypeError("existing Autopilot target artifact conflicts with the exact reviewed candidate");
  if (artifactBytes && !orphanCandidate) await atomicWrite(candidatePath, artifactBytes);
  await atomicWrite(manifestPath, manifestBytes);
  return Object.freeze({ cta: await boundaryCta(directory, targetManifest.missionRef, input.operation, input.seen) });
}
