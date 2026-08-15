import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { planBootstrapInstall } from "../src/bootstrap/install.js";
import { applyBootstrapInstall } from "../src/bootstrap/install.js";

test("named bootstrap plans an exact-version proxy without changing legacy wrapping", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-bootstrap-install-"));
  try {
    const config = path.join(root, ".mcp.json");
    await writeFile(config, JSON.stringify({ mcpServers: {
      local: { command: "npx", args: ["-y", "@example/server"] },
      legacy: { command: "npx", args: ["-y", "reelier", "mcp", "--wrap", "npx -y @legacy/server"] },
      remote: { type: "http", url: "https://example.test/mcp" },
    } }), "utf8");
    const plan = await planBootstrapInstall(config, "0.32.1");
    assert.equal(plan.changed, true);
    assert.deepEqual(JSON.parse(plan.after).mcpServers.local, {
      command: "npx", args: ["-y", "reelier@0.32.1", "mcp", "--wrap", "npx -y @example/server"],
    });
    assert.deepEqual(JSON.parse(plan.after).mcpServers.legacy, {
      command: "npx", args: ["-y", "reelier", "mcp", "--wrap", "npx -y @legacy/server"],
    });
    assert.equal(plan.entries.find((entry: { name: string; action: string }) => entry.name === "remote")?.action, "skip-unwrappable");
    assert.equal(await readFile(config, "utf8"), JSON.stringify({ mcpServers: {
      local: { command: "npx", args: ["-y", "@example/server"] }, legacy: { command: "npx", args: ["-y", "reelier", "mcp", "--wrap", "npx -y @legacy/server"] }, remote: { type: "http", url: "https://example.test/mcp" },
    } }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("named install applies only with explicit consent, backs up before replacement, and rolls back a partial failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-bootstrap-apply-"));
  try {
    const config = path.join(root, ".mcp.json");
    const original = JSON.stringify({ mcpServers: { local: { command: "npx", args: ["-y", "@example/server"] } } }, null, 2);
    await writeFile(config, original, "utf8");
    const plan = await planBootstrapInstall(config, "0.32.1");
    await assert.rejects(() => applyBootstrapInstall(plan, { consent: false }), /consent/i);
    assert.equal(await readFile(config, "utf8"), original);
    const result = await applyBootstrapInstall(plan, { consent: true });
    assert.ok(result.backupPath);
    assert.equal(await readFile(result.backupPath!, "utf8"), original);
    assert.deepEqual((await readdir(root)).filter(name => name.includes("backup")), [path.basename(result.backupPath!)]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
