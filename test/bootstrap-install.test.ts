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
    const plan = await planBootstrapInstall(config, "0.33.0-beta.0");
    assert.equal(plan.changed, true);
    assert.deepEqual(JSON.parse(plan.after).mcpServers.local, {
      command: "npx", args: ["-y", "reelier@0.33.0-beta.0", "mcp", "--wrap", "npx -y @example/server"],
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

test("exact-version pinning is scoped to the newly wrapped server map entry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-bootstrap-install-scope-"));
  try {
    const config = path.join(root, ".claude.json");
    const otherProject = path.join(root, "other-project");
    const legacy = { command: "npx", args: ["-y", "reelier", "mcp", "--wrap", "npx -y @legacy/server"] };
    await writeFile(config, JSON.stringify({
      mcpServers: { shared: legacy },
      projects: {
        [root]: { mcpServers: { shared: { command: "npx", args: ["-y", "@current/server"] } } },
        [otherProject]: { mcpServers: { shared: legacy } },
      },
    }), "utf8");

    const after = JSON.parse((await planBootstrapInstall(config, "0.33.0-beta.0", root)).after);
    assert.deepEqual(after.mcpServers.shared.args, ["-y", "reelier", "mcp", "--wrap", "npx -y @legacy/server"]);
    assert.deepEqual(after.projects[otherProject].mcpServers.shared.args, ["-y", "reelier", "mcp", "--wrap", "npx -y @legacy/server"]);
    assert.deepEqual(after.projects[root].mcpServers.shared.args, ["-y", "reelier@0.33.0-beta.0", "mcp", "--wrap", "npx -y @current/server"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("named install applies only with explicit consent, backs up before replacement, and rolls back a partial failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-bootstrap-apply-"));
  try {
    const config = path.join(root, ".mcp.json");
    const original = JSON.stringify({ mcpServers: { local: { command: "npx", args: ["-y", "@example/server"] } } }, null, 2);
    await writeFile(config, original, "utf8");
    const plan = await planBootstrapInstall(config, "0.33.0-beta.0");
    await assert.rejects(() => applyBootstrapInstall(plan, { consent: false }), /consent/i);
    assert.equal(await readFile(config, "utf8"), original);
    const result = await applyBootstrapInstall(plan, { consent: true });
    assert.ok(result.backupPath);
    assert.equal(await readFile(result.backupPath!, "utf8"), original);
    assert.deepEqual((await readdir(root)).filter(name => name.includes("backup")), [path.basename(result.backupPath!)]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
