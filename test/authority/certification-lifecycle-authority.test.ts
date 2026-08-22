import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { authorityDigest } from "../../src/authority/wire.js";
import { AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST } from "../../src/authority/adapter-contract.js";
import { createCertificationLifecycleAuthorityCeremony, createCertificationArtifactKeyBinding } from "../../src/authority/certification/lifecycle-authority.js";
import { profileGovernanceFixture } from "./profile-governance-fixture.js";

const descriptor = (keyId: string, purpose: "certification-readiness", publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"]) => ({ v: "reelier.authority-key-descriptor/v1" as const, keyId, role: "human-sponsor" as const, purpose, algorithm: "ed25519" as const, publicKeySpkiBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64") });

test("pre-readiness lifecycle ceremony exposes only activated public descriptors and an opaque process-local handle", () => {
  const ceremony = createCertificationLifecycleAuthorityCeremony();
  assert.deepEqual(ceremony.publicDescriptors.map(item => item.purpose).sort(), ["authority-evidence", "authority-journal", "authority-receipt", "delegation-grant", "gate-event", "outcome-contract"]);
  assert.deepEqual(Reflect.ownKeys(ceremony.opaqueHandle), []);
  assert.throws(() => structuredClone(ceremony.opaqueHandle), /clone|serial/i);
  assert.equal(JSON.stringify(ceremony), JSON.stringify({ publicDescriptors: ceremony.publicDescriptors, opaqueHandle: {} }));
  assert.equal(JSON.stringify(ceremony).includes("PRIVATE"), false);
  assert.equal(AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST, "sha256:cd092558b6963e9f414445fe2235c30530f17684bad71f1bfcfa487178ec00d7");
});

test("artifact subkeys are closed, purpose-separated, evidence-root delegated, and human committed", () => {
  profileGovernanceFixture();
  const ceremony = createCertificationLifecycleAuthorityCeremony();
  const humanKey = generateKeyPairSync("ed25519");
  const human = descriptor("human_readiness_signer", "certification-readiness", humanKey.publicKey);
  const readinessDigest = `sha256:${"1".repeat(64)}`;
  const result = createCertificationArtifactKeyBinding(ceremony.opaqueHandle, {
    authorityCellId: "cell_certification_1",
    taskId: "task_certification_1",
    readinessDigest,
    humanDescriptor: human,
    humanPrivateKey: humanKey.privateKey,
    issuedAt: "2026-08-12T12:00:00.000Z",
    expiresAt: "2026-08-12T13:00:00.000Z",
  });
  assert.deepEqual(result.binding.entries.map(item => item.artifactPurpose), ["compiled-capability", "pack-manifest", "source-bundle", "transport-effect"]);
  assert.equal(result.binding.parentEvidenceDescriptorDigest, authorityDigest(ceremony.publicDescriptors.find(item => item.purpose === "authority-evidence")));
  assert.equal(result.binding.readinessDigest, readinessDigest);
  assert.equal(result.humanCommitment.bindingDigest, authorityDigest(result.binding));
  assert.equal(result.humanCommitment.readinessDigest, readinessDigest);
  assert.equal(JSON.stringify(result).match(/private|secret|token/gi), null);
  assert.equal(new Set(result.binding.entries.map(item => item.keyId)).size, 4);
  assert.equal(new Set(result.binding.entries.map(item => item.publicKeyDigest)).size, 4);
  assert.equal(Object.isFrozen(result.binding), true);
  assert.equal(Object.isFrozen(result.humanCommitment), true);
});

