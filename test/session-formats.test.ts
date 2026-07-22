import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, rm, mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  detectSessionFormat,
  parseCodexTranscript,
  parseOpenClawTranscript,
  stubAgentSources,
  probeStubSource,
} from "../src/session-formats.js";
import { compileSessionTranscript, summarizeSession } from "../src/session.js";
import { parseSkill } from "../src/skill.js";

// Fixtures live at test/fixtures/ (repo-relative — NOT copied by tsc, so
// resolved from the compiled test file's real source path, same pattern as
// cli-entrypoint.test.ts's CLI_DIR).
const FIXTURES_DIR = fileURLToPath(new URL("../../test/fixtures", import.meta.url));

async function loadFixture(name: string): Promise<string> {
  return readFile(path.join(FIXTURES_DIR, name), "utf8");
}

// ---------------------------------------------------------------------------
// Codex CLI — fixture built from codex-rs/protocol/src/protocol.rs
// (RolloutLine/RolloutItem) + codex-rs/protocol/src/models.rs (ResponseItem
// FunctionCall/FunctionCallOutput) — see session-formats.ts's doc comment
// for the exact source citations.
// ---------------------------------------------------------------------------

test("detectSessionFormat: recognizes a Codex rollout transcript", async () => {
  const source = await loadFixture("codex-rollout.jsonl");
  assert.equal(detectSessionFormat(source), "codex");
});

test("parseCodexTranscript: extracts function_call/function_call_output pairs, decodes JSON-string arguments, skips non-function_call response_items", async () => {
  const source = await loadFixture("codex-rollout.jsonl");
  const parsed = parseCodexTranscript(source);
  assert.equal(parsed.pairs.length, 2);

  const shellCall = parsed.pairs.find((p) => p.call.name === "shell");
  assert.ok(shellCall);
  assert.deepEqual(shellCall!.call.input, { command: ["ls", "-la"] });
  assert.equal(shellCall!.result?.ok, true);

  const mcpCall = parsed.pairs.find((p) => p.call.name === "mcp__weather__get_forecast");
  assert.ok(mcpCall);
  assert.deepEqual(mcpCall!.call.input, { city: "San Francisco" });
  assert.equal(mcpCall!.result?.content, '{"forecast":"sunny","highF":68}');
});

test("compileSessionTranscript: a Codex transcript's mcp__ call compiles into a replayable skill (native 'shell' call is skipped, honestly)", async () => {
  const source = await loadFixture("codex-rollout.jsonl");
  const result = compileSessionTranscript(source, { name: "codex-demo", traceFileName: "codex-rollout.jsonl", format: "codex" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.replayableCount, 1);
  assert.deepEqual(result.servers, ["weather"]);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /Claude Code native tool|not one of Reelier's own/);
  // The compiler's own round-trip check already ran inside compileSessionTranscript; assert it here too.
  const parsedSkill = parseSkill(result.skillSource);
  assert.ok(parsedSkill.steps.length >= 1);
});

test("summarizeSession: auto-detects Codex format without an explicit hint", async () => {
  const source = await loadFixture("codex-rollout.jsonl");
  const summary = summarizeSession(source, "codex-rollout.jsonl");
  assert.equal(summary.replayableCount, 1);
  assert.deepEqual(summary.servers, ["weather"]);
});

// ---------------------------------------------------------------------------
// OpenClaw — fixture built from openclaw/openclaw
// src/agents/sessions/session-manager-types.ts (SessionHeader,
// SessionMessageEntry) + packages/llm-core/src/types.ts (ToolCall,
// ToolResultMessage) — see session-formats.ts's doc comment for citations.
// ---------------------------------------------------------------------------

test("detectSessionFormat: recognizes an OpenClaw session transcript (session header)", async () => {
  const source = await loadFixture("openclaw-session.jsonl");
  assert.equal(detectSessionFormat(source), "openclaw");
});

test("parseOpenClawTranscript: extracts toolCall/toolResult pairs, arguments already parsed (not a JSON string)", async () => {
  const source = await loadFixture("openclaw-session.jsonl");
  const parsed = parseOpenClawTranscript(source);
  assert.equal(parsed.pairs.length, 2);

  const bashCall = parsed.pairs.find((p) => p.call.name === "bash");
  assert.ok(bashCall);
  assert.deepEqual(bashCall!.call.input, { command: "echo hi" });
  assert.equal(bashCall!.result?.ok, true);
  assert.deepEqual(bashCall!.result?.content, [{ type: "text", text: "hi\n" }]);

  const mcpCall = parsed.pairs.find((p) => p.call.name === "mcp__github__create_issue");
  assert.ok(mcpCall);
  assert.deepEqual(mcpCall!.call.input, { repo: "acme/app", title: "Deploy tracking" });
});

test("compileSessionTranscript: an OpenClaw transcript's mcp__ call compiles into a replayable skill (native 'bash' call is skipped, honestly)", async () => {
  const source = await loadFixture("openclaw-session.jsonl");
  const result = compileSessionTranscript(source, { name: "openclaw-demo", traceFileName: "openclaw-session.jsonl", format: "openclaw" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.replayableCount, 1);
  assert.deepEqual(result.servers, ["github"]);
  const parsedSkill = parseSkill(result.skillSource);
  assert.ok(parsedSkill.steps.length >= 1);
});

// ---------------------------------------------------------------------------
// Cursor / Windsurf stubs — never parsed, only detected + reported.
// ---------------------------------------------------------------------------

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-stub-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("probeStubSource: an absent product dir reports 0 findings, never throws", async () => {
  const src = stubAgentSources("/definitely/does/not/exist", "linux")[0];
  const probe = await probeStubSource(src);
  assert.equal(probe.found, 0);
  assert.deepEqual(probe.paths, []);
});

test("probeStubSource: finds a state.vscdb under globalStorage without attempting to parse it", async () => {
  await withTmpDir(async (home) => {
    const src = stubAgentSources(home, "linux")[0]; // cursor
    await mkdir(src.globalStorageDir, { recursive: true });
    await writeFile(path.join(src.globalStorageDir, "state.vscdb"), "not-really-sqlite-but-irrelevant", "utf8");

    const probe = await probeStubSource(src);
    assert.equal(probe.found, 1);
    assert.ok(probe.paths[0].endsWith("state.vscdb"));
  });
});

test("stubAgentSources: platform-specific user-data dirs (win32 APPDATA, darwin Library, linux .config)", () => {
  const win = stubAgentSources("C:\\Users\\max", "win32", { APPDATA: "C:\\Users\\max\\AppData\\Roaming" })[0];
  assert.ok(win.globalStorageDir.includes("AppData\\Roaming\\Cursor"));

  const mac = stubAgentSources("/Users/max", "darwin")[0];
  assert.ok(mac.globalStorageDir.includes("/Users/max/Library/Application Support/Cursor"));

  const linux = stubAgentSources("/home/max", "linux")[0];
  assert.ok(linux.globalStorageDir.includes("/home/max/.config/Cursor"));
});
