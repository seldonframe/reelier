import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { signAuthorityDigest, verifyAuthoritySignature } from "../../src/authority/crypto.js";
import { authorityDigest } from "../../src/authority/wire.js";

test("authority signatures are purpose-bound and refuse tampering", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const digest = "sha256:" + "a".repeat(64);
  const signature = signAuthorityDigest(privateKey, "outcome-contract", digest);
  assert.equal(verifyAuthoritySignature(publicKey, "outcome-contract", digest, signature), true);
  assert.equal(verifyAuthoritySignature(publicKey, "gate-event", digest, signature), false);
  assert.equal(verifyAuthoritySignature(publicKey, "outcome-contract", "sha256:" + "b".repeat(64), signature), false);
  assert.equal(
    verifyAuthoritySignature(publicKey, "outcome-contract", digest, { ...signature, sig: signature.sig.slice(0, -2) + "xx" }),
    false,
  );
});

test("frozen vectors carry deterministic Ed25519 signatures", () => {
  const publicKey = createPublicKey(`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAa5QRvL1tMishctZLJ/isDZfQF25TUiR0Af0u70V2J6Q=
-----END PUBLIC KEY-----`);
  const vectors = JSON.parse(readFileSync(path.join(process.cwd(), "contract/authority/v1/golden-vectors.json"), "utf8")) as Record<string, { digest: string; signature: { alg: "ed25519"; sig: string } }>;
  for (const [purpose, vector] of Object.entries(vectors)) assert.equal(verifyAuthoritySignature(publicKey, purpose as never, vector.digest, vector.signature), true, purpose);
});

test("standing-authority signatures bind sponsor, audience, target, projection, limits, and policy bytes", () => {
  const publicKey = createPublicKey(`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAa5QRvL1tMishctZLJ/isDZfQF25TUiR0Af0u70V2J6Q=
-----END PUBLIC KEY-----`);
  const vectors = JSON.parse(readFileSync(path.join(process.cwd(), "contract/authority/v1/golden-vectors.json"), "utf8")) as Record<string, { digest: string; signature: { alg: "ed25519"; sig: string }; value: Record<string, unknown> }>;
  const vector = vectors["outcome-contract"];
  const amendedPolicyBytes = Buffer.from('{"channel":"sms","template":"Appointment moved to {{time}}"}', "utf8");
  const amendedPolicyCommitment = {
    ...(vector.value.policyCommitment as object),
    jcsBase64: amendedPolicyBytes.toString("base64"),
    digest: "sha256:" + createHash("sha256").update(amendedPolicyBytes).digest("hex"),
  };
  for (const [field, value] of [["sponsor", "sponsor_2"], ["audiences", ["requester_2"]], ["accountId", "location_2"], ["sourceAuthority", { ...(vector.value.sourceAuthority as object), authorizedProjectionPointers: ["/other"] }], ["limits", { ...(vector.value.limits as object), maxBodyBytes: 1 }], ["policyCommitment", amendedPolicyCommitment]] as const) {
    const tamperedDigest = authorityDigest({ ...vector.value, [field]: value });
    assert.notEqual(tamperedDigest, vector.digest, field);
    assert.equal(verifyAuthoritySignature(publicKey, "outcome-contract", tamperedDigest, vector.signature), false, field);
  }
});
