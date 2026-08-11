import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAuthorityDeployment, type AuthorityDeploymentManifest, type AuthorityDeploymentTrustEntry } from "./deployment.js";
import { normalizeSignedJobCard, type SignedJobCardV1 } from "../job.js";
import type { AuthorityStateSnapshot } from "../state.js";
import type { ConnectorRegistration } from "../connector.js";
import { normalizeConnectionAdoption, normalizeConnectionDescriptor, type ConnectionAdoptionV1, type ConnectionDescriptorV1 } from "../../observation/index.js";

export interface AuthorityDeploymentCandidateV1 {
  readonly v: "reelier.authority-deployment-candidate/v1";
  readonly jobCard: SignedJobCardV1;
  readonly connectionDescriptors: readonly ConnectionDescriptorV1[];
  readonly connectionAdoptions: readonly ConnectionAdoptionV1[];
  readonly state: AuthorityStateSnapshot;
  readonly connectors: readonly ConnectorRegistration[];
  readonly trust: readonly AuthorityDeploymentTrustEntry[];
  readonly sourceDirectory: string;
}

export interface BuiltAuthorityDeployment {
  readonly directory: string;
  readonly deploymentFile: string;
  readonly jobCardFile: string;
  readonly jobCard: SignedJobCardV1;
  readonly manifest: AuthorityDeploymentManifest;
}

const CANDIDATE_FIELDS = new Set(["connectionAdoptions", "connectionDescriptors", "connectors", "jobCard", "sourceDirectory", "state", "trust", "v"]);

/** Materialize a reviewed candidate into an immutable, self-contained deployment directory. */
export async function buildAuthorityDeployment(inputFile: string, outputDirectory: string, _legacySignerFile?: string): Promise<BuiltAuthorityDeployment> {
  const candidateFile = path.resolve(inputFile);
  const candidateRoot = path.dirname(candidateFile);
  const candidate = parseCandidate(JSON.parse(await readFile(candidateFile, "utf8")));
  const output = path.resolve(outputDirectory);
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  try {
    const jobCard = candidate.jobCard;
    const trust: AuthorityDeploymentTrustEntry[] = [];
    for (const entry of candidate.trust) {
      const sourceKey = resolveInside(candidateRoot, entry.publicKeyFile, "candidate trust key");
      const relative = normalizeRelative(entry.publicKeyFile);
      const targetRelative = path.posix.join("trust", relative);
      const target = resolveInside(output, targetRelative, "deployment trust key");
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(sourceKey, target);
      trust.push({ ...entry, publicKeyFile: targetRelative });
    }

    const sourceRoot = resolveInside(candidateRoot, candidate.sourceDirectory, "candidate source directory");
    const sourceTarget = path.join(output, "sources");
    await cp(sourceRoot, sourceTarget, { recursive: true, force: false, errorOnExist: true });
    const manifest: AuthorityDeploymentManifest = {
      v: "reelier.authority-deployment/v1",
      tenant: candidate.state.tenant,
      states: [candidate.state],
      connectors: candidate.connectors,
      trust,
      sourceDirectory: "sources",
      jobCard,
      connectionDescriptors: candidate.connectionDescriptors,
      connectionAdoptions: candidate.connectionAdoptions,
      enforcement: { completeness: "unchecked", declaredSurfaceExclusiveEnforcement: "unchecked", bypasses: [...new Set(candidate.connectionAdoptions.filter(adoption => adoption.rawWriteReachability !== "refused").map(() => "equivalent-raw-write-route-unmeasured-or-reachable"))] },
    };
    const deploymentFile = path.join(output, "deployment.json");
    const jobCardFile = path.join(output, "job.json");
    await writeFile(deploymentFile, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await writeFile(jobCardFile, `${JSON.stringify(jobCard, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    const loaded = await loadAuthorityDeployment(deploymentFile);
    return Object.freeze({ directory: output, deploymentFile, jobCardFile, jobCard, manifest: loaded });
  } catch (error) {
    await rm(output, { recursive: true, force: true }).catch(() => undefined);
    throw new TypeError(`deployment could not be built: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseCandidate(value: unknown): AuthorityDeploymentCandidateV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("deployment candidate must be an object");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !CANDIDATE_FIELDS.has(key)) || Object.keys(raw).length !== CANDIDATE_FIELDS.size || raw.v !== "reelier.authority-deployment-candidate/v1" || !raw.jobCard || !raw.state || !Array.isArray(raw.connectors) || !Array.isArray(raw.trust) || !Array.isArray(raw.connectionDescriptors) || !Array.isArray(raw.connectionAdoptions) || typeof raw.sourceDirectory !== "string" || !raw.sourceDirectory || path.isAbsolute(raw.sourceDirectory)) throw new TypeError("deployment candidate must contain a pre-existing signed job card and be closed");
  if (!Array.isArray((raw.state as Record<string, unknown>).candidates)) throw new TypeError("deployment candidate state is invalid");
  for (const entry of raw.trust) if (!entry || typeof entry !== "object" || typeof (entry as Record<string, unknown>).publicKeyFile !== "string") throw new TypeError("deployment candidate trust is invalid");
  return Object.freeze({ v: raw.v, jobCard: normalizeSignedJobCard(raw.jobCard), connectionDescriptors: Object.freeze(raw.connectionDescriptors.map(normalizeConnectionDescriptor)), connectionAdoptions: Object.freeze(raw.connectionAdoptions.map(normalizeConnectionAdoption)), state: raw.state as AuthorityStateSnapshot, connectors: Object.freeze(raw.connectors as ConnectorRegistration[]), trust: Object.freeze(raw.trust as AuthorityDeploymentTrustEntry[]), sourceDirectory: raw.sourceDirectory });
}

function normalizeRelative(value: string): string {
  if (path.isAbsolute(value) || value.split(/[\\/]+/u).includes("..")) throw new TypeError("deployment path must remain relative");
  return value.replaceAll("\\", "/");
}

function resolveInside(root: string, relative: string, label: string): string {
  normalizeRelative(relative);
  const resolved = path.resolve(root, relative);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(prefix)) throw new TypeError(`${label} must remain inside its workspace`);
  return resolved;
}
