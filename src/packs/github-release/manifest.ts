import { authorityDigest } from "../../authority/wire.js";

export const githubReleaseCandidatePublishAlias = "github_release_candidate_publish_v1" as const;
export const githubReleasePrEnsureAlias = "github_release_pr_ensure_v1" as const;
export const githubReleasePrMergeAlias = "github_release_pr_merge_v1" as const;
export const githubReleaseTagCreateAlias = "github_release_tag_create_v1" as const;
export const githubReleaseAliases = [githubReleaseCandidatePublishAlias, githubReleasePrEnsureAlias, githubReleasePrMergeAlias, githubReleaseTagCreateAlias] as const;
export const githubReleaseEffects = ["candidate-branch", "draft-pr", "exact-sha-merge", "non-force-tag"] as const;
export type GitHubReleaseAlias = (typeof githubReleaseAliases)[number];
export type GitHubReleaseEffect = (typeof githubReleaseEffects)[number];

export const githubReleaseProjectionSchemaId = "github_release_authorization_handle_projection_v1";
export const githubReleasePolicySchemaId = "github_release_allocation_policy_v1";
export const githubReleaseReadEndpointId = "github.release.authorization.read";
export const githubReleaseRiskClass = "github_release";
export const githubReleaseRecipeId = "github_release_authoritative_readback_v1";

const definitions = githubReleaseAliases.map((alias, index) => Object.freeze({
  v: "reelier.outcome-pack-definition/v1", alias, resolverId: `${alias}_source`, projectionSchemaId: githubReleaseProjectionSchemaId,
  policySchemaId: githubReleasePolicySchemaId, readEndpointIds: [githubReleaseReadEndpointId], writeEndpointIds: [`github.release.${githubReleaseEffects[index]}`],
  riskClasses: [githubReleaseRiskClass], requiredGroundedPointers: ["/authorizationHandle"], maxFreshnessSeconds: 60,
}));
export const githubReleasePackDigest = authorityDigest({ v: "reelier.outcome-pack/v1", packId: "github_release", definitions });
export const githubReleaseDefinitionDigests = Object.freeze(definitions.map(definition => authorityDigest({ ...definition, packDigest: githubReleasePackDigest })));
export const githubReleaseManifest = Object.freeze({ v: "reelier.outcome-pack-manifest/v1" as const, packId: "github_release", packDigest: githubReleasePackDigest, definitions: githubReleaseAliases });

export interface GitHubReleaseProjection extends Record<string, unknown> { readonly authorizationHandle: string }
