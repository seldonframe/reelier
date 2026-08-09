import { authorityDigest } from "../../authority/wire.js";

export const slackChannelTopicAlias = "slack_channel_topic_set_v1" as const;
export const slackChannelTopicResolverId = "slack_channel_topic_source_v1" as const;
export const slackChannelTopicProjectionSchemaId = "slack_channel_topic_projection_v1" as const;
export const slackChannelTopicPolicySchemaId = "slack_channel_topic_policy_v1" as const;
export const slackChannelTopicRiskClass = "slack_channel_topic" as const;
export const slackChannelTopicReadEndpointId = "slack.conversations.info" as const;
export const slackChannelTopicWriteEndpointId = "slack.conversations.setTopic" as const;
export const slackChannelTopicRecipeId = "slack_channel_topic_readback_v1" as const;

const definitionShape = Object.freeze({
  v: "reelier.outcome-pack-definition/v1", alias: slackChannelTopicAlias, resolverId: slackChannelTopicResolverId,
  projectionSchemaId: slackChannelTopicProjectionSchemaId, policySchemaId: slackChannelTopicPolicySchemaId,
  readEndpointIds: [slackChannelTopicReadEndpointId], writeEndpointIds: [slackChannelTopicWriteEndpointId],
  riskClasses: [slackChannelTopicRiskClass], requiredGroundedPointers: ["/teamId", "/channelId", "/channelName", "/isPrivate", "/topic"], maxFreshnessSeconds: 60,
});
export const slackChannelTopicPackDigest = authorityDigest({ v: "reelier.outcome-pack/v1", packId: "slack_channel_topic", definitions: [definitionShape] });
export const slackChannelTopicDefinitionDigest = authorityDigest({ ...definitionShape, packDigest: slackChannelTopicPackDigest });
export const slackChannelTopicManifest = Object.freeze({ v: "reelier.outcome-pack-manifest/v1" as const, packId: "slack_channel_topic", packDigest: slackChannelTopicPackDigest, definitions: [slackChannelTopicAlias] });

export interface SlackChannelTopicProjection extends Record<string, unknown> {
  readonly teamId: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly isPrivate: boolean;
  readonly topic: string;
}
