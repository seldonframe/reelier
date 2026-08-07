// Mirrors test/coverage.test.ts for --host claude-code. The Codex families are
// reproduced case-for-case so a regression in one host is visible against the
// other; the claude-code-only cases (tri-state enablement, the projects[] blind
// spot, plugin.json manifest shapes) have no Codex analog and are marked.
//
// Everything here runs against fixture directories. Nothing reads the real
// machine — a probe test that passes only on the author's laptop proves nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import {
  analyzeJsonMcpConfig,
  analyzePluginManifest,
  collectClaudeCodeCoverage,
  collectCodexCoverage,
  renderCoverageView,
  renderCoverageReport,
  type CoverageServer,
  type CoverageView,
} from "../src/coverage.js";
import { cmdCoverage } from "../src/cli.js";

function captureConsole(): { lines: string[]; errors: string[]; restore: () => void } {
  const lines: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...parts: unknown[]) => void lines.push(parts.join(" "));
  console.error = (...parts: unknown[]) => void errors.push(parts.join(" "));
  return { lines, errors, restore: () => { console.log = origLog; console.error = origErr; } };
}

const MCP_JSON = "C:/work/project/.mcp.json";

// --- T1..T5: host-config analysis (mirrors the analyzeCodexConfig family) ----

test("analyzeJsonMcpConfig reports an absent config as absent, with no invented servers", () => {
  const source = analyzeJsonMcpConfig(undefined, MCP_JSON);
  assert.equal(source.location, "absent");
  assert.equal(source.servers.length, 0);
});

test("analyzeJsonMcpConfig classifies a plain stdio entry as unwrapped", () => {
  const raw = JSON.stringify({ mcpServers: { neon: { command: "npx", args: ["-y", "@neondatabase/mcp-server-neon", "start"] } } });
  const source = analyzeJsonMcpConfig(raw, MCP_JSON);
  assert.equal(source.location, "parsed");
  assert.equal(source.servers.length, 1);
  assert.equal(source.servers[0]?.name, "neon");
  assert.equal(source.servers[0]?.transport, "stdio");
  assert.equal(source.servers[0]?.routing, "unwrapped");
  assert.equal(source.servers[0]?.origin, MCP_JSON);
});

// Guards W5: isWrappedEntry (src/wrap.ts) requires command === "npx" and would
// report this exact entry unwrapped. Routing must come from one oracle only.
test("analyzeJsonMcpConfig reports a hand-wrapped stdio entry as wrapped — never assumed from the writer gap", () => {
  const raw = JSON.stringify({ mcpServers: { gbrain: { command: "reelier", args: ["mcp", "--wrap", "node srv.js"] } } });
  const source = analyzeJsonMcpConfig(raw, MCP_JSON);
  assert.equal(source.servers[0]?.routing, "wrapped");
});

test("analyzeJsonMcpConfig reports a url entry as unwrapped with the no-native-wrap-path note", () => {
  const raw = JSON.stringify({ mcpServers: { posthog: { type: "http", url: "https://mcp.posthog.com/mcp" } } });
  const source = analyzeJsonMcpConfig(raw, MCP_JSON);
  assert.equal(source.servers[0]?.transport, "url");
  assert.equal(source.servers[0]?.routing, "unwrapped");
  assert.equal(source.servers[0]?.routingNote, "no native Reelier wrap path");
});

test("analyzeJsonMcpConfig marks a config it cannot parse as unreadable instead of guessing", () => {
  const source = analyzeJsonMcpConfig("{ not json", MCP_JSON);
  assert.equal(source.location, "unreadable");
  assert.equal(source.servers.length, 0);
  assert.ok(source.detail);
});

test("analyzeJsonMcpConfig marks an entry it cannot read as unreadable with no routing claim, and keeps its siblings", () => {
  const raw = JSON.stringify({ mcpServers: { broken: { note: "neither command nor url" }, fine: { command: "node" } } });
  const source = analyzeJsonMcpConfig(raw, MCP_JSON);
  const broken = source.servers.find((s: CoverageServer) => s.name === "broken");
  const fine = source.servers.find((s: CoverageServer) => s.name === "fine");
  assert.equal(broken?.location, "unreadable");
  assert.equal(broken?.routing, undefined);
  assert.equal(fine?.location, "parsed");
  assert.equal(fine?.routing, "unwrapped");
});

// W4: ~/.claude.json is a large object of unrelated keys. The bare-root-map
// branch that plugin manifests need would mark the whole file unreadable here.
test("analyzeJsonMcpConfig reads only the mcpServers key of a host config — a bare root map is not a server map here", () => {
  const raw = JSON.stringify({ numStartups: 42, tipsHistory: {}, mcpServers: { demo: { command: "node" } } });
  const source = analyzeJsonMcpConfig(raw, "C:/Users/alice/.claude.json");
  assert.equal(source.location, "parsed");
  assert.equal(source.servers.length, 1);
  assert.equal(source.servers[0]?.name, "demo");
});

test("analyzeJsonMcpConfig reports a host config with no mcpServers key as parsed with zero servers, not unreadable", () => {
  const source = analyzeJsonMcpConfig(JSON.stringify({ numStartups: 42 }), "C:/Users/alice/.claude.json");
  assert.equal(source.location, "parsed");
  assert.equal(source.servers.length, 0);
});

// --- T7: shape parity (replaces the Codex TOML-literal case — no analog) -----

test("a server declared as {mcpServers:{…}} and as a bare root map produce identical coverage", () => {
  const entry = { command: "npx", args: ["@playwright/mcp@latest"] };
  const wrapped = analyzePluginManifest("C:/plugins/pw/.mcp.json", JSON.stringify({ mcpServers: { playwright: entry } }));
  const bare = analyzePluginManifest("C:/plugins/pw/.mcp.json", JSON.stringify({ playwright: entry }));
  assert.deepEqual(wrapped.servers, bare.servers);
  assert.equal(wrapped.location, bare.location);
});

// --- fixtures ---------------------------------------------------------------

interface Fixture {
  root: string;
  home: string;
  cwd: string;
  pluginRoot: string;
}

/** Absolute install paths, exactly as installed_plugins.json records them — the version segment is already part of the path. */
async function buildClaudeCodeFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-cc-coverage-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  const pluginRoot = path.join(home, ".claude", "plugins");
  const otherProject = path.join(root, "other-project");
  await mkdir(path.join(home, ".claude"), { recursive: true });
  await mkdir(cwd, { recursive: true });

  // Group A — host configs, the surface `install` can reach.
  await writeFile(
    path.join(cwd, ".mcp.json"),
    JSON.stringify({ mcpServers: { demo: { command: "node", args: ["srv.js"] } } }),
    "utf8",
  );
  await writeFile(
    path.join(home, ".claude.json"),
    JSON.stringify({
      numStartups: 7,
      mcpServers: {
        neon: { command: "npx", args: ["-y", "@neondatabase/mcp-server-neon", "start"] },
        // Same NAME as a plugin-delivered server below — must never be deduped across the boundary.
        playwright: { type: "http", url: "https://example.invalid/mcp" },
      },
      projects: {
        [cwd]: { mcpServers: { project_scoped: { command: "node", args: ["scoped.js"] } } },
        [otherProject]: { mcpServers: { never_read: { command: "node" } } },
      },
    }),
    "utf8",
  );

  // Group B — plugin-delivered, outside install's reach.
  const located = path.join(pluginRoot, "cache", "official", "located", "1.0.0");
  const mystery = path.join(pluginRoot, "cache", "official", "mystery", "unknown");
  const inlineJson = path.join(pluginRoot, "cache", "official", "inline", "2.0.6");
  const pointer = path.join(pluginRoot, "cache", "official", "pointer", "unknown");
  const plain = path.join(pluginRoot, "cache", "official", "plain", "unknown");
  await mkdir(located, { recursive: true });
  await mkdir(mystery, { recursive: true });
  await mkdir(path.join(inlineJson, ".claude-plugin"), { recursive: true });
  await mkdir(path.join(pointer, ".claude-plugin"), { recursive: true });
  await mkdir(path.join(plain, ".claude-plugin"), { recursive: true });

  await writeFile(
    path.join(located, ".mcp.json"),
    JSON.stringify({ playwright: { command: "npx", args: ["@playwright/mcp@latest"] } }),
    "utf8",
  );
  await writeFile(
    path.join(mystery, ".mcp.json"),
    JSON.stringify({ mcpServers: { mystery_tool: { command: "node", args: ["m.js"] } } }),
    "utf8",
  );
  await writeFile(
    path.join(inlineJson, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "inline", mcpServers: { inline_tool: { command: "node", args: ["i.js"] } } }),
    "utf8",
  );
  await writeFile(
    path.join(pointer, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "pointer", mcpServers: "./extra-mcp.json" }),
    "utf8",
  );
  await writeFile(
    path.join(pointer, "extra-mcp.json"),
    JSON.stringify({ mcpServers: { pointed_tool: { command: "node", args: ["p.js"] } } }),
    "utf8",
  );
  await writeFile(
    path.join(plain, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "plain", version: "1.0.0" }),
    "utf8",
  );

  await writeFile(
    path.join(pluginRoot, "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "located@official": [{ scope: "user", installPath: located, version: "1.0.0" }],
        "off@official": [{ scope: "user", installPath: path.join(pluginRoot, "cache", "official", "off", "1.0.0"), version: "1.0.0" }],
        "ghost@official": [{ scope: "user", installPath: path.join(pluginRoot, "cache", "official", "ghost", "9.9.9"), version: "9.9.9" }],
        "mystery@official": [{ scope: "user", installPath: mystery, version: "unknown" }],
        "inline@official": [{ scope: "user", installPath: inlineJson, version: "2.0.6" }],
        "pointer@official": [{ scope: "user", installPath: pointer, version: "unknown" }],
        "plain@official": [{ scope: "user", installPath: plain, version: "unknown" }],
      },
    }),
    "utf8",
  );

  // Enablement, user scope. `mystery` is deliberately absent from every scope
  // and ships no defaultEnabled — the tri-state `unknown` case.
  await writeFile(
    path.join(home, ".claude", "settings.json"),
    JSON.stringify({
      enabledPlugins: {
        "located@official": true,
        "off@official": false,
        "ghost@official": true,
        "inline@official": true,
        "pointer@official": true,
        "plain@official": true,
      },
    }),
    "utf8",
  );

  return { root, home, cwd, pluginRoot };
}

function pluginNamed(view: CoverageView, name: string) {
  return view.plugins.find((p) => p.registration.name === name);
}

// --- T6, T8, T9, T10, T15, T16: the collector --------------------------------

test("collectClaudeCodeCoverage joins installed_plugins.json with enabledPlugins into a tri-state, never defaulting a missing key to enabled", async () => {
  const fx = await buildClaudeCodeFixture();
  try {
    const view = await collectClaudeCodeCoverage(fx.cwd, fx.home, {});
    assert.equal(pluginNamed(view, "located")?.enablement?.state, "enabled");
    assert.equal(pluginNamed(view, "off")?.enablement?.state, "disabled");
    assert.equal(pluginNamed(view, "mystery")?.enablement?.state, "unknown");
    // The source of each claim is named, so an operator can check it.
    assert.ok(pluginNamed(view, "located")?.enablement?.source.includes("settings.json"));
    assert.ok(pluginNamed(view, "mystery")?.enablement?.source);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test("collectClaudeCodeCoverage prefers a narrower enablement scope over a wider one", async () => {
  const fx = await buildClaudeCodeFixture();
  try {
    await mkdir(path.join(fx.cwd, ".claude"), { recursive: true });
    await writeFile(
      path.join(fx.cwd, ".claude", "settings.local.json"),
      JSON.stringify({ enabledPlugins: { "located@official": false } }),
      "utf8",
    );
    const view = await collectClaudeCodeCoverage(fx.cwd, fx.home, {});
    const located = pluginNamed(view, "located");
    assert.equal(located?.enablement?.state, "disabled");
    assert.ok(located?.enablement?.source.includes("settings.local.json"));
    assert.equal(located?.inspected, false);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test("collectClaudeCodeCoverage falls back to plugin.json defaultEnabled when no scope carries the key", async () => {
  const fx = await buildClaudeCodeFixture();
  try {
    const manifestDir = path.join(fx.pluginRoot, "cache", "official", "mystery", "unknown", ".claude-plugin");
    await mkdir(manifestDir, { recursive: true });
    await writeFile(path.join(manifestDir, "plugin.json"), JSON.stringify({ name: "mystery", defaultEnabled: false }), "utf8");
    const view = await collectClaudeCodeCoverage(fx.cwd, fx.home, {});
    const mystery = pluginNamed(view, "mystery");
    assert.equal(mystery?.enablement?.state, "disabled");
    assert.ok(mystery?.enablement?.source.includes("plugin.json"));
    assert.equal(mystery?.inspected, false);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test("collectClaudeCodeCoverage parses plugin.json manifest shapes: inline object, pointer file, and no mcpServers at all", async () => {
  const fx = await buildClaudeCodeFixture();
  try {
    const view = await collectClaudeCodeCoverage(fx.cwd, fx.home, {});

    const inline = pluginNamed(view, "inline");
    assert.equal(inline?.location, "parsed");
    assert.equal(inline?.servers[0]?.name, "inline_tool");
    assert.equal(inline?.servers[0]?.routing, "unwrapped");

    const pointer = pluginNamed(view, "pointer");
    assert.equal(pointer?.location, "parsed");
    assert.equal(pointer?.servers[0]?.name, "pointed_tool");
    assert.ok(pointer?.servers[0]?.origin.endsWith("extra-mcp.json"));

    // A plugin.json without mcpServers declares no servers. That is absence,
    // not an error — it must not report `unreadable`.
    const plain = pluginNamed(view, "plain");
    assert.equal(plain?.location, "absent");
    assert.equal(plain?.servers.length, 0);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test("collectClaudeCodeCoverage reads the manifest at installPath and never re-appends the version segment", async () => {
  const fx = await buildClaudeCodeFixture();
  try {
    const view = await collectClaudeCodeCoverage(fx.cwd, fx.home, {});
    // `mystery` has version "unknown" — the literal string 6 of 12 plugins use
    // on the reference machine — and installPath already ends with it.
    const mystery = pluginNamed(view, "mystery");
    const expected = path.join(fx.pluginRoot, "cache", "official", "mystery", "unknown", ".mcp.json");
    assert.equal(mystery?.manifestPath, expected);
    assert.equal(mystery?.servers[0]?.name, "mystery_tool");
    assert.ok(!mystery?.manifestPath?.includes(path.join("unknown", "unknown")));
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test("collectClaudeCodeCoverage inventories all four plugin outcomes: located, disabled, unlocatable, enablement-unknown", async () => {
  const fx = await buildClaudeCodeFixture();
  try {
    const view = await collectClaudeCodeCoverage(fx.cwd, fx.home, {});

    const located = pluginNamed(view, "located");
    assert.equal(located?.inspected, true);
    assert.equal(located?.location, "parsed");
    assert.equal(located?.servers[0]?.name, "playwright");

    const off = pluginNamed(view, "off");
    assert.equal(off?.inspected, false);
    assert.equal(off?.servers.length, 0);
    assert.equal(off?.candidatesTried.length, 0);

    const ghost = pluginNamed(view, "ghost");
    assert.equal(ghost?.inspected, true);
    assert.equal(ghost?.location, "absent");
    assert.ok((ghost?.candidatesTried.length ?? 0) > 0);

    const mystery = pluginNamed(view, "mystery");
    assert.equal(mystery?.inspected, true);
    assert.equal(mystery?.location, "parsed");
    assert.equal(mystery?.enablement?.state, "unknown");
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

// W3/§7.6 boundary: `.mcp.json` at a repo root is in install's reach; the same
// filename at a plugin payload root is not. Same name, opposite side.
test("collectClaudeCodeCoverage never merges a plugin-delivered server with a host-config server of the same name", async () => {
  const fx = await buildClaudeCodeFixture();
  try {
    const view = await collectClaudeCodeCoverage(fx.cwd, fx.home, {});
    const fromHost = view.sources.flatMap((s) => s.servers).filter((s) => s.name === "playwright");
    const fromPlugin = pluginNamed(view, "located")?.servers.filter((s) => s.name === "playwright") ?? [];
    assert.equal(fromHost.length, 1);
    assert.equal(fromPlugin.length, 1);
    assert.notEqual(fromHost[0]?.origin, fromPlugin[0]?.origin);
    assert.ok(fromHost[0]?.origin.endsWith(".claude.json"));
    assert.ok(fromPlugin[0]?.origin.endsWith(".mcp.json"));
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

// D-6: `install` wraps only the top-level mcpServers of ~/.claude.json. The
// host also loads projects[<cwd>].mcpServers, so it gets its own source.
test("collectClaudeCodeCoverage reports projects[cwd].mcpServers as its own source and counts the sibling keys it did not read", async () => {
  const fx = await buildClaudeCodeFixture();
  try {
    const view = await collectClaudeCodeCoverage(fx.cwd, fx.home, {});
    const scoped = view.sources.find((s) => s.path.includes("#projects/"));
    assert.ok(scoped, "the projects[cwd] entry must be its own source");
    assert.ok(scoped.path.endsWith(`#projects/${fx.cwd}`));
    assert.equal(scoped.servers.length, 1);
    assert.equal(scoped.servers[0]?.name, "project_scoped");
    assert.equal(scoped.servers[0]?.origin, scoped.path);
    assert.match(scoped.detail ?? "", /1 .*project key/);
    // The sibling project's server must never appear anywhere in the report.
    assert.ok(!view.sources.flatMap((s) => s.servers).some((s) => s.name === "never_read"));
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test("collectClaudeCodeCoverage honours CLAUDE_CODE_PLUGIN_CACHE_DIR over the default plugin root", async () => {
  const fx = await buildClaudeCodeFixture();
  try {
    const relocated = path.join(fx.root, "seeded-plugins");
    await mkdir(relocated, { recursive: true });
    await writeFile(path.join(relocated, "installed_plugins.json"), JSON.stringify({ version: 2, plugins: {} }), "utf8");
    const view = await collectClaudeCodeCoverage(fx.cwd, fx.home, { CLAUDE_CODE_PLUGIN_CACHE_DIR: relocated });
    assert.equal(view.plugins.length, 0, "the default root must not be consulted once the cache dir is set");
    assert.ok(view.pluginSource?.startsWith(relocated));
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test("collectClaudeCodeCoverage says WHY the plugin list is empty instead of rendering an unread registry as a clean result", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-cc-noreg-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  await mkdir(path.join(home, ".claude"), { recursive: true });
  await mkdir(cwd, { recursive: true });
  try {
    const absent = await collectClaudeCodeCoverage(cwd, home, {});
    assert.equal(absent.plugins.length, 0);
    assert.equal(absent.pluginRegistry?.location, "absent");
    assert.match(renderCoverageView(absent).join("\n"), /Plugins: .*installed_plugins\.json — absent/);

    await mkdir(path.join(home, ".claude", "plugins"), { recursive: true });
    await writeFile(path.join(home, ".claude", "plugins", "installed_plugins.json"), "{ not json", "utf8");
    const broken = await collectClaudeCodeCoverage(cwd, home, {});
    assert.equal(broken.pluginRegistry?.location, "unreadable");
    assert.match(renderCoverageView(broken).join("\n"), /Plugins: .*installed_plugins\.json — unreadable/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("collectClaudeCodeCoverage counts registrations it could not read rather than dropping them", async () => {
  const fx = await buildClaudeCodeFixture();
  try {
    await writeFile(
      path.join(fx.pluginRoot, "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "good@official": [{ installPath: fx.cwd }], "bad@official": [{ noInstallPath: true }] } }),
      "utf8",
    );
    const view = await collectClaudeCodeCoverage(fx.cwd, fx.home, {});
    assert.equal(view.plugins.length, 1);
    assert.match(view.pluginRegistry?.detail ?? "", /1 registration\(s\) had no readable installPath/);
    assert.match(renderCoverageView(view).join("\n"), /1 registration\(s\) had no readable installPath/);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

// --- T11, T12: rendering -----------------------------------------------------

test("renderCoverageView names one denominator per file, ends with the exact inventory line, and never prints a percentage", async () => {
  const fx = await buildClaudeCodeFixture();
  try {
    const view = await collectClaudeCodeCoverage(fx.cwd, fx.home, {});
    const lines = renderCoverageView(view);
    assert.equal(lines[lines.length - 1], "Observed inventory only; this is not proof of completeness.");
    const text = lines.join("\n");
    assert.match(text, /1 of 1 entries in .*\.mcp\.json parsed/);
    assert.match(text, /2 of 2 entries in .*\.claude\.json parsed/);
    assert.match(text, /no native Reelier wrap path/);
    // The verdict that suppressed inspection names the file that made it.
    assert.match(text, /disabled \(.*settings\.json enabledPlugins\["off@official"\]\) — payload not inspected/);
    assert.match(text, /payload not located/);
    assert.match(text, /enablement unknown/);
    // `unknown` must never be rendered as a positive enablement claim.
    assert.ok(!/mystery@official.* — enabled/.test(text));
    assert.ok(!text.includes("%"), "an overall coverage percentage must never be printed");
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test("renderCoverageView names the host on the first line — for claude-code and for codex", async () => {
  const fx = await buildClaudeCodeFixture();
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "reelier-cc-codex-"));
  try {
    const view = await collectClaudeCodeCoverage(fx.cwd, fx.home, {});
    assert.equal(renderCoverageView(view)[0], "Observed coverage — host: claude-code");
    // The Codex adapter must keep saying codex — this line is asserted nowhere else.
    assert.equal(renderCoverageReport(await collectCodexCoverage(codexHome))[0], "Observed coverage — host: codex");
  } finally {
    await rm(fx.root, { recursive: true, force: true });
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("renderCoverageView reports an unreadable host config as unreadable, never as zero servers", async () => {
  const view: CoverageView = {
    host: "claude-code",
    sources: [{ path: "C:/work/.mcp.json", location: "unreadable", detail: "Unexpected token", servers: [] }],
    plugins: [],
    inspectedLocations: ["C:/work/.mcp.json"],
  };
  const text = renderCoverageView(view).join("\n");
  assert.match(text, /unreadable/);
  assert.ok(!/0 of 0 entries/.test(text), "an unreadable file must not be rendered as a clean empty result");
});

// --- T14: read-only ----------------------------------------------------------

async function snapshotTree(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(`d ${p}`);
        await walk(p);
      } else {
        const s = await stat(p);
        out.push(`f ${p} ${s.size} ${s.mtimeMs}`);
      }
    }
  }
  await walk(root);
  return out;
}

test("collectClaudeCodeCoverage leaves the inspected tree byte-identical — the probe only ever reads", async () => {
  const fx = await buildClaudeCodeFixture();
  try {
    const before = await snapshotTree(fx.root);
    await collectClaudeCodeCoverage(fx.cwd, fx.home, {});
    assert.deepEqual(await snapshotTree(fx.root), before);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

// --- T13, T14: through the CLI ----------------------------------------------

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function parsedArgs(opts: Record<string, string> = {}, flags: string[] = []) {
  return { positional: [], opts, flags: new Set(flags), vars: {}, wraps: [], fails: [] };
}

// End-to-end through the real argv parser — a direct-ParsedArgs test cannot
// catch `--host`/`--workspace` failing to register as value-taking options.
test("the real CLI accepts `coverage --host claude-code --workspace <dir>`", async () => {
  const fx = await buildClaudeCodeFixture();
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_PATH, "coverage", "--host", "claude-code", "--workspace", fx.cwd],
      { env: { ...process.env, USERPROFILE: fx.home, HOME: fx.home } },
    );
    const lines = stdout.trimEnd().split(/\r?\n/);
    assert.equal(lines[0], "Observed coverage — host: claude-code");
    assert.equal(lines[lines.length - 1], "Observed inventory only; this is not proof of completeness.");
    assert.match(stdout, /demo\s+stdio\s+unwrapped/);
    // --workspace really moved cwd: the fixture project config was the one read.
    assert.ok(stdout.includes(path.join(fx.cwd, ".mcp.json")));
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test("cmdCoverage --host claude-code is read-only reporting: exits 0 and mutates nothing", async () => {
  const fx = await buildClaudeCodeFixture();
  const captured = captureConsole();
  try {
    const before = await snapshotTree(fx.root);
    const exit = await cmdCoverage(parsedArgs({ host: "claude-code" }) as never, fx.home, fx.cwd);
    captured.restore();
    assert.equal(exit, 0);
    assert.equal(captured.lines[captured.lines.length - 1], "Observed inventory only; this is not proof of completeness.");
    assert.deepEqual(await snapshotTree(fx.root), before);
  } finally {
    captured.restore();
    await rm(fx.root, { recursive: true, force: true });
  }
});

test("cmdCoverage names both supported hosts when --host is missing or unsupported", async () => {
  const captured = captureConsole();
  try {
    assert.equal(await cmdCoverage(parsedArgs() as never), 1);
    assert.equal(await cmdCoverage(parsedArgs({ host: "cursor" }) as never), 1);
    const errors = captured.errors.join("\n");
    assert.match(errors, /codex/);
    assert.match(errors, /claude-code/);
  } finally {
    captured.restore();
  }
});
