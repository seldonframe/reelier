import { createPublicKey } from "node:crypto";
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadOrCreateLocalGateSigner } from "./gate-signer.js";
import { loadAuthorityDeployment, type AuthorityDeploymentManifest, type AuthorityDeploymentTrustEntry } from "./deployment.js";
import { signJobCard, type SignedJobCardV1, type UnsignedJobCardV1 } from "../job.js";
import type { AuthorityStateSnapshot } from "../state.js";
import type { ConnectorRegistration } from "../connector.js";

export interface AuthorityDeploymentCandidateV1 {
  readonly v: "reelier.authority-deployment-candidate/v1";
  readonly approved: true;
  readonly job: UnsignedJobCardV1;
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

const CANDIDATE_FIELDS = new Set(["approved", "connectors", "job", "sourceDirectory", "state", "trust", "v"]);

/** Materialize a reviewed candidate into an immutable, self-contained deployment directory. */
export async function buildAuthorityDeployment(inputFile: string, outputDirectory: string, signerFile: string): Promise<BuiltAuthorityDeployment> {
  const candidateFile = path.resolve(inputFile);
  const candidateRoot = path.dirname(candidateFile);
  const candidate = parseCandidate(JSON.parse(await readFile(candidateFile, "utf8")));
  const output = path.resolve(outputDirectory);
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  try {
    const signer = await loadOrCreateLocalGateSigner(signerFile);
    const jobCard = signJobCard(candidate.job, "local-gate", signer.privateKey);
    const publicKeyFile = path.join(output, "trust", "local-gate.pem");
    await mkdir(path.dirname(publicKeyFile), { recursive: true });
    await writeFile(publicKeyFile, createPublicKey(signer.privateKey).export({ type: "spki", format: "pem" }));

    const trust: AuthorityDeploymentTrustEntry[] = [{ signerId: "local-gate", principalId: jobCard.audiences[0] ?? "operator", publicKeyFile: "trust/local-gate.pem", purposes: ["principal", "gate-event"] }];
    for (const entry of candidate.trust) {
      if (entry.signerId === "local-gate") continue;
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
    };
    const deploymentFile = path.join(output, "deployment.json");
    const jobCardFile = path.join(output, "job.json");
    await writeFile(deploymentFile, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await writeFile(jobCardFile, `${JSON.stringify(jobCard, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    const loaded = await loadAuthorityDeployment(deploymentFile);
    return Object.freeze({ directory: output, deploymentFile, jobCardFile, jobCard, manifest: loaded });
  } catch (error) {
    throw new TypeError(`deployment could not be built: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseCandidate(value: unknown): AuthorityDeploymentCandidateV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("deployment candidate must be an object");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !CANDIDATE_FIELDS.has(key)) || raw.v !== "reelier.authority-deployment-candidate/v1" || raw.approved !== true || !raw.job || !raw.state || !Array.isArray(raw.connectors) || !Array.isArray(raw.trust) || typeof raw.sourceDirectory !== "string" || !raw.sourceDirectory || path.isAbsolute(raw.sourceDirectory)) throw new TypeError("deployment candidate must be an approved closed candidate");
  if (!Array.isArray((raw.state as Record<string, unknown>).candidates)) throw new TypeError("deployment candidate state is invalid");
  for (const entry of raw.trust) if (!entry || typeof entry !== "object" || typeof (entry as Record<string, unknown>).publicKeyFile !== "string") throw new TypeError("deployment candidate trust is invalid");
  return Object.freeze({ v: raw.v, approved: true, job: raw.job as UnsignedJobCardV1, state: raw.state as AuthorityStateSnapshot, connectors: Object.freeze(raw.connectors as ConnectorRegistration[]), trust: Object.freeze(raw.trust as AuthorityDeploymentTrustEntry[]), sourceDirectory: raw.sourceDirectory });
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
