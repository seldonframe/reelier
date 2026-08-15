import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dispatchFromBootstrap, initializeAgentProject, type InitializeAgentProjectOptions } from "../src/bootstrap/initialize.js";

async function withFixture<T>(run: (options: InitializeAgentProjectOptions) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-named-init-"));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  await Promise.all([
    (await import("node:fs/promises")).mkdir(project, { recursive: true }),
    (await import("node:fs/promises")).mkdir(home, { recursive: true }),
  ]);
  try {
    return await run({ cwd: project, homedir: home, agentName: "my-agent", yes: true, exactVersion: "0.32.1" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("named initialization prepares drafts but cannot certify, activate, or dispatch", async () => {
  await withFixture(async options => {
    const report = await initializeAgentProject(options);
    assert.equal(report.actions.profileDrafted, true);
    assert.equal(report.actions.profileCertified, false);
    assert.equal(report.actions.authorityActivated, false);
    assert.equal(report.pathC, "unavailable-no-activation");
    await assert.rejects(() => dispatchFromBootstrap(report), /validated profile activation required/);
  });
});

test("named initialization persists only the closed report projection and an exact pinned recovery command", async () => {
  await withFixture(async options => {
    const report = await initializeAgentProject(options);
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    const persisted = JSON.parse(await readFile(path.join(bootstrap, "report.json"), "utf8")) as Record<string, unknown>;
    assert.equal(report.recoveryCommand, "npx reelier@0.32.1 up");
    assert.equal(persisted.recoveryCommand, "npx reelier@0.32.1 up");
    assert.equal("actions" in persisted, false);
    assert.equal("pathC" in persisted, false);
    assert.deepEqual((await readdir(path.join(options.cwd, ".reelier"))).sort(), ["bootstrap", "init"]);
  });
});

test("workload private material never enters project artifacts, reports, logs, arguments, or environment snapshots", async () => {
  await withFixture(async options => {
    const report = await initializeAgentProject(options);
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    const registration = await readFile(path.join(bootstrap, "workload-registration-request.json"), "utf8");
    const reportBytes = await readFile(path.join(bootstrap, "report.json"), "utf8");
    const projectFiles = await Promise.all((await readdir(bootstrap)).map(file => readFile(path.join(bootstrap, file), "utf8")));
    assert.match(registration, /publicKeyCommitment/);
    assert.doesNotMatch(registration, /BEGIN PRIVATE KEY|privatePath/i);
    assert.doesNotMatch(reportBytes, /BEGIN PRIVATE KEY|privatePath/i);
    assert.doesNotMatch(projectFiles.join("\n"), /BEGIN PRIVATE KEY|privatePath/i);
    assert.doesNotMatch(JSON.stringify(report), /BEGIN PRIVATE KEY|privatePath/i);
  });
});

test("named initialization resumes an exact checkpoint plan and rejects traversal or incomplete imported governance", async () => {
  await withFixture(async options => {
    await assert.rejects(() => initializeAgentProject({ ...options, agentName: "../escape" }), /agent name|bootstrap/i);
    await writeFile(path.join(options.homedir, ".reelier", "governance.json"), "{\"governanceRef\":\"only-one-field\"}", "utf8").catch(() => {});
    const first = await initializeAgentProject(options);
    const second = await initializeAgentProject(options);
    assert.equal(second.projectDigest, first.projectDigest);
    assert.equal(second.pathC, "unavailable-no-activation");
  });
});
