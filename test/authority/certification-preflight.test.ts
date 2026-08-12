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
    v: "reelier.certification-operator-config/v3",
    authorityConfigPath: "authority/authority.yml",
    evidenceDirectory: "authority/receipts/certification",
    scenarios: ["github-issue-labels", "slack-topic"],
    resources: {
      "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 },
      "slack-topic": { apiBaseUrl: "https://slack.com", teamId: "T012345", channelId: "C012345" },
    },
    cleanup: { "github-issue-labels": ["restore-github-labels"], "slack-topic": ["restore-slack-topic"] },
    desiredState: { "github-issue-labels": { labels: ["certification-after"] }, "slack-topic": { topic: "Certification after" } },
    metadata: {},
    secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN", slackCredential: "file:secrets/does-not-exist-private-token" },
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

test("preflight rejects request accessors without invoking them", async () => {
  let calls = 0;
  const request = Object.create(Object.prototype, {
    workspace: { enumerable: true, configurable: true, get: () => { calls += 1; return "C:/must-not-be-read"; } },
    all: { enumerable: true, configurable: true, writable: true, value: true },
  });
  await assert.rejects(() => preflightCertification(request), /inert|accessor|closed/i);
  assert.equal(calls, 0);
});

test("preflight refuses empty runner and test placeholders as semantically absent", async () => {
  const root = await workspace();
  const absent = await preflightCertification({ workspace: root, scenario: "github-issue-labels" });
  assert.equal(absent.inputs.runners.status, "absent");
  assert.equal(absent.inputs.tests.status, "absent");
  assert.equal(absent.inputs.plans.status, "absent");
  assert.equal(absent.inputs.endpoints.status, "configured");
  await mkdir(path.join(root, "inputs", "runners"), { recursive: true });
  await mkdir(path.join(root, "inputs", "tests"), { recursive: true });
  await writeFile(path.join(root, "inputs", "runners", "github-issue-labels.json"), "{}", "utf8");
  await writeFile(path.join(root, "inputs", "tests", "github-issue-labels.json"), "[]", "utf8");
  const placeholders = await preflightCertification({ workspace: root, scenario: "github-issue-labels" });
  assert.equal(placeholders.inputs.runners.status, "absent");
  assert.equal(placeholders.inputs.tests.status, "absent");
  assert.equal(placeholders.inputs.plans.status, "absent");
  assert.equal(placeholders.inputs.endpoints.status, "configured");
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

test("v1 runner manifests remain parseable but cannot satisfy dispatch readiness", async () => {
  const root = await workspace();
  const runnerDirectory = path.join(root, "inputs", "runners");
  const testDirectory = path.join(root, "inputs", "tests");
  await mkdir(runnerDirectory, { recursive: true });
  await mkdir(testDirectory, { recursive: true });
  const runner = { v: "reelier.certification-runner-manifest/v1", scenarioId: "github-issue-labels", runnerId: "legacy_runner", endpointManifestDigest: `sha256:${"1".repeat(64)}`, implementationDigest: `sha256:${"2".repeat(64)}`, operations: ["prepare", "authoritative-read", "compile", "reserve", "reread", "dispatch", "reconcile", "receipt", "cleanup"] };
  await writeFile(path.join(runnerDirectory, "github-issue-labels.json"), JSON.stringify(runner), "utf8");
  const report = await preflightCertification({ workspace: root, scenario: "github-issue-labels" });
  assert.equal(report.inputs.runners.status, "absent");
  assert.equal(report.preparationReady, false);
  assert.match(report.missing.join(" "), /inputs:runners/);
});

test("preflight rejects executable dependency injection and performs zero provider credential dispatch or budget calls", async () => {
  const root = await workspace();
  let providerCalls = 0, credentialCalls = 0, dispatchCalls = 0, budgetCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { providerCalls += 1; throw new Error("must not fetch"); }) as typeof fetch;
  try {
    await assert.rejects(() => preflightCertification({
      workspace: root,
      scenario: "github-issue-labels",
      provider: () => { providerCalls += 1; },
      credentialResolver: () => { credentialCalls += 1; },
      dispatchAdapter: () => { dispatchCalls += 1; },
      budgetLedger: () => { budgetCalls += 1; },
    } as never), /closed|callback|executable/i);
  } finally { globalThis.fetch = originalFetch; }
  assert.deepEqual({ providerCalls, credentialCalls, dispatchCalls, budgetCalls }, { providerCalls: 0, credentialCalls: 0, dispatchCalls: 0, budgetCalls: 0 });
});

test("preflight refuses forged runner test endpoint plan and registry bindings", async () => {
  const root = await workspace();
  await writeCertificationInputManifests(root, ["github-issue-labels"]);
  const files = {
    runner: path.join(root, "inputs", "runners", "github-issue-labels.json"),
    tests: path.join(root, "inputs", "tests", "github-issue-labels.json"),
    plan: path.join(root, "inputs", "plans", "github-issue-labels.json"),
    endpoint: path.join(root, "authority", "endpoints", "github-issue-labels.json"),
  };
  const fs = await import("node:fs/promises");
  const originals = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await fs.readFile(file, "utf8")]))) as Record<keyof typeof files, string>;
  const cases: readonly [keyof typeof files, (raw: any) => void, string][] = [
    ["runner", raw => { raw.metadataDigest = `sha256:${"9".repeat(64)}`; }, "runners"],
    ["tests", raw => { raw.runnerManifestDigest = `sha256:${"8".repeat(64)}`; }, "tests"],
    ["plan", raw => { raw.testManifestDigest = `sha256:${"7".repeat(64)}`; }, "plans"],
    ["plan", raw => { raw.runnerRegistryDigest = `sha256:${"6".repeat(64)}`; }, "plans"],
    ["endpoint", raw => { raw.endpoints[0].accountCommitment = `sha256:${"5".repeat(64)}`; }, "plans"],
  ];
  for (const [kind, mutate, missingKind] of cases) {
    const raw = JSON.parse(originals[kind]); mutate(raw); await fs.writeFile(files[kind], `${JSON.stringify(raw)}\n`, "utf8");
    const report = await preflightCertification({ workspace: root, scenario: "github-issue-labels" });
    assert.equal(report.preparationReady, false);
    assert.match(report.missing.join(" "), new RegExp(`inputs:${missingKind}:github-issue-labels`));
    await fs.writeFile(files[kind], originals[kind], "utf8");
  }
});

test("configured metadata never becomes provider execution readiness in Task 4A", async () => {
  const root = await workspace();
  await writeCertificationInputManifests(root, ["github-issue-labels"]);
  const report = await preflightCertification({ workspace: root, scenario: "github-issue-labels" });
  assert.equal(report.preparationReady, true);
  assert.equal(report.executionReady, false);
  assert.equal(report.dispatchable, false);
});

test("duplicate runner test endpoint and plan artifacts each refuse preparation", async () => {
  const fs = await import("node:fs/promises");
  for (const kind of ["runners", "tests", "plans", "endpoints"] as const) {
    const root = await workspace();
    await writeCertificationInputManifests(root, ["github-issue-labels"]);
    const base = kind === "endpoints" ? path.join(root, "authority", "endpoints") : path.join(root, "inputs", kind);
    const source = path.join(base, "github-issue-labels.json");
    await fs.copyFile(source, path.join(base, "github-issue-labels--duplicate.json"));
    const report = await preflightCertification({ workspace: root, scenario: "github-issue-labels" });
    assert.equal(report.preparationReady, false, kind);
    assert.match(report.missing.join(" "), new RegExp(`inputs:${kind}:github-issue-labels`), kind);
  }
});

test("malformed matching runner test endpoint and plan duplicates still refuse preparation", async () => {
  const fs = await import("node:fs/promises");
  for (const kind of ["runners", "tests", "plans", "endpoints"] as const) {
    const root = await workspace();
    await writeCertificationInputManifests(root, ["github-issue-labels"]);
    const base = kind === "endpoints" ? path.join(root, "authority", "endpoints") : path.join(root, "inputs", kind);
    await fs.writeFile(path.join(base, "github-issue-labels--malformed.json"), "{not-json", "utf8");
    const report = await preflightCertification({ workspace: root, scenario: "github-issue-labels" });
    assert.equal(report.preparationReady, false, kind);
    assert.match(report.missing.join(" "), new RegExp(`inputs:${kind}:github-issue-labels`), kind);
  }
});
