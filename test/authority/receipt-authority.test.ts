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

const phases = ["reservation", "dispatch", "cancelled", "ambiguous", "reconcile"] as const;
const purposes = ["source-bundle", "compiled-capability", "transport-effect", "authority-evidence", "authority-receipt", "pack-manifest"] as const;

test("receipt construction exposes exactly six purpose-bound signers and five phases", () => {
  profileGovernanceFixture();
  const kinds: readonly ProducedReceiptKindV1[] = purposes;
  assert.deepEqual(kinds, purposes);
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
  for (const forged of [raw, { ...raw }, Object.freeze({ ...raw }), new Proxy(raw, {})]) {
    await assert.rejects(() => constructAuthorityReceiptBundle({ phase: "reservation", signingAuthority: forged } as never), /validated signing authority/i);
  }
  assert.equal(signs, 0);
});
