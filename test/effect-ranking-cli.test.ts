import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

// Exercises `reelier from-session` and `reelier scan` as real subprocesses
// (same pattern as compile-cli.test.ts) so the assertions cover exactly what
// a user sees, against the freshly-compiled CLI.
const CLI_PATH = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function assistantLine(id: string, name: string, input: unknown): string {
  return JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
}

function userResultLine(toolUseId: string, content: unknown, isError = false): string {
  return JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content, is_error: isError }] },
  });
}

/** A real-shaped session mixing read (get_widget) and side-effectful (create_widget) MCP calls — the exact gap this feature closes (running `reelier run` on a from-session skill full of one-off create_/mark_ calls). */
function mixedEffectTranscript(): string {
  return [
    assistantLine("t1", "mcp__widgets__get_widget", { id: "w1" }),
    userResultLine("t1", JSON.stringify({ id: "w1", name: "gadget" })),
    assistantLine("t2", "mcp__widgets__create_widget", { name: "gadget" }),
    userResultLine("t2", JSON.stringify({ id: "w2", name: "gadget" })),
    assistantLine("t3", "mcp__widgets__list_widgets", {}),
    userResultLine("t3", JSON.stringify({ items: [] })),
  ].join("\n") + "\n";
}

function readOnlyTranscript(): string {
  return [
    assistantLine("t1", "mcp__widgets__get_widget", { id: "w1" }),
    userResultLine("t1", JSON.stringify({ id: "w1" })),
    assistantLine("t2", "mcp__widgets__list_widgets", {}),
    userResultLine("t2", JSON.stringify({ items: [] })),
  ].join("\n") + "\n";
}

test("cli from-session: warns on side-effectful steps (2 of 3: create_widget) without blocking compilation", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-fs-cli-"));
  try {
    const tracePath = path.join(dir, "mixed.jsonl");
    await writeFile(tracePath, mixedEffectTranscript(), "utf8");
    const outPath = path.join(dir, "out.skill.md");

    const result = await execFileAsync("node", [CLI_PATH, "from-session", tracePath, "--out", outPath]);
    assert.match(result.stdout, /Wrote /);
    assert.match(result.stdout, /⚠ 1 of 3 steps are side-effectful/);
    assert.match(result.stdout, /create_widget/);
    // The skill was still written — a warning never blocks compilation.
    const written = await import("node:fs/promises").then((fs) => fs.readFile(outPath, "utf8"));
    assert.match(written, /create_widget/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli from-session: an all-read-only session prints the positive one-liner, no warning", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-fs-cli-readonly-"));
  try {
    const tracePath = path.join(dir, "readonly.jsonl");
    await writeFile(tracePath, readOnlyTranscript(), "utf8");
    const outPath = path.join(dir, "out.skill.md");

    const result = await execFileAsync("node", [CLI_PATH, "from-session", tracePath, "--out", outPath]);
    assert.match(result.stdout, /✓ all 2 steps are read-only — safe to replay repeatedly/);
    assert.doesNotMatch(result.stdout, /side-effectful/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli scan: summary shows read-only vs side-effectful split, headline counts read-only sessions, and ranks the read-only session first", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-scan-cli-"));
  try {
    // A read-only session, recorded EARLIER (older mtime) than the mixed one —
    // if ranking were pure recency the mixed (side-effectful) session would
    // list first; the effect-based ranking must still put the read-only one on top.
    const olderDir = path.join(dir, "older-readonly-project");
    const newerDir = path.join(dir, "newer-mixed-project");
    await mkdir(olderDir, { recursive: true });
    await mkdir(newerDir, { recursive: true });

    const readonlyPath = path.join(olderDir, "session-a.jsonl");
    const mixedPath = path.join(newerDir, "session-b.jsonl");
    await writeFile(readonlyPath, readOnlyTranscript(), "utf8");
    // Ensure the mixed session's mtime is strictly newer.
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(mixedPath, mixedEffectTranscript(), "utf8");

    const result = await execFileAsync("node", [CLI_PATH, "scan", "--dir", dir, "--yes", "--out-dir", path.join(dir, "out")]);
    const stdout = result.stdout;

    assert.match(stdout, /Found 2 session\(s\) · 2 with replayable workflows · 1 are read-only \(ideal to replay\)\./);
    assert.match(stdout, /2 replayable \(2 read-only · 0 side-effectful\)/); // readonly session's split
    assert.match(stdout, /3 replayable \(2 read-only · 1 side-effectful\)/); // mixed session's split
    assert.match(stdout, /⚠ side-effectful/);

    // Ranking: the read-only session ("[1]") must appear before the mixed one
    // ("[2]") despite being the OLDER (lower-mtime) session.
    const readonlyIdx = stdout.indexOf("older-readonly-project");
    const mixedIdx = stdout.indexOf("newer-mixed-project");
    assert.ok(readonlyIdx >= 0 && mixedIdx >= 0, "both project names should appear in the picker output");
    assert.ok(readonlyIdx < mixedIdx, "read-only session should rank above the side-effectful session");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
