import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  generateSigningKeypair,
  loadSigningKey,
  signRecordDigest,
  verifyRecordSignature,
  signingKeyDir,
} from "../src/signing.js";
import { digestSha256 } from "../src/canonical-json.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-signing-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("generateSigningKeypair writes a private+public PEM pair and returns a stable keyId", async () => {
  await withTempDir(async (dir) => {
    const generated = await generateSigningKeypair(dir);
    assert.match(generated.keyId, /^[0-9a-f]{16}$/);
    assert.match(generated.publicPem, /-----BEGIN PUBLIC KEY-----/);
    assert.ok(generated.privatePath.includes(generated.keyId));
  });
});

test("keyId is derived from the public key (deterministic across regenerations of a byte-identical key is not required, but the same generated key's own keyId matches its own public key hash)", async () => {
  await withTempDir(async (dir) => {
    const generated = await generateSigningKeypair(dir);
    const loaded = await loadSigningKey(dir);
    assert.ok(loaded);
    assert.equal(loaded!.keyId, generated.keyId);
  });
});

test("sign/verify roundtrip: a signature verifies against the correct public key and digest", async () => {
  await withTempDir(async (dir) => {
    const generated = await generateSigningKeypair(dir);
    const loaded = await loadSigningKey(dir);
    assert.ok(loaded);
    const digest = digestSha256({ hello: "world" });
    const sig = signRecordDigest(loaded!.privateKey, digest);
    assert.equal(verifyRecordSignature(generated.publicPem, digest, sig), true);
  });
});

test("tamper: a signature does not verify against a different digest", async () => {
  await withTempDir(async (dir) => {
    const generated = await generateSigningKeypair(dir);
    const loaded = await loadSigningKey(dir);
    const digest = digestSha256({ hello: "world" });
    const sig = signRecordDigest(loaded!.privateKey, digest);
    const otherDigest = digestSha256({ hello: "tampered" });
    assert.equal(verifyRecordSignature(generated.publicPem, otherDigest, sig), false);
  });
});

test("tamper: a corrupted base64 signature does not verify and never throws", async () => {
  await withTempDir(async (dir) => {
    const generated = await generateSigningKeypair(dir);
    const digest = digestSha256({ hello: "world" });
    assert.equal(verifyRecordSignature(generated.publicPem, digest, "not-a-real-signature"), false);
  });
});

test("keyId stability: loading the same directory twice returns the same keyId", async () => {
  await withTempDir(async (dir) => {
    const generated = await generateSigningKeypair(dir);
    const loaded1 = await loadSigningKey(dir);
    const loaded2 = await loadSigningKey(dir);
    assert.equal(loaded1!.keyId, generated.keyId);
    assert.equal(loaded2!.keyId, generated.keyId);
  });
});

test("loadSigningKey returns null when the directory does not exist", async () => {
  await withTempDir(async (dir) => {
    const missing = path.join(dir, "does-not-exist");
    assert.equal(await loadSigningKey(missing), null);
  });
});

test("loadSigningKey returns null when the directory exists but has no key files", async () => {
  await withTempDir(async (dir) => {
    assert.equal(await loadSigningKey(dir), null);
  });
});

test("loadSigningKey returns null (and warns, never throws) on a malformed private key file", async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, "abcdef0123456789.pem"), "not a real PEM", "utf8");
    const originalError = console.error;
    let warned = false;
    console.error = (() => {
      warned = true;
    }) as typeof console.error;
    try {
      const result = await loadSigningKey(dir);
      assert.equal(result, null);
      assert.equal(warned, true);
    } finally {
      console.error = originalError;
    }
  });
});

test("loadSigningKey picks the newest key when multiple keys exist", async () => {
  await withTempDir(async (dir) => {
    const first = await generateSigningKeypair(dir);
    // Ensure a distinguishable mtime ordering across filesystems with coarse
    // mtime resolution.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await generateSigningKeypair(dir);
    const loaded = await loadSigningKey(dir);
    assert.ok(loaded);
    assert.equal(loaded!.keyId, second.keyId);
    assert.notEqual(second.keyId, first.keyId);
  });
});

test("loadSigningKey is deterministic when two keys share the exact same mtime (filename tiebreak)", async () => {
  await withTempDir(async (dir) => {
    const first = await generateSigningKeypair(dir);
    const second = await generateSigningKeypair(dir);

    // Force an exact tie: coarse-resolution filesystems can produce this
    // naturally, but we pin it here so the test is deterministic rather
    // than timing-dependent.
    const tiedMtime = new Date();
    await utimes(path.join(dir, `${first.keyId}.pem`), tiedMtime, tiedMtime);
    await utimes(path.join(dir, `${second.keyId}.pem`), tiedMtime, tiedMtime);

    const expectedKeyId = [first.keyId, second.keyId].sort((a, b) =>
      `${a}.pem`.localeCompare(`${b}.pem`)
    )[0];

    // Repeated loads must all agree, regardless of readdir's (unspecified)
    // ordering for same-mtime files — the old code's stability depended on
    // that ordering, which is exactly the flake this guards against.
    for (let i = 0; i < 10; i++) {
      const loaded = await loadSigningKey(dir);
      assert.ok(loaded);
      assert.equal(loaded!.keyId, expectedKeyId);
    }
  });
});

test("loadSigningKey skips a malformed newest key and falls through to the next valid one", async () => {
  await withTempDir(async (dir) => {
    const valid = await generateSigningKeypair(dir);
    // Older mtime for the valid key, newer mtime for the malformed one —
    // the malformed key is "newest" and must not stop a valid older key
    // from loading.
    const older = new Date(Date.now() - 60_000);
    await utimes(path.join(dir, `${valid.keyId}.pem`), older, older);

    const malformedKeyId = "fedcba9876543210";
    await writeFile(path.join(dir, `${malformedKeyId}.pem`), "not a real PEM", "utf8");
    const newer = new Date();
    await utimes(path.join(dir, `${malformedKeyId}.pem`), newer, newer);

    const originalError = console.error;
    let warned = false;
    console.error = (() => {
      warned = true;
    }) as typeof console.error;
    try {
      const loaded = await loadSigningKey(dir);
      assert.ok(loaded, "expected fallthrough to the valid older key, got null");
      assert.equal(loaded!.keyId, valid.keyId);
      assert.equal(warned, true);
    } finally {
      console.error = originalError;
    }
  });
});

test("signingKeyDir places keys under <homedir>/.reelier/signing", () => {
  const dir = signingKeyDir("/home/someone");
  assert.match(dir.replace(/\\/g, "/"), /\/home\/someone\/\.reelier\/signing$/);
});
