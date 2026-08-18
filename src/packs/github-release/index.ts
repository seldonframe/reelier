import { githubReleaseManifest, githubReleaseCandidatePublishAlias, githubReleasePrEnsureAlias, githubReleasePrMergeAlias, githubReleaseTagCreateAlias } from "./manifest.js";
import { githubReleaseCandidatePublishDefinition, githubReleaseDefinitions, githubReleasePrEnsureDefinition, githubReleasePrMergeDefinition, githubReleaseTagCreateDefinition, validateGitHubReleaseChoices } from "./compile.js";
import { createGitHubReleaseSourceResolvers } from "./source.js";
import { reconcileGitHubRelease } from "./reconcile.js";

const resolvers = createGitHubReleaseSourceResolvers();
export const githubReleasePacks = Object.freeze(githubReleaseDefinitions.map((definition, index) => Object.freeze({ manifest: githubReleaseManifest, definition, resolver: resolvers[index], reconcile: reconcileGitHubRelease })));

export { githubReleaseManifest, githubReleaseCandidatePublishAlias, githubReleasePrEnsureAlias, githubReleasePrMergeAlias, githubReleaseTagCreateAlias, githubReleaseCandidatePublishDefinition, githubReleasePrEnsureDefinition, githubReleasePrMergeDefinition, githubReleaseTagCreateDefinition, githubReleaseDefinitions, validateGitHubReleaseChoices, createGitHubReleaseSourceResolvers, reconcileGitHubRelease };
