import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CERTIFICATION_SECRET_SLOTS, CODEX_CERTIFICATION_PROFILES, canonicalizeCertificationOperatorConfigV2, canonicalizeCertificationOperatorConfigV3, inspectCertificationResourceIdentifiers, migrateCertificationOperatorConfig, parseCertificationOperatorConfig, parseCertificationOperatorConfigV2, parseCertificationOperatorConfigV3, inspectCertificationSecretReferences } from "../../src/authority/host/certification-config.js";

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
    fly: { appName: "reelier-cell-demo", authorityMachineId: "cell123", agentAppName: "reelier-agent-demo", agentMachineId: "agent123", egressAppName: "reelier-egress-demo", egressMachineId: "gateway123", orgSlug: "personal", region: "yyz", apiCredentialRef: "env:FLY_API_TOKEN", flyctlPath: "flyctl", flyctlVersion: "0.3.200", egressProxyBaseUrl: "http://reelier-egress-demo.internal:8443", egressProxyBearerRef: "env:REELIER_EGRESS_GATEWAY_BEARER", authorityImageDigest: "sha256:" + "a".repeat(64), agentImageDigest: "sha256:" + "d".repeat(64), gatewayImageDigest: "sha256:" + "e".repeat(64), networkPolicyDigest: "sha256:" + "b".repeat(64), schemaDigest: "sha256:" + "c".repeat(64) },
    codex: { binaryPath: "codex", version: "0.134.0", authorityEndpoint: "https://reelier-cell-demo.fly.dev/mcp", taskId: "task_certification_1", jobId: "job_founder_stack", authorityCellId: "cell_certification_1", codexHomePath: "C:/reelier-private/codex-home", workspacePath: "C:/work/reelier-certification", sessionCredentialDirectory: "C:/reelier-private/codex-sessions" },
  };
}

test("certification operator config is closed and preserves only secret references", () => {
  const parsed = parseCertificationOperatorConfig(completeConfig());
  assert.equal(parsed.providers.github.repository, "reelier-certification");
  assert.equal(parsed.fly.appName, "reelier-cell-demo");
  assert.equal(parsed.codex.codexHomePath, "C:/reelier-private/codex-home");
  assert.equal(parsed.codex.jobId, "job_founder_stack");
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
    REELIER_EGRESS_GATEWAY_BEARER: "gateway-private",
  });
  assert.equal(report.filter(item => item.owner !== "codex").every(item => item.status === "configured"), true);
  assert.equal(report.filter(item => item.owner === "codex").length, 10);
  assert.equal(report.filter(item => item.owner === "codex").every(item => item.status === "missing"), true);
  const serialized = JSON.stringify(report);
  for (const value of ["github-private", "vercel-private", "postgresql://private-value", "fly-private"]) assert.equal(serialized.includes(value), false);
});

test("managed secret inspection requires provider credentials in the Authority Cell", async () => {
  const config = parseCertificationOperatorConfig(completeConfig());
  const report = await inspectCertificationSecretReferences(config, {
    REELIER_GITHUB_TOKEN: "local-only-github-value",
    FLY_API_TOKEN: "local-fly-value",
  }, new Set([
    "REELIER_VERCEL_TOKEN",
    "REELIER_NEON_API_KEY",
    "REELIER_NEON_DATABASE_URL",
    "REELIER_CLOUDFLARE_TOKEN",
    "REELIER_HUBSPOT_TOKEN",
    "REELIER_SLACK_TOKEN",
    "REELIER_EGRESS_GATEWAY_BEARER",
  ]));
  assert.equal(report.find(item => item.owner === "github" && item.slot === "credential")?.status, "missing");
  assert.equal(report.find(item => item.owner === "vercel" && item.slot === "credential")?.status, "configured");
  assert.equal(report.find(item => item.owner === "fly" && item.slot === "api")?.status, "configured");
  assert.equal(report.find(item => item.owner === "fly" && item.slot === "egress")?.status, "configured");
  assert.doesNotMatch(JSON.stringify(report), /local-only-github-value|local-fly-value/);
});

test("resource inspection rejects operator placeholders without returning identifiers", () => {
  const raw = completeConfig() as { providers: { github: { repository: string }; vercel: { domains: string[] } }; codex: { taskId: string } };
  raw.providers.github.repository = "replace-github-repo";
  raw.providers.vercel.domains = ["replace.example.com"];
  raw.codex.taskId = "replace-task";
  const report = inspectCertificationResourceIdentifiers(parseCertificationOperatorConfig(raw));
  assert.equal(report.find(item => item.owner === "github" && item.field === "repository")?.status, "missing");
  assert.equal(report.find(item => item.owner === "vercel" && item.field === "domains")?.status, "missing");
  assert.equal(report.find(item => item.owner === "codex" && item.field === "taskId")?.status, "missing");
  assert.equal(report.find(item => item.owner === "cloudflare" && item.field === "zoneId")?.status, "configured");
  assert.doesNotMatch(JSON.stringify(report), /github-repo|example\.com|task_1/);
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

function minimalV2(): Record<string, unknown> {
  return {
    v: "reelier.certification-operator-config/v2",
    authorityConfigPath: "authority/authority.yml",
    evidenceDirectory: "authority/receipts/certification",
    scenarios: ["github-issue-labels"],
    resources: {
      "github-issue-labels": {
        apiBaseUrl: "https://api.github.com",
        owner: "seldonframe",
        repository: "reelier-certification",
        issueNumber: 1,
      },
    },
    cleanup: { "github-issue-labels": ["restore-github-issue-labels"] },
    metadata: {},
    secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN" },
  };
}

test("v2 requires only the resources, cleanup, metadata, and secret slots selected by scenarios", () => {
  const parsed = parseCertificationOperatorConfigV2(minimalV2());
  assert.deepEqual(parsed.scenarios, ["github-issue-labels"]);
  assert.deepEqual(Object.keys(parsed.resources), ["github-issue-labels"]);
  assert.deepEqual(Object.keys(parsed.cleanup), ["github-issue-labels"]);
  assert.deepEqual(Object.keys(parsed.metadata), []);
  assert.deepEqual(Object.keys(parsed.secretReferences), ["githubCredential"]);
  assert.equal("hubspot" in parsed.resources, false);
});

test("v2 refuses unknown, duplicate, unsorted, extra, and incomplete scenario authority", () => {
  const unknown = structuredClone(minimalV2()); unknown.scenarios = ["unknown-scenario"];
  assert.throws(() => parseCertificationOperatorConfigV2(unknown), /scenario/i);
  const duplicate = structuredClone(minimalV2()); duplicate.scenarios = ["github-issue-labels", "github-issue-labels"];
  assert.throws(() => parseCertificationOperatorConfigV2(duplicate), /unique|sorted/i);
  const unsorted = structuredClone(minimalV2()); unsorted.scenarios = ["slack-topic", "github-issue-labels"];
  assert.throws(() => parseCertificationOperatorConfigV2(unsorted), /sorted/i);
  const extraSecret = structuredClone(minimalV2()); (extraSecret.secretReferences as Record<string, unknown>).slackCredential = "env:SLACK_PRIVATE_VALUE";
  assert.throws(() => parseCertificationOperatorConfigV2(extraSecret), /secret.*closed|unexpected secret/i);
  const extraResource = structuredClone(minimalV2()); (extraResource.resources as Record<string, unknown>)["slack-topic"] = { apiBaseUrl: "https://slack.com", teamId: "T1", channelId: "C1" };
  assert.throws(() => parseCertificationOperatorConfigV2(extraResource), /resource.*closed|unexpected resource/i);
  const missingCleanup = structuredClone(minimalV2()); delete (missingCleanup.cleanup as Record<string, unknown>)["github-issue-labels"];
  assert.throws(() => parseCertificationOperatorConfigV2(missingCleanup), /cleanup/i);
  const missingResource = structuredClone(minimalV2()); delete (missingResource.resources as Record<string, unknown>)["github-issue-labels"];
  assert.throws(() => parseCertificationOperatorConfigV2(missingResource), /resource/i);
  const missingSecret = structuredClone(minimalV2()); delete (missingSecret.secretReferences as Record<string, unknown>).githubCredential;
  assert.throws(() => parseCertificationOperatorConfigV2(missingSecret), /secret/i);
});

test("v2 rejects HubSpot and manual generated identity fields", () => {
  const hubspot = structuredClone(minimalV2()); (hubspot.resources as Record<string, unknown>).hubspot = {};
  assert.throws(() => parseCertificationOperatorConfigV2(hubspot), /resource.*closed|hubspot/i);
  for (const key of ["taskId", "jobId", "authorityCellId", "signer", "grant"] as const) {
    const raw = structuredClone(minimalV2()); raw[key] = "operator-controlled";
    assert.throws(() => parseCertificationOperatorConfigV2(raw), /closed/);
  }
});

test("v2 errors never disclose invalid secret-reference values and parsing performs no ref I/O", () => {
  const marker = "private-value-that-must-not-appear";
  const raw = structuredClone(minimalV2()); (raw.secretReferences as Record<string, unknown>).githubCredential = marker;
  assert.throws(() => parseCertificationOperatorConfigV2(raw), error => {
    assert.equal(String(error).includes(marker), false);
    return true;
  });
  const missingFile = structuredClone(minimalV2()); (missingFile.secretReferences as Record<string, unknown>).githubCredential = "file:Z:/definitely/not/read/by/parser";
  assert.equal(parseCertificationOperatorConfigV2(missingFile).secretReferences.githubCredential, "file:Z:/definitely/not/read/by/parser");
});

test("v2 parsing is deeply closed, immutable, and canonically byte-stable", () => {
  const input = minimalV2();
  const parsed = parseCertificationOperatorConfigV2(input);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.scenarios), true);
  assert.equal(Object.isFrozen(parsed.resources), true);
  assert.equal(Object.isFrozen(parsed.resources["github-issue-labels"]), true);
  assert.equal(Object.isFrozen(parsed.cleanup["github-issue-labels"]), true);
  (input.resources as Record<string, Record<string, unknown>>)["github-issue-labels"].owner = "attacker";
  assert.equal((parsed.resources["github-issue-labels"] as { readonly owner: string }).owner, "seldonframe");
  const first = canonicalizeCertificationOperatorConfigV2(parsed);
  const second = canonicalizeCertificationOperatorConfigV2(parseCertificationOperatorConfigV2(JSON.parse(first)));
  assert.equal(second, first);
});

test("migration maps v1 to v3, drops HubSpot and generated identity inputs, and is idempotent", () => {
  const legacy = completeConfig() as Record<string, unknown>;
  const migrated = migrateCertificationOperatorConfig(legacy);
  assert.equal(migrated.v, "reelier.certification-operator-config/v3");
  assert.deepEqual(migrated.scenarios, ["cloudflare-dns", "cloudflare-vercel-secret", "codex-ten-principal", "fly-topology", "github-issue-labels", "neon-migration", "slack-topic", "vercel-promotion"]);
  const serialized = canonicalizeCertificationOperatorConfigV3(migrated);
  assert.doesNotMatch(serialized, /hubspot|task_certification_1|job_founder_stack|cell_certification_1|REELIER_EGRESS_GATEWAY_BEARER/i);
  assert.equal(migrated.secretReferences.githubCredential, "env:REELIER_GITHUB_TOKEN");
  assert.equal(migrated.secretReferences.neonDatabaseUrl, "env:REELIER_NEON_DATABASE_URL");
  assert.deepEqual(migrateCertificationOperatorConfig(migrated), migrated);
  assert.equal(canonicalizeCertificationOperatorConfigV3(migrateCertificationOperatorConfig(migrated)), serialized);
});

test("migration refuses ambiguous legacy input without inventing required fields or revealing secrets", () => {
  const legacy = completeConfig() as { providers: Record<string, unknown> };
  delete legacy.providers.slack;
  assert.throws(() => migrateCertificationOperatorConfig(legacy), error => {
    assert.match(String(error), /slack.*required|legacy.*incomplete/i);
    assert.doesNotMatch(String(error), /REELIER_|private/i);
    return true;
  });
});

test("all eight named secret slots are accepted only when their scenarios require them", () => {
  const legacy = migrateCertificationOperatorConfig(completeConfig());
  assert.deepEqual(Object.keys(legacy.secretReferences).sort(), ["cloudflareBootstrapCredential", "cloudflareDnsCredential", "flyApiCredential", "githubCredential", "neonApiCredential", "neonDatabaseUrl", "slackCredential", "vercelCredential"]);
});

test("v3 keeps Codex home and generated session state outside the agent workspace", () => {
  for (const field of ["codexHomePath", "sessionDirectory"] as const) {
    const raw = structuredClone(migrateCertificationOperatorConfig(completeConfig())) as unknown as { metadata: { codexTenPrincipal: Record<string, unknown> } };
    raw.metadata.codexTenPrincipal[field] = `C:/work/reelier-certification/${field}`;
    assert.throws(() => parseCertificationOperatorConfigV3(raw), /outside the workspace/);
  }
});

test("the v3 authority example is a minimal scenario-scoped non-secret template", async () => {
  const raw = await readFile(path.resolve("authority/certification.example.json"), "utf8");
  const parsed = migrateCertificationOperatorConfig(JSON.parse(raw));
  assert.deepEqual(parsed.scenarios, ["github-issue-labels"]);
  assert.deepEqual(Object.keys(parsed.secretReferences), ["githubCredential"]);
  assert.doesNotMatch(raw, /hubspot|taskId|jobId|authorityCellId|signer|grant|ghp_|Bearer\s/i);
});

test("v2 pins provider API bases so a resource cannot redirect later credential use", () => {
  for (const apiBaseUrl of ["https://attacker.example", "https://api.github.com/alternate", "https://user:pass@api.github.com"]) {
    const raw = structuredClone(minimalV2()) as { resources: { "github-issue-labels": { apiBaseUrl: string } } };
    raw.resources["github-issue-labels"].apiBaseUrl = apiBaseUrl;
    assert.throws(() => parseCertificationOperatorConfigV2(raw), /github apiBaseUrl/i);
  }
});

test("v2 exported closed lists are runtime immutable", () => {
  assert.equal(Object.isFrozen(CERTIFICATION_SECRET_SLOTS), true);
  assert.equal(Object.isFrozen(CODEX_CERTIFICATION_PROFILES), true);
});

test("v3 refuses collapsed Fly identities and inconsistent shared provider scope", () => {
  const collapsedApp = structuredClone(migrateCertificationOperatorConfig(completeConfig())) as any;
  collapsedApp.metadata.flyTopology.agentAppName = collapsedApp.metadata.flyTopology.appName;
  assert.throws(() => parseCertificationOperatorConfigV3(collapsedApp), /Fly app identities must be unique/);

  const collapsedMachine = structuredClone(migrateCertificationOperatorConfig(completeConfig())) as any;
  collapsedMachine.metadata.flyTopology.agentMachineId = collapsedMachine.metadata.flyTopology.authorityMachineId;
  assert.throws(() => parseCertificationOperatorConfigV3(collapsedMachine), /Fly machine identities must be unique/);

  const cloudflareMismatch = structuredClone(migrateCertificationOperatorConfig(completeConfig())) as any;
  cloudflareMismatch.resources["cloudflare-vercel-secret"].cloudflareAccountId = "other-account";
  assert.throws(() => parseCertificationOperatorConfigV3(cloudflareMismatch), /Cloudflare account scope must match/);

  for (const field of ["vercelAccountId", "projectId"] as const) {
    const vercelMismatch = structuredClone(migrateCertificationOperatorConfig(completeConfig())) as any;
    vercelMismatch.resources["cloudflare-vercel-secret"][field] = "other-vercel-scope";
    assert.throws(() => parseCertificationOperatorConfigV3(vercelMismatch), /Vercel account and project scope must match/);
  }

  const codexEndpointMismatch = structuredClone(migrateCertificationOperatorConfig(completeConfig())) as any;
  codexEndpointMismatch.metadata.codexTenPrincipal.authorityEndpoint = "https://different-cell.fly.dev/mcp";
  assert.throws(() => parseCertificationOperatorConfigV3(codexEndpointMismatch), /Codex authority endpoint must match Fly authority app/);

  const codexPortMismatch = structuredClone(migrateCertificationOperatorConfig(completeConfig())) as any;
  codexPortMismatch.metadata.codexTenPrincipal.authorityEndpoint = "https://reelier-cell-demo.fly.dev:444/mcp";
  assert.throws(() => parseCertificationOperatorConfigV3(codexPortMismatch), /Codex authority endpoint must match Fly authority app/);

  const egressPortMismatch = structuredClone(migrateCertificationOperatorConfig(completeConfig())) as any;
  egressPortMismatch.metadata.flyTopology.egressProxyBaseUrl = "http://reelier-egress-demo.internal:80";
  assert.throws(() => parseCertificationOperatorConfigV3(egressPortMismatch), /port 8443/);
});
