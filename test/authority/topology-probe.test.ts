import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { authorityDigest } from "../../src/authority/wire.js";
import {
  assertFreshManagedTopologyEvidence,
  createTopologyProbe,
  runTopologyProbe,
  signTopologyEvidence,
  verifyTopologyEvidence,
  type TopologyEvidenceField,
} from "../../src/authority/host/topology.js";

const fields: readonly TopologyEvidenceField[] = ["credentialIsolation", "providerEgress", "rawWriteReachability", "readCoverage", "runtimeIdentity", "declaredSurfaceEnforcement"];
const at = "2026-08-10T12:00:00.000Z";
const until = "2026-08-10T12:01:00.000Z";

function verifiedChecks(): Record<TopologyEvidenceField, "verified"> {
  return Object.fromEntries(fields.map(field => [field, "verified" as const])) as Record<TopologyEvidenceField, "verified">;
}

test("topology probe output is deterministic and closed over the six required checks", async () => {
  const probe = createTopologyProbe({ probeId: "container-boundary", checks: Object.fromEntries(fields.map(field => [field, async () => "verified" as const])) as Record<TopologyEvidenceField, () => Promise<"verified">> });
  const first = await runTopologyProbe(probe, { tenant: "tenant_1", observedAt: at, expiresAt: until });
  const second = await runTopologyProbe(probe, { tenant: "tenant_1", observedAt: at, expiresAt: until });
  assert.deepEqual(first, second);
  assert.equal(first.digest, authorityDigest({ v: "reelier.topology-evidence-payload/v1", tenant: "tenant_1", probeId: "container-boundary", observedAt: at, expiresAt: until, evidence: { v: "reelier.topology-evidence/v1", ...verifiedChecks() } }));
});

test("signed topology evidence verifies only for the trusted signer and fresh interval", async () => {
  const keys = generateKeyPairSync("ed25519");
  const probe = createTopologyProbe({ probeId: "container-boundary", checks: Object.fromEntries(fields.map(field => [field, () => "verified" as const])) as Record<TopologyEvidenceField, () => "verified"> });
  const result = await runTopologyProbe(probe, { tenant: "tenant_1", observedAt: at, expiresAt: until });
  const signed = signTopologyEvidence(result, { signerId: "kernel_1", privateKey: keys.privateKey });
  const verified = verifyTopologyEvidence(signed, { tenant: "tenant_1", now: "2026-08-10T12:00:30.000Z", signerId: "kernel_1", publicKey: keys.publicKey });
  assert.equal(verified.digest, result.digest);
  assert.doesNotThrow(() => assertFreshManagedTopologyEvidence(verified, { tenant: "tenant_1", now: "2026-08-10T12:00:30.000Z", signerId: "kernel_1", publicKey: keys.publicKey }));
  assert.throws(() => verifyTopologyEvidence(signed, { tenant: "tenant_1", now: "2026-08-10T12:00:30.000Z", signerId: "other", publicKey: keys.publicKey }), /signer/);
  assert.throws(() => verifyTopologyEvidence(signed, { tenant: "tenant_1", now: "2026-08-10T12:02:00.000Z", signerId: "kernel_1", publicKey: keys.publicKey }), /fresh|expired/i);
});

test("tampering, future observations, and non-verified probe claims fail closed", async () => {
  const keys = generateKeyPairSync("ed25519");
  const checks = verifiedChecks(); checks.providerEgress = "unchecked" as never;
  const probe = createTopologyProbe({ probeId: "container-boundary", checks: Object.fromEntries(fields.map(field => [field, () => checks[field]])) as Record<TopologyEvidenceField, () => "verified" | "unchecked"> });
  const result = await runTopologyProbe(probe, { tenant: "tenant_1", observedAt: at, expiresAt: until });
  const signed = signTopologyEvidence(result, { signerId: "kernel_1", privateKey: keys.privateKey });
  assert.throws(() => assertFreshManagedTopologyEvidence(signed, { tenant: "tenant_1", now: "2026-08-10T12:00:30.000Z", signerId: "kernel_1", publicKey: keys.publicKey }), /verified topology evidence/);
  assert.throws(() => verifyTopologyEvidence({ ...signed, digest: authorityDigest({ tampered: true }) }, { tenant: "tenant_1", now: "2026-08-10T12:00:30.000Z", signerId: "kernel_1", publicKey: keys.publicKey }), /digest|signature/i);
  assert.throws(() => verifyTopologyEvidence(signed, { tenant: "tenant_1", now: "2026-08-10T11:59:59.000Z", signerId: "kernel_1", publicKey: keys.publicKey }), /future|fresh/i);
});
