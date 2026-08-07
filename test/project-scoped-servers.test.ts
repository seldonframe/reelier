// Claude Code stores MCP servers in TWO places inside `~/.claude.json`: the top-level
// `mcpServers` object every host shares, and a per-project map at
// `projects["<abs path>"].mcpServers`. `planInstall` only ever read the first, so on a real
// machine (measured 2026-08-06: 2 top-level servers, 83 project keys, 5 of them carrying their
// own servers) install rewrote the file, reported success, and left 5 servers unwrapped inside
// the file it had just edited — which falsifies "one install covers every MCP server in the
// agent's config".
//
// Scope of the fix, and it is deliberate: install rewrites ONLY the project entry whose key is
// the directory it runs in. Every other project's entry is reported, never rewritten.
// `reelier coverage --host claude-code` reports all of them from anywhere.
//
// Fixtures only — nothing here reads the developer's real ~/.claude.json.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { planInstall, applyInstall, planUninstall, applyUninstall } from "../src/wrap.js";
import { sameProjectDirectory } from "../src/project-scope.js";
import { collectClaudeCodeCoverage, renderCoverageView, projectKeysWithServers } from "../src/coverage.js";
import { cmdCoverage } from "../src/cli.js";

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-projscope-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A ~/.claude.json shaped fixture: one top-level server, one server under `cwd`'s project key, one under another project's. */
function claudeJson(cwdKey: string, otherKey: string): string {
  return JSON.stringify(
    {
      numStartups: 7,
      mcpServers: { toplevel: { command: "npx", args: ["-y", "@top/mcp"] } },
      projects: {
        [cwdKey]: {
          allowedTools: [],
          mcpServers: { here: { command: "npx", args: ["-y", "@here/mcp"] } },
        },
        [otherKey]: {
          mcpServers: { elsewhere: { command: "node", args: ["other.js"] } },
        },
        [`${otherKey}-no-servers`]: { allowedTools: [] },
      },
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// install — cwd-scoped rewriting
// ---------------------------------------------------------------------------

test("planInstall wraps the project entry whose key matches cwd, alongside the top-level ones", async () => {
  await withTmpDir(async (dir) => {
    const cwd = path.join(dir, "proj");
    const other = path.join(dir, "other");
    const configPath = path.join(dir, ".claude.json");
    await mkdir(cwd, { recursive: true });
    await writeFile(configPath, claudeJson(cwd, other), "utf8");

    const plan = await planInstall(configPath, cwd);
    assert.equal(plan.changed, true);

    const byName = new Map(plan.entries.map((e) => [e.name, e]));
    assert.equal(byName.get("toplevel")?.action, "wrap");
    assert.equal(byName.get("toplevel")?.projectPath, undefined, "a top-level entry is never tagged with a project");
    assert.equal(byName.get("here")?.action, "wrap");
    assert.equal(byName.get("here")?.projectPath, cwd);

    const after = JSON.parse(plan.after);
    assert.deepEqual(after.projects[cwd].mcpServers.here.args, ["-y", "reelier", "mcp", "--wrap", "npx -y @here/mcp"]);
    assert.deepEqual(after.projects[cwd].allowedTools, [], "sibling keys inside the project entry survive verbatim");
    assert.equal(after.numStartups, 7, "unrelated top-level keys survive verbatim");
  });
});

test("planInstall reports a DIFFERENT project's servers and leaves them byte-identical", async () => {
  await withTmpDir(async (dir) => {
    const cwd = path.join(dir, "proj");
    const other = path.join(dir, "other");
    const configPath = path.join(dir, ".claude.json");
    await writeFile(configPath, claudeJson(cwd, other), "utf8");

    const plan = await planInstall(configPath, cwd);
    const elsewhere = plan.entries.find((e) => e.name === "elsewhere");
    assert.equal(elsewhere?.action, "skip-other-project");
    assert.equal(elsewhere?.projectPath, other);
    assert.match(elsewhere?.reason ?? "", /reported, not rewritten/i);

    const after = JSON.parse(plan.after);
    assert.deepEqual(
      after.projects[other].mcpServers.elsewhere,
      { command: "node", args: ["other.js"] },
      "another project's entry must pass through untouched",
    );
  });
});

test("planInstall leaves project keys that carry no servers alone and emits no entries for them", async () => {
  await withTmpDir(async (dir) => {
    const cwd = path.join(dir, "proj");
    const other = path.join(dir, "other");
    const configPath = path.join(dir, ".claude.json");
    await writeFile(configPath, claudeJson(cwd, other), "utf8");

    const plan = await planInstall(configPath, cwd);
    assert.equal(plan.entries.length, 3, "one top-level + one cwd-project + one other-project entry, nothing else");
    const after = JSON.parse(plan.after);
    assert.deepEqual(after.projects[`${other}-no-servers`], { allowedTools: [] });
  });
});

test("applyInstall on a ~/.claude.json writes the project-scoped wrap, and the backup holds the original", async () => {
  await withTmpDir(async (dir) => {
    const cwd = path.join(dir, "proj");
    const other = path.join(dir, "other");
    const configPath = path.join(dir, ".claude.json");
    const original = claudeJson(cwd, other);
    await writeFile(configPath, original, "utf8");

    const plan = await planInstall(configPath, cwd);
    const result = await applyInstall(plan);
    assert.equal(result.wrappedCount, 2, "top-level + cwd project");
    assert.equal(result.otherProjectCount, 1, "other projects get their own denominator, never merged into skipped");
    assert.equal(result.skippedCount, 0, "an entry for another project is not an unwrappable entry");
    assert.equal(await readFile(result.backupPath!, "utf8"), original);

    const written = JSON.parse(await readFile(configPath, "utf8"));
    assert.deepEqual(written.projects[cwd].mcpServers.here.args, ["-y", "reelier", "mcp", "--wrap", "npx -y @here/mcp"]);
    assert.deepEqual(written.projects[other].mcpServers.elsewhere, { command: "node", args: ["other.js"] });
  });
});

test("install stays idempotent for project-scoped entries — a second pass never double-wraps", async () => {
  await withTmpDir(async (dir) => {
    const cwd = path.join(dir, "proj");
    const configPath = path.join(dir, ".claude.json");
    await writeFile(configPath, claudeJson(cwd, path.join(dir, "other")), "utf8");

    await applyInstall(await planInstall(configPath, cwd));
    const second = await planInstall(configPath, cwd);
    assert.equal(second.changed, false);
    assert.equal(second.entries.find((e) => e.name === "here")?.action, "already-wrapped");
  });
});

test("planInstall never invents a top-level mcpServers key when only a project entry was wrapped", async () => {
  await withTmpDir(async (dir) => {
    const cwd = path.join(dir, "proj");
    const configPath = path.join(dir, ".claude.json");
    await writeFile(
      configPath,
      JSON.stringify({ projects: { [cwd]: { mcpServers: { here: { command: "node", args: ["h.js"] } } } } }),
      "utf8",
    );

    const plan = await planInstall(configPath, cwd);
    assert.equal(plan.changed, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(JSON.parse(plan.after), "mcpServers"),
      false,
      "install must not add config the operator never had",
    );
  });
});

// Observed on the dev machine 2026-08-06: Claude Code writes its `projects` keys with forward
// slashes ("C:/Users/maxim/CascadeProjects") while process.cwd() on the same machine yields
// backslashes. A raw string compare misses every one of them.
test("planInstall matches a project key written in the host's separator style, not ours", async () => {
  await withTmpDir(async (dir) => {
    const cwd = path.join(dir, "proj");
    const hostStyleKey = cwd.replace(/\\/g, "/");
    const configPath = path.join(dir, ".claude.json");
    await writeFile(
      configPath,
      JSON.stringify({ projects: { [hostStyleKey]: { mcpServers: { here: { command: "node", args: ["h.js"] } } } } }),
      "utf8",
    );

    const plan = await planInstall(configPath, cwd);
    assert.equal(plan.changed, true, "the operator's own project must be recognised through separator style");
    assert.equal(plan.entries[0].action, "wrap");
  });
});

test("a malformed projects map degrades to reporting nothing rather than crashing or guessing", async () => {
  await withTmpDir(async (dir) => {
    const cwd = path.join(dir, "proj");
    const configPath = path.join(dir, ".claude.json");
    await writeFile(
      configPath,
      JSON.stringify({ projects: { [cwd]: "not-an-object", [path.join(dir, "b")]: { mcpServers: [] } } }),
      "utf8",
    );

    const plan = await planInstall(configPath, cwd);
    assert.equal(plan.changed, false);
    assert.deepEqual(plan.entries, []);
    assert.deepEqual(JSON.parse(plan.after).projects[cwd], "not-an-object");
  });
});

test("planInstall on a config with no projects map behaves exactly as it did before", async () => {
  await withTmpDir(async (dir) => {
    const configPath = path.join(dir, ".mcp.json");
    await writeFile(configPath, JSON.stringify({ mcpServers: { a: { command: "node", args: ["a.js"] } } }), "utf8");

    const plan = await planInstall(configPath, path.join(dir, "anywhere"));
    assert.equal(plan.changed, true);
    assert.deepEqual(plan.entries, [{ name: "a", action: "wrap" }]);
    assert.equal(
      Object.prototype.hasOwnProperty.call(JSON.parse(plan.after), "projects"),
      false,
      "install must not add a projects key to a config that never had one",
    );
  });
});

// ---------------------------------------------------------------------------
// Path matching — the JSON keys are absolute paths written by the HOST
// ---------------------------------------------------------------------------

test("sameProjectDirectory ignores a trailing separator on every platform", () => {
  const base = path.join(tmpdir(), "a", "b");
  assert.equal(sameProjectDirectory(`${base}${path.sep}`, base), true);
  assert.equal(sameProjectDirectory(base, `${base}${path.sep}`), true);
  assert.equal(sameProjectDirectory(path.join(base, "c"), base), false);
});

test("sameProjectDirectory normalizes separator style and case on Windows only", () => {
  const win = process.platform === "win32";
  // Separator style: `/` and `\` are the same separator on Windows. On POSIX a backslash is a
  // legal filename character, so folding it there would invent a match that isn't one.
  assert.equal(sameProjectDirectory("C:/Users/dev/proj", "C:\\Users\\dev\\proj"), win);
  assert.equal(sameProjectDirectory("C:\\Users\\Dev\\Proj", "c:\\users\\dev\\proj"), win);
  // Case: the PLATFORM decides this, not the shape of the string — the config keys and the cwd
  // always come from the same machine, so a POSIX-looking pair folds on Windows too.
  assert.equal(sameProjectDirectory("/home/dev/Proj", "/home/dev/proj"), win);
  // Genuinely different directories never match on either platform.
  assert.equal(sameProjectDirectory("/home/dev/a", "/home/dev/b"), false);
});

// ---------------------------------------------------------------------------
// uninstall — the reverse gear must cover what install can now rewrite
// ---------------------------------------------------------------------------

test("uninstall restores a project-scoped wrap from the whole-file backup", async () => {
  await withTmpDir(async (dir) => {
    const cwd = path.join(dir, "proj");
    const home = path.join(dir, "home");
    await mkdir(home, { recursive: true });
    const configPath = path.join(home, ".claude.json");
    const original = claudeJson(cwd, path.join(dir, "other"));
    await writeFile(configPath, original, "utf8");

    await applyInstall(await planInstall(configPath, cwd));
    assert.match(await readFile(configPath, "utf8"), /--wrap/, "guard: install must have wrapped the fixture");

    const plan = await planUninstall([{ label: "Claude Code (user)", path: configPath }]);
    assert.equal(plan.restorable, 1);
    const results = await applyUninstall(plan);
    assert.equal(results[0].outcome, "restored");
    assert.equal(await readFile(configPath, "utf8"), original, "the project-scoped wrap must be reverted too");
  });
});

// The honesty half: with the backup deleted there is no CLI route back, and the message that says
// so reads `wrapState`. Reading only the top-level map would report "nothing to revert" about a
// file install had just wrapped inside `projects`.
test("uninstall reports a project-scoped wrap as STILL WRAPPED when the backup is gone", async () => {
  await withTmpDir(async (dir) => {
    const cwd = path.join(dir, "proj");
    const configPath = path.join(dir, ".claude.json");
    await writeFile(
      configPath,
      JSON.stringify({
        projects: {
          [cwd]: {
            mcpServers: { here: { command: "npx", args: ["-y", "reelier", "mcp", "--wrap", "node h.js"] } },
          },
        },
      }),
      "utf8",
    );

    const plan = await planUninstall([{ label: "Claude Code (user)", path: configPath }]);
    assert.equal(plan.entries.length, 1);
    assert.equal(plan.entries[0].action, "no-backup");
    assert.equal(plan.entries[0].wrapState, "wrapped", "a wrap inside `projects` is still a wrap");
    assert.deepEqual(plan.entries[0].wrappedServerNames, [`here (projects/${cwd})`]);
  });
});

// ---------------------------------------------------------------------------
// coverage — reports EVERY project-scoped entry, regardless of cwd
// ---------------------------------------------------------------------------

test("projectKeysWithServers enumerates only keys carrying a usable mcpServers map, and counts them all", () => {
  const raw = JSON.stringify({
    projects: {
      "/work/a": { mcpServers: { one: { command: "node" } } },
      "/work/b": { allowedTools: [] },
      "/work/c": { mcpServers: {} },
      "/work/d": "not-an-object",
      "/work/e": { mcpServers: [] },
    },
  });
  const found = projectKeysWithServers(raw);
  assert.deepEqual(found.keys, ["/work/a", "/work/e"], "an unreadable mcpServers must still be reported, never dropped");
  assert.equal(found.totalKeys, 5, "every key under `projects` counts in the denominator");
});

test("projectKeysWithServers reports nothing for an absent, unparseable, or projects-less config", () => {
  assert.deepEqual(projectKeysWithServers(undefined), { keys: [], totalKeys: 0 });
  assert.deepEqual(projectKeysWithServers("{ not json,,,"), { keys: [], totalKeys: 0 });
  assert.deepEqual(projectKeysWithServers(JSON.stringify({ mcpServers: {} })), { keys: [], totalKeys: 0 });
});

async function coverageFixture(dir: string): Promise<{ home: string; cwd: string; other: string; configPath: string }> {
  const home = path.join(dir, "home");
  const cwd = path.join(dir, "proj");
  const other = path.join(dir, "other");
  await mkdir(home, { recursive: true });
  await mkdir(cwd, { recursive: true });
  const configPath = path.join(home, ".claude.json");
  await writeFile(configPath, claudeJson(cwd, other), "utf8");
  return { home, cwd, other, configPath };
}

test("collectClaudeCodeCoverage gives EVERY project-scoped map its own source, cwd or not", async () => {
  await withTmpDir(async (dir) => {
    const fx = await coverageFixture(dir);
    const view = await collectClaudeCodeCoverage(fx.cwd, fx.home, {});

    const scoped = view.sources.filter((s) => s.path.includes("#projects/"));
    assert.deepEqual(
      scoped.map((s) => s.path),
      [`${fx.configPath}#projects/${fx.cwd}`, `${fx.configPath}#projects/${fx.other}`],
      "the origin names the file AND the project key, so a reader can tell it from a top-level entry",
    );
    assert.deepEqual(scoped.map((s) => s.servers.map((v) => v.name)), [["here"], ["elsewhere"]]);
    assert.equal(scoped[0].servers[0].origin, scoped[0].path);

    // Never merged into the top-level count.
    const top = view.sources.find((s) => s.path === fx.configPath);
    assert.deepEqual(top?.servers.map((s) => s.name), ["toplevel"]);
  });
});

test("collectClaudeCodeCoverage says which project-scoped source install rewrites and which it does not", async () => {
  await withTmpDir(async (dir) => {
    const fx = await coverageFixture(dir);
    const view = await collectClaudeCodeCoverage(fx.cwd, fx.home, {});
    const scoped = view.sources.filter((s) => s.path.includes("#projects/"));
    assert.match(scoped[0].detail ?? "", /install rewrites this entry/i);
    assert.match(scoped[1].detail ?? "", /does not rewrite/i);
    assert.match(scoped[1].detail ?? "", /re-run 'reelier install' from that directory/i);
  });
});

test("collectClaudeCodeCoverage judges project-scoped routing by reading the entry, same as top-level", async () => {
  await withTmpDir(async (dir) => {
    const home = path.join(dir, "home");
    await mkdir(home, { recursive: true });
    await writeFile(
      path.join(home, ".claude.json"),
      JSON.stringify({
        projects: {
          "/work/a": {
            mcpServers: {
              on: { command: "npx", args: ["-y", "reelier", "mcp", "--wrap", "npx -y @x/y"] },
              off: { command: "npx", args: ["-y", "@x/y"] },
              remote: { type: "http", url: "https://example.invalid/mcp" },
              broken: { note: "neither command nor url" },
            },
          },
        },
      }),
      "utf8",
    );

    const view = await collectClaudeCodeCoverage(path.join(dir, "elsewhere"), home, {});
    const scoped = view.sources.find((s) => s.path.includes("#projects/"));
    const by = new Map((scoped?.servers ?? []).map((s) => [s.name, s]));
    assert.equal(by.get("on")?.routing, "wrapped");
    assert.equal(by.get("off")?.routing, "unwrapped");
    assert.equal(by.get("remote")?.transport, "url");
    assert.equal(by.get("broken")?.location, "unreadable");
    assert.equal(by.get("broken")?.routing, undefined, "an unreadable entry is never assigned a routing");
  });
});

test("the rendered report gives project-scoped entries their own named denominator and no overall percentage", async () => {
  await withTmpDir(async (dir) => {
    const fx = await coverageFixture(dir);
    const lines = renderCoverageView(await collectClaudeCodeCoverage(fx.cwd, fx.home, {}));
    const text = lines.join("\n");

    assert.match(text, new RegExp(`Observed: 1 of 1 entries in ${escapeRe(fx.configPath)} parsed`), "top-level keeps its own denominator");
    assert.match(text, new RegExp(`Observed: 1 of 1 entries in ${escapeRe(`${fx.configPath}#projects/${fx.other}`)} parsed`));
    assert.match(text, /2 project-scoped server\(s\) across 2 of 3 `projects` key\(s\)/, "the project-scoped surface carries its own named denominator");
    assert.match(text, /never counted in the top-level total/);
    assert.doesNotMatch(text, /\d+%/, "the probe never computes a coverage percentage");
    assert.equal(lines.at(-1), "Observed inventory only; this is not proof of completeness.");
  });
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("a ~/.claude.json with no project-scoped servers says so instead of going silent", async () => {
  await withTmpDir(async (dir) => {
    const home = path.join(dir, "home");
    await mkdir(home, { recursive: true });
    await writeFile(
      path.join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { a: { command: "node" } }, projects: { "/work/a": { allowedTools: [] } } }),
      "utf8",
    );
    const text = renderCoverageView(await collectClaudeCodeCoverage(path.join(dir, "proj"), home, {})).join("\n");
    assert.match(text, /0 project-scoped server\(s\) across 0 of 1 `projects` key\(s\)/);
  });
});

// ---------------------------------------------------------------------------
// CLI wiring
// ---------------------------------------------------------------------------

function parsedArgs(opts: Record<string, string> = {}, flags: string[] = []) {
  return { positional: [], opts, flags: new Set(flags), vars: {}, wraps: [], fails: [] };
}

function captureConsole(): { lines: string[]; errors: string[]; restore: () => void } {
  const lines: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...parts: unknown[]) => void lines.push(parts.join(" "));
  console.error = (...parts: unknown[]) => void errors.push(parts.join(" "));
  return { lines, errors, restore: () => { console.log = origLog; console.error = origErr; } };
}

test("cmdCoverage --host claude-code reports the project-scoped servers install never rewrites", async () => {
  await withTmpDir(async (dir) => {
    const fx = await coverageFixture(dir);
    const captured = captureConsole();
    try {
      const exit = await cmdCoverage(parsedArgs({ host: "claude-code" }) as never, fx.home, fx.cwd);
      assert.equal(exit, 0);
      const text = captured.lines.join("\n");
      assert.match(text, /elsewhere/, "another project's server is reported regardless of cwd");
      assert.match(text, /#projects\//);
      assert.equal(captured.lines.at(-1), "Observed inventory only; this is not proof of completeness.");
    } finally {
      captured.restore();
    }
  });
});
