import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pushSkill } from "../src/push.js";
import { imprintMatches } from "../src/tsa.js";
import { digestSha256 } from "../src/canonical-json.js";
import type { RunRecord } from "../src/runner.js";

// B1 integration — push.ts wiring: --timestamp requests an RFC-3161 token
// per record, REELIER_TSA_URL overrides the bundled default, and a TSA
// failure never blocks the push (fail-open, grey rung).

const SKILL_SOURCE = `---
name: push-timestamp-fixture
description: a skill used to exercise --timestamp on push
---

### Step 1 — one
- intent: first step
- action: http.get {"url": "https://example.com/1"}
- assert: status == 200
- effect: read
`;

function makeRecord(n: number): RunRecord {
  return {
    skill: "push-timestamp-fixture",
    startedAt: `2026-07-22T00:00:0${n}.000Z`,
    finishedAt: `2026-07-22T00:00:0${n}.500Z`,
    passed: true,
    steps: [{ n: 1, title: "one", level: 0, outcome: "passed", ms: 5, failures: [] }],
    totals: { steps: 1, passed: 1, unchecked: 0, skipped: 0, failed: 0, ms: 5, llmInputTokens: 0, llmOutputTokens: 0 },
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-push-timestamp-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function setupFixture(dir: string): Promise<string> {
  const skillPath = path.join(dir, "push-timestamp-fixture.skill.md");
  await writeFile(skillPath, SKILL_SOURCE, "utf8");
  const runsDir = path.join(dir, ".reelier", "runs");
  await mkdir(runsDir, { recursive: true });
  await writeFile(path.join(runsDir, "push-timestamp-fixture.jsonl"), JSON.stringify(makeRecord(0)) + "\n", "utf8");
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

/**
 * A fake TSA that echoes the REQUEST's own DER bytes back as the "response"
 * (wrapped in unrelated bytes, like a real CMS envelope would be) — since
 * buildTimeStampReq's request DER already contains a genuine MessageImprint
 * TLV for whatever digest was actually requested, this sidesteps needing to
 * precompute the digest ourselves (which would drift from the ACTUAL pushed
 * record: push.ts times the digest over the record AFTER the
 * skillContentSha256 push-time stamp, same "sign what ships" rule as A3).
 */
function echoingFakeTsaResponse(reqBodyBuffer: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0xde, 0xad]), reqBodyBuffer, Buffer.from([0xbe, 0xef])]);
}

test("pushSkill: without --timestamp, the payload omits 'timestamp' and no TSA is ever contacted", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir);
    let tsaCalled = false;
    const responses = [{ status: 200, body: {} }, { status: 202, body: { id: "r1" } }];
    let i = 0;
    const fetchFn = (async (url: string) => {
      if (typeof url === "string" && url.includes("tsa")) tsaCalled = true;
      const spec = responses[i++];
      return { ok: true, status: spec.status, text: async () => JSON.stringify(spec.body) } as unknown as Response;
    }) as typeof fetch;

    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, () =>
      withFetch(fetchFn, () => pushSkill(skillPath, { cwd: dir }))
    );
    assert.equal(tsaCalled, false);
  });
});

test("pushSkill --timestamp: requests a timestamp from the bundled DEFAULT_TSA_URL and attaches it, imprint verifies against the pushed record's digest", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir);

    let tsaUrlSeen: string | undefined;
    const runsCalls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (url.includes("freetsa.org") || url.includes("tsa")) {
        tsaUrlSeen = url;
        const reqBody = Buffer.from(init!.body as Uint8Array);
        const respBytes = echoingFakeTsaResponse(reqBody);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => respBytes.buffer.slice(respBytes.byteOffset, respBytes.byteOffset + respBytes.byteLength),
        } as unknown as Response;
      }
      if (url.endsWith("/api/v1/skills")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({}) } as unknown as Response;
      }
      runsCalls.push({ url, init: init ?? {} });
      return { ok: true, status: 202, text: async () => JSON.stringify({ id: "r1" }) } as unknown as Response;
    }) as typeof fetch;

    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, () =>
      withFetch(fetchFn, () => pushSkill(skillPath, { cwd: dir, timestamp: true }))
    );

    assert.ok(tsaUrlSeen, "expected the TSA to have been contacted");
    assert.equal(runsCalls.length, 1);
    const body = JSON.parse(runsCalls[0].init.body as string);
    assert.ok(body.timestamp, "expected a timestamp field on the pushed payload");
    assert.equal(body.timestamp.tsa, tsaUrlSeen);
    assert.equal(imprintMatches(body.timestamp.token, digestSha256(body.record).replace(/^sha256:/, "")), true);
  });
});

test("pushSkill --timestamp with REELIER_TSA_URL set: the override URL is used instead of the bundled default", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir);
    let tsaUrlSeen: string | undefined;

    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (url === "https://my-own-tsa.example/tsr") {
        tsaUrlSeen = url;
        const reqBody = Buffer.from(init!.body as Uint8Array);
        const respBytes = echoingFakeTsaResponse(reqBody);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => respBytes.buffer.slice(respBytes.byteOffset, respBytes.byteOffset + respBytes.byteLength),
        } as unknown as Response;
      }
      if (url.endsWith("/api/v1/skills")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({}) } as unknown as Response;
      }
      return { ok: true, status: 202, text: async () => JSON.stringify({ id: "r1" }) } as unknown as Response;
    }) as typeof fetch;

    await withEnv(
      {
        REELIER_CLOUD_URL: "https://cloud.example",
        REELIER_CLOUD_KEY: "test-key",
        REELIER_TSA_URL: "https://my-own-tsa.example/tsr",
      },
      () => withFetch(fetchFn, () => pushSkill(skillPath, { cwd: dir, timestamp: true }))
    );

    assert.equal(tsaUrlSeen, "https://my-own-tsa.example/tsr");
  });
});

test("pushSkill --timestamp: TSA down (network error) -> push still succeeds with no 'timestamp' field, grey rung", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir);
    const runsCalls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (url.includes("freetsa.org")) {
        throw new Error("ECONNREFUSED");
      }
      if (url.endsWith("/api/v1/skills")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({}) } as unknown as Response;
      }
      runsCalls.push({ url, init: init ?? {} });
      return { ok: true, status: 202, text: async () => JSON.stringify({ id: "r1" }) } as unknown as Response;
    }) as typeof fetch;

    const result = await withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key" }, () =>
      withFetch(fetchFn, () => pushSkill(skillPath, { cwd: dir, timestamp: true }))
    );

    assert.equal(result.pushedCount, 1);
    assert.equal(runsCalls.length, 1);
    const body = JSON.parse(runsCalls[0].init.body as string);
    assert.equal(body.timestamp, undefined);
  });
});
