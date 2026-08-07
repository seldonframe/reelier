import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { knownMcpConfigPaths, detectAgentConfig } from "../src/init.js";
import {
  planInstall,
  applyInstall,
  planUninstall,
  applyUninstall,
  agentGuardMessage,
  type UninstallPlanEntry,
} from "../src/wrap.js";
import { describeUnrestorable } from "../src/cli.js";

/**
 * `reelier install` wraps every host config in `knownMcpConfigPaths` — Claude Code project/user,
 * Cursor project/user, Windsurf user. `reelier uninstall` resolved exactly ONE path through
 * `detectAgentConfig`, which only knows `<cwd>/.mcp.json` and `~/.claude.json`. A Cursor or
 * Windsurf user who ran install then uninstall stayed wrapped, with no CLI route back and no
 * message saying so — the install had a reverse gear that silently disengaged.
 *
 * Everything here runs against fixture directories. Nothing reads the real machine's config.
 */

async function fixture(): Promise<{ cwd: string; home: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-uninstall-"));
  const cwd = path.join(root, "project");
  const home = path.join(root, "home");
  await mkdir(cwd, { recursive: true });
  await mkdir(home, { recursive: true });
  return { cwd, home, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const SERVER =
  JSON.stringify({ mcpServers: { stripe: { command: "npx", args: ["-y", "@stripe/mcp"] } } }, null, 2) + "\n";

const WRAPPED =
  JSON.stringify(
    { mcpServers: { stripe: { command: "npx", args: ["-y", "reelier", "mcp", "--wrap", "npx -y @stripe/mcp"] } } },
    null,
    2,
  ) + "\n";

/** Write `content` to `p`, creating parents. Returns `p`. */
async function seed(p: string, content: string): Promise<string> {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, content, "utf8");
  return p;
}

test("uninstall reverts a Cursor-only install — the host set install wraps, not Claude Code's two paths", async () => {
  const { cwd, home, cleanup } = await fixture();
  try {
    const cursor = await seed(path.join(home, ".cursor", "mcp.json"), SERVER);
    await applyInstall(await planInstall(cursor));
    assert.match(await readFile(cursor, "utf8"), /--wrap/, "guard: install must have wrapped the fixture");

    // The old resolver could not even name this file — that is the whole bug.
    const detection = await detectAgentConfig(cwd, home);
    assert.ok(
      detection.projectConfigPath !== cursor && detection.userConfigPath !== cursor,
      "guard: detectAgentConfig must not reach a Cursor config, or this test proves nothing",
    );

    const plan = await planUninstall(knownMcpConfigPaths(cwd, home));
    assert.equal(plan.restorable, 1);
    const entry = plan.entries.find((e) => e.configPath === cursor);
    assert.ok(entry, "the Cursor config must appear in the uninstall plan");
    assert.equal(entry!.label, "Cursor (user)");
    assert.equal(entry!.action, "restore");
    assert.equal(entry!.wrapState, "wrapped");

    const results = await applyUninstall(plan);
    assert.equal(results.find((r) => r.configPath === cursor)?.outcome, "restored");
    assert.equal(await readFile(cursor, "utf8"), SERVER, "the original must come back byte-for-byte");
  } finally {
    await cleanup();
  }
});

test("uninstall restores every wrapped host in one pass, in knownMcpConfigPaths order", async () => {
  const { cwd, home, cleanup } = await fixture();
  try {
    const claude = await seed(path.join(cwd, ".mcp.json"), SERVER);
    const windsurf = await seed(path.join(home, ".codeium", "windsurf", "mcp_config.json"), SERVER);
    for (const p of [claude, windsurf]) await applyInstall(await planInstall(p));

    const plan = await planUninstall(knownMcpConfigPaths(cwd, home));
    assert.equal(plan.restorable, 2);
    assert.deepEqual(
      plan.entries.map((e) => e.label),
      ["Claude Code (project)", "Windsurf (user)"],
      "reported in declared host order, not filesystem order",
    );

    const results = await applyUninstall(plan);
    assert.deepEqual(
      results.map((r) => r.outcome),
      ["restored", "restored"],
    );
    assert.equal(await readFile(claude, "utf8"), SERVER);
    assert.equal(await readFile(windsurf, "utf8"), SERVER);
  } finally {
    await cleanup();
  }
});

test("a wrapped config with no backup is reported as still wrapped — never a silent skip", async () => {
  const { cwd, home, cleanup } = await fixture();
  try {
    // Wrapped by hand (or by an install whose backup was deleted): there is nothing to restore from.
    const cfg = await seed(path.join(home, ".cursor", "mcp.json"), WRAPPED);

    const plan = await planUninstall(knownMcpConfigPaths(cwd, home));
    assert.equal(plan.restorable, 0);
    const entry = plan.entries.find((e) => e.configPath === cfg);
    assert.ok(entry, "a wrapped config must be listed even when it cannot be restored");
    assert.equal(entry!.action, "no-backup");
    assert.equal(entry!.wrapState, "wrapped");
    assert.deepEqual(entry!.wrappedServerNames, ["stripe"]);

    const results = await applyUninstall(plan);
    assert.equal(results[0].outcome, "no-backup");
    assert.equal(await readFile(cfg, "utf8"), WRAPPED, "nothing restorable means nothing written");
  } finally {
    await cleanup();
  }
});

test("an unparseable config reports wrapState 'unknown', never 'unwrapped'", async () => {
  const { cwd, home, cleanup } = await fixture();
  try {
    const cfg = await seed(path.join(cwd, ".mcp.json"), "{ not json,,,");
    const plan = await planUninstall(knownMcpConfigPaths(cwd, home));
    const entry = plan.entries.find((e) => e.configPath === cfg);
    assert.ok(entry);
    // "unwrapped" here would read as "nothing left to revert" — a guess rendered as a pass.
    assert.equal(entry!.wrapState, "unknown");
    assert.ok(entry!.wrapStateReason, "an unknown wrap state must carry the reason it is unknown");
  } finally {
    await cleanup();
  }
});

test("a backup whose config is gone is reported, not silently resurrected", async () => {
  const { cwd, home, cleanup } = await fixture();
  try {
    const cfg = await seed(path.join(cwd, ".mcp.json"), SERVER);
    await applyInstall(await planInstall(cfg));
    await rm(cfg);

    const plan = await planUninstall(knownMcpConfigPaths(cwd, home));
    const entry = plan.entries.find((e) => e.configPath === cfg);
    assert.ok(entry, "an orphan backup must still be reported — install wrote it");
    assert.equal(entry!.action, "orphan-backup");
    assert.equal(entry!.wrapState, "unknown");
    assert.equal(plan.restorable, 0, "an orphan backup is not restorable — recreating a deleted config is a surprise write");

    await applyUninstall(plan);
    const stillGone = await readFile(cfg, "utf8").then(
      () => false,
      () => true,
    );
    assert.ok(stillGone, "uninstall must not recreate a config the user deleted");
  } finally {
    await cleanup();
  }
});

test("nothing installed anywhere yields an empty plan — the caller's honest error, not a fabricated success", async () => {
  const { cwd, home, cleanup } = await fixture();
  try {
    const plan = await planUninstall(knownMcpConfigPaths(cwd, home));
    assert.deepEqual(plan.entries, []);
    assert.equal(plan.restorable, 0);
    assert.equal(plan.checkedPaths.length, 5, "every known host path must be named in the error the caller prints");
  } finally {
    await cleanup();
  }
});

test("one failed restore does not abort the others, and is reported as failed rather than skipped", async () => {
  const { cwd, home, cleanup } = await fixture();
  try {
    const good = await seed(path.join(cwd, ".mcp.json"), SERVER);
    await applyInstall(await planInstall(good));

    // A DIRECTORY at the backup path: findLatestBackup sees it, readFile cannot read it (EISDIR).
    const bad = await seed(path.join(home, ".cursor", "mcp.json"), WRAPPED);
    await mkdir(`${bad}.backup-2026-01-01T00-00-00-000Z`, { recursive: true });

    const plan = await planUninstall(knownMcpConfigPaths(cwd, home));
    assert.equal(plan.restorable, 2);

    const results = await applyUninstall(plan);
    const byPath = new Map(results.map((r) => [r.configPath, r]));
    assert.equal(byPath.get(good)?.outcome, "restored", "an earlier failure must not strand a later config");
    assert.equal(byPath.get(bad)?.outcome, "restore-failed");
    assert.ok(byPath.get(bad)?.error, "a failed restore must carry the reason");
    assert.equal(await readFile(good, "utf8"), SERVER);
    assert.equal(await readFile(bad, "utf8"), WRAPPED, "a failed restore leaves the config exactly as it was");
  } finally {
    await cleanup();
  }
});

test("uninstall leaves backup files on disk — restoring is not consuming", async () => {
  const { cwd, home, cleanup } = await fixture();
  try {
    const cfg = await seed(path.join(cwd, ".mcp.json"), SERVER);
    await applyInstall(await planInstall(cfg));
    await applyUninstall(await planUninstall(knownMcpConfigPaths(cwd, home)));

    const left = (await readdir(cwd)).filter((f) => f.includes(".backup-"));
    assert.equal(left.length, 1, "the backup stays put so a re-install decision is still reversible");
  } finally {
    await cleanup();
  }
});

test("an unrestorable config never renders as a pass — 'unknown' says unknown", () => {
  const entry = (over: Partial<UninstallPlanEntry>): UninstallPlanEntry => ({
    label: "Cursor (user)",
    configPath: "/home/.cursor/mcp.json",
    action: "no-backup",
    wrapState: "unwrapped",
    wrappedServerNames: [],
    ...over,
  });

  const wrapped = describeUnrestorable(entry({ wrapState: "wrapped", wrappedServerNames: ["stripe", "linear"] }));
  assert.match(wrapped, /STILL WRAPPED/);
  assert.match(wrapped, /stripe, linear/, "naming the servers is what makes the manual undo actionable");

  const unknown = describeUnrestorable(entry({ wrapState: "unknown", wrapStateReason: "Unexpected token }" }));
  assert.match(unknown, /could not read/);
  assert.match(unknown, /Unexpected token \}/, "the reason it is unknown must travel with the claim");
  assert.ok(
    !/nothing to revert/.test(unknown),
    "an unreadable config must never be described as clean — that is 'unknown' rendered as a pass",
  );

  const clean = describeUnrestorable(entry({}));
  assert.match(clean, /nothing to revert/, "only a config reelier actually read and found unwrapped may say this");
});

test("the --agent guard names the offending value and the command that rejected it", () => {
  const msg = agentGuardMessage("uninstall", "codex");
  assert.match(msg, /'codex'/, "an error that cannot name the bad value cannot be acted on");
  assert.match(msg, /uninstall/, "uninstall must not tell the user what install does");
  assert.match(msg, /Cursor/);
  assert.match(msg, /--config <path>/);
  assert.match(agentGuardMessage("install", "codex"), /install now wraps/);
});
