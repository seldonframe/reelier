import test from "node:test";
import assert from "node:assert/strict";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import { createFounderJsonHttpsEndpoints, createFounderReconciliationDispatchAdapter } from "../../src/authority/host/founder-dispatch-adapter.js";
import type { DispatchRequestState } from "../../src/authority/host/dispatch.js";

function state(effect: Record<string, unknown>): DispatchRequestState {
  return { reservation: { reservationId: "reservation_1", state: "dispatched", intent: { effectDigest: authorityDigest(effect), effectCanonicalBase64: Buffer.from(JSON.stringify(effect)).toString("base64") } }, effect, effectCanonicalBase64: Buffer.from(JSON.stringify(effect)).toString("base64"), effectDigest: authorityDigest(effect) } as DispatchRequestState;
}

const config = {
  providers: {
    github: { accountId: "owner", repository: "repo", issueNumber: 7 },
    cloudflare: { accountId: "account", zoneId: "zone", recordId: "record" },
    slack: { accountId: "T123", channelId: "C123" },
  },
} as never;

test("founder dispatch reconciles GitHub state after an ambiguous write without resending", async () => {
  let dispatches = 0;
  const adapter = createFounderReconciliationDispatchAdapter({
    config,
    dispatch: { async dispatch() { dispatches++; return { kind: "ambiguous", resultDigest: "sha256:" + "a".repeat(64) }; } },
    async read(input) { assert.equal(input.path, "/repos/owner/repo/issues/7/labels"); return { status: 200, body: [{ name: "bug" }] }; },
  });
  const effect = { v: "reelier.transport-effect/v1", endpointId: "github.issue.labels.replace", method: "PUT", path: "/repos/owner/repo/issues/7/labels", query: "", headers: { "Content-Type": "application/json" }, bodyBase64: authorityCanonicalBytes({ labels: ["bug"] }).toString("base64"), riskClass: "github_issue_labels", idempotency: "native", preconditions: [], reconciliation: { recipeId: "github_issue_labels_readback_v1" } };
  const dispatched = await adapter.dispatch(state(effect));
  const reconciled = await adapter.reconcile!(state(effect), dispatched);
  assert.equal(dispatches, 1);
  assert.equal(reconciled.reconciliationStatus, "matched");
  assert.equal(reconciled.kind, "acknowledged");
});

test("founder dispatch distinguishes Cloudflare conflict and Slack not-applied", async () => {
  const base = { async dispatch() { return { kind: "acknowledged" as const, resultDigest: "sha256:" + "a".repeat(64) }; } };
  const cloudflare = createFounderReconciliationDispatchAdapter({ config, dispatch: base, async read() { return { status: 200, body: { result: { id: "record", accountId: "account", zoneId: "zone", name: "certification.example.com", type: "TXT", content: "other", ttl: 60, proxied: false } } }; } });
  const cfEffect = { v: "reelier.transport-effect/v1", endpointId: "cloudflare.dns.record.set", method: "PUT", path: "/client/v4/zones/zone/dns_records/record", query: "", headers: { "Content-Type": "application/json" }, bodyBase64: authorityCanonicalBytes({ type: "TXT", name: "certification.example.com", content: "desired", ttl: 60, proxied: false }).toString("base64"), riskClass: "cloudflare_dns_record_set", idempotency: "native", preconditions: [], reconciliation: { recipeId: "cloudflare_dns_record_set_readback_v1" } };
  const cf = await cloudflare.reconcile!(state(cfEffect), await cloudflare.dispatch(state(cfEffect)));
  assert.equal(cf.reconciliationStatus, "conflict");
  assert.equal(cf.kind, "definitive-failure");

  const slack = createFounderReconciliationDispatchAdapter({ config, dispatch: base, async read() { return { status: 404, body: {} }; } });
  const slackEffect = { v: "reelier.transport-effect/v1", endpointId: "slack.conversations.setTopic", method: "POST", path: "/api/conversations.setTopic", query: "", headers: { "Content-Type": "application/json" }, bodyBase64: authorityCanonicalBytes({ channel: "C123", topic: "desired" }).toString("base64"), riskClass: "slack_channel_topic", idempotency: "reconcile-only", preconditions: [], reconciliation: { recipeId: "slack_channel_topic_readback_v1" } };
  const missing = await slack.reconcile!(state(slackEffect), await slack.dispatch(state(slackEffect)));
  assert.equal(missing.reconciliationStatus, "not-applied");
  assert.equal(missing.kind, "definitive-failure");
});

test("founder HTTPS endpoint set pins exact accounts, methods, and resource paths", () => {
  const full = {
    providers: {
      github: { apiBaseUrl: "https://api.github.com", accountId: "owner", credentialRef: "env:GITHUB", repository: "repo", issueNumber: 7 },
      cloudflare: { apiBaseUrl: "https://api.cloudflare.com", accountId: "account", credentialRef: "env:CLOUDFLARE", zoneId: "zone", recordId: "record" },
      slack: { apiBaseUrl: "https://slack.com", accountId: "T123", credentialRef: "env:SLACK", channelId: "C123" },
    },
  } as never;
  const endpoints = createFounderJsonHttpsEndpoints(full);
  assert.equal(endpoints.length, 6);
  assert.deepEqual(endpoints.find(item => item.endpointId === "github.issue.labels.replace"), { endpointId: "github.issue.labels.replace", baseUrl: "https://api.github.com", allowedMethods: ["PUT"], allowedPathPrefixes: ["/repos/owner/repo/issues/7/labels"], secretRef: "env:GITHUB", accountIdentity: "owner" });
  assert.deepEqual(endpoints.find(item => item.endpointId === "slack.conversations.info.readback")?.allowedMethods, ["GET"]);
});
