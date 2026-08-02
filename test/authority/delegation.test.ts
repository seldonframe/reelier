import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { signAuthorityDigest } from "../../src/authority/crypto.js";
import { authorityDigest } from "../../src/authority/wire.js";
import type { DelegationGrant } from "../../src/authority/types.js";
import { createTrustRoots } from "../../src/authority/trust.js";
import { validateDelegationChain, validateContractAgainstDelegation, type StoredSignedGrant } from "../../src/authority/delegation.js";

const now = new Date("2026-01-15T00:00:00.000Z");
const limits = { maxEffectsPerWindow: 10, windowSeconds: 3600, maxEffectsPerSourceTrigger: 2, maxBodyBytes: 4096 };
const constraints = { definitionAliases: ["definition_1", "definition_2"], audiences: ["requester_1", "requester_2"], connectorAccounts: [{ connectorId: "connector_1", accountId: "account_1" }], projectionPointers: ["/message", "/recipient"], riskClasses: ["message", "profile"], limits };
const root = { v: "reelier.delegation-grant/v1" as const, tenant: "tenant_1", grantId: "root", parentDigest: null, sponsor: "sponsor_1", grantor: "operator_1", grantee: "delegate_1", issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", constraints };

function signed(grant: DelegationGrant, signerId: string, privateKey: KeyObject): StoredSignedGrant {
  const digest = authorityDigest(grant);
  return { grant, digest, signerId, signature: signAuthorityDigest(privateKey, "delegation-grant", digest) };
}

function fixture() {
  const operator = generateKeyPairSync("ed25519");
  const delegate = generateKeyPairSync("ed25519");
  const roots = createTrustRoots([
    { tenant: "tenant_1", signerId: "operator_key", principalId: "operator_1", publicKey: operator.publicKey, purposes: ["delegation-grant"] },
    { tenant: "tenant_1", signerId: "delegate_key", principalId: "delegate_1", publicKey: delegate.publicKey, purposes: ["delegation-grant", "outcome-contract"] },
  ]);
  const rootSigned = signed(root, "operator_key", operator.privateKey);
  const child = { ...root, grantId: "child", parentDigest: rootSigned.digest, grantor: "delegate_1", grantee: "gate_1", issuedAt: "2026-01-02T00:00:00.000Z", expiresAt: "2026-01-31T00:00:00.000Z", constraints: { definitionAliases: ["definition_1"], audiences: ["requester_1"], connectorAccounts: constraints.connectorAccounts, projectionPointers: ["/message"], riskClasses: ["message"], limits: { ...limits, maxEffectsPerWindow: 5, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 2048 } } };
  return { roots, operator, delegate, rootSigned, child, childSigned: signed(child, "delegate_key", delegate.privateKey) };
}

test("a root-first delegation chain validates linkage, principals, sponsor, tenant, time, and attenuation", () => {
  const f = fixture();
  const chain = validateDelegationChain({ tenant: "tenant_1", sponsor: "sponsor_1", now, trustRoots: f.roots, grants: [f.rootSigned, f.childSigned] });
  assert.equal(chain.leafDigest, f.childSigned.digest);
  assert.equal(chain.leafGrantee, "gate_1");

  const childMutations: [string, (child: typeof f.child) => DelegationGrant][] = [
    ["definition", c => ({ ...c, constraints: { ...c.constraints, definitionAliases: ["definition_3"] } })],
    ["audience", c => ({ ...c, constraints: { ...c.constraints, audiences: ["requester_3"] } })],
    ["connector", c => ({ ...c, constraints: { ...c.constraints, connectorAccounts: [{ connectorId: "connector_2", accountId: "account_1" }] } })],
    ["projection", c => ({ ...c, constraints: { ...c.constraints, projectionPointers: ["/recipient", "/extra"] } })],
    ["risk", c => ({ ...c, constraints: { ...c.constraints, riskClasses: ["profile", "unknown"] } })],
    ["max effects", c => ({ ...c, constraints: { ...c.constraints, limits: { ...c.constraints.limits, maxEffectsPerWindow: 11 } } })],
    ["per trigger", c => ({ ...c, constraints: { ...c.constraints, limits: { ...c.constraints.limits, maxEffectsPerSourceTrigger: 3 } } })],
    ["body bytes", c => ({ ...c, constraints: { ...c.constraints, limits: { ...c.constraints.limits, maxBodyBytes: 4097 } } })],
    ["fixed window", c => ({ ...c, constraints: { ...c.constraints, limits: { ...c.constraints.limits, windowSeconds: 1800 } } })],
  ];
  for (const [label, mutate] of childMutations) {
    const amended = mutate(f.child);
    assert.throws(() => validateDelegationChain({ tenant: "tenant_1", sponsor: "sponsor_1", now, trustRoots: f.roots, grants: [f.rootSigned, signed(amended, "delegate_key", f.delegate.privateKey)] }), /widen|window/i, label);
  }
});

test("delegation refuses broken links, wrong signer/grantor, drift, invalid time, duplicates, cycles, and missing leaf", () => {
  const f = fixture();
  const check = (child: typeof f.child, signerId = "delegate_key", key = f.delegate.privateKey) => validateDelegationChain({ tenant: "tenant_1", sponsor: "sponsor_1", now, trustRoots: f.roots, grants: [f.rootSigned, signed(child, signerId, key)] });
  assert.throws(() => check({ ...f.child, parentDigest: "sha256:" + "0".repeat(64) }), /parent digest/i);
  assert.throws(() => check({ ...f.child, grantor: "operator_1" }), /grantee.*grantor|signer principal/i);
  assert.throws(() => check(f.child, "operator_key", f.operator.privateKey), /signer principal/i);
  assert.throws(() => check({ ...f.child, sponsor: "sponsor_2" }), /sponsor/i);
  assert.throws(() => check({ ...f.child, tenant: "tenant_2" }), /tenant/i);
  assert.throws(() => check({ ...f.child, issuedAt: "2025-12-31T00:00:00.000Z" }), /validity.*parent/i);
  assert.throws(() => check({ ...f.child, expiresAt: "2026-02-02T00:00:00.000Z" }), /validity.*parent/i);
  assert.throws(() => validateDelegationChain({ tenant: "tenant_1", sponsor: "sponsor_1", now, trustRoots: f.roots, grants: [] }), /at least one|leaf/i);
  assert.throws(() => validateDelegationChain({ tenant: "tenant_1", sponsor: "sponsor_1", now, trustRoots: f.roots, grants: [f.rootSigned, f.rootSigned] }), /duplicate/i);
  const cycle = { ...f.child, parentDigest: f.childSigned.digest };
  assert.throws(() => check(cycle), /cycle|parent digest/i);
  assert.throws(() => validateDelegationChain({ tenant: "tenant_1", sponsor: "sponsor_1", now: new Date("2026-03-01T00:00:00.000Z"), trustRoots: f.roots, grants: [f.rootSigned] }), /current validity/i);
});

test("the contract must fit and bind the leaf grant in every delegated dimension", () => {
  const f = fixture();
  const chain = validateDelegationChain({ tenant: "tenant_1", sponsor: "sponsor_1", now, trustRoots: f.roots, grants: [f.rootSigned, f.childSigned] });
  const contract = { tenant: "tenant_1", sponsor: "sponsor_1", delegationGrantDigest: f.childSigned.digest, alias: "definition_1", audiences: ["requester_1"], connectorId: "connector_1", accountId: "account_1", sourceAuthority: { authorizedProjectionPointers: ["/message"] }, riskClasses: ["message"], limits: f.child.constraints.limits, validFrom: "2026-01-03T00:00:00.000Z", validUntil: "2026-01-30T00:00:00.000Z" };
  assert.doesNotThrow(() => validateContractAgainstDelegation(contract, chain));
  for (const [label, amended] of [
    ["leaf", { delegationGrantDigest: f.rootSigned.digest }], ["tenant", { tenant: "tenant_2" }], ["sponsor", { sponsor: "sponsor_2" }],
    ["definition", { alias: "definition_2" }], ["audience", { audiences: ["requester_2"] }], ["account", { accountId: "account_2" }],
    ["projection", { sourceAuthority: { authorizedProjectionPointers: ["/recipient"] } }], ["risk", { riskClasses: ["profile"] }],
    ["limits", { limits: { ...f.child.constraints.limits, maxBodyBytes: 4096 } }], ["validity", { validUntil: "2026-02-01T00:00:00.000Z" }],
  ] as const) assert.throws(() => validateContractAgainstDelegation({ ...contract, ...amended } as Parameters<typeof validateContractAgainstDelegation>[0], chain), /leaf|tenant|sponsor|definition|audience|connector|projection|risk|limit|validity/i, label);
});
