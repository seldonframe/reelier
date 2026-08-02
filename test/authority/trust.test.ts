import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { signAuthorityDigest } from "../../src/authority/crypto.js";
import { authorityDigest } from "../../src/authority/wire.js";
import { createTrustRoots, verifyTrustedAuthority } from "../../src/authority/trust.js";

const grant = {
  v: "reelier.delegation-grant/v1" as const, tenant: "tenant_1", grantId: "grant_1", parentDigest: null,
  sponsor: "sponsor_1", grantor: "operator_1", grantee: "gate_1", issuedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-02-01T00:00:00.000Z", constraints: {
    definitionAliases: ["definition_1"], audiences: ["requester_1"],
    connectorAccounts: [{ connectorId: "connector_1", accountId: "account_1" }],
    projectionPointers: ["/message"], riskClasses: ["message"],
    limits: { maxEffectsPerWindow: 10, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 },
  },
};

test("trusted authority is tenant-, signer-, principal-, purpose-, digest-, and signature-bound", () => {
  const trusted = generateKeyPairSync("ed25519");
  const other = generateKeyPairSync("ed25519");
  const digest = authorityDigest(grant);
  const signature = signAuthorityDigest(trusted.privateKey, "delegation-grant", digest);
  const roots = createTrustRoots([{ tenant: "tenant_1", signerId: "key_1", principalId: "operator_1", publicKey: trusted.publicKey, purposes: ["delegation-grant"] }]);

  const verified = verifyTrustedAuthority(roots, { tenant: "tenant_1", signerId: "key_1", purpose: "delegation-grant", advertisedDigest: digest, value: grant, signature });
  assert.equal(verified.principalId, "operator_1");
  assert.equal(verified.digest, digest);
  assert.notEqual(verified.value, grant);

  assert.throws(() => verifyTrustedAuthority(roots, { tenant: "tenant_2", signerId: "key_1", purpose: "delegation-grant", advertisedDigest: digest, value: { ...grant, tenant: "tenant_2" }, signature }), /untrusted.*tenant/i);
  assert.throws(() => verifyTrustedAuthority(roots, { tenant: "tenant_1", signerId: "unknown", purpose: "delegation-grant", advertisedDigest: digest, value: grant, signature }), /untrusted signer/i);
  assert.throws(() => verifyTrustedAuthority(roots, { tenant: "tenant_1", signerId: "key_1", purpose: "outcome-contract", advertisedDigest: digest, value: grant as never, signature }), /purpose/i);
  assert.throws(() => verifyTrustedAuthority(roots, { tenant: "tenant_1", signerId: "key_1", purpose: "delegation-grant", advertisedDigest: "sha256:" + "f".repeat(64), value: grant, signature }), /advertised digest/i);
  assert.throws(() => verifyTrustedAuthority(roots, { tenant: "tenant_1", signerId: "key_1", purpose: "delegation-grant", advertisedDigest: digest, value: grant, signature: signAuthorityDigest(other.privateKey, "delegation-grant", digest) }), /signature/i);
});

test("trust roots reject duplicate tenant-qualified signer IDs", () => {
  const key = generateKeyPairSync("ed25519").publicKey;
  const entry = { tenant: "tenant_1", signerId: "key_1", principalId: "operator_1", publicKey: key, purposes: ["delegation-grant"] as const };
  assert.throws(() => createTrustRoots([entry, entry]), /duplicate.*signer/i);
});

test("trust roots are opaque snapshots, not mutable Map wrappers", () => {
  const trusted = generateKeyPairSync("ed25519");
  const attacker = generateKeyPairSync("ed25519");
  const entry = { tenant: "tenant_1", signerId: "key_1", principalId: "operator_1", publicKey: trusted.publicKey, purposes: ["delegation-grant"] as const };
  const roots = createTrustRoots([entry]);
  assert.deepEqual(Object.keys(roots), []);
  assert.equal("entries" in roots, false);
  (entry as { principalId: string }).principalId = "attacker";
  (entry as { publicKey: typeof attacker.publicKey }).publicKey = attacker.publicKey;
  const digest = authorityDigest(grant);
  const verified = verifyTrustedAuthority(roots, { tenant: "tenant_1", signerId: "key_1", purpose: "delegation-grant", advertisedDigest: digest, value: grant, signature: signAuthorityDigest(trusted.privateKey, "delegation-grant", digest) });
  assert.equal(verified.principalId, "operator_1");
});
