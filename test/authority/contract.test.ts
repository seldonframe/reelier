import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { signAuthorityDigest } from "../../src/authority/crypto.js";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import { createTrustRoots } from "../../src/authority/trust.js";
import { validateDelegationChain } from "../../src/authority/delegation.js";
import { validateStoredContract, isValidatedContract, type ContractStateEvent } from "../../src/authority/contract.js";

function fixture() {
  const operator = generateKeyPairSync("ed25519");
  const gate = generateKeyPairSync("ed25519");
  const limits = { maxEffectsPerWindow: 10, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 };
  const constraints = { definitionAliases: ["definition_1"], audiences: ["requester_1"], connectorAccounts: [{ connectorId: "connector_1", accountId: "account_1" }], projectionPointers: ["/message"], riskClasses: ["message"], limits };
  const grant = { v: "reelier.delegation-grant/v1" as const, tenant: "tenant_1", grantId: "root", parentDigest: null, sponsor: "sponsor_1", grantor: "operator_1", grantee: "gate_1", issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", constraints };
  const grantDigest = authorityDigest(grant);
  const roots = createTrustRoots([
    { tenant: "tenant_1", signerId: "operator_key", principalId: "operator_1", publicKey: operator.publicKey, purposes: ["delegation-grant"] },
    { tenant: "tenant_1", signerId: "gate_key", principalId: "gate_1", publicKey: gate.publicKey, purposes: ["outcome-contract"] },
  ]);
  const chain = validateDelegationChain({ tenant: "tenant_1", sponsor: "sponsor_1", now: new Date("2026-01-15T00:00:00.000Z"), trustRoots: roots, grants: [{ grant, digest: grantDigest, signerId: "operator_key", signature: signAuthorityDigest(operator.privateKey, "delegation-grant", grantDigest) }] });
  const policyBytes = authorityCanonicalBytes({ template: "Hello {{message}}" });
  const contract = { v: "reelier.outcome-contract/v1" as const, tenant: "tenant_1", alias: "definition_1", contractId: "contract_1", validFrom: "2026-01-02T00:00:00.000Z", validUntil: "2026-01-31T00:00:00.000Z", packDigest: "sha256:" + "a".repeat(64), definitionDigest: "sha256:" + "b".repeat(64), sponsor: "sponsor_1", audiences: ["requester_1"], delegationGrantDigest: grantDigest, connectorId: "connector_1", accountId: "account_1", sourceAuthority: { resolverId: "resolver_1", projectionSchemaId: "projection/v1", allowedReadEndpointIds: ["read_1"], authorizedProjectionPointers: ["/message"] }, riskClasses: ["message"], limits, policyCommitment: { schemaId: "policy/v1", jcsBase64: policyBytes.toString("base64"), digest: authorityDigest(JSON.parse(policyBytes.toString("utf8"))) } };
  const digest = authorityDigest(contract);
  return { roots, gate, chain, contract, digest, stored: { contract, digest, signerId: "gate_key", signature: signAuthorityDigest(gate.privateKey, "outcome-contract", digest) }, registry: new Map([["definition_1", { packDigest: contract.packDigest, definitionDigest: contract.definitionDigest }]]) };
}

function validate(f: ReturnType<typeof fixture>, events: ContractStateEvent[] = [{ kind: "activated", contractDigest: f.digest, at: "2026-01-03T00:00:00.000Z" }], requester = "requester_1", now = new Date("2026-01-15T00:00:00.000Z")) {
  return validateStoredContract({ stored: f.stored, trustRoots: f.roots, delegation: f.chain, registeredDefinitions: f.registry, stateEvents: events, tenant: "tenant_1", requester, now });
}

test("a stored contract validates immutable authority, activation, audience, registration, and signer principal", () => {
  const f = fixture();
  const validated = validate(f);
  assert.equal(isValidatedContract(validated), true);
  assert.equal(validated.digest, f.digest);
  assert.equal(Object.isFrozen(validated.contract), true);
  assert.notEqual(validated.contract, f.contract);

  assert.throws(() => validate(f, [], "requester_1"), /inactive/i);
  assert.throws(() => validate(f, [{ kind: "activated", contractDigest: f.digest, at: "2026-01-03T00:00:00.000Z" }, { kind: "revoked", contractDigest: f.digest, at: "2026-01-10T00:00:00.000Z" }]), /revoked/i);
  assert.throws(() => validate(f, undefined, "requester_2"), /audience/i);
  assert.throws(() => validate(f, undefined, "requester_1", new Date("2026-01-01T00:00:00.000Z")), /not yet valid/i);
  assert.throws(() => validate(f, undefined, "requester_1", new Date("2026-02-01T00:00:00.000Z")), /expired/i);
});

test("contract validation refuses tampering, wrong purpose/trust/tenant, state disorder, and registered drift", () => {
  const f = fixture();
  const changed = { ...f.contract, accountId: "account_2" };
  assert.throws(() => validateStoredContract({ stored: { ...f.stored, contract: changed }, trustRoots: f.roots, delegation: f.chain, registeredDefinitions: f.registry, stateEvents: [{ kind: "activated", contractDigest: f.digest, at: "2026-01-03T00:00:00.000Z" }], tenant: "tenant_1", requester: "requester_1", now: new Date("2026-01-15T00:00:00.000Z") }), /advertised digest/i);
  assert.throws(() => validateStoredContract({ stored: f.stored, trustRoots: f.roots, delegation: f.chain, registeredDefinitions: new Map([["definition_1", { packDigest: "sha256:" + "c".repeat(64), definitionDigest: f.contract.definitionDigest }]]), stateEvents: [{ kind: "activated", contractDigest: f.digest, at: "2026-01-03T00:00:00.000Z" }], tenant: "tenant_1", requester: "requester_1", now: new Date("2026-01-15T00:00:00.000Z") }), /registered.*digest/i);
  assert.throws(() => validate(f, [{ kind: "revoked", contractDigest: f.digest, at: "2026-01-02T00:00:00.000Z" }, { kind: "activated", contractDigest: f.digest, at: "2026-01-03T00:00:00.000Z" }]), /append-only|activation.*first/i);
  assert.throws(() => validate(f, [{ kind: "activated", contractDigest: f.digest, at: "2026-01-03T00:00:00.000Z" }, { kind: "activated", contractDigest: f.digest, at: "2026-01-04T00:00:00.000Z" }]), /duplicate activation/i);

  const wrongTenant = { ...f.stored, contract: { ...f.contract, tenant: "tenant_2" } };
  const wrongDigest = authorityDigest(wrongTenant.contract);
  assert.throws(() => validateStoredContract({ stored: { ...wrongTenant, digest: wrongDigest, signature: signAuthorityDigest(f.gate.privateKey, "outcome-contract", wrongDigest) }, trustRoots: f.roots, delegation: f.chain, registeredDefinitions: f.registry, stateEvents: [], tenant: "tenant_2", requester: "requester_1", now: new Date("2026-01-15T00:00:00.000Z") }), /untrusted.*tenant|tenant/i);
});

test("contract validation refuses forged, copied, or structurally mutated delegation authority", () => {
  const f = fixture();
  const forged = {
    grants: [...f.chain.grants], digests: [...f.chain.digests], leaf: f.chain.leaf,
    leafDigest: f.chain.leafDigest, leafGrantee: f.chain.leafGrantee,
  };
  const input = { stored: f.stored, trustRoots: f.roots, registeredDefinitions: f.registry, stateEvents: [{ kind: "activated" as const, contractDigest: f.digest, at: "2026-01-03T00:00:00.000Z" }], tenant: "tenant_1", requester: "requester_1", now: new Date("2026-01-15T00:00:00.000Z") };
  assert.throws(() => validateStoredContract({ ...input, delegation: forged as never }), /validated delegation/i);
  assert.throws(() => validateStoredContract({ ...input, delegation: { ...f.chain } as never }), /validated delegation/i);
  assert.throws(() => validateStoredContract({ ...input, delegation: structuredClone(f.chain) as never }), /validated delegation/i);
  assert.throws(() => { (f.chain as { leafGrantee: string }).leafGrantee = "attacker"; }, /read only|Cannot assign/i);
  assert.doesNotThrow(() => validateStoredContract({ ...input, delegation: f.chain }));
});
