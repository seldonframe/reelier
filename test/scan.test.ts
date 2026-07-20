import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findTranscriptFiles, scanTranscripts, scanAgentSessions, agentSources } from "../src/scan.js";

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-scan-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function assistantLine(id: string, name: string, input: unknown): string {
  return JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
}

function userResultLine(toolUseId: string, content: unknown): string {
  return JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content }] } });
}

test("scanAgentSessions: scans every known source, tags each session, and skips missing dirs gracefully", async () => {
  await withTmpDir(async (home) => {
    // A Claude Code transcript with one replayable http tool call.
    const projDir = path.join(home, ".claude", "projects", "my-proj");
    await mkdir(projDir, { recursive: true });
    const replayable =
      assistantLine("t1", "mcp__x__q", { url: "https://e.com" }) +
      "\n" +
      userResultLine("t1", "ok") +
      "\n";
    await writeFile(path.join(projDir, "s.jsonl"), replayable, "utf8");
    // .codex/.codeium/.openclaw do NOT exist under this temp home.

    const sessions = await scanAgentSessions(home);
    // Missing sources contribute nothing and never throw.
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].sourceId, "claude-code");
    assert.equal(sessions[0].sourceLabel, "Claude Code");
    // Registry lists more than one source (extensible), all homedir-relative.
    const ids = agentSources(home).map((s) => s.id);
    assert.ok(ids.includes("claude-code") && ids.length >= 2);
  });
});

test("findTranscriptFiles: finds *.jsonl nested two levels down (project/uuid.jsonl), ignores other files", async () => {
  await withTmpDir(async (dir) => {
    await mkdir(path.join(dir, "project-a"), { recursive: true });
    await mkdir(path.join(dir, "project-b"), { recursive: true });
    await writeFile(path.join(dir, "project-a", "session1.jsonl"), "{}", "utf8");
    await writeFile(path.join(dir, "project-b", "session2.jsonl"), "{}", "utf8");
    await writeFile(path.join(dir, "project-b", "notes.txt"), "hi", "utf8");

    const files = await findTranscriptFiles(dir);
    assert.equal(files.length, 2);
    assert.ok(files.some((f) => f.endsWith("session1.jsonl")));
    assert.ok(files.some((f) => f.endsWith("session2.jsonl")));
  });
});

test("findTranscriptFiles: a missing root directory yields an empty list, never throws", async () => {
  const files = await findTranscriptFiles("/definitely/does/not/exist/anywhere");
  assert.deepEqual(files, []);
});

test("scanTranscripts: summarizes replayable vs skipped across multiple sessions, sorted newest first", async () => {
  await withTmpDir(async (dir) => {
    const projectDir = path.join(dir, "my-project");
    await mkdir(projectDir, { recursive: true });

    const replayableSession = [
      assistantLine("t1", "mcp__widgets__list", {}),
      userResultLine("t1", JSON.stringify({ items: [] })),
    ].join("\n");
    const nonReplayableSession = [assistantLine("t1", "Bash", { command: "ls" }), userResultLine("t1", "a b c")].join("\n");

    await writeFile(path.join(projectDir, "session-replayable.jsonl"), replayableSession, "utf8");
    await writeFile(path.join(projectDir, "session-none.jsonl"), nonReplayableSession, "utf8");

    const results = await scanTranscripts(dir);
    assert.equal(results.length, 2);

    const replayable = results.find((r) => r.path.endsWith("session-replayable.jsonl"));
    const none = results.find((r) => r.path.endsWith("session-none.jsonl"));
    assert.equal(replayable?.replayableCount, 1);
    assert.deepEqual(replayable?.servers, ["widgets"]);
    assert.equal(none?.replayableCount, 0);
    assert.equal(none?.skippedCount, 1);
    assert.equal(replayable?.project, "my-project");
  });
});
