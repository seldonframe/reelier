import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { signAuthorityDigest } from "../../src/authority/crypto.js";
import { authorityDigest } from "../../src/authority/wire.js";
import {
  createCertificationTaskStatusEvidence,
  createCertificationPostStateEvidence,
  verifyCertificationTaskStatusEvidence,
} from "../../src/authority/certification/portable-evidence.js";

const key = generateKeyPairSync("ed25519");
const signer = {
  signerId: "authority_evidence_1",
  sign: (digest: string) => signAuthorityDigest(key.privateKey, "authority-evidence", digest),
};
const verifier = { signerId: signer.signerId, publicKey: key.publicKey };

test("portable task status binds the signed observation time without claiming later freshness", () => {
  const evidence = createCertificationTaskStatusEvidence({
    phase: "export",
    taskId: "task_1",
    lifecycleState: "active",
    grantExpiresAt: "2026-08-12T13:00:00.000Z",
    allocationRevoked: false,
    observedAt: "2026-08-12T12:00:00.000Z",
    durableHistoryDigest: `sha256:${"1".repeat(64)}`,
    currentActiveClaim: true,
  }, signer);
  assert.deepEqual(verifyCertificationTaskStatusEvidence(evidence, verifier), {
    status: "verified",
    freshness: "unchecked",
    observationDigest: authorityDigest(evidence),
  });
  const expired: any = structuredClone(evidence);
  expired.grantExpiresAt = "2026-08-12T11:00:00.000Z";
  assert.throws(() => verifyCertificationTaskStatusEvidence(expired, verifier), /signature|expired|active/i);
  const revoked = createCertificationTaskStatusEvidence({
    phase: "export",
    taskId: "task_1",
    lifecycleState: "revoked",
    grantExpiresAt: "2026-08-12T13:00:00.000Z",
    allocationRevoked: true,
    observedAt: "2026-08-12T12:00:00.000Z",
    durableHistoryDigest: `sha256:${"2".repeat(64)}`,
    currentActiveClaim: false,
  }, signer);
  assert.equal(verifyCertificationTaskStatusEvidence(revoked, verifier).status, "verified");
  const falseActive: any = { ...revoked, currentActiveClaim: true };
  assert.throws(() => verifyCertificationTaskStatusEvidence(falseActive, verifier), /signature|revoked|active/i);
});

test("partial post-state requires a reviewed observation with a real observed projection", () => {
  assert.throws(() => createCertificationPostStateEvidence({ requestId: "request_1", dispatchRequestDigest: `sha256:${"1".repeat(64)}`, permitSnapshotDigest: `sha256:${"2".repeat(64)}`, expectedProjectionDigest: `sha256:${"3".repeat(64)}`, preSourceBundleDigest: `sha256:${"4".repeat(64)}`, projectionSchemaId: "github_issue_labels_projection_v1", projectionSchemaDigest: `sha256:${"5".repeat(64)}`, preProjectionDigest: `sha256:${"6".repeat(64)}`, observedProjectionDigest: null, observationMethod: "not-observed", observedAt: "2026-08-12T12:00:00.000Z", confidence: "partial" }, signer), /partial|observed|method/i);
});
