import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { runFlyCertification } from "../../src/authority/host/fly-certification.js";

const surface = {
  providerEndpoints: ["api.github.com"],
  rawWriteRouteIds: ["github.issue.labels"],
  schemaDigest: "sha256:" + "a".repeat(64),
  networkPolicyDigest: "sha256:" + "b".repeat(64),
  runtimeImageDigest: "sha256:" + "c".repeat(64),
} as const;

const operations = {
  inspectRuntimeIdentity: async ({ nonce }: { nonce: string }) => ({ nonce, runtimeSession: "session-1", imageDigest: surface.runtimeImageDigest }),
  inspectCredentialIsolation: async () => ({ cellCredentialRefs: ["github-ref"], agentCredentialRefs: [], complete: true }),
  probeProviderEgress: async ({ caller }: { caller: "cell" | "agent" }) => caller === "cell",
  inspectRawWriteReachability: async () => ({ routes: [], complete: true }),
  inspectReadCoverage: async () => ({ surfaces: ["github.issue.read"], complete: true }),
  inspectDeclaredSurface: async () => ({ networkPolicyDigest: surface.networkPolicyDigest, providerEndpoints: surface.providerEndpoints, schemaDigest: surface.schemaDigest }),
};

test("Fly certification runs the six active claims and signs redacted evidence", async () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const result = await runFlyCertification({ declaredSurface: surface, operations, tenant: "tenant_1", observedAt: "2026-08-10T12:00:00.000Z", expiresAt: "2026-08-10T12:01:00.000Z", nonce: "challenge-1", signer: { signerId: "cell", privateKey } });
  assert.equal(result.evidence.credentialIsolation, "verified");
  assert.equal(result.evidence.providerEgress, "verified");
  assert.equal(result.signed?.signerId, "cell");
  assert.equal("credentialRefs" in result, false);
});

test("Fly certification fails closed on stale or incomplete topology", async () => {
  await assert.rejects(() => runFlyCertification({ declaredSurface: surface, operations: { ...operations, inspectRawWriteReachability: async () => ({ routes: ["browser.write"], complete: true }) }, tenant: "tenant_1", observedAt: "2026-08-10T12:00:00.000Z", expiresAt: "2026-08-10T12:01:00.000Z", nonce: "challenge-2" }), /topology claim/);
});
