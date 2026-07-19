import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSessionTranscript,
  classifyToolUse,
  buildTraceFromSession,
  compileSessionTranscript,
  summarizeSession,
} from "../src/session.js";

// ---------------------------------------------------------------------------
// Fixture builders — shaped exactly like the real Claude Code transcript
// lines this was verified against (a Claude Code .jsonl session):
// {"type":"assistant","message":{"content":[{"type":"tool_use", id, name, input}]}}
// {"type":"user","message":{"content":[{"type":"tool_result", tool_use_id, content, is_error?}]}}
// content is sometimes a bare string, sometimes an array of {type:"text",text} blocks.
// ---------------------------------------------------------------------------

function assistantLine(toolUses: Array<{ id: string; name: string; input: unknown }>): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: toolUses.map((t) => ({ type: "tool_use", id: t.id, name: t.name, input: t.input })) },
  });
}

function userResultLine(results: Array<{ tool_use_id: string; content: unknown; is_error?: boolean }>): string {
  return JSON.stringify({
    type: "user",
    message: {
      content: results.map((r) => ({ type: "tool_result", tool_use_id: r.tool_use_id, content: r.content, is_error: r.is_error })),
    },
  });
}

// ---------------------------------------------------------------------------
// classifyToolUse — the honesty gate
// ---------------------------------------------------------------------------

test("classifyToolUse: mcp__<server>__<tool> is replayable, server/tool split correctly", () => {
  const c = classifyToolUse("mcp__scheduled-tasks__list_scheduled_tasks");
  assert.equal(c.replayable, true);
  if (c.replayable) {
    assert.equal(c.server, "scheduled-tasks");
    assert.equal(c.traceTool, "list_scheduled_tasks");
  }
});

test("classifyToolUse: server name with single underscores splits correctly (ccd_session_mgmt)", () => {
  const c = classifyToolUse("mcp__ccd_session_mgmt__archive_session");
  assert.equal(c.replayable, true);
  if (c.replayable) {
    assert.equal(c.server, "ccd_session_mgmt");
    assert.equal(c.traceTool, "archive_session");
  }
});

test("classifyToolUse: http.get / http.post builtins are replayable", () => {
  assert.equal(classifyToolUse("http.get").replayable, true);
  assert.equal(classifyToolUse("http.post").replayable, true);
});

for (const native of ["Bash", "Read", "Edit", "Write", "Grep", "Glob", "Task", "WebFetch", "ToolSearch", "NotebookEdit"]) {
  test(`classifyToolUse: native Claude Code tool '${native}' is NOT replayable`, () => {
    const c = classifyToolUse(native);
    assert.equal(c.replayable, false);
    if (!c.replayable) {
      assert.match(c.reason, /native tool/);
    }
  });
}

test("classifyToolUse: malformed mcp__ name (missing tool segment) is rejected, not guessed at", () => {
  const c = classifyToolUse("mcp__onlyserver");
  assert.equal(c.replayable, false);
});

// ---------------------------------------------------------------------------
// parseSessionTranscript — real-shape parsing, pairing, tolerance
// ---------------------------------------------------------------------------

test("parseSessionTranscript: pairs tool_use with its later tool_result by id, preserves order", () => {
  const source = [
    assistantLine([{ id: "toolu_1", name: "mcp__widgets__list", input: { page: 1 } }]),
    userResultLine([{ tool_use_id: "toolu_1", content: JSON.stringify({ items: ["a"] }) }]),
    assistantLine([{ id: "toolu_2", name: "Bash", input: { command: "ls" } }]),
    userResultLine([{ tool_use_id: "toolu_2", content: "file1\nfile2" }]),
  ].join("\n");

  const parsed = parseSessionTranscript(source);
  assert.equal(parsed.pairs.length, 2);
  assert.equal(parsed.pairs[0].call.name, "mcp__widgets__list");
  assert.equal(parsed.pairs[0].result?.ok, true);
  assert.equal(parsed.pairs[1].call.name, "Bash");
  assert.equal(parsed.malformedLines, 0);
});

test("parseSessionTranscript: handles string-shaped tool_result.content (confirmed real-transcript shape)", () => {
  const source = [
    assistantLine([{ id: "toolu_1", name: "mcp__x__y", input: {} }]),
    userResultLine([{ tool_use_id: "toolu_1", content: "plain string result" }]),
  ].join("\n");
  const parsed = parseSessionTranscript(source);
  assert.equal(parsed.pairs[0].result?.content, "plain string result");
});

test("parseSessionTranscript: is_error true marks the result not-ok", () => {
  const source = [
    assistantLine([{ id: "toolu_1", name: "mcp__x__y", input: {} }]),
    userResultLine([{ tool_use_id: "toolu_1", content: "boom", is_error: true }]),
  ].join("\n");
  const parsed = parseSessionTranscript(source);
  assert.equal(parsed.pairs[0].result?.ok, false);
});

test("parseSessionTranscript: skips malformed JSON lines without throwing, counts them", () => {
  const source = ["not json at all {{{", assistantLine([{ id: "toolu_1", name: "mcp__x__y", input: {} }])].join("\n");
  const parsed = parseSessionTranscript(source);
  assert.equal(parsed.malformedLines, 1);
  assert.equal(parsed.pairs.length, 1);
});

test("parseSessionTranscript: ignores non-message line types (queue-operation, attachment) instead of erroring", () => {
  const source = [
    JSON.stringify({ type: "queue-operation", operation: "enqueue", content: "hi" }),
    JSON.stringify({ type: "attachment", attachment: { type: "hook_success" } }),
    assistantLine([{ id: "toolu_1", name: "mcp__x__y", input: {} }]),
  ].join("\n");
  const parsed = parseSessionTranscript(source);
  assert.equal(parsed.malformedLines, 0);
  assert.equal(parsed.pairs.length, 1);
});

// ---------------------------------------------------------------------------
// buildTraceFromSession + compileSessionTranscript — THE honesty rule,
// unit-tested end to end: a transcript mixing MCP calls with Bash/Edit only
// ever compiles the MCP calls, and reports the rest as skipped.
// ---------------------------------------------------------------------------

function mixedTranscript(): string {
  return [
    assistantLine([{ id: "t1", name: "Read", input: { file_path: "/tmp/x.ts" } }]),
    userResultLine([{ tool_use_id: "t1", content: "file contents here" }]),
    assistantLine([{ id: "t2", name: "mcp__widgets__create_widget", input: { name: "gadget" } }]),
    userResultLine([{ tool_use_id: "t2", content: JSON.stringify({ id: "widget_42", name: "gadget" }) }]),
    assistantLine([{ id: "t3", name: "Bash", input: { command: "npm test" } }]),
    userResultLine([{ tool_use_id: "t3", content: "all tests passed" }]),
    assistantLine([{ id: "t4", name: "mcp__widgets__get_widget", input: { id: "widget_42" } }]),
    userResultLine([{ tool_use_id: "t4", content: JSON.stringify({ id: "widget_42", name: "gadget", status: "ready" }) }]),
    assistantLine([{ id: "t5", name: "Edit", input: { file_path: "/tmp/x.ts", old_string: "a", new_string: "b" } }]),
    userResultLine([{ tool_use_id: "t5", content: "edited" }]),
  ].join("\n");
}

test("honesty filter: a mixed transcript compiles ONLY the MCP calls; Bash/Read/Edit are reported skipped, never fabricated into the skill", () => {
  const parsed = parseSessionTranscript(mixedTranscript());
  const built = buildTraceFromSession(parsed, "mixed-demo");

  assert.equal(built.replayableCount, 2);
  const skippedNames = built.skipped.map((s) => s.name).sort();
  assert.deepEqual(skippedNames, ["Bash", "Edit", "Read"]);

  const callTools = built.records.filter((r) => r.t === "call").map((r) => (r as { tool: string }).tool);
  assert.deepEqual(callTools, ["create_widget", "get_widget"]);
});

test("honesty filter (end to end via compileSessionTranscript): emitted SKILL.md contains only the replayable steps", () => {
  const result = compileSessionTranscript(mixedTranscript(), { name: "mixed-demo", traceFileName: "mixed-demo.jsonl" });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.compileResult.steps.length, 2);
  assert.equal(result.compileResult.steps[0].tool, "create_widget");
  assert.equal(result.compileResult.steps[1].tool, "get_widget");
  assert.equal(result.skipped.length, 3);
  assert.deepEqual(result.servers, ["widgets"]);

  // The skill source itself must never mention Bash/Read/Edit as a step action.
  assert.ok(!/action: Bash/.test(result.skillSource));
  assert.ok(!/action: Read/.test(result.skillSource));
  assert.ok(!/action: Edit/.test(result.skillSource));
  assert.ok(/create_widget/.test(result.skillSource));
  assert.ok(/get_widget/.test(result.skillSource));

  // Dataflow recovery still runs through the real compiler: get_widget's id arg
  // was bound from create_widget's result.
  assert.deepEqual(result.compileResult.steps[1].args, { id: "{{id}}" });
});

test("honesty filter: a transcript with ZERO replayable calls returns an honest failure, never an empty/fake skill", () => {
  const source = [
    assistantLine([{ id: "t1", name: "Read", input: { file_path: "/tmp/x.ts" } }]),
    userResultLine([{ tool_use_id: "t1", content: "contents" }]),
    assistantLine([{ id: "t2", name: "Bash", input: { command: "ls" } }]),
    userResultLine([{ tool_use_id: "t2", content: "a b c" }]),
  ].join("\n");

  const result = compileSessionTranscript(source, { name: "no-replay", traceFileName: "no-replay.jsonl" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /no deterministically-replayable tool calls/);
  assert.equal(result.skipped.length, 2);
});

test("honesty filter: a replayable call with no matching tool_result (recording cut off) is skipped, not guessed", () => {
  const source = [assistantLine([{ id: "t1", name: "mcp__widgets__list", input: {} }])].join("\n");
  const built = buildTraceFromSession(parseSessionTranscript(source), "cutoff");
  assert.equal(built.replayableCount, 0);
  assert.equal(built.skipped.length, 1);
  assert.match(built.skipped[0].reason, /no matching tool_result/);
});

// ---------------------------------------------------------------------------
// summarizeSession — used by `reelier scan`
// ---------------------------------------------------------------------------

test("summarizeSession: reports replayable/skipped counts and involved servers for a mixed transcript", () => {
  const summary = summarizeSession(mixedTranscript(), "/fake/path.jsonl");
  assert.equal(summary.totalToolCalls, 5);
  assert.equal(summary.replayableCount, 2);
  assert.equal(summary.skippedCount, 3);
  assert.deepEqual(summary.servers, ["widgets"]);
});

test("summarizeSession: a transcript with no replayable calls reports replayableCount 0 without throwing", () => {
  const source = [assistantLine([{ id: "t1", name: "Bash", input: { command: "ls" } }]), userResultLine([{ tool_use_id: "t1", content: "x" }])].join(
    "\n"
  );
  const summary = summarizeSession(source, "/fake/path2.jsonl");
  assert.equal(summary.replayableCount, 0);
});
