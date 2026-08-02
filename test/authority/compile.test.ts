import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import { signAuthorityDigest } from "../../src/authority/crypto.js";
import { createTrustRoots } from "../../src/authority/trust.js";
import { validateDelegationChain } from "../../src/authority/delegation.js";
import { validateStoredContract } from "../../src/authority/contract.js";
import { createSourceRegistry, validateSourceBundle } from "../../src/authority/source.js";
import * as publicAuthority from "../../src/authority/index.js";
import { assertStaticFirstPartySourcesConform, createStaticPackRegistry, registeredDefinitionDigests, type StaticPackDefinition } from "../../src/authority/pack.js";
import { compileOutcome, deriveSemanticOutcomeKey } from "../../src/authority/compile.js";

const packDigest = "sha256:" + "a".repeat(64);
const definitionDigest = "sha256:" + "b".repeat(64);
const now = new Date("2026-01-15T00:00:30.000Z");

function definition(overrides: Partial<StaticPackDefinition> = {}): StaticPackDefinition {
  return {
    alias: "definition_1", packDigest, definitionDigest, resolverId: "resolver_1", projectionSchemaId: "projection/v1",
    readEndpointIds: ["read_1"], writeEndpointIds: ["write_1"], riskClasses: ["message"], policySchemaId: "policy/v1",
    requiredGroundedPointers: ["/message"],
    validateChoices(value) {
      const choices = value as Record<string, unknown>;
      if (Object.keys(choices).some(key => key !== "urgent") || (choices.urgent !== undefined && typeof choices.urgent !== "boolean")) throw new TypeError("invalid bounded choices");
      return Object.freeze({ urgent: choices.urgent === true });
    },
    parsePolicy(value) {
      const policy = value as Record<string, unknown>;
      if (typeof policy.template !== "string" || Object.keys(policy).length !== 1) throw new TypeError("invalid policy schema");
      return Object.freeze({ template: policy.template });
    },
    compile({ policy, source, choices }) {
      const body = authorityCanonicalBytes({ message: String((policy as { template: string }).template).replace("{{message}}", String(source.projection.message)), urgent: (choices as { urgent: boolean }).urgent });
      return { v: "reelier.transport-effect/v1", endpointId: "write_1", method: "POST", path: "/v1/messages", query: "account=account_1&mode=send", headers: { "Content-Type": "application/json" }, bodyBase64: body.toString("base64"), riskClass: "message", idempotency: "native", preconditions: [], reconciliation: { recipeId: "message_readback" } };
    },
    ...overrides,
  };
}

function fixture(def = definition()) {
  const operator = generateKeyPairSync("ed25519");
  const gate = generateKeyPairSync("ed25519");
  const limits = { maxEffectsPerWindow: 10, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 };
  const constraints = { definitionAliases: ["definition_1"], audiences: ["requester_1"], connectorAccounts: [{ connectorId: "connector_1", accountId: "account_1" }], projectionPointers: ["/message"], riskClasses: ["message"], limits };
  const grant = { v: "reelier.delegation-grant/v1" as const, tenant: "tenant_1", grantId: "root", parentDigest: null, sponsor: "sponsor_1", grantor: "operator_1", grantee: "gate_1", issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", constraints };
  const grantDigest = authorityDigest(grant);
  const trustRoots = createTrustRoots([
    { tenant: "tenant_1", signerId: "operator_key", principalId: "operator_1", publicKey: operator.publicKey, purposes: ["delegation-grant"] },
    { tenant: "tenant_1", signerId: "gate_key", principalId: "gate_1", publicKey: gate.publicKey, purposes: ["outcome-contract"] },
  ]);
  const delegation = validateDelegationChain({ tenant: "tenant_1", sponsor: "sponsor_1", now, trustRoots, grants: [{ grant, digest: grantDigest, signerId: "operator_key", signature: signAuthorityDigest(operator.privateKey, "delegation-grant", grantDigest) }] });
  const policyBytes = authorityCanonicalBytes({ template: "Hello {{message}}" });
  const contract = { v: "reelier.outcome-contract/v1" as const, tenant: "tenant_1", alias: "definition_1", contractId: "contract_1", validFrom: "2026-01-02T00:00:00.000Z", validUntil: "2026-01-31T00:00:00.000Z", packDigest, definitionDigest, sponsor: "sponsor_1", audiences: ["requester_1"], delegationGrantDigest: grantDigest, connectorId: "connector_1", accountId: "account_1", sourceAuthority: { resolverId: "resolver_1", projectionSchemaId: "projection/v1", allowedReadEndpointIds: ["read_1"], authorizedProjectionPointers: ["/message"] }, riskClasses: ["message"], limits, policyCommitment: { schemaId: "policy/v1", jcsBase64: policyBytes.toString("base64"), digest: "sha256:" + createHash("sha256").update(policyBytes).digest("hex") } };
  const contractDigest = authorityDigest(contract);
  const packs = createStaticPackRegistry([def]);
  const validatedContract = validateStoredContract({ stored: { contract, digest: contractDigest, signerId: "gate_key", signature: signAuthorityDigest(gate.privateKey, "outcome-contract", contractDigest) }, trustRoots, delegation, registeredDefinitions: registeredDefinitionDigests(packs), stateEvents: [{ kind: "activated", contractDigest, at: "2026-01-03T00:00:00.000Z" }], tenant: "tenant_1", requester: "requester_1", now });
  const raw = Buffer.from('{"message":"world"}', "utf8");
  const sourceRegistry = createSourceRegistry([{ tenant: "tenant_1", resolverId: "resolver_1", definitionDigest, projectionSchemaId: "projection/v1", readEndpointIds: ["read_1"], plan: refs => [{ endpointId: "read_1", opaqueHandle: refs.item }] }]);
  const sourceBundle = { v: "reelier.source-bundle/v1" as const, tenant: "tenant_1", definitionDigest, projectionSchemaId: "projection/v1", sourceIdentity: "source_1", triggerIdentity: "trigger_1", observedAt: "2026-01-15T00:00:00.000Z", rawDigest: "sha256:" + createHash("sha256").update(raw).digest("hex"), freshUntil: "2026-01-15T00:01:00.000Z", provenance: { resolverId: "resolver_1", endpointId: "read_1" }, claims: { grounded: [{ claimId: "message", projectionPointer: "/message" }], authored: [], unresolved: [] }, projection: { message: "world" } };
  const validatedSource = validateSourceBundle(sourceRegistry, { bundle: sourceBundle, rawResponse: raw, authority: { tenant: "tenant_1", definitionDigest, resolverId: "resolver_1", projectionSchemaId: "projection/v1", allowedReadEndpointIds: ["read_1"], authorizedProjectionPointers: ["/message"], requiredGroundedPointers: ["/message"] }, now });
  return { packs, validatedContract, validatedSource, contract, sourceBundle, sourceRegistry, raw };
}

test("static pack registry refuses alias and definition-digest collisions", () => {
  assert.throws(() => createStaticPackRegistry([definition(), definition({ definitionDigest: "sha256:" + "c".repeat(64) })]), /alias collision/i);
  assert.throws(() => createStaticPackRegistry([definition(), definition({ alias: "definition_2" })]), /digest collision/i);
});

test("static pack registry is opaque, immutable, and absent from the public authority export", () => {
  const original = definition();
  const packs = createStaticPackRegistry([original]);
  assert.deepEqual(Object.keys(packs), []);
  assert.equal("byAlias" in packs, false);
  assert.equal("createStaticPackRegistry" in publicAuthority, false);
  const f = fixture(original);
  (original.writeEndpointIds as string[]).push("attacker");
  (original as { compile: StaticPackDefinition["compile"] }).compile = () => { throw new Error("swapped callback"); };
  assert.doesNotThrow(() => compileOutcome(f.packs, { contract: f.validatedContract, source: f.validatedSource, choices: {}, now }));
});

test("compilation is byte-identical, canonical, policy-bound, choice-bounded, and frozen", () => {
  const f = fixture();
  const originalDateNow = Date.now;
  const originalRandom = Math.random;
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;
  Date.now = () => { throw new Error("ambient clock used"); };
  Math.random = () => { throw new Error("ambient randomness used"); };
  Object.defineProperty(process, "env", { configurable: true, enumerable: true, writable: true, value: new Proxy(originalEnv, { get() { throw new Error("ambient environment used"); } }) });
  globalThis.fetch = (() => { throw new Error("ambient network used"); }) as typeof fetch;
  let first: ReturnType<typeof compileOutcome>;
  try { first = compileOutcome(f.packs, { contract: f.validatedContract, source: f.validatedSource, choices: { urgent: true }, now }); }
  finally {
    Date.now = originalDateNow; Math.random = originalRandom;
    Object.defineProperty(process, "env", { configurable: true, enumerable: true, writable: true, value: originalEnv });
    globalThis.fetch = originalFetch;
  }
  const second = compileOutcome(f.packs, { contract: f.validatedContract, source: f.validatedSource, choices: { urgent: true }, now });
  assert.equal(first.effectCanonicalBase64, second.effectCanonicalBase64);
  assert.equal(first.effectDigest, second.effectDigest);
  assert.deepEqual(first.capabilityCommitment, second.capabilityCommitment);
  assert.equal(Buffer.from(first.effect.bodyBase64, "base64").toString("utf8"), '{"message":"Hello world","urgent":true}');
  assert.equal(first.effect.query, "account=account_1&mode=send");
  assert.equal(Object.isFrozen(first.effect), true);
  assert.throws(() => compileOutcome(f.packs, { contract: f.validatedContract, source: f.validatedSource, choices: { recipient: "attacker" }, now }), /bounded choices/i);
  f.contract.policyCommitment.jcsBase64 = authorityCanonicalBytes({ template: "Attacker {{message}}" }).toString("base64");
  assert.equal(Buffer.from(compileOutcome(f.packs, { contract: f.validatedContract, source: f.validatedSource, choices: {}, now }).effect.bodyBase64, "base64").toString("utf8"), '{"message":"Hello world","urgent":false}');
  const drifted = fixture(definition({ policySchemaId: "policy/v2" }));
  assert.throws(() => compileOutcome(drifted.packs, { contract: drifted.validatedContract, source: drifted.validatedSource, choices: {}, now }), /policy schema drift/i);
});

test("compiled bytes, nested effect data, and capability commitments cannot diverge after return", () => {
  const f = fixture();
  const compiled = compileOutcome(f.packs, { contract: f.validatedContract, source: f.validatedSource, choices: {}, now });
  const originalBase64 = compiled.effectCanonicalBase64;
  const copy = Buffer.from(originalBase64, "base64");
  copy.fill(0);
  assert.equal(compiled.effectCanonicalBase64, originalBase64);
  assert.equal(authorityDigest(JSON.parse(Buffer.from(compiled.effectCanonicalBase64, "base64").toString("utf8"))), compiled.effectDigest);
  assert.throws(() => { (compiled.effect.headers as Record<string, string>)["X-Attacker"] = "yes"; }, /not extensible|read only/i);
  assert.throws(() => { (compiled.effect.preconditions as unknown[]).push({}); }, /not extensible/i);
  assert.throws(() => { (compiled.capabilityCommitment as { effectDigest: string }).effectDigest = "sha256:" + "0".repeat(64); }, /read only/i);
  assert.equal(compiled.capabilityCommitment.effectDigest, compiled.effectDigest);
});

test("compiler refuses unknown endpoint/risk and every malformed pack-emitted transport boundary", () => {
  const mutations: [string, Record<string, unknown>][] = [
    ["endpoint", { endpointId: "unknown" }], ["risk", { riskClass: "unknown" }],
    ["header", { headers: { Authorization: "secret" } }], ["path", { path: "https://evil.test/write" }],
    ["query", { query: "z=1&a=2" }], ["body", { bodyBase64: "not-base64" }],
  ];
  for (const [label, mutation] of mutations) {
    const base = definition();
    const bad = definition({ compile: input => ({ ...(base.compile(input) as object), ...mutation }) });
    const f = fixture(bad);
    assert.throws(() => compileOutcome(f.packs, { contract: f.validatedContract, source: f.validatedSource, choices: {}, now }), /invalid transport-effect|endpoint|risk/i, label);
  }
});

test("compiler recomposes source authority against the selected contract", () => {
  const f = fixture();
  const broader = { ...f.sourceBundle, claims: { ...f.sourceBundle.claims, grounded: [...f.sourceBundle.claims.grounded, { claimId: "extra", projectionPointer: "/extra" }] }, projection: { ...f.sourceBundle.projection, extra: true } };
  const source = validateSourceBundle(f.sourceRegistry, { bundle: broader, rawResponse: f.raw, authority: { tenant: "tenant_1", definitionDigest, resolverId: "resolver_1", projectionSchemaId: "projection/v1", allowedReadEndpointIds: ["read_1"], authorizedProjectionPointers: ["/message", "/extra"], requiredGroundedPointers: ["/message"] }, now });
  assert.throws(() => compileOutcome(f.packs, { contract: f.validatedContract, source, choices: {}, now }), /projection exceeds contract authority/i);
});

test("validated contract and source authority is single-context and cannot be reused at another instant", () => {
  const f = fixture();
  assert.doesNotThrow(() => compileOutcome(f.packs, { contract: f.validatedContract, source: f.validatedSource, choices: {}, now }));
  assert.throws(() => compileOutcome(f.packs, { contract: f.validatedContract, source: f.validatedSource, choices: {}, now: new Date(now.getTime() + 1) }), /validation instant|same context/i);
  assert.throws(() => compileOutcome(f.packs, { contract: f.validatedContract, source: f.validatedSource, choices: {}, now: new Date(now.getTime() - 1) }), /validation instant|same context/i);
  assert.throws(() => compileOutcome(f.packs, { contract: f.validatedContract, source: f.validatedSource, choices: {}, now: new Date(f.sourceBundle.freshUntil) }), /validation instant|stale/i);
  assert.throws(() => compileOutcome(f.packs, { contract: f.validatedContract, source: f.validatedSource, choices: {}, now: new Date(f.contract.validUntil) }), /validation instant|expired/i);
});

test("semantic outcome keys are length-delimited, field-ordered, and use UTF-8 byte lengths", () => {
  const key = deriveSemanticOutcomeKey({ tenant: "ténant", contractDigest: "sha256:" + "0".repeat(64), definitionAlias: "définition", sourceIdentity: "source", triggerIdentity: "trigger" });
  assert.equal(key, "sha256:2a25254fcd69933350cdeaeeb2a66302ab7dcaadfc8f91a1cf4e71b466f37a36");
  assert.notEqual(
    deriveSemanticOutcomeKey({ tenant: "a", contractDigest: "bc", definitionAlias: "d", sourceIdentity: "e", triggerIdentity: "f" }),
    deriveSemanticOutcomeKey({ tenant: "ab", contractDigest: "c", definitionAlias: "d", sourceIdentity: "e", triggerIdentity: "f" }),
  );
  assert.notEqual(
    deriveSemanticOutcomeKey({ tenant: "x|y", contractDigest: "z", definitionAlias: "d", sourceIdentity: "e", triggerIdentity: "f" }),
    deriveSemanticOutcomeKey({ tenant: "x", contractDigest: "y|z", definitionAlias: "d", sourceIdentity: "e", triggerIdentity: "f" }),
  );
});

test("static first-party compiler source conformance refuses ambient I/O, clock, randomness, and code loading", () => {
  const compilerSource = readFileSync("src/authority/compile.ts", "utf8");
  assert.doesNotThrow(() => assertStaticFirstPartySourcesConform([{ file: "src/authority/compile.ts", source: compilerSource }]));
  const builtins = ["fs", "fs/promises", "http", "https", "net", "tls", "dns", "dgram", "child_process", "worker_threads", "cluster", "vm", "module", "process", "crypto"];
  for (const specifier of builtins.flatMap(name => [name, `node:${name}`])) {
    assert.throws(() => assertStaticFirstPartySourcesConform([{ file: "bad-pack.ts", source: `import forbidden from ${JSON.stringify(specifier)};` }]), /static first-party purity.*runtime module specifier/i, specifier);
  }
  for (const specifier of ["undici", "axios", "ws", "@scope/network-client"]) {
    assert.throws(() => assertStaticFirstPartySourcesConform([{ file: "bad-pack.ts", source: `export { client } from ${JSON.stringify(specifier)};` }]), /static first-party purity.*runtime module specifier/i, specifier);
  }
  for (const source of [
    'import { pure } from "./pure.js";', 'export { pure } from "../shared/pure.js";',
    'import type { Schema } from "external-types";', 'export type { Schema } from "external-types";',
  ]) assert.doesNotThrow(() => assertStaticFirstPartySourcesConform([{ file: "allowed-pack.ts", source }]));
  for (const source of [
    "process.env.SECRET", "fetch('https://example.test')", "Date.now()", "new Date()", "Math.random()", "createRequire(import.meta.url)",
    "randomUUID()", "randomBytes(16)", "import('./plugin.js')", "require('./plugin.js')", "eval('1')", "new Function('return 1')",
  ]) assert.throws(() => assertStaticFirstPartySourcesConform([{ file: "bad-pack.ts", source }]), /static first-party purity/i, source);
});
