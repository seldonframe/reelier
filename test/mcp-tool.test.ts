import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseSkill } from "../src/skill.js";
import { runSkill } from "../src/runner.js";
import { builtinTools } from "../src/tools.js";
import { buildMcpTools, mcpResultToObservation } from "../src/mcp-tool.js";
import type { DownstreamConnection, McpCallResult } from "../src/mcp-client.js";

test("mcpResultToObservation: single JSON text block maps to a parseable json body, ok status", () => {
  const result: McpCallResult = { content: [{ type: "text", text: JSON.stringify({ result: 3 }) }] };
  const obs = mcpResultToObservation(result);
  assert.equal(obs.status, 200);
  assert.deepEqual(obs.headers, {});
  assert.deepEqual(JSON.parse(obs.body), { result: 3 });
});

test("mcpResultToObservation: isError maps to status 500", () => {
  const result: McpCallResult = { content: [{ type: "text", text: "boom" }], isError: true };
  const obs = mcpResultToObservation(result);
  assert.equal(obs.status, 500);
  assert.equal(obs.body, "boom");
});

function fakeAddDownstream(): DownstreamConnection {
  return {
    name: "fake-add-server",
    tools: [
      {
        name: "add",
        description: "Adds two numbers.",
        inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } },
        annotations: { readOnlyHint: true },
      },
    ],
    async call(toolName, args) {
      assert.equal(toolName, "add");
      const { a, b } = args as { a: number; b: number };
      return { content: [{ type: "text", text: JSON.stringify({ sum: a + b }) }] };
    },
    async close() {},
  };
}

const SKILL_USES_MCP_TOOL = `---
name: test-mcp-add
description: uses a registered MCP tool, then binds and uses its result
---

### Step 1 — add two numbers
- intent: add 2 and 3 via the MCP add tool
- action: add {"a": 2, "b": 3}
- assert: json.sum == 5
- bind: total = json.sum
- effect: read

### Step 2 — use the bound total
- intent: add the bound total to 10
- action: add {"a": 10, "b": "{{total}}"}
- assert: json.sum is set
- effect: read
`;

test("runner-MCP adapter: Tool.effect follows the shared trust ladder — a readOnlyHint never downgrades any verb-match", () => {
  const downstream: DownstreamConnection = {
    name: "fake-mixed-server",
    tools: [
      // Unknown verb + readOnlyHint -> the hint classifies it read.
      { name: "frobnicate", inputSchema: {}, annotations: { readOnlyHint: true } },
      // Destructive verb + readOnlyHint -> the verb wins, always.
      { name: "delete_thing", inputSchema: {}, annotations: { readOnlyHint: true } },
      // Idempotent-write verb + readOnlyHint -> the verb wins here too; the
      // hint can't exempt a recognized write from --allow-writes.
      { name: "create_thing", inputSchema: {}, annotations: { readOnlyHint: true } },
      // No annotations, unknown verb -> destructive by default.
      { name: "quuxify", inputSchema: {} },
    ],
    async call() {
      throw new Error("not called in this test");
    },
    async close() {},
  };
  const tools = buildMcpTools([downstream]);
  assert.equal(tools.frobnicate.effect, "read");
  assert.equal(tools.delete_thing.effect, "destructive");
  assert.equal(tools.create_thing.effect, "idempotent-write");
  assert.equal(tools.quuxify.effect, "destructive");
});

test("runner-MCP adapter: a registered MCP tool runs a 2-step skill, json path + bind flow between steps", async () => {
  const downstream = fakeAddDownstream();
  const tools = { ...builtinTools, ...buildMcpTools([downstream]) };
  assert.ok(tools.add, "expected 'add' to be registered from the fake downstream");

  const skill = parseSkill(SKILL_USES_MCP_TOOL);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-mcp-adapter-"));
  try {
    const record = await runSkill(skill, { cwd: dir, tools });
    assert.equal(record.passed, true, JSON.stringify(record.steps));
    assert.equal(record.steps[0].outcome, "passed");
    assert.equal(record.steps[1].outcome, "passed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
