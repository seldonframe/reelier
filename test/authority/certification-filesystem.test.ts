import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeCertification } from "../../src/authority/certification/initializer.js";
import { preflightCertification } from "../../src/authority/certification/preflight.js";
import { sealCertificationReadiness } from "../../src/authority/certification/readiness.js";
import { assertUnlinkedCreationParent, certificationWorkspaceRoot, readUnlinkedFile } from "../../src/authority/certification/filesystem.js";
import { writeCertificationInputManifests } from "./certification-input-fixture.js";

if (false) {
  // @ts-expect-error deterministic race hooks are test concerns, never production ABI
  void certificationWorkspaceRoot("workspace", { afterAncestry: async () => undefined });
  // @ts-expect-error deterministic race hooks are test concerns, never production ABI
  void assertUnlinkedCreationParent("workspace", { afterAncestry: async () => undefined });
}

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
  await writeCertificationInputManifests(workspace, ["github-issue-labels"]);
  const external = await mkdtemp(path.join(tmpdir(), "reelier-cert-external-write-"));
  await symlink(external, path.join(workspace, "readiness"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => sealCertificationReadiness({ workspace, scenario: "github-issue-labels" }), /linked|symlink|reparse|confined/i);
  assert.deepEqual(await readdir(external), []);
  await assert.doesNotReject(() => access(external));
});

test("static local confinement never upgrades filesystem trust", async () => {
  const workspace = await initialized();
  const report = await preflightCertification({ workspace, scenario: "github-issue-labels" });
  assert.equal(report.trust, "unchecked");
  assert.doesNotMatch(JSON.stringify(report), /verified/i);
});

test("directory trust and confined reads allow ordinary Windows 8.3 and case aliases", async t => {
  if (process.platform !== "win32") { t.skip("Windows short-name behavior"); return; }
  const aliasRoot = await findWindowsShortAliasRoot();
  if (!aliasRoot) { t.skip("no writable short-name alias is available on this volume"); return; }
  const root = await mkdtemp(path.join(aliasRoot, "reelier-cert-short-alias-"));
  const file = path.join(root, "config.json");
  await writeFile(file, "SHORT_ALIAS_CANARY", "utf8");
  assert.equal((await readUnlinkedFile(file)).toString("utf8"), "SHORT_ALIAS_CANARY");
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  assert.equal((await certificationWorkspaceRoot(workspace.toUpperCase())).toLowerCase(), (await realpath(workspace)).toLowerCase());
  assert.equal((await assertUnlinkedCreationParent(path.join(root.toUpperCase(), "future-workspace"))).toLowerCase(), (await realpath(root)).toLowerCase());
});

async function findWindowsShortAliasRoot(): Promise<string | undefined> {
  const requestedTemp = path.resolve(tmpdir());
  const candidates = [requestedTemp];
  const parent = path.dirname(requestedTemp);
  for (const entry of await readdir(parent, { withFileTypes: true })) if (entry.isDirectory()) candidates.push(path.join(parent, entry.name));
  for (const candidate of candidates) {
    try {
      if (/\s/.test(candidate)) continue;
      const short = execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", `for %I in (${candidate}) do @echo %~sI`], { encoding: "utf8" }).trim();
      if (short && short.toLowerCase() !== (await realpath(short)).toLowerCase()) return short;
    } catch { /* This candidate has no accessible short spelling. */ }
  }
  return undefined;
}
