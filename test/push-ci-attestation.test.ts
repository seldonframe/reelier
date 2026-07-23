import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectCiOidc, detectPrHeadSha, pushSkill } from "../src/push.js";
import type { RunRecord } from "../src/runner.js";

// B3 — CI attestation (trust-ladder spec §5). GitHub Actions' own OIDC
// endpoint (ACTIONS_ID_TOKEN_REQUEST_URL/TOKEN) is zero-config in Actions;
// absent env -> nothing said (a laptop push is never shamed). Any failure
// (non-2xx, network error, malformed body) -> null + one stderr line, never
// blocks the push.

function fakeFetch(spec: { status?: number; body?: unknown; networkError?: string }): {
  fn: typeof fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    if (spec.networkError) throw new Error(spec.networkError);
    return {
      ok: (spec.status ?? 200) >= 200 && (spec.status ?? 200) < 300,
      status: spec.status ?? 200,
      text: async () => JSON.stringify(spec.body ?? {}),
    } as unknown as Response;
  }) as typeof fetch;
  return { fn, calls };
}

async function withCapturedStderr<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = ((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  }) as typeof console.error;
  try {
    const result = await run();
    return { result, lines };
  } finally {
    console.error = original;
  }
}

// detectPrHeadSha — the operator-asserted PR head sha for pull_request runs.
const A_SHA = "abc1230000000000000000000000000000000000";

test("detectPrHeadSha: pull_request event -> reads .pull_request.head.sha from the event payload", async () => {
  const readImpl = async (p: string) => {
    assert.equal(p, "/tmp/event.json");
    return JSON.stringify({ pull_request: { head: { sha: A_SHA } } });
  };
  const sha = await detectPrHeadSha(
    { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/tmp/event.json" } as NodeJS.ProcessEnv,
    readImpl,
  );
  assert.equal(sha, A_SHA);
});

test("detectPrHeadSha: pull_request_target is also honored", async () => {
  const sha = await detectPrHeadSha(
    { GITHUB_EVENT_NAME: "pull_request_target", GITHUB_EVENT_PATH: "/x" } as NodeJS.ProcessEnv,
    async () => JSON.stringify({ pull_request: { head: { sha: A_SHA } } }),
  );
  assert.equal(sha, A_SHA);
});

test("detectPrHeadSha: a non-pull_request event -> null (push receipts already carry the head as ciSha)", async () => {
  const sha = await detectPrHeadSha(
    { GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: "/x" } as NodeJS.ProcessEnv,
    async () => {
      throw new Error("must not read the event file for a push");
    },
  );
  assert.equal(sha, null);
});

test("detectPrHeadSha: absent event path, unreadable file, bad JSON, or non-40-hex sha -> null (fail-open)", async () => {
  assert.equal(await detectPrHeadSha({ GITHUB_EVENT_NAME: "pull_request" } as NodeJS.ProcessEnv, async () => "{}"), null);
  assert.equal(
    await detectPrHeadSha({ GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/x" } as NodeJS.ProcessEnv, async () => {
      throw new Error("ENOENT");
    }),
    null,
  );
  assert.equal(
    await detectPrHeadSha({ GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/x" } as NodeJS.ProcessEnv, async () => "not json"),
    null,
  );
  assert.equal(
    await detectPrHeadSha(
      { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/x" } as NodeJS.ProcessEnv,
      async () => JSON.stringify({ pull_request: { head: { sha: "SHORT" } } }),
    ),
    null,
  );
});

test("detectCiOidc: absent env -> null, no stderr output (never shames a laptop push)", async () => {
  const { fn } = fakeFetch({});
  const { result, lines } = await withCapturedStderr(() => detectCiOidc({}, fn));
  assert.equal(result, null);
  assert.deepEqual(lines, []);
});

test("detectCiOidc: present env -> GETs '<url>&audience=reelier.com' with the Bearer token, returns {provider,token}", async () => {
  const { fn, calls } = fakeFetch({ status: 200, body: { value: "the-jwt" } });
  const result = await detectCiOidc(
    {
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/token?api-version=2.0",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-token",
    } as NodeJS.ProcessEnv,
    fn
  );
  assert.deepEqual(result, { provider: "github-actions", token: "the-jwt" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://pipelines.actions.githubusercontent.com/token?api-version=2.0&audience=reelier.com");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer runner-token");
});

test("detectCiOidc: non-2xx response -> null + one stderr line, never throws", async () => {
  const { fn } = fakeFetch({ status: 500, body: {} });
  const { result, lines } = await withCapturedStderr(() =>
    detectCiOidc(
      { ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.com/token", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "t" } as NodeJS.ProcessEnv,
      fn
    )
  );
  assert.equal(result, null);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /WARNING/);
});

test("detectCiOidc: network error -> null + one stderr line, never throws", async () => {
  const { fn } = fakeFetch({ networkError: "ECONNRESET" });
  const { result, lines } = await withCapturedStderr(() =>
    detectCiOidc(
      { ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.com/token", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "t" } as NodeJS.ProcessEnv,
      fn
    )
  );
  assert.equal(result, null);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /ECONNRESET/);
});

test("detectCiOidc: malformed response body (no usable 'value') -> null + one stderr line", async () => {
  const { fn } = fakeFetch({ status: 200, body: { nope: true } });
  const { result, lines } = await withCapturedStderr(() =>
    detectCiOidc(
      { ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.com/token", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "t" } as NodeJS.ProcessEnv,
      fn
    )
  );
  assert.equal(result, null);
  assert.equal(lines.length, 1);
});

// ---------------------------------------------------------------------------
// Integration: pushSkill attaches ciAttestation to the payload.
// ---------------------------------------------------------------------------

const SKILL_SOURCE = `---
name: push-ci-fixture
description: a skill used to exercise CI attestation on push
---

### Step 1 — one
- intent: first step
- action: http.get {"url": "https://example.com/1"}
- assert: status == 200
- effect: read
`;

function makeRecord(n: number): RunRecord {
  return {
    skill: "push-ci-fixture",
    startedAt: `2026-07-22T00:00:0${n}.000Z`,
    finishedAt: `2026-07-22T00:00:0${n}.500Z`,
    passed: true,
    steps: [{ n: 1, title: "one", level: 0, outcome: "passed", ms: 5, failures: [] }],
    totals: { steps: 1, passed: 1, unchecked: 0, skipped: 0, failed: 0, ms: 5, llmInputTokens: 0, llmOutputTokens: 0 },
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-push-ci-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function setupFixture(dir: string): Promise<string> {
  const skillPath = path.join(dir, "push-ci-fixture.skill.md");
  await writeFile(skillPath, SKILL_SOURCE, "utf8");
  const runsDir = path.join(dir, ".reelier", "runs");
  await mkdir(runsDir, { recursive: true });
  await writeFile(path.join(runsDir, "push-ci-fixture.jsonl"), JSON.stringify(makeRecord(0)) + "\n", "utf8");
  return skillPath;
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

test("pushSkill: no CI env -> the payload omits ciAttestation entirely", async () => {
  await withTempDir(async (home) => {
    await withTempDir(async (dir) => {
      const skillPath = await setupFixture(dir);
      const calls: { url: string; init: RequestInit }[] = [];
      let i = 0;
      const responses = [{ status: 200, body: {} }, { status: 202, body: { id: "r1" } }];
      const fetchFn = (async (url: string, init?: RequestInit) => {
        calls.push({ url, init: init ?? {} });
        const spec = responses[i++];
        return { ok: true, status: spec.status, text: async () => JSON.stringify(spec.body) } as unknown as Response;
      }) as typeof fetch;

      await withEnv(
        {
          REELIER_CLOUD_URL: "https://cloud.example",
          REELIER_CLOUD_KEY: "test-key",
          HOME: home,
          USERPROFILE: home,
          ACTIONS_ID_TOKEN_REQUEST_URL: undefined,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: undefined,
        },
        () => withFetch(fetchFn, () => pushSkill(skillPath, { cwd: dir }))
      );

      const runsCall = calls.find((c) => c.url.endsWith("/api/v1/runs"));
      assert.ok(runsCall);
      const body = JSON.parse(runsCall!.init.body as string);
      assert.equal(body.ciAttestation, undefined);
    });
  });
});

test("pushSkill: CI env present -> the payload carries ciAttestation:{provider:'github-actions',token}", async () => {
  await withTempDir(async (home) => {
    await withTempDir(async (dir) => {
      const skillPath = await setupFixture(dir);
      const calls: { url: string; init: RequestInit }[] = [];
      let i = 0;
      const responses = [
        { url: "oidc", status: 200, body: { value: "jwt-from-github" } },
        { url: "skill-upload", status: 200, body: {} },
        { url: "runs", status: 202, body: { id: "r1" } },
      ];
      const fetchFn = (async (url: string, init?: RequestInit) => {
        calls.push({ url, init: init ?? {} });
        const spec = responses[i++];
        return { ok: true, status: spec.status, text: async () => JSON.stringify(spec.body) } as unknown as Response;
      }) as typeof fetch;

      await withEnv(
        {
          REELIER_CLOUD_URL: "https://cloud.example",
          REELIER_CLOUD_KEY: "test-key",
          HOME: home,
          USERPROFILE: home,
          ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/token?api-version=2.0",
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-token",
        },
        () => withFetch(fetchFn, () => pushSkill(skillPath, { cwd: dir }))
      );

      const runsCall = calls.find((c) => c.url.includes("/api/v1/runs"));
      assert.ok(runsCall);
      const body = JSON.parse(runsCall!.init.body as string);
      assert.deepEqual(body.ciAttestation, { provider: "github-actions", token: "jwt-from-github" });
    });
  });
});
