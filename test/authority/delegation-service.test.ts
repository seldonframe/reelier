import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { authorityDigest } from "../../src/authority/wire.js";
import { signAuthorityDigest } from "../../src/authority/crypto.js";
import type { DelegationGrant } from "../../src/authority/types.js";
import { createDelegationAuthority } from "../../src/authority/host/delegation-service.js";

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
