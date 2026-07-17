import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveL1, resolveL2 } from "../src/escalate.js";
import type { LlmClient, LlmCallResult } from "../src/llm.js";
import type { Observation } from "../src/assert.js";
import { parseSkill } from "../src/skill.js";

function fakeLlm(responses: LlmCallResult[]): LlmClient {
  let i = 0;
  return {
    async completeJson() {
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return r;
    },
  };
}

const STEP_SKILL = `---
name: escalate-test
description: one step
---

### Step 1 — get an id
- intent: fetch an id
- action: http.get {"url": "https://example.com/thing"}
- assert: status == 200
- bind: id = json.id
- effect: read
`;

test("resolveL1: a clean patch verdict comes back validated with token usage", async () => {
  const step = parseSkill(STEP_SKILL).steps[0];
  const obs: Observation = { status: 200, headers: {}, body: JSON.stringify({ data: { id: "abc123" } }) };
  const llm = fakeLlm([
    {
      json: {
        verdict: "patch",
        asserts: ["status == 200"],
        binds: ["id = json.data.id"],
        reason: "id moved under data",
      },
      usage: { inputTokens: 100, outputTokens: 20 },
    },
  ]);

  const result = await resolveL1({ step, observation: obs, failures: ["json.id path not found"], llm, model: "fake-model" });
  assert.equal(result.verdict, "patch");
  assert.equal(result.usage.inputTokens, 100);
  assert.equal(result.usage.outputTokens, 20);
  if (result.verdict === "patch") {
    assert.deepEqual(result.binds, ["id = json.data.id"]);
  }
});

test("resolveL1: an unparseable patched assert line is downgraded to real-failure with the validation error recorded", async () => {
  const step = parseSkill(STEP_SKILL).steps[0];
  const obs: Observation = { status: 200, headers: {}, body: "{}" };
  const llm = fakeLlm([
    {
      json: { verdict: "patch", asserts: ["this is not a valid assert line"], binds: [], reason: "nonsense" },
      usage: { inputTokens: 10, outputTokens: 5 },
    },
  ]);

  const result = await resolveL1({ step, observation: obs, failures: [], llm, model: "fake-model" });
  assert.equal(result.verdict, "real-failure");
  if (result.verdict === "real-failure") {
    assert.match(result.reason, /invalid patched assert/);
  }
  // Tokens still counted even though the patch was rejected.
  assert.equal(result.usage.inputTokens, 10);
});

test("resolveL1: an explicit real-failure verdict passes through with its reason", async () => {
  const step = parseSkill(STEP_SKILL).steps[0];
  const obs: Observation = { status: 500, headers: {}, body: "server error" };
  const llm = fakeLlm([
    { json: { verdict: "real-failure", reason: "upstream returned a 500, nothing to patch" }, usage: { inputTokens: 50, outputTokens: 8 } },
  ]);

  const result = await resolveL1({ step, observation: obs, failures: ["status == 200 failed: got 500"], llm, model: "fake-model" });
  assert.equal(result.verdict, "real-failure");
  if (result.verdict === "real-failure") {
    assert.equal(result.reason, "upstream returned a 500, nothing to patch");
  }
});

test("resolveL2: a patch with args is accepted when all template vars are bound", async () => {
  const step = parseSkill(STEP_SKILL).steps[0];
  const obs: Observation = { status: 404, headers: {}, body: "{}" };
  const llm = fakeLlm([
    {
      json: {
        verdict: "patch",
        asserts: ["status == 200"],
        binds: ["id = json.id"],
        args: { url: "https://example.com/v2/{{slug}}" },
        reason: "endpoint moved to /v2",
      },
      usage: { inputTokens: 200, outputTokens: 40 },
    },
  ]);

  const result = await resolveL2({
    step,
    skillContext: { skillName: "escalate-test", bindings: { slug: "widget-1" } },
    observation: obs,
    failures: ["status == 200 failed: got 404"],
    llm,
    model: "fake-model",
  });
  assert.equal(result.verdict, "patch");
  if (result.verdict === "patch") {
    assert.deepEqual(result.args, { url: "https://example.com/v2/{{slug}}" });
  }
});

test("resolveL2: args referencing an unbound template variable is rejected as real-failure", async () => {
  const step = parseSkill(STEP_SKILL).steps[0];
  const obs: Observation = { status: 404, headers: {}, body: "{}" };
  const llm = fakeLlm([
    {
      json: {
        verdict: "patch",
        asserts: ["status == 200"],
        binds: [],
        args: { url: "https://example.com/{{neverBound}}" },
        reason: "guessing",
      },
      usage: { inputTokens: 5, outputTokens: 5 },
    },
  ]);

  const result = await resolveL2({
    step,
    skillContext: { skillName: "escalate-test", bindings: {} },
    observation: obs,
    failures: [],
    llm,
    model: "fake-model",
  });
  assert.equal(result.verdict, "real-failure");
  if (result.verdict === "real-failure") {
    assert.match(result.reason, /unbound template variable \{\{neverBound\}\}/);
  }
});
