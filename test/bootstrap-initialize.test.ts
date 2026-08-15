import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dispatchFromBootstrap, initializeAgentProject, type InitializeAgentProjectOptions } from "../src/bootstrap/initialize.js";
import { digestAgentProjectV1 } from "../src/bootstrap/project.js";
import { parseRuntimeDescriptorV1 } from "../src/runtime/manifest.js";
import { authorityDigest } from "../src/authority/wire.js";
import { computeInstalledBuildDigest } from "../src/bootstrap/build-identity.js";
import { governanceRef, tenant, verificationTime, writeProfileGovernanceFixture } from "./authority/profile-governance-fixture.js";

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

test("installed build provenance comes from the Reelier package rather than the project cwd", async () => {
  await withFixture(async options => {
    const original = process.cwd();
    try {
      process.chdir(options.cwd);
      const report = await initializeAgentProject(options);
      assert.match(report.projectDigest, /^sha256:/);
    } finally { process.chdir(original); }
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

test("a stale named-bootstrap lock is recovered only when its owner is provably dead", async () => {
  await withFixture(async options => {
    await initializeAgentProject(options);
    const lock = path.join(options.cwd, ".reelier", "bootstrap", ".lock");
    await writeFile(lock, JSON.stringify({ v: "reelier.bootstrap-lock/v1", pid: -1, nonce: "dead-owner" }), "utf8");
    const resumed = await initializeAgentProject(options);
    assert.equal(resumed.pathC, "unavailable-no-activation");
    await assert.rejects(lstat(lock), { code: "ENOENT" });
  });
});

test("checkpoint state binds every declared artifact digest and restart refuses an unlisted or substituted artifact", async () => {
  await withFixture(async options => {
    await initializeAgentProject(options);
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    const state = JSON.parse(await readFile(path.join(bootstrap, "state.json"), "utf8"));
    assert.deepEqual(state.completed.map((entry: { id: string }) => entry.id), [
      "inspection-link", "runtime-descriptor", "route-coverage", "workload-registration-request", "profile-drafts", "imported-governance", "configuration-plan", "installation-canary", "project", "report",
    ]);
    assert.ok(state.completed.every((entry: { artifact?: unknown; digest?: unknown }) => typeof entry.artifact === "string" && /^sha256:[0-9a-f]{64}$/.test(String(entry.digest))));
    await writeFile(path.join(bootstrap, "profile-drafts.json"), "{}\n", "utf8");
    await assert.rejects(() => initializeAgentProject(options), /checkpoint|artifact|digest/i);
  });
});

test("concurrent named initialization creates exactly one workload key and both callers resume the same project", async () => {
  await withFixture(async options => {
    const [first, second] = await Promise.all([initializeAgentProject(options), initializeAgentProject(options)]);
    assert.equal(first.projectDigest, second.projectDigest);
    const keyDir = path.join(options.homedir, ".reelier", "workloads", options.agentName);
    assert.equal((await readdir(keyDir)).filter(name => /^[0-9a-f]{16}\.pem$/.test(name)).length, 1);
  });
});

test("named init applies a consented project config plan with backup and records a truthful canary", async () => {
  await withFixture(async options => {
    const config = path.join(options.cwd, ".mcp.json");
    const original = JSON.stringify({ mcpServers: { local: { command: "npx", args: ["-y", "@example/server"] } } });
    await writeFile(config, original, "utf8");
    const report = await initializeAgentProject(options);
    assert.equal(report.canary, "verified");
    assert.deepEqual(JSON.parse(await readFile(config, "utf8")).mcpServers.local.args, ["-y", "reelier@0.32.1", "mcp", "--wrap", "npx -y @example/server"]);
    assert.equal((await readdir(options.cwd)).some(name => name.startsWith(".mcp.json.backup-")), true);
  });
});

test("a complete operator governance import is verified and reported without copying roots into the project", async () => {
  await withFixture(async options => {
    const fixture = await writeProfileGovernanceFixture(options.homedir);
    await initializeAgentProject({ ...options, governance: { tenant, governanceRef, expectedManifestDigest: fixture.manifestDigest, expectedTrustHeadDigest: fixture.manifest.trustHeadDigest, verificationTime } });
    const imported = JSON.parse(await readFile(path.join(options.cwd, ".reelier", "bootstrap", "imported-governance.json"), "utf8"));
    assert.deepEqual(imported, { v: "reelier.imported-governance/v1", governanceRef, manifestDigest: fixture.manifestDigest, trustHeadDigest: fixture.manifest.trustHeadDigest, verificationStatus: "verified" });
    assert.equal((await readdir(path.join(options.cwd, ".reelier", "bootstrap"))).some(name => /trust|root|public.*key/i.test(name)), false);
  });
});

test("a stale positive PID lock is recovered only after its owner is unavailable", async () => {
  await withFixture(async options => {
    await initializeAgentProject(options);
    const lock = path.join(options.cwd, ".reelier", "bootstrap", ".lock");
    await writeFile(lock, JSON.stringify({ v: "reelier.bootstrap-lock/v1", pid: 999999, nonce: "dead-positive-owner" }), "utf8");
    await initializeAgentProject(options);
    await assert.rejects(lstat(lock), { code: "ENOENT" });
  });
});

test("checkpoint artifact paths are closed basenames and cannot redirect validation outside bootstrap", async () => {
  await withFixture(async options => {
    await initializeAgentProject(options);
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    const outside = path.join(options.cwd, ".reelier", "outside.json");
    const value = { v: "outside" };
    await writeFile(outside, JSON.stringify(value), "utf8");
    const statePath = path.join(bootstrap, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.completed[0].artifact = "../outside.json";
    state.completed[0].digest = authorityDigest(value);
    await writeFile(statePath, JSON.stringify(state), "utf8");
    await assert.rejects(() => initializeAgentProject(options), /checkpoint|artifact|path/i);
  });
});

test("completed checkpoints bind their canonical artifact names and reject linked artifacts", async () => {
  await withFixture(async options => {
    await initializeAgentProject(options);
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    const statePath = path.join(bootstrap, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    const originalState = JSON.stringify(state);
    const runtime = JSON.parse(await readFile(path.join(bootstrap, "runtime-descriptor.json"), "utf8"));
    state.completed[0].artifact = "runtime-descriptor.json";
    state.completed[0].digest = authorityDigest(runtime);
    await writeFile(statePath, JSON.stringify(state), "utf8");
    await assert.rejects(() => initializeAgentProject(options), /checkpoint|artifact|path/i);

    await writeFile(statePath, originalState, "utf8");
    const source = path.join(bootstrap, "inspection-link.json");
    const outside = path.join(options.cwd, "inspection-link-outside.json");
    await writeFile(outside, await readFile(source, "utf8"), "utf8");
    await rm(source);
    try { await symlink(outside, source, "file"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") return; throw error; }
    await assert.rejects(() => initializeAgentProject(options), /checkpoint|artifact|linked/i);
  });
});

test("the same agent name in separate projects receives separate project-scoped workload keys", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-workload-project-scope-"));
  try {
    const home = path.join(root, "home");
    const projectA = path.join(root, "a");
    const projectB = path.join(root, "b");
    await Promise.all([mkdir(home, { recursive: true }), mkdir(projectA, { recursive: true }), mkdir(projectB, { recursive: true })]);
    await initializeAgentProject({ cwd: projectA, homedir: home, agentName: "agent", exactVersion: "0.32.1" });
    await initializeAgentProject({ cwd: projectB, homedir: home, agentName: "agent", exactVersion: "0.32.1" });
    const workloadRoot = path.join(home, ".reelier", "workloads", "agent");
    assert.equal((await readdir(workloadRoot)).filter(name => /^[0-9a-f]{16}\.pem$/.test(name)).length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("verified imported governance joins exact pins into the project descriptor", async () => {
  await withFixture(async options => {
    const fixture = await writeProfileGovernanceFixture(options.homedir);
    await initializeAgentProject({ ...options, governance: { tenant, governanceRef, expectedManifestDigest: fixture.manifestDigest, expectedTrustHeadDigest: fixture.manifest.trustHeadDigest, verificationTime } });
    const project = JSON.parse(await readFile(path.join(options.cwd, ".reelier", "bootstrap", "project.json"), "utf8"));
    assert.equal(project.profileGovernanceRef, governanceRef);
    assert.equal(project.profileGovernanceManifestDigest, fixture.manifestDigest);
    assert.equal(project.profileTrustHeadDigest, fixture.manifest.trustHeadDigest);
    assert.equal(project.tenant, tenant);
  });
});

test("project records the canonical installed build digest rather than a synthetic version hash", async () => {
  await withFixture(async options => {
    await initializeAgentProject(options);
    const project = JSON.parse(await readFile(path.join(options.cwd, ".reelier", "bootstrap", "project.json"), "utf8"));
    assert.equal(project.installedBuildDigest, await computeInstalledBuildDigest(process.cwd()));
  });
});

test("a self-asserted governance summary without fixed-root admission artifacts is refused", async () => {
  await withFixture(async options => {
    const governance = path.join(options.homedir, ".reelier", "governance");
    await mkdir(governance, { recursive: true });
    await writeFile(path.join(governance, "profile-governance.json"), JSON.stringify({ governanceRef: "forged", manifestDigest: `sha256:${"e".repeat(64)}`, trustHeadDigest: `sha256:${"f".repeat(64)}`, verificationStatus: "verified" }), "utf8");
    await assert.rejects(() => initializeAgentProject(options), /governance|operator|trust|admission/i);
  });
});

test("completed checkpoint state is bound to agent, version, cwd, and consent inputs", async () => {
  await withFixture(async options => {
    await initializeAgentProject(options);
    for (const changed of [
      { ...options, agentName: "other-agent" },
      { ...options, exactVersion: "0.32.2" },
      { ...options, yes: false },
    ]) await assert.rejects(() => initializeAgentProject(changed), /checkpoint|plan|identity/i);
  });
});

test("named initialization refuses a project cwd junction before creating any project artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-project-root-link-"));
  try {
    const target = path.join(root, "target"), linked = path.join(root, "linked"), home = path.join(root, "home");
    await Promise.all([mkdir(target, { recursive: true }), mkdir(home, { recursive: true })]);
    await symlink(target, linked, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(() => initializeAgentProject({ cwd: linked, homedir: home, agentName: "agent", exactVersion: "0.32.1" }), /project|linked|junction|unsafe/i);
    await assert.rejects(readdir(path.join(target, ".reelier")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
