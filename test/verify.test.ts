import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isHttpUrl,
  permalinkJsonUrl,
  parseVerifyPayload,
  evaluateUnalteredSincePushClaim,
  evaluateTimestampClaim,
  evaluateVerifyClaims,
  resolveVerifyPayload,
  type VerifyPayload,
} from "../src/verify.js";
import { generateSigningKeypair, loadSigningKey, signRecordDigest } from "../src/signing.js";
import { digestSha256 } from "../src/canonical-json.js";
import type { RunRecord } from "../src/runner.js";

// Review finding #1/#2: a genuine RFC-3161 TimeStampResp is a CMS
// SignedData whose top-level `digestAlgorithms` SET (itself a sha256
// AlgorithmIdentifier, with NO octet string right after it) precedes the
// eContent-embedded TSTInfo's own messageImprint (which DOES have the real
// 32-byte digest right after ITS AlgorithmIdentifier). A fixture that only
// ever wraps a bare MessageImprint (no preceding digestAlgorithms) can't
// catch a first-match-only bug — this fixture mirrors the real byte order
// closely enough to (same construction as test/tsa.test.ts's
// buildRealisticCmsFixture).
const SHA256_ALGID_DER = Buffer.concat([
  Buffer.from([0x30, 0x0d]),
  Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]),
  Buffer.from([0x05, 0x00]),
]);

/** A CMS-shaped fake TSA response: digestAlgorithms (no imprint attached) BEFORE the real messageImprint for `digestHex`, BEFORE trailing junk standing in for signerInfos. */
function fakeTsaTokenB64For(digestHex: string): string {
  const digestAlgorithms = Buffer.concat([Buffer.from([0x31, SHA256_ALGID_DER.length]), SHA256_ALGID_DER]);
  const eContentTypeStandIn = Buffer.from([0x06, 0x03, 0x2a, 0x86, 0x48]);
  const realImprint = Buffer.concat([SHA256_ALGID_DER, Buffer.from([0x04, 0x20]), Buffer.from(digestHex, "hex")]);
  const signerInfosStandIn = Buffer.from([0x31, 0x03, 0x01, 0x02, 0x03]);
  return Buffer.concat([digestAlgorithms, eContentTypeStandIn, realImprint, signerInfosStandIn]).toString("base64");
}

function makeRecord(n: number): RunRecord {
  return {
    skill: "verify-fixture",
    startedAt: `2026-07-22T00:00:0${n}.000Z`,
    finishedAt: `2026-07-22T00:00:0${n}.500Z`,
    passed: true,
    steps: [{ n: 1, title: "one", level: 0, outcome: "passed", ms: 5, failures: [] }],
    totals: { steps: 1, passed: 1, unchecked: 0, skipped: 0, failed: 0, ms: 5, llmInputTokens: 0, llmOutputTokens: 0 },
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-verify-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("isHttpUrl recognizes http(s) URLs and rejects bare tokens/paths", () => {
  assert.equal(isHttpUrl("https://reelier.com/r/abc123"), true);
  assert.equal(isHttpUrl("http://localhost:3000/r/abc123"), true);
  assert.equal(isHttpUrl("abc123"), false);
  assert.equal(isHttpUrl("./local/file.json"), false);
});

test("permalinkJsonUrl appends /json, strips trailing slashes, and is idempotent on an already-/json URL", () => {
  assert.equal(permalinkJsonUrl("https://reelier.com/r/abc123"), "https://reelier.com/r/abc123/json");
  assert.equal(permalinkJsonUrl("https://reelier.com/r/abc123/"), "https://reelier.com/r/abc123/json");
  assert.equal(permalinkJsonUrl("https://reelier.com/r/abc123/json"), "https://reelier.com/r/abc123/json");
});

test("parseVerifyPayload accepts the full {record,signature,timestamp} envelope as-is", () => {
  const record = makeRecord(0);
  const raw = JSON.stringify({ record, signature: { alg: "ed25519", keyId: "abc", sig: "xyz" } });
  const payload = parseVerifyPayload(raw);
  assert.deepEqual(payload.record, record);
  assert.equal(payload.signature?.keyId, "abc");
});

test("parseVerifyPayload wraps a bare RunRecord (no envelope) as {record: parsed} without fabricating trust fields", () => {
  const record = makeRecord(0);
  const payload = parseVerifyPayload(JSON.stringify(record));
  assert.deepEqual(payload.record, record);
  assert.equal(payload.signature, undefined);
  assert.equal(payload.timestamp, undefined);
});

test("evaluateUnalteredSincePushClaim: unsigned record -> absent, never shamed", () => {
  const result = evaluateUnalteredSincePushClaim({ record: makeRecord(0) });
  assert.equal(result.status, "absent");
  assert.match(result.line, /unsigned/);
});

test("evaluateUnalteredSincePushClaim: signed but no --key given -> unchecked, not failed", () => {
  const result = evaluateUnalteredSincePushClaim({
    record: makeRecord(0),
    signature: { alg: "ed25519", keyId: "deadbeefdeadbeef", sig: "irrelevant" },
  });
  assert.equal(result.status, "unchecked");
  assert.match(result.line, /no public key was given/);
});

test("evaluateUnalteredSincePushClaim: valid signature against the given key -> verified", async () => {
  await withTempDir(async (dir) => {
    const generated = await generateSigningKeypair(dir);
    const loaded = await loadSigningKey(dir);
    const record = makeRecord(0);
    const sig = signRecordDigest(loaded!.privateKey, digestSha256(record));
    const payload: VerifyPayload = { record, signature: { alg: "ed25519", keyId: generated.keyId, sig } };
    const result = evaluateUnalteredSincePushClaim(payload, generated.publicPem);
    assert.equal(result.status, "verified");
    assert.match(result.line, /✓/);
    assert.match(result.line, new RegExp(generated.keyId));
  });
});

test("evaluateUnalteredSincePushClaim: tampered record (digest no longer matches) -> failed, loud", async () => {
  await withTempDir(async (dir) => {
    const generated = await generateSigningKeypair(dir);
    const loaded = await loadSigningKey(dir);
    const record = makeRecord(0);
    const sig = signRecordDigest(loaded!.privateKey, digestSha256(record));
    const tamperedRecord = { ...record, passed: false };
    const payload: VerifyPayload = { record: tamperedRecord, signature: { alg: "ed25519", keyId: generated.keyId, sig } };
    const result = evaluateUnalteredSincePushClaim(payload, generated.publicPem);
    assert.equal(result.status, "failed");
    assert.match(result.line, /SIGNATURE INVALID/);
  });
});

test("evaluateUnalteredSincePushClaim: wrong public key -> failed, not verified", async () => {
  await withTempDir(async (dirA) => {
    await withTempDir(async (dirB) => {
      const keyA = await generateSigningKeypair(dirA);
      const loadedA = await loadSigningKey(dirA);
      const keyB = await generateSigningKeypair(dirB);
      const record = makeRecord(0);
      const sig = signRecordDigest(loadedA!.privateKey, digestSha256(record));
      const payload: VerifyPayload = { record, signature: { alg: "ed25519", keyId: keyA.keyId, sig } };
      const result = evaluateUnalteredSincePushClaim(payload, keyB.publicPem);
      assert.equal(result.status, "failed");
    });
  });
});

// ---------------------------------------------------------------------------
// B5 — cloud-supplied signingKey attribution (only consulted when --key was
// NOT given; --key always wins when present).
// ---------------------------------------------------------------------------

test("evaluateUnalteredSincePushClaim: no --key, but payload carries a matching signingKey -> verifies against it, with the attribution caveat", async () => {
  await withTempDir(async (dir) => {
    const generated = await generateSigningKeypair(dir);
    const loaded = await loadSigningKey(dir);
    const record = makeRecord(0);
    const sig = signRecordDigest(loaded!.privateKey, digestSha256(record));
    const payload: VerifyPayload = {
      record,
      signature: { alg: "ed25519", keyId: generated.keyId, sig },
      signingKey: { keyId: generated.keyId, publicKeyPem: generated.publicPem },
    };
    const result = evaluateUnalteredSincePushClaim(payload);
    assert.equal(result.status, "verified");
    assert.match(result.line, /✓/);
    assert.match(result.line, new RegExp(generated.keyId));
    assert.match(result.line, /supplied by reelier\.com/);
    assert.match(result.line, /--key/);
  });
});

test("evaluateUnalteredSincePushClaim: no --key, signingKey.keyId does NOT match the signature's keyId -> failed, naming both ids", async () => {
  await withTempDir(async (dirA) => {
    await withTempDir(async (dirB) => {
      const keyA = await generateSigningKeypair(dirA);
      const loadedA = await loadSigningKey(dirA);
      const keyB = await generateSigningKeypair(dirB);
      const record = makeRecord(0);
      const sig = signRecordDigest(loadedA!.privateKey, digestSha256(record));
      const payload: VerifyPayload = {
        record,
        signature: { alg: "ed25519", keyId: keyA.keyId, sig },
        signingKey: { keyId: keyB.keyId, publicKeyPem: keyB.publicPem },
      };
      const result = evaluateUnalteredSincePushClaim(payload);
      assert.equal(result.status, "failed");
      assert.match(result.line, new RegExp(keyA.keyId));
      assert.match(result.line, new RegExp(keyB.keyId));
    });
  });
});

test("evaluateUnalteredSincePushClaim: no --key, no signingKey in payload -> today's unchecked line, unchanged", async () => {
  const result = evaluateUnalteredSincePushClaim({
    record: makeRecord(0),
    signature: { alg: "ed25519", keyId: "deadbeefdeadbeef", sig: "irrelevant" },
  });
  assert.equal(result.status, "unchecked");
  assert.match(result.line, /no public key was given/);
});

test("evaluateUnalteredSincePushClaim: --key given ALWAYS wins over a signingKey in the payload, even a mismatched one", async () => {
  await withTempDir(async (dirCorrect) => {
    await withTempDir(async (dirWrongCloudKey) => {
      const correctKey = await generateSigningKeypair(dirCorrect);
      const loadedCorrect = await loadSigningKey(dirCorrect);
      const wrongCloudKey = await generateSigningKeypair(dirWrongCloudKey);
      const record = makeRecord(0);
      const sig = signRecordDigest(loadedCorrect!.privateKey, digestSha256(record));
      const payload: VerifyPayload = {
        record,
        signature: { alg: "ed25519", keyId: correctKey.keyId, sig },
        // A payload whose signingKey is unrelated to the actual signature —
        // must never influence the result when --key is explicitly given.
        signingKey: { keyId: wrongCloudKey.keyId, publicKeyPem: wrongCloudKey.publicPem },
      };
      const result = evaluateUnalteredSincePushClaim(payload, correctKey.publicPem);
      assert.equal(result.status, "verified");
      assert.doesNotMatch(result.line, /reelier\.com/);
    });
  });
});

test("evaluateTimestampClaim: absent -> '— none', never fabricated", () => {
  const result = evaluateTimestampClaim({ record: makeRecord(0) });
  assert.equal(result.status, "absent");
  assert.match(result.line, /none/);
});

test("evaluateTimestampClaim: matching imprint -> 'unchecked' (imprint proven, chain trust not — never overclaims 'verified')", () => {
  const record = makeRecord(0);
  const digestHex = digestSha256(record).replace(/^sha256:/, "");
  const result = evaluateTimestampClaim({
    record,
    timestamp: { tsa: "https://tsa.example", token: fakeTsaTokenB64For(digestHex) },
  });
  assert.equal(result.status, "unchecked");
  assert.match(result.line, /imprint ✓/);
  assert.match(result.line, /openssl ts -verify/);
});

test("evaluateTimestampClaim: mismatched imprint (token belongs to a different digest) -> failed, loud", () => {
  const record = makeRecord(0);
  const wrongDigestHex = "0".repeat(64);
  const result = evaluateTimestampClaim({
    record,
    timestamp: { tsa: "https://tsa.example", token: fakeTsaTokenB64For(wrongDigestHex) },
  });
  assert.equal(result.status, "failed");
  assert.match(result.line, /IMPRINT MISMATCH/);
});

test("evaluateTimestampClaim: garbage token (no SHA-256 OID found at all) -> failed, never throws", () => {
  const result = evaluateTimestampClaim({
    record: makeRecord(0),
    timestamp: { tsa: "https://tsa.example", token: "deadbeef" },
  });
  assert.equal(result.status, "failed");
});

test("evaluateVerifyClaims: exit code 0 when nothing PRESENT failed (unsigned + no timestamp)", () => {
  const result = evaluateVerifyClaims({ record: makeRecord(0) });
  assert.equal(result.exitCode, 0);
});

test("evaluateVerifyClaims: exit code 0 when signature present but unchecked (no --key) — absent/unchecked never fails", () => {
  const result = evaluateVerifyClaims({
    record: makeRecord(0),
    signature: { alg: "ed25519", keyId: "deadbeefdeadbeef", sig: "x" },
  });
  assert.equal(result.exitCode, 0);
});

test("evaluateVerifyClaims: exit code 1 when the signature claim actually fails verification", async () => {
  await withTempDir(async (dir) => {
    const generated = await generateSigningKeypair(dir);
    const loaded = await loadSigningKey(dir);
    const record = makeRecord(0);
    const sig = signRecordDigest(loaded!.privateKey, digestSha256(record));
    const tampered = { ...record, passed: false };
    const result = evaluateVerifyClaims(
      { record: tampered, signature: { alg: "ed25519", keyId: generated.keyId, sig } },
      generated.publicPem
    );
    assert.equal(result.exitCode, 1);
  });
});

test("resolveVerifyPayload: reads a local file when target resolves to an existing path", async () => {
  await withTempDir(async (dir) => {
    const record = makeRecord(0);
    const filePath = path.join(dir, "receipt.json");
    await import("node:fs/promises").then((fs) => fs.writeFile(filePath, JSON.stringify({ record }), "utf8"));
    const outcome = await resolveVerifyPayload("receipt.json", { cwd: dir });
    assert.equal(outcome.ok, true);
    if (outcome.ok) assert.deepEqual(outcome.payload.record, record);
  });
});

test("resolveVerifyPayload: an absolute http(s) target fetches /json directly, never touching the filesystem", async () => {
  const record = makeRecord(0);
  let requestedUrl = "";
  const fetchImpl = (async (url: string) => {
    requestedUrl = url;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ record }),
    } as unknown as Response;
  }) as typeof fetch;

  const outcome = await resolveVerifyPayload("https://reelier.com/r/abc123", { fetchImpl });
  assert.equal(requestedUrl, "https://reelier.com/r/abc123/json");
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.deepEqual(outcome.payload.record, record);
});

test("resolveVerifyPayload: a bare token with no matching local file resolves against REELIER_CLOUD_URL", async () => {
  const record = makeRecord(0);
  let requestedUrl = "";
  const fetchImpl = (async (url: string) => {
    requestedUrl = url;
    return { ok: true, status: 200, text: async () => JSON.stringify({ record }) } as unknown as Response;
  }) as typeof fetch;

  const outcome = await resolveVerifyPayload("abc123", {
    fetchImpl,
    env: { REELIER_CLOUD_URL: "https://cloud.example" } as NodeJS.ProcessEnv,
    cwd: "/definitely/does/not/exist/anywhere",
  });
  assert.equal(requestedUrl, "https://cloud.example/r/abc123/json");
  assert.equal(outcome.ok, true);
});

test("resolveVerifyPayload: a network error surfaces an honest message, never throws", async () => {
  const fetchImpl = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  const outcome = await resolveVerifyPayload("https://reelier.com/r/abc123", { fetchImpl });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.match(outcome.message, /ECONNREFUSED/);
});
