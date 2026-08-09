import { createStaticPackRegistry, type StaticPackRegistry } from "../authority/pack.js";
import { githubIssueLabelsDefinition, compileGitHubIssueLabels, parseGitHubIssueLabelsPolicy, validateGitHubIssueLabelsChoices } from "./github/compile.js";
import { githubIssueLabelsManifest } from "./github/manifest.js";
import { createGitHubIssueLabelsSourceResolver } from "./github/source.js";
import { reconcileGitHubIssueLabels } from "./github/reconcile.js";
import { slackChannelTopicDefinition, compileSlackChannelTopic, parseSlackChannelTopicPolicy, validateSlackChannelTopicChoices } from "./slack-topic/compile.js";
import { slackChannelTopicManifest } from "./slack-topic/manifest.js";
import { createSlackChannelTopicSourceResolver } from "./slack-topic/source.js";
import { reconcileSlackChannelTopic } from "./slack-topic/reconcile.js";
import { createSourceRegistry, type SourceRegistry } from "../authority/source.js";
import type { StaticPackDefinition } from "../authority/pack.js";

export interface FirstPartyPack {
  readonly manifest: typeof githubIssueLabelsManifest | typeof slackChannelTopicManifest;
  readonly definition: StaticPackDefinition;
  readonly resolver: ReturnType<typeof createGitHubIssueLabelsSourceResolver> | ReturnType<typeof createSlackChannelTopicSourceResolver>;
  readonly reconcile: typeof reconcileGitHubIssueLabels | typeof reconcileSlackChannelTopic;
}

export const githubIssueLabelsPack: FirstPartyPack = Object.freeze({ manifest: githubIssueLabelsManifest, definition: githubIssueLabelsDefinition, resolver: createGitHubIssueLabelsSourceResolver(), reconcile: reconcileGitHubIssueLabels });
export const slackChannelTopicPack: FirstPartyPack = Object.freeze({ manifest: slackChannelTopicManifest, definition: slackChannelTopicDefinition, resolver: createSlackChannelTopicSourceResolver(), reconcile: reconcileSlackChannelTopic });
export const firstPartyPacks = Object.freeze([githubIssueLabelsPack, slackChannelTopicPack]);

export function createFirstPartyPackRegistry(): StaticPackRegistry { return createStaticPackRegistry(firstPartyPacks.map(pack => pack.definition)); }
export function createFirstPartySourceRegistry(tenant: string): SourceRegistry { return createSourceRegistry([createGitHubIssueLabelsSourceResolver(tenant), createSlackChannelTopicSourceResolver(tenant)]); }
export function firstPartyPackForAlias(alias: string): FirstPartyPack | undefined { return firstPartyPacks.find(pack => pack.definition.alias === alias); }

export { githubIssueLabelsManifest, githubIssueLabelsDefinition, createGitHubIssueLabelsSourceResolver, compileGitHubIssueLabels, parseGitHubIssueLabelsPolicy, validateGitHubIssueLabelsChoices, reconcileGitHubIssueLabels } from "./github/index.js";
export { slackChannelTopicManifest, slackChannelTopicDefinition, createSlackChannelTopicSourceResolver, compileSlackChannelTopic, parseSlackChannelTopicPolicy, validateSlackChannelTopicChoices, reconcileSlackChannelTopic } from "./slack-topic/index.js";
