import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeCertification } from "../../src/authority/certification/initializer.js";
import { sealCertificationReadiness } from "../../src/authority/certification/readiness.js";
import { exportCertificationEvidence, verifyCertificationExport } from "../../src/authority/certification/export.js";

async function initializedWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-export-"));
  const configPath = path.join(root, "certification.local.json");
  await writeFile(configPath, JSON.stringify({
    v: "reelier.certification-operator-config/v2", authorityConfigPath: "authority/authority.yml", evidenceDirectory: "authority/receipts/certification",
    scenarios: ["github-issue-labels"], resources: { "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 } },
    cleanup: { "github-issue-labels": ["restore-github-labels"] }, metadata: {}, secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN" },
  }), "utf8");
  const workspace = (await initializeCertification({ configPath })).workspace;
  await mkdir(path.join(workspace, "inputs", "runners"), { recursive: true });
  await mkdir(path.join(workspace, "inputs", "tests"), { recursive: true });
  await writeFile(path.join(workspace, "inputs", "runners", "github-issue-labels.json"), "{}", "utf8");
  await writeFile(path.join(workspace, "inputs", "tests", "github-issue-labels.json"), "[]", "utf8");
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
