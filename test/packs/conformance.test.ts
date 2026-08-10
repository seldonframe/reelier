import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runFirstPartyPackConformance } from "../../src/packs/conformance.js";
import { createGitHubIssueLabelsSourceResolver } from "../../src/packs/github/source.js";
import { createSlackChannelTopicSourceResolver } from "../../src/packs/slack-topic/source.js";
import { planSourceReads, materializeSourceBundle, createSourceRegistry } from "../../src/authority/source.js";
import { githubIssueLabelsDefinitionDigest, githubIssueLabelsProjectionSchemaId, githubIssueLabelsResolverId } from "../../src/packs/github/manifest.js";
import { slackChannelTopicDefinitionDigest, slackChannelTopicProjectionSchemaId, slackChannelTopicResolverId } from "../../src/packs/slack-topic/manifest.js";
import { assertStaticFirstPartySourcesConform } from "../../src/authority/pack.js";
import { createVercelDeploymentReleaseSourceResolver } from "../../src/packs/vercel/source.js";
import { vercelDeploymentReleaseDefinitionDigest, vercelDeploymentReleaseProjectionSchemaId, vercelDeploymentReleaseResolverId } from "../../src/packs/vercel/manifest.js";
import { createCloudflareDnsRecordSourceResolver } from "../../src/packs/cloudflare/source.js";
import { cloudflareDnsRecordSetDefinitionDigest, cloudflareDnsRecordSetProjectionSchemaId, cloudflareDnsRecordSetResolverId } from "../../src/packs/cloudflare/manifest.js";

test("all reviewed first-party packs pass the shared closed conformance corpus", () => {
  const report = runFirstPartyPackConformance();
  assert.deepEqual(report.aliases, ["cloudflare_dns_record_set_v1", "github_issue_labels_set_v1", "gmail_reply_send_v1", "gmail_thread_labels_set_v1", "slack_channel_topic_set_v1", "stripe_refund_issue_v1", "vercel_deployment_release_v1"]);
  assert.equal(report.passed, report.checks);
  assert.ok(report.checks >= 12);
});

test("GitHub and Slack source resolvers produce grounded deterministic projections", () => {
  const now = new Date("2026-01-15T00:00:30.000Z");
  const gh = createGitHubIssueLabelsSourceResolver("tenant_1");
  const ghRegistry = createSourceRegistry([gh]);
  const ghPlans = planSourceReads(ghRegistry, { tenant: "tenant_1", resolverId: githubIssueLabelsResolverId, definitionDigest: githubIssueLabelsDefinitionDigest, sourceRefs: { issue: "issue_1" }, allowedReadEndpointIds: ["github.issue.get"] });
  const ghSource = materializeSourceBundle(ghRegistry, { tenant: "tenant_1", definitionDigest: githubIssueLabelsDefinitionDigest, resolverId: githubIssueLabelsResolverId, projectionSchemaId: githubIssueLabelsProjectionSchemaId, sourceRefs: { issue: "issue_1" }, allowedReadEndpointIds: ["github.issue.get"], authorizedProjectionPointers: ["/owner", "/repo", "/issueNumber", "/issueState", "/labels"], requiredGroundedPointers: ["/owner", "/repo", "/issueNumber", "/issueState", "/labels"], maxFreshnessSeconds: 60, observedAt: now, validationNow: now, plans: ghPlans, observations: [{ planDigest: ghPlans[0].planDigest, rawBytes: Buffer.from(JSON.stringify({ owner: "octo", repo: "demo", number: 1, state: "open", labels: [{ name: "bug" }] })) }] });
  assert.deepEqual(ghSource.bundle.projection, { owner: "octo", repo: "demo", issueNumber: 1, issueState: "open", labels: ["bug"] });

  const slack = createSlackChannelTopicSourceResolver("tenant_1");
  const slackRegistry = createSourceRegistry([slack]);
  const slackPlans = planSourceReads(slackRegistry, { tenant: "tenant_1", resolverId: slackChannelTopicResolverId, definitionDigest: slackChannelTopicDefinitionDigest, sourceRefs: { channel: "channel_1" }, allowedReadEndpointIds: ["slack.conversations.info"] });
  const slackSource = materializeSourceBundle(slackRegistry, { tenant: "tenant_1", definitionDigest: slackChannelTopicDefinitionDigest, resolverId: slackChannelTopicResolverId, projectionSchemaId: slackChannelTopicProjectionSchemaId, sourceRefs: { channel: "channel_1" }, allowedReadEndpointIds: ["slack.conversations.info"], authorizedProjectionPointers: ["/teamId", "/channelId", "/channelName", "/isPrivate", "/topic"], requiredGroundedPointers: ["/teamId", "/channelId", "/channelName", "/isPrivate", "/topic"], maxFreshnessSeconds: 60, observedAt: now, validationNow: now, plans: slackPlans, observations: [{ planDigest: slackPlans[0].planDigest, rawBytes: Buffer.from(JSON.stringify({ team_id: "T1", channel: { id: "C1", name: "private-test", is_private: true, topic: { value: "old" } } })) }] });
  assert.deepEqual(slackSource.bundle.projection, { teamId: "T1", channelId: "C1", channelName: "private-test", isPrivate: true, topic: "old" });

  const vercel = createVercelDeploymentReleaseSourceResolver("tenant_1");
  const vercelRegistry = createSourceRegistry([vercel]);
  const vercelPlans = planSourceReads(vercelRegistry, { tenant: "tenant_1", resolverId: vercelDeploymentReleaseResolverId, definitionDigest: vercelDeploymentReleaseDefinitionDigest, sourceRefs: { deployment: "deployment_1" }, allowedReadEndpointIds: ["vercel.deployment.get"] });
  const vercelSource = materializeSourceBundle(vercelRegistry, { tenant: "tenant_1", definitionDigest: vercelDeploymentReleaseDefinitionDigest, resolverId: vercelDeploymentReleaseResolverId, projectionSchemaId: vercelDeploymentReleaseProjectionSchemaId, sourceRefs: { deployment: "deployment_1" }, allowedReadEndpointIds: ["vercel.deployment.get"], authorizedProjectionPointers: ["/teamId", "/projectId", "/deploymentId", "/deploymentUrl", "/commitSha", "/checks", "/domains", "/currentProductionDeploymentId"], requiredGroundedPointers: ["/teamId", "/projectId", "/deploymentId", "/deploymentUrl", "/commitSha", "/checks", "/domains", "/currentProductionDeploymentId"], maxFreshnessSeconds: 60, observedAt: now, validationNow: now, plans: vercelPlans, observations: [{ planDigest: vercelPlans[0].planDigest, rawBytes: Buffer.from(JSON.stringify({ teamId: "team_demo", projectId: "prj_demo", id: "dpl_preview", url: "https://preview-demo.vercel.app", commitSha: "0123456789abcdef0123456789abcdef01234567", checks: [{ name: "tests", status: "passed" }], domains: ["app.example.com"], currentProductionDeploymentId: "dpl_previous" })) }] });
  assert.equal((vercelSource.bundle.projection as Record<string, unknown>).deploymentId, "dpl_preview");

  const cloudflare = createCloudflareDnsRecordSourceResolver("tenant_1");
  const cloudflareRegistry = createSourceRegistry([cloudflare]);
  const cloudflarePlans = planSourceReads(cloudflareRegistry, { tenant: "tenant_1", resolverId: cloudflareDnsRecordSetResolverId, definitionDigest: cloudflareDnsRecordSetDefinitionDigest, sourceRefs: { record: "record_1" }, allowedReadEndpointIds: ["cloudflare.dns.record.get"] });
  const cloudflareSource = materializeSourceBundle(cloudflareRegistry, { tenant: "tenant_1", definitionDigest: cloudflareDnsRecordSetDefinitionDigest, resolverId: cloudflareDnsRecordSetResolverId, projectionSchemaId: cloudflareDnsRecordSetProjectionSchemaId, sourceRefs: { record: "record_1" }, allowedReadEndpointIds: ["cloudflare.dns.record.get"], authorizedProjectionPointers: ["/accountId", "/zoneId", "/recordId", "/name", "/type", "/content", "/ttl", "/proxied"], requiredGroundedPointers: ["/accountId", "/zoneId", "/recordId", "/name", "/type", "/content", "/ttl", "/proxied"], maxFreshnessSeconds: 60, observedAt: now, validationNow: now, plans: cloudflarePlans, observations: [{ planDigest: cloudflarePlans[0].planDigest, rawBytes: Buffer.from(JSON.stringify({ accountId: "acct_demo", zoneId: "zone_demo", id: "record_demo", name: "app.example.com", type: "A", content: "203.0.113.10", ttl: 300, proxied: false })) }] });
  assert.equal((cloudflareSource.bundle.projection as Record<string, unknown>).recordId, "record_demo");
});

test("first-party pack sources contain no ambient I/O, secrets, or runtime module loading", () => {
  const files = ["github/manifest.ts", "github/source.ts", "github/compile.ts", "github/reconcile.ts", "slack-topic/manifest.ts", "slack-topic/source.ts", "slack-topic/compile.ts", "slack-topic/reconcile.ts", "gmail/index.ts", "stripe/index.ts", "vercel/manifest.ts", "vercel/source.ts", "vercel/compile.ts", "vercel/reconcile.ts", "vercel/index.ts", "cloudflare/manifest.ts", "cloudflare/source.ts", "cloudflare/compile.ts", "cloudflare/reconcile.ts", "cloudflare/index.ts"];
  assert.doesNotThrow(() => assertStaticFirstPartySourcesConform(files.map(file => ({ file: `src/packs/${file}`, source: readFileSync(`src/packs/${file}`, "utf8") }))));
});
