import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, realpath, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
  const authority = path.join(workspace, "authority");
  assert.deepEqual((await readdir(authority)).sort(), ["authority.yml", "decisions", "delegation", "deployment", "endpoints", "ledger", "principals", "receipts", "trust"]);
  const authorityConfig = JSON.parse(await readFile(path.join(authority, "authority.yml"), "utf8"));
  assert.equal(authorityConfig.tenant, initialized.identifiers.authorityCellId);
  assert.match(authorityConfig.requester, /^principal_[0-9a-f]{24}$/);
  assert.equal(authorityConfig.ingress.principalRegistryFile, "principals/registry.jsonl");
  assert.equal(authorityConfig.deploymentPath, "deployment/manifest.json");
  assert.equal(authorityConfig.jobCardTrustPinPath, "trust/job-card-trust-pin.json");
  assert.equal(authorityConfig.completeness, "unchecked");
  assert.equal(authorityConfig.dispatchable, false);
  const endpointNames = await readdir(path.join(authority, "endpoints"));
  assert.deepEqual(endpointNames, ["github-issue-labels.json"]);
  const endpoint = JSON.parse(await readFile(path.join(authority, "endpoints", endpointNames[0]), "utf8"));
  assert.equal(endpoint.scenarioId, "github-issue-labels");
  assert.deepEqual(endpoint.credentialSlots, ["githubCredential"]);
  assert.ok(endpoint.endpoints.some((item: { direction: string }) => item.direction === "read"));
  assert.ok(endpoint.endpoints.some((item: { direction: string }) => item.direction === "write"));
  const scaffold = JSON.stringify({ authorityConfig, endpoint });
  assert.doesNotMatch(scaffold, /rat_|bearer|token(?:Value)?|privateKey|providerBody|hubspot/i);
  assert.equal(await readFile(path.join(authority, "principals", "registry.jsonl"), "utf8"), "");
});

test("certification Cell resume refuses an unselected endpoint manifest", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-init-endpoint-substitution-"));
  const configPath = path.join(root, "certification.local.json");
  const workspace = path.join(root, "certification");
  await writeFile(configPath, JSON.stringify(config()), "utf8");
  await initializeCertification({ configPath, workspace });
  await writeFile(path.join(workspace, "authority", "endpoints", "hubspot.json"), JSON.stringify({ bearerToken: "must-not-be-in-scaffold" }), "utf8");
  await assert.rejects(() => initializeCertification({ configPath, workspace }), /selected|endpoint|scaffold/i);
});

test("concurrent identical certification init converges on one atomic workspace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-init-concurrent-"));
  const configPath = path.join(root, "certification.local.json");
  const workspace = path.join(root, "certification");
  await writeFile(configPath, JSON.stringify(config()), "utf8");
  let arrivals = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const beforePublish = async (): Promise<void> => { arrivals += 1; if (arrivals === 2) release(); await barrier; };
  const results = await Promise.all([
    initializeCertification({ configPath, workspace, hooks: { beforePublish } }),
    initializeCertification({ configPath, workspace, hooks: { beforePublish } }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), ["initialized", "resumed"]);
  assert.deepEqual(results[0].identifiers, results[1].identifiers);
  assert.equal(arrivals, 2);
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith(".certification.staging-")), []);
});

test("concurrent identical init through a Windows short alias removes the owned losing stage", async t => {
  if (process.platform !== "win32") { t.skip("Windows short-name behavior"); return; }
  const aliasRoot = await findWindowsShortAliasRoot();
  if (!aliasRoot) { t.skip("no writable short-name alias is available on this volume"); return; }
  const root = await mkdtemp(path.join(aliasRoot, "reelier-cert-init-short-race-"));
  const configPath = path.join(root, "certification.local.json");
  const workspace = path.join(root, "certification");
  await writeFile(configPath, JSON.stringify(config()), "utf8");
  let arrivals = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const beforePublish = async (): Promise<void> => { arrivals += 1; if (arrivals === 2) release(); await barrier; };
  const results = await Promise.all([
    initializeCertification({ configPath, workspace, hooks: { beforePublish } }),
    initializeCertification({ configPath, workspace, hooks: { beforePublish } }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), ["initialized", "resumed"]);
  assert.equal(arrivals, 2);
  assert.deepEqual((await readdir(await realpath(root))).filter(name => name.startsWith(".certification.staging-")), []);
});

test("certification init leaves an old foreign name-matching stage untouched and publishes beside it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-init-interrupted-"));
  const configPath = path.join(root, "certification.local.json");
  const workspace = path.join(root, "certification");
  const interrupted = path.join(root, ".certification.staging-interrupted");
  await writeFile(configPath, JSON.stringify(config()), "utf8");
  await mkdir(interrupted);
  await writeFile(path.join(interrupted, "partial.json"), "{", "utf8");
  const stale = new Date(Date.now() - 10 * 60_000);
  await utimes(interrupted, stale, stale);
  const result = await initializeCertification({ configPath, workspace });
  assert.equal(result.status, "initialized");
  assert.equal(await readFile(path.join(interrupted, "partial.json"), "utf8"), "{");
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith(".certification.staging-")), [".certification.staging-interrupted"]);
});

test("certification init refuses a workspace junction instead of resuming through it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-init-junction-"));
  const configPath = path.join(root, "certification.local.json");
  const external = await mkdtemp(path.join(tmpdir(), "reelier-cert-init-external-"));
  const workspace = path.join(root, "certification");
  await writeFile(configPath, JSON.stringify(config()), "utf8");
  await symlink(external, workspace, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => initializeCertification({ configPath, workspace }), /linked|junction|reparse|confined/i);
});

test("certification init refuses a real workspace reached through a junction parent", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-init-parent-resume-"));
  const actualParent = await mkdtemp(path.join(tmpdir(), "reelier-cert-init-parent-actual-"));
  const configPath = path.join(root, "certification.local.json");
  const actualWorkspace = path.join(actualParent, "certification");
  const linkedParent = path.join(root, "linked-parent");
  await writeFile(configPath, JSON.stringify(config()), "utf8");
  await initializeCertification({ configPath, workspace: actualWorkspace });
  try { await symlink(actualParent, linkedParent, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { t.skip(`directory link unavailable: ${(error as NodeJS.ErrnoException).code ?? "unknown"}`); return; }
  await assert.rejects(
    () => initializeCertification({ configPath, workspace: path.join(linkedParent, "certification") }),
    /linked|junction|reparse|confined/i,
  );
});

test("certification init does not create workspace parents through a junction", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-init-parent-junction-"));
  const configPath = path.join(root, "certification.local.json");
  const external = await mkdtemp(path.join(tmpdir(), "reelier-cert-init-parent-external-"));
  const linkedParent = path.join(root, "linked-parent");
  await writeFile(configPath, JSON.stringify(config()), "utf8");
  await symlink(external, linkedParent, process.platform === "win32" ? "junction" : "dir");

  await assert.rejects(
    () => initializeCertification({ configPath, workspace: path.join(linkedParent, "created", "certification") }),
    /linked|junction|reparse|confined|ENOENT/i,
  );
  await assert.rejects(() => access(path.join(external, "created")));
});

test("certification init refuses linked config input and linked resume snapshots where file links are supported", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-init-links-"));
  const actualConfig = path.join(root, "actual.json");
  const linkedConfig = path.join(root, "linked.json");
  await writeFile(actualConfig, JSON.stringify(config()), "utf8");
  try { await symlink(actualConfig, linkedConfig, "file"); }
  catch (error) { assert.equal(process.platform, "win32"); assert.match(String((error as NodeJS.ErrnoException).code), /EPERM|EACCES/); return; }
  await assert.rejects(() => initializeCertification({ configPath: linkedConfig, workspace: path.join(root, "linked-workspace") }), /linked|symlink|reparse|confined/i);

  const workspace = path.join(root, "certification");
  await initializeCertification({ configPath: actualConfig, workspace });
  const externalSnapshot = path.join(root, "external-snapshot.json");
  await writeFile(externalSnapshot, await readFile(path.join(workspace, "config.json"), "utf8"), "utf8");
  await unlink(path.join(workspace, "config.json"));
  await symlink(externalSnapshot, path.join(workspace, "config.json"), "file");
  await assert.rejects(() => initializeCertification({ configPath: actualConfig, workspace }), /linked|symlink|reparse|confined/i);
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
