import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cmdInit, type ParsedArgs } from "../src/cli.js";
import type { InitializationDependencies } from "../src/initialization.js";

function parsed(flags: string[] = []): ParsedArgs {
  return { positional: [], flags: new Set(flags), vars: {}, wraps: [], opts: {}, fails: [] };
}

function named(agentName: string, flags: string[] = []): ParsedArgs {
  return { ...parsed(flags), positional: [agentName] };
}

async function withTempDir<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-init-cli-"));
  try { return await run(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

async function capture<T>(run: () => Promise<T>): Promise<{ result: T; output: string }> {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = ((...args: unknown[]) => lines.push(args.map(String).join(" "))) as typeof console.log;
  console.error = console.log;
  try { return { result: await run(), output: lines.join("\n") }; }
  finally { console.log = originalLog; console.error = originalError; }
}

function localDependencies(): InitializationDependencies {
  return {
    knownMcpConfigPaths: () => [{ label: "Claude Code (project)", path: "private-config-path" }],
    detectMcpConfigs: async () => [{ label: "Claude Code (project)", path: "private-config-path" }],
    collectCodexCoverage: async () => ({
      homedir: "private-home",
      configPath: "private-config-path",
      config: { configPath: "private-config-path", location: "absent", servers: [], plugins: [], marketplaces: [] },
      plugins: [],
      inspectedLocations: ["private-config-path"],
    }),
    collectClaudeCodeCoverage: async () => ({ host: "Claude Code CLI", sources: [], plugins: [], inspectedLocations: ["private-config-path"] }),
    discoveryInputs: async () => [],
    discoverOpportunities: () => [],
    loadConnectionInventory: async () => ({
      v: "reelier.connection-inventory/v1",
      root: "private-authority-path",
      entries: [{
        v: "reelier.connection-inventory-entry/v1",
        discoveryId: "private-route-id",
        provider: "calendar",
        connectionKind: "native-https",
        status: "unsupported",
        routeStatus: "unsupported",
        accountVerification: { status: "unsupported" },
        schemaVerification: { status: "unsupported", expectedDigests: [], observedDigests: [] },
        reasonCodes: ["reviewed-provider-adapter-absent"],
      }],
      issues: [],
    }),
  };
}

test("reelier init --dry-run prints an answer-first A/B/C inspection and writes nothing", async () => {
  await withTempDir(async root => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("normal init attempted network access"); }) as typeof fetch;
    try {
      const { result: code, output } = await capture(() => cmdInit(parsed(["dry-run"]), { cwd: root, homedir: root, dependencies: localDependencies() }));
      assert.equal(code, 0);
      assert.match(output, /^Reelier init: local inspection only; nothing deployed or gated\./);
      assert.match(output, /Detected surfaces:/);
      assert.match(output, /Path A observation:/);
      assert.match(output, /Path B replay\/freeze candidates:/);
      assert.match(output, /Path C connections\/candidates:/);
      assert.match(output, /unsupported=1/);
      assert.match(output, /Exclusive enforcement: unknown/);
      assert.match(output, /Dry run: no files written\./);
      assert.doesNotMatch(output, /private-|record once|demo|Paste the command|receipt/);
      await assert.rejects(readFile(path.join(root, ".reelier", "init", "state.json"), "utf8"), { code: "ENOENT" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("reelier init persists only its inspection directory and reports the stable artifact identifier", async () => {
  await withTempDir(async root => {
    const { result: code, output } = await capture(() => cmdInit(parsed(), { cwd: root, homedir: root, dependencies: localDependencies() }));
    assert.equal(code, 0);
    assert.match(output, /Local artifacts: \.reelier\/init\/inspection-report\.json/);
    assert.doesNotMatch(output, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(JSON.parse(await readFile(path.join(root, ".reelier", "init", "state.json"), "utf8")).v, "reelier.init-state/v1");
  });
});

test("reelier init refuses malformed checkpoints with a sanitized exit code", async () => {
  await withTempDir(async root => {
    const initDir = path.join(root, ".reelier", "init");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(initDir, { recursive: true });
    await writeFile(path.join(initDir, "state.json"), "credential=never-print-this", "utf8");
    const { result: code, output } = await capture(() => cmdInit(parsed(), { cwd: root, homedir: root, dependencies: localDependencies() }));
    assert.equal(code, 1);
    assert.equal(output, "Initialization refused: checkpoint state is malformed, unknown, or stale.");
    assert.doesNotMatch(output, /credential|never-print/);
  });
});

test("reelier init my-agent uses named bootstrap while bare init retains its inspection artifact", async () => {
  await withTempDir(async root => {
    const bare = await capture(() => cmdInit(parsed(), { cwd: root, homedir: root, dependencies: localDependencies() }));
    assert.equal(bare.result, 0);
    const namedResult = await capture(() => cmdInit(named("my-agent", ["yes"]), { cwd: root, homedir: root, dependencies: localDependencies() }));
    assert.equal(namedResult.result, 0);
    assert.match(namedResult.output, /npx reelier@0\.32\.1 up/);
    assert.equal(JSON.parse(await readFile(path.join(root, ".reelier", "bootstrap", "report.json"), "utf8")).authority, "unavailable");
  });
});

test("reelier init rejects more than one agent name", async () => {
  const result = await capture(() => cmdInit({ ...named("one"), positional: ["one", "two"] }));
  assert.equal(result.result, 1);
  assert.match(result.output, /at most one agent name/i);
});
