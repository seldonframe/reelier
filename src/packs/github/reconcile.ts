import { authorityDigest } from "../../authority/wire.js";
import type { GitHubIssueLabelsProjection } from "./manifest.js";
import { githubIssueLabelsRecipeId } from "./manifest.js";
import type { PackReconciliationResult, ProviderResponse } from "../types.js";

export function reconcileGitHubIssueLabels(input: Readonly<{ expected: GitHubIssueLabelsProjection; response: ProviderResponse | unknown }>): PackReconciliationResult {
  const response = normalizeResponse(input.response);
  if (response.status !== undefined && response.status >= 500) return unavailable("provider-error");
  if (response.status === 404) return notApplied("issue-not-found");
  if (response.status !== undefined && response.status >= 400) return unavailable("provider-refused");
  try {
    const body = response.body as Record<string, unknown>;
    const labels = Array.isArray(body) ? body : Array.isArray(body.labels) ? body.labels : [];
    const normalized = labels.map(label => typeof label === "string" ? label : typeof label === "object" && label !== null && typeof (label as Record<string, unknown>).name === "string" ? (label as Record<string, string>).name : null);
    if (normalized.some(label => label === null)) return unavailable("malformed-provider-state");
    const actual = [...normalized] as string[]; actual.sort(compareText);
    const expected = [...input.expected.labels].sort(compareText);
    const projection = authorityDigest({ v: "reelier.github-issue-labels-projection/v1", owner: input.expected.owner, repo: input.expected.repo, issueNumber: input.expected.issueNumber, labels: actual });
    return Object.freeze({ status: equal(actual, expected) ? "matched" : "conflict", recipeId: githubIssueLabelsRecipeId, projectionDigest: projection, reasonCode: equal(actual, expected) ? "labels-match" : "labels-conflict" });
  } catch { return unavailable("malformed-provider-state"); }
}
function normalizeResponse(value: ProviderResponse | unknown): ProviderResponse { if (value && typeof value === "object" && "body" in value) return value as ProviderResponse; return { body: value }; }
function equal(a: readonly string[], b: readonly string[]): boolean { return a.length === b.length && a.every((value, index) => value === b[index]); }
function unavailable(reasonCode: string): PackReconciliationResult { return Object.freeze({ status: "unavailable", recipeId: githubIssueLabelsRecipeId, projectionDigest: null, reasonCode }); }
function notApplied(reasonCode: string): PackReconciliationResult { return Object.freeze({ status: "not-applied", recipeId: githubIssueLabelsRecipeId, projectionDigest: null, reasonCode }); }
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
