import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeCertification } from "../../src/authority/certification/initializer.js";
import { preflightCertification } from "../../src/authority/certification/preflight.js";

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
  assert.deepEqual(absent.inputs, { runners: { status: "absent", artifacts: [] }, tests: { status: "absent", artifacts: [] } });
  await mkdir(path.join(root, "inputs", "runners"), { recursive: true });
  await mkdir(path.join(root, "inputs", "tests"), { recursive: true });
  await writeFile(path.join(root, "inputs", "runners", "github-issue-labels.json"), "{}", "utf8");
  await writeFile(path.join(root, "inputs", "tests", "github-issue-labels.json"), "[]", "utf8");
  const placeholders = await preflightCertification({ workspace: root, scenario: "github-issue-labels" });
  assert.deepEqual(placeholders.inputs, { runners: { status: "absent", artifacts: [] }, tests: { status: "absent", artifacts: [] } });
  assert.equal(placeholders.preparationReady, false);
  assert.deepEqual(placeholders.missing.filter(item => item.startsWith("inputs:")), [
    "inputs:runners:github-issue-labels",
    "inputs:tests:github-issue-labels",
  ]);
});

test("preflight never inventories artifacts mapped to an unselected scenario", async () => {
  const root = await workspace();
  await mkdir(path.join(root, "inputs", "runners"), { recursive: true });
  await mkdir(path.join(root, "inputs", "tests"), { recursive: true });
  for (const scenario of ["github-issue-labels", "slack-topic"]) {
    await writeFile(path.join(root, "inputs", "runners", `${scenario}.json`), JSON.stringify({ scenario }), "utf8");
    await writeFile(path.join(root, "inputs", "tests", `${scenario}--conformance.json`), JSON.stringify({ scenario }), "utf8");
  }
  const report = await preflightCertification({ workspace: root, scenario: "github-issue-labels" });
  assert.deepEqual(report.inputs.runners.artifacts.map(item => item.name), ["github-issue-labels.json"]);
  assert.deepEqual(report.inputs.tests.artifacts.map(item => item.name), ["github-issue-labels--conformance.json"]);
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
