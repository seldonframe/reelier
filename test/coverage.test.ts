import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  analyzeCodexConfig,
  analyzePluginManifest,
  collectCodexCoverage,
  renderCoverageReport,
  type CoverageServer,
} from "../src/coverage.js";
import { translateCodexCoverage } from "../src/routes/hosts/codex.js";
import type { RouteCoverageV1 } from "../src/routes/types.js";

const CONFIG_PATH = "C:/Users/alice/.codex/config.toml";

test("analyzeCodexConfig reports an absent config as absent, with no invented servers", () => {
  const analysis = analyzeCodexConfig(undefined, CONFIG_PATH);
  assert.equal(analysis.location, "absent");
  assert.equal(analysis.servers.length, 0);
  assert.equal(analysis.plugins.length, 0);
});

test("Codex route translation preserves config and plugin origins with the same server name", () => {
  const rows = translateCodexCoverage({
    report: {
      homedir: "C:/private",
      configPath: "C:/private/.codex/config.toml",
      config: { configPath: "C:/private/.codex/config.toml", location: "parsed", servers: [{ name: "gmail.send", origin: "C:/private/.codex/config.toml", location: "parsed", transport: "stdio", routing: "wrapped" }], plugins: [], marketplaces: [] },
      plugins: [{ registration: { name: "gmail", marketplace: "official", enabled: true }, inspected: true, location: "parsed", manifestPath: "C:/private/plugins/gmail/mcp.json", candidatesTried: [], servers: [{ name: "gmail.send", origin: "C:/private/plugins/gmail/mcp.json", location: "parsed", transport: "stdio", routing: "unwrapped" }] }],
      inspectedLocations: ["C:/private/.codex/config.toml"],
    },
    observedAt: "2026-08-15T12:00:00.000Z", freshnessMs: 900_000, sourceDigest: `sha256:${"1".repeat(64)}`,
    canonicalConfigBytes: "[mcp_servers.gmail]", fileIdentityDigest: `sha256:${"2".repeat(64)}`,
  });
  assert.deepEqual(rows.map((row: RouteCoverageV1) => [row.routeId, row.observation]), [["host-config:gmail.send", "observed"], ["plugin-manifest:gmail.send", "uncovered"]]);
});

test("analyzeCodexConfig classifies a plain stdio entry as unwrapped", () => {
  const raw = ['[mcp_servers.neon]', 'command = "npx"', 'args = [ "-y", "@neondatabase/mcp-server-neon", "start" ]'].join("\n");
  const analysis = analyzeCodexConfig(raw, CONFIG_PATH);
  assert.equal(analysis.location, "parsed");
  assert.equal(analysis.servers.length, 1);
  assert.equal(analysis.servers[0]?.name, "neon");
  assert.equal(analysis.servers[0]?.transport, "stdio");
  assert.equal(analysis.servers[0]?.routing, "unwrapped");
});

test("analyzeCodexConfig reports a hand-wrapped stdio entry as wrapped — never assumed from the writer gap", () => {
  const raw = ['[mcp_servers.gbrain]', 'command = "npx"', 'args = [ "-y", "reelier", "mcp", "--wrap", "node server.js" ]'].join("\n");
  const analysis = analyzeCodexConfig(raw, CONFIG_PATH);
  assert.equal(analysis.servers[0]?.routing, "wrapped");
});

test("analyzeCodexConfig reports a url entry as unwrapped with the no-native-wrap-path note", () => {
  const raw = ['[mcp_servers.posthog]', 'url = "https://mcp.posthog.com/mcp"'].join("\n");
  const analysis = analyzeCodexConfig(raw, CONFIG_PATH);
  assert.equal(analysis.servers[0]?.transport, "url");
  assert.equal(analysis.servers[0]?.routing, "unwrapped");
  assert.equal(analysis.servers[0]?.routingNote, "no native Reelier wrap path");
});

test("analyzeCodexConfig marks a relevant section it cannot parse as unreadable instead of guessing", () => {
  const raw = ['[mcp_servers.broken]', 'command = """multi', 'line"""', '', '[mcp_servers.fine]', 'command = "node"'].join("\n");
  const analysis = analyzeCodexConfig(raw, CONFIG_PATH);
  const broken = analysis.servers.find((s: CoverageServer) => s.name === "broken");
  const fine = analysis.servers.find((s: CoverageServer) => s.name === "fine");
  assert.equal(broken?.location, "unreadable");
  assert.equal(broken?.routing, undefined);
  assert.equal(fine?.location, "parsed");
  assert.equal(fine?.routing, "unwrapped");
});

test("analyzeCodexConfig reads plugin registrations and marketplaces", () => {
  const raw = [
    '[marketplaces.official]',
    'source_type = "local"',
    'source = "C:/Users/alice/.codex/market"',
    '[plugins."browser@official"]',
    'enabled = true',
    '[plugins."docs@official"]',
    'enabled = false',
  ].join("\n");
  const analysis = analyzeCodexConfig(raw, CONFIG_PATH);
  assert.equal(analysis.marketplaces.length, 1);
  assert.equal(analysis.marketplaces[0]?.name, "official");
  assert.equal(analysis.marketplaces[0]?.source, "C:/Users/alice/.codex/market");
  assert.deepEqual(
    analysis.plugins.map((p: { name: string; marketplace: string; enabled: boolean }) => [p.name, p.marketplace, p.enabled]),
    [["browser", "official", true], ["docs", "official", false]],
  );
});

test("analyzeCodexConfig reads TOML literal (single-quoted) strings — the common shape for Windows paths", () => {
  const raw = [
    "[mcp_servers.node_repl]",
    "command = 'C:\\Users\\alice\\AppData\\Local\\node.exe'",
    "args = [ 'repl.js', \"--port\", '8123' ]",
  ].join("\n");
  const analysis = analyzeCodexConfig(raw, CONFIG_PATH);
  assert.equal(analysis.servers[0]?.location, "parsed");
  assert.equal(analysis.servers[0]?.transport, "stdio");
  assert.equal(analysis.servers[0]?.routing, "unwrapped");
});

test("analyzePluginManifest classifies servers in a plugin's mcp.json, including url entries", () => {
  const raw = JSON.stringify({
    mcpServers: {
      db: { command: "node", args: ["server.js"] },
      remote: { url: "https://example.com/mcp" },
    },
  });
  const result = analyzePluginManifest("C:/plugins/demo/mcp.json", raw);
  assert.equal(result.location, "parsed");
  assert.equal(result.servers.length, 2);
  const db = result.servers.find((s: CoverageServer) => s.name === "db");
  const remote = result.servers.find((s: CoverageServer) => s.name === "remote");
  assert.equal(db?.routing, "unwrapped");
  assert.equal(remote?.transport, "url");
  assert.equal(remote?.routingNote, "no native Reelier wrap path");
});

test("analyzePluginManifest accepts a bare root server map — the shape real Claude-format plugin .mcp.json files use", () => {
  const raw = JSON.stringify({ playwright: { command: "npx", args: ["@playwright/mcp@latest"] } });
  const result = analyzePluginManifest("C:/plugins/playwright/.mcp.json", raw);
  assert.equal(result.location, "parsed");
  assert.equal(result.servers[0]?.name, "playwright");
  assert.equal(result.servers[0]?.transport, "stdio");
  assert.equal(result.servers[0]?.routing, "unwrapped");
});

test("analyzePluginManifest rejects a root object that is not a server map instead of guessing", () => {
  const raw = JSON.stringify({ name: "some-plugin", version: "1.0.0" });
  const result = analyzePluginManifest("C:/plugins/demo/.mcp.json", raw);
  assert.equal(result.location, "unreadable");
  assert.equal(result.servers.length, 0);
});

test("analyzePluginManifest reports malformed JSON as unreadable with no invented servers", () => {
  const result = analyzePluginManifest("C:/plugins/demo/mcp.json", "{ not json");
  assert.equal(result.location, "unreadable");
  assert.equal(result.servers.length, 0);
});

async function buildCodexFixture(): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), "reelier-coverage-"));
  const codexDir = path.join(home, ".codex");
  const marketDir = path.join(codexDir, "market");
  const payloadDir = path.join(marketDir, "browser");
  await mkdir(payloadDir, { recursive: true });
  await writeFile(
    path.join(codexDir, "config.toml"),
    [
      'model = "irrelevant"',
      "[mcp_servers.wrapped_one]",
      'command = "npx"',
      'args = [ "-y", "reelier", "mcp", "--wrap", "node srv.js" ]',
      "[mcp_servers.posthog]",
      'url = "https://mcp.posthog.com/mcp"',
      "[marketplaces.official]",
      'source_type = "local"',
      `source = ${JSON.stringify(marketDir)}`,
      '[plugins."browser@official"]',
      "enabled = true",
      '[plugins."docs@official"]',
      "enabled = false",
      '[plugins."ghost@official"]',
      "enabled = true",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(payloadDir, "mcp.json"),
    JSON.stringify({ mcpServers: { browser_tool: { command: "node", args: ["browser.js"] } } }),
    "utf8",
  );
  return home;
}

test("collectCodexCoverage finds a manifest one level below the payload root — the real Codex cache layout", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "reelier-coverage-nested-"));
  const codexDir = path.join(home, ".codex");
  const channelDir = path.join(codexDir, "plugins", "cache", "official", "playwright", "local");
  await mkdir(channelDir, { recursive: true });
  await writeFile(
    path.join(codexDir, "config.toml"),
    ['[plugins."playwright@official"]', "enabled = true"].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(channelDir, ".mcp.json"),
    JSON.stringify({ mcpServers: { playwright: { command: "npx", args: ["playwright-mcp"] } } }),
    "utf8",
  );
  try {
    const report = await collectCodexCoverage(home);
    const plugin = report.plugins.find((p) => p.registration.name === "playwright");
    assert.equal(plugin?.location, "parsed");
    assert.equal(plugin?.servers[0]?.name, "playwright");
    assert.equal(plugin?.servers[0]?.routing, "unwrapped");
    assert.ok(plugin?.manifestPath?.endsWith(".mcp.json"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("collectCodexCoverage inventories config, located payloads, disabled plugins, and unlocatable payloads", async () => {
  const home = await buildCodexFixture();
  try {
    const report = await collectCodexCoverage(home);
    assert.equal(report.config.location, "parsed");
    assert.equal(report.config.servers.length, 2);

    const browser = report.plugins.find((p) => p.registration.name === "browser");
    assert.equal(browser?.inspected, true);
    assert.equal(browser?.location, "parsed");
    assert.equal(browser?.servers[0]?.name, "browser_tool");
    assert.equal(browser?.servers[0]?.routing, "unwrapped");

    const docs = report.plugins.find((p) => p.registration.name === "docs");
    assert.equal(docs?.inspected, false);
    assert.equal(docs?.servers.length, 0);

    const ghost = report.plugins.find((p) => p.registration.name === "ghost");
    assert.equal(ghost?.location, "absent");
    assert.ok((ghost?.candidatesTried.length ?? 0) > 0);

    assert.ok(report.inspectedLocations.includes(report.configPath));
    assert.ok(report.inspectedLocations.some((l) => l.endsWith("mcp.json")));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("renderCoverageReport names denominators, ends with the exact inventory line, and never prints a percentage", async () => {
  const home = await buildCodexFixture();
  try {
    const report = await collectCodexCoverage(home);
    const lines = renderCoverageReport(report);
    assert.equal(lines[lines.length - 1], "Observed inventory only; this is not proof of completeness.");
    const text = lines.join("\n");
    assert.match(text, /2 of 2 entries in .*config\.toml parsed/);
    assert.match(text, /no native Reelier wrap path/);
    assert.match(text, /disabled — payload not inspected/);
    assert.match(text, /payload not located/);
    assert.ok(!text.includes("%"), "an overall coverage percentage must never be printed");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
