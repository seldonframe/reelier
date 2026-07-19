import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  buildToolServer,
  runScanTool,
  runFromSessionTool,
  runReplayTool,
  runPushTool,
} from "../src/serve.js";

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-serve-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function withFetch<T>(fn: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function fakeOkFetch(): typeof fetch {
  return (async () =>
    ({
      status: 200,
      ok: true,
      headers: new Headers(),
      text: async () => "ok-body",
    }) as unknown as Response) as typeof fetch;
}

function assistantLine(id: string, name: string, input: unknown): string {
  return JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
}

function userResultLine(toolUseId: string, content: unknown): string {
  return JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content }] },
  });
}

const REPLAY_SKILL_SOURCE = `---
name: serve-replay-fixture
description: a skill used to exercise reelier_replay
---

### Step 1 — one
- intent: first step
- action: http.get {"url": "https://example.com/1"}
- assert: status == 200
- effect: read
`;

// ---------------------------------------------------------------------------
// reelier_scan
// ---------------------------------------------------------------------------

test("runScanTool: an empty/nonexistent dir returns an honest zero result, never fabricated", async () => {
  const result = await runScanTool({ dir: "/definitely/does/not/exist/anywhere" });
  assert.equal(result.totalSessions, 0);
  assert.equal(result.replayableSessions, 0);
  assert.deepEqual(result.sessions, []);
});

test("runScanTool: reports replayable vs skipped sessions correctly", async () => {
  await withTmpDir(async (dir) => {
    const projectDir = path.join(dir, "my-project");
    await mkdir(projectDir, { recursive: true });

    const replayableSession = [
      assistantLine("t1", "mcp__widgets__list", {}),
      userResultLine("t1", JSON.stringify({ items: [] })),
    ].join("\n");
    const nonReplayableSession = [assistantLine("t1", "Bash", { command: "ls" }), userResultLine("t1", "a b c")].join(
      "\n"
    );

    await writeFile(path.join(projectDir, "session-replayable.jsonl"), replayableSession, "utf8");
    await writeFile(path.join(projectDir, "session-none.jsonl"), nonReplayableSession, "utf8");

    const result = await runScanTool({ dir });
    assert.equal(result.totalSessions, 2);
    assert.equal(result.replayableSessions, 1);
    const replayable = result.sessions.find((s) => s.path.endsWith("session-replayable.jsonl"));
    assert.equal(replayable?.replayableCount, 1);
    assert.deepEqual(replayable?.servers, ["widgets"]);
  });
});

// ---------------------------------------------------------------------------
// reelier_from_session
// ---------------------------------------------------------------------------

test("runFromSessionTool: a transcript with no replayable calls returns ok:false honestly, writes nothing", async () => {
  await withTmpDir(async (dir) => {
    const transcriptPath = path.join(dir, "session.jsonl");
    const source = [assistantLine("t1", "Bash", { command: "ls" }), userResultLine("t1", "a b c")].join("\n");
    await writeFile(transcriptPath, source, "utf8");

    const result = await runFromSessionTool({ transcriptPath, out: path.join(dir, "out.skill.md") });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /no deterministically-replayable tool calls/);
      assert.equal(result.skipped.length, 1);
    }
    await assert.rejects(readFile(path.join(dir, "out.skill.md")));
  });
});

test("runFromSessionTool: a replayable transcript compiles a real skill file with stats + open questions", async () => {
  await withTmpDir(async (dir) => {
    const transcriptPath = path.join(dir, "session.jsonl");
    const source = [
      assistantLine("t1", "mcp__widgets__list", { q: "socks" }),
      userResultLine("t1", JSON.stringify({ items: [] })),
    ].join("\n");
    await writeFile(transcriptPath, source, "utf8");

    const outPath = path.join(dir, "out.skill.md");
    const result = await runFromSessionTool({ transcriptPath, name: "widgets-skill", out: outPath });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.skillPath, outPath);
      assert.equal(result.steps, 1);
      assert.deepEqual(result.servers, ["widgets"]);
      assert.equal(result.replayableCount, 1);
    }
    const written = await readFile(outPath, "utf8");
    assert.match(written, /name: widgets-skill/);
  });
});

test("runFromSessionTool: refuses to overwrite an existing file unless force is set", async () => {
  await withTmpDir(async (dir) => {
    const transcriptPath = path.join(dir, "session.jsonl");
    const source = [
      assistantLine("t1", "mcp__widgets__list", {}),
      userResultLine("t1", JSON.stringify({ items: [] })),
    ].join("\n");
    await writeFile(transcriptPath, source, "utf8");

    const outPath = path.join(dir, "out.skill.md");
    await writeFile(outPath, "existing content", "utf8");

    await assert.rejects(runFromSessionTool({ transcriptPath, out: outPath }), /Refusing to overwrite/);
    const untouched = await readFile(outPath, "utf8");
    assert.equal(untouched, "existing content");

    const result = await runFromSessionTool({ transcriptPath, out: outPath, force: true });
    assert.equal(result.ok, true);
  });
});

// ---------------------------------------------------------------------------
// reelier_replay
// ---------------------------------------------------------------------------

test("runReplayTool: replays a real skill at Level 0 and returns the actual run record", async () => {
  await withTmpDir(async (dir) => {
    const skillPath = path.join(dir, "serve-replay-fixture.skill.md");
    await writeFile(skillPath, REPLAY_SKILL_SOURCE, "utf8");

    const record = await withFetch(fakeOkFetch(), () => runReplayTool({ skillPath, cwd: dir }));

    assert.equal(record.skill, "serve-replay-fixture");
    assert.equal(record.passed, true);
    assert.equal(record.steps.length, 1);
    assert.equal(record.steps[0].outcome, "passed");
    assert.equal(record.steps[0].level, 0);
    // Level 0 must never touch the LLM.
    assert.equal(record.totals.llmInputTokens, 0);
    assert.equal(record.totals.llmOutputTokens, 0);
  });
});

test("runReplayTool: a genuinely failing assertion produces a real failed record, never a fabricated pass", async () => {
  await withTmpDir(async (dir) => {
    const skillPath = path.join(dir, "serve-replay-fail.skill.md");
    const source = `---
name: serve-replay-fail
description: exercises a real failure
---

### Step 1 — one
- intent: first step
- action: http.get {"url": "https://example.com/1"}
- assert: status == 404
- effect: read
`;
    await writeFile(skillPath, source, "utf8");

    const record = await withFetch(fakeOkFetch(), () => runReplayTool({ skillPath, cwd: dir }));
    assert.equal(record.passed, false);
    assert.equal(record.steps[0].outcome, "failed");
    assert.ok(record.steps[0].failures.length > 0);
  });
});

// ---------------------------------------------------------------------------
// reelier_push
// ---------------------------------------------------------------------------

test("runPushTool: missing cloud config is reported as skipped-no-key, never a silent success", async () => {
  await withTmpDir(async (dir) => {
    const skillPath = path.join(dir, "skill.skill.md");
    await writeFile(skillPath, REPLAY_SKILL_SOURCE, "utf8");
    // pushSkill reads run records before checking cloud config — give it a
    // record to read so this test isolates the no-key path specifically.
    const runsDir = path.join(dir, ".reelier", "runs");
    await mkdir(runsDir, { recursive: true });
    const record = {
      skill: "serve-replay-fixture",
      startedAt: "2026-07-18T00:00:00.000Z",
      finishedAt: "2026-07-18T00:00:00.500Z",
      passed: true,
      steps: [{ n: 1, title: "one", level: 0, outcome: "passed", ms: 5, failures: [] }],
      totals: { steps: 1, passed: 1, unchecked: 0, skipped: 0, failed: 0, ms: 5, llmInputTokens: 0, llmOutputTokens: 0 },
    };
    await writeFile(path.join(runsDir, "serve-replay-fixture.jsonl"), JSON.stringify(record) + "\n", "utf8");

    await withEnv({ REELIER_CLOUD_URL: undefined, REELIER_CLOUD_KEY: undefined }, async () => {
      const result = await runPushTool({ skillPath, cwd: dir });
      assert.equal(result.outcome, "skipped-no-key");
      if (result.outcome === "skipped-no-key") {
        assert.match(result.message, /REELIER_CLOUD_URL|REELIER_CLOUD_KEY/);
      }
    });
  });
});

test("runPushTool: no run records for the skill is reported as failed with the real error, not swallowed", async () => {
  await withTmpDir(async (dir) => {
    const skillPath = path.join(dir, "skill.skill.md");
    await writeFile(skillPath, REPLAY_SKILL_SOURCE, "utf8");

    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const result = await runPushTool({ skillPath, cwd: dir });
      assert.equal(result.outcome, "failed");
      if (result.outcome === "failed") {
        assert.match(result.message, /No run records found/);
      }
    });
  });
});

test("runPushTool: dry-run reports the real candidate count without any network call", async () => {
  await withTmpDir(async (dir) => {
    const skillPath = path.join(dir, "skill.skill.md");
    await writeFile(skillPath, REPLAY_SKILL_SOURCE, "utf8");
    const runsDir = path.join(dir, ".reelier", "runs");
    await mkdir(runsDir, { recursive: true });
    const record = {
      skill: "serve-replay-fixture",
      startedAt: "2026-07-18T00:00:00.000Z",
      finishedAt: "2026-07-18T00:00:00.500Z",
      passed: true,
      steps: [{ n: 1, title: "one", level: 0, outcome: "passed", ms: 5, failures: [] }],
      totals: { steps: 1, passed: 1, unchecked: 0, skipped: 0, failed: 0, ms: 5, llmInputTokens: 0, llmOutputTokens: 0 },
    };
    await writeFile(path.join(runsDir, "serve-replay-fixture.jsonl"), JSON.stringify(record) + "\n", "utf8");

    const result = await runPushTool({ skillPath, cwd: dir, dryRun: true });
    assert.equal(result.outcome, "ok");
    if (result.outcome === "ok") {
      assert.equal(result.result.dryRun, true);
      assert.equal(result.result.candidateCount, 1);
    }
  });
});

// ---------------------------------------------------------------------------
// The MCP server itself: lists the 4 tools with schemas, and a real call
// against a real skill returns a real receipt (end-to-end over an in-memory
// MCP transport, exactly like proxy-e2e.test.ts does for the recorder).
// ---------------------------------------------------------------------------

test("buildToolServer: lists reelier_scan/from_session/replay/push with input schemas, and replay returns a real receipt", async () => {
  await withTmpDir(async (dir) => {
    const skillPath = path.join(dir, "serve-replay-fixture.skill.md");
    await writeFile(skillPath, REPLAY_SKILL_SOURCE, "utf8");

    const server = buildToolServer();
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "reelier-serve-test-client", version: "0.0.1" }, { capabilities: {} });
    await client.connect(clientSide);

    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["reelier_from_session", "reelier_push", "reelier_replay", "reelier_scan"]);
    for (const t of listed.tools) {
      assert.equal(t.inputSchema.type, "object");
    }
    const replayTool = listed.tools.find((t) => t.name === "reelier_replay")!;
    assert.deepEqual(replayTool.inputSchema.required, ["skillPath"]);

    const callResult = await withFetch(fakeOkFetch(), () =>
      client.callTool({ name: "reelier_replay", arguments: { skillPath, cwd: dir } })
    );
    assert.equal(callResult.isError, undefined);
    const text = (callResult.content as Array<{ text: string }>)[0].text;
    const record = JSON.parse(text);
    assert.equal(record.skill, "serve-replay-fixture");
    assert.equal(record.passed, true);
    assert.equal(record.totals.llmInputTokens, 0);

    // Unknown-tool and missing-required-arg calls return an explicit MCP
    // error, never a silent/empty success.
    const missingArg = await client.callTool({ name: "reelier_replay", arguments: {} });
    assert.equal(missingArg.isError, true);

    const unknown = await client.callTool({ name: "reelier_bogus", arguments: {} });
    assert.equal(unknown.isError, true);

    await client.close();
    await server.close();
  });
});
