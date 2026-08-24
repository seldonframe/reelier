import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authorityDigest } from "../src/authority/wire.js";
import { initializeAgentProject, type InitializeAgentProjectOptions } from "../src/bootstrap/initialize.js";

type TestNativeFactory = (input: Readonly<{ root: string; lockName: ".reelier-bootstrap.lock"; lockBytes: Buffer }>) => Promise<{
  readonly acquisition: Readonly<{ status: "created" } | { status: "recovered"; priorBytes: Buffer }>;
  replaceLock(bytes: Buffer): Promise<void>;
  mkdir(relative: string): Promise<void>;
  writeExclusive(relative: string, bytes: Buffer): Promise<void>;
  writeAtomic(relative: string, bytes: Buffer): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(relative: string, options: Readonly<{ recursive: boolean; missingOk: boolean }>): Promise<void>;
  close(options: Readonly<{ removeLock: boolean }>): Promise<void>;
}>;

function recordingNativeFactory(operations: string[], replaceRecoveredLock = false): TestNativeFactory {
  return async ({ root, lockName, lockBytes }) => {
    const resolve = (relative: string): string => {
      assert.equal(path.isAbsolute(relative), false);
      assert.equal(relative.split("/").some(part => part === "" || part === "." || part === ".."), false);
      return path.join(root, ...relative.split("/"));
    };
    const lockPath = resolve(lockName);
    let acquisition: { status: "created" } | { status: "recovered"; priorBytes: Buffer };
    try {
      const priorBytes = await readFile(lockPath);
      acquisition = { status: "recovered", priorBytes };
      if (replaceRecoveredLock) await writeFile(lockPath, lockBytes);
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeFile(lockPath, lockBytes, { flag: "wx" });
      acquisition = { status: "created" };
    }
    operations.push(`open-session:${acquisition.status}`);
    return {
      acquisition,
      async replaceLock(bytes) { operations.push("replace-lock"); await writeFile(lockPath, bytes); },
      async mkdir(relative) { operations.push(`mkdir:${relative}`); await mkdir(resolve(relative)).catch(error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }); },
      async writeExclusive(relative, bytes) { operations.push(`write-exclusive:${relative}`); await writeFile(resolve(relative), bytes, { flag: "wx" }); },
      async writeAtomic(relative, bytes) { operations.push(`write-atomic:${relative}`); await writeFile(resolve(relative), bytes); },
      async rename(from, to) { operations.push(`rename:${from}->${to}`); await rename(resolve(from), resolve(to)); },
      async remove(relative, options) { operations.push(`remove:${relative}`); await rm(resolve(relative), { recursive: options.recursive, force: options.missingOk }); },
      async close(options) { operations.push(`close:${options.removeLock}`); if (options.removeLock) await unlink(lockPath).catch(() => {}); },
    };
  };
}

async function withFixture<T>(run: (options: InitializeAgentProjectOptions) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-reset-init-"));
  const cwd = path.join(root, "project");
  const homedir = path.join(root, "home");
  await Promise.all([mkdir(cwd), mkdir(homedir)]);
  try { return await run({ cwd, homedir, agentName: "my-agent", exactVersion: "0.33.0-beta.0", nativeSessionFactory: recordingNativeFactory([]) }); }
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
    assert.equal(project.reelierVersion, "0.33.0-beta.0");
    assert.match(project.installedBuildDigest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(project.authority, "absent");
    assert.equal(project.completeness, "not-proved");
    assert.equal(persisted.authority, "absent");
    assert.equal(persisted.completeness, "not-proved");
    assert.equal(persisted.recoveryCommand, "npx reelier@0.33.0-beta.0 up my-agent");
    assert.equal(await readFile(path.join(root, "recovery-command.txt"), "utf8"), "npx reelier@0.33.0-beta.0 up my-agent\n");
    assert.equal(report.recoveryCommand, "npx reelier@0.33.0-beta.0 up my-agent");
    assert.deepEqual((await readdir(path.join(options.cwd, ".reelier"))).sort(), ["bootstrap"]);
  });
});

test("an orphan lock is recovered only when its closed journal and exact plan are valid", async () => {
  await withFixture(async options => {
    await assert.rejects(() => initializeAgentProject({ ...options, interruptAfterState: "prepared" }), /interrupted/i);
    // The prior call has returned and no longer owns anything, even though a
    // diagnostic PID in its residue necessarily names this still-live test
    // process. PID liveness must not turn valid crash recovery into a refusal.
    const lockPath = path.join(options.cwd, ".reelier-bootstrap.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    await writeFile(lockPath, `${JSON.stringify({ ...lock, pid: process.pid })}\n`);
    const resumed = await initializeAgentProject(options);
    assert.equal(resumed.state, "complete");
    assert.equal((await committedFiles(options.cwd)).files.length, 4);
  });

  await withFixture(async options => {
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    await mkdir(bootstrap, { recursive: true });
    await writeFile(path.join(options.cwd, ".reelier-bootstrap.lock"), `${JSON.stringify({ v: "reelier.bootstrap-lock/v2", pid: 2147483647, ownerToken: "a".repeat(64), transactionId: "b".repeat(32) })}\n`);
    const before = await readdir(bootstrap);
    await assert.rejects(() => initializeAgentProject(options), /orphan|journal|recovery/i);
    assert.deepEqual(await readdir(bootstrap), before);
  });
});

test("named preparation refuses before its first project write when verified native support is unavailable", async () => {
  await withFixture(async options => {
    const unavailable: TestNativeFactory = async () => { throw new Error("verified native bootstrap helper unavailable: artifact-missing"); };
    await assert.rejects(() => initializeAgentProject({ ...options, nativeSessionFactory: unavailable } as InitializeAgentProjectOptions), /verified native.*artifact-missing/i);
    assert.deepEqual(await readdir(options.cwd), []);
  });
});

test("named preparation owns its lock and every child mutation through one relative native session", async () => {
  await withFixture(async options => {
    const operations: string[] = [];
    const report = await initializeAgentProject({ ...options, nativeSessionFactory: recordingNativeFactory(operations) } as InitializeAgentProjectOptions);
    assert.equal(report.state, "complete");
    assert.equal(operations[0], "open-session:created");
    assert.ok(operations.some(value => value === "mkdir:.reelier"));
    assert.ok(operations.some(value => /^rename:\.reelier\/bootstrap\/staging\/[0-9a-f]{32}->\.reelier\/bootstrap\/generations\/[0-9a-f]{32}$/.test(value)));
    assert.ok(operations.some(value => value === "write-atomic:.reelier/bootstrap/current.json"));
    assert.equal(operations.at(-1), "close:true");
    assert.equal(operations.some(value => value.includes("heartbeat")), false);
  });
});

test("a recovered lock without a journal is restored byte-identically across retries", async () => {
  await withFixture(async options => {
    const priorBytes = Buffer.from(`${JSON.stringify({
      v: "reelier.bootstrap-lock/v2",
      pid: 2147483647,
      ownerToken: "a".repeat(64),
      transactionId: "b".repeat(32),
    })}\n`);
    const lockPath = path.join(options.cwd, ".reelier-bootstrap.lock");
    await writeFile(lockPath, priorBytes);
    const nativeSessionFactory = recordingNativeFactory([], true);

    await assert.rejects(() => initializeAgentProject({ ...options, nativeSessionFactory }), /busy|journal/i);
    assert.deepEqual(await readFile(lockPath), priorBytes);
    await assert.rejects(() => initializeAgentProject({ ...options, nativeSessionFactory }), /busy|journal/i);
    assert.deepEqual(await readFile(lockPath), priorBytes);
  });
});

test("a recovered owner can crash again and the next owner still recovers", async () => {
  await withFixture(async options => {
    await assert.rejects(() => initializeAgentProject({ ...options, interruptAfterState: "prepared" }), /interrupted/i);
    await assert.rejects(() => initializeAgentProject({ ...options, interruptAfterState: "committing" }), /interrupted/i);
    const report = await initializeAgentProject(options);
    assert.equal(report.state, "complete");
  });
});

test("orphan recovery rolls back the closed generation instead of adopting it", async () => {
  await withFixture(async options => {
    await assert.rejects(() => initializeAgentProject({ ...options, interruptAfterState: "prepared" }), /interrupted/i);
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    const interrupted = JSON.parse(await readFile(path.join(bootstrap, "transaction.json"), "utf8"));
    await initializeAgentProject(options);
    const committed = await committedFiles(options.cwd);
    assert.notEqual(committed.generation, interrupted.transactionId);
  });
});

test("identity drift refuses without deleting journal or staged evidence", async () => {
  await withFixture(async options => {
    await assert.rejects(() => initializeAgentProject({ ...options, interruptAfterState: "prepared" }), /interrupted/i);
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    const journalPath = path.join(bootstrap, "transaction.json");
    const journalBefore = await readFile(journalPath, "utf8");
    const journal = JSON.parse(journalBefore);
    const checkpointPath = path.join(bootstrap, "staging", journal.transactionId, "checkpoint.json");
    const checkpointBefore = await readFile(checkpointPath, "utf8");

    await assert.rejects(() => initializeAgentProject({ ...options, agentName: "MY-AGENT" }), /plan|identity|case/i);
    assert.equal(await readFile(journalPath, "utf8"), journalBefore);
    assert.equal(await readFile(checkpointPath, "utf8"), checkpointBefore);
  });
});

test("recovery-required performs rollback only and requires a clean retry", async () => {
  await withFixture(async options => {
    await assert.rejects(() => initializeAgentProject({ ...options, interruptAfterState: "prepared" }), /interrupted/i);
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    const journalPath = path.join(bootstrap, "transaction.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    await writeFile(journalPath, `${JSON.stringify({ ...journal, state: "recovery-required" }, null, 2)}\n`);

    await assert.rejects(() => initializeAgentProject(options), /rollback|recovery/i);
    await assert.rejects(readFile(journalPath, "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(bootstrap, "staging", journal.transactionId, "checkpoint.json"), "utf8"), { code: "ENOENT" });
    assert.equal((await initializeAgentProject(options)).state, "complete");
  });
});

test("restart refuses a self-consistent rewrite of staged bytes instead of adopting it", async () => {
  await withFixture(async options => {
    await assert.rejects(() => initializeAgentProject({ ...options, interruptAfterState: "prepared" }), /interrupted/i);
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    const journalPath = path.join(bootstrap, "transaction.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    const staged = path.join(bootstrap, "staging", journal.transactionId);
    const commandPath = path.join(staged, "recovery-command.txt");
    const checkpointPath = path.join(staged, "checkpoint.json");
    const changedCommand = "npx attacker-controlled up\n";
    await writeFile(commandPath, changedCommand);
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
    checkpoint.artifacts = checkpoint.artifacts.map((entry: { name: string; digest: string }) => entry.name === "recovery-command.txt"
      ? { ...entry, digest: `sha256:${createHash("sha256").update(changedCommand).digest("hex")}` }
      : entry);
    await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
    journal.checkpointDigest = authorityDigest(checkpoint);
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

    const before = await readFile(commandPath, "utf8");
    await assert.rejects(() => initializeAgentProject(options), /checkpoint|artifact|plan|drift/i);
    assert.equal(await readFile(commandPath, "utf8"), before);
    await assert.rejects(readFile(path.join(bootstrap, "current.json"), "utf8"), { code: "ENOENT" });
  });
});

test("a stale route snapshot is reported as unknown instead of being pinned", async () => {
  await withFixture(async options => {
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    await mkdir(bootstrap, { recursive: true });
    await writeFile(path.join(bootstrap, "route-coverage.json"), `${JSON.stringify([{
      v: "reelier.route-coverage/v1",
      routeId: `route_${"1".repeat(64)}`,
      hostId: "codex",
      discoverySource: "host-config",
      transport: "mcp-stdio",
      observation: "observed",
      replay: "candidate",
      outcome: "unknown",
      enforcement: "absent",
      observedAt: "2020-01-01T00:00:00.000Z",
      freshUntil: "2020-01-01T00:01:00.000Z",
      evidenceDigest: `sha256:${"2".repeat(64)}`,
      topologyEvidenceDigest: null,
      evidenceRefs: [],
      reasonCodes: [],
    }], null, 2)}\n`);

    await initializeAgentProject(options);
    const { generation } = await committedFiles(options.cwd);
    const project = JSON.parse(await readFile(path.join(bootstrap, "generations", generation, "project.json"), "utf8"));
    assert.equal(project.routeSnapshotDigest, null);
  });
});

test("a held project lock refuses before mutable route or journal inspection", async () => {
  await withFixture(async options => {
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    await mkdir(bootstrap, { recursive: true });
    await writeFile(path.join(bootstrap, "route-coverage.json"), "not-json\n");
    await writeFile(path.join(options.cwd, ".reelier-bootstrap.lock"), `${JSON.stringify({
      v: "reelier.bootstrap-lock/v2", pid: process.pid, ownerToken: "a".repeat(64), transactionId: "b".repeat(32),
    })}\n`);

    await assert.rejects(() => initializeAgentProject(options), /busy|lock owner/i);
    assert.equal(await readFile(path.join(bootstrap, "route-coverage.json"), "utf8"), "not-json\n");
    await assert.rejects(readFile(path.join(bootstrap, "transaction.json"), "utf8"), { code: "ENOENT" });
  });
});

test("a held project lock does not create the bootstrap root", async () => {
  await withFixture(async options => {
    await writeFile(path.join(options.cwd, ".reelier-bootstrap.lock"), "occupied\n");
    await assert.rejects(() => initializeAgentProject(options), /busy|lock owner/i);
    await assert.rejects(readFile(path.join(options.cwd, ".reelier", "bootstrap", "transaction.json"), "utf8"), { code: "ENOENT" });
  });
});

test("the requested exact version must equal the executing package version before writes", async () => {
  await withFixture(async options => {
    await assert.rejects(() => initializeAgentProject({ ...options, exactVersion: "0.32.2" }), /version|executing package/i);
    await assert.rejects(readFile(path.join(options.cwd, ".reelier", "bootstrap", "transaction.json"), "utf8"), { code: "ENOENT" });
  });
});

test("a final-reread fault never leaves or returns a completed project", async () => {
  await withFixture(async options => {
    const injected = { ...options, failAt: "final-reread" } as InitializeAgentProjectOptions & { failAt: "final-reread" };
    await assert.rejects(() => initializeAgentProject(injected), /final reread|injected/i);
    const bootstrap = path.join(options.cwd, ".reelier", "bootstrap");
    await assert.rejects(readFile(path.join(bootstrap, "transaction.json"), "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(bootstrap, "current.json"), "utf8"), { code: "ENOENT" });
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
    ]) await assert.rejects(() => initializeAgentProject(changed), /plan|identity|case|version/i);
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
    await assert.rejects(() => initializeAgentProject({ cwd: linked, homedir, agentName: "agent", exactVersion: "0.33.0-beta.0" }), /project.*unsafe|linked/i);
    assert.deepEqual(await readdir(target), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
