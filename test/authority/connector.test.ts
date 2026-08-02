import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createConnectorRegistry, connectorRegistrationDigest, lookupConnectorRegistration } from "../../src/authority/connector.js";
import { createTrustRoots, trustRootSetDigest, authoritySignatureDigest } from "../../src/authority/trust.js";
import { createStaticPackRegistry, definitionRegistrationDigest, type StaticPackDefinition } from "../../src/authority/pack.js";
import { createSourceRegistry, sourceResolverRegistrationDigest, type RegisteredSourceResolver } from "../../src/authority/source.js";

const sha = (character: string) => `sha256:${character.repeat(64)}`;

test("connector registrations are closed, tenant-scoped, sorted, detached, and non-secret", () => {
  const registration = {
    tenant: "tenant_1", connectorId: "connector_1", accountId: "account_1", providerAccountIdentity: "provider-account-1",
    allowedReadEndpointIds: ["read_z", "read_a"], allowedWriteEndpointIds: ["write_z", "write_a"],
    riskClasses: ["zeta", "alpha"], operatorConfigurationDigest: sha("a"),
  };
  const registry = createConnectorRegistry([registration]);
  registration.allowedReadEndpointIds[0] = "mutated";
  const snapshot = lookupConnectorRegistration(registry, "tenant_1", "connector_1", "account_1");
  assert.deepEqual(snapshot?.allowedReadEndpointIds, ["read_a", "read_z"]);
  assert.deepEqual(snapshot?.allowedWriteEndpointIds, ["write_a", "write_z"]);
  assert.deepEqual(snapshot?.riskClasses, ["alpha", "zeta"]);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(connectorRegistrationDigest(registry, "tenant_1", "connector_1", "account_1"), "sha256:b7d1d14db41d927b1b7da7351fa05a73aee186f3a67a5516556eca30e7aad8c5");
  assert.equal(lookupConnectorRegistration(registry, "tenant_2", "connector_1", "account_1"), undefined);

  for (const extra of [{ credential: "secret" }, { callback: () => undefined }, { url: "https://example.test" }]) {
    assert.throws(() => createConnectorRegistry([{ ...registration, ...extra }]), /closed|property|field/i);
  }
  assert.throws(() => createConnectorRegistry([{ ...registration, allowedWriteEndpointIds: ["read_a"] }]), /ambigu|duplicate/i);
  assert.throws(() => connectorRegistrationDigest({} as never, "tenant_1", "connector_1", "account_1"), /unrecognized/i);
});

test("trust, definition, resolver, and signature commitments bind sorted closed registrations", () => {
  const first = generateKeyPairSync("ed25519");
  const second = generateKeyPairSync("ed25519");
  const roots = createTrustRoots([
    { tenant: "tenant_1", signerId: "signer_z", principalId: "operator_z", publicKey: second.publicKey, purposes: ["outcome-contract", "delegation-grant"] },
    { tenant: "tenant_1", signerId: "signer_a", principalId: "operator_a", publicKey: first.publicKey, purposes: ["delegation-grant"] },
  ]);
  assert.match(trustRootSetDigest(roots, "tenant_1"), /^sha256:(?!0{64}$)[0-9a-f]{64}$/);
  assert.notEqual(trustRootSetDigest(roots, "tenant_1"), trustRootSetDigest(createTrustRoots([
    { tenant: "tenant_1", signerId: "signer_a", principalId: "changed", publicKey: first.publicKey, purposes: ["delegation-grant"] },
  ]), "tenant_1"));

  const definition = {
    alias: "definition_1", packDigest: sha("1"), definitionDigest: sha("2"), resolverId: "resolver_1", projectionSchemaId: "projection/v1", maxFreshnessSeconds: 60,
    readEndpointIds: ["read_z", "read_a"], writeEndpointIds: ["write_1"], riskClasses: ["message"], policySchemaId: "policy/v1", requiredGroundedPointers: ["/z", "/a"],
    validateChoices: (value: unknown) => value, parsePolicy: (value: unknown) => value, compile: () => ({}),
  } satisfies StaticPackDefinition;
  const packs = createStaticPackRegistry([definition]);
  assert.match(definitionRegistrationDigest(packs, "definition_1"), /^sha256:(?!0{64}$)[0-9a-f]{64}$/);
  assert.throws(() => createStaticPackRegistry([{ ...definition, credential: "secret" } as never]), /closed|field|property/i);
  assert.throws(() => createStaticPackRegistry([{ ...definition, definitionDigest: sha("0") }]), /zero|digest/i);

  const resolver = {
    tenant: "tenant_1", resolverId: "resolver_1", definitionDigest: sha("2"), projectionSchemaId: "projection/v1", readEndpointIds: ["read_z", "read_a"], maxFreshnessSeconds: 60,
    plan: () => [{ endpointId: "read_a", opaqueHandle: "ref_1" }], project: () => ({ sourceIdentity: "source", triggerIdentity: "trigger", projection: { a: 1 }, claims: { grounded: [{ claimId: "a", projectionPointer: "/a" }], authored: [], unresolved: [] } }),
  } satisfies RegisteredSourceResolver;
  const sources = createSourceRegistry([resolver]);
  assert.match(sourceResolverRegistrationDigest(sources, "tenant_1", "resolver_1"), /^sha256:(?!0{64}$)[0-9a-f]{64}$/);
  assert.throws(() => sourceResolverRegistrationDigest(sources, "tenant_2", "resolver_1"), /missing|unknown/i);
  assert.throws(() => createSourceRegistry([{ ...resolver, credential: "secret" } as never]), /closed|field|property/i);
  assert.throws(() => createSourceRegistry([{ ...resolver, definitionDigest: sha("0") }]), /zero|digest/i);

  assert.match(authoritySignatureDigest({ alg: "ed25519", sig: Buffer.alloc(64, 7).toString("base64") }), /^sha256:(?!0{64}$)[0-9a-f]{64}$/);
  assert.throws(() => authoritySignatureDigest({ alg: "ed25519", sig: "AA==" }), /64|signature/i);
});
