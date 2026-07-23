import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pushSkill } from "../src/push.js";
import { generateSigningKeypair } from "../src/signing.js";
import type { RunRecord } from "../src/runner.js";

// Cross-seam privacy consent (cloud adjudication): the cloud only serves the
// FULL signed record on /r/<token>/json for SIGNED receipts (verify needs
// the bytes) — so sharing a SIGNED push publishes more than an unsigned
// share does. Consent must be visible at the moment it happens: exactly one
// stderr line per push invocation (never per record), only when BOTH a
// signing key is loaded AND the push is shared.

const CONSENT_LINE =
  "note: sharing a signed receipt publishes its full signed record at the receipt URL (that's what makes it independently verifiable)";

const SKILL_SOURCE = `---
name: push-share-consent-fixture
description: a skill used to exercise the sharing-a-signed-receipt consent note
---

### Step 1 — one
- intent: first step
- action: http.get {"url": "https://example.com/1"}
- assert: status == 200
- effect: read

### Step 2 — two
- intent: second step
- action: http.get {"url": "https://example.com/2"}
- assert: status == 200
- effect: read
`;

function makeRecord(n: number): RunRecord {
  return {
    skill: "push-share-consent-fixture",
    startedAt: `2026-07-23T00:00:0${n}.000Z`,
    finishedAt: `2026-07-23T00:00:0${n}.500Z`,
    passed: true,
    steps: [{ n: 1, title: "one", level: 0, outcome: "passed", ms: 5, failures: [] }],
    totals: { steps: 1, passed: 1, unchecked: 0, skipped: 0, failed: 0, ms: 5, llmInputTokens: 0, llmOutputTokens: 0 },
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-push-share-consent-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Two run records so a shared/signed push has >1 candidate — proves the note prints ONCE per invocation, not once per record. */
async function setupFixture(dir: string): Promise<string> {
  const skillPath = path.join(dir, "push-share-consent-fixture.skill.md");
  await writeFile(skillPath, SKILL_SOURCE, "utf8");
  const runsDir = path.join(dir, ".reelier", "runs");
  await mkdir(runsDir, { recursive: true });
  const lines = [makeRecord(0), makeRecord(1)].map((r) => JSON.stringify(r)).join("\n") + "\n";
  await writeFile(path.join(runsDir, "push-share-consent-fixture.jsonl"), lines, "utf8");
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

function fakeFetch(): typeof fetch {
  let i = 0;
  const responses = [{ status: 200, body: {} }, { status: 202, body: { id: "r1", shareUrl: "https://reelier.com/r/tok1" } }, { status: 202, body: { id: "r2", shareUrl: "https://reelier.com/r/tok1" } }];
  return (async () => {
    const spec = responses[i++];
    return { ok: true, status: spec.status, text: async () => JSON.stringify(spec.body) } as unknown as Response;
  }) as typeof fetch;
}

async function runPush(home: string, dir: string, options: { share?: boolean }): Promise<{ lines: string[] }> {
  const skillPath = await setupFixture(dir);
  const { lines } = await withCapturedStderr(() =>
    withEnv({ REELIER_CLOUD_URL: "https://cloud.example", REELIER_CLOUD_KEY: "test-key", HOME: home, USERPROFILE: home }, () =>
      withFetch(fakeFetch(), () => pushSkill(skillPath, { cwd: dir, share: options.share }))
    )
  );
  return { lines };
}

test("signed + shared: prints the consent note exactly once, even with multiple records in the push", async () => {
  await withTempDir(async (home) => {
    await withTempDir(async (dir) => {
      await generateSigningKeypair(path.join(home, ".reelier", "signing"));
      const { lines } = await runPush(home, dir, { share: true });
      const matches = lines.filter((l) => l === CONSENT_LINE);
      assert.equal(matches.length, 1, `expected exactly one consent line, got: ${JSON.stringify(lines)}`);
    });
  });
});

test("signed + unshared: no consent note", async () => {
  await withTempDir(async (home) => {
    await withTempDir(async (dir) => {
      await generateSigningKeypair(path.join(home, ".reelier", "signing"));
      const { lines } = await runPush(home, dir, { share: false });
      assert.equal(lines.filter((l) => l === CONSENT_LINE).length, 0);
    });
  });
});

test("unsigned + shared: no consent note (nothing signed to warn about)", async () => {
  await withTempDir(async (home) => {
    await withTempDir(async (dir) => {
      const { lines } = await runPush(home, dir, { share: true });
      assert.equal(lines.filter((l) => l === CONSENT_LINE).length, 0);
    });
  });
});

test("unsigned + unshared: no consent note", async () => {
  await withTempDir(async (home) => {
    await withTempDir(async (dir) => {
      const { lines } = await runPush(home, dir, { share: false });
      assert.equal(lines.filter((l) => l === CONSENT_LINE).length, 0);
    });
  });
});
