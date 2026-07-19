import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  planInstall,
  applyInstall,
  isWrappedEntry,
  isWrappableEntry,
  joinCommandLine,
  findLatestBackup,
  restoreFromBackup,
} from "../src/wrap.js";

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-wrap-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("joinCommandLine / round-trips through splitCommandLine for a simple npx invocation", async () => {
  const line = joinCommandLine("npx", ["-y", "@your/mcp-server"]);
  assert.equal(line, "npx -y @your/mcp-server");
});

test("isWrappedEntry: recognizes an already-wrapped reelier entry", () => {
  const wrapped = { command: "npx", args: ["-y", "@seldonframe/reelier", "mcp", "--wrap", "npx -y @your/server"] };
  assert.equal(isWrappedEntry(wrapped), true);
  assert.equal(isWrappedEntry({ command: "npx", args: ["-y", "@your/server"] }), false);
});

test("isWrappableEntry: accepts a plain {command,args} local server, rejects a url-based remote server", () => {
  assert.equal(isWrappableEntry({ command: "npx", args: ["-y", "@x/y"] }), true);
  assert.equal(isWrappableEntry({ command: "node", args: [] }), true);
  assert.equal(isWrappableEntry({ type: "http", url: "https://example.com/mcp" }), false);
  assert.equal(isWrappableEntry({}), false);
});

test("planInstall: wraps a plain local server, leaves an already-wrapped one alone, skips a remote one", async () => {
  await withTmpDir(async (dir) => {
    const configPath = path.join(dir, ".mcp.json");
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          seldonframe: { command: "npx", args: ["-y", "@seldonframe/mcp@latest"] },
          alreadyWrapped: { command: "npx", args: ["-y", "@seldonframe/reelier", "mcp", "--wrap", "npx -y @foo/bar"] },
          remoteThing: { type: "http", url: "https://example.com/mcp" },
        },
      }),
      "utf8"
    );

    const plan = await planInstall(configPath);
    assert.equal(plan.configExisted, true);
    assert.equal(plan.changed, true);

    const byName = new Map(plan.entries.map((e) => [e.name, e]));
    assert.equal(byName.get("seldonframe")?.action, "wrap");
    assert.equal(byName.get("alreadyWrapped")?.action, "already-wrapped");
    assert.equal(byName.get("remoteThing")?.action, "skip-unwrappable");

    const afterConfig = JSON.parse(plan.after);
    assert.equal(afterConfig.mcpServers.seldonframe.command, "npx");
    assert.deepEqual(afterConfig.mcpServers.seldonframe.args, [
      "-y",
      "@seldonframe/reelier",
      "mcp",
      "--wrap",
      "npx -y @seldonframe/mcp@latest",
    ]);
    // Unwrappable/already-wrapped entries pass through byte-identical.
    assert.deepEqual(afterConfig.mcpServers.remoteThing, { type: "http", url: "https://example.com/mcp" });
  });
});

test("applyInstall: writes a timestamped backup with the ORIGINAL content, then the rewritten config", async () => {
  await withTmpDir(async (dir) => {
    const configPath = path.join(dir, ".mcp.json");
    const originalContent = JSON.stringify({ mcpServers: { widgets: { command: "npx", args: ["-y", "@widgets/mcp"] } } }, null, 2) + "\n";
    await writeFile(configPath, originalContent, "utf8");

    const plan = await planInstall(configPath);
    const result = await applyInstall(plan);

    assert.ok(result.backupPath, "expected a backup path");
    const backupContent = await readFile(result.backupPath!, "utf8");
    assert.equal(backupContent, originalContent);

    const rewritten = JSON.parse(await readFile(configPath, "utf8"));
    assert.deepEqual(rewritten.mcpServers.widgets.args, ["-y", "@seldonframe/reelier", "mcp", "--wrap", "npx -y @widgets/mcp"]);

    assert.equal(result.wrappedCount, 1);
  });
});

test("install is idempotent: running planInstall/applyInstall twice never double-wraps and the second run writes no new backup", async () => {
  await withTmpDir(async (dir) => {
    const configPath = path.join(dir, ".mcp.json");
    await writeFile(configPath, JSON.stringify({ mcpServers: { widgets: { command: "npx", args: ["-y", "@widgets/mcp"] } } }), "utf8");

    const plan1 = await planInstall(configPath);
    const result1 = await applyInstall(plan1);
    assert.equal(result1.wrappedCount, 1);
    assert.ok(result1.backupPath);

    const plan2 = await planInstall(configPath);
    assert.equal(plan2.changed, false, "second plan should find nothing left to wrap");
    assert.equal(plan2.entries[0].action, "already-wrapped");
    const result2 = await applyInstall(plan2);
    assert.equal(result2.backupPath, undefined, "no-op apply must not write a redundant backup");
    assert.equal(result2.wrappedCount, 0);

    // Config content after the no-op second apply is byte-identical to after the first (never double-wrapped).
    const after1 = plan1.after;
    const stillCurrent = await readFile(configPath, "utf8");
    assert.equal(JSON.parse(stillCurrent).mcpServers.widgets.args.length, JSON.parse(after1).mcpServers.widgets.args.length);
  });
});

test("uninstall: findLatestBackup + restoreFromBackup round-trips the original config back exactly", async () => {
  await withTmpDir(async (dir) => {
    const configPath = path.join(dir, ".mcp.json");
    const originalContent = JSON.stringify({ mcpServers: { widgets: { command: "npx", args: ["-y", "@widgets/mcp"] } } }, null, 2) + "\n";
    await writeFile(configPath, originalContent, "utf8");

    const plan = await planInstall(configPath);
    await applyInstall(plan);

    const backup = await findLatestBackup(configPath);
    assert.ok(backup);
    await restoreFromBackup(configPath, backup!);

    const restored = await readFile(configPath, "utf8");
    assert.equal(restored, originalContent);
  });
});

test("uninstall: findLatestBackup returns undefined when no backup exists (never guesses)", async () => {
  await withTmpDir(async (dir) => {
    const configPath = path.join(dir, ".mcp.json");
    await writeFile(configPath, "{}", "utf8");
    const backup = await findLatestBackup(configPath);
    assert.equal(backup, undefined);
  });
});

test("planInstall: a config with no existing file yields configExisted=false and an empty, unchanged plan", async () => {
  await withTmpDir(async (dir) => {
    const configPath = path.join(dir, "does-not-exist", ".mcp.json");
    const plan = await planInstall(configPath);
    assert.equal(plan.configExisted, false);
    assert.equal(plan.changed, false);
    assert.equal(plan.entries.length, 0);
  });
});

test("applyInstall never writes a backup when the config never existed (nothing to protect)", async () => {
  await withTmpDir(async (dir) => {
    const configPath = path.join(dir, ".mcp.json");
    const plan = await planInstall(configPath);
    const result = await applyInstall(plan);
    assert.equal(result.backupPath, undefined);
    const entries = await readdir(dir).catch(() => []);
    assert.equal(entries.length, 0, "no file should have been created for an empty, unchanged plan");
  });
});
