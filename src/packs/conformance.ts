import { createStaticPackRegistry } from "../authority/pack.js";
import { authorityCanonicalBytes, parseAuthorityWire } from "../authority/wire.js";
import { firstPartyPacks } from "./index.js";
import { githubIssueLabelsAlias } from "./github/manifest.js";
import { githubIssueLabelsDefinition, parseGitHubIssueLabelsPolicy, validateGitHubIssueLabelsChoices } from "./github/compile.js";
import { reconcileGitHubIssueLabels } from "./github/reconcile.js";
import { slackChannelTopicAlias } from "./slack-topic/manifest.js";
import { parseSlackChannelTopicPolicy, slackChannelTopicDefinition, validateSlackChannelTopicChoices } from "./slack-topic/compile.js";
import { reconcileSlackChannelTopic } from "./slack-topic/reconcile.js";

export interface FirstPartyConformanceReport {
  readonly aliases: readonly string[];
  readonly checks: number;
  readonly passed: number;
  readonly caseIds: readonly string[];
}

/** Runs the mandatory common corpus. This is intentionally offline and provider-neutral. */
export function runFirstPartyPackConformance(): FirstPartyConformanceReport {
  const expectedAliases = [githubIssueLabelsAlias, slackChannelTopicAlias];
  const actualAliases = firstPartyPacks.map(pack => pack.definition.alias).sort(compareText);
  if (actualAliases.join("\0") !== expectedAliases.slice().sort(compareText).join("\0")) throw new TypeError("first-party conformance requires exactly the two v1 packs");
  createStaticPackRegistry(firstPartyPacks.map(pack => pack.definition));
  let checks = 0;
  const caseIds: string[] = [];
  const check = (ok: boolean, message: string) => { checks += 1; if (!ok) throw new TypeError(`pack conformance failed: ${message}`); };

  check(Object.keys(githubIssueLabelsDefinition).length === 14, "GitHub definition is closed");
  check(Object.keys(slackChannelTopicDefinition).length === 14, "Slack definition is closed");
  check(throws(() => validateGitHubIssueLabelsChoices({ desiredLabels: ["x"] })), "GitHub choices are empty");
  check(throws(() => validateSlackChannelTopicChoices({ topic: "x" })), "Slack choices are empty");
  check(throws(() => parseGitHubIssueLabelsPolicy({ desiredLabels: ["x"], unexpected: true })), "GitHub policy is closed");
  check(throws(() => githubIssueLabelsDefinition.compile({ contract: {} as never, source: { projection: { owner: "octo", repo: "demo", issueNumber: 1, issueState: "closed", labels: ["bug"] } } as never, choices: {}, policy: parseGitHubIssueLabelsPolicy({ desiredLabels: ["x"] }), now: new Date(0), connectorAccount: { connectorId: "github", accountId: "installation" } })), "GitHub disallowed state refused");
  check(throws(() => parseSlackChannelTopicPolicy({ topic: "x", unexpected: true })), "Slack policy is closed");

  const ghSource = { projection: { owner: "octo", repo: "demo", issueNumber: 1, issueState: "open", labels: ["bug"] } };
  const ghPolicy = parseGitHubIssueLabelsPolicy({ desiredLabels: ["enhancement", "bug"] });
  const ghEffectA = githubIssueLabelsDefinition.compile({ contract: {} as never, source: ghSource as never, choices: {}, policy: ghPolicy, now: new Date(0), connectorAccount: { connectorId: "github", accountId: "installation" } });
  const ghEffectB = githubIssueLabelsDefinition.compile({ contract: {} as never, source: ghSource as never, choices: {}, policy: ghPolicy, now: new Date(0), connectorAccount: { connectorId: "github", accountId: "installation" } });
  check(Buffer.compare(authorityCanonicalBytes(ghEffectA), authorityCanonicalBytes(ghEffectB)) === 0, "GitHub compilation deterministic");
  check(parseAuthorityWire("transport-effect", ghEffectA).endpointId === "github.issue.labels.replace", "GitHub effect schema closure");
  check(Buffer.compare(authorityCanonicalBytes(ghEffectA), authorityCanonicalBytes(githubIssueLabelsDefinition.compile({ contract: {} as never, source: { projection: { ...ghSource.projection, accountId: "attacker" } } as never, choices: {}, policy: ghPolicy, now: new Date(0), connectorAccount: { connectorId: "github", accountId: "installation" } }))) === 0, "GitHub account is contract-bound");
  check(!Object.keys((ghEffectA as { headers: Record<string, string> }).headers).some(key => ["authorization", "cookie", "host"].includes(key.toLowerCase())), "GitHub effect has no credential headers");
  check(Buffer.from((ghEffectA as { bodyBase64: string }).bodyBase64, "base64").compare(authorityCanonicalBytes({ labels: ["bug", "enhancement"] })) === 0, "GitHub exact request bytes");
  check(reconcileGitHubIssueLabels({ expected: { ...ghSource.projection, labels: ["bug", "enhancement"] }, response: { body: { labels: [{ name: "enhancement" }, { name: "bug" }] } } }).status === "matched", "GitHub matched reconciliation");
  check(reconcileGitHubIssueLabels({ expected: { ...ghSource.projection, labels: ["bug", "enhancement"] }, response: { status: 503, body: {} } }).status === "unavailable", "GitHub unavailable is honest");
  check(reconcileGitHubIssueLabels({ expected: { ...ghSource.projection, labels: ["bug", "enhancement"] }, response: { status: 404, body: {} } }).status === "not-applied", "GitHub not-applied is explicit");
  check(reconcileGitHubIssueLabels({ expected: { ...ghSource.projection, labels: ["bug", "enhancement"] }, response: { body: { labels: [{ name: "attacker" }] } } }).status === "conflict", "GitHub conflicting state is explicit");

  const slackSource = { projection: { teamId: "T1", channelId: "C1", channelName: "private-test", isPrivate: true, topic: "old" } };
  const slackPolicy = parseSlackChannelTopicPolicy({ topic: "new" });
  const slackEffectA = slackChannelTopicDefinition.compile({ contract: {} as never, source: slackSource as never, choices: {}, policy: slackPolicy, now: new Date(0), connectorAccount: { connectorId: "slack", accountId: "T1" } });
  const slackEffectB = slackChannelTopicDefinition.compile({ contract: {} as never, source: slackSource as never, choices: {}, policy: slackPolicy, now: new Date(0), connectorAccount: { connectorId: "slack", accountId: "T1" } });
  check(Buffer.compare(authorityCanonicalBytes(slackEffectA), authorityCanonicalBytes(slackEffectB)) === 0, "Slack compilation deterministic");
  check(parseAuthorityWire("transport-effect", slackEffectA).endpointId === "slack.conversations.setTopic", "Slack effect schema closure");
  check(Buffer.compare(authorityCanonicalBytes(slackEffectA), authorityCanonicalBytes(slackChannelTopicDefinition.compile({ contract: {} as never, source: { projection: { ...slackSource.projection, accountId: "attacker" } } as never, choices: {}, policy: slackPolicy, now: new Date(0), connectorAccount: { connectorId: "slack", accountId: "T1" } }))) === 0, "Slack account is contract-bound");
  check(!JSON.stringify(slackEffectA).match(/(?:token|secret|password|authorization)/i), "Slack effect has no credentials");
  check(throws(() => slackChannelTopicDefinition.compile({ contract: {} as never, source: { projection: { ...slackSource.projection, isPrivate: false } } as never, choices: {}, policy: slackPolicy, now: new Date(0), connectorAccount: { connectorId: "slack", accountId: "T1" } })), "Slack public channel refused");
  check(reconcileSlackChannelTopic({ expected: slackSource.projection, response: { body: { channel: { topic: { value: "old" } } } } }).status === "matched", "Slack matched reconciliation");
  check(reconcileSlackChannelTopic({ expected: slackSource.projection, response: { body: { channel: { topic: { value: "different" } } } } }).status === "conflict", "Slack conflict is honest");
  check(reconcileSlackChannelTopic({ expected: slackSource.projection, response: { status: 503, body: {} } }).status === "unavailable", "Slack unavailable is honest");
  check(reconcileSlackChannelTopic({ expected: slackSource.projection, response: { status: 404, body: {} } }).status === "not-applied", "Slack not-applied is explicit");
  caseIds.push("schema-closure", "exact-byte", "no-secret", "account-binding", "ambiguity", "reconciliation", "redaction");
  return Object.freeze({ aliases: Object.freeze(actualAliases), checks, passed: checks, caseIds: Object.freeze(caseIds) });
}

function throws(fn: () => unknown): boolean { try { fn(); return false; } catch { return true; } }
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
