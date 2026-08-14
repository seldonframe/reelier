import { createHash, type KeyObject } from "node:crypto";
import { authorityCanonicalBytes, authorityDigest } from "../wire.js";
import { signAuthorityDigest, verifyAuthoritySignature } from "../crypto.js";
import type { AuthoritySignature } from "../types.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{7,64}$/i;
const JOB_KEYS = ["v", "candidate", "os", "portable", "lifecycle", "providerClaim", "nativeHostRefusedBeforeMutation", "repo", "toolchain", "provenance", "skips", "status", "conclusion", "secretsScan", "artifactDigest", "signerId", "signature"];
const DECISION_KEYS = ["v", "state", "candidateDigest", "ubuntuArtifactDigest", "windowsArtifactDigest", "workflowRunId", "ubuntuJobId", "windowsJobId", "decision", "reasons", "liveProviderClaim", "signedAt", "signerId", "signature"];

export type Gate4State = "not-run" | "insufficient" | "failed" | "ready-for-founder-decision";
export type Gate4DecisionStatus = "approved" | "refused" | "blocked";

export interface Gate4CandidateBindingV1 {
  readonly v: "reelier.native-github-candidate/v1";
  readonly candidateId: string;
  readonly publicCommitSha: string;
  readonly tarballDigest: string;
  readonly packDigest: string;
  readonly task8BaselineDigest: string;
  readonly task9VerificationDigest: string;
  readonly portableEvidenceContractDigest: string;
  readonly laneCommits: readonly Readonly<{ laneId: string; commitSha: string }>[];
  readonly checkerIdentities: readonly Readonly<{ role: string; signerId: string; publicKeyDigest: string; verifierVersion: string; verdictDigest: string }>[];
  readonly provenance: Readonly<{ v: "reelier.native-candidate-provenance/v1"; source: "clean-export"; reproducibility: "hermetic-offline"; liveProviderStatus: "absent"; credentialStatus: "absent"; workflowDispatch: "absent" }>;
}

export interface Gate4HostedArtifactV1 {
  readonly v: "reelier.native-github-hosted-artifact/v1";
  readonly candidate: Gate4CandidateBindingV1;
  readonly os: "ubuntu-latest" | "windows-latest";
  readonly portable: Readonly<{ schema: "reelier.sanitized-portable-outcome-evidence/v1"; graphDigest: string; graphCount: number; outcomeCollectionDigest: string; outcomeCount: number }>;
  readonly lifecycle: Readonly<{ terminal: true; reconciliation: "matched"; noResendCount: 0; cleanupReceipt: string }>;
  readonly providerClaim: "absent" | "verified";
  readonly nativeHostRefusedBeforeMutation: boolean;
  readonly repo: Readonly<{ publicCommitSha: string; workflowRef: string; workflowSha: string; runnerSourceCommitSha: string; checkoutSha: string; verifierSourceCommitSha: string }>;
  readonly toolchain: Readonly<{ nodeMajor: 20; npmVersion: string; runnerImage: string }>;
  readonly provenance: Readonly<{ source: "offline-fixture" | "hosted-run"; createdAt: string; expiresAt: string; jobId: string }>;
  readonly skips: Readonly<{ count: 0; reviewed: true }>;
  readonly status: "completed";
  readonly conclusion: "success";
  readonly secretsScan: "clean";
  readonly artifactDigest: string;
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}

export interface Gate4HostedBundleV1 {
  readonly v: "reelier.native-github-hosted-bundle/v1";
  readonly candidate: Gate4CandidateBindingV1;
  readonly workflow: Readonly<{ runId: string; attempt: 1; source: "offline-fixture" | "hosted-run"; workflowSha: string }>;
  readonly jobs: readonly [Gate4HostedArtifactV1, Gate4HostedArtifactV1];
  readonly signerId: string;
}

export interface Gate4VerificationInputs {
  readonly candidate: Gate4CandidateBindingV1;
  readonly artifactBytes: Readonly<{ ubuntu: Uint8Array; windows: Uint8Array }>;
  readonly now: string;
  readonly verifier: Readonly<{ signerId: string; publicKey: KeyObject }>;
  readonly execution: "offline-fixture" | "hosted-run";
  readonly expectedRunnerSourceCommitSha: string;
}

export interface Gate4VerificationResult {
  readonly state: Gate4State;
  readonly decision: Gate4DecisionStatus;
  readonly candidateDigest: string;
  readonly ubuntuArtifactDigest: string;
  readonly windowsArtifactDigest: string;
  readonly workflowRunId: string;
  readonly ubuntuJobId: string;
  readonly windowsJobId: string;
  readonly reasons: readonly string[];
  readonly liveProviderClaim: "absent" | "verified";
  readonly signedAt: string;
  readonly signerId: string;
}

export interface Gate4DecisionV1 extends Gate4VerificationResult {
  readonly v: "reelier.native-github-gate4-decision/v1";
  readonly signature: AuthoritySignature;
}

export function verifyGate4Bundle(value: unknown, inputs: Gate4VerificationInputs): Gate4VerificationResult {
  const bundle = parseBundle(value);
  if (!inputs || !isPlain(inputs.candidate) || !isDigest(inputs.candidate.candidateId)) throw new TypeError("refused: expected candidate binding is missing");
  validateCandidateBinding(inputs.candidate);
  if (bundle.workflow.source !== inputs.execution) throw new TypeError("refused: workflow execution provenance does not match verifier context");
  if (bundle.signerId !== inputs.verifier.signerId) throw new TypeError("refused: bundle signer is not the trusted checker");
  if (!COMMIT.test(bundle.workflow.workflowSha)) throw new TypeError("refused: workflow source commit is invalid");
  if (authorityDigest(bundle.candidate) !== authorityDigest(inputs.candidate)) throw new TypeError("refused: hosted bundle candidate binding mismatch");
  if (bundle.candidate.candidateId !== inputs.candidate.candidateId) throw new TypeError("refused: hosted evidence is from the wrong candidate");
  if (bundle.workflow.attempt !== 1) throw new TypeError("refused: retrying hosted verification would obscure an attempt");
  const now = Date.parse(inputs.now);
  if (!Number.isFinite(now)) throw new TypeError("refused: verification time is invalid");
  const jobs = [...bundle.jobs];
  if (jobs.length !== 2 || jobs.map(job => job.os).sort().join("\0") !== "ubuntu-latest\0windows-latest") throw new TypeError("refused: Ubuntu and Windows artifact pair is incomplete or asymmetric");
  const ubuntu = jobs.find(job => job.os === "ubuntu-latest")!;
  const windows = jobs.find(job => job.os === "windows-latest")!;
  if (ubuntu.provenance.jobId === windows.provenance.jobId) throw new TypeError("refused: Ubuntu and Windows job IDs must be distinct");
  const runnerSourceCommit = ubuntu.repo.runnerSourceCommitSha;
  if (!COMMIT.test(runnerSourceCommit) || bundle.workflow.workflowSha !== runnerSourceCommit || windows.repo.runnerSourceCommitSha !== runnerSourceCommit) throw new TypeError("refused: workflow and runner source provenance are inconsistent");
  const bytesByOs = inputs.artifactBytes;
  verifyHostedArtifact(ubuntu, bytesByOs.ubuntu, inputs, now);
  verifyHostedArtifact(windows, bytesByOs.windows, inputs, now);
  if (ubuntu.portable.graphDigest !== windows.portable.graphDigest || ubuntu.portable.graphCount !== windows.portable.graphCount || ubuntu.portable.outcomeCollectionDigest !== windows.portable.outcomeCollectionDigest || ubuntu.portable.outcomeCount !== windows.portable.outcomeCount) throw new TypeError("refused: portable evidence is not cross-platform identical");
  if (ubuntu.lifecycle.cleanupReceipt !== windows.lifecycle.cleanupReceipt || ubuntu.lifecycle.noResendCount !== windows.lifecycle.noResendCount) throw new TypeError("refused: lifecycle evidence is not cross-platform identical");
  if (ubuntu.nativeHostRefusedBeforeMutation || !windows.nativeHostRefusedBeforeMutation) throw new TypeError("refused: native host execution boundary is not proven");
  if (ubuntu.providerClaim === "absent" && windows.providerClaim === "verified") throw new TypeError("refused: Windows cannot assert the provider claim");
  const state: Gate4State = inputs.execution === "offline-fixture" ? "insufficient" : "ready-for-founder-decision";
  const reasons = inputs.execution === "offline-fixture" ? ["offline-fixture-not-hosted"] : ["human-founder-decision-required"];
  return Object.freeze({
    state,
    decision: "blocked" as const,
    candidateDigest: bundle.candidate.candidateId,
    ubuntuArtifactDigest: ubuntu.artifactDigest,
    windowsArtifactDigest: windows.artifactDigest,
    workflowRunId: bundle.workflow.runId,
    ubuntuJobId: ubuntu.provenance.jobId,
    windowsJobId: windows.provenance.jobId,
    reasons: Object.freeze(reasons),
    liveProviderClaim: ubuntu.providerClaim,
    signedAt: inputs.now,
    signerId: inputs.verifier.signerId,
  });
}

/** A missing hosted bundle is a first-class state, never an implicit pass. */
export function createGate4NotRunResult(input: Readonly<{ candidateDigest: string; signedAt: string; signerId: string }>): Gate4VerificationResult {
  if (!isDigest(input.candidateDigest) || !Number.isFinite(Date.parse(input.signedAt)) || typeof input.signerId !== "string" || input.signerId === "") throw new TypeError("refused: not-run status binding is invalid");
  return Object.freeze({ state: "not-run" as const, decision: "blocked" as const, candidateDigest: input.candidateDigest, ubuntuArtifactDigest: `sha256:${"0".repeat(64)}`, windowsArtifactDigest: `sha256:${"0".repeat(64)}`, workflowRunId: "not-run", ubuntuJobId: "not-run", windowsJobId: "not-run", reasons: Object.freeze(["hosted-verification-not-run"]), liveProviderClaim: "absent" as const, signedAt: input.signedAt, signerId: input.signerId });
}

export function createGate4Decision(result: Gate4VerificationResult, signer: Readonly<{ signerId: string; privateKey: KeyObject; signedAt: string }>): Gate4DecisionV1 {
  if (!result || result.decision === "approved") throw new TypeError("refused: only a verified non-approved Gate 4 result may be signed locally");
  const body = { v: "reelier.native-github-gate4-decision/v1" as const, state: result.state, candidateDigest: result.candidateDigest, ubuntuArtifactDigest: result.ubuntuArtifactDigest, windowsArtifactDigest: result.windowsArtifactDigest, workflowRunId: result.workflowRunId, ubuntuJobId: result.ubuntuJobId, windowsJobId: result.windowsJobId, decision: result.decision, reasons: result.reasons, liveProviderClaim: result.liveProviderClaim, signedAt: signer.signedAt, signerId: signer.signerId };
  return Object.freeze({ ...body, signature: signAuthorityDigest(signer.privateKey, "release-evidence", authorityDigest(body)) });
}

export function verifyGate4Decision(value: unknown, verifier: Readonly<{ signerId: string; publicKey: KeyObject }>): "verified" {
  if (!isPlain(value) || keys(value).join("\0") !== DECISION_KEYS.join("\0")) throw new TypeError("refused: Gate 4 decision is not a closed record");
  const item = value as Record<string, any>;
  scanSecrets(item);
  if (item.v !== "reelier.native-github-gate4-decision/v1" || !["not-run", "insufficient", "failed", "ready-for-founder-decision"].includes(item.state) || !["approved", "refused", "blocked"].includes(item.decision) || !isDigest(item.candidateDigest) || !isDigest(item.ubuntuArtifactDigest) || !isDigest(item.windowsArtifactDigest) || typeof item.workflowRunId !== "string" || typeof item.ubuntuJobId !== "string" || typeof item.windowsJobId !== "string" || !Array.isArray(item.reasons) || item.reasons.some((reason: unknown) => typeof reason !== "string") || !["absent", "verified"].includes(item.liveProviderClaim) || !Number.isFinite(Date.parse(item.signedAt)) || item.signerId !== verifier.signerId) throw new TypeError("refused: Gate 4 decision fields are invalid");
  const { signature, ...body } = item;
  if (!isSignature(signature) || !verifyAuthoritySignature(verifier.publicKey, "release-evidence", authorityDigest(body), signature)) throw new TypeError("refused: Gate 4 decision signature is invalid");
  if (item.decision === "approved" && (item.state !== "ready-for-founder-decision" || item.liveProviderClaim !== "verified" || item.reasons.length !== 0)) throw new TypeError("refused: Gate 4 approval lacks verified live evidence or still has reasons");
  if (item.state === "insufficient" && item.decision !== "blocked") throw new TypeError("refused: insufficient evidence cannot be approved or refused");
  if (item.state === "not-run" && item.liveProviderClaim !== "absent") throw new TypeError("refused: not-run cannot claim live evidence");
  return "verified";
}

function parseBundle(value: unknown): Gate4HostedBundleV1 {
  if (!isPlain(value) || keys(value).join("\0") !== ["v", "candidate", "workflow", "jobs", "signerId"].join("\0")) throw new TypeError("refused: hosted bundle is not a closed record");
  const item = value as Record<string, any>;
  scanSecrets(item);
  if (item.v !== "reelier.native-github-hosted-bundle/v1" || !isPlain(item.candidate) || !isPlain(item.workflow) || !Array.isArray(item.jobs) || typeof item.signerId !== "string") throw new TypeError("refused: hosted bundle envelope is invalid");
  if (keys(item.workflow).join("\0") !== "runId\0attempt\0source\0workflowSha") throw new TypeError("refused: workflow provenance record is not closed");
  if (item.workflow.runId === "" || item.workflow.attempt !== 1 || !["offline-fixture", "hosted-run"].includes(item.workflow.source) || typeof item.workflow.workflowSha !== "string") throw new TypeError("refused: workflow provenance is invalid");
  return item as Gate4HostedBundleV1;
}

function verifyHostedArtifact(job: Gate4HostedArtifactV1, bytes: Uint8Array, inputs: Gate4VerificationInputs, now: number): void {
  if (!isPlain(job as unknown) || keys(job as unknown as Record<string, unknown>).join("\0") !== JOB_KEYS.join("\0")) throw new TypeError("refused: hosted artifact has unknown, missing, or reordered fields");
  if (keys(job.portable).join("\0") !== "schema\0graphDigest\0graphCount\0outcomeCollectionDigest\0outcomeCount" || keys(job.lifecycle).join("\0") !== "terminal\0reconciliation\0noResendCount\0cleanupReceipt" || keys(job.repo).join("\0") !== "publicCommitSha\0workflowRef\0workflowSha\0runnerSourceCommitSha\0checkoutSha\0verifierSourceCommitSha" || keys(job.toolchain).join("\0") !== "nodeMajor\0npmVersion\0runnerImage" || keys(job.provenance).join("\0") !== "source\0createdAt\0expiresAt\0jobId" || keys(job.skips).join("\0") !== "count\0reviewed") throw new TypeError("refused: hosted artifact provenance records are not closed");
  if (job.v !== "reelier.native-github-hosted-artifact/v1" || !["ubuntu-latest", "windows-latest"].includes(job.os) || authorityDigest(job.candidate) !== authorityDigest(inputs.candidate) || job.repo.publicCommitSha !== inputs.candidate.publicCommitSha || job.repo.workflowSha !== job.repo.runnerSourceCommitSha || job.repo.checkoutSha !== job.repo.runnerSourceCommitSha || job.repo.verifierSourceCommitSha !== job.repo.runnerSourceCommitSha || job.toolchain.nodeMajor !== 20 || job.toolchain.runnerImage !== job.os || job.status !== "completed" || job.conclusion !== "success" || job.secretsScan !== "clean" || job.skips.count !== 0 || job.skips.reviewed !== true || job.lifecycle.terminal !== true || job.lifecycle.reconciliation !== "matched" || job.lifecycle.noResendCount !== 0 || !isDigest(job.lifecycle.cleanupReceipt) || !isDigest(job.portable.graphDigest) || !isDigest(job.portable.outcomeCollectionDigest) || !isDigest(job.artifactDigest) || job.portable.schema !== "reelier.sanitized-portable-outcome-evidence/v1" || !Number.isInteger(job.portable.graphCount) || job.portable.graphCount < 1 || !Number.isInteger(job.portable.outcomeCount) || job.portable.outcomeCount < 1 || !COMMIT.test(job.repo.publicCommitSha) || !COMMIT.test(job.repo.workflowSha) || !COMMIT.test(job.repo.runnerSourceCommitSha) || !COMMIT.test(job.repo.checkoutSha) || !COMMIT.test(job.repo.verifierSourceCommitSha) || job.provenance.source !== inputs.execution || (inputs.execution === "offline-fixture" && job.providerClaim !== "absent")) throw new TypeError("refused: hosted artifact provenance or portable evidence binding is invalid");
  const created = Date.parse(job.provenance.createdAt), expires = Date.parse(job.provenance.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created > now || expires <= now || expires - created > 48 * 60 * 60 * 1000 || job.provenance.jobId === "") throw new TypeError("refused: hosted artifact is stale or has invalid time provenance");
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw new TypeError("refused: hosted artifact bytes are not JSON"); }
  if (!isPlain(parsed) || authorityDigest(parsed) !== authorityDigest(job)) throw new TypeError("refused: hosted artifact bytes do not match the signed record");
  const { signature, signerId, artifactDigest, ...payload } = job as any;
  if (artifactDigest !== authorityDigest(payload)) throw new TypeError("refused: hosted artifact digest is not recomputed from its payload");
  const body = { ...payload, artifactDigest, signerId };
  if (job.signerId !== inputs.verifier.signerId || !isSignature(signature) || !verifyAuthoritySignature(inputs.verifier.publicKey, "authority-evidence", authorityDigest(body), signature)) throw new TypeError("refused: hosted artifact signature is invalid or unsigned");
  if (job.os === "windows-latest" && (job.providerClaim !== "absent" || !job.nativeHostRefusedBeforeMutation)) throw new TypeError("refused: Windows artifact must refuse native hosting before mutation");
  if (job.os === "ubuntu-latest" && job.nativeHostRefusedBeforeMutation) throw new TypeError("refused: Ubuntu artifact has an invalid native-host refusal claim");
}

function validateCandidateBinding(candidate: Gate4CandidateBindingV1): void {
  if (keys(candidate as unknown as Record<string, unknown>).join("\0") !== "v\0candidateId\0publicCommitSha\0tarballDigest\0laneCommits\0packDigest\0task8BaselineDigest\0task9VerificationDigest\0portableEvidenceContractDigest\0checkerIdentities\0provenance") throw new TypeError("refused: candidate binding is not a complete NativeCandidateV1 record");
  if (candidate.v !== "reelier.native-github-candidate/v1" || !COMMIT.test(candidate.publicCommitSha) || !isDigest(candidate.tarballDigest) || !isDigest(candidate.packDigest) || !isDigest(candidate.task8BaselineDigest) || !isDigest(candidate.task9VerificationDigest) || !isDigest(candidate.portableEvidenceContractDigest) || !Array.isArray(candidate.laneCommits) || candidate.laneCommits.length !== 3 || !Array.isArray(candidate.checkerIdentities) || candidate.checkerIdentities.length !== 4 || !isPlain(candidate.provenance) || keys(candidate.provenance).join("\0") !== "v\0source\0reproducibility\0liveProviderStatus\0credentialStatus\0workflowDispatch" || candidate.provenance.v !== "reelier.native-candidate-provenance/v1" || candidate.provenance.source !== "clean-export" || candidate.provenance.reproducibility !== "hermetic-offline" || candidate.provenance.liveProviderStatus !== "absent" || candidate.provenance.credentialStatus !== "absent" || candidate.provenance.workflowDispatch !== "absent") throw new TypeError("refused: candidate commit, digest, or hermetic provenance binding is incomplete");
  const laneIds = candidate.laneCommits.map(item => item.laneId);
  if (laneIds.join("\0") !== ["operator-evidence", "provider-authority", "reconciliation-verifier"].join("\0") || new Set(laneIds).size !== laneIds.length || candidate.laneCommits.some(item => !isPlain(item) || keys(item).join("\0") !== "laneId\0commitSha" || !COMMIT.test(item.commitSha))) throw new TypeError("refused: candidate lane commits are missing, reordered, or duplicated");
  const checkerRoles = candidate.checkerIdentities.map(item => item.role);
  if (checkerRoles.join("\0") !== ["contract", "pack", "task8", "task9"].join("\0") || new Set(checkerRoles).size !== checkerRoles.length || candidate.checkerIdentities.some(item => !isPlain(item) || keys(item).join("\0") !== "role\0signerId\0publicKeyDigest\0verifierVersion\0verdictDigest" || typeof item.signerId !== "string" || !isDigest(item.publicKeyDigest) || typeof item.verifierVersion !== "string" || !/^[a-z0-9-]+\/v[0-9]+$/.test(item.verifierVersion) || !isDigest(item.verdictDigest))) throw new TypeError("refused: candidate checker identities are missing, reordered, or duplicated");
  const { candidateId, ...body } = candidate;
  if (!isDigest(candidateId) || authorityDigest(body) !== candidateId) throw new TypeError("refused: candidate ID is not the digest of the complete canonical NativeCandidateV1 record");
}

function isDigest(value: unknown): value is string { return typeof value === "string" && DIGEST.test(value); }
function isSignature(value: unknown): value is AuthoritySignature { return isPlain(value) && keys(value).join("\0") === "alg\0sig" && value.alg === "ed25519" && typeof value.sig === "string" && Buffer.from(value.sig, "base64").length === 64 && Buffer.from(value.sig, "base64").toString("base64") === value.sig; }
function isPlain(value: unknown): value is Record<string, any> { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function keys(value: Record<string, unknown>): string[] { return Object.keys(value); }
function scanSecrets(value: unknown, key = ""): void { if (typeof value === "string" && /canary|bearer|secret|password|authorization|cookie|ghp_|api[_-]?key/i.test(value)) throw new TypeError("refused: hosted artifact contains secret or canary material"); if (/^(authorization|cookie|secret|token|password|credential|apiKey)$/i.test(key)) throw new TypeError("refused: hosted artifact contains a secret-bearing field"); if (isPlain(value)) for (const [childKey, child] of Object.entries(value)) scanSecrets(child, childKey); else if (Array.isArray(value)) for (const child of value) scanSecrets(child, key); }

export function gate4ArtifactBytesDigest(bytes: Uint8Array): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
