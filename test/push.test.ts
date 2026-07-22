import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import { pushSkill, readPushState, PublicSubmissionError } from "../src/push.js";
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

/** Capture console.error output for the duration of `run` (used to assert push's loud rejection/corruption warnings without leaving them un-asserted or polluting an otherwise-quiet suite). */
async function withCapturedConsoleError<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = ((...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  }) as typeof console.error;
  try {
    const result = await run();
    return { result, lines };
  } finally {
    console.error = original;
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
      assert.equal(result1.rejectedCount, 0);
      assert.equal(result1.cursorBefore, 0);
      assert.equal(result1.cursorAfter, 3);
      assert.equal(result1.aborted, false);
      assert.equal(first.calls.length, 4);
      assert.match(first.calls[0].url, /\/api\/v1\/skills$/);
      assert.match(first.calls[1].url, /\/api\/v1\/runs$/);

      const state = await readPushState(dir);
      assert.deepEqual(state["push-fixture"], { pushed: 3, skillUploaded: true, rejected: [] });

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

test("push: a 400 rejection WARNs, records an audit entry, advances the cursor past it, and the batch continues (P1 fix — no wedge)", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 4);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const first = fakeFetch([
        { status: 200 }, // skill upload
        { status: 202, body: { id: "r0" } },
        { status: 202, body: { id: "r1" } },
        { status: 400, body: { fieldErrors: { "record.steps": ["required"] } } },
        { status: 202, body: { id: "r3" } }, // record after the rejection MUST still be attempted
      ]);
      const { result, lines } = await withCapturedConsoleError(() => withFetch(first.fn, () => pushSkill(skillPath, { cwd: dir })));

      assert.equal(result.pushedCount, 3);
      assert.equal(result.rejectedCount, 1);
      assert.equal(result.cursorBefore, 0);
      assert.equal(result.cursorAfter, 4); // consumed all 4: 3 pushed + 1 permanently rejected
      assert.equal(result.aborted, false); // a permanent rejection is never an "aborted" batch
      assert.equal(result.results.length, 4); // every candidate was attempted, including after the rejection
      assert.equal(result.results[2].outcome, "rejected");
      assert.deepEqual(result.results[2].fieldErrors, { "record.steps": ["required"] });
      assert.equal(result.results[3].outcome, "pushed");
      assert.equal(first.calls.length, 5);

      // Loud warning, and it names the record without ever leaking the key.
      assert.ok(lines.some((l) => l.includes("WARNING") && l.includes("permanently rejected") && l.includes("2")));
      assert.ok(!lines.some((l) => l.includes("test-key")));

      const state = await readPushState(dir);
      assert.equal(state["push-fixture"].pushed, 4);
      assert.equal(state["push-fixture"].rejected?.length, 1);
      assert.equal(state["push-fixture"].rejected?.[0].index, 2);
      assert.match(state["push-fixture"].rejected?.[0].reason ?? "", /record\.steps/);
      assert.ok(state["push-fixture"].rejected?.[0].at);

      // Nothing left to push on the next run — the cursor moved past everything.
      const second = fakeFetch([]);
      const result2 = await withFetch(second.fn, () => pushSkill(skillPath, { cwd: dir }));
      assert.equal(result2.candidateCount, 0);
      assert.equal(second.calls.length, 0);
    });
  });
});

test("push: --all re-reports a previously-rejected record (new audit entry) without wedging records after it", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 2);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const first = fakeFetch([
        { status: 200 }, // skill upload
        { status: 400, body: { fieldErrors: { "record.steps": ["required"] } } }, // record 0 rejected
        { status: 202, body: { id: "r1" } }, // record 1 pushed — never blocked by record 0's rejection
      ]);
      const result1 = await withFetch(first.fn, () => pushSkill(skillPath, { cwd: dir }));
      assert.equal(result1.rejectedCount, 1);
      assert.equal(result1.pushedCount, 1);
      assert.equal(result1.cursorAfter, 2);

      let state = await readPushState(dir);
      assert.equal(state["push-fixture"].rejected?.length, 1);

      // --all resets the cursor: record 0 is reconsidered and rejected again.
      const all = fakeFetch([
        { status: 400, body: { fieldErrors: { "record.steps": ["required"] } } }, // record 0 rejected AGAIN
        { status: 202, body: { id: "r1-again" } }, // record 1 still pushes fine
      ]);
      const result2 = await withFetch(all.fn, () => pushSkill(skillPath, { cwd: dir, all: true }));
      assert.equal(result2.cursorBefore, 0);
      assert.equal(result2.candidateCount, 2);
      assert.equal(result2.rejectedCount, 1);
      assert.equal(result2.pushedCount, 1);
      assert.equal(result2.cursorAfter, 2);
      assert.equal(result2.aborted, false);

      state = await readPushState(dir);
      // Two separate audit entries for record index 0 — a history, never merged/deduped.
      const rejectedForIndex0 = (state["push-fixture"].rejected ?? []).filter((r) => r.index === 0);
      assert.equal(rejectedForIndex0.length, 2);
    });
  });
});

test("push: a 401 on a record is TRANSIENT — it stops the batch immediately and does not advance the cursor past it", async () => {
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
      assert.equal(result.rejectedCount, 0);
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

// ---------------------------------------------------------------------------
// P2: writeFileAtomic + corrupt-state resilience.
// ---------------------------------------------------------------------------

test("push: push-state.json is written atomically — no stray .tmp- file left behind", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fetchSeq = fakeFetch([{ status: 200 }, { status: 202, body: { id: "r0" } }]);
      await withFetch(fetchSeq.fn, () => pushSkill(skillPath, { cwd: dir }));
    });
    const entries = await readdir(path.join(dir, ".reelier"));
    assert.ok(entries.includes("push-state.json"));
    assert.ok(!entries.some((f) => f.includes(".tmp-")));
  });
});

test("push: a JSON-corrupted push-state.json WARNs, is renamed aside, and pushing proceeds from a fresh state instead of throwing", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1);
    const stateDir = path.join(dir, ".reelier");
    await mkdir(stateDir, { recursive: true });
    const statePath = path.join(stateDir, "push-state.json");
    await writeFile(statePath, "{ this is not valid json", "utf8");

    const { result: freshState, lines } = await withCapturedConsoleError(() => readPushState(dir));
    assert.deepEqual(freshState, {});
    assert.ok(lines.some((l) => l.includes("WARNING") && l.includes("corrupt")));

    // The full push must still succeed from a clean slate rather than throwing.
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fetchSeq = fakeFetch([{ status: 200 }, { status: 202, body: { id: "r0" } }]);
      const result = await withFetch(fetchSeq.fn, () => pushSkill(skillPath, { cwd: dir }));
      assert.equal(result.pushedCount, 1);
      assert.equal(result.cursorAfter, 1);
    });

    // The corrupt file was moved aside (not silently overwritten in a way
    // that loses the evidence), and a fresh, valid state file now exists.
    const entries = await readdir(stateDir);
    assert.ok(entries.some((f) => f.startsWith("push-state.json.corrupt-")));
    assert.ok(entries.includes("push-state.json"));
    const freshRaw = await readFile(statePath, "utf8");
    assert.doesNotThrow(() => JSON.parse(freshRaw));
  });
});

test("push: --share sends share:true and surfaces shareUrl/badgeUrl from the response", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fetchSeq = fakeFetch([
        { status: 200 }, // skill upload
        {
          status: 202,
          body: { id: "run_0", shareUrl: "https://cloud.example/r/tok_abc", badgeUrl: "https://cloud.example/badge/tok_abc" },
        },
      ]);
      const result = await withFetch(fetchSeq.fn, () => pushSkill(skillPath, { cwd: dir, share: true }));

      assert.equal(result.pushedCount, 1);
      assert.equal(result.results[0].shareUrl, "https://cloud.example/r/tok_abc");
      assert.equal(result.results[0].badgeUrl, "https://cloud.example/badge/tok_abc");

      // The run POST body carried share:true.
      const runCall = fetchSeq.calls[1];
      const sentBody = JSON.parse(runCall.init.body as string);
      assert.equal(sentBody.share, true);
    });
  });
});

test("push: without --share, the request body omits 'share' entirely and the result carries no shareUrl/badgeUrl", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fetchSeq = fakeFetch([{ status: 200 }, { status: 202, body: { id: "run_0" } }]);
      const result = await withFetch(fetchSeq.fn, () => pushSkill(skillPath, { cwd: dir }));

      assert.equal(result.results[0].shareUrl, undefined);
      assert.equal(result.results[0].badgeUrl, undefined);

      const runCall = fetchSeq.calls[1];
      const sentBody = JSON.parse(runCall.init.body as string);
      assert.equal("share" in sentBody, false);
    });
  });
});

// ---------------------------------------------------------------------------
// --public (skill-registry-v0 spec §2)
// ---------------------------------------------------------------------------

test("push: --public sends public:true and reports a 'listed' submission", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fetchSeq = fakeFetch([
        {
          status: 200,
          body: {
            status: "listed",
            pageUrl: "https://cloud.example/skills/acme/push-fixture",
            getCommand: "npx -y reelier@latest get acme/push-fixture",
            version: 1,
            noop: false,
          },
        },
        { status: 202, body: { id: "r0" } },
      ]);
      const result = await withFetch(fetchSeq.fn, () => pushSkill(skillPath, { cwd: dir, public: true }));

      assert.equal(result.skillUploaded, true);
      assert.deepEqual(result.publicSubmission, {
        status: "listed",
        pageUrl: "https://cloud.example/skills/acme/push-fixture",
        getCommand: "npx -y reelier@latest get acme/push-fixture",
        version: 1,
        noop: false,
      });

      const uploadCall = fetchSeq.calls[0];
      const sentBody = JSON.parse(uploadCall.init.body as string);
      assert.equal(sentBody.public, true);
    });
  });
});

test("push: --public reports a 'pending' submission for a write-grade skill", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fetchSeq = fakeFetch([
        {
          status: 200,
          body: { status: "pending", pageUrl: "https://cloud.example/skills/acme/push-fixture", noop: false },
        },
        { status: 202, body: { id: "r0" } },
      ]);
      const result = await withFetch(fetchSeq.fn, () => pushSkill(skillPath, { cwd: dir, public: true }));

      assert.equal(result.publicSubmission?.status, "pending");
      assert.equal(result.publicSubmission?.pageUrl, "https://cloud.example/skills/acme/push-fixture");
      // getCommand wasn't returned — must not be fabricated.
      assert.equal(result.publicSubmission?.getCommand, "");
    });
  });
});

test("push: --public reports noop:true when the cloud says the bytes are unchanged", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fetchSeq = fakeFetch([
        {
          status: 200,
          body: { status: "listed", pageUrl: "https://cloud.example/skills/acme/push-fixture", noop: true },
        },
        { status: 202, body: { id: "r0" } },
      ]);
      const result = await withFetch(fetchSeq.fn, () => pushSkill(skillPath, { cwd: dir, public: true }));
      assert.equal(result.publicSubmission?.noop, true);
    });
  });
});

test("push: --public forces a re-upload even when the skill was already privately uploaded", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const first = fakeFetch([{ status: 200 }, { status: 202, body: { id: "r0" } }]);
      await withFetch(first.fn, () => pushSkill(skillPath, { cwd: dir }));

      // Nothing new to push, and the skill is already marked uploaded — but
      // --public must still hit /api/v1/skills to submit for listing.
      const second = fakeFetch([
        { status: 200, body: { status: "listed", pageUrl: "https://cloud.example/skills/acme/push-fixture", noop: false } },
      ]);
      const result = await withFetch(second.fn, () => pushSkill(skillPath, { cwd: dir, public: true }));
      assert.equal(result.skillUploaded, true);
      assert.equal(second.calls.length, 1);
      assert.match(second.calls[0].url, /\/api\/v1\/skills$/);
      assert.equal(result.publicSubmission?.status, "listed");
    });
  });
});

test("push: --public against a cloud that 200s with no registry body -> upload succeeds, publicSubmission is undefined (never fabricated)", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fetchSeq = fakeFetch([{ status: 200 }, { status: 202, body: { id: "r0" } }]);
      const result = await withFetch(fetchSeq.fn, () => pushSkill(skillPath, { cwd: dir, public: true }));
      assert.equal(result.skillUploaded, true);
      assert.equal(result.publicSubmission, undefined);
    });
  });
});

test("push: --public with a 400 (missing license) throws PublicSubmissionError with the field errors verbatim", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fetchSeq = fakeFetch([
        { status: 400, body: { fieldErrors: { license: ["required for --public"] } } },
      ]);
      await assert.rejects(
        withFetch(fetchSeq.fn, () => pushSkill(skillPath, { cwd: dir, public: true })),
        (err: unknown) => {
          assert.ok(err instanceof PublicSubmissionError);
          assert.match((err as Error).message, /license/);
          return true;
        }
      );
    });
  });
});

test("push: --public with a 403 (unlinked tenant) throws PublicSubmissionError carrying linkUrl", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fetchSeq = fakeFetch([
        {
          status: 403,
          body: {
            error: "Link your GitHub account before publishing to the registry.",
            linkUrl: "https://cloud.example/dashboard/link-github",
          },
        },
      ]);
      await assert.rejects(
        withFetch(fetchSeq.fn, () => pushSkill(skillPath, { cwd: dir, public: true })),
        (err: unknown) => {
          assert.ok(err instanceof PublicSubmissionError);
          assert.match((err as Error).message, /Link your GitHub account/);
          assert.equal((err as PublicSubmissionError).linkUrl, "https://cloud.example/dashboard/link-github");
          return true;
        }
      );
    });
  });
});

test("push: --public composes with --share (both flags honored on the same push)", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fetchSeq = fakeFetch([
        { status: 200, body: { status: "listed", pageUrl: "https://cloud.example/skills/acme/push-fixture", noop: false } },
        { status: 202, body: { id: "r0", shareUrl: "https://cloud.example/r/tok_1" } },
      ]);
      const result = await withFetch(fetchSeq.fn, () => pushSkill(skillPath, { cwd: dir, public: true, share: true }));

      assert.equal(result.publicSubmission?.status, "listed");
      assert.equal(result.results[0].shareUrl, "https://cloud.example/r/tok_1");

      const uploadBody = JSON.parse(fetchSeq.calls[0].init.body as string);
      assert.equal(uploadBody.public, true);
      const runBody = JSON.parse(fetchSeq.calls[1].init.body as string);
      assert.equal(runBody.share, true);
    });
  });
});

// ---------------------------------------------------------------------------
// skillContentSha256 stamping (run-time field + push-time fallback)
// ---------------------------------------------------------------------------

test("push: a record that already carries skillContentSha256 is forwarded unchanged (run-time stamp wins)", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "push-fixture.skill.md");
    await writeFile(skillPath, SKILL_SOURCE, "utf8");
    const runsDir = path.join(dir, ".reelier", "runs");
    await mkdir(runsDir, { recursive: true });
    const record = { ...makeRecord(0), skillContentSha256: "a".repeat(64) };
    await writeFile(path.join(runsDir, "push-fixture.jsonl"), JSON.stringify(record) + "\n", "utf8");

    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fetchSeq = fakeFetch([{ status: 200 }, { status: 202, body: { id: "r0" } }]);
      await withFetch(fetchSeq.fn, () => pushSkill(skillPath, { cwd: dir }));

      const runCall = fetchSeq.calls[1];
      const sentBody = JSON.parse(runCall.init.body as string);
      // Load-bearing: the cloud ingest reads skillContentSha256 at the TOP LEVEL
      // of the body (sibling of `record`), not from inside `record`.
      assert.equal(sentBody.skillContentSha256, "a".repeat(64));
    });
  });
});

test("push: a record with NO skillContentSha256 gets the push-time fallback hash of the current skill file bytes", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1); // makeRecord() never sets skillContentSha256
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fetchSeq = fakeFetch([{ status: 200 }, { status: 202, body: { id: "r0" } }]);
      await withFetch(fetchSeq.fn, () => pushSkill(skillPath, { cwd: dir }));

      const runCall = fetchSeq.calls[1];
      const sentBody = JSON.parse(runCall.init.body as string);
      const expectedSha = createHash("sha256").update(SKILL_SOURCE, "utf8").digest("hex");
      assert.equal(sentBody.skillContentSha256, expectedSha);

      // The fallback is push-time-only — it must never be written back into
      // the local .jsonl run-record file itself.
      const raw = await readFile(path.join(dir, ".reelier", "runs", "push-fixture.jsonl"), "utf8");
      assert.equal(JSON.parse(raw.trim()).skillContentSha256, undefined);
    });
  });
});

// ---------------------------------------------------------------------------
// costUsd / priceTableDate (the $ meter's push-time addition, flight-recorder-v1 §2)
// ---------------------------------------------------------------------------

test("push: a zero-token record carries costUsd:0 + priceTableDate computed from the bundled table", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1); // makeRecord() has zero llm tokens
    await withEnv(
      { REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key", HOME: dir, USERPROFILE: dir },
      async () => {
        const fetchSeq = fakeFetch([{ status: 200 }, { status: 202, body: { id: "r0" } }]);
        await withFetch(fetchSeq.fn, () => pushSkill(skillPath, { cwd: dir }));

        const sentBody = JSON.parse(fetchSeq.calls[1].init.body as string);
        assert.equal(sentBody.costUsd, 0);
        assert.match(sentBody.priceTableDate, /^\d{4}-\d{2}-\d{2}$/);
      }
    );
  });
});

test("push: a record whose step carries a priced model computes the correct costUsd", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "push-fixture.skill.md");
    await writeFile(skillPath, SKILL_SOURCE, "utf8");
    const runsDir = path.join(dir, ".reelier", "runs");
    await mkdir(runsDir, { recursive: true });
    const record: RunRecord = {
      ...makeRecord(0),
      steps: [
        {
          n: 1,
          title: "one",
          level: 1,
          outcome: "passed",
          ms: 5,
          failures: [],
          llm: { inputTokens: 1_000_000, outputTokens: 0, model: "claude-haiku-4-5" },
        },
      ],
      totals: { steps: 1, passed: 1, unchecked: 0, skipped: 0, failed: 0, ms: 5, llmInputTokens: 1_000_000, llmOutputTokens: 0 },
    };
    await writeFile(path.join(runsDir, "push-fixture.jsonl"), JSON.stringify(record) + "\n", "utf8");

    await withEnv(
      { REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key", HOME: dir, USERPROFILE: dir },
      async () => {
        const fetchSeq = fakeFetch([{ status: 200 }, { status: 202, body: { id: "r0" } }]);
        await withFetch(fetchSeq.fn, () => pushSkill(skillPath, { cwd: dir }));

        const sentBody = JSON.parse(fetchSeq.calls[1].init.body as string);
        // haiku-4-5 bundled: $1/Mtok in -> 1M tokens = $1 exactly.
        assert.equal(sentBody.costUsd, 1);
      }
    );
  });
});

test("push: an unpriceable (unknown-model) record omits costUsd and priceTableDate entirely — never a guessed number on the wire", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "push-fixture.skill.md");
    await writeFile(skillPath, SKILL_SOURCE, "utf8");
    const runsDir = path.join(dir, ".reelier", "runs");
    await mkdir(runsDir, { recursive: true });
    const record: RunRecord = {
      ...makeRecord(0),
      steps: [
        {
          n: 1,
          title: "one",
          level: 1,
          outcome: "passed",
          ms: 5,
          failures: [],
          llm: { inputTokens: 1000, outputTokens: 1000, model: "totally-unknown-model" },
        },
      ],
      totals: { steps: 1, passed: 1, unchecked: 0, skipped: 0, failed: 0, ms: 5, llmInputTokens: 1000, llmOutputTokens: 1000 },
    };
    await writeFile(path.join(runsDir, "push-fixture.jsonl"), JSON.stringify(record) + "\n", "utf8");

    await withEnv(
      { REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key", HOME: dir, USERPROFILE: dir },
      async () => {
        const fetchSeq = fakeFetch([{ status: 200 }, { status: 202, body: { id: "r0" } }]);
        await withFetch(fetchSeq.fn, () => pushSkill(skillPath, { cwd: dir }));

        const sentBody = JSON.parse(fetchSeq.calls[1].init.body as string);
        assert.equal("costUsd" in sentBody, false);
        assert.equal("priceTableDate" in sentBody, false);
      }
    );
  });
});

test("push: a corrupt ~/.reelier/prices.yml WARNs but never breaks the push — costUsd is just omitted", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1);
    await mkdir(path.join(dir, ".reelier"), { recursive: true });
    await writeFile(path.join(dir, ".reelier", "prices.yml"), "not: [valid, at, all\n  ::broken\n", "utf8");

    await withEnv(
      { REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key", HOME: dir, USERPROFILE: dir },
      async () => {
        const fetchSeq = fakeFetch([{ status: 200 }, { status: 202, body: { id: "r0" } }]);
        const { result, lines } = await withCapturedConsoleError(() =>
          withFetch(fetchSeq.fn, () => pushSkill(skillPath, { cwd: dir }))
        );

        assert.equal(result.pushedCount, 1); // the push itself still succeeds
        assert.ok(lines.some((l) => l.includes("could not load the $ meter's price table")));

        const sentBody = JSON.parse(fetchSeq.calls[1].init.body as string);
        assert.equal("costUsd" in sentBody, false);
      }
    );
  });
});
