import { authorityDigest } from "../wire.js";
import type { TransportEffect } from "../types.js";
import type { DispatchAdapter, DispatchOutcome, DispatchRequestState } from "./dispatch.js";
import type { CertificationOperatorConfigV1 } from "./certification-config.js";
import { githubIssueLabelsWriteEndpointId } from "../../packs/github/manifest.js";
import { cloudflareDnsRecordSetWriteEndpointId } from "../../packs/cloudflare/manifest.js";
import { slackChannelTopicWriteEndpointId } from "../../packs/slack-topic/manifest.js";
import { reconcileGitHubIssueLabels } from "../../packs/github/reconcile.js";
import { reconcileCloudflareDnsRecordSet } from "../../packs/cloudflare/reconcile.js";
import { reconcileSlackChannelTopic } from "../../packs/slack-topic/reconcile.js";
import type { PackReconciliationResult } from "../../packs/types.js";
import { executeJsonHttpsRead, type JsonHttpsEndpoint, type JsonHttpsSecretResolver } from "../drivers/json-https.js";
import { createJsonHttpsDispatchAdapter } from "./json-https-connector.js";
import { createSecretResolver } from "./secret-resolver.js";

export interface FounderReconciliationReadRequest {
  readonly endpointId: string;
  readonly path: string;
  readonly query: string;
  readonly headers: Readonly<Record<string, string>>;
}
export interface FounderReconciliationReadResponse { readonly status: number; readonly body: unknown }

export function createFounderJsonHttpsEndpoints(config: CertificationOperatorConfigV1): readonly JsonHttpsEndpoint[] {
  if (!config?.providers) throw new TypeError("founder HTTPS endpoint config is invalid");
  const github = config.providers.github, cloudflare = config.providers.cloudflare, slack = config.providers.slack;
  const make = (endpointId: string, baseUrl: string, allowedMethods: JsonHttpsEndpoint["allowedMethods"], allowedPathPrefixes: readonly string[], secretRef: string, accountIdentity: string): JsonHttpsEndpoint => Object.freeze({ endpointId, baseUrl, allowedMethods: Object.freeze([...allowedMethods]), allowedPathPrefixes: Object.freeze([...allowedPathPrefixes]), secretRef, accountIdentity });
  return Object.freeze([
    make(githubIssueLabelsWriteEndpointId, github.apiBaseUrl, ["PUT"], [`/repos/${github.accountId}/${github.repository}/issues/${github.issueNumber}/labels`], github.credentialRef, github.accountId),
    make("github.issue.labels.readback", github.apiBaseUrl, ["GET"], [`/repos/${github.accountId}/${github.repository}/issues/${github.issueNumber}/labels`], github.credentialRef, github.accountId),
    make(cloudflareDnsRecordSetWriteEndpointId, cloudflare.apiBaseUrl, ["PUT"], [`/client/v4/zones/${cloudflare.zoneId}/dns_records/${cloudflare.recordId}`], cloudflare.credentialRef, cloudflare.accountId),
    make("cloudflare.dns.record.readback", cloudflare.apiBaseUrl, ["GET"], [`/client/v4/zones/${cloudflare.zoneId}/dns_records/${cloudflare.recordId}`], cloudflare.credentialRef, cloudflare.accountId),
    make(slackChannelTopicWriteEndpointId, slack.apiBaseUrl, ["POST"], ["/api/conversations.setTopic"], slack.credentialRef, slack.accountId),
    make("slack.conversations.info.readback", slack.apiBaseUrl, ["GET"], ["/api/conversations.info"], slack.credentialRef, slack.accountId),
  ]);
}

export function createFounderJsonHttpsDispatchAdapter(input: Readonly<{ config: CertificationOperatorConfigV1; secrets?: JsonHttpsSecretResolver; timeoutMs?: number; maxResponseBytes?: number }>): DispatchAdapter {
  const endpoints = createFounderJsonHttpsEndpoints(input.config);
  const endpointMap = new Map(endpoints.map(endpoint => [endpoint.endpointId, endpoint]));
  const secrets = input.secrets ?? createSecretResolver();
  const dispatch = createJsonHttpsDispatchAdapter({ endpoints: endpoints.filter(endpoint => !endpoint.endpointId.endsWith(".readback")), secrets, timeoutMs: input.timeoutMs, maxResponseBytes: input.maxResponseBytes });
  return createFounderReconciliationDispatchAdapter({
    config: input.config,
    dispatch,
    async read(read) {
      const endpoint = endpointMap.get(read.endpointId);
      if (!endpoint) throw new TypeError("founder readback endpoint is not configured");
      const response = await executeJsonHttpsRead({ endpointId: read.endpointId, path: read.path, query: read.query, headers: read.headers }, endpoint, secrets, { timeoutMs: input.timeoutMs, maxResponseBytes: input.maxResponseBytes });
      let body: unknown = {};
      try { body = JSON.parse(response.body.toString("utf8")); } catch { /* reconciler reports unavailable */ }
      return Object.freeze({ status: response.status, body });
    },
  });
}

export function createFounderReconciliationDispatchAdapter(input: Readonly<{
  config: CertificationOperatorConfigV1;
  dispatch: DispatchAdapter;
  read: (input: FounderReconciliationReadRequest) => Promise<FounderReconciliationReadResponse>;
}>): DispatchAdapter {
  if (!input?.config?.providers || !input.dispatch || typeof input.dispatch.dispatch !== "function" || typeof input.read !== "function") throw new TypeError("founder reconciliation adapter configuration is invalid");
  return Object.freeze({
    dispatch: (state: DispatchRequestState) => input.dispatch.dispatch(state),
    async reconcile(state: DispatchRequestState, outcome: DispatchOutcome): Promise<DispatchOutcome> {
      try {
        const effect = transportEffect(state.effect);
        const result = await reconcileEffect(effect, input.config, input.read);
        const kind = result.status === "matched" ? "acknowledged" : result.status === "unavailable" ? "ambiguous" : "definitive-failure";
        return Object.freeze({ ...outcome, kind, resultDigest: authorityDigest({ v: "reelier.founder-reconciliation/v1", reservationId: state.reservation.reservationId, effectDigest: state.effectDigest, status: result.status, recipeId: result.recipeId, projectionDigest: result.projectionDigest, priorResultDigest: outcome.resultDigest }), reconciliationStatus: result.status, normalizedProjectionDigest: result.projectionDigest });
      } catch {
        return Object.freeze({ ...outcome, kind: "ambiguous" as const, reconciliationStatus: "unavailable" as const, normalizedProjectionDigest: null });
      }
    },
  });
}

async function reconcileEffect(effect: TransportEffect, config: CertificationOperatorConfigV1, read: (input: FounderReconciliationReadRequest) => Promise<FounderReconciliationReadResponse>): Promise<PackReconciliationResult> {
  const body = decodeBody(effect.bodyBase64);
  if (effect.endpointId === githubIssueLabelsWriteEndpointId) {
    const provider = config.providers.github;
    const response = await read({ endpointId: "github.issue.labels.readback", path: `/repos/${provider.accountId}/${provider.repository}/issues/${provider.issueNumber}/labels`, query: "per_page=100", headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "reelier-certification" } });
    const labels = arrayOfStrings(body.labels, "GitHub desired labels");
    return reconcileGitHubIssueLabels({ expected: { owner: provider.accountId, repo: provider.repository, issueNumber: provider.issueNumber, issueState: "open", labels }, response });
  }
  if (effect.endpointId === cloudflareDnsRecordSetWriteEndpointId) {
    const provider = config.providers.cloudflare;
    const response = await read({ endpointId: "cloudflare.dns.record.readback", path: `/client/v4/zones/${provider.zoneId}/dns_records/${provider.recordId}`, query: "", headers: { Accept: "application/json" } });
    const type = body.type;
    if (type !== "A" && type !== "AAAA" && type !== "CNAME" && type !== "TXT" || typeof body.name !== "string" || typeof body.content !== "string" || !Number.isSafeInteger(body.ttl) || typeof body.proxied !== "boolean") throw new TypeError("Cloudflare desired state is invalid");
    const responseBody = response.body && typeof response.body === "object" && !Array.isArray(response.body) ? response.body as Record<string, unknown> : {};
    const rawRecord = responseBody.result && typeof responseBody.result === "object" && !Array.isArray(responseBody.result) ? responseBody.result as Record<string, unknown> : responseBody;
    const augmented = { ...rawRecord, accountId: provider.accountId, zoneId: provider.zoneId };
    return reconcileCloudflareDnsRecordSet({ expected: { accountId: provider.accountId, zoneId: provider.zoneId, recordId: provider.recordId, name: body.name, type, content: "", ttl: 1, proxied: false }, desired: { content: body.content, ttl: body.ttl as number, proxied: body.proxied }, response: { status: response.status, body: augmented } });
  }
  if (effect.endpointId === slackChannelTopicWriteEndpointId) {
    const provider = config.providers.slack;
    if (body.channel !== provider.channelId || typeof body.topic !== "string") throw new TypeError("Slack desired state is invalid");
    const response = await read({ endpointId: "slack.conversations.info.readback", path: "/api/conversations.info", query: `channel=${encodeURIComponent(provider.channelId)}`, headers: { Accept: "application/json" } });
    return reconcileSlackChannelTopic({ expected: { teamId: provider.accountId, channelId: provider.channelId, channelName: "", isPrivate: true, topic: body.topic }, response });
  }
  return Object.freeze({ status: "unavailable", recipeId: effect.reconciliation.recipeId, projectionDigest: null, reasonCode: "unsupported-founder-reconciliation" });
}

function transportEffect(value: unknown): TransportEffect { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("transport effect is invalid"); const raw = value as TransportEffect; if (raw.v !== "reelier.transport-effect/v1" || typeof raw.endpointId !== "string" || typeof raw.bodyBase64 !== "string" || !raw.reconciliation) throw new TypeError("transport effect is invalid"); return raw; }
function decodeBody(value: string): Record<string, unknown> { let parsed: unknown; try { parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8")); } catch { throw new TypeError("transport effect body is invalid"); } if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("transport effect body is invalid"); return parsed as Record<string, unknown>; }
function arrayOfStrings(value: unknown, label: string): readonly string[] { if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new TypeError(`${label} is invalid`); return Object.freeze([...(value as string[])]); }
