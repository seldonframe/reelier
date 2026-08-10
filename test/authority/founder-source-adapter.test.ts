import test from "node:test";
import assert from "node:assert/strict";
import { createFounderCertificationSourceAdapter } from "../../src/authority/host/founder-source-adapter.js";
import type { CertificationOperatorConfigV1 } from "../../src/authority/host/certification-config.js";

const config = {
  providers: {
    github: { apiBaseUrl: "https://api.github.com", accountId: "owner", credentialRef: "env:GITHUB", cleanupRef: "cleanup", repository: "repo", issueNumber: 7 },
    cloudflare: { apiBaseUrl: "https://api.cloudflare.com", accountId: "account", credentialRef: "env:CLOUDFLARE", cleanupRef: "cleanup", zoneId: "zone", recordId: "record", recordName: "certification.example.com", tokenName: "token" },
    slack: { apiBaseUrl: "https://slack.com", accountId: "T123", credentialRef: "env:SLACK", cleanupRef: "cleanup", channelId: "C123" },
  },
} as unknown as CertificationOperatorConfigV1;

const plans = [
  { index: 0, planDigest: "sha256:" + "a".repeat(64), endpointId: "github.issue.get", opaqueHandle: "github_issue" },
  { index: 1, planDigest: "sha256:" + "b".repeat(64), endpointId: "cloudflare.dns.record.get", opaqueHandle: "cloudflare_record" },
  { index: 2, planDigest: "sha256:" + "c".repeat(64), endpointId: "slack.conversations.info", opaqueHandle: "slack_channel" },
] as const;

test("founder source adapter performs exact account-bound provider reads and normalizes pack input", async () => {
  const requests: Array<{ endpointId: string; path: string; query: string }> = [];
  const adapter = createFounderCertificationSourceAdapter({
    config,
    handles: { githubIssue: "github_issue", cloudflareRecord: "cloudflare_record", slackChannel: "slack_channel" },
    async request(input) {
      requests.push({ endpointId: input.endpoint.endpointId, path: input.read.path, query: input.read.query ?? "" });
      if (input.endpoint.endpointId === "github.issue.get") return Buffer.from(JSON.stringify({ state: "open", labels: [{ name: "bug" }] }));
      if (input.endpoint.endpointId === "cloudflare.dns.record.get") return Buffer.from(JSON.stringify({ success: true, result: { id: "record", name: "certification.example.com", type: "TXT", content: "before", ttl: 60, proxied: false } }));
      return Buffer.from(JSON.stringify({ ok: true, channel: { id: "C123", name: "private-test", is_private: true, topic: { value: "before" } } }));
    },
  });
  const result = await adapter.execute(plans);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(requests, [
    { endpointId: "github.issue.get", path: "/repos/owner/repo/issues/7", query: "" },
    { endpointId: "cloudflare.dns.record.get", path: "/client/v4/zones/zone/dns_records/record", query: "" },
    { endpointId: "slack.conversations.info", path: "/api/conversations.info", query: "channel=C123" },
  ]);
  assert.deepEqual(JSON.parse(Buffer.from(result.observations[0].rawBytes).toString()), { issueNumber: 7, issueState: "open", labels: ["bug"], owner: "owner", repo: "repo" });
  assert.deepEqual(JSON.parse(Buffer.from(result.observations[1].rawBytes).toString()), { accountId: "account", content: "before", id: "record", name: "certification.example.com", proxied: false, ttl: 60, type: "TXT", zoneId: "zone" });
  assert.deepEqual(JSON.parse(Buffer.from(result.observations[2].rawBytes).toString()), { channel: { id: "C123", is_private: true, name: "private-test", topic: { value: "before" } }, teamId: "T123" });
});

test("founder source adapter refuses an unbound handle before provider access", async () => {
  let requests = 0;
  const adapter = createFounderCertificationSourceAdapter({ config, handles: { githubIssue: "github_issue", cloudflareRecord: "cloudflare_record", slackChannel: "slack_channel" }, async request() { requests++; return Buffer.from("{}"); } });
  assert.deepEqual(await adapter.execute([{ ...plans[0], opaqueHandle: "attacker" }]), { ok: false, reason: "refused" });
  assert.equal(requests, 0);
});

