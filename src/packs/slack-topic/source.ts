import type { RegisteredSourceResolver, SourceProjection, ResolverSourceObservation, PlannedSourceRead } from "../../authority/source.js";
import { authorityDigest } from "../../authority/wire.js";
import { slackChannelTopicDefinitionDigest, slackChannelTopicProjectionSchemaId, slackChannelTopicReadEndpointId, slackChannelTopicResolverId } from "./manifest.js";
import type { SlackChannelTopicProjection } from "./manifest.js";

function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Slack source response must be an object"); return value as Record<string, unknown>; }
function text(value: unknown, label: string, max = 256): string { if (typeof value !== "string" || value.length > max) throw new TypeError(`Slack source ${label} is invalid`); return value; }
function normalize(rawBytes: Uint8Array): SlackChannelTopicProjection {
  let parsed: unknown; try { parsed = JSON.parse(Buffer.from(rawBytes).toString("utf8")); } catch { throw new TypeError("Slack source response is not JSON"); }
  const root = object(parsed); const channel = object(root.channel ?? root);
  const teamId = text(root.teamId ?? root.team_id ?? channel.teamId ?? channel.team_id, "team id", 128);
  const channelId = text(root.channelId ?? root.channel_id ?? channel.id, "channel id", 128);
  const channelName = text(root.channelName ?? root.channel_name ?? channel.name ?? "", "channel name", 256);
  const isPrivate = root.isPrivate ?? root.is_private ?? channel.isPrivate ?? channel.is_private;
  if (typeof isPrivate !== "boolean") throw new TypeError("Slack source private-channel flag is invalid");
  const topicObject = object(channel.topic ?? {});
  const topic = text(root.topic ?? topicObject.value ?? "", "topic", 250);
  return Object.freeze({ teamId, channelId, channelName, isPrivate, topic });
}
export function createSlackChannelTopicSourceResolver(tenant: string = "*"): RegisteredSourceResolver {
  if (typeof tenant !== "string" || tenant.length === 0) throw new TypeError("tenant is required");
  return Object.freeze({ tenant, resolverId: slackChannelTopicResolverId, definitionDigest: slackChannelTopicDefinitionDigest, projectionSchemaId: slackChannelTopicProjectionSchemaId, readEndpointIds: [slackChannelTopicReadEndpointId], maxFreshnessSeconds: 60,
    plan: (refs: Readonly<Record<string, string>>) => [{ endpointId: slackChannelTopicReadEndpointId, opaqueHandle: refs.channel }],
    project: (input: Readonly<{ plans: readonly PlannedSourceRead[]; observations: readonly ResolverSourceObservation[]; observedAt: string }>) => { if (input.observations.length !== 1) throw new TypeError("Slack source requires one channel observation"); const projection = normalize(Buffer.from(input.observations[0].bodyBase64, "base64")); const sourceIdentity = `slack.${projection.teamId}.${projection.channelId}`; const triggerIdentity = safeDigest(authorityDigest({ v: "reelier.slack-channel-topic-trigger/v1", sourceIdentity, topic: projection.topic })); const claims = ["teamId", "channelId", "channelName", "isPrivate", "topic"].map(key => ({ claimId: `slack-${key}`, projectionPointer: `/${key}` })); return Object.freeze({ sourceIdentity, triggerIdentity, projection, claims: Object.freeze({ grounded: Object.freeze(claims), authored: Object.freeze([]), unresolved: Object.freeze([]) }) }) satisfies SourceProjection; },
  });
}
function safeDigest(value: string): string { return value.replace(":", "."); }
