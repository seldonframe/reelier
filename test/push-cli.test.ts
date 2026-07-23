import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdPush, type ParsedArgs } from "../src/cli.js";

// Exercises cmdPush's console output directly (rather than spawning a real
// subprocess against a real HTTP server) — see the export note on
// ParsedArgs/cmdPush in cli.ts. Fixture/fake-fetch helpers mirror
// test/push.test.ts's, kept minimal and local to this file rather than
// shared, since cli.ts and push.ts are tested at different layers.

const SKILL_SOURCE = `---
name: push-cli-fixture
description: a skill used to exercise cmdPush's console output
---

### Step 1 — one
- intent: first step
- action: http.get {"url": "https://example.com/1"}
- assert: status == 200
- effect: read
`;

function makeRecord(n: number) {
  return {
    skill: "push-cli-fixture",
    startedAt: `2026-07-22T00:00:0${n}.000Z`,
    finishedAt: `2026-07-22T00:00:0${n}.500Z`,
    passed: true,
    steps: [{ n: 1, title: "one", level: 0, outcome: "passed", ms: 5, failures: [] }],
    totals: { steps: 1, passed: 1, unchecked: 0, skipped: 0, failed: 0, ms: 5, llmInputTokens: 0, llmOutputTokens: 0 },
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-push-cli-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function setupFixture(dir: string): Promise<string> {
  const skillPath = path.join(dir, "push-cli-fixture.skill.md");
  await writeFile(skillPath, SKILL_SOURCE, "utf8");
  const runsDir = path.join(dir, ".reelier", "runs");
  await mkdir(runsDir, { recursive: true });
  await writeFile(path.join(runsDir, "push-cli-fixture.jsonl"), JSON.stringify(makeRecord(0)) + "\n", "utf8");
  return skillPath;
}

type FakeResponseSpec = { status: number; body?: unknown };

function fakeFetch(responses: FakeResponseSpec[]): typeof fetch {
  let i = 0;
  return (async () => {
    const spec = responses[i++];
    if (!spec) throw new Error(`fetch called more times than expected (call #${i})`);
    return {
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      text: async () => JSON.stringify(spec.body ?? {}),
    } as unknown as Response;
  }) as typeof fetch;
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

async function withCwd<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const original = process.cwd();
  process.chdir(dir);
  try {
    return await run();
  } finally {
    process.chdir(original);
  }
}

async function withCapturedLogs<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const originalLog = console.log;
  const originalError = console.error;
  const lines: string[] = [];
  console.log = ((...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  }) as typeof console.log;
  console.error = console.log;
  try {
    const result = await run();
    return { result, lines };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function makeArgs(skillPath: string, flags: string[]): ParsedArgs {
  return { positional: [skillPath], flags: new Set(flags), vars: {}, wraps: [], opts: {}, fails: [] };
}

test("cmdPush --share: the cloud returns a shareUrl -> 'Receipt:' + badge markdown print, no fallback notice", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fn = fakeFetch([
        { status: 200 }, // skill upload
        {
          status: 202,
          body: { id: "run_0", shareUrl: "https://cloud.example/r/tok_1", badgeUrl: "https://cloud.example/badge/tok_1" },
        },
      ]);
      const { result: exitCode, lines } = await withCapturedLogs(() =>
        withCwd(dir, () => withFetch(fn, () => cmdPush(makeArgs(skillPath, ["share"]))))
      );

      assert.equal(exitCode, 0);
      assert.ok(lines.some((l) => l === "    Receipt: https://cloud.example/r/tok_1"));
      assert.ok(
        lines.some((l) => l === "    [![reelier](https://cloud.example/badge/tok_1)](https://cloud.example/r/tok_1)")
      );
      assert.ok(!lines.some((l) => l.includes("share requested, but the cloud returned no receipt link")));
      assert.ok(!lines.some((l) => l.includes("tip: add --share")));
    });
  });
});

test("cmdPush --share: the cloud accepts the push but returns no shareUrl (older cloud/mint failure) -> explicit notice + Dashboard/tip fallback, never a silent success", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fn = fakeFetch([
        { status: 200 }, // skill upload
        { status: 202, body: { id: "run_0" } }, // no shareUrl/badgeUrl at all
      ]);
      const { result: exitCode, lines } = await withCapturedLogs(() =>
        withCwd(dir, () => withFetch(fn, () => cmdPush(makeArgs(skillPath, ["share"]))))
      );

      assert.equal(exitCode, 0);
      assert.ok(!lines.some((l) => l.includes("Receipt:")));
      assert.ok(
        lines.some((l) => l === "share requested, but the cloud returned no receipt link (older cloud or share failure)")
      );
      assert.ok(lines.some((l) => l === "Dashboard: https://cloud.example/dashboard/runs"));
      assert.ok(lines.some((l) => l === "  tip: add --share for a public receipt link"));
    });
  });
});

test("cmdPush without --share: prints the Dashboard/tip fallback, never a Receipt line", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fn = fakeFetch([{ status: 200 }, { status: 202, body: { id: "run_0" } }]);
      const { result: exitCode, lines } = await withCapturedLogs(() =>
        withCwd(dir, () => withFetch(fn, () => cmdPush(makeArgs(skillPath, []))))
      );

      assert.equal(exitCode, 0);
      assert.ok(!lines.some((l) => l.includes("Receipt:")));
      assert.ok(!lines.some((l) => l.includes("share requested")));
      assert.ok(lines.some((l) => l === "Dashboard: https://cloud.example/dashboard/runs"));
      assert.ok(lines.some((l) => l === "  tip: add --share for a public receipt link"));
    });
  });
});

// ---------------------------------------------------------------------------
// --public (skill-registry-v0 spec §2)
// ---------------------------------------------------------------------------

test("cmdPush --public: status 'listed' prints 'Listed: <pageUrl>' then '  get: <getCommand>'", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fn = fakeFetch([
        {
          status: 200,
          body: {
            status: "listed",
            pageUrl: "https://cloud.example/skills/acme/push-cli-fixture",
            getCommand: "npx -y reelier@latest get acme/push-cli-fixture",
            noop: false,
          },
        },
        { status: 202, body: { id: "run_0" } },
      ]);
      const { result: exitCode, lines } = await withCapturedLogs(() =>
        withCwd(dir, () => withFetch(fn, () => cmdPush(makeArgs(skillPath, ["public"]))))
      );

      assert.equal(exitCode, 0);
      assert.ok(lines.some((l) => l === "Listed: https://cloud.example/skills/acme/push-cli-fixture"));
      assert.ok(lines.some((l) => l === "  get: npx -y reelier@latest get acme/push-cli-fixture"));
    });
  });
});

test("cmdPush --public: status 'pending' prints the exact 2-business-day copy, never a same-day promise", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fn = fakeFetch([
        {
          status: 200,
          body: { status: "pending", pageUrl: "https://cloud.example/skills/acme/push-cli-fixture", noop: false },
        },
        { status: 202, body: { id: "run_0" } },
      ]);
      const { result: exitCode, lines } = await withCapturedLogs(() =>
        withCwd(dir, () => withFetch(fn, () => cmdPush(makeArgs(skillPath, ["public"]))))
      );

      assert.equal(exitCode, 0);
      assert.ok(
        lines.some(
          (l) =>
            l ===
            "Pending review (usually within 2 business days): https://cloud.example/skills/acme/push-cli-fixture"
        )
      );
      assert.ok(!lines.some((l) => l.toLowerCase().includes("same day") || l.toLowerCase().includes("same-day")));
    });
  });
});

test("cmdPush --public: noop true prints 'Already listed (unchanged): <pageUrl>'", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fn = fakeFetch([
        {
          status: 200,
          body: { status: "listed", pageUrl: "https://cloud.example/skills/acme/push-cli-fixture", noop: true },
        },
        { status: 202, body: { id: "run_0" } },
      ]);
      const { result: exitCode, lines } = await withCapturedLogs(() =>
        withCwd(dir, () => withFetch(fn, () => cmdPush(makeArgs(skillPath, ["public"]))))
      );

      assert.equal(exitCode, 0);
      assert.ok(lines.some((l) => l === "Already listed (unchanged): https://cloud.example/skills/acme/push-cli-fixture"));
      assert.ok(!lines.some((l) => l.startsWith("Listed:")));
    });
  });
});

test("cmdPush --public: missing license -> the cloud's 400 message is surfaced verbatim and the command exits non-zero", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fn = fakeFetch([
        { status: 400, body: { fieldErrors: { license: ["required for --public"] } } },
      ]);
      const { result: exitCode, lines } = await withCapturedLogs(() =>
        withCwd(dir, () => withFetch(fn, () => cmdPush(makeArgs(skillPath, ["public"]))))
      );

      assert.equal(exitCode, 1);
      assert.ok(lines.some((l) => l.includes("license")));
      // Never claim a listing happened when the upload was rejected.
      assert.ok(!lines.some((l) => l.startsWith("Listed:") || l.startsWith("Pending review")));
    });
  });
});

test("cmdPush --public: 403 (reserved namespace / unlinked tenant) surfaces the server's message + linkUrl and exits non-zero", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fn = fakeFetch([
        {
          status: 403,
          body: {
            error: "Link your GitHub account before publishing to the registry.",
            linkUrl: "https://cloud.example/dashboard/link-github",
          },
        },
      ]);
      const { result: exitCode, lines } = await withCapturedLogs(() =>
        withCwd(dir, () => withFetch(fn, () => cmdPush(makeArgs(skillPath, ["public"]))))
      );

      assert.equal(exitCode, 1);
      assert.ok(lines.some((l) => l.includes("Link your GitHub account")));
      assert.ok(lines.some((l) => l.includes("https://cloud.example/dashboard/link-github")));
    });
  });
});

test("cmdPush --public --share: both a registry line and a Receipt line print", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir);
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      const fn = fakeFetch([
        {
          status: 200,
          body: { status: "listed", pageUrl: "https://cloud.example/skills/acme/push-cli-fixture", noop: false },
        },
        { status: 202, body: { id: "run_0", shareUrl: "https://cloud.example/r/tok_1" } },
      ]);
      const { result: exitCode, lines } = await withCapturedLogs(() =>
        withCwd(dir, () => withFetch(fn, () => cmdPush(makeArgs(skillPath, ["public", "share"]))))
      );

      assert.equal(exitCode, 0);
      assert.ok(lines.some((l) => l === "Listed: https://cloud.example/skills/acme/push-cli-fixture"));
      assert.ok(lines.some((l) => l === "    Receipt: https://cloud.example/r/tok_1"));
    });
  });
});

// ---------------------------------------------------------------------------
// Task 11: cmdPush surfaces the mock-run refusal exactly like any other
// pushSkill error — exit 1, message printed, no fetch call.
// ---------------------------------------------------------------------------

test("cmdPush: refuses a mock run — exit 1, message printed, no fetch call", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "push-cli-fixture.skill.md");
    await writeFile(skillPath, SKILL_SOURCE, "utf8");
    const runsDir = path.join(dir, ".reelier", "runs");
    await mkdir(runsDir, { recursive: true });
    const mockRecord = { ...makeRecord(0), mockFailures: [1] };
    await writeFile(path.join(runsDir, "push-cli-fixture.jsonl"), JSON.stringify(mockRecord) + "\n", "utf8");

    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, async () => {
      let fetchCalled = false;
      const fn = (async () => {
        fetchCalled = true;
        throw new Error("fetch must never be called");
      }) as typeof fetch;
      const { result: exitCode, lines } = await withCapturedLogs(() =>
        withCwd(dir, () => withFetch(fn, () => cmdPush(makeArgs(skillPath, []))))
      );

      assert.equal(exitCode, 1);
      assert.ok(lines.some((l) => /refusing to push a mock run \(injected failures at step\(s\): 1\)/.test(l)));
      assert.equal(fetchCalled, false);
    });
  });
});
