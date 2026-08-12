import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeCertification } from "../../src/authority/certification/initializer.js";
import { sealCertificationReadiness } from "../../src/authority/certification/readiness.js";
import { writeCertificationInputManifests } from "./certification-input-fixture.js";

test("readiness sealing creates an immutable unsigned non-dispatchable content-addressed candidate", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-readiness-"));
  const configPath = path.join(root, "certification.local.json");
  await writeFile(configPath, JSON.stringify({
    v: "reelier.certification-operator-config/v3", authorityConfigPath: "authority/authority.yml", evidenceDirectory: "authority/receipts/certification",
    scenarios: ["github-issue-labels"], resources: { "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 } },
    cleanup: { "github-issue-labels": ["restore-github-labels"] }, desiredState: { "github-issue-labels": { labels: ["certification-after"] } }, metadata: {}, secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN" },
  }), "utf8");
  const initialized = await initializeCertification({ configPath });
  await writeCertificationInputManifests(initialized.workspace, ["github-issue-labels"]);
  const first = await sealCertificationReadiness({ workspace: initialized.workspace, scenario: "github-issue-labels" });
  const second = await sealCertificationReadiness({ workspace: initialized.workspace, scenario: "github-issue-labels" });
  assert.equal(second.path, first.path);
  assert.equal(second.digest, first.digest);
  assert.equal(first.candidate.status, "awaiting-human-signature");
  assert.equal(first.candidate.preparationReady, true);
  assert.equal(first.candidate.signatureStatus, "absent");
  assert.equal(first.candidate.authorization, "absent");
  assert.equal(first.candidate.dispatchable, false);
  assert.equal(first.candidate.completeness, "unchecked");
  assert.deepEqual(first.candidate.identifiers, initialized.identifiers);
  assert.match(path.basename(first.path), /^readiness-sha256-[0-9a-f]{64}\.json$/);
  const raw = JSON.parse(await readFile(first.path, "utf8"));
  raw.dispatchable = true;
  await chmod(first.path, 0o600);
  await writeFile(first.path, JSON.stringify(raw), "utf8");
  await assert.rejects(() => sealCertificationReadiness({ workspace: initialized.workspace, scenario: "github-issue-labels" }), /candidate.*mismatch|immutable/i);
});

test("readiness sealing refuses incomplete preparation without converting a later gate into success", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-readiness-incomplete-"));
  const configPath = path.join(root, "certification.local.json");
  await writeFile(configPath, JSON.stringify({
    v: "reelier.certification-operator-config/v3", authorityConfigPath: "authority/authority.yml", evidenceDirectory: "authority/receipts/certification",
    scenarios: ["github-issue-labels"], resources: { "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 } },
    cleanup: { "github-issue-labels": ["restore-github-labels"] }, desiredState: {}, metadata: {}, secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN" },
  }), "utf8");
  const initialized = await initializeCertification({ configPath });
  await assert.rejects(() => sealCertificationReadiness({ workspace: initialized.workspace, scenario: "github-issue-labels" }), /preparation.*incomplete/i);
});
