import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { canonicalJson } from "../src/canonical-json.js";
import {
  INIT_CHECKPOINT_IDS,
  initializeInspection,
  type InitializationDependencies,
} from "../src/initialization.js";

test("checkpointed initialization exposes a local dry-run inspection API", async () => {
  const modulePath = "../src/" + "initialization.js";
  const initialization = await import(modulePath) as Record<string, unknown>;

  assert.equal(typeof initialization.initializeInspection, "function");
  assert.deepEqual(initialization.INIT_CHECKPOINT_IDS, [
    "config-surfaces",
    "path-a-coverage",
    "path-b-candidates",
    "path-c-candidates",
    "inspection-report",
  ]);
});

test("route discovery integration cannot change the frozen initialization plan bytes", async () => {
  const initialization = await import("../src/initialization.js") as Record<string, unknown>;
  assert.equal(canonicalJson(initialization.INIT_CHECKPOINT_IDS), '["config-surfaces","path-a-coverage","path-b-candidates","path-c-candidates","inspection-report"]');
  assert.deepEqual(Object.keys(initialization).sort(), ["INIT_CHECKPOINT_IDS", "initializeInspection", "renderInitializationReport"]);
});

async function withTempDir<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-inspection-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const secret = "do-not-persist-this-secret";

function opportunity() {
  return {
    fingerprint: {
      version: "workflow-shape-v1" as const,
      sourceAgent: "codex",
      digest: `sha256:${"a".repeat(64)}`,
      steps: [
        { server: "gmail", tool: "gmail.send", argKeys: ["to", `recipients.${secret}`], effect: "destructive" as const, ok: true, approvalLike: false },
        { server: "gmail", tool: "gmail.get", argKeys: ["id"], effect: "read" as const, ok: true, approvalLike: false },
      ],
      dataflow: [{ fromStep: 0, toStep: 1, relation: "write_then_read_back" as const }],
    },
    displayLabel: "gmail workflow",
    observedCount: 2,
    lastUsedAt: "2026-08-11T00:00:00.000Z",
    durationMs: { total: 0, average: 0 },
    servers: ["gmail"],
    sourceAgents: ["Codex CLI"],
    effectCounts: { read: 1, "idempotent-write": 0, destructive: 1 },
    evaluationPotential: "strong" as const,
    configuredServerCount: 1,
    approvalBoundary: "approve_before_write" as const,
    sessionPaths: [`C:\\Users\\person\\.codex\\sessions\\${secret}.jsonl`],
  };
}

function dependencies(calls: string[] = []): InitializationDependencies {
  return {
    knownMcpConfigPaths: () => [
      { label: "Claude Code (project)", path: `C:\\private\\${secret}\\.mcp.json` },
      { label: "Cursor (project)", path: `C:\\private\\${secret}\\mcp.json` },
    ],
    detectMcpConfigs: async () => {
      calls.push("config-surfaces");
      return [{ label: "Claude Code (project)", path: `C:\\private\\${secret}\\.mcp.json` }];
    },
    collectCodexCoverage: async () => {
      calls.push("path-a-codex");
      return {
        homedir: `C:\\private\\${secret}`,
        configPath: `C:\\private\\${secret}\\config.toml`,
        config: { configPath: `C:\\private\\${secret}\\config.toml`, location: "parsed", servers: [{ name: "gmail", origin: secret, location: "parsed", routing: "unwrapped" }], plugins: [], marketplaces: [] },
        plugins: [],
        inspectedLocations: [`C:\\private\\${secret}\\config.toml`],
      };
    },
    collectClaudeCodeCoverage: async () => {
      calls.push("path-a-claude");
      return {
        host: "Claude Code CLI",
        sources: [{ path: `C:\\private\\${secret}\\.mcp.json`, location: "parsed", servers: [{ name: "gmail", origin: secret, location: "parsed", routing: "wrapped" }] }],
        plugins: [],
        inspectedLocations: [`C:\\private\\${secret}\\.mcp.json`],
      };
    },
    discoveryInputs: async () => {
      calls.push("path-b-candidates");
      return [{ content: JSON.stringify({ prompt: secret, tool: "gmail.send" }), path: `C:\\private\\${secret}.jsonl`, project: "private-project", sourceId: "codex", sourceLabel: "Codex CLI", mtimeMs: Date.parse("2026-08-11T00:00:00.000Z"), format: "codex" }];
    },
    discoverOpportunities: () => [opportunity()],
    loadConnectionInventory: async () => {
      calls.push("path-c-connections");
      return {
        v: "reelier.connection-inventory/v1",
        root: `C:\\private\\${secret}\\authority`,
        entries: [
          {
            v: "reelier.connection-inventory-entry/v1",
            discoveryId: `host-private:${secret}`,
            provider: "gmail",
            connectionKind: "host-private",
            status: "shadow-only",
            routeStatus: "host-private",
            accountVerification: { status: "unverified" },
            schemaVerification: { status: "unverified", expectedDigests: [], observedDigests: [] },
            reasonCodes: ["host-private-route"],
          },
          {
            v: "reelier.connection-inventory-entry/v1",
            discoveryId: "unsupported:calendar",
            provider: "calendar",
            connectionKind: "native-https",
            status: "unsupported",
            routeStatus: "unsupported",
            accountVerification: { status: "unsupported" },
            schemaVerification: { status: "unsupported", expectedDigests: [], observedDigests: [] },
            reasonCodes: ["reviewed-provider-adapter-absent"],
          },
        ],
        issues: [],
      };
    },
  };
}

async function filesBelow(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[path.relative(root, full)] = await readFile(full, "utf8");
    }
  }
  await walk(root);
  return out;
}

test("dry-run inspects Path A, B, and C independently without filesystem writes", async () => {
  await withTempDir(async root => {
    const calls: string[] = [];
    const result = await initializeInspection({ cwd: root, homedir: path.join(root, "home"), dryRun: true, dependencies: dependencies(calls) });
    assert.equal(result.status, "dry-run");
    assert.deepEqual(calls, ["config-surfaces", "path-a-codex", "path-a-claude", "path-b-candidates", "path-c-connections"]);
    assert.equal(result.report.pathA.hosts.length, 2);
    assert.equal(result.report.pathB.candidates[0]?.freezeStatus, "candidate");
    assert.equal(result.report.pathC.connections.find(item => item.provider === "gmail")?.classification, "shadow-only");
    assert.equal(result.report.pathC.connections.find(item => item.provider === "calendar")?.classification, "unsupported");
    assert.equal(result.report.pathC.candidates[0]?.classification, "unsupported");
    await assert.rejects(readFile(path.join(root, ".reelier", "init", "state.json"), "utf8"), { code: "ENOENT" });
  });
});

test("named bootstrap route discovery writes only the bootstrap artifact after frozen inspection", async () => {
  await withTempDir(async root => {
    const result = await initializeInspection({
      cwd: root, homedir: path.join(root, "home"), dependencies: dependencies(),
      namedBootstrapRouteDiscovery: { agentName: "route-agent", now: new Date("2026-08-15T12:00:00.000Z"), contractIdentityDigest: `sha256:${"9".repeat(64)}`, findings: [] },
    });
    assert.equal(result.status, "complete");
    const routeBytes = await readFile(path.join(root, ".reelier", "bootstrap", "route-coverage.json"), "utf8");
    const routes = JSON.parse(routeBytes) as readonly { routeId: string }[];
    assert.ok(routes.length > 0 && routes.every(row => /^route_[0-9a-f]{64}$/.test(row.routeId)));
    assert.deepEqual(INIT_CHECKPOINT_IDS, ["config-surfaces", "path-a-coverage", "path-b-candidates", "path-c-candidates", "inspection-report"]);
    assert.equal(Object.keys(await filesBelow(path.join(root, ".reelier", "init"))).includes("route-coverage.json"), false);
  });
});

test("a durable completed checkpoint resumes at the first incomplete checkpoint", async () => {
  await withTempDir(async root => {
    const firstCalls: string[] = [];
    await assert.rejects(
      initializeInspection({
        cwd: root,
        homedir: path.join(root, "home"),
        dependencies: dependencies(firstCalls),
        afterCheckpoint: id => { if (id === "path-a-coverage") throw new Error("injected checkpoint failure"); },
      }),
      /injected checkpoint failure/,
    );
    assert.deepEqual(firstCalls, ["config-surfaces", "path-a-codex", "path-a-claude"]);
    const stateAfterFailure = JSON.parse(await readFile(path.join(root, ".reelier", "init", "state.json"), "utf8"));
    assert.deepEqual(stateAfterFailure.completed.map((item: { id: string }) => item.id), ["config-surfaces", "path-a-coverage"]);

    const resumeCalls: string[] = [];
    const resumed = await initializeInspection({ cwd: root, homedir: path.join(root, "home"), dependencies: dependencies(resumeCalls) });
    assert.equal(resumed.status, "complete");
    assert.equal(resumed.resumedFrom, "path-b-candidates");
    assert.deepEqual(resumeCalls, ["path-b-candidates", "path-c-connections"]);
  });
});

test("malformed, unknown, and stale checkpoint state refuse without mutation", async t => {
  for (const [name, state] of [
    ["malformed", "not json"],
    ["unknown", JSON.stringify({ v: "reelier.init-state/v1", planDigest: `sha256:${"0".repeat(64)}`, completed: [{ id: "unknown-checkpoint", artifact: "unknown.json", digest: `sha256:${"0".repeat(64)}` }] })],
    ["stale", JSON.stringify({ v: "reelier.init-state/v1", planDigest: `sha256:${"0".repeat(64)}`, completed: [] })],
  ] as const) {
    await t.test(name, async () => withTempDir(async root => {
      const initDir = path.join(root, ".reelier", "init");
      await mkdir(initDir, { recursive: true });
      await writeFile(path.join(initDir, "state.json"), state, "utf8");
      const before = await filesBelow(root);
      await assert.rejects(initializeInspection({ cwd: root, homedir: root, dependencies: dependencies() }), /checkpoint state refused/);
      assert.deepEqual(await filesBelow(root), before);
    }));
  }
});

test("a completed rerun is byte-stable and does not repeat inspection", async () => {
  await withTempDir(async root => {
    await initializeInspection({ cwd: root, homedir: root, dependencies: dependencies() });
    const before = await filesBelow(root);
    const calls: string[] = [];
    const rerun = await initializeInspection({ cwd: root, homedir: root, dependencies: dependencies(calls) });
    assert.equal(rerun.status, "complete");
    assert.deepEqual(calls, []);
    assert.deepEqual(await filesBelow(root), before);
  });
});

test("a malformed completed artifact is refused without rewriting checkpoint files", async () => {
  await withTempDir(async root => {
    await initializeInspection({ cwd: root, homedir: root, dependencies: dependencies() });
    const artifact = path.join(root, ".reelier", "init", "path-a-coverage.json");
    await writeFile(artifact, "raw-provider-response=must-not-escape", "utf8");
    const before = await filesBelow(root);
    await assert.rejects(
      initializeInspection({ cwd: root, homedir: root, dependencies: dependencies() }),
      /checkpoint state refused/,
    );
    assert.deepEqual(await filesBelow(root), before);
  });
});

test("a digest-matched artifact with unknown fields is still refused as non-closed", async () => {
  await withTempDir(async root => {
    await initializeInspection({ cwd: root, homedir: root, dependencies: dependencies() });
    const initDir = path.join(root, ".reelier", "init");
    const artifactPath = path.join(initDir, "path-a-coverage.json");
    const artifact = { ...JSON.parse(await readFile(artifactPath, "utf8")), credential: "forbidden" };
    await writeFile(artifactPath, `${canonicalJson(artifact)}\n`, "utf8");
    const statePath = path.join(initDir, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.completed.find((item: { id: string }) => item.id === "path-a-coverage").digest = `sha256:${createHash("sha256").update(canonicalJson(artifact), "utf8").digest("hex")}`;
    await writeFile(statePath, `${canonicalJson(state)}\n`, "utf8");
    await assert.rejects(initializeInspection({ cwd: root, homedir: root, dependencies: dependencies() }), /checkpoint state refused: malformed artifact/);
  });
});

test("an exact-key report cannot fabricate deployment or authority success", async () => {
  await withTempDir(async root => {
    await initializeInspection({ cwd: root, homedir: root, dependencies: dependencies() });
    const initDir = path.join(root, ".reelier", "init");
    const artifactPath = path.join(initDir, "inspection-report.json");
    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    artifact.exclusiveEnforcement.status = "declared-surface";
    await writeFile(artifactPath, `${canonicalJson(artifact)}\n`, "utf8");
    const statePath = path.join(initDir, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.completed.find((item: { id: string }) => item.id === "inspection-report").digest = `sha256:${createHash("sha256").update(canonicalJson(artifact), "utf8").digest("hex")}`;
    await writeFile(statePath, `${canonicalJson(state)}\n`, "utf8");
    await assert.rejects(initializeInspection({ cwd: root, homedir: root, dependencies: dependencies() }), /checkpoint state refused: malformed artifact/);
  });
});

test("Path C checkpoint classifications must match their evidence status exactly", async () => {
  await withTempDir(async root => {
    await initializeInspection({ cwd: root, homedir: root, dependencies: dependencies() });
    const initDir = path.join(root, ".reelier", "init");
    const artifactPath = path.join(initDir, "path-c-candidates.json");
    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    artifact.candidates[0].classification = "shadow-only";
    await writeFile(artifactPath, `${canonicalJson(artifact)}\n`, "utf8");
    const statePath = path.join(initDir, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.completed.find((item: { id: string }) => item.id === "path-c-candidates").digest = `sha256:${createHash("sha256").update(canonicalJson(artifact), "utf8").digest("hex")}`;
    await writeFile(statePath, `${canonicalJson(state)}\n`, "utf8");
    await assert.rejects(initializeInspection({ cwd: root, homedir: root, dependencies: dependencies() }), /checkpoint state refused: malformed artifact/);
  });
});

test("checkpoint and report artifacts contain sanitized shapes only", async () => {
  await withTempDir(async root => {
    const result = await initializeInspection({ cwd: root, homedir: root, dependencies: dependencies() });
    const serialized = JSON.stringify({ result, files: await filesBelow(root) });
    assert.doesNotMatch(serialized, new RegExp(secret));
    assert.doesNotMatch(serialized, /private-project|rawToolArguments|prompt/);
    assert.doesNotMatch(serialized, /routeSpec|accountIdentity|configPath|homedir/);
    assert.match(serialized, /prospective-reversible-backup/);
    assert.match(serialized, /exclusiveEnforcement/);
  });
});

test("concurrent init returns busy without partial checkpoint state", async () => {
  await withTempDir(async root => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const firstDeps = dependencies();
    firstDeps.detectMcpConfigs = async (...args) => { entered(); await blocked; return dependencies().detectMcpConfigs(...args); };
    const first = initializeInspection({ cwd: root, homedir: root, dependencies: firstDeps });
    await enteredPromise;
    const second = await initializeInspection({ cwd: root, homedir: root, dependencies: dependencies() });
    assert.equal(second.status, "busy");
    release();
    await first;
    const names = Object.keys(await filesBelow(root));
    assert.equal(names.some(name => name.includes(".tmp-") || name.endsWith(".lock")), false);
  });
});

test("a contender sees busy between artifact and state commits", async () => {
  await withTempDir(async root => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const first = initializeInspection({
      cwd: root,
      homedir: root,
      dependencies: dependencies(),
      afterArtifactWrite: async id => {
        if (id === "config-surfaces") { entered(); await blocked; }
      },
    });
    await enteredPromise;
    const second = await initializeInspection({ cwd: root, homedir: root, dependencies: dependencies() });
    assert.equal(second.status, "busy");
    release();
    await first;
  });
});

test("a provably dead owner lock resumes from the durable prefix and cleans owned crash residue", async () => {
  await withTempDir(async root => {
    await assert.rejects(initializeInspection({
      cwd: root,
      homedir: root,
      dependencies: dependencies(),
      afterCheckpoint: id => { if (id === "path-a-coverage") throw new Error("stop after durable prefix"); },
    }));
    const initDir = path.join(root, ".reelier", "init");
    await writeFile(path.join(initDir, ".lock"), `${JSON.stringify({ v: "reelier.init-lock/v1", pid: 2_147_483_647 })}\n`, "utf8");
    await writeFile(path.join(initDir, "path-b-candidates.json.tmp-deadbeef0001"), "partial", "utf8");
    await writeFile(path.join(initDir, "path-b-candidates.json"), "partial", "utf8");
    const resumed = await initializeInspection({ cwd: root, homedir: root, dependencies: dependencies() });
    assert.equal(resumed.status, "complete");
    assert.equal(resumed.resumedFrom, "path-b-candidates");
    const names = Object.keys(await filesBelow(root));
    assert.equal(names.some(name => name.includes(".tmp-") || name.endsWith(".lock")), false);
  });
});

test("dry-run never cleans a dead lock or crash residue", async () => {
  await withTempDir(async root => {
    const initDir = path.join(root, ".reelier", "init");
    await mkdir(initDir, { recursive: true });
    await writeFile(path.join(initDir, ".lock"), `${JSON.stringify({ v: "reelier.init-lock/v1", pid: 2_147_483_647 })}\n`, "utf8");
    await writeFile(path.join(initDir, "state.json.tmp-deadbeef0001"), "partial", "utf8");
    const before = await filesBelow(root);
    const result = await initializeInspection({ cwd: root, homedir: root, dryRun: true, dependencies: dependencies() });
    assert.equal(result.status, "busy");
    assert.deepEqual(await filesBelow(root), before);
  });
});

test("stale-lock cleanup owns an exclusive recovery lease until residue is gone", async () => {
  await withTempDir(async root => {
    const initDir = path.join(root, ".reelier", "init");
    await mkdir(initDir, { recursive: true });
    await writeFile(path.join(initDir, ".lock"), `${JSON.stringify({ v: "reelier.init-lock/v1", pid: 2_147_483_647 })}\n`, "utf8");
    await writeFile(path.join(initDir, "state.json.tmp-deadbeef0001"), "partial", "utf8");
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const recovering = initializeInspection({
      cwd: root,
      homedir: root,
      dependencies: dependencies(),
      duringRecoveryCleanup: async () => { entered(); await blocked; },
    });
    await enteredPromise;
    const contender = await initializeInspection({ cwd: root, homedir: root, dependencies: dependencies() });
    assert.equal(contender.status, "busy");
    release();
    assert.equal((await recovering).status, "complete");
  });
});
