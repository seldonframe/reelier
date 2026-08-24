import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cmdInit, type CmdInitOverrides, type ParsedArgs } from "../src/cli.js";
import * as cliModule from "../src/cli.js";
import type { InitializationDependencies } from "../src/initialization.js";
import type { BootstrapNativeSessionFactory } from "../src/bootstrap/native-helper.js";

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

function missionControlOverrides(root: string): Pick<CmdInitOverrides, "missionControlLauncher"> {
  return {
    missionControlLauncher: async () => ({
      origin: "http://127.0.0.1:43111",
      url: `http://127.0.0.1:43111/#${"c".repeat(64)}`,
      pid: 4321,
      expiresAt: "2026-08-24T20:00:00.000Z",
    }),
  };
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

function filesystemNativeFactory(delayFirstMutation = false): BootstrapNativeSessionFactory {
  let held = false;
  return async ({ root, lockName, lockBytes }) => {
    if (held) throw new Error("named bootstrap is busy: native lock is held");
    held = true;
    const resolve = (relative: string) => path.join(root, ...relative.split("/"));
    const lockPath = resolve(lockName);
    let acquisition: Awaited<ReturnType<BootstrapNativeSessionFactory>>["acquisition"];
    try { acquisition = { status: "recovered", priorBytes: await readFile(lockPath) }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await writeFile(lockPath, lockBytes, { flag: "wx" }); acquisition = { status: "created" }; }
    let delayed = false;
    return {
      acquisition,
      async replaceLock(bytes) { await writeFile(lockPath, bytes); },
      async mkdir(relative) { if (delayFirstMutation && !delayed) { delayed = true; await new Promise(resolveDelay => setTimeout(resolveDelay, 30)); } await mkdir(resolve(relative)).catch(error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }); },
      async writeExclusive(relative, bytes) { await writeFile(resolve(relative), bytes, { flag: "wx" }); },
      async writeAtomic(relative, bytes) { await writeFile(resolve(relative), bytes); },
      async rename(from, to) { await rename(resolve(from), resolve(to)); },
      async remove(relative, options) { await rm(resolve(relative), { recursive: options.recursive, force: options.missingOk }); },
      async close(options) { if (options.removeLock) await unlink(lockPath).catch(() => {}); held = false; },
    };
  };
}

async function writeTask5bFixture(root: string): Promise<string> {
  const config = path.join(root, ".mcp.json");
  await writeFile(config, `${JSON.stringify({ mcpServers: {
    local: { command: "npx", args: ["-y", "@example/local"] },
    existing: { command: "npx", args: ["-y", "reelier", "mcp", "--wrap", "npx -y @example/existing"] },
    remote: { type: "http", url: "https://example.invalid/mcp" },
  } }, null, 2)}\n`);
  const now = Date.now();
  const row = (id: string, discoverySource: "host-config" | "plugin-manifest", transport: "mcp-stdio" | "mcp-http", observation: "observed" | "uncovered", reasonCode: string) => ({
    v: "reelier.route-coverage/v1", routeId: `route_${id.repeat(64)}`, hostId: "codex", discoverySource, transport,
    observation, replay: "unknown", outcome: "unknown", enforcement: observation === "observed" ? "unchecked" : "absent",
    observedAt: new Date(now - 1000).toISOString(), freshUntil: new Date(now + 60_000).toISOString(),
    evidenceDigest: `sha256:${id.repeat(64)}`, topologyEvidenceDigest: null, evidenceRefs: [`source:${id}`], reasonCodes: [reasonCode],
  });
  await mkdir(path.join(root, ".reelier", "bootstrap"), { recursive: true });
  await writeFile(path.join(root, ".reelier", "bootstrap", "route-coverage.json"), `${JSON.stringify([
    row("1", "host-config", "mcp-stdio", "uncovered", "route-unwrapped"),
    row("2", "host-config", "mcp-stdio", "observed", "wrapped-route-observed"),
    row("3", "host-config", "mcp-http", "uncovered", "route-unwrapped"),
    row("4", "plugin-manifest", "mcp-stdio", "uncovered", "plugin-private"),
  ], null, 2)}\n`);
  return config;
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

test("reelier init --managed --dry-run prints a redacted descriptor without filesystem or network writes", async () => {
  await withTempDir(async root => {
    const originalFetch = globalThis.fetch;
    const originalCredential = process.env.REELIER_MANAGED_CREDENTIAL;
    globalThis.fetch = (() => { throw new Error("managed init attempted network access"); }) as typeof fetch;
    process.env.REELIER_MANAGED_CREDENTIAL = "ambient-provider-credential";
    try {
      const { result: code, output } = await capture(() => cmdInit(parsed(["managed", "dry-run"]), { cwd: root, homedir: root, dependencies: localDependencies() }));
      assert.equal(code, 0);
      assert.match(output, /"v": "reelier\.managed-init\/v1"/);
      assert.match(output, /"endpoint": "<remote-mcp-endpoint>"/);
      assert.match(output, /"authority": "absent"/);
      assert.match(output, /"completeness": "unchecked"/);
      assert.match(output, /"credentials": "absent"/);
      assert.match(output, /"missionAuthorization": "absent"/);
      assert.doesNotMatch(output, /ambient-provider-credential/);
      await assert.rejects(readFile(path.join(root, ".reelier", "init", "state.json"), "utf8"), { code: "ENOENT" });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalCredential === undefined) delete process.env.REELIER_MANAGED_CREDENTIAL;
      else process.env.REELIER_MANAGED_CREDENTIAL = originalCredential;
    }
  });
});

test("reelier init --managed refuses names and incompatible initialization modes", async () => {
  const namedManaged = await capture(() => cmdInit(named("my-agent", ["managed"])));
  assert.equal(namedManaged.result, 1);
  assert.match(namedManaged.output, /managed.*agent name/i);

  const signingManaged = await capture(() => cmdInit(parsed(["managed", "signing"])));
  assert.equal(signingManaged.result, 1);
  assert.match(signingManaged.output, /managed.*signing/i);
});

test("bare reelier init starts accountless Mission Control instead of the legacy inspection ceremony", async () => {
  await withTempDir(async root => {
    const { result: code, output } = await capture(() => cmdInit(parsed(), { cwd: root, homedir: root, ...missionControlOverrides(root) }));
    assert.equal(code, 0);
    assert.match(output, /^Reelier Mission Control/);
    assert.match(output, /Local board: http:\/\/127\.0\.0\.1:43111/);
    assert.match(output, /account: not required/i);
    assert.doesNotMatch(output, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await assert.rejects(readFile(path.join(root, ".reelier", "init", "state.json"), "utf8"), { code: "ENOENT" });
    assert.equal(JSON.parse(await readFile(path.join(root, ".reelier", "operator.json"), "utf8")).v, "reelier.operator-workspace/v1");
  });
});

test("reelier init refuses malformed checkpoints with a sanitized exit code", async () => {
  await withTempDir(async root => {
    const initDir = path.join(root, ".reelier", "init");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(initDir, { recursive: true });
    await writeFile(path.join(initDir, "state.json"), "credential=never-print-this", "utf8");
    const { result: code, output } = await capture(() => cmdInit(parsed(["dry-run"]), { cwd: root, homedir: root, dependencies: localDependencies() }));
    assert.equal(code, 1);
    assert.equal(output, "Initialization refused: checkpoint state is malformed, unknown, or stale.");
    assert.doesNotMatch(output, /credential|never-print/);
  });
});

test("reelier init my-agent keeps named bootstrap while bare init uses Mission Control", async () => {
  await withTempDir(async root => {
    const bare = await capture(() => cmdInit(parsed(), { cwd: root, homedir: root, ...missionControlOverrides(root) }));
    assert.equal(bare.result, 0);
    const namedResult = await capture(() => cmdInit(named("my-agent", ["yes"]), { cwd: root, homedir: root, dependencies: localDependencies(), nativeSessionFactory: filesystemNativeFactory() }));
    assert.equal(namedResult.result, 0);
    assert.match(namedResult.output, /npx reelier@0\.32\.1 up my-agent/);
    assert.match(namedResult.output, /Authority absent/);
    assert.match(namedResult.output, /Completeness not-proved/);
    const pointer = JSON.parse(await readFile(path.join(root, ".reelier", "bootstrap", "current.json"), "utf8"));
    const report = JSON.parse(await readFile(path.join(root, ".reelier", "bootstrap", "generations", pointer.generation, "report.json"), "utf8"));
    assert.equal(report.authority, "absent");
    assert.equal(report.completeness, "not-proved");
  });
});

test("reelier init --json emits a stable local-only summary and --no-open suppresses browser opening", async () => {
  await withTempDir(async root => {
    let openBrowserWasProvided = true;
    const { result, output } = await capture(() => cmdInit(parsed(["json", "no-open"]), {
      cwd: root,
      homedir: root,
      missionControlLauncher: async (input) => {
        openBrowserWasProvided = input.openBrowser !== undefined;
        return { origin: "http://127.0.0.1:43111", url: `http://127.0.0.1:43111/#${"d".repeat(64)}`, pid: 8, expiresAt: "2026-08-24T20:00:00.000Z" };
      },
    }));
    assert.equal(result, 0);
    assert.equal(openBrowserWasProvided, false);
    const summary = JSON.parse(output);
    assert.deepEqual(Object.keys(summary), ["v", "status", "harnesses", "missions", "currentRepositoryMissions", "observedOnly", "boardOrigin", "accountRequired"]);
    assert.equal(summary.v, "reelier.mission-control-init/v1");
    assert.equal(summary.accountRequired, false);
    assert.equal("url" in summary, false);
  });
});

test("named init refuses an MCP config without sealed route evidence and leaves it byte-identical", async () => {
  await withTempDir(async root => {
    await writeFile(path.join(root, ".mcp.json"), JSON.stringify({ mcpServers: {
      local: { command: "npx", args: ["-y", "@example/server"] },
      legacy: { command: "npx", args: ["-y", "reelier", "mcp", "--wrap", "npx -y @example/legacy"] },
      remote: { url: "https://example.invalid/mcp" },
    } }), "utf8");
    const { result, output } = await capture(() => cmdInit(named("my-agent", ["yes"]), { cwd: root, homedir: root, dependencies: localDependencies(), nativeSessionFactory: filesystemNativeFactory() }));
    assert.equal(result, 1);
    assert.match(output, /refused/i);
    assert.equal(await readFile(path.join(root, ".mcp.json"), "utf8"), JSON.stringify({ mcpServers: {
      local: { command: "npx", args: ["-y", "@example/server"] },
      legacy: { command: "npx", args: ["-y", "reelier", "mcp", "--wrap", "npx -y @example/legacy"] },
      remote: { url: "https://example.invalid/mcp" },
    } }));
  });
});

test("named init does not spawn a package manager or any other process", async () => {
  await withTempDir(async root => {
    const fakeNpm = path.join(root, "fake-npm.mjs");
    const marker = path.join(root, "spawned.txt");
    await writeFile(fakeNpm, [
      'import { writeFileSync } from "node:fs";',
      `writeFileSync(${JSON.stringify(marker)}, "spawned\\n");`,
      'process.stdout.write(JSON.stringify([{ files: [{ path: "package.json" }] }]));',
    ].join("\n"));
    const previous = process.env.npm_execpath;
    process.env.npm_execpath = fakeNpm;
    try {
      const { result } = await capture(() => cmdInit(named("no-spawn-agent"), { cwd: root, homedir: root, dependencies: localDependencies(), nativeSessionFactory: filesystemNativeFactory() }));
      assert.equal(result, 0);
      await assert.rejects(readFile(marker, "utf8"), { code: "ENOENT" });
    } finally {
      if (previous === undefined) delete process.env.npm_execpath;
      else process.env.npm_execpath = previous;
    }
  });
});

test("reelier init rejects more than one agent name", async () => {
  const result = await capture(() => cmdInit({ ...named("one"), positional: ["one", "two"] }));
  assert.equal(result.result, 1);
  assert.match(result.output, /at most one agent name/i);
});

test("named init applies one sealed local MCP config transaction idempotently and rolls it back byte-exactly", async () => {
  await withTempDir(async root => {
    const noConsentRoot = path.join(root, "no-consent");
    await mkdir(noConsentRoot);
    const noConsentConfig = await writeTask5bFixture(noConsentRoot);
    const noConsentBefore = await readFile(noConsentConfig);
    const noConsent = await capture(() => cmdInit(named("my-agent"), { cwd: noConsentRoot, homedir: root, dependencies: localDependencies(), nativeSessionFactory: filesystemNativeFactory() } as never));
    assert.equal(noConsent.result, 1);
    assert.match(noConsent.output, /consent/i);
    assert.deepEqual(await readFile(noConsentConfig), noConsentBefore);

    const config = await writeTask5bFixture(root);
    const original = await readFile(config);
    const overrides = { cwd: root, homedir: root, dependencies: localDependencies(), nativeSessionFactory: filesystemNativeFactory() };

    const first = await capture(() => cmdInit(named("my-agent", ["yes"]), overrides as never));
    assert.equal(first.result, 0);
    assert.match(first.output, /wrapped=1.*already-wrapped=1.*unwrappable=1.*unsupported=1/i);
    const applied = await readFile(config);
    assert.notDeepEqual(applied, original);
    assert.deepEqual(JSON.parse(applied.toString()).mcpServers.local.args, ["-y", "reelier@0.32.1", "mcp", "--wrap", "npx -y @example/local"]);
    assert.deepEqual(JSON.parse(applied.toString()).mcpServers.remote, { type: "http", url: "https://example.invalid/mcp" });

    const second = await capture(() => cmdInit(named("my-agent", ["yes"]), overrides as never));
    assert.equal(second.result, 0);
    assert.deepEqual(await readFile(config), applied);

    const concurrentRoot = path.join(root, "concurrent");
    await mkdir(concurrentRoot);
    await writeTask5bFixture(concurrentRoot);
    const competing = { ...overrides, cwd: concurrentRoot, nativeSessionFactory: filesystemNativeFactory(true) };
    const concurrent = await capture(() => Promise.all([
      cmdInit(named("concurrent", ["yes"]), competing as never),
      cmdInit(named("concurrent", ["yes"]), competing as never),
    ]));
    assert.deepEqual(concurrent.result.sort(), [0, 1]);

    await rm(path.join(root, ".reelier", "bootstrap"), { recursive: true, force: true });
    await writeTask5bFixture(root);
    const rollbackOriginal = await readFile(config);
    const failed = await capture(() => cmdInit(named("rollback", ["yes"]), { ...overrides, failAt: "after-configuration-publication" } as never));
    assert.equal(failed.result, 1);
    assert.deepEqual(await readFile(config), rollbackOriginal);
  });
});

test("pinned up verifies the complete named plan idempotently and refuses drift without writes", async () => {
  await withTempDir(async root => {
    const config = await writeTask5bFixture(root);
    const nativeSessionFactory = filesystemNativeFactory();
    const overrides = { cwd: root, homedir: root, dependencies: localDependencies(), nativeSessionFactory };
    assert.equal((await capture(() => cmdInit(named("my-agent", ["yes"]), overrides))).result, 0);
    const applied = await readFile(config);
    const cmdUp = (cliModule as unknown as { cmdUp(args: ParsedArgs, overrides: unknown): Promise<number> }).cmdUp;

    const first = await capture(() => cmdUp(named("my-agent"), overrides));
    const second = await capture(() => cmdUp(named("my-agent"), overrides));
    assert.equal(first.result, 0);
    assert.deepEqual(second, first);
    assert.deepEqual(JSON.parse(first.output), {
      v: "reelier.named-up-result/v1", status: "verified", agentName: "my-agent", configuration: "verified",
      authority: "absent", completeness: "not-proved",
    });
    assert.deepEqual(await readFile(config), applied);

    await writeFile(config, Buffer.concat([applied, Buffer.from(" \n")]));
    const drifted = await readFile(config);
    assert.equal((await capture(() => cmdUp(named("my-agent"), overrides))).result, 1);
    assert.deepEqual(await readFile(config), drifted);

    await writeFile(config, applied);
    const routePath = path.join(root, ".reelier", "bootstrap", "route-coverage.json");
    const route = JSON.parse(await readFile(routePath, "utf8"));
    route[0].evidenceDigest = `sha256:${"f".repeat(64)}`;
    await writeFile(routePath, `${JSON.stringify(route, null, 2)}\n`);
    const beforeRefusal = await readFile(config);
    assert.equal((await capture(() => cmdUp(named("my-agent"), overrides))).result, 1);
    assert.deepEqual(await readFile(config), beforeRefusal);
  });
});
