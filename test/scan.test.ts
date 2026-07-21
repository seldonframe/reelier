import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  findTranscriptFiles,
  scanTranscripts,
  scanAgentSessions,
  agentSources,
  replayableRateStats,
  formatReplayableRate,
  type ReplayableRateInput,
} from "../src/scan.js";

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

// ---------------------------------------------------------------------------
// The self-measuring KPI: replayableRateStats + formatReplayableRate.
// ---------------------------------------------------------------------------

/** Minimal ReplayableRateInput factory. */
function rateInput(overrides: Partial<ReplayableRateInput>): ReplayableRateInput {
  return {
    replayableCount: 0,
    readOnly: false,
    effects: { read: 0, "idempotent-write": 0, destructive: 0 },
    unknownCount: 0,
    unknownTools: [],
    ...overrides,
  };
}

test("replayableRateStats: read-only rate over replayable sessions only, with blocked-only-by-unknown counted and blockers ranked", () => {
  const sessions: ReplayableRateInput[] = [
    // Fully read-only (the numerator).
    rateInput({ replayableCount: 2, readOnly: true, effects: { read: 2, "idempotent-write": 0, destructive: 0 } }),
    // Blocked ONLY by unknown-verb tools: every non-read call is an unknown fallthrough.
    rateInput({
      replayableCount: 3,
      effects: { read: 1, "idempotent-write": 0, destructive: 2 },
      unknownCount: 2,
      unknownTools: ["frobnicate", "quuxify"],
    }),
    // Also blocked only by unknown — shares one blocker, so frobnicate ranks first.
    rateInput({
      replayableCount: 1,
      effects: { read: 0, "idempotent-write": 0, destructive: 1 },
      unknownCount: 1,
      unknownTools: ["frobnicate"],
    }),
    // Blocked by a KNOWN write (idempotent-write present) — NOT blocked-only-by-unknown.
    rateInput({ replayableCount: 2, effects: { read: 1, "idempotent-write": 1, destructive: 0 } }),
    // Blocked by a KNOWN destructive verb (unknownCount 0) — NOT blocked-only-by-unknown.
    rateInput({ replayableCount: 2, effects: { read: 1, "idempotent-write": 0, destructive: 1 } }),
    // Mixed known destructive + unknown — a verb addition alone can't convert it, so NOT counted.
    rateInput({
      replayableCount: 2,
      effects: { read: 0, "idempotent-write": 0, destructive: 2 },
      unknownCount: 1,
      unknownTools: ["frobnicate"],
    }),
    // Zero replayable calls — excluded from the denominator entirely.
    rateInput({ replayableCount: 0 }),
  ];

  const stats = replayableRateStats(sessions);
  assert.equal(stats.replayableSessions, 6);
  assert.equal(stats.readOnlySessions, 1);
  assert.equal(stats.readOnlyPct, 16.7);
  assert.equal(stats.blockedOnlyByUnknown, 2);
  assert.deepEqual(stats.topBlockers, [
    { tool: "frobnicate", sessions: 2 },
    { tool: "quuxify", sessions: 1 },
  ]);
});

test("replayableRateStats: zero replayable sessions is an honest 0/0 at 0% — never NaN, never fabricated", () => {
  const stats = replayableRateStats([rateInput({ replayableCount: 0 })]);
  assert.equal(stats.replayableSessions, 0);
  assert.equal(stats.readOnlySessions, 0);
  assert.equal(stats.readOnlyPct, 0);
  assert.equal(stats.blockedOnlyByUnknown, 0);
  assert.deepEqual(stats.topBlockers, []);
});

test("formatReplayableRate: prints the rate line plus the top-blockers self-improvement line (capped at topN)", () => {
  const stats = replayableRateStats([
    rateInput({ replayableCount: 1, readOnly: true, effects: { read: 1, "idempotent-write": 0, destructive: 0 } }),
    rateInput({
      replayableCount: 1,
      effects: { read: 0, "idempotent-write": 0, destructive: 1 },
      unknownCount: 1,
      unknownTools: ["frobnicate"],
    }),
  ]);
  const lines = formatReplayableRate(stats);
  assert.equal(lines[0], "Replayable rate: 1/2 sessions fully read-only (50%).");
  assert.match(lines[1], /1 session\(s\) blocked ONLY by unknown-verb tools \(top blockers: frobnicate ×1\)/);

  const capped = formatReplayableRate(
    replayableRateStats([
      rateInput({
        replayableCount: 1,
        effects: { read: 0, "idempotent-write": 0, destructive: 3 },
        unknownCount: 3,
        unknownTools: ["a_tool", "b_tool", "c_tool"],
      }),
    ]),
    2
  );
  assert.match(capped[1], /top blockers: a_tool ×1, b_tool ×1\)/);
  assert.ok(!capped[1].includes("c_tool"));
});

test("formatReplayableRate: says so plainly when nothing is blocked by unknown verbs", () => {
  const lines = formatReplayableRate(
    replayableRateStats([rateInput({ replayableCount: 1, readOnly: true, effects: { read: 1, "idempotent-write": 0, destructive: 0 } })])
  );
  assert.equal(lines[0], "Replayable rate: 1/1 sessions fully read-only (100%).");
  assert.match(lines[1], /0 sessions blocked only by unknown-verb tools/);
});
