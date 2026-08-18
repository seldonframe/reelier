import { createHash, createPublicKey, KeyObject } from "node:crypto";
import { types as utilTypes } from "node:util";
import { signAuthorityDigest, verifyAuthoritySignature } from "./crypto.js";
import type { AuthoritySignature, AuthoritySignaturePurpose } from "./types.js";
import { authorityCanonicalBytes, authorityDigest } from "./wire.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const RELEASE_BASE = "e600ad5c2dc5e1bde0714915e7a84980c8d5602b";
const RELEASE_BRANCH = "reelier/release/0.32.1";
const RELEASE_PATHS = ["CHANGELOG.md", "src/cli.ts", "test/cli-subcommand-help.test.ts"] as const;
const RELEASE_DESTINATIONS = ["ghcr", "mcp-registry", "npm"] as const;
const RELEASE_EFFECTS = ["candidate-branch", "draft-pr", "exact-sha-merge", "non-force-tag"] as const;
const RELEASE_WORKFLOWS = [".github/workflows/ci.yml", ".github/workflows/docker-publish.yml", ".github/workflows/mcp-publish.yml", ".github/workflows/npm-publish.yml"] as const;
const FORBIDDEN_CHANGE_CLASSES = ["authority-contract", "credential", "dependency", "generated-contract", "lockfile", "policy", "release-script", "workflow"] as const;
const QUALITY_LANES = ["ci-coverage", "ci-full-tests", "ci-mutation"] as const;
const RECEIPT_LANES = ["candidate-branch", "candidate-pull-request", "ghcr-immutable-manifest", "ghcr-tags", "human-authorization", "human-exceptions", "human-interruptions", "human-post-release-review", "installed-linux", "installed-windows", "mcp-registry-version", "merge-exact-sha", "npm-integrity", "npm-provenance", "tag-immutable-ref"] as const;
const SIGNER_ID = /^[a-z0-9][a-z0-9._:-]{7,127}$/;

export type ReleaseDestinationV1 = (typeof RELEASE_DESTINATIONS)[number];
export type ReleaseProviderEffectV1 = (typeof RELEASE_EFFECTS)[number];
export type ReleaseEvidenceStatus = "verified" | "failed" | "pending" | "absent" | "unchecked" | "ambiguity";
export type ReleaseEvidenceLaneV1 = (typeof QUALITY_LANES)[number] | (typeof RECEIPT_LANES)[number];

export interface ReleaseVerifierEvidenceV1 {
  readonly v: "reelier.release-verifier-evidence/v1";
  readonly authorizationBundleDigest: string | null;
  readonly candidateCommit: string | null;
  readonly count: number | null;
  readonly freshUntil: string | null;
  readonly lane: ReleaseEvidenceLaneV1;
  readonly observation: "authority-decision" | "human-attestation" | "installed-package" | "provider-readback" | "workflow-run";
  readonly observedAt: string;
  readonly resultValue: number | null;
  readonly status: ReleaseEvidenceStatus;
  readonly subjectDigest: string;
  readonly workflowDigest: string | null;
  readonly workflowPath: string | null;
}

export interface StagedCandidateManifestV1 {
  readonly v: "reelier.staged-candidate-manifest/v1";
  readonly baseCommit: string;
  readonly branch: string;
  readonly candidateCommit: string;
  readonly candidateTreeDigest: string;
  readonly changedBytes: number;
  readonly changedPaths: readonly string[];
  readonly destinationBranch: "main";
  readonly packageName: "reelier";
  readonly packageVersion: "0.32.1";
  readonly packedTarballDigest: string;
  readonly qualityEvidence: Readonly<{
    coverageEvidenceDigest: string;
    coverageStatus: "non-regressed";
    fullTestEvidenceDigest: string;
    fullTestsStatus: "verified";
    headCommit: string;
    mutationEvidenceDigest: string;
    mutationScoreBasisPoints: number;
  }>;
  readonly repository: "seldonframe/reelier";
  readonly tag: "v0.32.1";
  readonly workflowCommitments: readonly Readonly<{ digest: string; path: string }>[];
}

export interface ReleaseOperationPlanV1 {
  readonly v: "reelier.release-operation-plan/v1";
  readonly baseCommit: string;
  readonly baseTreeSha: string;
  readonly candidateBranch: string;
  readonly candidateTreeDigest: string;
  readonly commit: Readonly<{
    author: ReleaseGitIdentityV1;
    committer: ReleaseGitIdentityV1;
    message: string;
    parentSha: string;
  }>;
  readonly destinationBranch: "main";
  readonly expectedCommitSha: string;
  readonly expectedTreeSha: string;
  readonly files: readonly ReleaseCandidateFileV1[];
  readonly npmPreflight: Readonly<{ packageName: "reelier"; version: "0.32.1"; versionMustBeAbsent: true }>;
  readonly pullRequest: Readonly<{ base: "main"; body: string; draft: true; head: "reelier/release/0.32.1"; title: string }>;
  readonly repository: "seldonframe/reelier";
  readonly requiredChecks: readonly string[];
  readonly squash: Readonly<{ commitMessage: string; commitTitle: string }>;
  readonly tag: "v0.32.1";
  readonly workflowCommitments: readonly Readonly<{ digest: string; path: string }>[];
}

export interface ReleaseGitIdentityV1 { readonly date: string; readonly email: string; readonly name: string }
export interface ReleaseCandidateFileV1 { readonly blobSha: string; readonly contentDigest: string; readonly mode: "100644"; readonly path: string }

export interface ReleasePolicyV1 {
  readonly v: "reelier.release-policy/v1";
  readonly allowedPaths: readonly string[];
  readonly destinations: readonly ReleaseDestinationV1[];
  readonly effectAllocations: readonly ReleaseProviderEffectV1[];
  readonly expirySeconds: 43200;
  readonly forbiddenChangeClasses: readonly string[];
  readonly maxChangedBytes: 65536;
  readonly maxChangedFiles: 3;
}

export interface ReleaseEffectAllocationV1 {
  readonly allocationDigest: string;
  readonly allocationId: string;
  readonly effect: ReleaseProviderEffectV1;
  readonly maxEffects: 1;
}

export interface ReleaseAuthorizationBundleV1 {
  readonly v: "reelier.release-authorization-bundle/v1";
  readonly authorityCellDigest: string;
  readonly effectAllocations: readonly ReleaseEffectAllocationV1[];
  readonly evidenceVerifierBindings: readonly ReleaseEvidenceVerifierBindingV1[];
  readonly expiresAt: string;
  readonly issuedAt: string;
  readonly jobCardDigest: string;
  readonly missionDigest: string;
  readonly operationPlanDigest: string;
  readonly packDigest: string;
  readonly policyDigest: string;
  readonly receiptGraphMakerBinding: ReleaseReceiptGraphMakerBindingV1;
  readonly rootGrantDigest: string;
  readonly stagedCandidateManifestDigest: string;
  readonly taskDigest: string;
}

export interface ReleaseReceiptGraphMakerBindingV1 {
  readonly publicKeySpkiDigest: string;
  readonly signerId: string;
}

export interface ReleaseEvidenceVerifierBindingV1 {
  readonly lane: ReleaseEvidenceLaneV1;
  readonly publicKeySpkiDigest: string;
  readonly signerId: string;
}

interface EvidenceLaneV1 { readonly evidenceDigest: string; readonly status: ReleaseEvidenceStatus }
interface CountedEvidenceLaneV1 { readonly count: number; readonly evidenceDigests: readonly string[]; readonly status: ReleaseEvidenceStatus }
interface FreshEvidenceLaneV1 extends EvidenceLaneV1 { readonly freshUntil: string; readonly observedAt: string }

export interface ReleaseReceiptGraphV1 {
  readonly v: "reelier.release-receipt-graph/v1";
  readonly authorizationBundleDigest: string;
  readonly candidate: Readonly<{ branch: EvidenceLaneV1; pullRequest: EvidenceLaneV1 }>;
  readonly completeness: "unchecked";
  readonly ghcr: Readonly<{ immutableManifest: EvidenceLaneV1; tags: EvidenceLaneV1 }>;
  readonly human: Readonly<{
    authorization: Readonly<EvidenceLaneV1 & { count: number }>;
    exceptions: CountedEvidenceLaneV1;
    interruptions: CountedEvidenceLaneV1;
    postReleaseReview: EvidenceLaneV1;
  }>;
  readonly installedChecks: Readonly<{ linux: FreshEvidenceLaneV1; windows: FreshEvidenceLaneV1 }>;
  readonly mcpRegistry: Readonly<{ version: EvidenceLaneV1 }>;
  readonly merge: Readonly<{ exactSha: EvidenceLaneV1 }>;
  readonly npm: Readonly<{ integrity: EvidenceLaneV1; provenance: EvidenceLaneV1 }>;
  readonly tag: Readonly<{ immutableRef: EvidenceLaneV1 }>;
  readonly verifiedAt: string;
}

export interface SignedReleaseArtifactV1<T, V extends string> {
  readonly digest: string;
  readonly signature: AuthoritySignature;
  readonly signerId: string;
  readonly v: V;
  readonly value: T;
}

export type SignedStagedCandidateManifestV1 = SignedReleaseArtifactV1<StagedCandidateManifestV1, "reelier.signed-staged-candidate-manifest/v1">;
export type SignedReleaseOperationPlanV1 = SignedReleaseArtifactV1<ReleaseOperationPlanV1, "reelier.signed-release-operation-plan/v1">;
export type SignedReleasePolicyV1 = SignedReleaseArtifactV1<ReleasePolicyV1, "reelier.signed-release-policy/v1">;
export type SignedReleaseAuthorizationBundleV1 = SignedReleaseArtifactV1<ReleaseAuthorizationBundleV1, "reelier.signed-release-authorization-bundle/v1">;
export type SignedReleaseReceiptGraphV1 = SignedReleaseArtifactV1<ReleaseReceiptGraphV1, "reelier.signed-release-receipt-graph/v1">;
export type SignedReleaseVerifierEvidenceV1 = SignedReleaseArtifactV1<ReleaseVerifierEvidenceV1, "reelier.signed-release-verifier-evidence/v1">;

export interface ReleaseContractSignerV1 { readonly signerId: string; readonly privateKey: KeyObject }
export interface ReleaseContractVerifierV1 { readonly publicKeySpkiBase64: string; readonly signerId: string }
export interface ReleaseEvidenceVerificationV1 { readonly evidence: unknown; readonly verifier: ReleaseContractVerifierV1 }
export interface VerifiedReleaseAuthorizationV1 { readonly authorization: SignedReleaseAuthorizationBundleV1; readonly candidateManifest: SignedStagedCandidateManifestV1; readonly operationPlan: SignedReleaseOperationPlanV1; readonly policy: SignedReleasePolicyV1 }
export interface VerifiedReleaseReceiptGraphV1 { readonly evaluation: Readonly<{ completeness: "unchecked"; status: "verified" | "incomplete"; success: boolean }>; readonly graph: SignedReleaseReceiptGraphV1 }
interface InternalReleaseContractVerifierV1 { readonly publicKey: KeyObject; readonly publicKeySpkiDigest: string; readonly signerId: string }
const verifiedAuthorizations = new WeakSet<object>();

export function assertVerifiedReleaseAuthorizationV1(value: unknown): asserts value is VerifiedReleaseAuthorizationV1 {
  if (!value || typeof value !== "object" || !verifiedAuthorizations.has(value as object)) throw new TypeError("verified release authorization brand is required");
}

export function createSignedReleaseVerifierEvidenceV1(value: ReleaseVerifierEvidenceV1, signer: ReleaseContractSignerV1): SignedReleaseVerifierEvidenceV1 {
  return signRelease(parseReleaseVerifierEvidenceV1(value), signer, "reelier.signed-release-verifier-evidence/v1", "release-evidence");
}

export function parseSignedReleaseVerifierEvidenceV1(value: unknown): SignedReleaseVerifierEvidenceV1 {
  return parseSignedRelease(value, "reelier.signed-release-verifier-evidence/v1", parseReleaseVerifierEvidenceV1);
}

export function createSignedStagedCandidateManifestV1(value: StagedCandidateManifestV1, signer: ReleaseContractSignerV1): SignedStagedCandidateManifestV1 {
  return signRelease(parseStagedCandidateManifestV1(value), signer, "reelier.signed-staged-candidate-manifest/v1", "release-authorization");
}

export function createSignedReleaseOperationPlanV1(value: ReleaseOperationPlanV1, signer: ReleaseContractSignerV1): SignedReleaseOperationPlanV1 {
  return signRelease(parseReleaseOperationPlanV1(value), signer, "reelier.signed-release-operation-plan/v1", "release-authorization");
}

export function createSignedReleasePolicyV1(value: ReleasePolicyV1, signer: ReleaseContractSignerV1): SignedReleasePolicyV1 {
  return signRelease(parseReleasePolicyV1(value), signer, "reelier.signed-release-policy/v1", "release-authorization");
}

export function createSignedReleaseAuthorizationBundleV1(value: ReleaseAuthorizationBundleV1, signer: ReleaseContractSignerV1): SignedReleaseAuthorizationBundleV1 {
  return signRelease(parseReleaseAuthorizationBundleV1(value), signer, "reelier.signed-release-authorization-bundle/v1", "release-authorization");
}

export function createSignedReleaseReceiptGraphV1(value: ReleaseReceiptGraphV1, signer: ReleaseContractSignerV1): SignedReleaseReceiptGraphV1 {
  return signRelease(parseReleaseReceiptGraphV1(value), signer, "reelier.signed-release-receipt-graph/v1", "release-receipt");
}

export function parseSignedStagedCandidateManifestV1(value: unknown): SignedStagedCandidateManifestV1 {
  return parseSignedRelease(value, "reelier.signed-staged-candidate-manifest/v1", parseStagedCandidateManifestV1);
}

export function parseSignedReleaseOperationPlanV1(value: unknown): SignedReleaseOperationPlanV1 {
  return parseSignedRelease(value, "reelier.signed-release-operation-plan/v1", parseReleaseOperationPlanV1);
}

export function parseSignedReleasePolicyV1(value: unknown): SignedReleasePolicyV1 {
  return parseSignedRelease(value, "reelier.signed-release-policy/v1", parseReleasePolicyV1);
}

export function parseSignedReleaseAuthorizationBundleV1(value: unknown): SignedReleaseAuthorizationBundleV1 {
  return parseSignedRelease(value, "reelier.signed-release-authorization-bundle/v1", parseReleaseAuthorizationBundleV1);
}

export function parseSignedReleaseReceiptGraphV1(value: unknown): SignedReleaseReceiptGraphV1 {
  return parseSignedRelease(value, "reelier.signed-release-receipt-graph/v1", parseReleaseReceiptGraphV1);
}

export function parseCanonicalSignedReleaseAuthorizationBundleV1(json: string): SignedReleaseAuthorizationBundleV1 {
  return parseCanonicalReleaseJson(json, parseSignedReleaseAuthorizationBundleV1, "release authorization bundle");
}

export function parseCanonicalSignedStagedCandidateManifestV1(json: string): SignedStagedCandidateManifestV1 {
  return parseCanonicalReleaseJson(json, parseSignedStagedCandidateManifestV1, "staged candidate manifest");
}

export function parseCanonicalSignedReleasePolicyV1(json: string): SignedReleasePolicyV1 {
  return parseCanonicalReleaseJson(json, parseSignedReleasePolicyV1, "release policy");
}

export function parseCanonicalSignedReleaseReceiptGraphV1(json: string): SignedReleaseReceiptGraphV1 {
  return parseCanonicalReleaseJson(json, parseSignedReleaseReceiptGraphV1, "release receipt graph");
}

export function verifyReleaseAuthorizationBundleV1(
  input: Readonly<{ authorization: unknown; candidateManifest: unknown; operationPlan: unknown; policy: unknown }>,
  verifier: ReleaseContractVerifierV1,
  now: Date,
  qualityEvidence: readonly ReleaseEvidenceVerificationV1[],
): VerifiedReleaseAuthorizationV1 {
  const verificationTime = snapshotVerificationTime(now, "release authorization verification clock");
  const inputs = exact(input, ["authorization", "candidateManifest", "operationPlan", "policy"], "release authorization inputs");
  const trustedVerifier = parseReleaseContractVerifierInput(verifier, "release authorization verifier");
  const authorization = verifySigned(parseSignedReleaseAuthorizationBundleV1(inputs.authorization), trustedVerifier, "release-authorization");
  const candidateManifest = verifySigned(parseSignedStagedCandidateManifestV1(inputs.candidateManifest), trustedVerifier, "release-authorization");
  const operationPlan = verifySigned(parseSignedReleaseOperationPlanV1(inputs.operationPlan), trustedVerifier, "release-authorization");
  const policy = verifySigned(parseSignedReleasePolicyV1(inputs.policy), trustedVerifier, "release-authorization");
  if (authorization.value.stagedCandidateManifestDigest !== candidateManifest.digest) throw new TypeError("release authorization candidate manifest digest mismatch");
  if (authorization.value.operationPlanDigest !== operationPlan.digest) throw new TypeError("release authorization operation plan digest mismatch");
  if (candidateManifest.value.candidateTreeDigest !== operationPlan.value.candidateTreeDigest || candidateManifest.value.candidateCommit !== operationPlan.value.expectedCommitSha || !equalStrings(candidateManifest.value.workflowCommitments.map(item => `${item.path}:${item.digest}`), operationPlan.value.workflowCommitments.map(item => `${item.path}:${item.digest}`))) throw new TypeError("release operation plan does not match the staged candidate manifest");
  if (authorization.value.policyDigest !== policy.digest) throw new TypeError("release authorization policy digest mismatch");
  if (verificationTime < Date.parse(authorization.value.issuedAt)) throw new TypeError("release authorization is not yet valid before issuedAt");
  if (verificationTime >= Date.parse(authorization.value.expiresAt)) throw new TypeError("release authorization is expired");
  const authorizationKeyDigest = trustedVerifier.publicKeySpkiDigest;
  if (authorization.value.receiptGraphMakerBinding.publicKeySpkiDigest === authorizationKeyDigest || authorization.value.evidenceVerifierBindings.some(binding => binding.publicKeySpkiDigest === authorizationKeyDigest)) throw new TypeError("release authorization signer, receipt graph maker, and evidence checker keys must be separate by SPKI digest");
  if (candidateManifest.value.changedPaths.length > policy.value.maxChangedFiles || candidateManifest.value.changedBytes > policy.value.maxChangedBytes) throw new TypeError("release candidate exceeds policy size limits");
  if (!equalStrings(candidateManifest.value.changedPaths, policy.value.allowedPaths)) throw new TypeError("release candidate paths do not equal policy allowed paths");
  if (!equalStrings(authorization.value.effectAllocations.map(item => item.effect), policy.value.effectAllocations)) throw new TypeError("release effect allocations do not equal policy effects");
  verifyQualityEvidence(candidateManifest, authorization, qualityEvidence, verificationTime);
  const verified = deepFreeze({ authorization, candidateManifest, operationPlan, policy });
  verifiedAuthorizations.add(verified);
  return verified;
}

export function verifyReleaseReceiptGraphV1(value: unknown, verifier: ReleaseContractVerifierV1, authorization: VerifiedReleaseAuthorizationV1, evidence: readonly ReleaseEvidenceVerificationV1[], now: Date): VerifiedReleaseReceiptGraphV1 {
  const nowTime = snapshotVerificationTime(now, "release receipt graph verification clock");
  if (!authorization || !verifiedAuthorizations.has(authorization)) throw new TypeError("release receipt verification requires a verified authorization and trusted evidence bindings");
  const authorizationBundleDigest = authorization.authorization.digest;
  const trustedVerifier = parseReleaseContractVerifierInput(verifier, "release receipt graph verifier");
  const graph = verifySigned(parseSignedReleaseReceiptGraphV1(value), trustedVerifier, "release-receipt");
  const makerBinding = authorization.authorization.value.receiptGraphMakerBinding;
  if (graph.signerId !== makerBinding.signerId || trustedVerifier.publicKeySpkiDigest !== makerBinding.publicKeySpkiDigest) throw new TypeError("release receipt graph verifier does not match the authorization-bound graph maker");
  if (graph.value.authorizationBundleDigest !== authorizationBundleDigest) throw new TypeError("release receipt graph authorization digest mismatch");
  const graphTime = Date.parse(graph.value.verifiedAt);
  const issuedAt = Date.parse(authorization.authorization.value.issuedAt);
  const expiresAt = Date.parse(authorization.authorization.value.expiresAt);
  if (graphTime < issuedAt || graphTime >= expiresAt || graphTime > nowTime) throw new TypeError("release receipt graph verifiedAt is outside authorization chronology or in the verification future");
  verifyReceiptEvidence(graph, authorization.authorization, evidence);
  const success = requiredStatuses(graph.value).every(status => status === "verified");
  return deepFreeze({ evaluation: { completeness: "unchecked" as const, status: success ? "verified" as const : "incomplete" as const, success }, graph });
}

function parseStagedCandidateManifestV1(value: unknown): StagedCandidateManifestV1 {
  const item = exact(value, ["baseCommit", "branch", "candidateCommit", "candidateTreeDigest", "changedBytes", "changedPaths", "destinationBranch", "packageName", "packageVersion", "packedTarballDigest", "qualityEvidence", "repository", "tag", "v", "workflowCommitments"], "staged candidate manifest") as unknown as StagedCandidateManifestV1;
  if (item.v !== "reelier.staged-candidate-manifest/v1" || item.repository !== "seldonframe/reelier" || item.baseCommit !== RELEASE_BASE || item.destinationBranch !== "main" || item.branch !== RELEASE_BRANCH || item.tag !== "v0.32.1" || item.packageName !== "reelier" || item.packageVersion !== "0.32.1") throw new TypeError("staged candidate manifest release identity or ref is invalid");
  requireCommit(item.candidateCommit, "candidate commit");
  requireDigest(item.candidateTreeDigest, "candidate tree");
  requireDigest(item.packedTarballDigest, "packed tarball");
  if (!Number.isSafeInteger(item.changedBytes) || item.changedBytes < 0 || item.changedBytes > 65_536) throw new TypeError("staged candidate manifest changed bytes are invalid");
  requireExactSet(item.changedPaths, RELEASE_PATHS, "changed paths");
  const quality = exact(item.qualityEvidence, ["coverageEvidenceDigest", "coverageStatus", "fullTestEvidenceDigest", "fullTestsStatus", "headCommit", "mutationEvidenceDigest", "mutationScoreBasisPoints"], "release quality evidence");
  requireDigest(quality.coverageEvidenceDigest, "coverage evidence");
  requireDigest(quality.fullTestEvidenceDigest, "full test evidence");
  requireDigest(quality.mutationEvidenceDigest, "mutation evidence");
  if (quality.coverageStatus !== "non-regressed" || quality.fullTestsStatus !== "verified" || quality.headCommit !== item.candidateCommit || !Number.isSafeInteger(quality.mutationScoreBasisPoints) || quality.mutationScoreBasisPoints < 9_000 || quality.mutationScoreBasisPoints > 10_000) throw new TypeError("release quality evidence does not bind full tests, non-regressed coverage, mutation >=90%, and candidate head");
  if (!Array.isArray(item.workflowCommitments) || item.workflowCommitments.length !== RELEASE_WORKFLOWS.length) throw new TypeError("release workflow commitments must contain the exact production workflow path set");
  for (let index = 0; index < item.workflowCommitments.length; index += 1) {
    const raw = item.workflowCommitments[index];
    const commitment = exact(raw, ["digest", "path"], "release workflow commitment");
    requireDigest(commitment.digest, "workflow");
    if (commitment.path !== RELEASE_WORKFLOWS[index]) throw new TypeError("release workflow commitments must contain the exact production workflow path set");
  }
  return normalize(item);
}

function parseReleaseOperationPlanV1(value: unknown): ReleaseOperationPlanV1 {
  const item = exact(value, ["baseCommit", "baseTreeSha", "candidateBranch", "candidateTreeDigest", "commit", "destinationBranch", "expectedCommitSha", "expectedTreeSha", "files", "npmPreflight", "pullRequest", "repository", "requiredChecks", "squash", "tag", "v", "workflowCommitments"], "release operation plan") as unknown as ReleaseOperationPlanV1;
  if (item.v !== "reelier.release-operation-plan/v1" || item.repository !== "seldonframe/reelier" || item.baseCommit !== RELEASE_BASE || item.candidateBranch !== RELEASE_BRANCH || item.destinationBranch !== "main" || item.tag !== "v0.32.1") throw new TypeError("release operation plan identity or ref is invalid");
  requireCommit(item.expectedCommitSha, "release expected commit");
  requireCommit(item.expectedTreeSha, "release expected tree");
  requireCommit(item.baseTreeSha, "release base tree");
  requireDigest(item.candidateTreeDigest, "release candidate tree");
  if (!Array.isArray(item.files) || item.files.length !== RELEASE_PATHS.length) throw new TypeError("release operation plan files must be complete");
  const files = item.files.map((raw, index) => {
    const file = exact(raw, ["blobSha", "contentDigest", "mode", "path"], "release operation file") as unknown as ReleaseCandidateFileV1;
    if (file.path !== RELEASE_PATHS[index] || file.mode !== "100644") throw new TypeError("release operation file path or mode is invalid");
    requireCommit(file.blobSha, "release operation blob");
    requireDigest(file.contentDigest, "release operation content");
    return file;
  });
  const computedTreeDigest = authorityDigest({ v: "reelier.release-candidate-tree/v1", files });
  if (computedTreeDigest !== item.candidateTreeDigest) throw new TypeError("release candidate tree digest does not match exact file paths, modes, blob SHAs, and content digests");
  const commit = exact(item.commit, ["author", "committer", "message", "parentSha"], "release operation commit");
  if (commit.parentSha !== RELEASE_BASE || !boundedText(commit.message, 1, 512)) throw new TypeError("release operation commit parent or message is invalid");
  parseGitIdentity(commit.author, "release commit author");
  parseGitIdentity(commit.committer, "release commit committer");
  const pullRequest = exact(item.pullRequest, ["base", "body", "draft", "head", "title"], "release pull request");
  if (pullRequest.base !== "main" || pullRequest.head !== RELEASE_BRANCH || pullRequest.draft !== true || !boundedText(pullRequest.title, 1, 256) || !boundedText(pullRequest.body, 1, 16_384)) throw new TypeError("release pull request plan is invalid");
  const squash = exact(item.squash, ["commitMessage", "commitTitle"], "release squash metadata");
  if (!boundedText(squash.commitTitle, 1, 256) || !boundedText(squash.commitMessage, 1, 16_384)) throw new TypeError("release squash metadata is invalid");
  const npm = exact(item.npmPreflight, ["packageName", "version", "versionMustBeAbsent"], "release npm preflight");
  if (npm.packageName !== "reelier" || npm.version !== "0.32.1" || npm.versionMustBeAbsent !== true) throw new TypeError("release npm preflight is invalid");
  if (!Array.isArray(item.requiredChecks) || item.requiredChecks.length === 0 || item.requiredChecks.length > 32 || item.requiredChecks.some(check => !boundedText(check, 1, 128)) || !equalStrings(item.requiredChecks, [...item.requiredChecks].sort(compareText)) || new Set(item.requiredChecks).size !== item.requiredChecks.length) throw new TypeError("release required checks must be a sorted unique bounded set");
  if (!Array.isArray(item.workflowCommitments) || item.workflowCommitments.length !== RELEASE_WORKFLOWS.length) throw new TypeError("release operation workflow commitments must be complete");
  item.workflowCommitments.forEach((raw, index) => {
    const workflow = exact(raw, ["digest", "path"], "release operation workflow commitment");
    if (workflow.path !== RELEASE_WORKFLOWS[index]) throw new TypeError("release operation workflow path is invalid");
    requireDigest(workflow.digest, "release operation workflow");
  });
  return normalize(item);
}

function parseGitIdentity(value: unknown, label: string): ReleaseGitIdentityV1 {
  const identity = exact(value, ["date", "email", "name"], label) as unknown as ReleaseGitIdentityV1;
  requireTime(identity.date, `${label} date`);
  if (!boundedText(identity.name, 1, 128) || !boundedText(identity.email, 3, 254) || !/^[^\s@]+@[^\s@]+$/.test(identity.email)) throw new TypeError(`${label} is invalid`);
  return identity;
}

function parseReleasePolicyV1(value: unknown): ReleasePolicyV1 {
  const item = exact(value, ["allowedPaths", "destinations", "effectAllocations", "expirySeconds", "forbiddenChangeClasses", "maxChangedBytes", "maxChangedFiles", "v"], "release policy") as unknown as ReleasePolicyV1;
  if (item.v !== "reelier.release-policy/v1" || item.expirySeconds !== 43_200 || item.maxChangedFiles !== 3 || item.maxChangedBytes !== 65_536) throw new TypeError("release policy limits are invalid");
  requireExactSet(item.allowedPaths, RELEASE_PATHS, "allowed paths");
  requireExactSet(item.destinations, RELEASE_DESTINATIONS, "destinations");
  requireExactSet(item.effectAllocations, RELEASE_EFFECTS, "effect allocations");
  requireExactSet(item.forbiddenChangeClasses, FORBIDDEN_CHANGE_CLASSES, "forbidden change classes");
  return normalize(item);
}

function parseReleaseAuthorizationBundleV1(value: unknown): ReleaseAuthorizationBundleV1 {
  const item = exact(value, ["authorityCellDigest", "effectAllocations", "evidenceVerifierBindings", "expiresAt", "issuedAt", "jobCardDigest", "missionDigest", "operationPlanDigest", "packDigest", "policyDigest", "receiptGraphMakerBinding", "rootGrantDigest", "stagedCandidateManifestDigest", "taskDigest", "v"], "release authorization bundle") as unknown as ReleaseAuthorizationBundleV1;
  if (item.v !== "reelier.release-authorization-bundle/v1") throw new TypeError("release authorization bundle version is invalid");
  for (const [label, value] of [["authority cell", item.authorityCellDigest], ["Job Card", item.jobCardDigest], ["mission", item.missionDigest], ["operation plan", item.operationPlanDigest], ["pack", item.packDigest], ["policy", item.policyDigest], ["root grant", item.rootGrantDigest], ["candidate manifest", item.stagedCandidateManifestDigest], ["task", item.taskDigest]] as const) requireDigest(value, label);
  const issuedAt = requireTime(item.issuedAt, "release authorization issuedAt");
  const expiresAt = requireTime(item.expiresAt, "release authorization expiresAt");
  if (expiresAt - issuedAt !== 43_200_000) throw new TypeError("release authorization expiry must be exactly 12-hour");
  if (!Array.isArray(item.effectAllocations) || item.effectAllocations.length !== RELEASE_EFFECTS.length) throw new TypeError("release authorization requires four effect allocations");
  const allocationIds = new Set<string>();
  const allocationDigests = new Set<string>();
  item.effectAllocations.forEach((raw, index) => {
    const allocation = exact(raw, ["allocationDigest", "allocationId", "effect", "maxEffects"], "release effect allocation");
    requireDigest(allocation.allocationDigest, "release effect allocation");
    if (allocation.effect !== RELEASE_EFFECTS[index] || typeof allocation.allocationId !== "string" || !/^[a-z0-9][a-z0-9-]{7,127}$/.test(allocation.allocationId) || allocation.maxEffects !== 1 || allocationIds.has(allocation.allocationId) || allocationDigests.has(allocation.allocationDigest)) throw new TypeError("release effect allocations must have distinct identities and digests, canonical effect ordering, and one-effect limits");
    allocationIds.add(allocation.allocationId);
    allocationDigests.add(allocation.allocationDigest);
  });
  if (!Array.isArray(item.evidenceVerifierBindings) || item.evidenceVerifierBindings.length !== QUALITY_LANES.length + RECEIPT_LANES.length) throw new TypeError("release authorization evidence verifier bindings are incomplete");
  const boundLanes = [...QUALITY_LANES, ...RECEIPT_LANES];
  item.evidenceVerifierBindings.forEach((raw, index) => {
    const binding = exact(raw, ["lane", "publicKeySpkiDigest", "signerId"], "release evidence verifier binding");
    requireDigest(binding.publicKeySpkiDigest, "release evidence verifier public key");
    if (binding.lane !== boundLanes[index] || typeof binding.signerId !== "string" || !SIGNER_ID.test(binding.signerId)) throw new TypeError("release evidence verifier bindings have invalid lane ordering or signer identity");
  });
  const graphMaker = exact(item.receiptGraphMakerBinding, ["publicKeySpkiDigest", "signerId"], "release receipt graph maker binding");
  requireDigest(graphMaker.publicKeySpkiDigest, "release receipt graph maker public key");
  if (typeof graphMaker.signerId !== "string" || !SIGNER_ID.test(graphMaker.signerId)) throw new TypeError("release receipt graph maker signer identity is invalid");
  if (item.evidenceVerifierBindings.some(binding => binding.publicKeySpkiDigest === graphMaker.publicKeySpkiDigest)) throw new TypeError("release receipt graph maker and evidence checker keys must be separate by SPKI digest");
  return normalize(item);
}

function parseReleaseReceiptGraphV1(value: unknown): ReleaseReceiptGraphV1 {
  const item = exact(value, ["authorizationBundleDigest", "candidate", "completeness", "ghcr", "human", "installedChecks", "mcpRegistry", "merge", "npm", "tag", "v", "verifiedAt"], "release receipt graph") as unknown as ReleaseReceiptGraphV1;
  if (item.v !== "reelier.release-receipt-graph/v1" || item.completeness !== "unchecked") throw new TypeError("release receipt graph completeness must remain unchecked");
  requireDigest(item.authorizationBundleDigest, "release receipt authorization bundle");
  const verifiedAt = requireTime(item.verifiedAt, "release receipt verifiedAt");
  const lanes: EvidenceLaneV1[] = [];
  const candidate = exact(item.candidate, ["branch", "pullRequest"], "candidate receipt lanes");
  lanes.push(parseLane(candidate.branch, "candidate branch"), parseLane(candidate.pullRequest, "candidate pull request"));
  const ghcr = exact(item.ghcr, ["immutableManifest", "tags"], "GHCR receipt lanes");
  lanes.push(parseLane(ghcr.immutableManifest, "GHCR immutable manifest"), parseLane(ghcr.tags, "GHCR tags"));
  const human = exact(item.human, ["authorization", "exceptions", "interruptions", "postReleaseReview"], "human receipt lanes");
  const authorization = exact(human.authorization, ["count", "evidenceDigest", "status"], "human authorization lane");
  if (!Number.isSafeInteger(authorization.count) || authorization.count < 0) throw new TypeError("human authorization count is invalid");
  requireDigest(authorization.evidenceDigest, "human authorization");
  requireEvidenceStatus(authorization.status, "human authorization");
  if (authorization.status === "verified" && authorization.count !== 1) throw new TypeError("verified human authorization count must be exactly one");
  lanes.push({ evidenceDigest: authorization.evidenceDigest, status: authorization.status });
  const exceptions = parseCountedLane(human.exceptions, "human exceptions");
  const interruptions = parseCountedLane(human.interruptions, "human interruptions");
  lanes.push(parseLane(human.postReleaseReview, "human post-release review"));
  const installed = exact(item.installedChecks, ["linux", "windows"], "installed check receipt lanes");
  lanes.push(parseFreshLane(installed.linux, "Linux installed check", verifiedAt), parseFreshLane(installed.windows, "Windows installed check", verifiedAt));
  const mcp = exact(item.mcpRegistry, ["version"], "MCP Registry receipt lanes");
  lanes.push(parseLane(mcp.version, "MCP Registry version"));
  const merge = exact(item.merge, ["exactSha"], "merge receipt lanes");
  lanes.push(parseLane(merge.exactSha, "exact-SHA merge"));
  const npm = exact(item.npm, ["integrity", "provenance"], "npm receipt lanes");
  lanes.push(parseLane(npm.integrity, "npm integrity"), parseLane(npm.provenance, "npm provenance"));
  const tag = exact(item.tag, ["immutableRef"], "tag receipt lanes");
  lanes.push(parseLane(tag.immutableRef, "immutable tag"));
  const digests = [...lanes.map(lane => lane.evidenceDigest), ...exceptions.evidenceDigests, ...interruptions.evidenceDigests];
  if (new Set(digests).size !== digests.length) throw new TypeError("release receipt evidence lanes require distinct evidence digests");
  return normalize(item);
}

function parseReleaseVerifierEvidenceV1(value: unknown): ReleaseVerifierEvidenceV1 {
  const item = exact(value, ["authorizationBundleDigest", "candidateCommit", "count", "freshUntil", "lane", "observation", "observedAt", "resultValue", "status", "subjectDigest", "v", "workflowDigest", "workflowPath"], "release verifier evidence") as unknown as ReleaseVerifierEvidenceV1;
  if (item.v !== "reelier.release-verifier-evidence/v1" || ![...QUALITY_LANES, ...RECEIPT_LANES].includes(item.lane as never)) throw new TypeError("release verifier evidence lane or version is invalid");
  requireDigest(item.subjectDigest, "release evidence subject");
  requireTime(item.observedAt, "release evidence observedAt");
  requireEvidenceStatus(item.status, "release verifier");
  if (item.authorizationBundleDigest !== null) requireDigest(item.authorizationBundleDigest, "release evidence authorization bundle");
  if (item.candidateCommit !== null) requireCommit(item.candidateCommit, "release evidence candidate commit");
  if (item.workflowDigest !== null) requireDigest(item.workflowDigest, "release evidence workflow");
  if (item.workflowPath !== null && !RELEASE_WORKFLOWS.includes(item.workflowPath as never)) throw new TypeError("release evidence workflow path is invalid");
  if (item.freshUntil !== null) requireTime(item.freshUntil, "release evidence freshUntil");
  if (item.count !== null && (!Number.isSafeInteger(item.count) || item.count < 0)) throw new TypeError("release evidence count is invalid");
  if (item.resultValue !== null && (!Number.isSafeInteger(item.resultValue) || item.resultValue < 0 || item.resultValue > 10_000)) throw new TypeError("release evidence result value is invalid");
  if (!["authority-decision", "human-attestation", "installed-package", "provider-readback", "workflow-run"].includes(item.observation)) throw new TypeError("release evidence observation semantics are invalid");
  return normalize(item);
}

function parseLane(value: unknown, label: string): EvidenceLaneV1 {
  const lane = exact(value, ["evidenceDigest", "status"], `${label} evidence lane`) as unknown as EvidenceLaneV1;
  requireDigest(lane.evidenceDigest, label);
  requireEvidenceStatus(lane.status, label);
  return lane;
}

function parseCountedLane(value: unknown, label: string): CountedEvidenceLaneV1 {
  const lane = exact(value, ["count", "evidenceDigests", "status"], `${label} evidence lane`) as unknown as CountedEvidenceLaneV1;
  requireEvidenceStatus(lane.status, label);
  if (!Number.isSafeInteger(lane.count) || lane.count < 0 || !Array.isArray(lane.evidenceDigests) || lane.count !== lane.evidenceDigests.length) throw new TypeError(`${label} count does not equal its evidence set`);
  requireSortedUniqueDigests(lane.evidenceDigests, label);
  return lane;
}

function parseFreshLane(value: unknown, label: string, verifiedAt: number): FreshEvidenceLaneV1 {
  const lane = exact(value, ["evidenceDigest", "freshUntil", "observedAt", "status"], `${label} evidence lane`) as unknown as FreshEvidenceLaneV1;
  requireDigest(lane.evidenceDigest, label);
  requireEvidenceStatus(lane.status, label);
  const observedAt = requireTime(lane.observedAt, `${label} observedAt`);
  const freshUntil = requireTime(lane.freshUntil, `${label} freshUntil`);
  if (freshUntil <= observedAt || (lane.status === "verified" && (verifiedAt < observedAt || verifiedAt >= freshUntil))) throw new TypeError(`${label} evidence is not fresh at graph verification`);
  return lane;
}

function requiredStatuses(graph: ReleaseReceiptGraphV1): ReleaseEvidenceStatus[] {
  return [graph.candidate.branch.status, graph.candidate.pullRequest.status, graph.merge.exactSha.status, graph.tag.immutableRef.status, graph.npm.integrity.status, graph.npm.provenance.status, graph.mcpRegistry.version.status, graph.ghcr.immutableManifest.status, graph.ghcr.tags.status, graph.installedChecks.windows.status, graph.installedChecks.linux.status, graph.human.authorization.status, graph.human.interruptions.status, graph.human.exceptions.status, graph.human.postReleaseReview.status];
}

function verifyQualityEvidence(candidate: SignedStagedCandidateManifestV1, authorization: SignedReleaseAuthorizationBundleV1, inputs: readonly ReleaseEvidenceVerificationV1[], verificationTime: number): void {
  const workflow = candidate.value.workflowCommitments[0];
  const quality = candidate.value.qualityEvidence;
  const expected = [
    { lane: "ci-coverage", subjectDigest: quality.coverageEvidenceDigest, resultValue: 1 },
    { lane: "ci-full-tests", subjectDigest: quality.fullTestEvidenceDigest, resultValue: 1 },
    { lane: "ci-mutation", subjectDigest: quality.mutationEvidenceDigest, resultValue: quality.mutationScoreBasisPoints },
  ] as const;
  const evidence = verifyEvidenceSet(inputs, expected.map(item => item.lane), authorization, "release quality");
  for (const item of expected) {
    const body = evidence.get(item.lane)!.value;
    if (body.authorizationBundleDigest !== null || body.candidateCommit !== candidate.value.candidateCommit || body.workflowPath !== workflow.path || body.workflowDigest !== workflow.digest || body.observation !== "workflow-run" || body.status !== "verified" || body.subjectDigest !== item.subjectDigest || body.resultValue !== item.resultValue || body.count !== null || body.freshUntil !== null) throw new TypeError(`${item.lane} quality verifier evidence has wrong head, workflow, subject, or result`);
    const observedAt = Date.parse(body.observedAt);
    if (observedAt < Date.parse(authorization.value.issuedAt) || observedAt > verificationTime || observedAt >= Date.parse(authorization.value.expiresAt)) throw new TypeError(`${item.lane} quality evidence observedAt is outside authorization and verification chronology`);
  }
}

function verifyReceiptEvidence(graph: SignedReleaseReceiptGraphV1, authorization: SignedReleaseAuthorizationBundleV1, inputs: readonly ReleaseEvidenceVerificationV1[]): void {
  const value = graph.value;
  const expected = [
    receiptExpectation("candidate-branch", value.candidate.branch, "provider-readback"),
    receiptExpectation("candidate-pull-request", value.candidate.pullRequest, "provider-readback"),
    receiptExpectation("ghcr-immutable-manifest", value.ghcr.immutableManifest, "provider-readback"),
    receiptExpectation("ghcr-tags", value.ghcr.tags, "provider-readback"),
    receiptExpectation("human-authorization", value.human.authorization, "authority-decision", value.human.authorization.count),
    countedExpectation("human-exceptions", value.human.exceptions),
    countedExpectation("human-interruptions", value.human.interruptions),
    receiptExpectation("human-post-release-review", value.human.postReleaseReview, "human-attestation"),
    receiptExpectation("installed-linux", value.installedChecks.linux, "installed-package", null, value.installedChecks.linux.freshUntil),
    receiptExpectation("installed-windows", value.installedChecks.windows, "installed-package", null, value.installedChecks.windows.freshUntil),
    receiptExpectation("mcp-registry-version", value.mcpRegistry.version, "provider-readback"),
    receiptExpectation("merge-exact-sha", value.merge.exactSha, "provider-readback"),
    receiptExpectation("npm-integrity", value.npm.integrity, "provider-readback"),
    receiptExpectation("npm-provenance", value.npm.provenance, "provider-readback"),
    receiptExpectation("tag-immutable-ref", value.tag.immutableRef, "provider-readback"),
  ] as const;
  const evidence = verifyEvidenceSet(inputs, expected.map(item => item.lane), authorization, "release receipt");
  for (const item of expected) {
    const body = evidence.get(item.lane)!.value;
    if (body.authorizationBundleDigest !== value.authorizationBundleDigest || body.candidateCommit !== null || body.workflowPath !== null || body.workflowDigest !== null || body.lane !== item.lane || body.observation !== item.observation || body.status !== item.status || body.subjectDigest !== item.subjectDigest || body.count !== item.count || body.freshUntil !== item.freshUntil || body.resultValue !== null) throw new TypeError(`${item.lane} verifier evidence has wrong lane, authorization, subject, observation, or result`);
    if (item.freshUntil !== null && body.observedAt !== item.observedAt) throw new TypeError(`${item.lane} installed-package evidence has wrong observation time`);
    const observedAt = Date.parse(body.observedAt);
    if (observedAt < Date.parse(authorization.value.issuedAt) || observedAt > Date.parse(value.verifiedAt)) throw new TypeError(`${item.lane} receipt evidence observedAt is outside authorization and graph chronology`);
  }
}

function receiptExpectation(lane: (typeof RECEIPT_LANES)[number], value: EvidenceLaneV1 & Partial<{ count: number; freshUntil: string; observedAt: string }>, observation: ReleaseVerifierEvidenceV1["observation"], count: number | null = null, freshUntil: string | null = null) {
  return { lane, subjectDigest: value.evidenceDigest, status: value.status, observation, count, freshUntil, observedAt: value.observedAt ?? null };
}

function countedExpectation(lane: "human-exceptions" | "human-interruptions", value: CountedEvidenceLaneV1) {
  return { lane, subjectDigest: authorityDigest({ count: value.count, evidenceDigests: value.evidenceDigests, lane }), status: value.status, observation: "human-attestation" as const, count: value.count, freshUntil: null, observedAt: null };
}

function verifyEvidenceSet(inputs: readonly ReleaseEvidenceVerificationV1[], lanes: readonly ReleaseEvidenceLaneV1[], authorization: SignedReleaseAuthorizationBundleV1, label: string): Map<ReleaseEvidenceLaneV1, SignedReleaseVerifierEvidenceV1> {
  const inputSnapshots = snapshotDenseDataArray(inputs, `${label} signed verifier evidence set`);
  if (inputSnapshots.length !== lanes.length) throw new TypeError(`${label} signed verifier evidence set is missing or incomplete`);
  const byLane = new Map<ReleaseEvidenceLaneV1, SignedReleaseVerifierEvidenceV1>();
  const digests = new Set<string>();
  for (let index = 0; index < inputSnapshots.length; index += 1) {
    const input = parseEvidenceVerificationInput(inputSnapshots[index], `${label} verification input`);
    const artifact = verifySigned(parseSignedReleaseVerifierEvidenceV1(input.evidence), input.verifier, "release-evidence");
    const binding = authorization.value.evidenceVerifierBindings.find(item => item.lane === artifact.value.lane);
    if (!binding || artifact.signerId !== binding.signerId || input.publicKeySpkiDigest !== binding.publicKeySpkiDigest || digests.has(artifact.digest) || byLane.has(artifact.value.lane) || !lanes.includes(artifact.value.lane)) throw new TypeError(`${label} evidence is duplicate, aliased, wrong-lane, wrong-signer, or outside trusted authorization bindings`);
    digests.add(artifact.digest);
    byLane.set(artifact.value.lane, artifact);
  }
  for (const lane of lanes) if (!byLane.has(lane)) throw new TypeError(`${label} evidence is missing a required lane`);
  return byLane;
}

function parseEvidenceVerificationInput(value: unknown, label: string): Readonly<{ evidence: unknown; publicKeySpkiDigest: string; verifier: InternalReleaseContractVerifierV1 }> {
  const input = shallowExact(value, ["evidence", "verifier"], label);
  const verifier = parseReleaseContractVerifierInput(input.verifier, `${label} verifier`);
  return { evidence: input.evidence, publicKeySpkiDigest: verifier.publicKeySpkiDigest, verifier };
}

function parseReleaseContractVerifierInput(value: unknown, label: string): InternalReleaseContractVerifierV1 {
  const descriptor = shallowExact(value, ["publicKeySpkiBase64", "signerId"], label);
  if (typeof descriptor.signerId !== "string" || !SIGNER_ID.test(descriptor.signerId) || typeof descriptor.publicKeySpkiBase64 !== "string") throw new TypeError(`${label} verifier descriptor is invalid`);
  const bytes = Buffer.from(descriptor.publicKeySpkiBase64, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== descriptor.publicKeySpkiBase64) throw new TypeError(`${label} verifier SPKI is not canonical base64`);
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey({ key: bytes, format: "der", type: "spki" });
    const canonical = publicKey.export({ format: "der", type: "spki" });
    if (publicKey.type !== "public" || publicKey.asymmetricKeyType !== "ed25519" || !Buffer.from(canonical).equals(bytes)) throw new TypeError("noncanonical SPKI");
  } catch {
    throw new TypeError(`${label} verifier SPKI is invalid or noncanonical`);
  }
  return { publicKey, publicKeySpkiDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, signerId: descriptor.signerId };
}

function snapshotDenseDataArray(value: unknown, label: string): readonly unknown[] {
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    if (utilTypes.isProxy(value)) throw new TypeError(`${label} contains a Proxy`);
  }
  if (typeof value === "function") throw new TypeError(`${label} contains a function`);
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`${label} is not a plain dense array`);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) throw new TypeError(`${label} has invalid length`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== lengthDescriptor.value + 1) throw new TypeError(`${label} is sparse or has custom own fields`);
  const snapshot: unknown[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    if (keys[index] !== String(index)) throw new TypeError(`${label} is sparse or has symbol/custom own fields`);
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) throw new TypeError(`${label} contains an accessor or non-enumerable slot`);
    snapshot.push(descriptor.value);
  }
  if (keys[keys.length - 1] !== "length") throw new TypeError(`${label} has custom own fields`);
  return snapshot;
}

function shallowExact(value: unknown, fields: readonly string[], label: string): Record<string, any> {
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    if (utilTypes.isProxy(value)) throw new TypeError(`${label} contains a Proxy`);
  }
  if (typeof value === "function") throw new TypeError(`${label} contains a function`);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} is not an exact object`);
  const snapshot: Record<string, unknown> = {};
  const keys: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") throw new TypeError(`${label} contains a symbol field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) throw new TypeError(`${label} contains an accessor or non-enumerable property`);
    keys.push(key);
    snapshot[key] = descriptor.value;
  }
  keys.sort();
  if (!equalStrings(keys, [...fields].sort())) throw new TypeError(`${label} is not an exact object`);
  return snapshot;
}

function signRelease<T, V extends string>(value: T, signer: ReleaseContractSignerV1, version: V, purpose: AuthoritySignaturePurpose): SignedReleaseArtifactV1<T, V> {
  if (!signer || typeof signer.signerId !== "string" || !SIGNER_ID.test(signer.signerId) || !signer.privateKey) throw new TypeError("release signer is invalid");
  const digest = authorityDigest(value);
  return normalize({ digest, signature: signAuthorityDigest(signer.privateKey, purpose, digest), signerId: signer.signerId, v: version, value });
}

function parseSignedRelease<T, V extends string>(value: unknown, version: V, parseValue: (value: unknown) => T): SignedReleaseArtifactV1<T, V> {
  const item = exact(value, ["digest", "signature", "signerId", "v", "value"], "signed release artifact");
  const signature = exact(item.signature, ["alg", "sig"], "release signature");
  if (item.v !== version || typeof item.signerId !== "string" || !SIGNER_ID.test(item.signerId) || signature.alg !== "ed25519" || typeof signature.sig !== "string" || Buffer.from(signature.sig, "base64").toString("base64") !== signature.sig || Buffer.from(signature.sig, "base64").length !== 64) throw new TypeError("signed release artifact identity or signature is invalid");
  requireDigest(item.digest, "signed release artifact");
  const parsedValue = parseValue(item.value);
  if (authorityDigest(parsedValue) !== item.digest) throw new TypeError("signed release artifact digest mismatch or tampering detected");
  return normalize({ digest: item.digest, signature, signerId: item.signerId, v: version, value: parsedValue }) as SignedReleaseArtifactV1<T, V>;
}

function verifySigned<T, V extends string>(artifact: SignedReleaseArtifactV1<T, V>, verifier: InternalReleaseContractVerifierV1, purpose: AuthoritySignaturePurpose): SignedReleaseArtifactV1<T, V> {
  if (!verifier || artifact.signerId !== verifier.signerId || !verifyAuthoritySignature(verifier.publicKey, purpose, artifact.digest, artifact.signature)) throw new TypeError("signed release artifact signature is invalid");
  return artifact;
}

function parseCanonicalReleaseJson<T>(json: string, parser: (value: unknown) => T, label: string): T {
  if (typeof json !== "string") throw new TypeError(`${label} JSON is invalid`);
  assertNoDuplicateJsonKeys(json);
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new TypeError(`${label} JSON is invalid`); }
  if (authorityCanonicalBytes(value).toString("utf8") !== json) throw new TypeError(`${label} JSON is not RFC 8785/JCS canonical`);
  return parser(value);
}

function exact(value: unknown, fields: readonly string[], label: string): Record<string, any> {
  const snapshot = snapshotPlainDataTree(value, label);
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new TypeError(`${label} is not an exact canonical object (prototype rejected)`);
  const keys = Object.keys(snapshot).sort();
  if (!equalStrings(keys, [...fields].sort())) throw new TypeError(`${label} is not an exact canonical object`);
  return snapshot as Record<string, any>;
}

function snapshotPlainDataTree(value: unknown, label: string, seen = new Set<object>()): unknown {
  const kind = typeof value;
  if ((kind === "object" && value !== null) || kind === "function") {
    if (utilTypes.isProxy(value)) throw new TypeError(`${label} contains a Proxy`);
  }
  if (value === null || kind === "string" || kind === "boolean" || (kind === "number" && Number.isFinite(value))) return value;
  if (kind !== "object") throw new TypeError(`${label} contains a non-JSON scalar or function`);
  const objectValue = value as object;
  if (seen.has(objectValue)) throw new TypeError(`${label} contains a cyclic object graph`);
  seen.add(objectValue);
  const array = Array.isArray(objectValue);
  const expectedPrototype = array ? Array.prototype : Object.prototype;
  if (Object.getPrototypeOf(objectValue) !== expectedPrototype) throw new TypeError(`${label} contains a non-plain prototype`);
  const lengthDescriptor = array ? Object.getOwnPropertyDescriptor(objectValue, "length") : undefined;
  if (array && (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0)) throw new TypeError(`${label} contains an invalid array length`);
  const keys = Reflect.ownKeys(objectValue);
  if (array && keys.length !== lengthDescriptor!.value + 1) throw new TypeError(`${label} contains a sparse array, symbol, non-enumerable field, or custom own array property`);
  const snapshot: Record<string, unknown> | unknown[] = array ? [] : {};
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key === "symbol") throw new TypeError(`${label} contains a symbol field`);
    if (array && key !== (index === keys.length - 1 ? "length" : String(index))) throw new TypeError(`${label} contains a sparse array, symbol, non-enumerable field, or custom own array property`);
    const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
    if (!descriptor || !("value" in descriptor) || (key !== "length" && descriptor.enumerable !== true)) throw new TypeError(`${label} contains an accessor or non-enumerable property`);
    if (key !== "length") {
      const child = snapshotPlainDataTree(descriptor.value, label, seen);
      if (array) (snapshot as unknown[]).push(child);
      else Object.defineProperty(snapshot, key, { configurable: true, enumerable: true, value: child, writable: true });
    }
  }
  seen.delete(objectValue);
  return snapshot;
}

function snapshotVerificationTime(now: Date, label: string): number {
  if ((typeof now === "object" && now !== null) || typeof now === "function") {
    if (utilTypes.isProxy(now)) throw new TypeError(`${label} rejects Proxy clocks`);
  }
  if (!now || typeof now !== "object") throw new TypeError(`${label} must be a plain Date`);
  if (Object.getPrototypeOf(now) !== Date.prototype) throw new TypeError(`${label} must use the Date prototype`);
  if (Reflect.ownKeys(now).length !== 0) throw new TypeError(`${label} Date must not contain own properties`);
  const time = Date.prototype.getTime.call(now);
  if (!Number.isFinite(time)) throw new TypeError(`${label} is invalid`);
  return time;
}

function normalize<T>(value: T): T { return deepFreeze(JSON.parse(authorityCanonicalBytes(value).toString("utf8")) as T); }
function boundedText(value: unknown, minimum: number, maximum: number): value is string { return typeof value === "string" && value.length >= minimum && value.length <= maximum && !value.includes("\0"); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function requireDigest(value: unknown, label: string): asserts value is string { if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(`${label} digest is invalid`); }
function requireCommit(value: unknown, label: string): asserts value is string { if (typeof value !== "string" || !COMMIT.test(value)) throw new TypeError(`${label} is invalid`); }
function requireTime(value: unknown, label: string): number { if (typeof value !== "string") throw new TypeError(`${label} is invalid`); const time = Date.parse(value); if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new TypeError(`${label} is invalid`); return time; }
function requireEvidenceStatus(value: unknown, label: string): asserts value is ReleaseEvidenceStatus { if (typeof value !== "string" || !["verified", "failed", "pending", "absent", "unchecked", "ambiguity"].includes(value)) throw new TypeError(`${label} evidence status is invalid`); }
function requireExactSet(actual: readonly unknown[], expected: readonly string[], label: string): void { if (!Array.isArray(actual) || !equalStrings(actual, expected)) throw new TypeError(`${label} must be the exact sorted unique set`); }
function requireSortedUniqueDigests(values: readonly unknown[], label: string): void { let previous = ""; for (const value of values) { requireDigest(value, label); if (value <= previous) throw new TypeError(`${label} evidence digests must be sorted and unique`); previous = value; } }
function equalStrings(left: readonly unknown[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }

function assertNoDuplicateJsonKeys(json: string): void {
  let index = 0;
  const whitespace = () => { while (/\s/.test(json[index] ?? "")) index += 1; };
  const string = (): string => {
    const start = index;
    if (json[index++] !== '"') throw new TypeError("release JSON is invalid");
    while (index < json.length) {
      if (json[index] === "\\") { index += 2; continue; }
      if (json[index++] === '"') return JSON.parse(json.slice(start, index)) as string;
    }
    throw new TypeError("release JSON is invalid");
  };
  const value = (): void => {
    whitespace();
    if (json[index] === "{") {
      index += 1; whitespace(); const keys = new Set<string>();
      if (json[index] === "}") { index += 1; return; }
      while (true) {
        whitespace(); const key = string();
        if (keys.has(key)) throw new TypeError(`release JSON contains duplicate key: ${key}`);
        keys.add(key); whitespace(); if (json[index++] !== ":") throw new TypeError("release JSON is invalid"); value(); whitespace();
        if (json[index] === "}") { index += 1; return; }
        if (json[index++] !== ",") throw new TypeError("release JSON is invalid");
      }
    }
    if (json[index] === "[") {
      index += 1; whitespace(); if (json[index] === "]") { index += 1; return; }
      while (true) { value(); whitespace(); if (json[index] === "]") { index += 1; return; } if (json[index++] !== ",") throw new TypeError("release JSON is invalid"); }
    }
    if (json[index] === '"') { string(); return; }
    const match = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(json.slice(index));
    if (!match) throw new TypeError("release JSON is invalid");
    index += match[0].length;
  };
  value(); whitespace(); if (index !== json.length) throw new TypeError("release JSON is invalid");
}
