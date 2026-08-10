import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseCertificationOperatorConfig, inspectCertificationSecretReferences } from "../../src/authority/host/certification-config.js";

function completeConfig(): unknown {
  return {
    v: "reelier.certification-operator-config/v1",
    authorityConfigPath: "authority/authority.yml",
    evidenceDirectory: "authority/receipts/certification",
    providers: {
      github: { apiBaseUrl: "https://api.github.com", accountId: "seldonframe", credentialRef: "env:REELIER_GITHUB_TOKEN", cleanupRef: "github-cleanup", repository: "reelier-certification", issueNumber: 1 },
      vercel: { apiBaseUrl: "https://api.vercel.com", accountId: "team_1", credentialRef: "env:REELIER_VERCEL_TOKEN", cleanupRef: "vercel-cleanup", projectId: "prj_1", deploymentId: "dpl_1", domains: ["certification.example.com"] },
      neon: { apiBaseUrl: "https://console.neon.tech/api/v2", accountId: "org_1", credentialRef: "env:REELIER_NEON_API_KEY", cleanupRef: "neon-cleanup", projectId: "project_1", branchId: "br_1", database: "neondb", role: "neondb_owner", databaseUrlRef: "env:REELIER_NEON_DATABASE_URL" },
      cloudflare: { apiBaseUrl: "https://api.cloudflare.com", accountId: "account_1", credentialRef: "env:REELIER_CLOUDFLARE_TOKEN", cleanupRef: "cloudflare-cleanup", zoneId: "zone_1", recordId: "record_1", recordName: "certification.example.com", tokenName: "reelier-certification-token" },
      hubspot: { apiBaseUrl: "https://api.hubapi.com", accountId: "portal_1", credentialRef: "env:REELIER_HUBSPOT_TOKEN", cleanupRef: "hubspot-cleanup", ticketId: "ticket_1", contactId: "contact_1", approvedProperties: ["subject"] },
      slack: { apiBaseUrl: "https://slack.com", accountId: "team_1", credentialRef: "env:REELIER_SLACK_TOKEN", cleanupRef: "slack-cleanup", channelId: "C0123456789" },
    },
    fly: { appName: "reelier-cell-demo", authorityMachineId: "cell123", agentAppName: "reelier-agent-demo", agentMachineId: "agent123", egressAppName: "reelier-egress-demo", egressMachineId: "gateway123", orgSlug: "personal", region: "yyz", apiCredentialRef: "env:FLY_API_TOKEN", flyctlPath: "flyctl", flyctlVersion: "0.3.200", authorityImageDigest: "sha256:" + "a".repeat(64), agentImageDigest: "sha256:" + "d".repeat(64), gatewayImageDigest: "sha256:" + "e".repeat(64), networkPolicyDigest: "sha256:" + "b".repeat(64), schemaDigest: "sha256:" + "c".repeat(64) },
    codex: { binaryPath: "codex", version: "0.134.0", authorityEndpoint: "https://reelier-cell-demo.fly.dev/mcp", taskId: "task_certification_1", codexHomePath: "C:/reelier-private/codex-home", workspacePath: "C:/work/reelier-certification", sessionCredentialDirectory: "C:/reelier-private/codex-sessions" },
  };
}

test("certification operator config is closed and preserves only secret references", () => {
  const parsed = parseCertificationOperatorConfig(completeConfig());
  assert.equal(parsed.providers.github.repository, "reelier-certification");
  assert.equal(parsed.fly.appName, "reelier-cell-demo");
  assert.equal(parsed.codex.codexHomePath, "C:/reelier-private/codex-home");
  assert.doesNotMatch(JSON.stringify(parsed), /ghp_|xoxb-|Bearer /);
  assert.throws(() => parseCertificationOperatorConfig({ ...(completeConfig() as object), token: "ghp_leak" }), /closed/);
  const raw = completeConfig() as { providers: { github: Record<string, unknown> } };
  raw.providers.github.accessToken = "ghp_leak";
  assert.throws(() => parseCertificationOperatorConfig(raw), /closed/);
});

test("secret-reference inspection reports availability without returning values", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-config-"));
  const secretFile = path.join(root, "neon-url");
  await writeFile(secretFile, "postgresql://private-value", "utf8");
  const config = completeConfig() as { providers: { neon: { databaseUrlRef: string } } };
  config.providers.neon.databaseUrlRef = `file:${secretFile}`;
  const report = await inspectCertificationSecretReferences(parseCertificationOperatorConfig(config), {
    REELIER_GITHUB_TOKEN: "github-private",
    REELIER_VERCEL_TOKEN: "vercel-private",
    REELIER_NEON_API_KEY: "neon-private",
    REELIER_CLOUDFLARE_TOKEN: "cloudflare-private",
    REELIER_HUBSPOT_TOKEN: "hubspot-private",
    REELIER_SLACK_TOKEN: "slack-private",
    FLY_API_TOKEN: "fly-private",
  });
  assert.equal(report.filter(item => item.owner !== "codex").every(item => item.status === "configured"), true);
  assert.equal(report.filter(item => item.owner === "codex").length, 10);
  assert.equal(report.filter(item => item.owner === "codex").every(item => item.status === "missing"), true);
  const serialized = JSON.stringify(report);
  for (const value of ["github-private", "vercel-private", "postgresql://private-value", "fly-private"]) assert.equal(serialized.includes(value), false);
});

test("Codex session credentials must remain outside the agent workspace", () => {
  const config = completeConfig() as { codex: { sessionCredentialDirectory: string } };
  config.codex.sessionCredentialDirectory = "C:/work/reelier-certification/.secrets";
  assert.throws(() => parseCertificationOperatorConfig(config), /outside the workspace/);
});

test("the tracked operator example remains a parseable non-secret template", async () => {
  const raw = await readFile(path.resolve("docs/runbooks/certification.operator.example.json"), "utf8");
  const parsed = parseCertificationOperatorConfig(JSON.parse(raw));
  const serialized = JSON.stringify(parsed);
  assert.equal(parsed.v, "reelier.certification-operator-config/v1");
  assert.match(parsed.providers.github.credentialRef, /^(?:env:|file:)/);
  assert.doesNotMatch(serialized, /ghp_|xox[baprs]-|Bearer\s|postgres(?:ql)?:\/\/[^\"]+@/i);
});
