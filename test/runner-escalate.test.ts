import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runSkill } from "../src/runner.js";
import { parseSkill } from "../src/skill.js";
import type { Tool } from "../src/tools.js";
import type { Observation } from "../src/assert.js";
import type { LlmClient, LlmCallInput, LlmCallResult } from "../src/llm.js";

function spyLlm(responses: LlmCallResult[]): { llm: LlmClient; calls: LlmCallInput[] } {
  const calls: LlmCallInput[] = [];
  let i = 0;
  const llm: LlmClient = {
    async completeJson(input) {
      calls.push(input);
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return r;
    },
  };
  return { llm, calls };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-escalate-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const SKILL_MOVED_ID = `---
name: heal-moved-id
description: id bind moved under a wrapper
---

### Step 1 — get an id
- intent: fetch an id
- action: mock.tool {"url": "https://example.com/thing"}
- assert: status == 200
- bind: id = json.id
- effect: read

### Step 2 — use the id
- intent: use it
- action: mock.tool {"url": "https://example.com/use/{{id}}"}
- assert: status == 200
- effect: read
`;

test("maxLevel 0 (default): divergence fails and the LLM is never invoked", async () => {
  await withTempDir(async (dir) => {
    const skill = parseSkill(SKILL_MOVED_ID);
    const { llm, calls } = spyLlm([
      { json: { verdict: "patch", asserts: ["status == 200"], binds: ["id = json.data.id"], reason: "n/a" }, usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    const tool: Tool = {
      effect: "read",
      async run(): Promise<Observation> {
        return { status: 200, headers: {}, body: JSON.stringify({ data: { id: "abc123" } }) };
      },
    };
    const record = await runSkill(skill, { cwd: dir, tools: { "mock.tool": tool }, llm /* maxLevel omitted -> 0 */ });
    assert.equal(record.passed, false);
    assert.equal(record.steps[0].outcome, "failed");
    assert.equal(record.steps[0].level, 0);
    assert.equal(calls.length, 0, "LLM must never be called at maxLevel 0");
    assert.equal(record.totals.llmInputTokens, 0);
  });
});

test("L1 heals a moved json path: step passes at level 1, write-back applied and re-parseable", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "heal-moved-id.skill.md");
    await writeFile(skillPath, SKILL_MOVED_ID, "utf8");
    const skill = parseSkill(SKILL_MOVED_ID);

    const { llm, calls } = spyLlm([
      {
        json: { verdict: "patch", asserts: ["status == 200"], binds: ["id = json.data.id"], reason: "id moved under a data wrapper" },
        usage: { inputTokens: 120, outputTokens: 30 },
      },
    ]);

    const seenUrls: string[] = [];
    const tool: Tool = {
      effect: "read",
      async run(args): Promise<Observation> {
        seenUrls.push((args as { url: string }).url);
        if (seenUrls.length === 1) {
          return { status: 200, headers: {}, body: JSON.stringify({ data: { id: "abc123" } }) };
        }
        return { status: 200, headers: {}, body: "{}" };
      },
    };

    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": tool },
      maxLevel: 1,
      llm,
      skillPath,
    });

    assert.equal(record.passed, true);
    assert.equal(record.steps[0].outcome, "passed");
    assert.equal(record.steps[0].level, 1);
    assert.equal(record.steps[0].llm?.inputTokens, 120);
    assert.equal(calls.length, 1);
    // Step 2's template got the healed bind value, proving bindings were updated in-place.
    assert.deepEqual(seenUrls, ["https://example.com/thing", "https://example.com/use/abc123"]);

    const written = await readFile(skillPath, "utf8");
    assert.match(written, /bind: id = json\.data\.id/);
    assert.match(written, /## Changelog/);
    assert.match(written, /L1 heal, step 1 \(get an id\): id moved under a data wrapper/);
    // Step 2 is untouched.
    assert.match(written, /### Step 2 — use the id/);
    assert.match(written, /https:\/\/example\.com\/use\/\{\{id\}\}/);

    const reparsed = parseSkill(written);
    assert.deepEqual(reparsed.steps[0].binds, ["id = json.data.id"]);
    assert.equal(reparsed.steps.length, 2);
  });
});

test("L1 invalid patch (unparseable assert line) is treated as a real failure, no write-back", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "heal-moved-id.skill.md");
    await writeFile(skillPath, SKILL_MOVED_ID, "utf8");
    const skill = parseSkill(SKILL_MOVED_ID);

    const { llm } = spyLlm([
      { json: { verdict: "patch", asserts: ["not a valid assert at all"], binds: [], reason: "guess" }, usage: { inputTokens: 5, outputTokens: 5 } },
    ]);
    const tool: Tool = {
      effect: "read",
      async run(): Promise<Observation> {
        return { status: 200, headers: {}, body: JSON.stringify({ data: { id: "abc123" } }) };
      },
    };

    const record = await runSkill(skill, { cwd: dir, tools: { "mock.tool": tool }, maxLevel: 1, llm, skillPath });

    assert.equal(record.passed, false);
    assert.equal(record.steps[0].outcome, "failed");
    assert.equal(record.steps[0].level, 0);
    assert.match(record.steps[0].failures.join("\n"), /invalid patched assert/);
    // Tokens from the (failed) escalation attempt are still accounted for — honest accounting.
    assert.equal(record.steps[0].llm?.inputTokens, 5);

    const written = await readFile(skillPath, "utf8");
    assert.equal(written, SKILL_MOVED_ID, "no write-back on a rejected patch");
  });
});

test("L1 real-failure verdict: step fails, no write-back, tokens still counted", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "heal-moved-id.skill.md");
    await writeFile(skillPath, SKILL_MOVED_ID, "utf8");
    const skill = parseSkill(SKILL_MOVED_ID);

    const { llm } = spyLlm([
      { json: { verdict: "real-failure", reason: "the upstream API is genuinely broken" }, usage: { inputTokens: 40, outputTokens: 12 } },
    ]);
    const tool: Tool = {
      effect: "read",
      async run(): Promise<Observation> {
        return { status: 200, headers: {}, body: JSON.stringify({ data: { id: "abc123" } }) };
      },
    };

    const record = await runSkill(skill, { cwd: dir, tools: { "mock.tool": tool }, maxLevel: 1, llm, skillPath });

    assert.equal(record.passed, false);
    assert.equal(record.steps[0].level, 0);
    assert.match(record.steps[0].failures.join("\n"), /the upstream API is genuinely broken/);
    assert.equal(record.totals.llmInputTokens, 40);
    assert.equal(record.totals.llmOutputTokens, 12);

    const written = await readFile(skillPath, "utf8");
    assert.equal(written, SKILL_MOVED_ID, "no write-back when the LLM says real-failure");
  });
});

const SKILL_READ_STEP = `---
name: heal-with-l2
description: a read step whose endpoint moved
---

### Step 1 — get a thing
- intent: fetch a thing
- action: mock.tool {"url": "https://example.com/v1/thing"}
- assert: status == 200
- effect: read
`;

test("L2 patches args on a read step: re-executed against the fake tool, passes at level 2", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "heal-with-l2.skill.md");
    await writeFile(skillPath, SKILL_READ_STEP, "utf8");
    const skill = parseSkill(SKILL_READ_STEP);

    const { llm, calls } = spyLlm([
      { json: { verdict: "real-failure", reason: "L1 has nothing to patch, the endpoint itself moved" }, usage: { inputTokens: 10, outputTokens: 5 } },
      {
        json: {
          verdict: "patch",
          asserts: ["status == 200"],
          binds: [],
          args: { url: "https://example.com/v2/thing" },
          reason: "endpoint moved from v1 to v2",
        },
        usage: { inputTokens: 200, outputTokens: 50 },
      },
    ]);

    let calledCount = 0;
    const tool: Tool = {
      effect: "read",
      async run(args): Promise<Observation> {
        calledCount++;
        const url = (args as { url: string }).url;
        if (url === "https://example.com/v2/thing") {
          return { status: 200, headers: {}, body: "{}" };
        }
        return { status: 404, headers: {}, body: "not found" };
      },
    };

    const record = await runSkill(skill, { cwd: dir, tools: { "mock.tool": tool }, maxLevel: 2, llm, skillPath });

    assert.equal(record.passed, true);
    assert.equal(record.steps[0].outcome, "passed");
    assert.equal(record.steps[0].level, 2);
    assert.equal(calledCount, 2, "original call + exactly one L2 re-execution");
    assert.equal(calls.length, 2, "L1 attempt + L2 attempt");
    assert.equal(record.steps[0].llm?.inputTokens, 210);

    const written = await readFile(skillPath, "utf8");
    assert.match(written, /"url":"https:\/\/example\.com\/v2\/thing"/);
    assert.match(written, /L2 heal, step 1 \(get a thing\): endpoint moved from v1 to v2/);
  });
});

const SKILL_DESTRUCTIVE = `---
name: heal-destructive
description: a destructive step that diverges
---

### Step 1 — delete a thing
- intent: delete a resource
- action: mock.tool {"url": "https://example.com/delete"}
- assert: status == 204
- effect: destructive
`;

test("L2 on a destructive step: never re-executed, fails with the Level 3 message", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "heal-destructive.skill.md");
    await writeFile(skillPath, SKILL_DESTRUCTIVE, "utf8");
    const skill = parseSkill(SKILL_DESTRUCTIVE);

    const { llm, calls } = spyLlm([
      { json: { verdict: "real-failure", reason: "asserted status doesn't match, and it's destructive anyway" }, usage: { inputTokens: 15, outputTokens: 5 } },
    ]);

    let calledCount = 0;
    const tool: Tool = {
      effect: "destructive",
      async run(): Promise<Observation> {
        calledCount++;
        return { status: 200, headers: {}, body: "" }; // diverges: step asserts 204
      },
    };

    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": tool },
      maxLevel: 2,
      allowDestructive: true, // the step actually runs once, then diverges on the assert
      llm,
      skillPath,
    });

    assert.equal(record.passed, false);
    assert.equal(record.steps[0].level, 0);
    assert.equal(calledCount, 1, "the destructive tool call ran exactly once (the original attempt) — never re-run");
    assert.equal(calls.length, 1, "only L1 was consulted — L2 is never asked about a destructive step");
    assert.match(record.steps[0].failures.join("\n"), /Level 2 auto-repair never re-runs a destructive step/);

    const written = await readFile(skillPath, "utf8");
    assert.equal(written, SKILL_DESTRUCTIVE, "no write-back — nothing was healed");
  });
});
