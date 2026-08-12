import test from "node:test";
import assert from "node:assert/strict";
import { authorityDigest } from "../../src/authority/wire.js";
import {
  parseCertificationEndpointManifest,
  parseCertificationRunnerManifest,
  parseCertificationScenarioPlan,
} from "../../src/authority/certification/manifests.js";
import { deriveCertificationEndpointManifest } from "../../src/authority/certification/initializer.js";
import {
  getCertificationRunnerRegistryEntry,
  certificationRunnerRegistryDigest,
} from "../../src/authority/certification/runner-registry.js";
import {
  migrateCertificationOperatorConfig,
  parseCertificationOperatorConfigV3,
} from "../../src/authority/certification/config.js";
import { githubIssueLabelsAlias, githubIssueLabelsReadEndpointId, githubIssueLabelsWriteEndpointId } from "../../src/packs/github/manifest.js";
import { cloudflareDnsRecordSetReadEndpointId, cloudflareDnsRecordSetWriteEndpointId } from "../../src/packs/cloudflare/manifest.js";
import { slackChannelTopicReadEndpointId, slackChannelTopicWriteEndpointId } from "../../src/packs/slack-topic/manifest.js";
import { neonDatabaseMigrationReadEndpointId, neonDatabaseMigrationWriteEndpointId } from "../../src/packs/neon/manifest.js";

const sha = (character: string) => `sha256:${character.repeat(64)}`;

function githubV3(): Record<string, unknown> {
  return {
    v: "reelier.certification-operator-config/v3",
    authorityConfigPath: "authority/authority.yml",
    evidenceDirectory: "authority/receipts/certification",
    scenarios: ["github-issue-labels"],
    resources: { "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 } },
    cleanup: { "github-issue-labels": ["restore-github-issue-labels"] },
    metadata: {},
    secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN" },
  };
}

test("v3 migration splits Cloudflare DNS and bootstrap references without resolving either", () => {
  const legacy = {
    v: "reelier.certification-operator-config/v2",
    authorityConfigPath: "authority/authority.yml",
    evidenceDirectory: "authority/receipts/certification",
    scenarios: ["cloudflare-dns", "cloudflare-vercel-secret"],
    resources: {
      "cloudflare-dns": { apiBaseUrl: "https://api.cloudflare.com", accountId: "acct", zoneId: "zone", recordId: "record", recordName: "certification.example.com" },
      "cloudflare-vercel-secret": { cloudflareApiBaseUrl: "https://api.cloudflare.com", cloudflareAccountId: "acct", tokenName: "cert-token", vercelApiBaseUrl: "https://api.vercel.com", vercelAccountId: "team", projectId: "project" },
    },
    cleanup: { "cloudflare-dns": ["restore-dns"], "cloudflare-vercel-secret": ["remove-secret", "remove-token"] },
    metadata: {},
    secretReferences: { cloudflareCredential: "file:Z:/must-not-be-read", vercelCredential: "env:REELIER_VERCEL_TOKEN" },
  };
  const migrated = migrateCertificationOperatorConfig(legacy);
  assert.equal(migrated.v, "reelier.certification-operator-config/v3");
  assert.deepEqual(migrated.secretReferences, {
    cloudflareBootstrapCredential: "file:Z:/must-not-be-read",
    cloudflareDnsCredential: "file:Z:/must-not-be-read",
    vercelCredential: "env:REELIER_VERCEL_TOKEN",
  });
  assert.deepEqual(migrateCertificationOperatorConfig(migrated), migrated);
  assert.deepEqual(parseCertificationOperatorConfigV3(migrated), migrated);
});

test("v2 endpoint derivation uses reviewed pack aliases, endpoint IDs, methods, and directions", () => {
  const github = deriveCertificationEndpointManifest(parseCertificationOperatorConfigV3(githubV3()), "github-issue-labels");
  assert.equal(github.v, "reelier.certification-endpoint-manifest/v2");
  assert.deepEqual(github.definitionAliases, [githubIssueLabelsAlias]);
  assert.deepEqual(github.endpoints.map(endpoint => [endpoint.endpointId, endpoint.method, endpoint.direction]), [
    [githubIssueLabelsReadEndpointId, "GET", "read"],
    [githubIssueLabelsWriteEndpointId, "PUT", "write"],
  ]);

  const expected = {
    "cloudflare-dns": [cloudflareDnsRecordSetReadEndpointId, cloudflareDnsRecordSetWriteEndpointId],
    "slack-topic": [slackChannelTopicReadEndpointId, slackChannelTopicWriteEndpointId],
    "neon-migration": [neonDatabaseMigrationReadEndpointId, neonDatabaseMigrationWriteEndpointId],
  };
  for (const [scenario, endpointIds] of Object.entries(expected)) {
    const entry = getCertificationRunnerRegistryEntry(scenario as never);
    assert.deepEqual(entry.endpoints.map(endpoint => endpoint.endpointId), endpointIds);
  }
});

test("compound endpoint authority binds provider credential account resource method and direction per endpoint", () => {
  const config = migrateCertificationOperatorConfig({
    ...githubV3(),
    v: "reelier.certification-operator-config/v2",
    scenarios: ["cloudflare-vercel-secret"],
    resources: { "cloudflare-vercel-secret": { cloudflareApiBaseUrl: "https://api.cloudflare.com", cloudflareAccountId: "cf-acct", tokenName: "cert-token", vercelApiBaseUrl: "https://api.vercel.com", vercelAccountId: "vc-team", projectId: "vc-project" } },
    cleanup: { "cloudflare-vercel-secret": ["remove-secret", "remove-token"] },
    secretReferences: { cloudflareCredential: "env:REELIER_CLOUDFLARE_BOOTSTRAP_TOKEN", vercelCredential: "env:REELIER_VERCEL_TOKEN" },
  });
  const manifest = deriveCertificationEndpointManifest(config, "cloudflare-vercel-secret");
  assert.equal(manifest.dispatchable, false);
  assert.deepEqual(manifest.endpoints.map(endpoint => ({ provider: endpoint.provider, credentialSlot: endpoint.credentialSlot, method: endpoint.method, direction: endpoint.direction })), [
    { provider: "cloudflare", credentialSlot: "cloudflareBootstrapCredential", method: "GET", direction: "read" },
    { provider: "cloudflare", credentialSlot: "cloudflareBootstrapCredential", method: "POST", direction: "write" },
    { provider: "vercel", credentialSlot: "vercelCredential", method: "GET", direction: "read" },
    { provider: "vercel", credentialSlot: "vercelCredential", method: "POST", direction: "write" },
  ]);
  assert.equal(new Set(manifest.endpoints.map(endpoint => endpoint.accountCommitment)).size, 2);
  assert.equal(new Set(manifest.endpoints.map(endpoint => endpoint.resourceCommitment)).size, 2);
});

test("runner v2 binds registry metadata but remains non-dispatchable without implementation and executed-test evidence", () => {
  const endpoint = deriveCertificationEndpointManifest(parseCertificationOperatorConfigV3(githubV3()), "github-issue-labels");
  const registry = getCertificationRunnerRegistryEntry("github-issue-labels");
  const runner = parseCertificationRunnerManifest({
    v: "reelier.certification-runner-manifest/v2",
    scenarioId: "github-issue-labels",
    runnerId: registry.runnerId,
    endpointManifestDigest: authorityDigest(endpoint),
    metadataDigest: registry.metadataDigest,
    registryDigest: certificationRunnerRegistryDigest,
    operations: ["prepare", "authoritative-read", "compile", "reserve", "authoritative-reread", "recompile", "dispatch", "controlled-cut", "reconcile", "receipt", "cleanup", "export", "offline-verify"],
    executionReady: false,
    dispatchable: false,
  }, "github-issue-labels");
  assert.equal(runner.dispatchable, false);
  assert.equal(runner.executionReady, false);
  assert.equal("implementationDigest" in runner, false);
  assert.throws(() => parseCertificationRunnerManifest({ ...runner, metadataDigest: sha("f") }, "github-issue-labels"), /metadata|registry/i);
  const v1 = parseCertificationRunnerManifest({ v: "reelier.certification-runner-manifest/v1", scenarioId: "github-issue-labels", runnerId: "legacy_runner", endpointManifestDigest: sha("1"), implementationDigest: sha("2"), operations: ["prepare", "authoritative-read", "compile", "reserve", "reread", "dispatch", "reconcile", "receipt", "cleanup"] });
  assert.equal(v1.dispatchable, false);
});

test("scenario plan is closed, selected-only, digest-bound, and rejects secret or executable shapes", () => {
  const base = {
    v: "reelier.certification-scenario-plan/v1",
    scenarioId: "github-issue-labels",
    definitionAliases: [githubIssueLabelsAlias],
    sourceRefs: { issue: "github:fixlyai/reelier-certification#1" },
    choices: { labels: ["certification-after"] },
    policyCommitments: [{ schemaId: "github_issue_labels_policy_v1", digest: sha("1") }],
    cleanup: { recipeId: "restore-github-issue-labels", beforeStateDigest: sha("2") },
    controlledCut: { case: "ambiguous-after-dispatch" },
    runnerManifestDigest: sha("3"),
    testManifestDigest: sha("4"),
    endpointManifestDigest: sha("5"),
    runnerRegistryDigest: certificationRunnerRegistryDigest,
  };
  assert.equal(parseCertificationScenarioPlan(base, ["github-issue-labels"]).scenarioId, "github-issue-labels");
  for (const mutation of [
    { ...base, scenarioId: "slack-topic" },
    { ...base, callback: () => undefined },
    { ...base, modulePath: "./runner.js" },
    { ...base, command: "node runner.js" },
    { ...base, choices: { authorization: "Bearer private" } },
    { ...base, choices: { token: "secret" } },
    { ...base, unselectedScenarioData: { "slack-topic": {} } },
  ]) assert.throws(() => parseCertificationScenarioPlan(mutation, ["github-issue-labels"]), /closed|secret|executable|selected|scenario/i);
});

test("private runner registry is exact metadata and unavailable compound runners stay non-dispatchable", () => {
  const scenarios = ["cloudflare-dns", "cloudflare-vercel-secret", "github-issue-labels", "neon-migration", "slack-topic", "vercel-promotion"];
  const entries = scenarios.map(scenario => getCertificationRunnerRegistryEntry(scenario as never));
  assert.deepEqual(entries.map(entry => entry.scenarioId), scenarios);
  assert.equal(entries.every(entry => entry.dispatchable === false), true);
  assert.equal(entries.every(entry => entry.executionReady === false), true);
  assert.equal(entries.every(entry => "implementationDigest" in entry === false), true);
  assert.equal(entries.find(entry => entry.scenarioId === "cloudflare-vercel-secret")?.dispatchable, false);
  assert.match(entries.find(entry => entry.scenarioId === "cloudflare-vercel-secret")?.unavailableReason ?? "", /not registered/i);
  const serialized = JSON.stringify(entries);
  assert.doesNotMatch(serialized, /function|callback|modulePath|sourcePath|command/i);
  assert.equal(entries.some(entry => Object.values(entry).some(value => typeof value === "function")), false);
});

test("public package exports do not expose the private runner registry", async () => {
  const authority = await import("../../src/authority/index.js") as Record<string, unknown>;
  const host = await import("../../src/authority/host/index.js") as Record<string, unknown>;
  for (const surface of [authority, host]) {
    assert.equal("getCertificationRunnerRegistryEntry" in surface, false);
    assert.equal("certificationRunnerRegistryDigest" in surface, false);
  }
});

test("closed public plan input rejects accessor-based callbacks without invoking them", () => {
  let calls = 0;
  const choices = Object.create(Object.prototype, {
    desired: { enumerable: true, get: () => { calls += 1; return "reviewed"; } },
  });
  const plan = {
    v: "reelier.certification-scenario-plan/v1",
    scenarioId: "github-issue-labels",
    definitionAliases: [githubIssueLabelsAlias],
    sourceRefs: { issue: "github:fixlyai/reelier-certification#1" },
    choices,
    policyCommitments: [{ schemaId: "github_issue_labels_policy_v1", digest: sha("1") }],
    cleanup: { recipeId: "restore-github-issue-labels", beforeStateDigest: sha("2") },
    controlledCut: { case: "ambiguous-after-dispatch" },
    runnerManifestDigest: sha("3"), testManifestDigest: sha("4"), endpointManifestDigest: sha("5"), runnerRegistryDigest: certificationRunnerRegistryDigest,
  };
  assert.throws(() => parseCertificationScenarioPlan(plan, ["github-issue-labels"]), /accessor|closed|executable/i);
  assert.equal(calls, 0);
});
