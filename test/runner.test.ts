import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fillTemplate, runSkill } from "../src/runner.js";
import type { Tool } from "../src/tools.js";
import type { Observation } from "../src/assert.js";
import { parseSkill } from "../src/skill.js";

test("fillTemplate replaces {{var}} holes in string values, recursively", () => {
  const filled = fillTemplate(
    { url: "https://example.com/{{slug}}", nested: { q: "{{token}}-suffix" }, list: ["{{slug}}"] },
    { slug: "acme", token: "abc" }
  );
  assert.deepEqual(filled, {
    url: "https://example.com/acme",
    nested: { q: "abc-suffix" },
    list: ["acme"],
  });
});

test("fillTemplate throws on an unbound variable", () => {
  assert.throws(() => fillTemplate({ url: "{{missing}}" }, {}), /Unbound template variable/);
});

function mockTool(observations: Observation[]): Tool {
  let i = 0;
  return {
    effect: "read",
    async run() {
      const obs = observations[Math.min(i, observations.length - 1)];
      i++;
      return obs;
    },
  };
}

const SKILL_TWO_STEPS = `---
name: test-two-steps
description: two steps, second depends on a bind from the first
---

### Step 1 — get token
- intent: get a token
- action: mock.tool {"url": "https://example.com/1"}
- assert: status == 200
- bind: token = json.token
- effect: read

### Step 2 — use token
- intent: use the token
- action: mock.tool {"url": "https://example.com/2/{{token}}"}
- assert: status == 200
- effect: read
`;

test("runner: divergence on step 1 marks step 2 as skipped and exits failed", async () => {
  const skill = parseSkill(SKILL_TWO_STEPS);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  try {
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": mockTool([{ status: 500, headers: {}, body: "" }]) },
    });
    assert.equal(record.passed, false);
    assert.equal(record.steps[0].outcome, "failed");
    assert.equal(record.steps[1].outcome, "skipped");

    const raw = await readFile(path.join(dir, ".reelier", "runs", "test-two-steps.jsonl"), "utf8");
    const lines = raw.trim().split("\n");
    assert.equal(lines.length, 1);
    const written = JSON.parse(lines[0]);
    assert.equal(written.passed, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runner: successful run binds step 1's value into step 2's template", async () => {
  const skill = parseSkill(SKILL_TWO_STEPS);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  const seenUrls: string[] = [];
  try {
    const tool: Tool = {
      effect: "read",
      async run(args) {
        seenUrls.push((args as { url: string }).url);
        if (seenUrls.length === 1) {
          return { status: 200, headers: {}, body: JSON.stringify({ token: "tok-9" }) };
        }
        return { status: 200, headers: {}, body: "{}" };
      },
    };
    const record = await runSkill(skill, { cwd: dir, tools: { "mock.tool": tool } });
    assert.equal(record.passed, true);
    assert.deepEqual(seenUrls, ["https://example.com/1", "https://example.com/2/tok-9"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const SKILL_NO_ASSERTS = `---
name: test-unchecked
description: a step with zero assertions
---

### Step 1 — no assertions
- intent: just call it
- action: mock.tool {"url": "https://example.com"}
- effect: read
`;

test("runner: a step with zero assertions is 'unchecked', never 'passed' (honest-success rule)", async () => {
  const skill = parseSkill(SKILL_NO_ASSERTS);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  try {
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": mockTool([{ status: 200, headers: {}, body: "" }]) },
    });
    assert.equal(record.steps[0].outcome, "unchecked");
    assert.notEqual(record.steps[0].outcome, "passed");
    // unchecked still counts toward "passed" totals (it didn't fail), but is
    // never reported as a verified assertion.
    assert.equal(record.passed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const SKILL_DESTRUCTIVE = `---
name: test-destructive
description: a destructive step
---

### Step 1 — delete something
- intent: delete a resource
- action: mock.tool {"url": "https://example.com/delete"}
- assert: status == 200
- effect: destructive
`;

test("runner: refuses to execute a destructive step without --yes", async () => {
  const skill = parseSkill(SKILL_DESTRUCTIVE);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  let called = false;
  try {
    const tool: Tool = {
      effect: "destructive",
      async run() {
        called = true;
        return { status: 200, headers: {}, body: "" };
      },
    };
    const record = await runSkill(skill, { cwd: dir, tools: { "mock.tool": tool }, allowDestructive: false });
    assert.equal(called, false);
    assert.equal(record.passed, false);
    assert.match(record.steps[0].failures[0], /Refusing to execute destructive step/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runner: executes a destructive step when allowDestructive is true", async () => {
  const skill = parseSkill(SKILL_DESTRUCTIVE);
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-test-"));
  let called = false;
  try {
    const tool: Tool = {
      effect: "destructive",
      async run() {
        called = true;
        return { status: 200, headers: {}, body: "" };
      },
    };
    const record = await runSkill(skill, { cwd: dir, tools: { "mock.tool": tool }, allowDestructive: true });
    assert.equal(called, true);
    assert.equal(record.passed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
