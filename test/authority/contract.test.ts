import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { signAuthorityDigest } from "../../src/authority/crypto.js";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import { createTrustRoots } from "../../src/authority/trust.js";
import { validateDelegationChain } from "../../src/authority/delegation.js";
import { validateStoredContract, isValidatedContract, verifyStoredContract, validateVerifiedContractEligibility, type ContractStateEvent } from "../../src/authority/contract.js";
import { AUTHORITY_ADAPTER_CONTRACT_V1, verifyAuthorityAdapterContractV1 } from "../../src/authority/adapter-contract.js";

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
  const contract = { v: "reelier.outcome-contract/v1" as const, tenant: "tenant_1", alias: "definition_1", contractId: "contract_1", validFrom: "2026-01-02T00:00:00.000Z", validUntil: "2026-01-31T00:00:00.000Z", packDigest: "sha256:" + "a".repeat(64), definitionDigest: "sha256:" + "b".repeat(64), sponsor: "sponsor_1", audiences: ["requester_1"], delegationGrantDigest: grantDigest, connectorId: "connector_1", accountId: "account_1", sourceAuthority: { resolverId: "resolver_1", projectionSchemaId: "projection/v1", allowedReadEndpointIds: ["read_1"], authorizedProjectionPointers: ["/message"], maxFreshnessSeconds: 60 }, riskClasses: ["message"], limits, policyCommitment: { schemaId: "policy/v1", jcsBase64: policyBytes.toString("base64"), digest: authorityDigest(JSON.parse(policyBytes.toString("utf8"))) } };
  const digest = authorityDigest(contract);
  return { roots, gate, chain, contract, digest, stored: { contract, digest, signerId: "gate_key", signature: signAuthorityDigest(gate.privateKey, "outcome-contract", digest) }, registry: new Map([["definition_1", { packDigest: contract.packDigest, definitionDigest: contract.definitionDigest, maxFreshnessSeconds: 120 }]]) };
}

function validate(f: ReturnType<typeof fixture>, events: ContractStateEvent[] = [{ kind: "activated", contractDigest: f.digest, at: "2026-01-03T00:00:00.000Z" }], requester = "requester_1", now = new Date("2026-01-15T00:00:00.000Z")) {
  return validateStoredContract({ stored: f.stored, trustRoots: f.roots, delegation: f.chain, registeredDefinitions: f.registry, stateEvents: events, tenant: "tenant_1", requester, now });
}

test("a stored contract validates immutable authority, activation, audience, registration, and signer principal", () => {
  const f = fixture();
  const validated = validate(f);
  assert.equal(isValidatedContract(validated), true);
  assert.equal(isValidatedContract({ ...validated }), false);
  assert.equal(isValidatedContract(structuredClone(validated)), false);
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
  assert.throws(() => validateStoredContract({ stored: f.stored, trustRoots: f.roots, delegation: f.chain, registeredDefinitions: new Map([["definition_1", { packDigest: "sha256:" + "c".repeat(64), definitionDigest: f.contract.definitionDigest, maxFreshnessSeconds: 120 }]]), stateEvents: [{ kind: "activated", contractDigest: f.digest, at: "2026-01-03T00:00:00.000Z" }], tenant: "tenant_1", requester: "requester_1", now: new Date("2026-01-15T00:00:00.000Z") }), /registered.*digest/i);
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

test("trusted contract digest is staged before mutable eligibility checks", () => {
  const f = fixture();
  const verified = verifyStoredContract({ stored: f.stored, trustRoots: f.roots, tenant: "tenant_1" });
  assert.equal(verified.digest, f.digest);
  const eligible = { verified, definitionAlias: "definition_1", delegation: f.chain, registeredDefinitions: f.registry, stateEvents: [{ kind: "activated" as const, contractDigest: f.digest, at: "2026-01-03T00:00:00.000Z" }], requester: "requester_1", now: new Date("2026-01-15T00:00:00.000Z") };
  assert.throws(() => validateVerifiedContractEligibility({ ...eligible, stateEvents: [...eligible.stateEvents, { kind: "revoked", contractDigest: f.digest, at: "2026-01-10T00:00:00.000Z" }] }), /revoked/i);
  assert.throws(() => validateVerifiedContractEligibility({ ...eligible, definitionAlias: "definition_2" }), /alias/i);
  assert.throws(() => validateVerifiedContractEligibility({ ...eligible, requester: "requester_2" }), /audience/i);
  assert.throws(() => validateVerifiedContractEligibility({ ...eligible, now: new Date("2026-01-01T00:00:00.000Z") }), /not yet valid/i);
  assert.throws(() => validateVerifiedContractEligibility({ ...eligible, registeredDefinitions: new Map([["definition_1", { packDigest: f.contract.packDigest, definitionDigest: f.contract.definitionDigest, maxFreshnessSeconds: 30 }]]) }), /freshness/i);
  assert.throws(() => validateVerifiedContractEligibility({ verified: { ...verified } as never, definitionAlias: "definition_1", delegation: f.chain, registeredDefinitions: f.registry, stateEvents: [], requester: "requester_1", now: new Date("2026-01-15T00:00:00.000Z") }), /verified stored contract/i);
  assert.throws(() => verifyStoredContract({ stored: { ...f.stored, contract: { ...f.contract, unexpected: true } }, trustRoots: f.roots, tenant: "tenant_1" }), /wire|advertised digest|additional/i);
  assert.throws(() => verifyStoredContract({ stored: { ...f.stored, signature: { ...f.stored.signature, sig: "AA==" } }, trustRoots: f.roots, tenant: "tenant_1" }), /signature/i);
  assert.throws(() => verifyStoredContract({ stored: f.stored, trustRoots: f.roots, tenant: "tenant_2" }), /tenant|trust/i);
});

test("adapter contract v1 is a closed, canonical manifest and refuses stale copied output", () => {
  const contractDirectory = join(process.cwd(), "contract", "authority", "v1");
  const descriptorPath = join(contractDirectory, "adapter-contract-v1.json");
  assert.equal(existsSync(descriptorPath), true, "adapter contract descriptor must be generated");
  const output = JSON.parse(readFileSync(descriptorPath, "utf8")) as {
    v: string;
    domain: string;
    members: readonly { path: string; digest: string }[];
    goldenVectorsDigest: string;
    digest: string;
  };
  assert.equal(output.v, "reelier.adapter-contract/v1");
  assert.equal(output.domain, "reelier.adapter-contract/v1\\0");
  assert.match(output.digest, /^sha256:(?!0{64}$)[0-9a-f]{64}$/);
  assert.match(output.goldenVectorsDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(output.members.map(member => member.path), [...output.members.map(member => member.path)].sort());
  assert.equal(new Set(output.members.map(member => member.path)).size, output.members.length);
  assert.equal(output.members.some(member => member.path === "adapter-contract-v1.json"), false);
  const files = new Map(output.members.map(member => [member.path, readFileSync(join(contractDirectory, member.path))]));
  assert.doesNotThrow(() => verifyAuthorityAdapterContractV1(output, files));
  const plainUint8Files = new Map(output.members.map(member => [member.path, new Uint8Array(readFileSync(join(contractDirectory, member.path)))]));
  assert.doesNotThrow(() => verifyAuthorityAdapterContractV1(output, plainUint8Files));
  const mutatedFiles = new Map(files);
  mutatedFiles.set(output.members[0].path, Buffer.from("tampered"));
  assert.throws(() => verifyAuthorityAdapterContractV1(output, mutatedFiles), /member digest/i);
  const omittedFiles = new Map(files);
  omittedFiles.delete(output.members[0].path);
  assert.throws(() => verifyAuthorityAdapterContractV1(output, omittedFiles), /member digest/i);
  assert.equal(Object.isFrozen(AUTHORITY_ADAPTER_CONTRACT_V1), true);
  assert.equal(Object.isFrozen(AUTHORITY_ADAPTER_CONTRACT_V1.members), true);
  assert.equal(Object.isFrozen(AUTHORITY_ADAPTER_CONTRACT_V1.members[0]), true);
  assert.throws(() => { (AUTHORITY_ADAPTER_CONTRACT_V1.members as unknown as { path: string }[]).push({ path: "x" }); }, /extensible|read only/i);
  assert.throws(() => { (AUTHORITY_ADAPTER_CONTRACT_V1.members[0] as { digest: string }).digest = "sha256:" + "0".repeat(64); }, /read only/i);
  assert.throws(() => verifyAuthorityAdapterContractV1({ ...output, members: output.members.slice(1) }, files), /closed membership/i);
  assert.throws(() => verifyAuthorityAdapterContractV1({ ...output, members: [...output.members, output.members[0]] }, files), /member paths/i);
  assert.throws(() => verifyAuthorityAdapterContractV1({ ...output, members: [...output.members].reverse() }, files), /member paths/i);
  assert.throws(() => verifyAuthorityAdapterContractV1({ ...output, members: [{ ...output.members[0], path: "../escape.json" }, ...output.members.slice(1)] }, files), /member paths/i);
  assert.throws(() => verifyAuthorityAdapterContractV1({ ...output, members: [{ ...output.members[0], path: "adapter-contract-v1.json" }, ...output.members.slice(1)] }, files), /member paths/i);

  const copiedRoot = mkdtempSync(join(tmpdir(), "reelier-adapter-contract-"));
  try {
    const copiedDirectory = join(copiedRoot, "v1");
    cpSync(contractDirectory, copiedDirectory, { recursive: true });
    const copiedSource = join(copiedRoot, "adapter-contract.ts");
    writeFileSync(copiedSource, readFileSync(join(process.cwd(), "src", "authority", "adapter-contract.ts"), "utf8"), "utf8");
    execFileSync(process.execPath, ["scripts/build-authority-contract.mjs", "--directory", copiedDirectory, "--source", copiedSource], { cwd: process.cwd(), stdio: "pipe" });
    writeFileSync(copiedSource, readFileSync(copiedSource, "utf8").replace(/\r?\n/g, "\r\n"), "utf8");
    for (const member of output.members) writeFileSync(join(copiedDirectory, member.path), readFileSync(join(copiedDirectory, member.path), "utf8").replace(/\r?\n/g, "\r\n"), "utf8");
    assert.doesNotThrow(() => execFileSync(process.execPath, ["scripts/build-authority-contract.mjs", "--directory", copiedDirectory, "--source", copiedSource, "--check"], { cwd: process.cwd(), stdio: "pipe" }));
    writeFileSync(copiedSource, "stale source\n", "utf8");
    assert.throws(
      () => execFileSync(process.execPath, ["scripts/build-authority-contract.mjs", "--directory", copiedDirectory, "--source", copiedSource, "--check"], { cwd: process.cwd(), stdio: "pipe" }),
      /adapter contract source drift/i,
    );
    writeFileSync(join(copiedDirectory, "golden-vectors.json"), "{}\n", "utf8");
    assert.throws(
      () => execFileSync(process.execPath, ["scripts/build-authority-contract.mjs", "--directory", copiedDirectory, "--check"], { cwd: process.cwd(), stdio: "pipe" }),
      /authority (golden vectors|adapter contract) drift/i,
    );
  } finally {
    rmSync(copiedRoot, { recursive: true, force: true });
  }

  const sourcePath = join(process.cwd(), "src", "authority", "adapter-contract.ts");
  const source = readFileSync(sourcePath, "utf8");
  try {
    writeFileSync(sourcePath, `${source}\n// stale package build input\n`, "utf8");
    assert.throws(
      () => execFileSync(process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm", process.platform === "win32" ? ["/d", "/s", "/c", "npm run build"] : ["run", "build"], { cwd: process.cwd(), stdio: "pipe" }),
      /adapter contract source drift/i,
    );
  } finally {
    writeFileSync(sourcePath, source, "utf8");
  }
});
