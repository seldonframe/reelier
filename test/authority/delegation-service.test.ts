import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { authorityDigest } from "../../src/authority/wire.js";
import { signAuthorityDigest } from "../../src/authority/crypto.js";
import type { DelegationGrant } from "../../src/authority/types.js";
import { createDelegationAuthority, registerAuthoritySignedChild } from "../../src/authority/host/delegation-service.js";
import { parseAuthorityKeyDescriptor } from "../../src/authority/certification/authority.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";

const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
test.after(() => restorePlatform());

const limits = { maxEffectsPerWindow: 10, windowSeconds: 3600, maxEffectsPerSourceTrigger: 2, maxBodyBytes: 4096 };
const grant = (overrides: Partial<DelegationGrant> = {}): DelegationGrant => ({
  v: "reelier.delegation-grant/v1", tenant: "tenant_1", grantId: "root", parentDigest: null, sponsor: "operator", grantor: "operator", grantee: "coordinator",
  issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z",
  constraints: { definitionAliases: ["deployment_release_v1"], audiences: ["coordinator", "worker"], connectorAccounts: [{ connectorId: "vercel", accountId: "team_1" }], projectionPointers: ["/deployment"], riskClasses: ["release"], limits },
  delegationPolicy: { mayDelegate: true, maxDepth: 2, maxFanOut: 2, maxChildDurationSeconds: 3600, maxDelegatedEffects: 4 }, ...overrides,
});

test("delegation authority mints a narrower child and consumes conserved budget", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-delegation-service-"));
  try {
    const keys = generateKeyPairSync("ed25519");
    const parent = grant();
    const parentDigest = authorityDigest(parent);
    const service = createDelegationAuthority({ root, now: () => new Date("2026-01-01T00:10:00.000Z"), signGrant: async value => ({ grant: value, digest: authorityDigest(value), signerId: "authority-cell", signature: signAuthorityDigest(keys.privateKey, "delegation-grant", authorityDigest(value)) }) });
    await service.registerRoot({ taskId: "task_1", rootGrant: { grant: parent, digest: parentDigest, signerId: "operator", signature: { alg: "ed25519", sig: "unused" } }, effects: 4 });
    const child = grant({ grantId: "child_1", parentDigest, grantor: "coordinator", grantee: "worker", issuedAt: "2026-01-01T00:10:00.000Z", expiresAt: "2026-01-01T00:40:00.000Z", delegationPolicy: { mayDelegate: false, maxDepth: 0, maxFanOut: 0, maxChildDurationSeconds: 1, maxDelegatedEffects: 0 } });
    const result = await service.request({ tenant: "tenant_1", parentPrincipal: "coordinator", taskId: "task_1", parentAllocationId: "root", child, effects: 2 });
    assert.equal(result.verdict, "accepted");
    assert.equal(result.grant.grantee, "worker");
    assert.deepEqual(await service.resolveSessionBinding({ tenant: "tenant_1", taskId: "task_1", principalId: "worker" }), {
      taskId: "task_1",
      grantId: "child_1",
      grantDigest: result.grantDigest,
      grantee: "worker",
      allocationId: "child_1",
      expiresAt: "2026-01-01T00:40:00.000Z",
      effects: 2,
      lifecycleState: "allocated",
    });
    const status = await service.status({ tenant: "tenant_1", requester: "coordinator", grantId: "child_1" });
    assert.equal(status.lifecycleState, "allocated");
    await service.revoke("tenant_1", "task_1");
    await assert.rejects(() => service.resolveSessionBinding({ tenant: "tenant_1", taskId: "task_1", principalId: "worker" }), /not active/i);
    assert.equal((await service.status({ tenant: "tenant_1", requester: "coordinator", grantId: "child_1" })).lifecycleState, "revoked");
    const restarted = createDelegationAuthority({ root, now: () => new Date("2026-01-01T00:10:00.000Z"), signGrant: async value => ({ grant: value, digest: authorityDigest(value), signerId: "authority-cell", signature: signAuthorityDigest(keys.privateKey, "delegation-grant", authorityDigest(value)) }) });
    assert.equal((await restarted.taskStatus({ tenant: "tenant_1", requester: "coordinator", taskId: "task_1" })).lifecycleState, "revoked");
    assert.deepEqual((await restarted.taskStatus({ tenant: "tenant_1", requester: "coordinator", taskId: "task_1" })).grants, ["child_1", "root"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("root registration is exact-replay idempotent and binds its generated allocation identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-delegation-root-replay-"));
  try {
    const parent = grant({ grantId: "grant_generated", grantee: "principal_generated" });
    const stored = { grant: parent, digest: authorityDigest(parent), signerId: "delegation_cell", signature: { alg: "ed25519" as const, sig: "unused" } };
    const service = createDelegationAuthority({ root, now: () => new Date("2026-01-01T00:10:00.000Z"), signGrant: async value => ({ grant: value, digest: authorityDigest(value), signerId: "delegation_cell", signature: { alg: "ed25519", sig: "unused" } }) });
    const registration = { taskId: "task_generated", allocationId: "grant_generated", rootGrant: stored, effects: 4 } as Parameters<typeof service.registerRoot>[0];
    await service.registerRoot(registration);
    await service.registerRoot(registration);
    assert.deepEqual(await service.resolveSessionBinding({ tenant: "tenant_1", taskId: "task_generated", principalId: "principal_generated" }), {
      taskId: "task_generated", grantId: "grant_generated", grantDigest: stored.digest, grantee: "principal_generated", allocationId: "grant_generated", expiresAt: parent.expiresAt, effects: 4, lifecycleState: "allocated",
    });
    await assert.rejects(() => service.registerRoot({ ...registration, effects: 3 }), /conflict/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concurrent conflicting root registrations serialize and exactly one succeeds", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-delegation-root-race-"));
  try {
    const left = grant({ grantId: "grant_race", grantee: "principal_left" });
    const right = grant({ grantId: "grant_race", grantee: "principal_right" });
    const signed = (value: DelegationGrant) => ({ grant: value, digest: authorityDigest(value), signerId: "cell", signature: { alg: "ed25519" as const, sig: "unused" } });
    const service = () => createDelegationAuthority({ root, now: () => new Date("2026-01-01T00:10:00.000Z"), signGrant: async value => signed(value) });
    const results = await Promise.allSettled([
      service().registerRoot({ taskId: "task_race", allocationId: "grant_race", rootGrant: signed(left), effects: 2 }),
      service().registerRoot({ taskId: "task_race", allocationId: "grant_race", rootGrant: signed(right), effects: 2 }),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.match((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason.message, /conflict/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("delegation authority refuses a corrupt durable registry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-delegation-service-corrupt-"));
  try {
    await writeFile(path.join(root, "delegation-registry.json"), "{not-json", "utf8");
    const service = createDelegationAuthority({ root, signGrant: async value => ({ grant: value, digest: authorityDigest(value), signerId: "cell", signature: { alg: "ed25519", sig: "unused" } }) });
    await assert.rejects(() => service.taskStatus({ tenant: "tenant_1", requester: "operator", taskId: "task_1" }), /corrupt/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("delegation authority never accepts a body-supplied parent identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-delegation-service-identity-"));
  try {
    const service = createDelegationAuthority({ root, signGrant: async value => ({ grant: value, digest: authorityDigest(value), signerId: "cell", signature: { alg: "ed25519", sig: "unused" } }) });
    await assert.rejects(() => service.request({ tenant: "tenant_2", parentPrincipal: "attacker", taskId: "missing", parentAllocationId: "root", child: grant(), effects: 1 }), /task|parent|not found/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("delegation authority derives active fan-out from its durable registry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-delegation-service-fanout-"));
  try {
    const keys = generateKeyPairSync("ed25519");
    const parent = grant({
      grantId: "root-fanout",
      delegationPolicy: { mayDelegate: true, maxDepth: 2, maxFanOut: 1, maxChildDurationSeconds: 3600, maxDelegatedEffects: 4 },
    });
    const parentDigest = authorityDigest(parent);
    const service = createDelegationAuthority({ root, now: () => new Date("2026-01-01T00:10:00.000Z"), signGrant: async value => ({ grant: value, digest: authorityDigest(value), signerId: "authority-cell", signature: signAuthorityDigest(keys.privateKey, "delegation-grant", authorityDigest(value)) }) });
    await service.registerRoot({ taskId: "task_fanout", rootGrant: { grant: parent, digest: parentDigest, signerId: "operator", signature: { alg: "ed25519", sig: "unused" } }, effects: 4 });
    const child = (grantId: string): DelegationGrant => grant({ grantId, parentDigest, grantor: "coordinator", grantee: "worker", issuedAt: "2026-01-01T00:10:00.000Z", expiresAt: "2026-01-01T00:40:00.000Z", delegationPolicy: { mayDelegate: false, maxDepth: 0, maxFanOut: 0, maxChildDurationSeconds: 1, maxDelegatedEffects: 0 } });
    const results = await Promise.allSettled([
      service.request({ tenant: "tenant_1", parentPrincipal: "coordinator", taskId: "task_fanout", parentAllocationId: "root", child: child("child_1"), effects: 1 }),
      service.request({ tenant: "tenant_1", parentPrincipal: "coordinator", taskId: "task_fanout", parentAllocationId: "root", child: child("child_2"), effects: 1 }),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.match(results.find(result => result.status === "rejected")?.reason?.message ?? "", /fan.?out/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("root registration creates an absent confined delegation directory before locking", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "reelier-delegation-absent-root-"));
  const root = path.join(parent, "delegations");
  try {
    const value = grant({ grantId: "root_absent", grantee: "principal_absent" });
    const stored = { grant: value, digest: authorityDigest(value), signerId: "cell", signature: { alg: "ed25519" as const, sig: "unused" } };
    const service = createDelegationAuthority({ root, signGrant: async child => ({ grant: child, digest: authorityDigest(child), signerId: "cell", signature: { alg: "ed25519", sig: "unused" } }) });
    await service.registerRoot({ taskId: "task_absent", allocationId: "root_absent", rootGrant: stored, effects: 1 });
    assert.match(await readFile(path.join(root, "delegation-registry.json"), "utf8"), /task_absent/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("root registration refuses a linked delegation directory", async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "reelier-delegation-linked-root-"));
  const external = path.join(parent, "external"), linked = path.join(parent, "delegations");
  await mkdir(external);
  try {
    try { await symlink(external, linked, process.platform === "win32" ? "junction" : "dir"); }
    catch (error) { if (["EPERM", "EACCES", "UNKNOWN"].includes((error as NodeJS.ErrnoException).code ?? "")) { t.skip("directory links unavailable"); return; } throw error; }
    const value = grant({ grantId: "root_linked", grantee: "principal_linked" });
    const service = createDelegationAuthority({ root: linked, signGrant: async child => ({ grant: child, digest: authorityDigest(child), signerId: "cell", signature: { alg: "ed25519", sig: "unused" } }) });
    await assert.rejects(() => service.registerRoot({ taskId: "task_linked", allocationId: "root_linked", rootGrant: { grant: value, digest: authorityDigest(value), signerId: "cell", signature: { alg: "ed25519", sig: "unused" } }, effects: 1 }), /linked|confined|directory/i);
    await assert.rejects(() => readFile(path.join(external, "delegation-registry.json")), /ENOENT/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("Cell signed-child helper refuses forged signers, wrong purposes, and inactive descriptors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-delegation-signed-child-"));
  try {
    const trusted = generateKeyPairSync("ed25519"), forged = generateKeyPairSync("ed25519"), parent = grant(), parentDigest = authorityDigest(parent);
    const descriptor = (keyId: string, purpose: string, publicKey: typeof trusted.publicKey) => parseAuthorityKeyDescriptor({ v: "reelier.authority-key-descriptor/v1", keyId, role: "authority-cell", purpose, algorithm: "ed25519", publicKeySpkiBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64") });
    const trustedDescriptor = descriptor("delegation_active", "delegation-grant", trusted.publicKey), wrongPurpose = descriptor("journal_active", "authority-journal", trusted.publicKey), inactive = descriptor("delegation_inactive", "delegation-grant", trusted.publicKey);
    const service = createDelegationAuthority({ root, now: () => new Date("2026-01-01T00:10:00.000Z"), signGrant: async () => { throw new Error("not used"); } });
    await service.registerRoot({ taskId: "task_signed", rootGrant: { grant: parent, digest: parentDigest, signerId: "operator", signature: { alg: "ed25519", sig: "unused" } }, effects: 4 });
    const child = grant({ grantId: "child_signed", parentDigest, grantor: "coordinator", grantee: "worker", issuedAt: "2026-01-01T00:10:00.000Z", expiresAt: "2026-01-01T00:40:00.000Z", delegationPolicy: { mayDelegate: false, maxDepth: 0, maxFanOut: 0, maxChildDurationSeconds: 1, maxDelegatedEffects: 0 } }), digest = authorityDigest(child);
    const input = (signerDescriptor: any, privateKey: typeof trusted.privateKey, signerId = signerDescriptor.keyId) => ({ tenant: "tenant_1", parentPrincipal: "coordinator", taskId: "task_signed", parentAllocationId: "root", signedChild: { grant: child, digest, signerId, signature: signAuthorityDigest(privateKey, "delegation-grant", digest) }, signerDescriptor, activeSignerDescriptorDigests: [authorityDigest(trustedDescriptor)], effects: 2 });
    await assert.rejects(() => registerAuthoritySignedChild(service, input(trustedDescriptor, forged.privateKey)), /signature|signer/i);
    await assert.rejects(() => registerAuthoritySignedChild(service, input(wrongPurpose, trusted.privateKey)), /purpose|signer/i);
    await assert.rejects(() => registerAuthoritySignedChild(service, input(inactive, trusted.privateKey)), /active|descriptor/i);
    assert.equal(await service.budget.get("child_signed"), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Cell signed-child helper conserves allocation under exact replay, conflict, and concurrency", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-delegation-signed-child-race-"));
  try {
    const keys = generateKeyPairSync("ed25519"), parent = grant(), parentDigest = authorityDigest(parent), descriptor = parseAuthorityKeyDescriptor({ v: "reelier.authority-key-descriptor/v1", keyId: "delegation_active", role: "authority-cell", purpose: "delegation-grant", algorithm: "ed25519", publicKeySpkiBase64: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64") });
    const service = createDelegationAuthority({ root, now: () => new Date("2026-01-01T00:10:00.000Z"), signGrant: async () => { throw new Error("not used"); } });
    await service.registerRoot({ taskId: "task_race", rootGrant: { grant: parent, digest: parentDigest, signerId: "operator", signature: { alg: "ed25519", sig: "unused" } }, effects: 4 });
    const child = (grantee: string) => grant({ grantId: "child_race", parentDigest, grantor: "coordinator", grantee, issuedAt: "2026-01-01T00:10:00.000Z", expiresAt: "2026-01-01T00:40:00.000Z", delegationPolicy: { mayDelegate: false, maxDepth: 0, maxFanOut: 0, maxChildDurationSeconds: 1, maxDelegatedEffects: 0 } });
    const request = (value: DelegationGrant) => { const digest = authorityDigest(value); return { tenant: "tenant_1", parentPrincipal: "coordinator", taskId: "task_race", parentAllocationId: "root", signedChild: { grant: value, digest, signerId: descriptor.keyId, signature: signAuthorityDigest(keys.privateKey, "delegation-grant", digest) }, signerDescriptor: descriptor, activeSignerDescriptorDigests: [authorityDigest(descriptor)], effects: 2 }; };
    const exact = request(child("worker")), results = await Promise.all([registerAuthoritySignedChild(service, exact), registerAuthoritySignedChild(service, exact)]);
    assert.deepEqual(results[0], results[1]);
    await assert.rejects(() => registerAuthoritySignedChild(service, request(child("attacker"))), /conflict|exists/i);
    const rootBudget = await service.budget.get("root"), childBudget = await service.budget.get("child_race");
    assert.equal(rootBudget?.reserved, 2); assert.equal(rootBudget?.remaining, 2); assert.equal(childBudget?.effects, 2); assert.equal((await service.budget.eventsForTask("task_race")).length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
