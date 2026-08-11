import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeCertification } from "../../src/authority/certification/initializer.js";
import { preflightCertification } from "../../src/authority/certification/preflight.js";
import { sealCertificationReadiness } from "../../src/authority/certification/readiness.js";

async function initialized(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-fs-"));
  const configPath = path.join(root, "certification.local.json");
  await writeFile(configPath, JSON.stringify({
    v: "reelier.certification-operator-config/v2", authorityConfigPath: "C:/private/AUTHORITY_PATH_CANARY", evidenceDirectory: "C:/private/EVIDENCE_PATH_CANARY",
    scenarios: ["github-issue-labels"], resources: { "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 } },
    cleanup: { "github-issue-labels": ["restore-github-labels"] }, metadata: {}, secretReferences: { githubCredential: "file:C:/private/TOKEN_PATH_CANARY" },
  }), "utf8");
  return (await initializeCertification({ configPath })).workspace;
}

test("preflight refuses a linked runner directory without reading its external canary", async () => {
  const workspace = await initialized();
  const external = await mkdtemp(path.join(tmpdir(), "reelier-cert-external-read-"));
  await writeFile(path.join(external, "github-issue-labels.json"), "EXTERNAL_READ_CANARY", "utf8");
  await mkdir(path.join(workspace, "inputs"), { recursive: true });
  await symlink(external, path.join(workspace, "inputs", "runners"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => preflightCertification({ workspace, scenario: "github-issue-labels" }), /linked|symlink|reparse|confined/i);
});

test("preflight refuses a selected artifact symlink when file symlinks are supported", async () => {
  const workspace = await initialized();
  const external = path.join(await mkdtemp(path.join(tmpdir(), "reelier-cert-external-file-")), "canary.json");
  await writeFile(external, "EXTERNAL_FILE_CANARY", "utf8");
  await mkdir(path.join(workspace, "inputs", "runners"), { recursive: true });
  try {
    await symlink(external, path.join(workspace, "inputs", "runners", "github-issue-labels.json"), "file");
  } catch (error) {
    assert.equal(process.platform, "win32");
    assert.match(String((error as NodeJS.ErrnoException).code), /EPERM|EACCES/);
    return;
  }
  await assert.rejects(() => preflightCertification({ workspace, scenario: "github-issue-labels" }), /linked|symlink|reparse|confined/i);
});

test("readiness refuses a linked output directory and performs no external write", async () => {
  const workspace = await initialized();
  await mkdir(path.join(workspace, "inputs", "runners"), { recursive: true });
  await mkdir(path.join(workspace, "inputs", "tests"), { recursive: true });
  await writeFile(path.join(workspace, "inputs", "runners", "github-issue-labels.json"), "{}", "utf8");
  await writeFile(path.join(workspace, "inputs", "tests", "github-issue-labels.json"), "[]", "utf8");
  const external = await mkdtemp(path.join(tmpdir(), "reelier-cert-external-write-"));
  await symlink(external, path.join(workspace, "readiness"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => sealCertificationReadiness({ workspace, scenario: "github-issue-labels" }), /linked|symlink|reparse|confined/i);
  assert.deepEqual(await readdir(external), []);
  await assert.doesNotReject(() => access(external));
});
