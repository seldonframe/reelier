import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeCertification } from "../../src/authority/certification/initializer.js";

function config(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: "reelier.certification-operator-config/v2",
    authorityConfigPath: "authority/authority.yml",
    evidenceDirectory: "authority/receipts/certification",
    scenarios: ["github-issue-labels"],
    resources: { "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 } },
    cleanup: { "github-issue-labels": ["restore-github-labels"] },
    metadata: {},
    secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN" },
    ...extra,
  };
}

test("certification init validates before atomic publication and leaves no partial workspace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-init-invalid-"));
  const configPath = path.join(root, "certification.local.json");
  const workspace = path.join(root, "certification");
  await writeFile(configPath, JSON.stringify(config({ unexpected: true })), "utf8");

  await assert.rejects(() => initializeCertification({ configPath, workspace }), /closed/);
  await assert.rejects(() => access(workspace));
  const siblings = await import("node:fs/promises").then(fs => fs.readdir(root));
  assert.deepEqual(siblings, ["certification.local.json"]);
});

test("certification init generates deterministic internal identifiers and resumes idempotently", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-init-resume-"));
  const configPath = path.join(root, "certification.local.json");
  const workspace = path.join(root, "certification");
  await writeFile(configPath, JSON.stringify(config()), "utf8");

  const initialized = await initializeCertification({ configPath, workspace });
  const resumed = await initializeCertification({ configPath, workspace });
  assert.equal(initialized.status, "initialized");
  assert.equal(resumed.status, "resumed");
  assert.deepEqual(resumed.identifiers, initialized.identifiers);
  assert.match(initialized.identifiers.taskId, /^task_[0-9a-f]{24}$/);
  assert.match(initialized.identifiers.jobCardId, /^job_[0-9a-f]{24}$/);
  assert.match(initialized.identifiers.rootGrantId, /^grant_[0-9a-f]{24}$/);
  assert.match(initialized.identifiers.authorityCellId, /^cell_[0-9a-f]{24}$/);
  assert.match(initialized.identifiers.signerId, /^signer_[0-9a-f]{24}$/);
  const snapshot = await readFile(path.join(workspace, "config.json"), "utf8");
  assert.doesNotMatch(snapshot, /taskId|jobCardId|rootGrantId|authorityCellId|signerId/);
});

test("concurrent identical certification init converges on one atomic workspace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-init-concurrent-"));
  const configPath = path.join(root, "certification.local.json");
  const workspace = path.join(root, "certification");
  await writeFile(configPath, JSON.stringify(config()), "utf8");
  const results = await Promise.all([
    initializeCertification({ configPath, workspace }),
    initializeCertification({ configPath, workspace }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), ["initialized", "resumed"]);
  assert.deepEqual(results[0].identifiers, results[1].identifiers);
});
