import { authorityDigest } from "../../authority/wire.js";
import type { SlackChannelTopicProjection } from "./manifest.js";
import { slackChannelTopicRecipeId } from "./manifest.js";
import type { PackReconciliationResult, ProviderResponse } from "../types.js";

export function reconcileSlackChannelTopic(input: Readonly<{ expected: SlackChannelTopicProjection; response: ProviderResponse | unknown }>): PackReconciliationResult {
  const response = normalizeResponse(input.response); if (response.status !== undefined && response.status >= 500) return unavailable("provider-error"); if (response.status === 404) return notApplied("channel-not-found"); if (response.status !== undefined && response.status >= 400) return unavailable("provider-refused");
  try { const body = (response.body && typeof response.body === "object" ? response.body : {}) as Record<string, unknown>; const channel = body.channel && typeof body.channel === "object" ? body.channel as Record<string, unknown> : body; const topicObject = channel.topic && typeof channel.topic === "object" ? channel.topic as Record<string, unknown> : {}; const actual = typeof channel.topic === "string" ? channel.topic : typeof topicObject.value === "string" ? topicObject.value : null; if (actual === null) return unavailable("malformed-provider-state"); const digest = authorityDigest({ v: "reelier.slack-channel-topic-projection/v1", teamId: input.expected.teamId, channelId: input.expected.channelId, topic: actual }); const matched = actual === input.expected.topic; return Object.freeze({ status: matched ? "matched" : "conflict", recipeId: slackChannelTopicRecipeId, projectionDigest: digest, reasonCode: matched ? "topic-match" : "topic-conflict" }); } catch { return unavailable("malformed-provider-state"); }
}
function normalizeResponse(value: ProviderResponse | unknown): ProviderResponse { if (value && typeof value === "object" && "body" in value) return value as ProviderResponse; return { body: value }; }
function unavailable(reasonCode: string): PackReconciliationResult { return Object.freeze({ status: "unavailable", recipeId: slackChannelTopicRecipeId, projectionDigest: null, reasonCode }); }
function notApplied(reasonCode: string): PackReconciliationResult { return Object.freeze({ status: "not-applied", recipeId: slackChannelTopicRecipeId, projectionDigest: null, reasonCode }); }
