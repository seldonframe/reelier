import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  constructAuthorityReceiptBundle,
  validateAuthorityReceiptSigningAuthority,
  type AuthorityReceiptSigningAuthorityV1,
  type ProducedReceiptKindV1,
} from "../../src/authority/host/receipt-authority.js";
import { profileGovernanceFixture } from "./profile-governance-fixture.js";
import { authorityDigest } from "../../src/authority/wire.js";
import { createCertificationArtifactKeyBinding, createCertificationLifecycleAuthorityCeremony, verifyCertificationArtifactKeyBinding } from "../../src/authority/certification/lifecycle-authority.js";

const phases = ["reservation", "dispatch", "cancelled", "ambiguous", "reconcile"] as const;
const purposes = ["source-bundle", "compiled-capability", "transport-effect", "authority-evidence", "authority-receipt", "pack-manifest"] as const;
const producedProperties = ["sourceBundle", "compiledCapability", "transportEffect", "evidence", "receipt", "packManifest"] as const;

test("produced receipt kinds name the six generated bundle properties, not wire purposes", () => {
  profileGovernanceFixture();
  const kinds: readonly ProducedReceiptKindV1[] = producedProperties;
  assert.deepEqual(kinds, producedProperties);
  assert.deepEqual(phases, ["reservation", "dispatch", "cancelled", "ambiguous", "reconcile"]);
});

test("raw callbacks and structural validation handles cannot construct authority receipts", async () => {
  const key = generateKeyPairSync("ed25519");
  let signs = 0;
  const signer = (purpose: typeof purposes[number], signerId: string) => ({ purpose, signerId, publicKey: key.publicKey, async sign() { signs += 1; throw new Error("must not sign"); } });
  const raw = {
    artifactAuthorization: { binding: {}, commitment: {} },
    sourceBundle: signer("source-bundle", "source"),
    compiledCapability: signer("compiled-capability", "compiled"),
    transportEffect: signer("transport-effect", "transport"),
    evidence: signer("authority-evidence", "evidence"),
    receipt: signer("authority-receipt", "receipt"),
    packManifest: signer("pack-manifest", "manifest"),
  } as unknown as AuthorityReceiptSigningAuthorityV1;
  assert.throws(() => validateAuthorityReceiptSigningAuthority({ trustView: Object.freeze({}), signingAuthority: raw, segregation: Object.freeze({ mode: "governed" }) } as never), /trust view|validated|admitted/i);
  for (const phase of phases) for (const forged of [raw, { ...raw }, Object.freeze({ ...raw }), new Proxy(raw, {})]) await assert.rejects(
    () => constructAuthorityReceiptBundle({ phase, signingAuthority: forged } as never),
    /validated signing authority/i,
    `${phase} must enter the production constructor and reject an unvalidated authority before signing`,
  );
  assert.equal(signs, 0);
});

test("artifact subkeys are authorized only by the active evidence descriptor that signs the receipt", () => {
  const ceremony = createCertificationLifecycleAuthorityCeremony();
  const humanKey = generateKeyPairSync("ed25519");
  const human: any = { v: "reelier.authority-key-descriptor/v1", keyId: "human_ready", role: "human-sponsor", purpose: "certification-readiness", algorithm: "ed25519", publicKeySpkiBase64: humanKey.publicKey.export({ type: "spki", format: "der" }).toString("base64") };
  const signedReadiness = { fixture: "readiness" };
  const authorization = createCertificationArtifactKeyBinding(ceremony.opaqueHandle, { authorityCellId: "cell_1", taskId: "task_1", readinessDigest: authorityDigest(signedReadiness), humanDescriptor: human, humanPrivateKey: humanKey.privateKey, issuedAt: "2026-08-14T10:00:00.000Z", expiresAt: "2026-08-14T14:00:00.000Z" });
  const actualParent = ceremony.publicDescriptors.find(item => authorityDigest(item) === authorization.binding.parentEvidenceDescriptorDigest)!;
  const alternateKey = generateKeyPairSync("ed25519");
  const alternate: any = { v: "reelier.authority-key-descriptor/v1", keyId: "alternate_evidence", role: "authority-cell", purpose: "authority-evidence", algorithm: "ed25519", publicKeySpkiBase64: alternateKey.publicKey.export({ type: "spki", format: "der" }).toString("base64") };
  const verify = verifyCertificationArtifactKeyBinding as any;
  assert.throws(() => verify(authorization.binding, authorization.humanCommitment, { descriptors: [...ceremony.publicDescriptors, alternate, human], signedReadiness, now: new Date("2026-08-14T12:00:00.000Z"), expectedParentEvidenceDescriptor: alternate, activeDescriptorDigests: new Set([authorityDigest(alternate)]) }), /parent|evidence|active|revoked/i);
  assert.notEqual(authorityDigest(actualParent), authorityDigest(alternate));
});
