import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { signAuthorityDigest, verifyAuthoritySignature } from "../../src/authority/crypto.js";

test("authority signatures are purpose-bound and refuse tampering", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const wrongPurposeKey = generateKeyPairSync("ed25519").publicKey;
  const digest = "sha256:" + "a".repeat(64);
  const signature = signAuthorityDigest(privateKey, "outcome-contract", digest);
  assert.equal(verifyAuthoritySignature(publicKey, "outcome-contract", digest, signature), true);
  assert.equal(verifyAuthoritySignature(wrongPurposeKey, "gate-event", digest, signature), false);
  assert.equal(verifyAuthoritySignature(publicKey, "outcome-contract", "sha256:" + "b".repeat(64), signature), false);
  assert.equal(
    verifyAuthoritySignature(publicKey, "outcome-contract", digest, { ...signature, sig: signature.sig.slice(0, -2) + "xx" }),
    false,
  );
});
