import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { knownMcpConfigPaths, detectMcpConfigs } from "../src/init.js";
import { diffLines } from "../src/cli.js";
import { planInstall } from "../src/wrap.js";

/**
 * `reelier install` used to look in exactly two places, both Claude Code's (`.mcp.json` and
 * `~/.claude.json`). Every other MCP host — Cursor, Windsurf — stores servers under the same
 * top-level `mcpServers` object, so the planner already worked on them; nothing knew to look.
 *
 * That gap is the whole distribution story for agent-framework users: a LangGraph or CrewAI setup
 * that speaks MCP is reachable through whichever host config it lives in, with no framework
 * adapter, because the wrap happens at the transport. Detection was the only missing piece.
 */

async function fixture(): Promise<{ cwd: string; home: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-hosts-"));
  const cwd = path.join(root, "project");
  const home = path.join(root, "home");
  await mkdir(cwd, { recursive: true });
  await mkdir(home, { recursive: true });
  return { cwd, home };
}

const SERVER = JSON.stringify(
  { mcpServers: { stripe: { command: "npx", args: ["-y", "@stripe/mcp", "--tools=all"] } } },
  null,
  2,
);

test("knownMcpConfigPaths covers every host we claim to support, and nothing else", () => {
  const paths = knownMcpConfigPaths("/proj", "/home");
  assert.deepEqual(
    paths.map((p) => p.label),
    ["Claude Code (project)", "Claude Code (user)", "Cursor (project)", "Cursor (user)", "Windsurf (user)"],
  );
  // Every entry must be built from the GIVEN cwd/home, never the real machine's. Compared on
  // segments rather than a prefix string: path.join uses backslashes on Windows, so a
  // startsWith("/proj") check passes on POSIX and fails on Windows for correct output.
  for (const p of paths) {
    const segments = p.path.split(/[\\/]/);
    assert.ok(
      segments.includes("proj") || segments.includes("home"),
      `${p.label} -> ${p.path} is not rooted in the supplied cwd/home`,
    );
  }
});

test("Codex and VS Code are deliberately absent", () => {
  const joined = knownMcpConfigPaths("/proj", "/home")
    .map((p) => p.path)
    .join(" ");
  // Codex is TOML; VS Code nests under `servers`, not `mcpServers`. Listing either would make
  // install report "nothing to wrap" against a file that visibly has servers in it.
  assert.ok(!joined.includes("config.toml"), "Codex config.toml must not be listed — planInstall parses JSON");
  assert.ok(!joined.includes(".vscode"), "VS Code must not be listed — it uses `servers`, not `mcpServers`");
});

test("detectMcpConfigs returns only what exists, in declared order", async () => {
  const { cwd, home } = await fixture();
  assert.deepEqual(await detectMcpConfigs(cwd, home), [], "nothing on disk -> nothing detected");

  await mkdir(path.join(home, ".cursor"), { recursive: true });
  await writeFile(path.join(home, ".cursor", "mcp.json"), SERVER, "utf8");
  await writeFile(path.join(cwd, ".mcp.json"), SERVER, "utf8");

  const found = await detectMcpConfigs(cwd, home);
  assert.deepEqual(
    found.map((f) => f.label),
    ["Claude Code (project)", "Cursor (user)"],
    "order follows knownMcpConfigPaths, not filesystem order",
  );
});

test("a Cursor config plans the same wrap a Claude Code one does", async () => {
  const { cwd, home } = await fixture();
  await mkdir(path.join(cwd, ".cursor"), { recursive: true });
  const cursorConfig = path.join(cwd, ".cursor", "mcp.json");
  await writeFile(cursorConfig, SERVER, "utf8");

  const plan = await planInstall(cursorConfig);
  assert.equal(plan.changed, true, "a plain Cursor config must be wrappable");
  assert.deepEqual(plan.entries, [{ name: "stripe", action: "wrap" }]);
  assert.match(plan.after, /reelier/, "the rewritten config routes through the proxy");
  assert.ok(!plan.before.includes("reelier"), "guard: the fixture must start unwrapped");
});

test("wrapping is idempotent — a second pass is a no-op, not a double wrap", async () => {
  const { cwd } = await fixture();
  const cfg = path.join(cwd, ".mcp.json");
  await writeFile(cfg, SERVER, "utf8");

  const first = await planInstall(cfg);
  await writeFile(cfg, first.after, "utf8");

  const second = await planInstall(cfg);
  assert.equal(second.changed, false, "already-wrapped servers must not be wrapped again");
  assert.deepEqual(second.entries, [{ name: "stripe", action: "already-wrapped" }]);
});

test("diffLines shows only what changed, not the whole file", () => {
  const before = '{\n  "mcpServers": {\n    "stripe": {\n      "command": "npx"\n    }\n  }\n}';
  const after = '{\n  "mcpServers": {\n    "stripe": {\n      "command": "reelier"\n    }\n  }\n}';
  const d = diffLines(before, after);

  assert.ok(
    d.some((l) => l.startsWith("  -") && l.includes("npx")),
    "the removed line must be shown",
  );
  assert.ok(
    d.some((l) => l.startsWith("  +") && l.includes("reelier")),
    "the added line must be shown",
  );
  assert.ok(
    !d.some((l) => l.includes("mcpServers")),
    "unchanged lines must NOT be printed — burying a two-line change in a hundred unchanged ones " +
      "is what made the old whole-file dry-run useless",
  );
});

test("diffLines is honest when nothing textual changed", () => {
  assert.deepEqual(diffLines("same", "same"), ["  (no textual change)"]);
});
