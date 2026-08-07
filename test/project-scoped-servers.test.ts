import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { planInstall, applyInstall } from "../src/wrap.js";
import { sameProjectDirectory } from "../src/project-scope.js";
import { analyzeClaudeConfig, collectClaudeCoverage, renderClaudeCoverageReport, projectScopedOrigin } from "../src/coverage.js";
import { cmdCoverage } from "../src/cli.js";

/**
 * Claude Code stores MCP servers in TWO places inside `~/.claude.json`: the top-level
 * `mcpServers` object every host shares, and a per-project map at
 * `projects["<abs path>"].mcpServers`. `planInstall` only ever read the first, so on a real
 * machine (measured 2026-08-06: 2 top-level servers, 83 project keys, 5 of them carrying their
 * own servers) install rewrote the file, reported success, and left 5 servers unwrapped inside
 * the file it had just edited.
 *
 * Fixtures only — nothing here reads the developer's real ~/.claude.json.
 */

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
// coverage — reports ALL project-scoped entries, regardless of cwd
// ---------------------------------------------------------------------------

test("projectScopedOrigin names the file AND the project key so a reader can tell it from a top-level entry", () => {
  assert.equal(projectScopedOrigin("/home/dev/.claude.json", "/work/a"), "/home/dev/.claude.json#projects//work/a");
});

test("analyzeClaudeConfig reports project-scoped entries for EVERY project key, cwd or not", () => {
  const cwd = "/work/here";
  const raw = claudeJson(cwd, "/work/there");
  const analysis = analyzeClaudeConfig(raw, "/home/dev/.claude.json", cwd);

  assert.equal(analysis.location, "parsed");
  assert.deepEqual(
    analysis.servers.map((s) => s.name),
    ["toplevel"],
    "the top-level list must contain top-level entries only",
  );
  assert.deepEqual(
    analysis.projects.map((p) => [p.projectPath, p.isCwd, p.servers.map((s) => s.name)]),
    [
      [cwd, true, ["here"]],
      ["/work/there", false, ["elsewhere"]],
    ],
  );
  assert.equal(analysis.projects[1].servers[0].origin, "/home/dev/.claude.json#projects//work/there");
  assert.equal(analysis.projectKeyCount, 3, "every key under `projects` counts, including the one with no servers");
});

test("analyzeClaudeConfig judges project-scoped routing by reading the entry, same as top-level", () => {
  const raw = JSON.stringify({
    projects: {
      "/work/a": {
        mcpServers: {
          on: { command: "npx", args: ["-y", "reelier", "mcp", "--wrap", "npx -y @x/y"] },
          off: { command: "npx", args: ["-y", "@x/y"] },
          remote: { type: "http", url: "https://example.com/mcp" },
          broken: { note: "neither command nor url" },
        },
      },
    },
  });
  const servers = analyzeClaudeConfig(raw, "/c.json", "/elsewhere").projects[0].servers;
  const by = new Map(servers.map((s) => [s.name, s]));
  assert.equal(by.get("on")?.routing, "wrapped");
  assert.equal(by.get("off")?.routing, "unwrapped");
  assert.equal(by.get("remote")?.transport, "url");
  assert.equal(by.get("broken")?.location, "unreadable");
  assert.equal(by.get("broken")?.routing, undefined, "an unreadable entry is never assigned a routing");
});

test("analyzeClaudeConfig reports an absent or unreadable file as such — never as an empty pass", () => {
  const absent = analyzeClaudeConfig(undefined, "/home/dev/.claude.json", "/work");
  assert.equal(absent.location, "absent");
  assert.deepEqual(absent.projects, []);

  const broken = analyzeClaudeConfig("{ not json,,,", "/home/dev/.claude.json", "/work");
  assert.equal(broken.location, "unreadable");
  assert.ok(broken.detail, "an unreadable config must say why");
});

test("renderClaudeCoverageReport gives project-scoped entries their OWN denominator", () => {
  const cwd = "/work/here";
  const report = {
    homedir: "/home/dev",
    cwd,
    configPath: "/home/dev/.claude.json",
    config: analyzeClaudeConfig(claudeJson(cwd, "/work/there"), "/home/dev/.claude.json", cwd),
    inspectedLocations: ["/home/dev/.claude.json"],
  };
  const text = renderClaudeCoverageReport(report).join("\n");

  assert.match(text, /1 of 1 top-level entr/, "the top-level denominator counts top-level entries only");
  assert.match(text, /2 of 2 project-scoped entr/, "project-scoped entries carry their own denominator");
  assert.match(text, /2 of 3 project key/, "project keys with no servers still count in their own denominator");
  assert.match(text, /#projects\/\/work\/there/, "every project origin is named in full");
  assert.match(text, /cwd/, "the entry install would actually rewrite must be marked");
  assert.equal(
    renderClaudeCoverageReport(report).at(-1),
    "Observed inventory only; this is not proof of completeness.",
  );
});

test("collectClaudeCoverage reads ~/.claude.json under the given home and writes nothing", async () => {
  await withTmpDir(async (dir) => {
    const home = path.join(dir, "home");
    const cwd = path.join(dir, "proj");
    await mkdir(home, { recursive: true });
    const configPath = path.join(home, ".claude.json");
    const original = claudeJson(cwd, path.join(dir, "other"));
    await writeFile(configPath, original, "utf8");

    const report = await collectClaudeCoverage(home, cwd);
    assert.equal(report.configPath, configPath);
    assert.deepEqual(report.inspectedLocations, [configPath]);
    assert.equal(report.config.projects.length, 2);
    assert.equal(await readFile(configPath, "utf8"), original, "coverage is read-only");
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

test("cmdCoverage --host claude reports the project-scoped entries the wrap would miss", async () => {
  await withTmpDir(async (dir) => {
    const home = path.join(dir, "home");
    const cwd = path.join(dir, "proj");
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, ".claude.json"), claudeJson(cwd, path.join(dir, "other")), "utf8");

    const captured = captureConsole();
    try {
      const exit = await cmdCoverage(parsedArgs({ host: "claude" }) as never, home, cwd);
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

test("cmdCoverage names every supported host when given none or a bad one", async () => {
  const captured = captureConsole();
  try {
    assert.equal(await cmdCoverage(parsedArgs() as never), 1);
    assert.equal(await cmdCoverage(parsedArgs({ host: "cursor" }) as never), 1);
    const text = captured.errors.join("\n");
    assert.match(text, /codex/);
    assert.match(text, /claude/);
  } finally {
    captured.restore();
  }
});
