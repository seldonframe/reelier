import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { signAuthorityDigest, verifyAuthoritySignature } from "../../src/authority/crypto.js";

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
