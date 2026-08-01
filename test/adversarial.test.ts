// Forge-and-reject suite: this file's ONLY job is to try to fake a receipt
// and prove reelier says no. For a product whose promise is "you can't fake
// this," these tests are load-bearing — every negative case here must be
// genuinely rejected by src/verify.ts + src/signing.ts + src/tsa.ts +
// src/manifest.ts, not merely exercised. Each attack asserts the specific
// "failed"/false/ok:false outcome, never just "the code ran without
// throwing."

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  evaluateUnalteredSincePushClaim,
  evaluateTimestampClaim,
  evaluateVerifyClaims,
  type VerifyPayload,
} from "../src/verify.js";
import { generateSigningKeypair, loadSigningKey, signRecordDigest } from "../src/signing.js";
import { digestSha256 } from "../src/canonical-json.js";
import { imprintMatches } from "../src/tsa.js";
import { buildManifestForSkill, preflightManifest } from "../src/manifest.js";
import type { RunRecord } from "../src/runner.js";
import type { Skill } from "../src/skill.js";
import type { DownstreamConnection } from "../src/mcp-client.js";

// ---------------------------------------------------------------------------
// Shared fixtures — kept minimal and realistic, mirroring test/verify.test.ts
// and test/manifest-build.test.ts's existing fixture shapes (no src edits,
// so these are re-declared locally rather than imported from sibling test
// files).
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    skill: "adversarial-fixture",
    startedAt: "2026-07-24T00:00:00.000Z",
    finishedAt: "2026-07-24T00:00:00.500Z",
    passed: true,
    steps: [{ n: 1, title: "one", level: 0, outcome: "passed", ms: 5, failures: [] }],
    totals: { steps: 1, passed: 1, unchecked: 0, skipped: 0, failed: 0, ms: 5, llmInputTokens: 0, llmOutputTokens: 0 },
    ...overrides,
  };
}

function sign(record: RunRecord, privateKey: Parameters<typeof signRecordDigest>[0]): string {
  return signRecordDigest(privateKey, digestSha256(record));
}

const tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-adversarial-"));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})));
});

// A CMS-shaped fake TSA response, same construction discipline as
// test/verify.test.ts's fakeTsaTokenB64For / test/tsa.test.ts's
// buildRealisticCmsFixture: a digestAlgorithms SET (no imprint attached)
// BEFORE the real messageImprint, so a naive first-match scanner would be
// fooled — imprintMatches must find the REAL (second) occurrence.
const SHA256_ALGID_DER = Buffer.concat([
  Buffer.from([0x30, 0x0d]),
  Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]),
  Buffer.from([0x05, 0x00]),
]);

function fakeTsaTokenB64For(digestHex: string): string {
  const digestAlgorithms = Buffer.concat([Buffer.from([0x31, SHA256_ALGID_DER.length]), SHA256_ALGID_DER]);
  const eContentTypeStandIn = Buffer.from([0x06, 0x03, 0x2a, 0x86, 0x48]);
  const realImprint = Buffer.concat([SHA256_ALGID_DER, Buffer.from([0x04, 0x20]), Buffer.from(digestHex, "hex")]);
  const signerInfosStandIn = Buffer.from([0x31, 0x03, 0x01, 0x02, 0x03]);
  return Buffer.concat([digestAlgorithms, eContentTypeStandIn, realImprint, signerInfosStandIn]).toString("base64");
}

function fakeConnection(name: string, tools: DownstreamConnection["tools"]): DownstreamConnection {
  return {
    name,
    tools,
    async call() {
      throw new Error("not called in this test");
    },
    async close() {},
  };
}

function skillUsing(...tools: string[]): Skill {
  return {
    name: "adversarial-fixture-skill",
    description: "fixture",
    preamble: "",
    trailing: "",
    steps: tools.map((tool, i) => ({
      n: i + 1,
      title: `step ${i + 1}`,
      intent: "do it",
      actionTool: tool,
      actionArgs: {},
      asserts: [],
      binds: [],
      effect: "read" as const,
      line: 1,
    })),
  };
}

// ---------------------------------------------------------------------------
// 1. Positive control — proves the suite isn't rejecting everything.
// ---------------------------------------------------------------------------

test("POSITIVE CONTROL: a correctly-signed, unmutated payload verifies and exits 0", async () => {
  const dir = await makeTempDir();
  const generated = await generateSigningKeypair(dir);
  const loaded = await loadSigningKey(dir);
  const record = makeRecord();
  const sig = sign(record, loaded!.privateKey);
  const payload: VerifyPayload = { record, signature: { alg: "ed25519", keyId: generated.keyId, sig } };

  const claim = evaluateUnalteredSincePushClaim(payload, generated.publicPem);
  assert.equal(claim.status, "verified");

  const result = evaluateVerifyClaims(payload, generated.publicPem);
  assert.equal(result.exitCode, 0);
});

// ---------------------------------------------------------------------------
// 2. Tampered record -> reject. Sign the original, mutate ONE field of the
// payload afterward, and prove the digest recomputed at verify-time catches
// it — this is exactly the "unaltered since push" claim's whole job.
// ---------------------------------------------------------------------------

test("FORGE: flip `passed` after signing -> unaltered-since-push FAILS", async () => {
  const dir = await makeTempDir();
  const generated = await generateSigningKeypair(dir);
  const loaded = await loadSigningKey(dir);
  const record = makeRecord();
  const sig = sign(record, loaded!.privateKey);

  const tampered: RunRecord = { ...record, passed: false };
  const payload: VerifyPayload = { record: tampered, signature: { alg: "ed25519", keyId: generated.keyId, sig } };

  const claim = evaluateUnalteredSincePushClaim(payload, generated.publicPem);
  assert.equal(claim.status, "failed");
  assert.match(claim.line, /SIGNATURE INVALID/);
  assert.equal(evaluateVerifyClaims(payload, generated.publicPem).exitCode, 1);
});

test("FORGE: change a step's outcome after signing -> unaltered-since-push FAILS", async () => {
  const dir = await makeTempDir();
  const generated = await generateSigningKeypair(dir);
  const loaded = await loadSigningKey(dir);
  const record = makeRecord();
  const sig = sign(record, loaded!.privateKey);

  const tampered: RunRecord = {
    ...record,
    steps: [{ ...record.steps[0], outcome: "failed" as RunRecord["steps"][0]["outcome"] }],
  };
  const payload: VerifyPayload = { record: tampered, signature: { alg: "ed25519", keyId: generated.keyId, sig } };

  const claim = evaluateUnalteredSincePushClaim(payload, generated.publicPem);
  assert.equal(claim.status, "failed");
  assert.equal(evaluateVerifyClaims(payload, generated.publicPem).exitCode, 1);
});

test("FORGE: bump totals.passed after signing (inflate the score) -> unaltered-since-push FAILS", async () => {
  const dir = await makeTempDir();
  const generated = await generateSigningKeypair(dir);
  const loaded = await loadSigningKey(dir);
  const record = makeRecord();
  const sig = sign(record, loaded!.privateKey);

  const tampered: RunRecord = { ...record, totals: { ...record.totals, passed: record.totals.passed + 1 } };
  const payload: VerifyPayload = { record: tampered, signature: { alg: "ed25519", keyId: generated.keyId, sig } };

  const claim = evaluateUnalteredSincePushClaim(payload, generated.publicPem);
  assert.equal(claim.status, "failed");
  assert.equal(evaluateVerifyClaims(payload, generated.publicPem).exitCode, 1);
});

// ---------------------------------------------------------------------------
// 3. Swapped signature -> reject. A's signature glued onto B's record.
// ---------------------------------------------------------------------------

test("FORGE: attach record A's signature to record B's payload -> FAILS", async () => {
  const dir = await makeTempDir();
  const generated = await generateSigningKeypair(dir);
  const loaded = await loadSigningKey(dir);
  const recordA = makeRecord({ skill: "skill-a" });
  const recordB = makeRecord({ skill: "skill-b" });
  const sigOverA = sign(recordA, loaded!.privateKey);

  const payload: VerifyPayload = { record: recordB, signature: { alg: "ed25519", keyId: generated.keyId, sig: sigOverA } };
  const claim = evaluateUnalteredSincePushClaim(payload, generated.publicPem);
  assert.equal(claim.status, "failed");
  assert.equal(evaluateVerifyClaims(payload, generated.publicPem).exitCode, 1);
});

// ---------------------------------------------------------------------------
// 4. Wrong signing key -> reject. A genuinely-signed record, verified
// against an unrelated keypair's public key.
// ---------------------------------------------------------------------------

test("FORGE: verify a genuine signature against a different keypair's public key -> FAILS", async () => {
  const dirX = await makeTempDir();
  const dirY = await makeTempDir();
  const keyX = await generateSigningKeypair(dirX);
  const loadedX = await loadSigningKey(dirX);
  const keyY = await generateSigningKeypair(dirY);
  const record = makeRecord();
  const sig = sign(record, loadedX!.privateKey);

  const payload: VerifyPayload = { record, signature: { alg: "ed25519", keyId: keyX.keyId, sig } };
  const claim = evaluateUnalteredSincePushClaim(payload, keyY.publicPem);
  assert.equal(claim.status, "failed");
  assert.equal(evaluateVerifyClaims(payload, keyY.publicPem).exitCode, 1);

  // Same forgery via the cloud-supplied signingKey attribution path (B5) —
  // an attacker-controlled signingKey.publicKeyPem that DOES claim keyX's
  // id but carries keyY's bytes must still fail, not silently "verify".
  const payloadWithForgedSigningKey: VerifyPayload = {
    record,
    signature: { alg: "ed25519", keyId: keyX.keyId, sig },
    signingKey: { keyId: keyX.keyId, publicKeyPem: keyY.publicPem },
  };
  const claim2 = evaluateUnalteredSincePushClaim(payloadWithForgedSigningKey);
  assert.equal(claim2.status, "failed");
});

// ---------------------------------------------------------------------------
// 5. Signature-bytes tamper -> reject. A REAL byte flip in the decoded
// signature (not a base64 don't-care-padding flip), never a throw.
// ---------------------------------------------------------------------------

test("FORGE: flip one byte of the decoded signature -> FAILS, does not throw", async () => {
  const dir = await makeTempDir();
  const generated = await generateSigningKeypair(dir);
  const loaded = await loadSigningKey(dir);
  const record = makeRecord();
  const sig = sign(record, loaded!.privateKey);

  const sigBytes = Buffer.from(sig, "base64");
  assert.ok(sigBytes.length > 0, "sanity: signature must decode to non-empty bytes");
  sigBytes[0] = sigBytes[0] ^ 0xff; // guaranteed real bit-flip, not a base64 padding no-op
  const corruptedSig = sigBytes.toString("base64");
  assert.notEqual(corruptedSig, sig, "sanity: corruption must actually change the wire value");

  const payload: VerifyPayload = { record, signature: { alg: "ed25519", keyId: generated.keyId, sig: corruptedSig } };
  assert.doesNotThrow(() => evaluateUnalteredSincePushClaim(payload, generated.publicPem));
  const claim = evaluateUnalteredSincePushClaim(payload, generated.publicPem);
  assert.equal(claim.status, "failed");
});

test("FORGE: garbage (non-base64-signature-shaped) sig bytes -> FAILS, does not throw", async () => {
  const dir = await makeTempDir();
  const generated = await generateSigningKeypair(dir);
  const record = makeRecord();
  const payload: VerifyPayload = {
    record,
    signature: { alg: "ed25519", keyId: generated.keyId, sig: "not-a-real-signature-at-all" },
  };
  assert.doesNotThrow(() => evaluateUnalteredSincePushClaim(payload, generated.publicPem));
  const claim = evaluateUnalteredSincePushClaim(payload, generated.publicPem);
  assert.equal(claim.status, "failed");
});

// ---------------------------------------------------------------------------
// 6. Timestamp imprint mismatch -> reject. Build a realistic (CMS-shaped)
// token over digest D, then present it against a record whose digest != D.
// ---------------------------------------------------------------------------

test("FORGE: TSA token's imprint belongs to a different digest than the record -> timestamped FAILS", () => {
  const recordD = makeRecord({ skill: "digest-d" });
  const digestDHex = digestSha256(recordD).replace(/^sha256:/, "");
  const tokenForD = fakeTsaTokenB64For(digestDHex);

  const differentRecord = makeRecord({ skill: "a-completely-different-run" });
  const differentDigestHex = digestSha256(differentRecord).replace(/^sha256:/, "");
  assert.notEqual(differentDigestHex, digestDHex, "sanity: the two records must actually digest differently");

  const payload: VerifyPayload = {
    record: differentRecord,
    timestamp: { tsa: "https://tsa.example", token: tokenForD },
  };
  const claim = evaluateTimestampClaim(payload);
  assert.equal(claim.status, "failed");
  assert.match(claim.line, /IMPRINT MISMATCH/);

  // Direct unit-level confirmation on imprintMatches itself, since that's
  // the actual load-bearing primitive: it must say no for the mismatched
  // digest and yes for the correct one, over the SAME token bytes.
  assert.equal(imprintMatches(tokenForD, differentDigestHex), false);
  assert.equal(imprintMatches(tokenForD, digestDHex), true);
});

test("FORGE: swap the record but keep the old timestamp token -> mismatch caught end-to-end via evaluateVerifyClaims", () => {
  const original = makeRecord({ skill: "original-run" });
  const digestHex = digestSha256(original).replace(/^sha256:/, "");
  const token = fakeTsaTokenB64For(digestHex);

  const swappedIn = makeRecord({ skill: "swapped-in-run", passed: false });
  const payload: VerifyPayload = { record: swappedIn, timestamp: { tsa: "https://tsa.example", token } };
  const result = evaluateVerifyClaims(payload);
  assert.equal(result.exitCode, 1);
  const timestampClaim = result.claims.find((c) => c.claim === "timestamped");
  assert.equal(timestampClaim?.status, "failed");
});

// ---------------------------------------------------------------------------
// 7. Manifest drift -> reject. A tool's live schema changed since the
// manifest was recorded; preflightManifest must name it and flip ok=false.
// ---------------------------------------------------------------------------

test("FORGE: downstream tool schema silently changed since manifest was built -> preflight FAILS and names the tool", () => {
  const recordedConnection = fakeConnection("agency-server", [
    { name: "charge_card", inputSchema: { type: "object", properties: { amountCents: {} } } },
  ]);
  const skill = skillUsing("charge_card");
  const manifest = buildManifestForSkill(skill, [recordedConnection]);

  // A drifted schema — e.g. the tool now silently accepts an extra field
  // (schema-level drift is exactly what a manifest exists to catch, no
  // semantic diffing needed: digest inequality alone is the signal).
  const driftedConnection = fakeConnection("agency-server", [
    { name: "charge_card", inputSchema: { type: "object", properties: { amountCents: {}, skipAuth: {} } } },
  ]);

  const result = preflightManifest(manifest, [driftedConnection]);
  assert.equal(result.ok, false);
  assert.equal(result.drifts.length, 1);
  assert.equal(result.drifts[0].name, "charge_card");
  assert.match(result.drifts[0].note, /schema drifted/);
});

test("FORGE: recorded tool vanished entirely from live downstreams -> preflight FAILS as missing", () => {
  const recordedConnection = fakeConnection("agency-server", [{ name: "send_invoice", inputSchema: { type: "object" } }]);
  const skill = skillUsing("send_invoice");
  const manifest = buildManifestForSkill(skill, [recordedConnection]);

  const emptyConnection = fakeConnection("agency-server", []);
  const result = preflightManifest(manifest, [emptyConnection]);
  assert.equal(result.ok, false);
  assert.match(result.drifts[0].note, /missing: tool not exposed/);
});
