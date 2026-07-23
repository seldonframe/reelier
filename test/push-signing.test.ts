import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pushSkill } from "../src/push.js";
import { generateSigningKeypair, verifyRecordSignature } from "../src/signing.js";
import { digestSha256 } from "../src/canonical-json.js";
import type { RunRecord } from "../src/runner.js";

// A3 — push signs digestSha256(record) when a signing key exists. The
// critical assertion (trust-ladder plan task A3): the signature must verify
// against the EXACT record object serialized into the pushed payload —
// including push-time additions like the skillContentSha256 fallback stamp
// — never against some earlier/different shape of the record.

const SKILL_SOURCE = `---
name: push-signing-fixture
description: a skill used to exercise push-time signing
---

### Step 1 — one
- intent: first step
- action: http.get {"url": "https://example.com/1"}
- assert: status == 200
- effect: read
`;

function makeRecord(n: number): RunRecord {
  return {
    skill: "push-signing-fixture",
    startedAt: `2026-07-22T00:00:0${n}.000Z`,
    finishedAt: `2026-07-22T00:00:0${n}.500Z`,
    passed: true,
    steps: [{ n: 1, title: "one", level: 0, outcome: "passed", ms: 5, failures: [] }],
    totals: { steps: 1, passed: 1, unchecked: 0, skipped: 0, failed: 0, ms: 5, llmInputTokens: 0, llmOutputTokens: 0 },
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-push-signing-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function setupFixture(dir: string, recordCount: number): Promise<string> {
  const skillPath = path.join(dir, "push-signing-fixture.skill.md");
  await writeFile(skillPath, SKILL_SOURCE, "utf8");
  const runsDir = path.join(dir, ".reelier", "runs");
  await mkdir(runsDir, { recursive: true });
  const lines = Array.from({ length: recordCount }, (_, i) => JSON.stringify(makeRecord(i))).join("\n") + "\n";
  await writeFile(path.join(runsDir, "push-signing-fixture.jsonl"), lines, "utf8");
  return skillPath;
}

type FakeResponseSpec = { status: number; body?: unknown };

function fakeFetch(responses: FakeResponseSpec[]): { fn: typeof fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const spec = responses[i++];
    if (!spec) throw new Error(`fetch called more times than expected (this is call #${calls.length})`);
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

test("push attaches signature=undefined (field omitted) when no signing key exists", async () => {
  await withTempDir(async (dir) => {
    const skillPath = await setupFixture(dir, 1);
    // First call is the skill upload (needsSkillUpload true on first push).
    const { fn, calls } = fakeFetch([{ status: 200, body: {} }, { status: 202, body: { id: "r1" } }]);
    await withEnv(
      { REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key", HOME: dir, USERPROFILE: dir },
      () => withFetch(fn, () => pushSkill(skillPath, { cwd: dir }))
    );
    const runsCall = calls.find((c) => c.url.endsWith("/api/v1/runs"));
    assert.ok(runsCall);
    const body = JSON.parse(runsCall!.init.body as string);
    assert.equal(body.signature, undefined);
  });
});

test("push signs digestSha256(record) when a signing key exists, and the signature verifies against the EXACT pushed record bytes (post skillContentSha256 stamping)", async () => {
  await withTempDir(async (home) => {
    await withTempDir(async (dir) => {
      const signingDir = path.join(home, ".reelier", "signing");
      const generated = await generateSigningKeypair(signingDir);

      const skillPath = await setupFixture(dir, 1);
      const { fn, calls } = fakeFetch([{ status: 200, body: {} }, { status: 202, body: { id: "r1" } }]);

      await withEnv(
        { REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key", HOME: home, USERPROFILE: home },
        () => withFetch(fn, () => pushSkill(skillPath, { cwd: dir }))
      );

      const runsCall = calls.find((c) => c.url.endsWith("/api/v1/runs"));
      assert.ok(runsCall);
      const body = JSON.parse(runsCall!.init.body as string);

      assert.ok(body.signature, "expected a signature field on the pushed payload");
      assert.equal(body.signature.alg, "ed25519");
      assert.equal(body.signature.keyId, generated.keyId);

      // The record as pushed (including the push-time skillContentSha256
      // fallback stamp, since the fixture record has none of its own) must
      // be exactly what the signature verifies against.
      assert.ok(body.record.skillContentSha256, "expected the fallback skillContentSha256 to have been stamped");
      const digest = digestSha256(body.record);
      assert.equal(verifyRecordSignature(generated.publicPem, digest, body.signature.sig), true);

      // And it must NOT verify against the record shape before that
      // stamping (the pre-redaction/pre-stamp candidate) — proving the
      // digest was computed on the record actually shipped, not an earlier
      // version of it.
      const preStampRecord = { ...body.record };
      delete preStampRecord.skillContentSha256;
      const preStampDigest = digestSha256(preStampRecord);
      assert.equal(verifyRecordSignature(generated.publicPem, preStampDigest, body.signature.sig), false);
    });
  });
});

test("push tamper: a single-byte change to the pushed record no longer verifies against the signature that was actually sent", async () => {
  await withTempDir(async (home) => {
    await withTempDir(async (dir) => {
      const signingDir = path.join(home, ".reelier", "signing");
      const generated = await generateSigningKeypair(signingDir);

      const skillPath = await setupFixture(dir, 1);
      const { fn, calls } = fakeFetch([{ status: 200, body: {} }, { status: 202, body: { id: "r1" } }]);

      await withEnv(
        { REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key", HOME: home, USERPROFILE: home },
        () => withFetch(fn, () => pushSkill(skillPath, { cwd: dir }))
      );

      const runsCall = calls.find((c) => c.url.endsWith("/api/v1/runs"));
      const body = JSON.parse(runsCall!.init.body as string);

      const tampered = { ...body.record, passed: !body.record.passed };
      const tamperedDigest = digestSha256(tampered);
      assert.equal(verifyRecordSignature(generated.publicPem, tamperedDigest, body.signature.sig), false);
    });
  });
});
