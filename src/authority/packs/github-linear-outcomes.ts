import { isProxy } from "node:util/types";
import type { EffectTransportBindingV1, McpEffectTransportBindingV1 } from "../host/effect-transports.js";
import {
  digestGovernedOutcomeV1,
  digestToolEffectContractV1,
  parseGovernedOutcomeV1,
  parseGovernedReceiptV1,
  parseToolEffectContractV1,
  type GovernedOutcomeV1,
  type GovernedReceiptV1,
  type ProviderOutcomePackV1,
  type ToolEffectContractV1,
} from "../tool-effect-contract.js";
import { authorityDigest } from "../wire.js";

const SHA = /^sha256:[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:~/-]{0,255}$/;
const REQUIRED_CHECKS = Object.freeze(["coverage", "full-tests", "mutation"]);
export const GITHUB_RELEASE_OUTCOME_SERVER_SCHEMA_DIGEST_V1 = authorityDigest({ v: "reelier.github-release-pack-server-schema/v1", transport: "internal-mcp" });
const LINEAR_SERVER_SCHEMA = authorityDigest({ v: "reelier.linear-outcomes-pack-server-schema/v1", transport: "credential-broker-port" });

export type GitHubLinearOutcomeOperationNameV1 = "candidatePublish" | "pullRequestEnsure" | "exactHeadMerge" | "linearEvidenceComment" | "linearStatusTransition";
export type GitHubLinearOutcomeModeV1 = "github-linear" | "linear-only";

export interface GitHubLinearReviewedAuthorityV1 {
  readonly v: "reelier.github-linear-reviewed-authority/v1";
  readonly github: Readonly<{
    repository: string; baseBranch: string; baseSha: string; headBranch: string; headSha: string;
    candidateDigest: string; workflowPath: string; workflowDigest: string; requiredChecks: readonly string[];
    mergeMethod: "squash"; postMergeTreeSha: string;
    accountRef: string; destinationRef: string; credentialRef: string; limitRef: string;
  }>;
  readonly linear: Readonly<{
    workspace: string; team: string; project: string; issue: string; preStatus: string; targetStatus: string; commentMarker: string;
    accountRef: string; destinationRef: string; credentialRef: string; limitRef: string;
  }>;
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
  readonly operations: Readonly<Record<GitHubLinearOutcomeOperationNameV1, ReviewedOutcomeOperationV1>>;
}

const packAuthorities = new WeakMap<object, GitHubLinearReviewedAuthorityV1>();

export function createGitHubLinearOutcomePackV1(value: GitHubLinearReviewedAuthorityV1): GitHubLinearOutcomePackV1 {
  const authority = parseAuthority(value);
  const authorityDigestValue = authorityDigest(authority);
  const githubPolicyDigest = authorityDigest({ v: "reelier.github-reviewed-outcome-policy/v1", ...authority.github });
  const linearPolicyDigest = authorityDigest({ v: "reelier.linear-reviewed-outcome-policy/v1", ...authority.linear });
  const githubBindings = { credentialRef: authority.github.credentialRef, accountRef: authority.github.accountRef, destinationRef: authority.github.destinationRef, limitRef: authority.github.limitRef };
  const linearBindings = { credentialRef: authority.linear.credentialRef, accountRef: authority.linear.accountRef, destinationRef: authority.linear.destinationRef, limitRef: authority.linear.limitRef };
  const operations = Object.freeze({
    candidatePublish: operation({ key: "candidate-publish", provider: "github", policyDigest: githubPolicyDigest, bindings: githubBindings, modelFields: ["authorizationHandle", "requestId", "semanticsDigest"], serverSchemaDigest: GITHUB_RELEASE_OUTCOME_SERVER_SCHEMA_DIGEST_V1, tool: "github_release_candidate_publish_v1", readbackTool: "github_release_candidate_publish_readback_v1", projection: ["/repository", "/baseSha", "/headSha", "/candidateDigest"] }),
    pullRequestEnsure: operation({ key: "pull-request-ensure", provider: "github", policyDigest: githubPolicyDigest, bindings: githubBindings, modelFields: ["authorizationHandle", "requestId", "semanticsDigest"], serverSchemaDigest: GITHUB_RELEASE_OUTCOME_SERVER_SCHEMA_DIGEST_V1, tool: "github_release_pr_ensure_v1", readbackTool: "github_release_pr_ensure_readback_v1", projection: ["/repository", "/baseBranch", "/headSha", "/pullRequest", "/ready"] }),
    exactHeadMerge: operation({ key: "exact-head-squash-merge", provider: "github", policyDigest: githubPolicyDigest, bindings: githubBindings, modelFields: ["authorizationHandle", "requestId", "semanticsDigest"], serverSchemaDigest: GITHUB_RELEASE_OUTCOME_SERVER_SCHEMA_DIGEST_V1, tool: "github_release_pr_merge_v1", readbackTool: "github_release_pr_merge_readback_v1", projection: ["/repository", "/baseSha", "/headSha", "/mergeCommitSha", "/treeSha"] }),
    linearEvidenceComment: operation({ key: "evidence-comment", provider: "linear", policyDigest: linearPolicyDigest, bindings: linearBindings, modelFields: ["evidenceUrl"], serverSchemaDigest: LINEAR_SERVER_SCHEMA, tool: "linear_evidence_comment_v1", readbackTool: "linear_evidence_comment_readback_v1", projection: ["/workspace", "/team", "/project", "/issue", "/commentMarker", "/commentId"] }),
    linearStatusTransition: operation({ key: "status-transition", provider: "linear", policyDigest: linearPolicyDigest, bindings: linearBindings, modelFields: ["requestId"], serverSchemaDigest: LINEAR_SERVER_SCHEMA, tool: "linear_status_transition_v1", readbackTool: "linear_status_transition_readback_v1", projection: ["/workspace", "/team", "/project", "/issue", "/preStatus", "/targetStatus", "/status"] }),
  });
  const pack = Object.freeze({ v: "reelier.github-linear-outcome-pack/v1" as const, authorityDigest: authorityDigestValue, githubPolicyDigest, linearPolicyDigest, operations });
  packAuthorities.set(pack, authority);
  return pack;
}

export function orderedGitHubLinearOperationsV1(pack: GitHubLinearOutcomePackV1, mode: GitHubLinearOutcomeModeV1): readonly ReviewedOutcomeOperationV1[] {
  const parsed = requirePack(pack);
  if (mode === "linear-only") return Object.freeze([parsed.operations.linearEvidenceComment, parsed.operations.linearStatusTransition]);
  if (mode !== "github-linear") throw new TypeError("outcome pack mode is invalid");
  return Object.freeze([parsed.operations.candidatePublish, parsed.operations.pullRequestEnsure, parsed.operations.exactHeadMerge, parsed.operations.linearEvidenceComment, parsed.operations.linearStatusTransition]);
}

export function assertLinearStatusPredecessorV1(pack: GitHubLinearOutcomePackV1, value: Readonly<{ receipt: GovernedReceiptV1; outcome: GovernedOutcomeV1 }>): void {
  const parsed = requirePack(pack), pair = inertRecord(value, ["receipt", "outcome"], "Linear status predecessor");
  const receipt = parseGovernedReceiptV1(pair.receipt), outcome = parseGovernedOutcomeV1(pair.outcome);
  const expectedContractDigest = digestToolEffectContractV1(parsed.operations.linearEvidenceComment.contract);
  if (receipt.status !== "verified" || outcome.status !== "verified") throw new TypeError("Linear status predecessor receipt must be verified");
  if (outcome.contractDigest !== expectedContractDigest || outcome.semanticIdentity !== parsed.operations.linearEvidenceComment.contract.semanticIdentity || receipt.outcomeDigest !== digestGovernedOutcomeV1(outcome)) throw new TypeError("Linear status requires the exact verified comment predecessor");
}

export function assertGitHubLinearProviderReadbackV1(pack: GitHubLinearOutcomePackV1, operationName: GitHubLinearOutcomeOperationNameV1, value: unknown): Readonly<Record<string, string | number | boolean>> {
  const parsed = requirePack(pack), authority = packAuthorities.get(parsed as object);
  if (!authority) throw new TypeError("reviewed outcome pack authority is unavailable");
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
    raw = inertRecord(value, ["workspace", "team", "project", "issue", "commentMarker", "commentId"], "Linear comment readback");
    expected = { workspace: authority.linear.workspace, team: authority.linear.team, project: authority.linear.project, issue: authority.linear.issue, commentMarker: authority.linear.commentMarker };
    text(raw.commentId, "Linear comment ID");
  } else if (operationName === "linearStatusTransition") {
    raw = inertRecord(value, ["workspace", "team", "project", "issue", "preStatus", "targetStatus", "status"], "Linear status readback");
    expected = { workspace: authority.linear.workspace, team: authority.linear.team, project: authority.linear.project, issue: authority.linear.issue, preStatus: authority.linear.preStatus, targetStatus: authority.linear.targetStatus, status: authority.linear.targetStatus };
  } else throw new TypeError("reviewed outcome operation is invalid");
  for (const [key, expectedValue] of Object.entries(expected)) if (raw[key] !== expectedValue) throw new TypeError(`${operationName} readback conflicts with exact reviewed authority`);
  const result: Record<string, string | number | boolean> = Object.create(null);
  for (const [key, item] of Object.entries(raw)) {
    if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") throw new TypeError("provider readback contains an invalid value");
    result[key] = item;
  }
  return Object.freeze(result);
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
  const dispatchFields: Readonly<Record<string, readonly string[]>> = Object.freeze({ github_release_candidate_publish_v1: ["authorizationHandle", "requestId", "semanticsDigest"], github_release_pr_ensure_v1: ["authorizationHandle", "requestId", "semanticsDigest"], github_release_pr_merge_v1: ["authorizationHandle", "requestId", "semanticsDigest"] });
  const readbackProjection: Readonly<Record<string, readonly string[]>> = Object.freeze({ github_release_candidate_publish_readback_v1: ["/repository", "/baseSha", "/headSha", "/candidateDigest"], github_release_pr_ensure_readback_v1: ["/repository", "/baseBranch", "/headSha", "/pullRequest", "/ready"], github_release_pr_merge_readback_v1: ["/repository", "/baseSha", "/headSha", "/mergeCommitSha", "/treeSha"] });
  if (dispatchFields[tool]) return authorityDigest({ v: "reelier.reviewed-outcome-tool-schema/v1", provider: "github", tool, modelFields: dispatchFields[tool] });
  if (readbackProjection[tool]) return authorityDigest({ v: "reelier.reviewed-outcome-readback-schema/v1", provider: "github", tool, projection: readbackProjection[tool] });
  throw new TypeError("GitHub release outcome tool is not reviewed");
}

function parseAuthority(value: unknown): GitHubLinearReviewedAuthorityV1 {
  const root = inertRecord(value, ["v", "github", "linear"], "reviewed GitHub and Linear authority");
  if (root.v !== "reelier.github-linear-reviewed-authority/v1") throw new TypeError("reviewed authority version is invalid");
  const github = inertRecord(root.github, ["repository", "baseBranch", "baseSha", "headBranch", "headSha", "candidateDigest", "workflowPath", "workflowDigest", "requiredChecks", "mergeMethod", "postMergeTreeSha", "accountRef", "destinationRef", "credentialRef", "limitRef"], "reviewed GitHub authority");
  const linear = inertRecord(root.linear, ["workspace", "team", "project", "issue", "preStatus", "targetStatus", "commentMarker", "accountRef", "destinationRef", "credentialRef", "limitRef"], "reviewed Linear authority");
  const requiredChecks = stringArray(github.requiredChecks, "required checks");
  if (github.baseBranch !== "main" || github.workflowPath !== ".github/workflows/ci.yml" || github.mergeMethod !== "squash" || authorityDigest(requiredChecks) !== authorityDigest(REQUIRED_CHECKS)) throw new TypeError("GitHub outcome authority must bind main, the signed CI workflow, exact required checks, and squash merge");
  for (const [raw, label] of [[github.repository, "repository"], [github.headBranch, "head branch"], [linear.workspace, "workspace"], [linear.team, "team"], [linear.project, "project"], [linear.issue, "issue"], [linear.preStatus, "pre-status"], [linear.targetStatus, "target status"], [linear.commentMarker, "comment marker"]] as const) text(raw, label);
  for (const [raw, label] of [[github.baseSha, "base SHA"], [github.headSha, "head SHA"], [github.postMergeTreeSha, "post-merge tree SHA"]] as const) if (typeof raw !== "string" || !GIT_SHA.test(raw)) throw new TypeError(`${label} is invalid`);
  for (const [raw, label] of [[github.candidateDigest, "candidate digest"], [github.workflowDigest, "workflow digest"]] as const) digest(raw, label);
  const githubRefs = refs(github), linearRefs = refs(linear);
  return deepFreeze({ v: root.v, github: { repository: github.repository, baseBranch: github.baseBranch, baseSha: github.baseSha, headBranch: github.headBranch, headSha: github.headSha, candidateDigest: github.candidateDigest, workflowPath: github.workflowPath, workflowDigest: github.workflowDigest, requiredChecks, mergeMethod: github.mergeMethod, postMergeTreeSha: github.postMergeTreeSha, ...githubRefs }, linear: { workspace: linear.workspace, team: linear.team, project: linear.project, issue: linear.issue, preStatus: linear.preStatus, targetStatus: linear.targetStatus, commentMarker: linear.commentMarker, ...linearRefs } }) as GitHubLinearReviewedAuthorityV1;
}

function requirePack(pack: unknown): GitHubLinearOutcomePackV1 {
  if (!pack || typeof pack !== "object" || isProxy(pack) || Object.getPrototypeOf(pack) !== null && Object.getPrototypeOf(pack) !== Object.prototype) throw new TypeError("outcome pack is invalid");
  const value = pack as GitHubLinearOutcomePackV1;
  if (value.v !== "reelier.github-linear-outcome-pack/v1" || !SHA.test(value.authorityDigest) || !SHA.test(value.githubPolicyDigest) || !SHA.test(value.linearPolicyDigest) || !packAuthorities.has(value as object)) throw new TypeError("outcome pack is invalid");
  return value;
}

function refs(value: Record<string, unknown>): Readonly<{ accountRef: string; destinationRef: string; credentialRef: string; limitRef: string }> { return Object.freeze({ accountRef: ref(value.accountRef, "account ref"), destinationRef: ref(value.destinationRef, "destination ref"), credentialRef: ref(value.credentialRef, "credential ref"), limitRef: ref(value.limitRef, "limit ref") }); }
function ref(value: unknown, label: string): string { const result = text(value, label); if (!REF.test(result)) throw new TypeError(`${label} is invalid`); return result; }
function text(value: unknown, label: string): string { if (typeof value !== "string" || value.length < 1 || value.length > 512) throw new TypeError(`${label} is invalid`); return value; }
function digest(value: unknown, label: string): string { if (typeof value !== "string" || !SHA.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function stringArray(value: unknown, label: string): readonly string[] { if (!Array.isArray(value) || isProxy(value) || value.length < 1 || value.length > 16) throw new TypeError(`${label} is invalid`); const result: string[] = []; for (let index = 0; index < value.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} must be a dense inert array`); result.push(text(descriptor.value, label)); } if (new Set(result).size !== result.length) throw new TypeError(`${label} contains duplicates`); return Object.freeze(result); }
function inertRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) throw new TypeError(`${label} must be an inert closed record`); const prototype = Object.getPrototypeOf(value); if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be an inert closed record`); const allowed = new Set(keys), result: Record<string, unknown> = Object.create(null); for (const key in value) { if (!Object.hasOwn(value, key)) continue; if (!allowed.has(key)) throw new TypeError(`${label} contains an unknown field`); } for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} requires inert data properties`); result[key] = descriptor.value; } return result; }
function deepFreeze<T>(value: T): T { if (value && typeof value === "object") { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value); } return value; }
