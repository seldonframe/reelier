import type { RegisteredSourceResolver, SourceProjection, ResolverSourceObservation, PlannedSourceRead } from "../../authority/source.js";
import { githubIssueLabelsDefinitionDigest, githubIssueLabelsProjectionSchemaId, githubIssueLabelsReadEndpointId, githubIssueLabelsResolverId } from "./manifest.js";
import { authorityDigest } from "../../authority/wire.js";
import type { GitHubIssueLabelsProjection } from "./manifest.js";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("GitHub source response must be an object");
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) throw new TypeError(`GitHub source ${label} is invalid`);
  return value;
}
function safePathSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value) || value === "." || value === "..") throw new TypeError(`GitHub source ${label} is not a safe path segment`);
  return value;
}
function normalize(rawBytes: Uint8Array): GitHubIssueLabelsProjection {
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(rawBytes).toString("utf8")); } catch { throw new TypeError("GitHub source response is not JSON"); }
  const root = object(parsed);
  const repository = root.repository && typeof root.repository === "object" && !Array.isArray(root.repository) ? object(root.repository) : {};
  const ownerObject = object(repository.owner ?? {});
  const owner = safePathSegment(string(root.owner ?? ownerObject.login ?? "", "owner"), "owner");
  const repo = safePathSegment(string(root.repo ?? repository.name ?? "", "repo"), "repo");
  const issueNumber = root.issueNumber ?? root.number;
  if (!Number.isSafeInteger(issueNumber) || (issueNumber as number) < 1 || (issueNumber as number) > 2_000_000_000) throw new TypeError("GitHub source issue number is invalid");
  const issueState = string(root.issueState ?? root.state ?? "", "issue state");
  const rawLabels = root.labels;
  if (!Array.isArray(rawLabels) || rawLabels.length > 100) throw new TypeError("GitHub source labels are invalid");
  const labels = rawLabels.map(label => typeof label === "string" ? label : string(object(label).name, "label"));
  if (labels.some(label => label.length > 100) || new Set(labels).size !== labels.length) throw new TypeError("GitHub source labels must be unique and bounded");
  return Object.freeze({ owner, repo, issueNumber: issueNumber as number, issueState, labels: Object.freeze([...labels].sort(compareText)) });
}

export function createGitHubIssueLabelsSourceResolver(tenant: string = "*"): RegisteredSourceResolver {
  if (typeof tenant !== "string" || tenant.length === 0) throw new TypeError("tenant is required");
  return Object.freeze({
    tenant, resolverId: githubIssueLabelsResolverId, definitionDigest: githubIssueLabelsDefinitionDigest, projectionSchemaId: githubIssueLabelsProjectionSchemaId,
    readEndpointIds: [githubIssueLabelsReadEndpointId], maxFreshnessSeconds: 60,
    plan: (refs: Readonly<Record<string, string>>) => [{ endpointId: githubIssueLabelsReadEndpointId, opaqueHandle: refs.issue }],
    project: (input: Readonly<{ plans: readonly PlannedSourceRead[]; observations: readonly ResolverSourceObservation[]; observedAt: string }>) => {
      if (input.observations.length !== 1) throw new TypeError("GitHub source requires one issue observation");
      const projection = normalize(Buffer.from(input.observations[0].bodyBase64, "base64"));
      const sourceIdentity = `github.${projection.owner}.${projection.repo}.${projection.issueNumber}`;
      const triggerIdentity = safeDigest(authorityDigest({ v: "reelier.github-issue-labels-trigger/v1", sourceIdentity, labels: projection.labels }));
      const claims = ["owner", "repo", "issueNumber", "issueState", "labels"].map(key => ({ claimId: `github-${key}`, projectionPointer: `/${key}` }));
      return Object.freeze({ sourceIdentity, triggerIdentity, projection, claims: Object.freeze({ grounded: Object.freeze(claims), authored: Object.freeze([]), unresolved: Object.freeze([]) }) }) satisfies SourceProjection;
    },
  });
}
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function safeDigest(value: string): string { return value.replace(":", "."); }
