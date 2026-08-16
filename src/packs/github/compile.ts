import { authorityCanonicalBytes, authorityDigest } from "../../authority/wire.js";
import type { StaticPackDefinition, StaticPackCompileInput } from "../../authority/pack.js";
import { githubIssueLabelsAlias, githubIssueLabelsDefinitionDigest, githubIssueLabelsPackDigest, githubIssueLabelsPolicySchemaId, githubIssueLabelsProjectionSchemaId, githubIssueLabelsReadEndpointId, githubIssueLabelsRecipeId, githubIssueLabelsResolverId, githubIssueLabelsRiskClass, githubIssueLabelsWriteEndpointId } from "./manifest.js";
import type { GitHubIssueLabelsProjection } from "./manifest.js";

function parseLabels(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== "string" || item.length === 0 || item.length > 100)) throw new TypeError("desiredLabels must be a bounded string array");
  const labels = [...value] as string[];
  if (new Set(labels).size !== labels.length) throw new TypeError("desiredLabels must be unique");
  return Object.freeze(labels.sort(compareText));
}
export function validateGitHubIssueLabelsChoices(value: unknown): Record<string, never> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value as object).length !== 0) throw new TypeError("GitHub issue labels choices must be empty");
  return Object.freeze({});
}
export function parseGitHubIssueLabelsPolicy(value: unknown): Readonly<{ desiredLabels: readonly string[]; allowedIssueStates: readonly string[] }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("GitHub issue labels policy must be an object");
  const policy = value as Record<string, unknown>;
  if (!(Object.keys(policy).length === 1 || Object.keys(policy).length === 2) || !("desiredLabels" in policy) || Object.keys(policy).some(key => key !== "desiredLabels" && key !== "allowedIssueStates")) throw new TypeError("GitHub issue labels policy is closed");
  const states = policy.allowedIssueStates === undefined ? ["open"] : policy.allowedIssueStates;
  if (!Array.isArray(states) || states.length === 0 || states.length > 8 || states.some(state => typeof state !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(state)) || new Set(states).size !== states.length) throw new TypeError("allowedIssueStates must be a bounded unique string array");
  return Object.freeze({ desiredLabels: parseLabels(policy.desiredLabels), allowedIssueStates: Object.freeze([...states].sort(compareText)) });
}
export function compileGitHubIssueLabels(input: Readonly<{ source: { projection: Record<string, unknown> }; policy: unknown }>): unknown {
  const source = input.source.projection as unknown as GitHubIssueLabelsProjection;
  const policy = input.policy as { desiredLabels: readonly string[]; allowedIssueStates: readonly string[] };
  if (!policy.allowedIssueStates.includes(source.issueState)) throw new TypeError("GitHub issue state is outside the signed policy");
  const body = authorityCanonicalBytes({ labels: policy.desiredLabels });
  return { v: "reelier.transport-effect/v1", endpointId: githubIssueLabelsWriteEndpointId, method: "PUT", path: `/repos/${source.owner}/${source.repo}/issues/${source.issueNumber}/labels`, query: "", headers: { "Content-Type": "application/json" }, bodyBase64: body.toString("base64"), riskClass: githubIssueLabelsRiskClass, idempotency: "native", preconditions: [{ kind: "github-labels-digest", digest: authorityDigest({ v: "reelier.github-labels/v1", labels: source.labels }) }], reconciliation: { recipeId: githubIssueLabelsRecipeId } };
}
export const githubIssueLabelsDefinition: StaticPackDefinition = Object.freeze({
  alias: githubIssueLabelsAlias, packDigest: githubIssueLabelsPackDigest, definitionDigest: githubIssueLabelsDefinitionDigest, resolverId: githubIssueLabelsResolverId, projectionSchemaId: githubIssueLabelsProjectionSchemaId, maxFreshnessSeconds: 60, readEndpointIds: [githubIssueLabelsReadEndpointId], writeEndpointIds: [githubIssueLabelsWriteEndpointId], riskClasses: [githubIssueLabelsRiskClass], policySchemaId: githubIssueLabelsPolicySchemaId, requiredGroundedPointers: ["/owner", "/repo", "/issueNumber", "/issueState", "/labels"], validateChoices: validateGitHubIssueLabelsChoices, parsePolicy: parseGitHubIssueLabelsPolicy, compile: (input: StaticPackCompileInput) => compileGitHubIssueLabels({ source: input.source, policy: input.policy }),
});
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
