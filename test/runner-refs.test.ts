import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runSkill } from "../src/runner.js";
import type { Tool } from "../src/tools.js";
import type { Observation } from "../src/assert.js";
import { parseSkill } from "../src/skill.js";

// B2 — StepRecord.refs threading (trust-ladder spec §3): extends the write-
// receipt discipline to READS — any executed step (not just writes) carries
// its Observation's refs onto the RunRecord, omitted when empty. A mocked
// step (--fail N) never gets refs (no real dispatch happened).

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

const SKILL_ONE_READ_STEP = `---
name: test-refs-read
description: a single read step, used to exercise refs threading
---

### Step 1 — get status
- intent: check status
- action: mock.tool {"url": "https://example.com/1"}
- assert: status == 200
- effect: read
`;

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-runner-refs-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("runner: a read step's Observation.refs is threaded onto StepRecord.refs (extends write.resource discipline to reads)", async () => {
  await withTempDir(async (dir) => {
    const skill = parseSkill(SKILL_ONE_READ_STEP);
    const record = await runSkill(skill, {
      cwd: dir,
      tools: {
        "mock.tool": mockTool([
          { status: 200, headers: {}, body: "{}", refs: [{ source: "header", key: "request-id", value: "req-1" }] },
        ]),
      },
    });
    assert.equal(record.passed, true);
    assert.deepEqual(record.steps[0].refs, [{ source: "header", key: "request-id", value: "req-1" }]);
  });
});

test("runner: a step whose Observation carries no refs omits StepRecord.refs entirely", async () => {
  await withTempDir(async (dir) => {
    const skill = parseSkill(SKILL_ONE_READ_STEP);
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": mockTool([{ status: 200, headers: {}, body: "{}" }]) },
    });
    assert.equal(record.steps[0].refs, undefined);
  });
});

const SKILL_MOCKED_STEP = `---
name: test-refs-mocked
description: a step run under --fail, used to prove mocked steps never get refs
---

### Step 1 — get status
- intent: check status
- action: mock.tool {"url": "https://example.com/1"}
- assert: status == 200
- effect: read
`;

test("runner: a mocked step (--fail N) never carries refs — no real dispatch happened", async () => {
  await withTempDir(async (dir) => {
    const skill = parseSkill(SKILL_MOCKED_STEP);
    const record = await runSkill(skill, {
      cwd: dir,
      tools: { "mock.tool": mockTool([{ status: 200, headers: {}, body: "{}" }]) },
      mockFailures: { 1: 500 },
    });
    assert.equal(record.steps[0].mocked, true);
    assert.equal(record.steps[0].refs, undefined);
  });
});
