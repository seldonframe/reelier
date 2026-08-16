import { authorityDigest } from "../../authority/wire.js";

export const githubIssueLabelsAlias = "github_issue_labels_set_v1" as const;
export const githubIssueLabelsResolverId = "github_issue_labels_source_v1" as const;
export const githubIssueLabelsProjectionSchemaId = "github_issue_labels_projection_v1" as const;
export const githubIssueLabelsPolicySchemaId = "github_issue_labels_policy_v1" as const;
export const githubIssueLabelsRiskClass = "github_issue_labels" as const;
export const githubIssueLabelsReadEndpointId = "github.issue.get" as const;
export const githubIssueLabelsWriteEndpointId = "github.issue.labels.replace" as const;
export const githubIssueLabelsRecipeId = "github_issue_labels_readback_v1" as const;

const definitionShape = Object.freeze({
  v: "reelier.outcome-pack-definition/v1",
  alias: githubIssueLabelsAlias,
  resolverId: githubIssueLabelsResolverId,
  projectionSchemaId: githubIssueLabelsProjectionSchemaId,
  policySchemaId: githubIssueLabelsPolicySchemaId,
  readEndpointIds: [githubIssueLabelsReadEndpointId],
  writeEndpointIds: [githubIssueLabelsWriteEndpointId],
  riskClasses: [githubIssueLabelsRiskClass],
  requiredGroundedPointers: ["/owner", "/repo", "/issueNumber", "/issueState", "/labels"],
  maxFreshnessSeconds: 60,
});

export const githubIssueLabelsPackDigest = authorityDigest({ v: "reelier.outcome-pack/v1", packId: "github_issue_labels", definitions: [definitionShape] });
export const githubIssueLabelsDefinitionDigest = authorityDigest({ ...definitionShape, packDigest: githubIssueLabelsPackDigest });

export const githubIssueLabelsManifest = Object.freeze({
  v: "reelier.outcome-pack-manifest/v1" as const,
  packId: "github_issue_labels",
  packDigest: githubIssueLabelsPackDigest,
  definitions: [githubIssueLabelsAlias],
});

export interface GitHubIssueLabelsProjection extends Record<string, unknown> {
  readonly owner: string;
  readonly repo: string;
  readonly issueNumber: number;
  readonly issueState: string;
  readonly labels: readonly string[];
}
