import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeCertification } from "../../src/authority/certification/initializer.js";
import { preflightCertification } from "../../src/authority/certification/preflight.js";
import { writeCertificationInputManifests } from "./certification-input-fixture.js";

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-preflight-"));
  const configPath = path.join(root, "certification.local.json");
  await writeFile(configPath, JSON.stringify({
    v: "reelier.certification-operator-config/v2",
    authorityConfigPath: "authority/authority.yml",
    evidenceDirectory: "authority/receipts/certification",
    scenarios: ["github-issue-labels", "slack-topic"],
    resources: {
      "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 },
      "slack-topic": { apiBaseUrl: "https://slack.com", teamId: "T012345", channelId: "C012345" },
    },
    cleanup: { "github-issue-labels": ["restore-github-labels"], "slack-topic": ["restore-slack-topic"] },
    metadata: {},
    secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN", slackCredential: "file:C:/does-not-exist/private-token" },
  }), "utf8");
  const result = await initializeCertification({ configPath });
  return result.workspace;
}

test("preflight is selected-scenario-only and never resolves or discloses secrets", async () => {
  const root = await workspace();
  process.env.REELIER_GITHUB_TOKEN = "must-never-appear";
  try {
    const report = await preflightCertification({ workspace: root, scenario: "github-issue-labels" });
    const serialized = JSON.stringify(report);
    assert.deepEqual(report.scenarios, ["github-issue-labels"]);
    assert.deepEqual(report.credentialReferences, [{ slot: "githubCredential", status: "configured" }]);
    assert.doesNotMatch(serialized, /slack|REELIER_GITHUB_TOKEN|must-never-appear|does-not-exist|private-token/i);
    assert.equal(report.completeness, "unchecked");
  } finally { delete process.env.REELIER_GITHUB_TOKEN; }
});

test("preflight refuses empty runner and test placeholders as semantically absent", async () => {
  const root = await workspace();
  const absent = await preflightCertification({ workspace: root, scenario: "github-issue-labels" });
  assert.deepEqual(absent.inputs, { runners: { status: "absent", artifacts: [] }, tests: { status: "absent", artifacts: [] }, plans: { status: "absent", artifacts: [] } });
  await mkdir(path.join(root, "inputs", "runners"), { recursive: true });
  await mkdir(path.join(root, "inputs", "tests"), { recursive: true });
  await writeFile(path.join(root, "inputs", "runners", "github-issue-labels.json"), "{}", "utf8");
  await writeFile(path.join(root, "inputs", "tests", "github-issue-labels.json"), "[]", "utf8");
  const placeholders = await preflightCertification({ workspace: root, scenario: "github-issue-labels" });
  assert.deepEqual(placeholders.inputs, { runners: { status: "absent", artifacts: [] }, tests: { status: "absent", artifacts: [] }, plans: { status: "absent", artifacts: [] } });
  assert.equal(placeholders.preparationReady, false);
  assert.deepEqual(placeholders.missing.filter(item => item.startsWith("inputs:")), [
    "inputs:plans:github-issue-labels",
    "inputs:runners:github-issue-labels",
    "inputs:tests:github-issue-labels",
  ]);
});

test("preflight accepts only closed scenario-bound runner and test manifests", async () => {
  const root = await workspace();
  const runnerDirectory = path.join(root, "inputs", "runners");
  await writeCertificationInputManifests(root, ["github-issue-labels"]);
  const ready = await preflightCertification({ workspace: root, scenario: "github-issue-labels" });
  assert.equal(ready.inputs.runners.status, "configured");
  assert.equal(ready.inputs.tests.status, "configured");
  assert.equal(ready.inputs.plans.status, "configured");

  const runner = JSON.parse(await import("node:fs/promises").then(module => module.readFile(path.join(runnerDirectory, "github-issue-labels.json"), "utf8")));
  await writeFile(path.join(runnerDirectory, "github-issue-labels.json"), JSON.stringify({ ...runner, scenarioId: "slack-topic", extra: true }), "utf8");
  const substituted = await preflightCertification({ workspace: root, scenario: "github-issue-labels" });
  assert.equal(substituted.inputs.runners.status, "absent");
  assert.equal(substituted.preparationReady, false);
});

test("preflight never inventories artifacts mapped to an unselected scenario", async () => {
  const root = await workspace();
  await writeCertificationInputManifests(root, ["github-issue-labels", "slack-topic"]);
  const report = await preflightCertification({ workspace: root, scenario: "github-issue-labels" });
  assert.deepEqual(report.inputs.runners.artifacts.map(item => item.name), ["github-issue-labels.json"]);
  assert.deepEqual(report.inputs.tests.artifacts.map(item => item.name), ["github-issue-labels.json"]);
  assert.deepEqual(report.inputs.plans.artifacts.map(item => item.name), ["github-issue-labels.json"]);
  assert.doesNotMatch(JSON.stringify(report), /slack-topic/);
});

test("preflight requires an explicit exact scenario or all selection", async () => {
  const root = await workspace();
  await assert.rejects(() => preflightCertification({ workspace: root }), /exactly one.*scenario.*all/i);
  await assert.rejects(() => preflightCertification({ workspace: root, scenario: "github-issue-labels", all: true }), /exactly one.*scenario.*all/i);
});

test("preflight refuses scenario substitution", async () => {
  const root = await workspace();
  await assert.rejects(() => preflightCertification({ workspace: root, scenario: "cloudflare-dns" }), /not selected/);
});
