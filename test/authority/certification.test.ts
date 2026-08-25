import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CERTIFICATION_PROVIDER_IDS,
  CERTIFICATION_TARGET_PACKAGE_VERSION,
  createCertificationPreflight,
  type CertificationPreflightInput,
} from "../../src/authority/host/certification.js";

test("the certification target and distributed metadata use the next publishable package version", () => {
  const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
  const serverVersion = JSON.parse(readFileSync("server.json", "utf8")).version;
  const pluginVersion = JSON.parse(readFileSync("plugin/agent-plugins/plugin.json", "utf8")).version;
  assert.equal(CERTIFICATION_TARGET_PACKAGE_VERSION, "0.33.0-beta.0");
  assert.equal(packageVersion, CERTIFICATION_TARGET_PACKAGE_VERSION);
  assert.equal(serverVersion, CERTIFICATION_TARGET_PACKAGE_VERSION);
  assert.equal(pluginVersion, CERTIFICATION_TARGET_PACKAGE_VERSION);
  assert.match(readFileSync("action.yml", "utf8"), /default: "0\.33\.0-beta\.0"/);
});

const baseInput: CertificationPreflightInput = {
  packageVersion: "0.32.0",
  expectedPackageVersion: "0.32.0",
  cloud: { deploymentId: "dpl_test", status: "ready" },
  migrations: { status: "applied", digest: "sha256:" + "a".repeat(64) },
  runtime: { codex: "available", fly: "available" },
  resources: [
    { provider: "github", accountId: "account_1", credentialRef: "github-ref", cleanupRef: "github-cleanup" },
  ],
};

test("preflight reports ready resources without exposing credential values", () => {
  const report = createCertificationPreflight(baseInput);
  assert.equal(report.ok, true);
  assert.deepEqual(report.claims, { package: "verified", cloud: "verified", migrations: "verified", runtime: "verified" });
  assert.equal(report.resources[0]?.credentialRefStatus, "configured");
  assert.equal(report.resources[0]?.cleanupRefStatus, "configured");
  assert.equal("credentialValue" in report.resources[0]!, false);
});

test("preflight names missing references while returning only redacted metadata", () => {
  const report = createCertificationPreflight({
    ...baseInput,
    cloud: { deploymentId: "dpl_test", status: "unknown" },
    resources: [{ provider: "slack", accountId: "account_2" }],
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.missing, ["cloud.status", "resource:slack:cleanupRef", "resource:slack:credentialRef"]);
  assert.equal(JSON.stringify(report).includes("secret"), false);
});

test("provider IDs are closed and sorted", () => {
  assert.deepEqual([...CERTIFICATION_PROVIDER_IDS], ["cloudflare", "codex", "fly", "github", "hubspot", "neon", "slack", "vercel"]);
  assert.throws(() => createCertificationPreflight({ ...baseInput, resources: [{ provider: "unknown", accountId: "a", credentialRef: "r", cleanupRef: "c" }] }), /provider/);
});
