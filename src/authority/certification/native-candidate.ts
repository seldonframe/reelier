import { createHash } from "node:crypto";
import { authorityCanonicalBytes, authorityDigest } from "../wire.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{7,64}$/i;
const LANE_IDS = ["operator-evidence", "provider-authority", "reconciliation-verifier"] as const;
const CHECKER_ROLES = ["contract", "pack", "task8", "task9"] as const;

export type NativeCandidateCheckerRole = typeof CHECKER_ROLES[number];
export interface NativeCandidateCheckerV1 {
  readonly role: NativeCandidateCheckerRole;
  readonly signerId: string;
  readonly publicKeyDigest: string;
  readonly verifierVersion: string;
  readonly verdictDigest: string;
}
export interface NativeCandidateProvenanceV1 {
  readonly v: "reelier.native-candidate-provenance/v1";
  readonly source: "clean-export";
  readonly reproducibility: "hermetic-offline";
  readonly liveProviderStatus: "absent";
  readonly credentialStatus: "absent";
  readonly workflowDispatch: "absent";
}
export interface NativeCandidateV1 {
  readonly v: "reelier.native-github-candidate/v1";
  readonly candidateId: string;
  readonly publicCommitSha: string;
  readonly tarballDigest: string;
  readonly laneCommits: readonly Readonly<{ laneId: string; commitSha: string }>[];
  readonly packDigest: string;
  readonly task8BaselineDigest: string;
  readonly portableEvidenceContractDigest: string;
  readonly checkerIdentities: readonly NativeCandidateCheckerV1[];
  readonly provenance: NativeCandidateProvenanceV1;
}

export interface NativeCandidateCreationInput {
  readonly publicCommitSha: string;
  readonly tarballBytes: Uint8Array;
  readonly task8Verification: Readonly<{ status: "verified"; digest: string }>;
  readonly task9Verification: Readonly<{ status: "verified"; digest: string }>;
  readonly laneCommits: readonly Readonly<{ laneId: string; commitSha: string }>[];
  readonly packDigest: string;
  readonly portableEvidenceContractDigest: string;
  readonly checkerIdentities: readonly NativeCandidateCheckerV1[];
}

export interface NativeCandidateVerificationInputs {
  readonly tarballBytes: Uint8Array;
  readonly publicCommitSha: string;
  readonly task8BaselineDigest: string;
  readonly portableEvidenceContractDigest: string;
}

export function createNativeCandidate(input: NativeCandidateCreationInput): Readonly<{ candidate: NativeCandidateV1; digest: string }> {
  validateCreationInput(input);
  const tarballDigest = bytesDigest(input.tarballBytes);
  const laneCommits = normalizeLanes(input.laneCommits);
  const expectedPack = nativePackDigest(input.publicCommitSha, tarballDigest, laneCommits);
  if (input.packDigest !== expectedPack) throw new TypeError("pack digest is not bound to the clean export and lane commits");
  const checkerIdentities = normalizeCheckers(input.checkerIdentities, input.task8Verification.digest, input.portableEvidenceContractDigest, input.packDigest, input.portableEvidenceContractDigest);
  const body = {
    v: "reelier.native-github-candidate/v1" as const,
    publicCommitSha: input.publicCommitSha,
    tarballDigest,
    laneCommits,
    packDigest: input.packDigest,
    task8BaselineDigest: input.task8Verification.digest,
    portableEvidenceContractDigest: input.portableEvidenceContractDigest,
    checkerIdentities,
    provenance: provenance(),
  };
  const digest = authorityDigest(body);
  const candidate = Object.freeze({ v: body.v, candidateId: digest, publicCommitSha: body.publicCommitSha, tarballDigest: body.tarballDigest, laneCommits: body.laneCommits, packDigest: body.packDigest, task8BaselineDigest: body.task8BaselineDigest, portableEvidenceContractDigest: body.portableEvidenceContractDigest, checkerIdentities: body.checkerIdentities, provenance: body.provenance }) as NativeCandidateV1;
  return Object.freeze({ candidate, digest });
}

/** Public, offline-only verifier. It accepts no executable dependency, key, credential, or provider adapter. */
export function verifyNativeCandidate(value: unknown, inputs: NativeCandidateVerificationInputs): Readonly<{ status: "verified"; candidateDigest: string }> {
  const candidate = parseCandidate(value);
  if (!inputs || !(inputs.tarballBytes instanceof Uint8Array)) throw new TypeError("native candidate tarball bytes are required");
  if (candidate.publicCommitSha !== inputs.publicCommitSha) throw new TypeError("native candidate public commit mismatch");
  if (candidate.task8BaselineDigest !== inputs.task8BaselineDigest) throw new TypeError("native candidate Task 8 baseline digest mismatch");
  if (candidate.portableEvidenceContractDigest !== inputs.portableEvidenceContractDigest) throw new TypeError("native candidate portable evidence contract digest mismatch");
  if (candidate.tarballDigest !== bytesDigest(inputs.tarballBytes)) throw new TypeError("native candidate tarball digest mismatch");
  validateCandidate(candidate);
  const expectedPack = nativePackDigest(candidate.publicCommitSha, candidate.tarballDigest, candidate.laneCommits);
  if (candidate.packDigest !== expectedPack) throw new TypeError("native candidate pack digest mismatch");
  const body = withoutCandidateId(candidate);
  const digest = authorityDigest(body);
  if (candidate.candidateId !== digest) throw new TypeError("native candidate ID is not its canonical digest");
  return Object.freeze({ status: "verified", candidateDigest: digest });
}

function validateCreationInput(input: NativeCandidateCreationInput): void {
  if (!plain(input) || input.task8Verification?.status !== "verified" || !DIGEST.test(input.task8Verification.digest)) throw new TypeError("Task 8 baseline must be verified before candidate creation");
  if (input.task9Verification?.status !== "verified" || !DIGEST.test(input.task9Verification.digest)) throw new TypeError("Task 9 portable evidence must be verified before candidate creation");
  if (typeof input.publicCommitSha !== "string" || !COMMIT.test(input.publicCommitSha)) throw new TypeError("public commit is invalid");
  if (!(input.tarballBytes instanceof Uint8Array) || input.tarballBytes.byteLength === 0) throw new TypeError("clean tarball bytes are required");
  if (!DIGEST.test(input.packDigest) || !DIGEST.test(input.portableEvidenceContractDigest)) throw new TypeError("candidate contract digests are invalid");
}

function parseCandidate(value: unknown): NativeCandidateV1 {
  let parsed: unknown = value;
  if (typeof value === "string" || value instanceof Uint8Array) {
    const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
    try { parsed = JSON.parse(bytes.toString("utf8")); } catch { throw new TypeError("native candidate JSON is invalid"); }
    if (!bytes.equals(authorityCanonicalBytes(parsed))) throw new TypeError("native candidate bytes are not RFC 8785/JCS canonical");
  }
  if (!plain(parsed)) throw new TypeError("native candidate must be a closed plain object");
  const keys = ["v", "candidateId", "publicCommitSha", "tarballDigest", "laneCommits", "packDigest", "task8BaselineDigest", "portableEvidenceContractDigest", "checkerIdentities", "provenance"];
  if (Object.keys(parsed).join("\0") !== keys.join("\0")) throw new TypeError("native candidate is not a closed canonical object");
  scanSecrets(parsed);
  return parsed as NativeCandidateV1;
}

function validateCandidate(candidate: NativeCandidateV1): void {
  if (candidate.v !== "reelier.native-github-candidate/v1" || !COMMIT.test(candidate.publicCommitSha) || !DIGEST.test(candidate.tarballDigest) || !DIGEST.test(candidate.packDigest) || !DIGEST.test(candidate.task8BaselineDigest) || !DIGEST.test(candidate.portableEvidenceContractDigest)) throw new TypeError("native candidate commitments are invalid");
  normalizeLanes(candidate.laneCommits);
  normalizeCheckers(candidate.checkerIdentities, candidate.task8BaselineDigest, candidate.portableEvidenceContractDigest, candidate.packDigest, candidate.portableEvidenceContractDigest);
  const p = candidate.provenance;
  if (!plain(p) || Object.keys(p).join("\0") !== ["v", "source", "reproducibility", "liveProviderStatus", "credentialStatus", "workflowDispatch"].join("\0") || p.v !== "reelier.native-candidate-provenance/v1" || p.source !== "clean-export" || p.reproducibility !== "hermetic-offline" || p.liveProviderStatus !== "absent" || p.credentialStatus !== "absent" || p.workflowDispatch !== "absent") throw new TypeError("native candidate provenance is stale or non-hermetic");
}

function normalizeLanes(value: readonly Readonly<{ laneId: string; commitSha: string }>[] | unknown): readonly Readonly<{ laneId: string; commitSha: string }>[] {
  if (!Array.isArray(value) || value.length !== LANE_IDS.length) throw new TypeError("native candidate lane set is incomplete");
  const result = value.map(item => { if (!plain(item) || Object.keys(item).join("\0") !== "laneId\0commitSha" || typeof item.laneId !== "string" || !COMMIT.test(item.commitSha)) throw new TypeError("native candidate lane commit is invalid"); return Object.freeze({ laneId: item.laneId, commitSha: item.commitSha }); });
  if (result.map(item => item.laneId).join("\0") !== [...LANE_IDS].sort().join("\0") || new Set(result.map(item => item.laneId)).size !== result.length) throw new TypeError("native candidate lanes must be known, unique, and sorted");
  return Object.freeze(result);
}

function normalizeCheckers(value: readonly NativeCandidateCheckerV1[] | unknown, task8Digest: string, task9Digest: string, packDigest: string, contractDigest: string): readonly NativeCandidateCheckerV1[] {
  if (!Array.isArray(value) || value.length !== CHECKER_ROLES.length) throw new TypeError("native candidate checker set is incomplete");
  const expected = new Map<string, string>([["task8", task8Digest], ["task9", task9Digest], ["pack", packDigest], ["contract", contractDigest]]);
  const result = value.map(item => { if (!plain(item) || Object.keys(item).join("\0") !== "role\0signerId\0publicKeyDigest\0verifierVersion\0verdictDigest" || typeof item.role !== "string" || !CHECKER_ROLES.includes(item.role as NativeCandidateCheckerRole) || typeof item.signerId !== "string" || !/^[a-z][a-z0-9-]{2,127}$/.test(item.signerId) || !DIGEST.test(item.publicKeyDigest) || typeof item.verifierVersion !== "string" || !/^[a-z][a-z0-9-]{1,63}\/v[0-9]+$/.test(item.verifierVersion) || !DIGEST.test(item.verdictDigest)) throw new TypeError("native candidate checker identity is invalid"); if (expected.get(item.role) !== item.verdictDigest) throw new TypeError("native candidate checker verdict binding is invalid"); return Object.freeze({ role: item.role as NativeCandidateCheckerRole, signerId: item.signerId, publicKeyDigest: item.publicKeyDigest, verifierVersion: item.verifierVersion, verdictDigest: item.verdictDigest }); });
  if (result.map(item => item.role).join("\0") !== CHECKER_ROLES.join("\0") || new Set(result.map(item => item.role)).size !== result.length) throw new TypeError("native candidate checkers must be unique and sorted");
  return Object.freeze(result);
}

function nativePackDigest(publicCommitSha: string, tarballDigest: string, laneCommits: readonly Readonly<{ laneId: string; commitSha: string }>[]): string { return authorityDigest({ v: "reelier.native-pack/v1", publicCommitSha, tarballDigest, laneCommits }); }
function bytesDigest(bytes: Uint8Array): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function provenance(): NativeCandidateProvenanceV1 { return Object.freeze({ v: "reelier.native-candidate-provenance/v1", source: "clean-export", reproducibility: "hermetic-offline", liveProviderStatus: "absent", credentialStatus: "absent", workflowDispatch: "absent" }); }
function withoutCandidateId(candidate: NativeCandidateV1): Omit<NativeCandidateV1, "candidateId"> { const { candidateId: _ignored, ...body } = candidate; return body; }
function plain(value: unknown): value is Record<string, any> { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function scanSecrets(value: unknown, key = ""): void { if (typeof value === "string" && /canary|bearer|secret|credential|token|authorization|cookie|ghp_/i.test(value)) throw new TypeError("native candidate contains secret material"); if (/^(bearerToken|credential|credentials|privateKey|secretToken|token|authorization|cookie)$/i.test(key)) throw new TypeError("native candidate contains secret material"); if (plain(value)) for (const [childKey, child] of Object.entries(value)) scanSecrets(child, childKey); else if (Array.isArray(value)) for (const child of value) scanSecrets(child, key); }
