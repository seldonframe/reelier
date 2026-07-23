import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdInit, type ParsedArgs } from "../src/cli.js";
import { loadSigningKey } from "../src/signing.js";

// Mirrors test/push-cli.test.ts's withEnv/withCapturedLogs pattern: exercise
// cmdInit's console output directly rather than spawning a subprocess.

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-init-signing-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

function argsWithSigning(): ParsedArgs {
  return { positional: [], flags: new Set(["signing"]), vars: {}, wraps: [], opts: {}, fails: [] };
}

test("reelier init --signing: generates a key on first run and prints keyId + public PEM + registration URL", async () => {
  await withTempDir(async (home) => {
    await withEnv({ HOME: home, USERPROFILE: home }, async () => {
      const { result: code, lines } = await withCapturedLogs(() => cmdInit(argsWithSigning()));
      assert.equal(code, 0);
      const joined = lines.join("\n");
      assert.match(joined, /Generated signing key: [0-9a-f]{16}/);
      assert.match(joined, /-----BEGIN PUBLIC KEY-----/);
      assert.match(joined, /reelier\.com\/settings\/keys/);

      const loaded = await loadSigningKey(path.join(home, ".reelier", "signing"));
      assert.ok(loaded);
    });
  });
});

test("reelier init --signing: idempotent — a second run prints the existing key and does not regenerate", async () => {
  await withTempDir(async (home) => {
    await withEnv({ HOME: home, USERPROFILE: home }, async () => {
      const first = await withCapturedLogs(() => cmdInit(argsWithSigning()));
      const firstKeyMatch = first.lines.join("\n").match(/Generated signing key: ([0-9a-f]{16})/);
      assert.ok(firstKeyMatch);
      const firstKeyId = firstKeyMatch![1];

      const second = await withCapturedLogs(() => cmdInit(argsWithSigning()));
      assert.equal(second.result, 0);
      const joined = second.lines.join("\n");
      assert.match(joined, /Signing key already exists: [0-9a-f]{16}/);
      assert.doesNotMatch(joined, /Generated signing key/);

      const secondKeyMatch = joined.match(/Signing key already exists: ([0-9a-f]{16})/);
      assert.equal(secondKeyMatch![1], firstKeyId);
    });
  });
});

test("reelier init --signing: a malformed existing key file is named in a warning, then a fresh key is generated (never silently orphaned)", async () => {
  await withTempDir(async (home) => {
    await withEnv({ HOME: home, USERPROFILE: home }, async () => {
      const signingDir = path.join(home, ".reelier", "signing");
      await mkdir(signingDir, { recursive: true });
      const brokenFileName = "abcdef0123456789.pem";
      await writeFile(path.join(signingDir, brokenFileName), "not a real PEM", "utf8");

      const { result: code, lines } = await withCapturedLogs(() => cmdInit(argsWithSigning()));
      assert.equal(code, 0);
      const joined = lines.join("\n");

      // loadSigningKey's own WARNING (src/signing.ts) names the orphaned
      // file by path — cmdInitSigning doesn't suppress or duplicate it, it
      // just proceeds to generate a fresh key on top of it.
      assert.match(joined, /WARNING/);
      assert.match(joined, new RegExp(brokenFileName.replace(".", "\\.")));
      assert.match(joined, /Generated signing key: [0-9a-f]{16}/);

      const loaded = await loadSigningKey(signingDir);
      assert.ok(loaded);
      assert.notEqual(loaded!.keyId, "abcdef0123456789");
    });
  });
});
