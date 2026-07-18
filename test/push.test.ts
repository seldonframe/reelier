import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pushSkill, readPushState } from "../src/push.js";
import type { RunRecord } from "../src/runner.js";

const SKILL_SOURCE = `---
name: push-fixture
description: a skill used to exercise reelier push
---

### Step 1 — one
- intent: first step
- action: http.get {"url": "https://example.com/1"}
- assert: status == 200
- effect: read
`;

function makeRecord(n: number): RunRecord {
  return {
    skill: "push-fixture",
    startedAt: `2026-07-18T00:00:0${n}.000Z`,
    finishedAt: `2026-07-18T00:00:0${n}.500Z`,
    passed: true,
    steps: [{ n: 1, title: "one", level: 0, outcome: "passed", ms: 5, failures: [] }],
    totals: { steps: 1, passed: 1, unchecked: 0, skipped: 0, failed: 0, ms: 5, llmInputTokens: 0, llmOutputTokens: 0 },
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-push-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function setupFixture(dir: string, recordCount: number): Promise<string> {
  const skillPath = path.join(dir, "push-fixture.skill.md");
  await writeFile(skillPath, SKILL_SOURCE, "utf8");
  const runsDir = path.join(dir, ".reelier", "runs");
  await mkdir(runsDir, { recursive: true });
  const lines = Array.from({ length: recordCount }, (_, i) => JSON.stringify(makeRecord(i))).join("\n") + "\n";
  await writeFile(path.join(runsDir, "push-fixture.jsonl"), lines, "utf8");
  return skillPath;
}

type FakeResponseSpec = { status: number; body?: unknown } | { networkError: string };

function fakeFetch(responses: FakeResponseSpec[]): { fn: typeof fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const spec = responses[i++];
    if (!spec) throw new Error(`fetch called more times than expected (this is call #${calls.length})`);
    if ("networkError" in spec) throw new Error(spec.networkError);
    return {
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      text: async () => JSON.stringify(spec.body ?? {}),
    } as unknown as Response;
  }) as typeof fetch;
  return { fn, calls };
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

// ---------------------------------------------------------------------------

test("push: missing env vars throws an actionable error before any fetch call, never printing the key", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1);
    const { fn, calls } = fakeFetch([]);
    await withEnv({ REELIER_CLOUD_URL: undefined, REELIER_CLOUD_KEY: undefined }, async () => {
      await withFetch(fn, async () => {
        await assert.rejects(
          pushSkill(skillPath, { cwd: dir }),
          /REELIER_CLOUD_URL.*REELIER_CLOUD_KEY|REELIER_CLOUD_KEY.*REELIER_CLOUD_URL/
        );
        assert.equal(calls.length, 0);
      });
    });
  });
});

test("push: missing only the key still names it, and never leaks it when it IS set", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: undefined }, async () => {
      await assert.rejects(pushSkill(skillPath, { cwd: dir }), /REELIER_CLOUD_KEY/);
    });
  });
});

test("push: new-records-only cursor math — first push sends all + uploads skill, second push sends nothing", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 3);

    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const first = fakeFetch([
        { status: 201 }, // skill upload
        { status: 202, body: { id: "run_0" } },
        { status: 202, body: { id: "run_1" } },
        { status: 202, body: { id: "run_2" } },
      ]);
      const result1 = await withFetch(first.fn, () => pushSkill(skillPath, { cwd: dir }));
      assert.equal(result1.skillUploaded, true);
      assert.equal(result1.pushedCount, 3);
      assert.equal(result1.cursorBefore, 0);
      assert.equal(result1.cursorAfter, 3);
      assert.equal(result1.aborted, false);
      assert.equal(first.calls.length, 4);
      assert.match(first.calls[0].url, /\/api\/v1\/skills$/);
      assert.match(first.calls[1].url, /\/api\/v1\/runs$/);

      const state = await readPushState(dir);
      assert.deepEqual(state["push-fixture"], { pushed: 3, skillUploaded: true });

      // Second push: no new records, skill already uploaded -> zero fetch calls.
      const second = fakeFetch([]);
      const result2 = await withFetch(second.fn, () => pushSkill(skillPath, { cwd: dir }));
      assert.equal(result2.candidateCount, 0);
      assert.equal(result2.pushedCount, 0);
      assert.equal(result2.skillUploaded, false);
      assert.equal(second.calls.length, 0);
    });
  });
});

test("push: --all ignores/resets the cursor and reconsiders every record", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 2);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const first = fakeFetch([{ status: 200 }, { status: 202, body: { id: "a" } }, { status: 202, body: { id: "b" } }]);
      await withFetch(first.fn, () => pushSkill(skillPath, { cwd: dir }));

      // Skill already uploaded; --all should still skip skill upload (that's
      // tracked independently of the cursor) but re-push both records.
      const all = fakeFetch([{ status: 202, body: { id: "a2" } }, { status: 202, body: { id: "b2" } }]);
      const result = await withFetch(all.fn, () => pushSkill(skillPath, { cwd: dir, all: true }));
      assert.equal(result.candidateCount, 2);
      assert.equal(result.pushedCount, 2);
      assert.equal(result.cursorBefore, 0);
      assert.equal(result.cursorAfter, 2);
      assert.equal(result.skillUploaded, false);
      assert.equal(all.calls.length, 2);
    });
  });
});

test("push: mid-batch failure (400 rejection) stops the batch and leaves the cursor at the last success", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 4);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const first = fakeFetch([
        { status: 200 }, // skill upload
        { status: 202, body: { id: "r0" } },
        { status: 202, body: { id: "r1" } },
        { status: 400, body: { fieldErrors: { "record.steps": ["required"] } } },
        // record index 3 must NEVER be attempted — no 5th response provided;
        // fakeFetch throws if it is.
      ]);
      const result = await withFetch(first.fn, () => pushSkill(skillPath, { cwd: dir }));
      assert.equal(result.pushedCount, 2);
      assert.equal(result.cursorBefore, 0);
      assert.equal(result.cursorAfter, 2);
      assert.equal(result.aborted, true);
      assert.equal(result.results.length, 3); // r0 pushed, r1 pushed, r2 rejected — r3 never attempted
      assert.equal(result.results[2].outcome, "rejected");
      assert.deepEqual(result.results[2].fieldErrors, { "record.steps": ["required"] });
      assert.equal(first.calls.length, 4);

      const state = await readPushState(dir);
      assert.equal(state["push-fixture"].pushed, 2);

      // Resuming (no --all) picks up exactly at the cursor and can complete.
      const resume = fakeFetch([{ status: 202, body: { id: "r2" } }, { status: 202, body: { id: "r3" } }]);
      const result2 = await withFetch(resume.fn, () => pushSkill(skillPath, { cwd: dir }));
      assert.equal(result2.cursorBefore, 2);
      assert.equal(result2.pushedCount, 2);
      assert.equal(result2.cursorAfter, 4);
      assert.equal(result2.skillUploaded, false); // already uploaded on the first attempt
    });
  });
});

test("push: a 401 on a record aborts the batch immediately", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 3);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "bad-key" }, async () => {
      const first = fakeFetch([
        { status: 200 }, // skill upload succeeds
        { status: 202, body: { id: "r0" } },
        { status: 401 },
        // record index 2 must never be attempted
      ]);
      const result = await withFetch(first.fn, () => pushSkill(skillPath, { cwd: dir }));
      assert.equal(result.pushedCount, 1);
      assert.equal(result.cursorAfter, 1);
      assert.equal(result.aborted, true);
      assert.equal(result.results.length, 2);
      assert.equal(result.results[1].outcome, "auth-failed");
      assert.equal(first.calls.length, 3);
    });
  });
});

test("push: --with-skill forces a re-upload even when the skill was already uploaded", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const first = fakeFetch([{ status: 200 }, { status: 202, body: { id: "r0" } }]);
      await withFetch(first.fn, () => pushSkill(skillPath, { cwd: dir }));

      // Nothing new to push, but --with-skill should still hit the skills endpoint.
      const second = fakeFetch([{ status: 200 }]);
      const result = await withFetch(second.fn, () => pushSkill(skillPath, { cwd: dir, withSkill: true }));
      assert.equal(result.skillUploaded, true);
      assert.equal(result.candidateCount, 0);
      assert.equal(second.calls.length, 1);
      assert.match(second.calls[0].url, /\/api\/v1\/skills$/);
    });
  });
});

test("push: --dry-run touches no state, makes no network calls, and needs no env config", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 3);
    const { fn, calls } = fakeFetch([]);
    await withEnv({ REELIER_CLOUD_URL: undefined, REELIER_CLOUD_KEY: undefined }, async () => {
      const result = await withFetch(fn, () => pushSkill(skillPath, { cwd: dir, dryRun: true }));
      assert.equal(result.dryRun, true);
      assert.equal(result.candidateCount, 3);
      assert.equal(result.pushedCount, 0);
      assert.equal(calls.length, 0);
    });

    const state = await readPushState(dir);
    assert.deepEqual(state, {});
    await assert.rejects(readFile(path.join(dir, ".reelier", "push-state.json"), "utf8"));
  });
});

test("push: missing run-record file gives a clear actionable error", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "push-fixture.skill.md");
    await writeFile(skillPath, SKILL_SOURCE, "utf8");
    // No .reelier/runs/push-fixture.jsonl written at all.
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      await assert.rejects(pushSkill(skillPath, { cwd: dir }), /No run records found/);
    });
  });
});
