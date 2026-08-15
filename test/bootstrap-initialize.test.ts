import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { computeInstalledBuildDigest } from "../src/bootstrap/build-identity.js";
import { initializeAgentProject, type InitializeAgentProjectOptions } from "../src/bootstrap/initialize.js";

async function withFixture<T>(run: (options: InitializeAgentProjectOptions) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-reset-init-"));
  const cwd = path.join(root, "project");
  const homedir = path.join(root, "home");
  await Promise.all([mkdir(cwd), mkdir(homedir)]);
  try { return await run({ cwd, homedir, agentName: "my-agent", exactVersion: "0.32.1" }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

async function committedFiles(cwd: string): Promise<{ generation: string; files: string[] }> {
  const bootstrap = path.join(cwd, ".reelier", "bootstrap");
  const pointer = JSON.parse(await readFile(path.join(bootstrap, "current.json"), "utf8")) as { generation: string };
  return { generation: pointer.generation, files: (await readdir(path.join(bootstrap, "generations", pointer.generation))).sort() };
}

test("minimal named preparation freezes the exact descriptor, honest report, and recovery command", async () => {
  await withFixture(async options => {
    const report = await initializeAgentProject(options);
    const { generation, files } = await committedFiles(options.cwd);
    const root = path.join(options.cwd, ".reelier", "bootstrap", "generations", generation);
    const project = JSON.parse(await readFile(path.join(root, "project.json"), "utf8"));
    const persisted = JSON.parse(await readFile(path.join(root, "report.json"), "utf8"));

    assert.deepEqual(files, ["checkpoint.json", "project.json", "recovery-command.txt", "report.json"]);
    assert.deepEqual(Object.keys(project).sort(), ["agentName", "authority", "completeness", "installedBuildDigest", "projectRoot", "reelierVersion", "routeSnapshotDigest", "v"]);
    assert.deepEqual(Object.keys(persisted).sort(), ["authority", "completeness", "initializedAt", "projectDigest", "recoveryCommand", "state", "up", "v"]);
    assert.equal(project.agentName, "my-agent");
    assert.equal(project.projectRoot, await (await import("node:fs/promises")).realpath(options.cwd));
    assert.equal(project.reelierVersion, "0.32.1");
    assert.equal(project.installedBuildDigest, await computeInstalledBuildDigest(process.cwd()));
    assert.equal(project.authority, "absent");
    assert.equal(project.completeness, "not-proved");
    assert.equal(persisted.authority, "absent");
    assert.equal(persisted.completeness, "not-proved");
    assert.equal(persisted.recoveryCommand, "npx reelier@0.32.1 up");
    assert.equal(await readFile(path.join(root, "recovery-command.txt"), "utf8"), "npx reelier@0.32.1 up\n");
    assert.equal(report.recoveryCommand, "npx reelier@0.32.1 up");
    assert.deepEqual((await readdir(path.join(options.cwd, ".reelier"))).sort(), ["bootstrap"]);
  });
});

test("an orphan lock is recovered only when its closed journal and exact plan are valid", async () => {
  await withFixture(async options => {
    await assert.rejects(() => initializeAgentProject({ ...options, interruptAfterState: "prepared" }), /interrupted/i);
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    const lockPath = path.join(bootstrap, ".lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    await writeFile(lockPath, `${JSON.stringify({ ...lock, pid: 2147483647 })}\n`);

    const resumed = await initializeAgentProject(options);
    assert.equal(resumed.state, "complete");
    assert.equal((await committedFiles(options.cwd)).files.length, 4);
  });

  await withFixture(async options => {
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    await mkdir(bootstrap, { recursive: true });
    await writeFile(path.join(bootstrap, ".lock"), `${JSON.stringify({ v: "reelier.bootstrap-lock/v2", pid: 2147483647, ownerToken: "a".repeat(64), transactionId: "b".repeat(32) })}\n`);
    const before = await readdir(bootstrap);
    await assert.rejects(() => initializeAgentProject(options), /orphan|journal|recovery/i);
    assert.deepEqual(await readdir(bootstrap), before);
  });
});

test("restart refuses checkpoint or plan identity drift without adopting staged bytes", async () => {
  await withFixture(async options => {
    await assert.rejects(() => initializeAgentProject({ ...options, interruptAfterState: "prepared" }), /interrupted/i);
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    const journalPath = path.join(bootstrap, "transaction.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    const checkpointPath = path.join(bootstrap, "staging", journal.transactionId, "checkpoint.json");
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
    await writeFile(checkpointPath, `${JSON.stringify({ ...checkpoint, planDigest: `sha256:${"0".repeat(64)}` }, null, 2)}\n`);
    const before = await readFile(checkpointPath, "utf8");

    await assert.rejects(() => initializeAgentProject(options), /checkpoint|plan|identity/i);
    assert.equal(await readFile(checkpointPath, "utf8"), before);
    await assert.rejects(readFile(path.join(bootstrap, "current.json"), "utf8"), { code: "ENOENT" });
  });

  await withFixture(async options => {
    await initializeAgentProject(options);
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    const before = await readFile(path.join(bootstrap, "current.json"), "utf8");
    for (const changed of [
      { ...options, agentName: "MY-AGENT" },
      { ...options, exactVersion: "0.32.2" },
    ]) await assert.rejects(() => initializeAgentProject(changed), /plan|identity|case/i);
    assert.equal(await readFile(path.join(bootstrap, "current.json"), "utf8"), before);
  });
});

test("named preparation refuses noncanonical names and linked project roots before project writes", async () => {
  await withFixture(async options => {
    for (const agentName of [".", "..", "Agent Name", "a/b", "a\\b", "e\u0301"]) {
      await assert.rejects(() => initializeAgentProject({ ...options, agentName }), /agent name|options/i);
    }
  });

  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-reset-root-link-"));
  try {
    const target = path.join(root, "target"), linked = path.join(root, "linked"), homedir = path.join(root, "home");
    await Promise.all([mkdir(target), mkdir(homedir)]);
    await symlink(target, linked, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(() => initializeAgentProject({ cwd: linked, homedir, agentName: "agent", exactVersion: "0.32.1" }), /project.*unsafe|linked/i);
    assert.deepEqual(await readdir(target), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
