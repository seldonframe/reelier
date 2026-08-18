import type { KeyObject } from "node:crypto";
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
const FORBIDDEN_CHANGE_CLASSES = ["authority-contract", "credential", "dependency", "generated-contract", "lockfile", "policy", "release-script", "workflow"] as const;

export type ReleaseDestinationV1 = (typeof RELEASE_DESTINATIONS)[number];
export type ReleaseProviderEffectV1 = (typeof RELEASE_EFFECTS)[number];
export type ReleaseEvidenceStatus = "verified" | "failed" | "pending" | "absent" | "unchecked" | "ambiguity";

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
  readonly expiresAt: string;
  readonly issuedAt: string;
  readonly jobCardDigest: string;
  readonly missionDigest: string;
  readonly packDigest: string;
  readonly policyDigest: string;
  readonly rootGrantDigest: string;
  readonly stagedCandidateManifestDigest: string;
  readonly taskDigest: string;
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
export type SignedReleasePolicyV1 = SignedReleaseArtifactV1<ReleasePolicyV1, "reelier.signed-release-policy/v1">;
export type SignedReleaseAuthorizationBundleV1 = SignedReleaseArtifactV1<ReleaseAuthorizationBundleV1, "reelier.signed-release-authorization-bundle/v1">;
export type SignedReleaseReceiptGraphV1 = SignedReleaseArtifactV1<ReleaseReceiptGraphV1, "reelier.signed-release-receipt-graph/v1">;

export interface ReleaseContractSignerV1 { readonly signerId: string; readonly privateKey: KeyObject }
export interface ReleaseContractVerifierV1 { readonly signerId: string; readonly publicKey: KeyObject }

export function createSignedStagedCandidateManifestV1(value: StagedCandidateManifestV1, signer: ReleaseContractSignerV1): SignedStagedCandidateManifestV1 {
  return signRelease(parseStagedCandidateManifestV1(value), signer, "reelier.signed-staged-candidate-manifest/v1", "release-authorization");
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
  input: Readonly<{ authorization: unknown; candidateManifest: unknown; policy: unknown }>,
  verifier: ReleaseContractVerifierV1,
  now: Date,
): Readonly<{ authorization: SignedReleaseAuthorizationBundleV1; candidateManifest: SignedStagedCandidateManifestV1; policy: SignedReleasePolicyV1 }> {
  exact(input, ["authorization", "candidateManifest", "policy"], "release authorization inputs");
  const authorization = verifySigned(parseSignedReleaseAuthorizationBundleV1(input.authorization), verifier, "release-authorization");
  const candidateManifest = verifySigned(parseSignedStagedCandidateManifestV1(input.candidateManifest), verifier, "release-authorization");
  const policy = verifySigned(parseSignedReleasePolicyV1(input.policy), verifier, "release-authorization");
  if (authorization.value.stagedCandidateManifestDigest !== candidateManifest.digest) throw new TypeError("release authorization candidate manifest digest mismatch");
  if (authorization.value.policyDigest !== policy.digest) throw new TypeError("release authorization policy digest mismatch");
  if (!Number.isFinite(now.getTime()) || now.getTime() >= Date.parse(authorization.value.expiresAt)) throw new TypeError("release authorization is expired");
  if (candidateManifest.value.changedPaths.length > policy.value.maxChangedFiles || candidateManifest.value.changedBytes > policy.value.maxChangedBytes) throw new TypeError("release candidate exceeds policy size limits");
  if (!equalStrings(candidateManifest.value.changedPaths, policy.value.allowedPaths)) throw new TypeError("release candidate paths do not equal policy allowed paths");
  if (!equalStrings(authorization.value.effectAllocations.map(item => item.effect), policy.value.effectAllocations)) throw new TypeError("release effect allocations do not equal policy effects");
  return deepFreeze({ authorization, candidateManifest, policy });
}

export function verifyReleaseReceiptGraphV1(value: unknown, verifier: ReleaseContractVerifierV1, authorizationBundleDigest: string): SignedReleaseReceiptGraphV1 {
  requireDigest(authorizationBundleDigest, "authorization bundle");
  const graph = verifySigned(parseSignedReleaseReceiptGraphV1(value), verifier, "release-receipt");
  if (graph.value.authorizationBundleDigest !== authorizationBundleDigest) throw new TypeError("release receipt graph authorization digest mismatch");
  return graph;
}

export function evaluateReleaseReceiptGraphV1(value: ReleaseReceiptGraphV1): Readonly<{ completeness: "unchecked"; status: "verified" | "incomplete"; success: boolean }> {
  const graph = parseReleaseReceiptGraphV1(value);
  const success = requiredStatuses(graph).every(status => status === "verified");
  return Object.freeze({ completeness: "unchecked", status: success ? "verified" : "incomplete", success });
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
  if (!Array.isArray(item.workflowCommitments) || item.workflowCommitments.length === 0) throw new TypeError("release workflow commitments are absent");
  let previous = "";
  const workflowDigests = new Set<string>();
  for (const raw of item.workflowCommitments) {
    const commitment = exact(raw, ["digest", "path"], "release workflow commitment");
    requireDigest(commitment.digest, "workflow");
    if (typeof commitment.path !== "string" || !/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/.test(commitment.path) || commitment.path <= previous || workflowDigests.has(commitment.digest)) throw new TypeError("release workflow commitments must be path-sorted and unique");
    previous = commitment.path;
    workflowDigests.add(commitment.digest);
  }
  return normalize(item);
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
  const item = exact(value, ["authorityCellDigest", "effectAllocations", "expiresAt", "issuedAt", "jobCardDigest", "missionDigest", "packDigest", "policyDigest", "rootGrantDigest", "stagedCandidateManifestDigest", "taskDigest", "v"], "release authorization bundle") as unknown as ReleaseAuthorizationBundleV1;
  if (item.v !== "reelier.release-authorization-bundle/v1") throw new TypeError("release authorization bundle version is invalid");
  for (const [label, value] of [["authority cell", item.authorityCellDigest], ["Job Card", item.jobCardDigest], ["mission", item.missionDigest], ["pack", item.packDigest], ["policy", item.policyDigest], ["root grant", item.rootGrantDigest], ["candidate manifest", item.stagedCandidateManifestDigest], ["task", item.taskDigest]] as const) requireDigest(value, label);
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

function signRelease<T, V extends string>(value: T, signer: ReleaseContractSignerV1, version: V, purpose: AuthoritySignaturePurpose): SignedReleaseArtifactV1<T, V> {
  if (!signer || typeof signer.signerId !== "string" || signer.signerId.length === 0 || !signer.privateKey) throw new TypeError("release signer is invalid");
  const digest = authorityDigest(value);
  return normalize({ digest, signature: signAuthorityDigest(signer.privateKey, purpose, digest), signerId: signer.signerId, v: version, value });
}

function parseSignedRelease<T, V extends string>(value: unknown, version: V, parseValue: (value: unknown) => T): SignedReleaseArtifactV1<T, V> {
  const item = exact(value, ["digest", "signature", "signerId", "v", "value"], "signed release artifact");
  const signature = exact(item.signature, ["alg", "sig"], "release signature");
  if (item.v !== version || typeof item.signerId !== "string" || item.signerId.length === 0 || signature.alg !== "ed25519" || typeof signature.sig !== "string" || Buffer.from(signature.sig, "base64").toString("base64") !== signature.sig || Buffer.from(signature.sig, "base64").length !== 64) throw new TypeError("signed release artifact identity or signature is invalid");
  requireDigest(item.digest, "signed release artifact");
  const parsedValue = parseValue(item.value);
  if (authorityDigest(parsedValue) !== item.digest) throw new TypeError("signed release artifact digest mismatch or tampering detected");
  return normalize({ digest: item.digest, signature, signerId: item.signerId, v: version, value: parsedValue }) as SignedReleaseArtifactV1<T, V>;
}

function verifySigned<T, V extends string>(artifact: SignedReleaseArtifactV1<T, V>, verifier: ReleaseContractVerifierV1, purpose: AuthoritySignaturePurpose): SignedReleaseArtifactV1<T, V> {
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
  assertPlainDataTree(value, label);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} is not an exact canonical object (prototype rejected)`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some(descriptor => descriptor.get !== undefined || descriptor.set !== undefined)) throw new TypeError(`${label} accessor properties are rejected`);
  const keys = Object.keys(value).sort();
  if (!equalStrings(keys, [...fields].sort())) throw new TypeError(`${label} is not an exact canonical object`);
  return value as Record<string, any>;
}

function assertPlainDataTree(value: unknown, label: string, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new TypeError(`${label} contains a cyclic object graph`);
  seen.add(value);
  const expectedPrototype = Array.isArray(value) ? Array.prototype : Object.prototype;
  if (Object.getPrototypeOf(value) !== expectedPrototype) throw new TypeError(`${label} contains a non-plain prototype`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (descriptor.get !== undefined || descriptor.set !== undefined) throw new TypeError(`${label} contains an accessor property`);
    assertPlainDataTree(descriptor.value, label, seen);
  }
  seen.delete(value);
}

function normalize<T>(value: T): T { return deepFreeze(JSON.parse(authorityCanonicalBytes(value).toString("utf8")) as T); }
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
function requireEvidenceStatus(value: unknown, label: string): asserts value is ReleaseEvidenceStatus { if (!["verified", "failed", "pending", "absent", "unchecked", "ambiguity"].includes(String(value))) throw new TypeError(`${label} evidence status is invalid`); }
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
