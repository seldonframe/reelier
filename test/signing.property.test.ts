// Property-based invariants over the sign/verify round-trip — Ed25519
// keygen is slow, so keys are generated ONCE (module-level setup) and reused
// across every property run; only sign/verify happens inside each case.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  generateSigningKeypair,
  loadSigningKey,
  signRecordDigest,
  verifyRecordSignature,
} from "../src/signing.js";
import { digestSha256 } from "../src/canonical-json.js";
import type { KeyObject } from "node:crypto";

let dirA: string;
let dirB: string;
let publicPemA: string;
let publicPemB: string;
let privateKeyA: KeyObject;

before(async () => {
  dirA = await mkdtemp(path.join(os.tmpdir(), "reelier-sign-a-"));
  dirB = await mkdtemp(path.join(os.tmpdir(), "reelier-sign-b-"));

  const genA = await generateSigningKeypair(dirA);
  const genB = await generateSigningKeypair(dirB);
  publicPemA = genA.publicPem;
  publicPemB = genB.publicPem;

  const loadedA = await loadSigningKey(dirA);
  assert.ok(loadedA, "expected keypair A to load");
  privateKeyA = loadedA.privateKey;
});

after(async () => {
  await rm(dirA, { recursive: true, force: true });
  await rm(dirB, { recursive: true, force: true });
});

test("property: sign/verify round-trips for arbitrary payloads", () => {
  fc.assert(
    fc.property(fc.jsonValue(), (payload) => {
      const digest = digestSha256(payload);
      const sig = signRecordDigest(privateKeyA, digest);
      return verifyRecordSignature(publicPemA, digest, sig) === true;
    })
  );
});

test("property: a signature over one digest does not verify against a different digest", () => {
  fc.assert(
    fc.property(fc.jsonValue(), fc.jsonValue(), (p1, p2) => {
      const d1 = digestSha256(p1);
      const d2 = digestSha256(p2);
      fc.pre(d1 !== d2);
      const sig = signRecordDigest(privateKeyA, d1);
      return verifyRecordSignature(publicPemA, d2, sig) === false;
    })
  );
});

test("property: a signature made with one keypair does not verify against another keypair's public key", () => {
  fc.assert(
    fc.property(fc.jsonValue(), (payload) => {
      const digest = digestSha256(payload);
      const sig = signRecordDigest(privateKeyA, digest);
      return verifyRecordSignature(publicPemB, digest, sig) === false;
    })
  );
});

// Base64 alphabet used to pick a deliberately-different replacement char.
const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function flipOneChar(sig: string, index: number): string {
  const pos = index % sig.length;
  const original = sig[pos];
  // Pick a replacement guaranteed to differ from the original char.
  const replacement = BASE64_CHARS.split("").find((c) => c !== original) ?? "A";
  return sig.slice(0, pos) + replacement + sig.slice(pos + 1);
}

test("property: flipping one character of the signature is rejected, never throws", () => {
  fc.assert(
    fc.property(fc.jsonValue(), fc.nat(), (payload, idx) => {
      const digest = digestSha256(payload);
      const sig = signRecordDigest(privateKeyA, digest);
      fc.pre(sig.length > 0);
      const tampered = flipOneChar(sig, idx);
      fc.pre(tampered !== sig); // guard the rare case the flip is a no-op
      // Base64's final "quantum" before `==` padding has unused low bits
      // (a 1-leftover-byte group encodes 8 meaningful bits in 12 available
      // bits). A flip confined to those don't-care bits changes the STRING
      // but decodes to the identical signature bytes — correctly still
      // verifies. Compare decoded bytes, not strings, to only exercise
      // genuine tampering.
      fc.pre(!Buffer.from(tampered, "base64").equals(Buffer.from(sig, "base64")));

      let result: boolean;
      assert.doesNotThrow(() => {
        result = verifyRecordSignature(publicPemA, digest, tampered);
      });
      return result! === false;
    })
  );
});
