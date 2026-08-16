import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeCertification } from "../../src/authority/certification/initializer.js";
import { parseCertificationInitialization } from "../../src/authority/certification/initializer.js";
import { preflightCertification } from "../../src/authority/certification/preflight.js";
import { sealCertificationReadiness } from "../../src/authority/certification/readiness.js";
import { exportCertificationEvidence, verifyCertificationExport } from "../../src/authority/certification/export.js";
import { authorityDigest } from "../../src/authority/wire.js";
import { writeCertificationInputManifests } from "./certification-input-fixture.js";

async function initializedWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-export-"));
  const configPath = path.join(root, "certification.local.json");
  await writeFile(configPath, JSON.stringify({
    v: "reelier.certification-operator-config/v3", authorityConfigPath: "authority/authority.yml", evidenceDirectory: "authority/receipts/certification",
    scenarios: ["github-issue-labels"], resources: { "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 } },
    cleanup: { "github-issue-labels": ["restore-github-labels"] }, desiredState: { "github-issue-labels": { labels: ["certification-after"] } }, metadata: {}, secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN" },
  }), "utf8");
  const workspace = (await initializeCertification({ configPath })).workspace;
  await writeCertificationInputManifests(workspace, ["github-issue-labels"]);
  return workspace;
}

test("certification export is a closed linked package that verifies offline without authority claims", async () => {
  const workspace = await initializedWorkspace();
  const exported = await exportCertificationEvidence({ workspace, scenario: "github-issue-labels" });
  const fromDisk = JSON.parse(await readFile(exported.path, "utf8"));
  const verified = verifyCertificationExport(fromDisk);
  assert.equal(verified.digest, exported.digest);
  assert.deepEqual(verified.claims, { providerCertification: "unchecked", signatureVerification: "unchecked", completion: "unchecked", completeness: "unchecked" });
  assert.equal(verified.authorization, "absent");
  assert.equal(verified.dispatchable, false);
  const permissions = (await stat(exported.path)).mode & 0o777;
  if (process.platform === "win32") assert.notEqual(permissions & 0o200, 0);
  else assert.equal(permissions & 0o077, 0);
  const serialized = JSON.stringify(fromDisk);
  assert.doesNotMatch(serialized, /REELIER_GITHUB_TOKEN|authority\/authority\.yml|authority\/receipts\/certification/);
});

test("offline artifact parsing rejects adversarial nested arrays without invoking index getters", async t => {
  const workspace = await initializedWorkspace();
  const exported = await exportCertificationEvidence({ workspace, scenario: "github-issue-labels" });
  const original = JSON.parse(await readFile(exported.path, "utf8"));
  const cases: readonly [string, (bundle: any, value: unknown[]) => void][] = [
    ["manifest scenarios", (bundle, value) => { bundle.manifest.scenarios = value; }],
    ["initialization scenarios", (bundle, value) => { bundle.artifacts.initialization.scenarios = value; }],
    ["projected cleanup", (bundle, value) => { bundle.artifacts.config.cleanup["github-issue-labels"] = value; }],
    ["projected metadata", (bundle, value) => { bundle.artifacts.config.metadata = value; }],
    ["projected credentials", (bundle, value) => { bundle.artifacts.config.credentialReferences = value; }],
    ["projected desired state", (bundle, value) => { bundle.artifacts.config.desiredState["github-issue-labels"] = value; }],
    ["preflight scenarios", (bundle, value) => { bundle.artifacts.preflight.scenarios = value; }],
    ["preflight resources", (bundle, value) => { bundle.artifacts.preflight.resources = value; }],
    ["preflight artifacts", (bundle, value) => { bundle.artifacts.preflight.inputs.runners.artifacts = value; }],
    ["readiness scenarios", (bundle, value) => { bundle.artifacts.readiness.scenarios = value; }],
    ["readiness resources", (bundle, value) => { bundle.artifacts.readiness.commitments.resources = value; }],
  ];
  for (const [label, mutate] of cases) await t.test(label, () => {
    const bundle = structuredClone(original);
    let getterCalls = 0;
    const value = new Array(1);
    Object.defineProperty(value, "0", { enumerable: true, configurable: true, get: () => { getterCalls += 1; return "attacker"; } });
    mutate(bundle, value);
    assert.throws(() => verifyCertificationExport(bundle));
    assert.equal(getterCalls, 0);
  });
});

test("initialization scenarios require a dense enumerable symbol-free ordinary array", async t => {
  const workspace = await initializedWorkspace();
  const initialization = JSON.parse(await readFile(path.join(workspace, "initialization.json"), "utf8"));
  const variants: readonly [string, () => unknown[]][] = [
    ["index getter", () => { const value = new Array(1); Object.defineProperty(value, "0", { enumerable: true, get: () => "github-issue-labels" }); return value; }],
    ["sparse", () => new Array(1)],
    ["non-enumerable index", () => { const value: unknown[] = []; Object.defineProperty(value, "0", { enumerable: false, value: "github-issue-labels" }); value.length = 1; return value; }],
    ["symbol property", () => { const value = ["github-issue-labels"]; Object.defineProperty(value, Symbol("authority"), { value: true }); return value; }],
    ["custom prototype", () => { const value = ["github-issue-labels"]; Object.setPrototypeOf(value, Object.create(Array.prototype)); return value; }],
  ];
  for (const [label, create] of variants) await t.test(label, () => {
    assert.throws(() => parseCertificationInitialization({ ...initialization, scenarios: create() }), /array|inert|dense/i);
  });
});

test("subset preparation preserves the immutable two-scenario initialization root and identifiers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-export-subset-"));
  const configPath = path.join(root, "certification.local.json");
  await writeFile(configPath, JSON.stringify({
    v: "reelier.certification-operator-config/v3", authorityConfigPath: "authority/authority.yml", evidenceDirectory: "authority/receipts/certification",
    scenarios: ["github-issue-labels", "slack-topic"],
    resources: {
      "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 },
      "slack-topic": { apiBaseUrl: "https://slack.com", teamId: "T012345", channelId: "C012345" },
    },
    cleanup: { "github-issue-labels": ["restore-github-labels"], "slack-topic": ["restore-slack-topic"] }, desiredState: { "github-issue-labels": { labels: ["certification-after"] }, "slack-topic": { topic: "Certification after" } }, metadata: {},
    secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN", slackCredential: "env:REELIER_SLACK_TOKEN" },
  }), "utf8");
  const initialized = await initializeCertification({ configPath });
  const initializationBytes = await readFile(path.join(initialized.workspace, "initialization.json"), "utf8");
  const initialization = JSON.parse(initializationBytes);
  await writeCertificationInputManifests(initialized.workspace, ["github-issue-labels", "slack-topic"]);

  const preflight = await preflightCertification({ workspace: initialized.workspace, scenario: "github-issue-labels" });
  const sealed = await sealCertificationReadiness({ workspace: initialized.workspace, scenario: "github-issue-labels" });
  const exported = await exportCertificationEvidence({ workspace: initialized.workspace, scenario: "github-issue-labels" });
  const bundle = JSON.parse(await readFile(exported.path, "utf8"));
  assert.doesNotThrow(() => verifyCertificationExport(bundle));
  assert.equal(preflight.configDigest, initialization.configDigest);
  assert.equal(sealed.candidate.configDigest, initialization.configDigest);
  assert.equal(bundle.artifacts.initialization.configDigest, initialization.configDigest);
  assert.deepEqual(preflight.identifiers, initialization.identifiers);
  assert.deepEqual(sealed.candidate.identifiers, initialization.identifiers);
  assert.deepEqual(bundle.artifacts.initialization.identifiers, initialization.identifiers);
  assert.deepEqual(bundle.artifacts.initialization.scenarios, ["github-issue-labels", "slack-topic"]);
  assert.equal(`${JSON.stringify(bundle.artifacts.initialization)}\n`, initializationBytes);
  assert.deepEqual(bundle.manifest.scenarios, ["github-issue-labels"]);
  assert.deepEqual(bundle.artifacts.preflight.inputs.runners.artifacts.map((item: any) => item.name), ["github-issue-labels.json"]);
  assert.deepEqual(bundle.artifacts.preflight.inputs.tests.artifacts.map((item: any) => item.name), ["github-issue-labels.json"]);
  assert.doesNotMatch(JSON.stringify(bundle.artifacts.config), /slack-topic/);

  const incoherentSubset = structuredClone(bundle);
  incoherentSubset.artifacts.initialization.scenarios = ["slack-topic"];
  incoherentSubset.manifest.artifactDigests.initialization = authorityDigest(incoherentSubset.artifacts.initialization);
  incoherentSubset.digest = authorityDigest({ v: incoherentSubset.v, manifest: incoherentSubset.manifest, artifacts: incoherentSubset.artifacts });
  assert.throws(() => verifyCertificationExport(incoherentSubset), /selection.*initialization|subset/i);
});

test("offline verification recomputes generated IDs and semantic preflight fields after every digest is reforged", async () => {
  const workspace = await initializedWorkspace();
  const exported = await exportCertificationEvidence({ workspace, scenario: "github-issue-labels" });
  const original = JSON.parse(await readFile(exported.path, "utf8"));
  const rehash = (bundle: any): any => {
    bundle.artifacts.preflight.digest = authorityDigest(Object.fromEntries(Object.entries(bundle.artifacts.preflight).filter(([key]) => key !== "digest")));
    bundle.artifacts.readiness.preflightDigest = bundle.artifacts.preflight.digest;
    bundle.manifest.artifactDigests.config = authorityDigest(bundle.artifacts.config);
    bundle.manifest.artifactDigests.initialization = authorityDigest(bundle.artifacts.initialization);
    bundle.manifest.artifactDigests.preflight = authorityDigest(bundle.artifacts.preflight);
    bundle.manifest.artifactDigests.readiness = authorityDigest(bundle.artifacts.readiness);
    bundle.digest = authorityDigest({ v: bundle.v, manifest: bundle.manifest, artifacts: bundle.artifacts });
    return bundle;
  };
  const forgedId = JSON.parse(JSON.stringify(original));
  forgedId.artifacts.initialization.identifiers.taskId = "task_" + "0".repeat(24);
  forgedId.artifacts.readiness.identifiers.taskId = "task_" + "0".repeat(24);
  assert.throws(() => verifyCertificationExport(rehash(forgedId)), /identifier.*derivation|generated identifier/i);

  const forgedPreflight = JSON.parse(JSON.stringify(original));
  forgedPreflight.artifacts.preflight.missing = ["resource:github-issue-labels"];
  forgedPreflight.artifacts.preflight.ok = true;
  forgedPreflight.artifacts.preflight.preparationReady = true;
  assert.throws(() => verifyCertificationExport(rehash(forgedPreflight)), /preflight.*semantic|missing.*mismatch/i);

  const forgedInputStatus = JSON.parse(JSON.stringify(original));
  forgedInputStatus.artifacts.preflight.inputs.runners.status = "absent";
  forgedInputStatus.artifacts.readiness.commitments.runners.status = "absent";
  assert.throws(() => verifyCertificationExport(rehash(forgedInputStatus)), /preflight.*semantic|input.*status/i);

  const substitutedProjection = JSON.parse(JSON.stringify(original));
  substitutedProjection.artifacts.config.resources["github-issue-labels"].owner = "substituted-owner";
  const replacementResourceDigest = authorityDigest(substitutedProjection.artifacts.config.resources["github-issue-labels"]);
  substitutedProjection.artifacts.preflight.resources[0].digest = replacementResourceDigest;
  substitutedProjection.artifacts.readiness.commitments.resources[0].digest = replacementResourceDigest;
  assert.throws(() => verifyCertificationExport(rehash(substitutedProjection)), /config.*commitment|projection.*digest/i);
});

test("export refuses deterministic input drift between its bound snapshot and publication", async () => {
  const workspace = await initializedWorkspace();
  const runner = path.join(workspace, "inputs", "runners", "github-issue-labels.json");
  await assert.rejects(() => exportCertificationEvidence({
    workspace,
    scenario: "github-issue-labels",
    hooks: { afterPreflight: async () => { await writeFile(runner, JSON.stringify({ changed: true }), "utf8"); } },
  }), /input.*drift|snapshot.*changed/i);
  await assert.rejects(() => import("node:fs/promises").then(fs => fs.access(path.join(workspace, "exports"))));
});

test("offline verification rejects deep tampering, substitution, missing links, and open schemas", async () => {
  const workspace = await initializedWorkspace();
  const exported = await exportCertificationEvidence({ workspace, scenario: "github-issue-labels" });
  const original = JSON.parse(await readFile(exported.path, "utf8"));
  const mutate = (fn: (value: any) => void) => { const copy = JSON.parse(JSON.stringify(original)); fn(copy); return copy; };
  assert.throws(() => verifyCertificationExport(mutate(value => { value.artifacts.readiness.commitments.resources[0].digest = "sha256:" + "0".repeat(64); })), /digest|link/);
  assert.throws(() => verifyCertificationExport(mutate(value => { value.artifacts.initialization.identifiers.taskId = "task_" + "0".repeat(24); })), /digest|link/);
  assert.throws(() => verifyCertificationExport(mutate(value => { delete value.manifest.artifactDigests.config; })), /closed|link/);
  assert.throws(() => verifyCertificationExport(mutate(value => { value.artifacts.preflight.unexpected = true; })), /closed/);
});

test("an unsigned readiness candidate is never accepted as authority or as an export", async () => {
  const workspace = await initializedWorkspace();
  const sealed = await sealCertificationReadiness({ workspace, scenario: "github-issue-labels" });
  assert.throws(() => verifyCertificationExport(sealed.candidate), /export/);
});
