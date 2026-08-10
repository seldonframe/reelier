import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { signAuthorityLease, verifyAuthorityLease } from "../../src/authority/host/lease.js";

test("authority leases verify only for the bound topology digest and 60-second window", () => {
  const keys = generateKeyPairSync("ed25519");
  const issuedAt = new Date("2026-08-10T00:00:00.000Z");
  const lease = signAuthorityLease({ tenant: "tenant_1", kernel: "kernel_1", taskId: "task_1", definitionAlias: "job_v1", stateVersion: 1, stateDigest: "sha256:" + "1".repeat(64), jobCardDigest: "sha256:" + "2".repeat(64), rootGrantDigest: "sha256:" + "3".repeat(64), topologyEvidenceDigest: "sha256:" + "4".repeat(64), issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString(), nonce: "nonce_1", signerId: "cloud", privateKey: keys.privateKey });
  assert.equal(verifyAuthorityLease(lease, { tenant: "tenant_1", now: new Date("2026-08-10T00:00:30.000Z"), signerId: "cloud", publicKey: keys.publicKey, topologyEvidenceDigest: lease.topologyEvidenceDigest }).taskId, "task_1");
  assert.throws(() => verifyAuthorityLease(lease, { tenant: "tenant_1", now: new Date("2026-08-10T00:00:30.000Z"), signerId: "cloud", publicKey: keys.publicKey, topologyEvidenceDigest: "sha256:" + "5".repeat(64) }), /topology/);
  assert.throws(() => verifyAuthorityLease(lease, { tenant: "tenant_1", now: new Date("2026-08-10T00:01:01.000Z"), signerId: "cloud", publicKey: keys.publicKey, topologyEvidenceDigest: lease.topologyEvidenceDigest }), /stale/);
});
