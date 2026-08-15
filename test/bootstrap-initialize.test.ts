import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dispatchFromBootstrap, initializeAgentProject, type InitializeAgentProjectOptions } from "../src/bootstrap/initialize.js";
import { digestAgentProjectV1 } from "../src/bootstrap/project.js";
import { parseRuntimeDescriptorV1 } from "../src/runtime/manifest.js";
import { authorityDigest } from "../src/authority/wire.js";

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

test("named initialization rejects dot names, separators, and case-colliding workload identities before writes", async () => {
  await withFixture(async options => {
    for (const agentName of [".", "..", "a/b", "a\\b"]) {
      await assert.rejects(() => initializeAgentProject({ ...options, agentName }), /named bootstrap options are invalid/);
    }
    await initializeAgentProject(options);
    await assert.rejects(() => initializeAgentProject({ ...options, agentName: "MY-AGENT" }), /case collision/i);
  });
});

test("named initialization refuses a substituted project .reelier junction before any artifact is written outside the project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-named-init-link-"));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  const outside = path.join(root, "outside");
  try {
    await Promise.all([mkdir(project, { recursive: true }), mkdir(home, { recursive: true }), mkdir(outside, { recursive: true })]);
    await symlink(outside, path.join(project, ".reelier"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(() => initializeAgentProject({ cwd: project, homedir: home, agentName: "agent", exactVersion: "0.32.1" }), /unsafe|linked|confined/i);
    assert.deepEqual(await readdir(outside), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("workload-root substitution is refused before a private key can escape the user Reelier home", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-workload-link-"));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  const outside = path.join(root, "outside");
  try {
    await Promise.all([mkdir(project, { recursive: true }), mkdir(path.join(home, ".reelier"), { recursive: true }), mkdir(outside, { recursive: true })]);
    await symlink(outside, path.join(home, ".reelier", "workloads"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(() => initializeAgentProject({ cwd: project, homedir: home, agentName: "agent", exactVersion: "0.32.1" }), /unsafe|linked|confined/i);
    assert.deepEqual(await readdir(outside), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("restart revalidates every checkpoint artifact and refuses a tampered completed bootstrap", async () => {
  await withFixture(async options => {
    await initializeAgentProject(options);
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    await writeFile(path.join(bootstrap, "project.json"), "{\"tampered\":true}\n", "utf8");
    await assert.rejects(() => initializeAgentProject(options), /checkpoint|artifact|project/i);
  });
});

test("persisted project, runtime, and report form exact semantic digest joins", async () => {
  await withFixture(async options => {
    await initializeAgentProject(options);
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    const project = JSON.parse(await readFile(path.join(bootstrap, "project.json"), "utf8"));
    const report = JSON.parse(await readFile(path.join(bootstrap, "report.json"), "utf8"));
    const runtime = JSON.parse(await readFile(path.join(bootstrap, "runtime-descriptor.json"), "utf8"));
    assert.equal(report.projectDigest, digestAgentProjectV1(project));
    assert.equal(project.runtimeDescriptorDigest, report.runtimeDescriptorDigest);
    assert.equal(project.runtimeDescriptorDigest, authorityDigest(runtime));
    assert.doesNotThrow(() => parseRuntimeDescriptorV1(runtime));
  });
});

test("named initialization refuses an active or stale bootstrap lock instead of racing a second transaction", async () => {
  await withFixture(async options => {
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    await initializeAgentProject(options);
    await writeFile(path.join(bootstrap, ".lock"), "active", "utf8");
    await assert.rejects(() => initializeAgentProject(options), /busy|lock/i);
    assert.equal((await lstat(path.join(bootstrap, ".lock"))).isFile(), true);
  });
});

test("partial imported governance is refused rather than relabeled absent", async () => {
  await withFixture(async options => {
    const governance = path.join(options.homedir, ".reelier", "governance");
    await mkdir(governance, { recursive: true });
    await writeFile(path.join(governance, "profile-governance.json"), JSON.stringify({ governanceRef: "operator-ref" }), "utf8");
    await assert.rejects(() => initializeAgentProject(options), /governance|partial|invalid/i);
  });
});
