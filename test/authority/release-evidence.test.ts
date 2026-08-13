import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { signReleaseEvidenceManifest, verifyReleaseEvidenceManifest, type ReleaseEvidenceManifest } from "../../src/authority/host/release-evidence.js";

const manifest: ReleaseEvidenceManifest = {
  v: "reelier.release-evidence/v1",
  package: { version: "0.32.0", tarballDigest: "sha256:" + "a".repeat(64) },
  cloud: { deploymentId: "dpl_1", deploymentDigest: "sha256:" + "b".repeat(64), migrationsDigest: "sha256:" + "c".repeat(64) },
  tests: [{ name: "authority", status: "passed", digest: "sha256:" + "d".repeat(64) }],
  topologyEvidenceDigest: "sha256:" + "e".repeat(64),
  providerEvidence: ["sha256:" + "f".repeat(64)],
  dogfoodGraphDigest: "sha256:" + "1".repeat(64),
};

test("release evidence signs and verifies the canonical manifest", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signed = signReleaseEvidenceManifest(manifest, { signerId: "cell", privateKey });
  const verified = verifyReleaseEvidenceManifest(signed, { signerId: "cell", publicKey });
  assert.equal(verified.digest, signed.digest);
  assert.equal(verified.manifest.package.version, "0.32.0");
});

test("release evidence rejects manifest substitution and signature-purpose confusion", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signed = signReleaseEvidenceManifest(manifest, { signerId: "cell", privateKey });
  assert.throws(() => verifyReleaseEvidenceManifest({ ...signed, manifest: { ...manifest, cloud: { ...manifest.cloud, deploymentId: "tampered" } } }, { signerId: "cell", publicKey }), /digest mismatch/);
  assert.throws(() => verifyReleaseEvidenceManifest({ ...signed, signature: { alg: "ed25519", sig: signed.signature.sig } }, { signerId: "cell", publicKey, purpose: "authority-receipt" }), /purpose/);
});
