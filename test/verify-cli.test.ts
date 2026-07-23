import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdVerify, type ParsedArgs } from "../src/cli.js";
import { generateSigningKeypair, loadSigningKey, signRecordDigest } from "../src/signing.js";
import { digestSha256 } from "../src/canonical-json.js";
import type { RunRecord } from "../src/runner.js";

// fetch-monkeypatched matrix for `reelier verify` (trust-ladder plan task
// A4): valid / tampered / unsigned / no-key-provided. Mirrors
// test/push-cli.test.ts's withFetch/withCapturedLogs pattern.

function makeRecord(): RunRecord {
  return {
    skill: "verify-cli-fixture",
    startedAt: "2026-07-22T00:00:00.000Z",
    finishedAt: "2026-07-22T00:00:00.500Z",
    passed: true,
    steps: [{ n: 1, title: "one", level: 0, outcome: "passed", ms: 5, failures: [] }],
    totals: { steps: 1, passed: 1, unchecked: 0, skipped: 0, failed: 0, ms: 5, llmInputTokens: 0, llmOutputTokens: 0 },
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-verify-cli-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
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

function fakeFetch(body: unknown): typeof fetch {
  return (async () => {
    return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response;
  }) as typeof fetch;
}

function argsFor(target: string, keyPath?: string): ParsedArgs {
  return {
    positional: [target],
    flags: new Set(),
    vars: {},
    wraps: [],
    opts: keyPath ? { key: keyPath } : {},
    fails: [],
  };
}

test("reelier verify: valid signature + matching --key -> ✓, exit 0", async () => {
  await withTempDir(async (keyDir) => {
    const generated = await generateSigningKeypair(keyDir);
    const loaded = await loadSigningKey(keyDir);
    const record = makeRecord();
    const sig = signRecordDigest(loaded!.privateKey, digestSha256(record));
    const payload = { record, signature: { alg: "ed25519", keyId: generated.keyId, sig } };

    const pubKeyPath = path.join(keyDir, `${generated.keyId}.pub.pem`);
    const { result: code, lines } = await withCapturedLogs(() =>
      withFetch(fakeFetch(payload), () => cmdVerify(argsFor("https://reelier.com/r/tok123", pubKeyPath)))
    );
    assert.equal(code, 0);
    const joined = lines.join("\n");
    assert.match(joined, /unaltered-since-push: ✓/);
    assert.match(joined, new RegExp(generated.keyId));
  });
});

test("reelier verify: tampered record -> ✗ SIGNATURE INVALID, exit 1", async () => {
  await withTempDir(async (keyDir) => {
    const generated = await generateSigningKeypair(keyDir);
    const loaded = await loadSigningKey(keyDir);
    const record = makeRecord();
    const sig = signRecordDigest(loaded!.privateKey, digestSha256(record));
    const tampered = { ...record, passed: false };
    const payload = { record: tampered, signature: { alg: "ed25519", keyId: generated.keyId, sig } };

    const pubKeyPath = path.join(keyDir, `${generated.keyId}.pub.pem`);
    const { result: code, lines } = await withCapturedLogs(() =>
      withFetch(fakeFetch(payload), () => cmdVerify(argsFor("https://reelier.com/r/tok123", pubKeyPath)))
    );
    assert.equal(code, 1);
    assert.match(lines.join("\n"), /SIGNATURE INVALID/);
  });
});

test("reelier verify: unsigned record -> '— unsigned', exit 0, never shamed", async () => {
  const payload = { record: makeRecord() };
  const { result: code, lines } = await withCapturedLogs(() =>
    withFetch(fakeFetch(payload), () => cmdVerify(argsFor("https://reelier.com/r/tok123")))
  );
  assert.equal(code, 0);
  assert.match(lines.join("\n"), /unaltered-since-push: — unsigned/);
});

test("reelier verify: signature present but no --key given -> unchecked note, exit 0 (not a failure)", async () => {
  const record = makeRecord();
  const payload = { record, signature: { alg: "ed25519", keyId: "deadbeefdeadbeef", sig: "irrelevant-base64" } };
  const { result: code, lines } = await withCapturedLogs(() =>
    withFetch(fakeFetch(payload), () => cmdVerify(argsFor("https://reelier.com/r/tok123")))
  );
  assert.equal(code, 0);
  const joined = lines.join("\n");
  assert.match(joined, /no public key was given/);
  assert.doesNotMatch(joined, /✓/);
  assert.doesNotMatch(joined, /SIGNATURE INVALID/);
});

test("reelier verify: reads a local receipt file (no fetch call) and reports the same claims", async () => {
  await withTempDir(async (dir) => {
    const record = makeRecord();
    const filePath = path.join(dir, "receipt.json");
    await writeFile(filePath, JSON.stringify({ record }), "utf8");
    let fetchCalled = false;
    const neverFetch = (async () => {
      fetchCalled = true;
      throw new Error("fetch should never be called for a local file target");
    }) as typeof fetch;

    const { result: code, lines } = await withCapturedLogs(() =>
      withFetch(neverFetch, () => cmdVerify(argsFor(filePath)))
    );
    assert.equal(fetchCalled, false);
    assert.equal(code, 0);
    assert.match(lines.join("\n"), /unaltered-since-push: — unsigned/);
  });
});

test("reelier verify: missing target argument -> usage error, exit 1", async () => {
  const { result: code } = await withCapturedLogs(() => cmdVerify(argsFor("")));
  // argsFor("") gives positional [""] which is falsy for the CLI's arg check
  // only if empty string — cmdVerify treats target as args.positional[0];
  // an empty string IS falsy in JS, so this exercises the "no target" path.
  assert.equal(code, 1);
});
