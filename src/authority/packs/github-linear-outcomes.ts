import { isProxy } from "node:util/types";
import type { EffectTransportBindingV1, McpEffectTransportBindingV1 } from "../host/effect-transports.js";
import {
  digestToolEffectContractV1,
  parseToolEffectContractV1,
  type ProviderOutcomePackV1,
  type ToolEffectContractV1,
} from "../tool-effect-contract.js";
import { authorityDigest } from "../wire.js";

const SHA = /^sha256:[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:~/-]{0,255}$/;
const REQUIRED_CHECKS = Object.freeze(["coverage", "full-tests", "mutation"]);
export const GITHUB_RELEASE_OUTCOME_SERVER_SCHEMA_DIGEST_V1 = authorityDigest({ v: "reelier.github-release-pack-server-schema/v1", transport: "internal-mcp" });
export const LINEAR_OUTCOME_SERVER_SCHEMA_DIGEST_V1 = authorityDigest({ v: "reelier.linear-outcomes-pack-server-schema/v1", transport: "credential-broker-port" });

export type GitHubLinearOutcomeOperationNameV1 = "candidatePublish" | "pullRequestEnsure" | "exactHeadMerge" | "linearEvidenceComment" | "linearStatusTransition" | "linearOnlyEvidenceComment" | "linearOnlyStatusTransition";
export type GitHubLinearOutcomeModeV1 = "github-linear" | "linear-only";
export const governedOutcomeCompositionAliasesV1 = Object.freeze(["github_release_candidate_publish_v1", "github_release_pr_ensure_v1", "github_release_pr_merge_v1", "linear_evidence_comment_v1", "linear_status_transition_v1", "linear_only_evidence_comment_v1", "linear_only_status_transition_v1"] as const);

export interface LinearReviewedTargetV1 { readonly workspace: string; readonly team: string; readonly project: string; readonly issue: string; readonly preStatus: string; readonly targetStatus: string; readonly commentMarker: string; readonly evidenceUrl: string; readonly evidenceContentDigest: string; readonly accountRef: string; readonly destinationRef: string; readonly credentialRef: string; readonly limitRef: string }

export interface GitHubLinearReviewedAuthorityV1 {
  readonly v: "reelier.github-linear-reviewed-authority/v1";
  readonly github: Readonly<{
    repository: string; baseBranch: string; baseSha: string; headBranch: string; headSha: string;
    candidateDigest: string; workflowPath: string; workflowDigest: string; requiredChecks: readonly string[];
    mergeMethod: "squash"; postMergeTreeSha: string;
    accountRef: string; destinationRef: string; credentialRef: string; limitRef: string;
  }>;
  readonly linear: Readonly<{ targets: Readonly<{ githubLinear: LinearReviewedTargetV1; linearOnly: LinearReviewedTargetV1 }> }> | LinearReviewedTargetV1;
}

export interface ReviewedOutcomeOperationV1 {
  readonly contract: ToolEffectContractV1;
  readonly binding: EffectTransportBindingV1;
  readonly metadata: ProviderOutcomePackV1;
}

export interface GitHubLinearOutcomePackV1 {
  readonly v: "reelier.github-linear-outcome-pack/v1";
  readonly authorityDigest: string;
  readonly githubPolicyDigest: string;
  readonly linearPolicyDigest: string;
  readonly linearPolicyDigests: Readonly<{ githubLinear: string; linearOnly: string }>;
  readonly operations: Readonly<Record<GitHubLinearOutcomeOperationNameV1, ReviewedOutcomeOperationV1>>;
}

export interface GitHubReviewedReleasePackMemberV1 {
  readonly alias: "github_release_candidate_publish_v1" | "github_release_pr_ensure_v1" | "github_release_pr_merge_v1";
  readonly contractDigest: string;
  readonly bindingDigest: string;
  readonly policyDigest: string;
}

interface GitHubReviewedOutcomePolicyV1 {
  readonly repository: string; readonly baseBranch: string; readonly baseSha: string; readonly headBranch: string; readonly headSha: string;
  readonly candidateDigest: string; readonly workflowPath: string; readonly workflowDigest: string; readonly requiredChecks: readonly string[];
  readonly mergeMethod: "squash"; readonly postMergeTreeSha: string;
}

const packAuthorities = new WeakMap<object, GitHubLinearReviewedAuthorityV1>();
declare const governedOutcomeCompositionProfileBrand: unique symbol;
export interface GovernedOutcomeCompositionProfileV1 { readonly [governedOutcomeCompositionProfileBrand]: true }
type GovernedOutcomeCompositionScopeV1 = Readonly<{ aliases: typeof governedOutcomeCompositionAliasesV1; repository: string; linearTargets: Readonly<{ githubLinear: string; linearOnly: string }>; contractDigests: readonly string[] }>;
type GovernedOutcomeCompositionProfileStateV1 = Readonly<{ scope: GovernedOutcomeCompositionScopeV1; pack: GitHubLinearOutcomePackV1; authority: GitHubLinearReviewedAuthorityV1 }>;
const governedOutcomeProfiles = new WeakMap<object, GovernedOutcomeCompositionProfileStateV1>();

/** Reviewed five-operation profile. It is an admission proof, never dispatch authority. */
export function createGovernedOutcomeCompositionProfileV1(input: Readonly<{ aliases: readonly string[]; pack: GitHubLinearOutcomePackV1; operations: readonly ReviewedOutcomeOperationV1[] }>): GovernedOutcomeCompositionProfileV1 {
  const raw = inertRecord(input, ["aliases", "pack", "operations"], "governed Outcome composition profile");
  const pack = raw.pack as GitHubLinearOutcomePackV1, authority = packAuthorities.get(pack as object);
  if (!authority) throw new TypeError("governed Outcome composition profile requires one reviewed pack scope");
  const aliases = exactArray(raw.aliases, "governed Outcome aliases");
  if (aliases.length !== governedOutcomeCompositionAliasesV1.length || aliases.some((alias, index) => alias !== governedOutcomeCompositionAliasesV1[index])) throw new TypeError("governed Outcome profile requires the exact canonical five aliases");
  const operations = exactObjectArray(raw.operations, "governed Outcome operations");
  const expected = [pack.operations.candidatePublish, pack.operations.pullRequestEnsure, pack.operations.exactHeadMerge, pack.operations.linearEvidenceComment, pack.operations.linearStatusTransition, pack.operations.linearOnlyEvidenceComment, pack.operations.linearOnlyStatusTransition] as const;
  if (operations.length !== expected.length || operations.some((operation, index) => operation !== expected[index])) throw new TypeError("governed Outcome profile operations do not share one exact reviewed scope");
  const linearTargets = targetsOf(authority);
  const scope = Object.freeze({ aliases: governedOutcomeCompositionAliasesV1, repository: authority.github.repository, linearTargets: Object.freeze({ githubLinear: linearTargets.githubLinear.issue, linearOnly: linearTargets.linearOnly.issue }), contractDigests: Object.freeze(expected.map(operation => digestToolEffectContractV1(operation.contract))) });
  const profile = Object.freeze(Object.create(null)) as GovernedOutcomeCompositionProfileV1;
  governedOutcomeProfiles.set(profile as object, Object.freeze({ scope, pack, authority }));
  return profile;
}

export function describeGovernedOutcomeCompositionProfileV1(profile: GovernedOutcomeCompositionProfileV1): GovernedOutcomeCompositionScopeV1 {
  const state = governedOutcomeProfiles.get(profile as object);
  if (!state) throw new TypeError("governed Outcome composition profile capability is invalid");
  return state.scope;
}

/** @internal Host composition access; the profile remains non-serializable and non-authoritative for dispatch. */
export function governedOutcomeCompositionProfileStateV1(profile: GovernedOutcomeCompositionProfileV1): GovernedOutcomeCompositionProfileStateV1 { const state = governedOutcomeProfiles.get(profile as object); if (!state) throw new TypeError("governed Outcome composition profile capability is invalid"); return state; }

/** @internal Exact host-selected target; mode is resolved from the authenticated opaque Outcome reference. */
export function reviewedLinearTargetV1(pack: GitHubLinearOutcomePackV1, mode: GitHubLinearOutcomeModeV1): LinearReviewedTargetV1 { const authority = packAuthorities.get(requirePack(pack) as object); if (!authority) throw new TypeError("reviewed outcome pack authority is unavailable"); return targetsOf(authority)[mode === "github-linear" ? "githubLinear" : "linearOnly"]; }

export function createGitHubLinearOutcomePackV1(value: GitHubLinearReviewedAuthorityV1): GitHubLinearOutcomePackV1 {
  const authority = parseAuthority(value);
  const authorityDigestValue = authorityDigest(authority);
  const githubPolicyDigest = githubReviewedOutcomePolicyDigestV1(authority.github);
  const linearPolicyDigestFor = (target: LinearReviewedTargetV1) => { const { accountRef: _a, destinationRef: _d, credentialRef: _c, limitRef: _l, ...policy } = target; return authorityDigest({ v: "reelier.linear-reviewed-outcome-policy/v1", ...policy }); };
  const targets = targetsOf(authority), linearPolicyDigests = Object.freeze({ githubLinear: linearPolicyDigestFor(targets.githubLinear), linearOnly: linearPolicyDigestFor(targets.linearOnly) });
  const githubBindings = { credentialRef: authority.github.credentialRef, accountRef: authority.github.accountRef, destinationRef: authority.github.destinationRef, limitRef: authority.github.limitRef };
  const linearBindings = (target: LinearReviewedTargetV1) => ({ credentialRef: target.credentialRef, accountRef: target.accountRef, destinationRef: target.destinationRef, limitRef: target.limitRef });
  const operations = Object.freeze({
    candidatePublish: operation({ key: "candidate-publish", provider: "github", policyDigest: githubPolicyDigest, bindings: githubBindings, modelFields: ["authorizationHandle", "requestId"], serverSchemaDigest: GITHUB_RELEASE_OUTCOME_SERVER_SCHEMA_DIGEST_V1, tool: "github_release_candidate_publish_v1", readbackTool: "github_release_candidate_publish_readback_v1", projection: ["/repository", "/baseSha", "/headSha", "/candidateDigest"] }),
    pullRequestEnsure: operation({ key: "pull-request-ensure", provider: "github", policyDigest: githubPolicyDigest, bindings: githubBindings, modelFields: ["authorizationHandle", "requestId"], serverSchemaDigest: GITHUB_RELEASE_OUTCOME_SERVER_SCHEMA_DIGEST_V1, tool: "github_release_pr_ensure_v1", readbackTool: "github_release_pr_ensure_readback_v1", projection: ["/repository", "/baseBranch", "/headSha", "/pullRequest", "/ready"] }),
    exactHeadMerge: operation({ key: "exact-head-squash-merge", provider: "github", policyDigest: githubPolicyDigest, bindings: githubBindings, modelFields: ["authorizationHandle", "requestId"], serverSchemaDigest: GITHUB_RELEASE_OUTCOME_SERVER_SCHEMA_DIGEST_V1, tool: "github_release_pr_merge_v1", readbackTool: "github_release_pr_merge_readback_v1", projection: ["/repository", "/baseSha", "/headSha", "/mergeCommitSha", "/treeSha"] }),
    linearEvidenceComment: operation({ key: "evidence-comment", provider: "linear", policyDigest: linearPolicyDigests.githubLinear, bindings: linearBindings(targets.githubLinear), modelFields: ["evidenceUrl"], serverSchemaDigest: LINEAR_OUTCOME_SERVER_SCHEMA_DIGEST_V1, tool: "linear_evidence_comment_v1", readbackTool: "linear_evidence_comment_readback_v1", projection: ["/workspace", "/team", "/project", "/issue", "/commentMarker", "/evidenceUrl", "/evidenceContentDigest", "/commentId"] }),
    linearStatusTransition: operation({ key: "status-transition", provider: "linear", policyDigest: linearPolicyDigests.githubLinear, bindings: linearBindings(targets.githubLinear), modelFields: ["requestId"], serverSchemaDigest: LINEAR_OUTCOME_SERVER_SCHEMA_DIGEST_V1, tool: "linear_status_transition_v1", readbackTool: "linear_status_transition_readback_v1", projection: ["/workspace", "/team", "/project", "/issue", "/preStatus", "/targetStatus", "/status"] }),
    linearOnlyEvidenceComment: operation({ key: "linear-only-evidence-comment", provider: "linear", policyDigest: linearPolicyDigests.linearOnly, bindings: linearBindings(targets.linearOnly), modelFields: ["evidenceUrl"], serverSchemaDigest: LINEAR_OUTCOME_SERVER_SCHEMA_DIGEST_V1, tool: "linear_only_evidence_comment_v1", readbackTool: "linear_only_evidence_comment_readback_v1", projection: ["/workspace", "/team", "/project", "/issue", "/commentMarker", "/evidenceUrl", "/evidenceContentDigest", "/commentId"] }),
    linearOnlyStatusTransition: operation({ key: "linear-only-status-transition", provider: "linear", policyDigest: linearPolicyDigests.linearOnly, bindings: linearBindings(targets.linearOnly), modelFields: ["requestId"], serverSchemaDigest: LINEAR_OUTCOME_SERVER_SCHEMA_DIGEST_V1, tool: "linear_only_status_transition_v1", readbackTool: "linear_only_status_transition_readback_v1", projection: ["/workspace", "/team", "/project", "/issue", "/preStatus", "/targetStatus", "/status"] }),
  });
  const pack = Object.freeze({ v: "reelier.github-linear-outcome-pack/v1" as const, authorityDigest: authorityDigestValue, githubPolicyDigest, linearPolicyDigest: linearPolicyDigests.githubLinear, linearPolicyDigests, operations });
  packAuthorities.set(pack, authority);
  return pack;
}

/** Canonical signed commitment for the exact reviewed candidate/PR/merge pack. */
export function githubReviewedReleasePackDigestV1(pack: GitHubLinearOutcomePackV1): string {
  const parsed = requirePack(pack);
  return authorityDigest({
    v: "reelier.github-reviewed-release-pack/v1",
    operations: githubReviewedReleasePackMembers(parsed),
  });
}

/** @internal Exact active-operation membership proof consumed by the branded GitHub executor. */
export function assertGitHubReviewedReleasePackMemberV1(
  pack: GitHubLinearOutcomePackV1,
  tool: string,
  contractDigest: string,
  bindingDigest: string,
  policyDigest: string,
): GitHubReviewedReleasePackMemberV1 {
  const parsed = requirePack(pack);
  const operations = [parsed.operations.candidatePublish, parsed.operations.pullRequestEnsure, parsed.operations.exactHeadMerge] as const;
  const index = operations.findIndex(operation => operation.binding.kind === "mcp" && (operation.binding.tool === tool || operation.binding.readback?.tool === tool));
  if (index < 0) throw new TypeError("GitHub release operation is not a member of the reviewed release pack");
  const member = githubReviewedReleasePackMembers(parsed)[index]!;
  if (member.contractDigest !== contractDigest || member.bindingDigest !== bindingDigest || member.policyDigest !== policyDigest) throw new TypeError("GitHub release operation conflicts with exact reviewed release pack membership");
  return member;
}

function githubReviewedReleasePackMembers(pack: GitHubLinearOutcomePackV1): readonly GitHubReviewedReleasePackMemberV1[] {
  return Object.freeze([
    ["github_release_candidate_publish_v1", pack.operations.candidatePublish],
    ["github_release_pr_ensure_v1", pack.operations.pullRequestEnsure],
    ["github_release_pr_merge_v1", pack.operations.exactHeadMerge],
  ].map(([alias, operation]) => Object.freeze({
    alias,
    contractDigest: digestToolEffectContractV1((operation as ReviewedOutcomeOperationV1).contract),
    bindingDigest: authorityDigest((operation as ReviewedOutcomeOperationV1).binding),
    policyDigest: (operation as ReviewedOutcomeOperationV1).contract.policyDigest,
  })) as GitHubReviewedReleasePackMemberV1[]);
}

/** @internal Shared by the reviewed pack and its branded GitHub host adapter. */
export function githubReviewedOutcomePolicyDigestV1(value: GitHubReviewedOutcomePolicyV1): string {
  return authorityDigest({
    v: "reelier.github-reviewed-outcome-policy/v1",
    repository: value.repository,
    baseBranch: value.baseBranch,
    baseSha: value.baseSha,
    headBranch: value.headBranch,
    headSha: value.headSha,
    candidateDigest: value.candidateDigest,
    workflowPath: value.workflowPath,
    workflowDigest: value.workflowDigest,
    requiredChecks: value.requiredChecks,
    mergeMethod: value.mergeMethod,
    postMergeTreeSha: value.postMergeTreeSha,
  });
}

export function orderedGitHubLinearOperationsV1(pack: GitHubLinearOutcomePackV1, mode: GitHubLinearOutcomeModeV1): readonly ReviewedOutcomeOperationV1[] {
  const parsed = requirePack(pack);
  if (mode === "linear-only") return Object.freeze([parsed.operations.linearOnlyEvidenceComment, parsed.operations.linearOnlyStatusTransition]);
  if (mode !== "github-linear") throw new TypeError("outcome pack mode is invalid");
  return Object.freeze([parsed.operations.candidatePublish, parsed.operations.pullRequestEnsure, parsed.operations.exactHeadMerge, parsed.operations.linearEvidenceComment, parsed.operations.linearStatusTransition]);
}

export function allGovernedGitHubLinearOperationsV1(pack: GitHubLinearOutcomePackV1): readonly ReviewedOutcomeOperationV1[] { const parsed = requirePack(pack); return Object.freeze([parsed.operations.candidatePublish, parsed.operations.pullRequestEnsure, parsed.operations.exactHeadMerge, parsed.operations.linearEvidenceComment, parsed.operations.linearStatusTransition, parsed.operations.linearOnlyEvidenceComment, parsed.operations.linearOnlyStatusTransition]); }

export function assertGitHubLinearProviderReadbackV1(pack: GitHubLinearOutcomePackV1, operationName: GitHubLinearOutcomeOperationNameV1, value: unknown): Readonly<Record<string, string | number | boolean>> {
  const parsed = requirePack(pack), authority = packAuthorities.get(parsed as object);
  if (!authority) throw new TypeError("reviewed outcome pack authority is unavailable");
  const targets = targetsOf(authority), target = operationName.startsWith("linearOnly") ? targets.linearOnly : targets.githubLinear;
  let raw: Record<string, unknown>, expected: Readonly<Record<string, unknown>>;
  if (operationName === "candidatePublish") {
    raw = inertRecord(value, ["repository", "baseSha", "headSha", "candidateDigest"], "candidate publication readback");
    expected = { repository: authority.github.repository, baseSha: authority.github.baseSha, headSha: authority.github.headSha, candidateDigest: authority.github.candidateDigest };
  } else if (operationName === "pullRequestEnsure") {
    raw = inertRecord(value, ["repository", "baseBranch", "headSha", "pullRequest", "ready"], "pull request readback");
    expected = { repository: authority.github.repository, baseBranch: authority.github.baseBranch, headSha: authority.github.headSha, ready: true };
    if (!Number.isSafeInteger(raw.pullRequest) || Number(raw.pullRequest) < 1) throw new TypeError("pull request readback conflicts with exact reviewed authority");
  } else if (operationName === "exactHeadMerge") {
    raw = inertRecord(value, ["repository", "baseSha", "headSha", "mergeCommitSha", "treeSha"], "merge readback");
    expected = { repository: authority.github.repository, baseSha: authority.github.baseSha, headSha: authority.github.headSha, treeSha: authority.github.postMergeTreeSha };
    if (typeof raw.mergeCommitSha !== "string" || !GIT_SHA.test(raw.mergeCommitSha)) throw new TypeError("merge readback conflicts with exact reviewed authority");
  } else if (operationName === "linearEvidenceComment") {
    raw = inertRecord(value, ["workspace", "team", "project", "issue", "commentMarker", "evidenceUrl", "evidenceContentDigest", "commentId"], "Linear comment readback");
    expected = { workspace: target.workspace, team: target.team, project: target.project, issue: target.issue, commentMarker: target.commentMarker, evidenceUrl: target.evidenceUrl, evidenceContentDigest: target.evidenceContentDigest };
    text(raw.commentId, "Linear comment ID");
  } else if (operationName === "linearStatusTransition") {
    raw = inertRecord(value, ["workspace", "team", "project", "issue", "preStatus", "targetStatus", "status"], "Linear status readback");
    expected = { workspace: target.workspace, team: target.team, project: target.project, issue: target.issue, preStatus: target.preStatus, targetStatus: target.targetStatus, status: target.targetStatus };
  } else throw new TypeError("reviewed outcome operation is invalid");
  for (const [key, expectedValue] of Object.entries(expected)) if (raw[key] !== expectedValue) throw new TypeError(`${operationName} readback conflicts with exact reviewed authority`);
  const result: Record<string, string | number | boolean> = Object.create(null);
  for (const [key, item] of Object.entries(raw)) {
    if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") throw new TypeError("provider readback contains an invalid value");
    result[key] = item;
  }
  return Object.freeze(result);
}

/** @internal Host-side Linear dispatch binding; credentials never enter this projection. */
export function assertLinearOutcomeDispatchV1(pack: GitHubLinearOutcomePackV1, operationName: "linearEvidenceComment" | "linearStatusTransition" | "linearOnlyEvidenceComment" | "linearOnlyStatusTransition", modelValue: unknown, hostValue: unknown): Readonly<Record<string, string>> {
  const parsed = requirePack(pack), authority = packAuthorities.get(parsed)!;
  const targets = targetsOf(authority), target = operationName.startsWith("linearOnly") ? targets.linearOnly : targets.githubLinear;
  const host = inertRecord(hostValue, ["account", "destination", "limit"], "Linear outcome host binding");
  const policyDigest = operationName.startsWith("linearOnly") ? parsed.linearPolicyDigests.linearOnly : parsed.linearPolicyDigests.githubLinear;
  if (host.account !== target.workspace || host.destination !== target.issue || host.limit !== policyDigest) throw new TypeError("Linear outcome host binding conflicts with reviewed authority");
  if (operationName.endsWith("EvidenceComment")) {
    const model = inertRecord(modelValue, ["evidenceUrl"], "Linear evidence comment model");
    if (model.evidenceUrl !== target.evidenceUrl) throw new TypeError("Linear evidence URL conflicts with reviewed authority");
    return Object.freeze({ workspace: target.workspace, team: target.team, project: target.project, issue: target.issue, commentMarker: target.commentMarker, evidenceUrl: target.evidenceUrl, evidenceContentDigest: target.evidenceContentDigest });
  }
  const model = inertRecord(modelValue, ["requestId"], "Linear status model");
  const requestId = text(model.requestId, "Linear status request ID");
  return Object.freeze({ workspace: target.workspace, team: target.team, project: target.project, issue: target.issue, preStatus: target.preStatus, targetStatus: target.targetStatus, requestId });
}

function operation(input: Readonly<{ key: string; provider: string; policyDigest: string; bindings: ToolEffectContractV1["bindings"]; modelFields: readonly string[]; serverSchemaDigest: string; tool: string; readbackTool: string; projection: readonly string[] }>): ReviewedOutcomeOperationV1 {
  const toolSchemaDigest = authorityDigest({ v: "reelier.reviewed-outcome-tool-schema/v1", provider: input.provider, tool: input.tool, modelFields: input.modelFields });
  const readbackSchemaDigest = authorityDigest({ v: "reelier.reviewed-outcome-readback-schema/v1", provider: input.provider, tool: input.readbackTool, projection: input.projection });
  const operationName = `${input.provider}.${input.key}.v1`;
  const readbackOperation = `${operationName}.readback`;
  const binding: McpEffectTransportBindingV1 = Object.freeze({ v: "reelier.effect-transport-binding/v1", kind: "mcp", operation: operationName, server: `reelier.${input.provider}.outcomes`, tool: input.tool, serverSchemaDigest: input.serverSchemaDigest, toolSchemaDigest, readback: Object.freeze({ operation: readbackOperation, tool: input.readbackTool, toolSchemaDigest: readbackSchemaDigest }) });
  const contract = parseToolEffectContractV1({ v: "reelier.tool-effect-contract/v1", contractId: `reviewed.${operationName}`, provider: input.provider, operation: operationName, operationDigest: authorityDigest(binding), schemaDigest: toolSchemaDigest, policyDigest: input.policyDigest, effectClass: "idempotent-write", model: { fields: input.modelFields, maxBytes: 16_384 }, bindings: input.bindings, semanticIdentity: authorityDigest({ v: "reelier.reviewed-outcome-semantic-identity/v1", operation: operationName, policyDigest: input.policyDigest }), idempotencyKey: authorityDigest({ v: "reelier.reviewed-outcome-idempotency/v1", operation: operationName, policyDigest: input.policyDigest }), readback: { operation: readbackOperation, projection: input.projection }, result: { success: ["applied", "exact-existing"], conflict: ["conflict"], definitiveFailure: ["refused"], ambiguity: ["uncertain"] }, maximumEvidenceGrade: "verified" });
  const contractDigest = digestToolEffectContractV1(contract);
  const metadata: ProviderOutcomePackV1 = Object.freeze({ v: "reelier.provider-outcome-pack/v1", packId: `reelier.reviewed.${input.provider}.${input.key}.v1`, provider: input.provider, contractDigest, preflightOperation: `${operationName}.preflight`, dispatchOperation: operationName, readbackOperation });
  return Object.freeze({ contract, binding, metadata });
}

export function githubReleaseOutcomeToolSchemaDigestV1(tool: string): string {
  const dispatchFields: Readonly<Record<string, readonly string[]>> = Object.freeze({ github_release_candidate_publish_v1: ["authorizationHandle", "requestId"], github_release_pr_ensure_v1: ["authorizationHandle", "requestId"], github_release_pr_merge_v1: ["authorizationHandle", "requestId"] });
  const readbackProjection: Readonly<Record<string, readonly string[]>> = Object.freeze({ github_release_candidate_publish_readback_v1: ["/repository", "/baseSha", "/headSha", "/candidateDigest"], github_release_pr_ensure_readback_v1: ["/repository", "/baseBranch", "/headSha", "/pullRequest", "/ready"], github_release_pr_merge_readback_v1: ["/repository", "/baseSha", "/headSha", "/mergeCommitSha", "/treeSha"] });
  if (dispatchFields[tool]) return authorityDigest({ v: "reelier.reviewed-outcome-tool-schema/v1", provider: "github", tool, modelFields: dispatchFields[tool] });
  if (readbackProjection[tool]) return authorityDigest({ v: "reelier.reviewed-outcome-readback-schema/v1", provider: "github", tool, projection: readbackProjection[tool] });
  throw new TypeError("GitHub release outcome tool is not reviewed");
}

/** @internal Exact compiler binding accepted by the branded GitHub executor. */
export function githubReleaseOutcomeBindingDigestV1(tool: string): string {
  const reviewed: Readonly<Record<string, Readonly<{ key: string; dispatch: string; readback: string; projection: readonly string[] }>>> = Object.freeze({
    github_release_candidate_publish_v1: Object.freeze({ key: "candidate-publish", dispatch: "github_release_candidate_publish_v1", readback: "github_release_candidate_publish_readback_v1", projection: ["/repository", "/baseSha", "/headSha", "/candidateDigest"] }),
    github_release_candidate_publish_readback_v1: Object.freeze({ key: "candidate-publish", dispatch: "github_release_candidate_publish_v1", readback: "github_release_candidate_publish_readback_v1", projection: ["/repository", "/baseSha", "/headSha", "/candidateDigest"] }),
    github_release_pr_ensure_v1: Object.freeze({ key: "pull-request-ensure", dispatch: "github_release_pr_ensure_v1", readback: "github_release_pr_ensure_readback_v1", projection: ["/repository", "/baseBranch", "/headSha", "/pullRequest", "/ready"] }),
    github_release_pr_ensure_readback_v1: Object.freeze({ key: "pull-request-ensure", dispatch: "github_release_pr_ensure_v1", readback: "github_release_pr_ensure_readback_v1", projection: ["/repository", "/baseBranch", "/headSha", "/pullRequest", "/ready"] }),
    github_release_pr_merge_v1: Object.freeze({ key: "exact-head-squash-merge", dispatch: "github_release_pr_merge_v1", readback: "github_release_pr_merge_readback_v1", projection: ["/repository", "/baseSha", "/headSha", "/mergeCommitSha", "/treeSha"] }),
    github_release_pr_merge_readback_v1: Object.freeze({ key: "exact-head-squash-merge", dispatch: "github_release_pr_merge_v1", readback: "github_release_pr_merge_readback_v1", projection: ["/repository", "/baseSha", "/headSha", "/mergeCommitSha", "/treeSha"] }),
  });
  const item = reviewed[tool];
  if (!item) throw new TypeError("GitHub release outcome tool is not reviewed");
  const operationName = `github.${item.key}.v1`;
  return authorityDigest({ v: "reelier.effect-transport-binding/v1", kind: "mcp", operation: operationName, server: "reelier.github.outcomes", tool: item.dispatch, serverSchemaDigest: GITHUB_RELEASE_OUTCOME_SERVER_SCHEMA_DIGEST_V1, toolSchemaDigest: githubReleaseOutcomeToolSchemaDigestV1(item.dispatch), readback: { operation: `${operationName}.readback`, tool: item.readback, toolSchemaDigest: githubReleaseOutcomeToolSchemaDigestV1(item.readback) } });
}

/** @internal Runtime schema pin for the callback-only Linear host adapter. */
export function linearOutcomeToolSchemaDigestV1(tool: string): string {
  const dispatchFields: Readonly<Record<string, readonly string[]>> = Object.freeze({ linear_evidence_comment_v1: ["evidenceUrl"], linear_status_transition_v1: ["requestId"], linear_only_evidence_comment_v1: ["evidenceUrl"], linear_only_status_transition_v1: ["requestId"] });
  const readbackProjection: Readonly<Record<string, readonly string[]>> = Object.freeze({ linear_evidence_comment_readback_v1: ["/workspace", "/team", "/project", "/issue", "/commentMarker", "/evidenceUrl", "/evidenceContentDigest", "/commentId"], linear_status_transition_readback_v1: ["/workspace", "/team", "/project", "/issue", "/preStatus", "/targetStatus", "/status"], linear_only_evidence_comment_readback_v1: ["/workspace", "/team", "/project", "/issue", "/commentMarker", "/evidenceUrl", "/evidenceContentDigest", "/commentId"], linear_only_status_transition_readback_v1: ["/workspace", "/team", "/project", "/issue", "/preStatus", "/targetStatus", "/status"] });
  if (dispatchFields[tool]) return authorityDigest({ v: "reelier.reviewed-outcome-tool-schema/v1", provider: "linear", tool, modelFields: dispatchFields[tool] });
  if (readbackProjection[tool]) return authorityDigest({ v: "reelier.reviewed-outcome-readback-schema/v1", provider: "linear", tool, projection: readbackProjection[tool] });
  throw new TypeError("Linear outcome tool is not reviewed");
}

function parseAuthority(value: unknown): GitHubLinearReviewedAuthorityV1 {
  const root = inertRecord(value, ["v", "github", "linear"], "reviewed GitHub and Linear authority");
  if (root.v !== "reelier.github-linear-reviewed-authority/v1") throw new TypeError("reviewed authority version is invalid");
  const github = inertRecord(root.github, ["repository", "baseBranch", "baseSha", "headBranch", "headSha", "candidateDigest", "workflowPath", "workflowDigest", "requiredChecks", "mergeMethod", "postMergeTreeSha", "accountRef", "destinationRef", "credentialRef", "limitRef"], "reviewed GitHub authority");
  const linearTarget = (value: unknown, label: string) => inertRecord(value, ["workspace", "team", "project", "issue", "preStatus", "targetStatus", "commentMarker", "evidenceUrl", "evidenceContentDigest", "accountRef", "destinationRef", "credentialRef", "limitRef"], label);
  let githubLinear: Record<string, unknown>, linearOnly: Record<string, unknown>;
  try { const linear = inertRecord(root.linear, ["targets"], "reviewed Linear authority"), targets = inertRecord(linear.targets, ["githubLinear", "linearOnly"], "reviewed Linear targets"); githubLinear = linearTarget(targets.githubLinear, "reviewed composite Linear target"); linearOnly = linearTarget(targets.linearOnly, "reviewed Linear-only target"); }
  catch { githubLinear = linearTarget(root.linear, "reviewed Linear authority"); linearOnly = githubLinear; }
  const requiredChecks = stringArray(github.requiredChecks, "required checks");
  if (github.baseBranch !== "main" || github.workflowPath !== ".github/workflows/ci.yml" || github.mergeMethod !== "squash" || authorityDigest(requiredChecks) !== authorityDigest(REQUIRED_CHECKS)) throw new TypeError("GitHub outcome authority must bind main, the signed CI workflow, exact required checks, and squash merge");
  text(github.repository, "repository"); text(github.headBranch, "head branch");
  for (const [index, target] of [githubLinear, linearOnly].entries()) for (const key of ["workspace", "team", "project", "issue", "preStatus", "targetStatus", "commentMarker", "evidenceUrl"] as const) text(target[key], `${key} ${index}`);
  for (const [raw, label] of [[github.baseSha, "base SHA"], [github.headSha, "head SHA"], [github.postMergeTreeSha, "post-merge tree SHA"]] as const) if (typeof raw !== "string" || !GIT_SHA.test(raw)) throw new TypeError(`${label} is invalid`);
  for (const [raw, label] of [[github.candidateDigest, "candidate digest"], [github.workflowDigest, "workflow digest"], [githubLinear.evidenceContentDigest, "composite evidence content digest"], [linearOnly.evidenceContentDigest, "Linear-only evidence content digest"]] as const) digest(raw, label);
  const cleanTarget = (target: Record<string, unknown>) => ({ workspace: target.workspace, team: target.team, project: target.project, issue: target.issue, preStatus: target.preStatus, targetStatus: target.targetStatus, commentMarker: target.commentMarker, evidenceUrl: target.evidenceUrl, evidenceContentDigest: target.evidenceContentDigest, ...refs(target) });
  return deepFreeze({ v: root.v, github: { repository: github.repository, baseBranch: github.baseBranch, baseSha: github.baseSha, headBranch: github.headBranch, headSha: github.headSha, candidateDigest: github.candidateDigest, workflowPath: github.workflowPath, workflowDigest: github.workflowDigest, requiredChecks, mergeMethod: github.mergeMethod, postMergeTreeSha: github.postMergeTreeSha, ...refs(github) }, linear: { targets: { githubLinear: cleanTarget(githubLinear), linearOnly: cleanTarget(linearOnly) } } }) as GitHubLinearReviewedAuthorityV1;
}

function requirePack(pack: unknown): GitHubLinearOutcomePackV1 {
  if (!pack || typeof pack !== "object" || isProxy(pack) || !packAuthorities.has(pack)) throw new TypeError("outcome pack brand is invalid");
  return pack as GitHubLinearOutcomePackV1;
}

function targetsOf(authority: GitHubLinearReviewedAuthorityV1): Readonly<{ githubLinear: LinearReviewedTargetV1; linearOnly: LinearReviewedTargetV1 }> { return "targets" in authority.linear ? authority.linear.targets : Object.freeze({ githubLinear: authority.linear, linearOnly: authority.linear }); }

function refs(value: Record<string, unknown>): Readonly<{ accountRef: string; destinationRef: string; credentialRef: string; limitRef: string }> { return Object.freeze({ accountRef: ref(value.accountRef, "account ref"), destinationRef: ref(value.destinationRef, "destination ref"), credentialRef: ref(value.credentialRef, "credential ref"), limitRef: ref(value.limitRef, "limit ref") }); }
function ref(value: unknown, label: string): string { const result = text(value, label); if (!REF.test(result)) throw new TypeError(`${label} is invalid`); return result; }
function text(value: unknown, label: string): string { if (typeof value !== "string" || value.length < 1 || value.length > 512) throw new TypeError(`${label} is invalid`); return value; }
function digest(value: unknown, label: string): string { if (typeof value !== "string" || !SHA.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function stringArray(value: unknown, label: string): readonly string[] { if (!Array.isArray(value) || isProxy(value)) throw new TypeError(`${label} is invalid`); const length = Object.getOwnPropertyDescriptor(value, "length")?.value; if (!Number.isSafeInteger(length) || length < 1 || length > 16) throw new TypeError(`${label} is invalid`); const keys = Reflect.ownKeys(value); if (keys.length !== length + 1 || keys.some(key => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) throw new TypeError(`${label} must be a closed array`); const result: string[] = []; for (let index = 0; index < length; index++) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} must be a dense inert array`); result.push(text(descriptor.value, label)); } if (new Set(result).size !== result.length) throw new TypeError(`${label} contains duplicates`); return Object.freeze(result); }
function inertRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) throw new TypeError(`${label} must be an inert closed record`); const prototype = Object.getPrototypeOf(value); if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be an inert closed record`); const ownKeys = Reflect.ownKeys(value); if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== "string" || !keys.includes(key))) throw new TypeError(`${label} contains an unknown field or is not closed`); const result: Record<string, unknown> = Object.create(null); for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} requires inert data properties`); result[key] = descriptor.value; } return result; }
function exactArray(value: unknown, label: string): readonly string[] { if (!Array.isArray(value) || isProxy(value)) throw new TypeError(`${label} must be an exact array`); const length = Object.getOwnPropertyDescriptor(value, "length")?.value; if (!Number.isSafeInteger(length) || Reflect.ownKeys(value).length !== length + 1) throw new TypeError(`${label} must be an exact array`); const result: string[] = []; for (let index = 0; index < length; index++) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string") throw new TypeError(`${label} must be an exact string array`); result.push(descriptor.value); } return Object.freeze(result); }
function exactObjectArray(value: unknown, label: string): readonly object[] { if (!Array.isArray(value) || isProxy(value)) throw new TypeError(`${label} must be an exact array`); const length = Object.getOwnPropertyDescriptor(value, "length")?.value; if (!Number.isSafeInteger(length) || Reflect.ownKeys(value).length !== length + 1) throw new TypeError(`${label} must be an exact array`); const result: object[] = []; for (let index = 0; index < length; index++) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value") || !descriptor.value || typeof descriptor.value !== "object") throw new TypeError(`${label} must contain exact reviewed operations`); result.push(descriptor.value); } return Object.freeze(result); }
function deepFreeze<T>(value: T): T { if (value && typeof value === "object") { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value); } return value; }
