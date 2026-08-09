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

test("all reviewed first-party packs pass the shared closed conformance corpus", () => {
  const report = runFirstPartyPackConformance();
  assert.deepEqual(report.aliases, ["github_issue_labels_set_v1", "gmail_reply_send_v1", "gmail_thread_labels_set_v1", "slack_channel_topic_set_v1", "stripe_refund_issue_v1"]);
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
});

test("first-party pack sources contain no ambient I/O, secrets, or runtime module loading", () => {
  const files = ["github/manifest.ts", "github/source.ts", "github/compile.ts", "github/reconcile.ts", "slack-topic/manifest.ts", "slack-topic/source.ts", "slack-topic/compile.ts", "slack-topic/reconcile.ts", "gmail/index.ts", "stripe/index.ts"];
  assert.doesNotThrow(() => assertStaticFirstPartySourcesConform(files.map(file => ({ file: `src/packs/${file}`, source: readFileSync(`src/packs/${file}`, "utf8") }))));
});
