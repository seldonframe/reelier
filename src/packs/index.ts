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
import { gmailReplyManifest, gmailLabelsManifest, gmailReplyDefinition, gmailLabelsDefinition, createGmailSourceResolver, reconcileGmailReply, reconcileGmailLabels } from "./gmail/index.js";
import { stripeManifest, stripeRefundDefinition, createStripeSourceResolver, reconcileStripeRefund } from "./stripe/index.js";
import { vercelDeploymentReleaseManifest, vercelDeploymentReleaseDefinition, createVercelDeploymentReleaseSourceResolver, reconcileVercelDeploymentRelease } from "./vercel/index.js";
import { cloudflareDnsRecordSetManifest, cloudflareDnsRecordSetDefinition, createCloudflareDnsRecordSourceResolver, reconcileCloudflareDnsRecordSet } from "./cloudflare/index.js";
import { neonDatabaseMigrationManifest, neonDatabaseMigrationDefinition, createNeonDatabaseMigrationSourceResolver, reconcileNeonDatabaseMigration } from "./neon/index.js";
import { cloudflareTokenRollManifest, cloudflareTokenRollDefinition, createCloudflareTokenRollSourceResolver, reconcileCloudflareTokenRoll } from "./cloudflare-token/index.js";
import { informationFlowManifest, informationFlowDefinition, createInformationFlowSourceResolver, reconcileInformationFlowCommit } from "./information-flow/index.js";

export interface FirstPartyPack {
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly definition: StaticPackDefinition;
  readonly resolver: ReturnType<typeof createGitHubIssueLabelsSourceResolver> | ReturnType<typeof createSlackChannelTopicSourceResolver> | ReturnType<typeof createGmailSourceResolver> | ReturnType<typeof createStripeSourceResolver> | ReturnType<typeof createVercelDeploymentReleaseSourceResolver> | ReturnType<typeof createCloudflareDnsRecordSourceResolver> | ReturnType<typeof createNeonDatabaseMigrationSourceResolver> | ReturnType<typeof createCloudflareTokenRollSourceResolver> | ReturnType<typeof createInformationFlowSourceResolver>;
  readonly reconcile: (...args: any[]) => any;
}

export const githubIssueLabelsPack: FirstPartyPack = Object.freeze({ manifest: githubIssueLabelsManifest, definition: githubIssueLabelsDefinition, resolver: createGitHubIssueLabelsSourceResolver(), reconcile: reconcileGitHubIssueLabels });
export const slackChannelTopicPack: FirstPartyPack = Object.freeze({ manifest: slackChannelTopicManifest, definition: slackChannelTopicDefinition, resolver: createSlackChannelTopicSourceResolver(), reconcile: reconcileSlackChannelTopic });
export const gmailReplyPack: FirstPartyPack = Object.freeze({ manifest: gmailReplyManifest, definition: gmailReplyDefinition, resolver: createGmailSourceResolver(), reconcile: reconcileGmailReply });
export const gmailLabelsPack: FirstPartyPack = Object.freeze({ manifest: gmailLabelsManifest, definition: gmailLabelsDefinition, resolver: createGmailSourceResolver("*", true), reconcile: reconcileGmailLabels });
export const stripeRefundPack: FirstPartyPack = Object.freeze({ manifest: stripeManifest, definition: stripeRefundDefinition, resolver: createStripeSourceResolver(), reconcile: reconcileStripeRefund });
export const vercelDeploymentReleasePack: FirstPartyPack = Object.freeze({ manifest: vercelDeploymentReleaseManifest, definition: vercelDeploymentReleaseDefinition, resolver: createVercelDeploymentReleaseSourceResolver(), reconcile: reconcileVercelDeploymentRelease });
export const cloudflareDnsRecordSetPack: FirstPartyPack = Object.freeze({ manifest: cloudflareDnsRecordSetManifest, definition: cloudflareDnsRecordSetDefinition, resolver: createCloudflareDnsRecordSourceResolver(), reconcile: reconcileCloudflareDnsRecordSet });
export const neonDatabaseMigrationPack: FirstPartyPack = Object.freeze({ manifest: neonDatabaseMigrationManifest, definition: neonDatabaseMigrationDefinition, resolver: createNeonDatabaseMigrationSourceResolver(), reconcile: reconcileNeonDatabaseMigration });
export const cloudflareTokenRollPack: FirstPartyPack = Object.freeze({ manifest: cloudflareTokenRollManifest, definition: cloudflareTokenRollDefinition, resolver: createCloudflareTokenRollSourceResolver(), reconcile: reconcileCloudflareTokenRoll });
export const informationFlowPack: FirstPartyPack = Object.freeze({ manifest: informationFlowManifest, definition: informationFlowDefinition, resolver: createInformationFlowSourceResolver(), reconcile: reconcileInformationFlowCommit });
export const firstPartyPacks = Object.freeze([githubIssueLabelsPack, slackChannelTopicPack, gmailReplyPack, gmailLabelsPack, stripeRefundPack, vercelDeploymentReleasePack, cloudflareDnsRecordSetPack, neonDatabaseMigrationPack, cloudflareTokenRollPack, informationFlowPack]);

export function createFirstPartyPackRegistry(): StaticPackRegistry { return createStaticPackRegistry(firstPartyPacks.map(pack => pack.definition)); }
export function createFirstPartySourceRegistry(tenant: string): SourceRegistry { return createSourceRegistry([createGitHubIssueLabelsSourceResolver(tenant), createSlackChannelTopicSourceResolver(tenant), createGmailSourceResolver(tenant), createGmailSourceResolver(tenant, true), createStripeSourceResolver(tenant), createVercelDeploymentReleaseSourceResolver(tenant), createCloudflareDnsRecordSourceResolver(tenant), createNeonDatabaseMigrationSourceResolver(tenant), createCloudflareTokenRollSourceResolver(tenant), createInformationFlowSourceResolver(tenant)]); }
export function firstPartyPackForAlias(alias: string): FirstPartyPack | undefined { return firstPartyPacks.find(pack => pack.definition.alias === alias); }

export { githubIssueLabelsManifest, githubIssueLabelsDefinition, createGitHubIssueLabelsSourceResolver, compileGitHubIssueLabels, parseGitHubIssueLabelsPolicy, validateGitHubIssueLabelsChoices, reconcileGitHubIssueLabels } from "./github/index.js";
export { slackChannelTopicManifest, slackChannelTopicDefinition, createSlackChannelTopicSourceResolver, compileSlackChannelTopic, parseSlackChannelTopicPolicy, validateSlackChannelTopicChoices, reconcileSlackChannelTopic } from "./slack-topic/index.js";
export { gmailReplySendAlias, gmailThreadLabelsAlias, parseGmailReplyPolicy, parseGmailLabelsPolicy, compileGmailReply, compileGmailLabels, reconcileGmailReply, reconcileGmailLabels, createGmailSourceResolver, gmailReplyDefinition, gmailLabelsDefinition, gmailReplyManifest, gmailLabelsManifest } from "./gmail/index.js";
export { stripeRefundIssueAlias, parseStripeRefundPolicy, compileStripeRefund, reconcileStripeRefund, createStripeSourceResolver, stripeRefundDefinition, stripeManifest } from "./stripe/index.js";
export { vercelDeploymentReleaseAlias, parseVercelDeploymentReleasePolicy, compileVercelDeploymentRelease, validateVercelDeploymentReleaseChoices, createVercelDeploymentReleaseSourceResolver, reconcileVercelDeploymentRelease, vercelDeploymentReleaseDefinition, vercelDeploymentReleaseManifest, type VercelDeploymentReleaseProjection, type VercelDeploymentReleasePolicy } from "./vercel/index.js";
export { cloudflareDnsRecordSetAlias, parseCloudflareDnsRecordPolicy, compileCloudflareDnsRecordSet, validateCloudflareDnsRecordChoices, createCloudflareDnsRecordSourceResolver, reconcileCloudflareDnsRecordSet, cloudflareDnsRecordSetDefinition, cloudflareDnsRecordSetManifest, type CloudflareDnsRecordProjection, type CloudflareDnsRecordPolicy } from "./cloudflare/index.js";
export { neonDatabaseMigrationAlias, parseNeonDatabaseMigrationPolicy, compileNeonDatabaseMigration, validateNeonDatabaseMigrationChoices, createNeonDatabaseMigrationSourceResolver, reconcileNeonDatabaseMigration, neonDatabaseMigrationDefinition, neonDatabaseMigrationManifest, type NeonDatabaseMigrationProjection, type NeonDatabaseMigrationPolicy } from "./neon/index.js";
export { cloudflareTokenRollAlias, parseCloudflareTokenRollPolicy, compileCloudflareTokenRoll, validateCloudflareTokenRollChoices, createCloudflareTokenRollSourceResolver, reconcileCloudflareTokenRoll, cloudflareTokenRollDefinition, cloudflareTokenRollManifest, type CloudflareTokenProjection, type CloudflareTokenRollPolicy } from "./cloudflare-token/index.js";
export { informationFlowCommitAlias, parseInformationFlowPolicy, compileInformationFlowCommit, validateInformationFlowChoices, createInformationFlowSourceResolver, reconcileInformationFlowCommit, informationFlowDefinition, informationFlowManifest, type InformationFlowProjection, type InformationFlowPolicy } from "./information-flow/index.js";
export { semanticOutcomeCatalog, semanticOutcomeForAlias, type SemanticOutcomeCatalogEntry } from "./semantic.js";
