import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

// Same real-subprocess pattern as compile-cli.test.ts — exercises cli.ts's
// actual cmdFromSession wiring (format sniffing, --agent override, the
// Cursor/Windsurf stub path), not just the underlying session.ts functions
// session-formats.test.ts already covers directly.
const CLI_PATH = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const FIXTURES_DIR = fileURLToPath(new URL("../../test/fixtures", import.meta.url));

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-from-session-cli-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("cli from-session: auto-detects Codex format from content and compiles a real skill", async () => {
  await withTmpDir(async (dir) => {
    const outPath = path.join(dir, "out.skill.md");
    const { stdout } = await execFileAsync("node", [
      CLI_PATH,
      "from-session",
      path.join(FIXTURES_DIR, "codex-rollout.jsonl"),
      "--out",
      outPath,
    ]);
    assert.match(stdout, /Format: Codex CLI/);
    assert.match(stdout, /1 replayable call/);
    const written = await readFile(outPath, "utf8");
    assert.match(written, /mcp__weather__get_forecast|weather/);
  });
});

test("cli from-session: --agent openclaw forces the OpenClaw parser even without content sniffing", async () => {
  await withTmpDir(async (dir) => {
    const outPath = path.join(dir, "out.skill.md");
    const { stdout } = await execFileAsync("node", [
      CLI_PATH,
      "from-session",
      path.join(FIXTURES_DIR, "openclaw-session.jsonl"),
      "--agent",
      "openclaw",
      "--out",
      outPath,
    ]);
    assert.match(stdout, /1 replayable call/);
    const written = await readFile(outPath, "utf8");
    assert.match(written, /github/);
  });
});

test("cli from-session: --agent cursor reports the honest SQLite stub finding instead of fabricating a parse", async () => {
  const result = await execFileAsync("node", [CLI_PATH, "from-session", "--agent", "cursor"]).catch((e) => e);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /Cursor: format not yet supported/);
  assert.match(result.stdout, /state\.vscdb/);
});

test("cli from-session: a bare .vscdb path is detected as a stub source from its extension alone", async () => {
  const result = await execFileAsync("node", [CLI_PATH, "from-session", "C:\\fake\\Windsurf\\state.vscdb"]).catch((e) => e);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /Windsurf: format not yet supported/);
});

test("cli from-session: unknown --agent value is a clean error, not a silent fallback", async () => {
  const result = await execFileAsync("node", [
    CLI_PATH,
    "from-session",
    path.join(FIXTURES_DIR, "codex-rollout.jsonl"),
    "--agent",
    "bogus-agent",
  ]).catch((e) => e);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Unknown --agent 'bogus-agent'/);
});
