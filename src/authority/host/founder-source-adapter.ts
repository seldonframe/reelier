import { authorityCanonicalBytes } from "../wire.js";
import { executeJsonHttpsRead, type JsonHttpsEndpoint, type JsonHttpsRead, type JsonHttpsSecretResolver } from "../drivers/json-https.js";
import { githubIssueLabelsReadEndpointId } from "../../packs/github/manifest.js";
import { cloudflareDnsRecordSetReadEndpointId } from "../../packs/cloudflare/manifest.js";
import { slackChannelTopicReadEndpointId } from "../../packs/slack-topic/manifest.js";
import type { CertificationOperatorConfigV1 } from "./certification-config.js";
import { createBoundSourceReadAdapter, type SourceReadAdapter } from "./source-read-adapter.js";
import { createSecretResolver } from "./secret-resolver.js";

const OPAQUE = /^(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*[\\/])[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

export interface FounderCertificationSourceHandles {
  readonly githubIssue: string;
  readonly cloudflareRecord: string;
  readonly slackChannel: string;
}

export interface FounderCertificationSourceRequest {
  readonly endpoint: JsonHttpsEndpoint;
  readonly read: JsonHttpsRead;
}

export function createFounderCertificationSourceAdapter(input: Readonly<{
  config: CertificationOperatorConfigV1;
  handles: FounderCertificationSourceHandles;
  secrets?: JsonHttpsSecretResolver;
  request?: (input: FounderCertificationSourceRequest) => Promise<Uint8Array>;
}>): SourceReadAdapter {
  if (!input?.config?.providers || !input.handles) throw new TypeError("founder source adapter configuration is invalid");
  for (const handle of Object.values(input.handles)) if (!OPAQUE.test(handle)) throw new TypeError("founder source handle must be opaque");
  const github = input.config.providers.github;
  const cloudflare = input.config.providers.cloudflare;
  const slack = input.config.providers.slack;
  const egressProxy = Object.freeze({ baseUrl: input.config.fly.egressProxyBaseUrl, bearerRef: input.config.fly.egressProxyBearerRef });
  const endpoints = new Map<string, JsonHttpsEndpoint>([
    [githubIssueLabelsReadEndpointId, Object.freeze({ endpointId: githubIssueLabelsReadEndpointId, baseUrl: github.apiBaseUrl, allowedMethods: ["GET"] as const, allowedPathPrefixes: [`/repos/${github.accountId}/${github.repository}/issues/${github.issueNumber}`], secretRef: github.credentialRef, accountIdentity: github.accountId, egressProxy })],
    [cloudflareDnsRecordSetReadEndpointId, Object.freeze({ endpointId: cloudflareDnsRecordSetReadEndpointId, baseUrl: cloudflare.apiBaseUrl, allowedMethods: ["GET"] as const, allowedPathPrefixes: [`/client/v4/zones/${cloudflare.zoneId}/dns_records/${cloudflare.recordId}`], secretRef: cloudflare.credentialRef, accountIdentity: cloudflare.accountId, egressProxy })],
    [slackChannelTopicReadEndpointId, Object.freeze({ endpointId: slackChannelTopicReadEndpointId, baseUrl: slack.apiBaseUrl, allowedMethods: ["GET"] as const, allowedPathPrefixes: ["/api/conversations.info"], secretRef: slack.credentialRef, accountIdentity: slack.accountId, egressProxy })],
  ]);
  const secrets = input.secrets ?? createSecretResolver();
  const request = input.request ?? (async ({ endpoint, read }: FounderCertificationSourceRequest) => {
    const response = await executeJsonHttpsRead(read, endpoint, secrets);
    if (response.status < 200 || response.status >= 300) throw new Error("provider source read failed");
    return Uint8Array.from(response.body);
  });
  return createBoundSourceReadAdapter({
    bindings: [
      { opaqueHandle: input.handles.githubIssue, endpointId: githubIssueLabelsReadEndpointId, accountIdentity: github.accountId, path: `/repos/${github.accountId}/${github.repository}/issues/${github.issueNumber}`, query: "", headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "reelier-certification" } },
      { opaqueHandle: input.handles.cloudflareRecord, endpointId: cloudflareDnsRecordSetReadEndpointId, accountIdentity: cloudflare.accountId, path: `/client/v4/zones/${cloudflare.zoneId}/dns_records/${cloudflare.recordId}`, query: "", headers: { Accept: "application/json" } },
      { opaqueHandle: input.handles.slackChannel, endpointId: slackChannelTopicReadEndpointId, accountIdentity: slack.accountId, path: "/api/conversations.info", query: `channel=${encodeURIComponent(slack.channelId)}`, headers: { Accept: "application/json" } },
    ],
    async read(binding) {
      const endpoint = endpoints.get(binding.endpointId);
      if (!endpoint || endpoint.accountIdentity !== binding.accountIdentity) throw new TypeError("founder source endpoint account mismatch");
      const raw = await request({ endpoint, read: { endpointId: binding.endpointId, path: binding.path, query: binding.query, headers: binding.headers } });
      if (binding.endpointId === githubIssueLabelsReadEndpointId) return normalizeGitHub(raw, github.accountId, github.repository, github.issueNumber);
      if (binding.endpointId === cloudflareDnsRecordSetReadEndpointId) return normalizeCloudflare(raw, cloudflare.accountId, cloudflare.zoneId);
      if (binding.endpointId === slackChannelTopicReadEndpointId) return normalizeSlack(raw, slack.accountId);
      throw new TypeError("unsupported founder source endpoint");
    },
  });
}

function normalizeGitHub(bytes: Uint8Array, owner: string, repo: string, issueNumber: number): Uint8Array {
  const issue = objectJson(bytes, "GitHub issue");
  const state = issue.state;
  if (state !== "open" && state !== "closed") throw new TypeError("GitHub issue state is invalid");
  if (!Array.isArray(issue.labels) || issue.labels.length > 100) throw new TypeError("GitHub issue labels are invalid");
  const labels = issue.labels.map(item => typeof item === "string" ? item : object(item, "GitHub label").name);
  if (labels.some(item => typeof item !== "string" || item.length === 0 || item.length > 100) || new Set(labels as string[]).size !== labels.length) throw new TypeError("GitHub issue labels are invalid");
  return authorityCanonicalBytes({ owner, repo, issueNumber, issueState: state, labels: Object.freeze((labels as string[]).sort()) });
}

function normalizeCloudflare(bytes: Uint8Array, accountId: string, zoneId: string): Uint8Array {
  const root = objectJson(bytes, "Cloudflare DNS record");
  if (root.success !== true) throw new TypeError("Cloudflare DNS response is unsuccessful");
  const record = object(root.result, "Cloudflare DNS result");
  return authorityCanonicalBytes({ accountId, zoneId, id: record.id, name: record.name, type: record.type, content: record.content, ttl: record.ttl, proxied: record.proxied === true });
}

function normalizeSlack(bytes: Uint8Array, teamId: string): Uint8Array {
  const root = objectJson(bytes, "Slack channel");
  if (root.ok !== true) throw new TypeError("Slack channel response is unsuccessful");
  const channel = object(root.channel, "Slack channel result");
  const topic = object(channel.topic, "Slack channel topic");
  return authorityCanonicalBytes({ teamId, channel: { id: channel.id, name: channel.name, is_private: channel.is_private, topic: { value: topic.value } } });
}

function objectJson(bytes: Uint8Array, label: string): Record<string, unknown> { let parsed: unknown; try { parsed = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw new TypeError(`${label} response is not JSON`); } return object(parsed, label); }
function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} response is invalid`); return value as Record<string, unknown>; }
