import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAuthorityCommand } from "../../src/authority/cli.js";

test("authority certify preflight reports missing live references without secrets", async () => {
  const previous = { certify: process.env.REELIER_LIVE_CERTIFY, provider: process.env.REELIER_LIVE_PROVIDER, account: process.env.REELIER_LIVE_ACCOUNT, credential: process.env.REELIER_LIVE_CREDENTIAL_REF, cleanup: process.env.REELIER_LIVE_CLEANUP_REF };
  try {
    delete process.env.REELIER_LIVE_CERTIFY;
    delete process.env.REELIER_LIVE_PROVIDER;
    delete process.env.REELIER_LIVE_ACCOUNT;
    delete process.env.REELIER_LIVE_CREDENTIAL_REF;
    delete process.env.REELIER_LIVE_CLEANUP_REF;
    let output = "";
    const original = console.log;
    console.log = (...args: unknown[]) => { output += args.join(" "); };
    const code = await runAuthorityCommand({ positional: ["certify", "preflight"], flags: new Set(), opts: {} });
    console.log = original;
    assert.equal(code, 1);
    assert.match(output, /reelier\.certification-preflight\/v1/);
  } finally {
    for (const [key, value] of Object.entries({ REELIER_LIVE_CERTIFY: previous.certify, REELIER_LIVE_PROVIDER: previous.provider, REELIER_LIVE_ACCOUNT: previous.account, REELIER_LIVE_CREDENTIAL_REF: previous.credential, REELIER_LIVE_CLEANUP_REF: previous.cleanup })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("authority certify run refuses until a live adapter is explicitly configured", async () => {
  const previous = process.env.REELIER_LIVE_CERTIFY;
  try {
    process.env.REELIER_LIVE_CERTIFY = "1";
    let output = "";
    const original = console.error;
    console.error = (...args: unknown[]) => { output += args.join(" "); };
    const code = await runAuthorityCommand({ positional: ["certify", "run"], flags: new Set(), opts: { adapter: "github-labels" } });
    console.error = original;
    assert.equal(code, 1);
    assert.match(output, /adapter-runner-not-configured/);
  } finally {
    if (previous === undefined) delete process.env.REELIER_LIVE_CERTIFY; else process.env.REELIER_LIVE_CERTIFY = previous;
  }
});

test("authority certify preflight reads a closed operator file and never prints secret values", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-certify-cli-"));
  const file = path.join(root, "certification.json");
  await writeFile(file, JSON.stringify({
    v: "reelier.certification-operator-config/v1",
    authorityConfigPath: "authority/authority.yml",
    evidenceDirectory: "authority/receipts/certification",
    providers: {
      github: { apiBaseUrl: "https://api.github.com", accountId: "owner", credentialRef: "env:REELIER_TEST_GITHUB", cleanupRef: "github-cleanup", repository: "certification", issueNumber: 1 },
      vercel: { apiBaseUrl: "https://api.vercel.com", accountId: "team", credentialRef: "env:REELIER_TEST_VERCEL", cleanupRef: "vercel-cleanup", projectId: "project", deploymentId: "deployment", domains: ["certification.example.com"] },
      neon: { apiBaseUrl: "https://console.neon.tech/api/v2", accountId: "org", credentialRef: "env:REELIER_TEST_NEON", cleanupRef: "neon-cleanup", projectId: "project", branchId: "branch", database: "neondb", role: "owner", databaseUrlRef: "env:REELIER_TEST_NEON_DATABASE" },
      cloudflare: { apiBaseUrl: "https://api.cloudflare.com", accountId: "account", credentialRef: "env:REELIER_TEST_CLOUDFLARE", cleanupRef: "cloudflare-cleanup", zoneId: "zone", recordId: "record", recordName: "certification.example.com", tokenName: "certification-token" },
      hubspot: { apiBaseUrl: "https://api.hubapi.com", accountId: "portal", credentialRef: "env:REELIER_TEST_HUBSPOT", cleanupRef: "hubspot-cleanup", ticketId: "ticket", contactId: "contact", approvedProperties: ["subject"] },
      slack: { apiBaseUrl: "https://slack.com", accountId: "team", credentialRef: "env:REELIER_TEST_SLACK", cleanupRef: "slack-cleanup", channelId: "C0123456789" },
    },
    fly: { appName: "cell", agentAppName: "agent", orgSlug: "personal", region: "yyz", apiCredentialRef: "env:REELIER_TEST_FLY", authorityImageDigest: "sha256:" + "a".repeat(64), networkPolicyDigest: "sha256:" + "b".repeat(64), schemaDigest: "sha256:" + "c".repeat(64) },
    codex: { binaryPath: "missing-codex-for-test", version: "0.134.0", authorityEndpoint: "https://cell.example.com/mcp", taskId: "task_1" },
  }), "utf8");
  const prior = process.env.REELIER_TEST_GITHUB;
  process.env.REELIER_TEST_GITHUB = "private-github-value";
  let output = "";
  const original = console.log;
  try {
    console.log = (...args: unknown[]) => { output += args.join(" "); };
    const code = await runAuthorityCommand({ positional: ["certify", "preflight"], flags: new Set(), opts: { config: file } });
    assert.equal(code, 1);
    assert.match(output, /secret:vercel:credential/);
    assert.match(output, /runtime:codex/);
    assert.doesNotMatch(output, /private-github-value/);
    assert.doesNotMatch(output, /REELIER_TEST_GITHUB/);
  } finally {
    console.log = original;
    if (prior === undefined) delete process.env.REELIER_TEST_GITHUB; else process.env.REELIER_TEST_GITHUB = prior;
  }
});
