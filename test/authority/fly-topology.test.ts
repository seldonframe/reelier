import test from "node:test";
import assert from "node:assert/strict";
import { createFlyTopologyProbe, runFlyTopologyProbe } from "reelier/authority/host";

const declaredSurface = {
  providerEndpoints: ["api.github.com", "api.vercel.com"],
  rawWriteRouteIds: ["github.issue.labels", "vercel.deployment.promote"],
  schemaDigest: "sha256:" + "a".repeat(64),
  networkPolicyDigest: "sha256:" + "b".repeat(64),
  runtimeImageDigest: "sha256:" + "c".repeat(64),
};

test("Fly topology probe verifies isolated cell, blocked agent routes, and exact declared surface", async () => {
  const probe = createFlyTopologyProbe({
    allowLive: true,
    declaredSurface,
    operations: {
      inspectRuntimeIdentity: async ({ nonce }) => ({ nonce, runtimeSession: "session-1", imageDigest: declaredSurface.runtimeImageDigest }),
      inspectCredentialIsolation: async () => ({ cellCredentialRefs: ["github-prod"], agentCredentialRefs: [], complete: true }),
      probeProviderEgress: async ({ endpoint, caller }) => caller === "cell" && declaredSurface.providerEndpoints.includes(endpoint),
      inspectRawWriteReachability: async () => ({ routes: [], complete: true }),
      inspectReadCoverage: async () => ({ surfaces: ["github.issue.read"], complete: true }),
      inspectDeclaredSurface: async () => ({ networkPolicyDigest: declaredSurface.networkPolicyDigest, providerEndpoints: declaredSurface.providerEndpoints, schemaDigest: declaredSurface.schemaDigest }),
    },
    nonce: "challenge-1",
  });
  const result = await runFlyTopologyProbe(probe, { tenant: "tenant-1", observedAt: "2026-08-10T12:00:00.000Z", expiresAt: "2026-08-10T12:01:00.000Z" });
  assert.deepEqual(result.evidence, {
    v: "reelier.topology-evidence/v1",
    credentialIsolation: "verified",
    providerEgress: "verified",
    rawWriteReachability: "verified",
    readCoverage: "verified",
    runtimeIdentity: "verified",
    declaredSurfaceEnforcement: "verified",
  });
});

test("Fly topology probe fails closed when an agent retains a provider write route", async () => {
  const probe = createFlyTopologyProbe({
    allowLive: true,
    declaredSurface,
    operations: {
      inspectRuntimeIdentity: async ({ nonce }) => ({ nonce, runtimeSession: "session-1", imageDigest: declaredSurface.runtimeImageDigest }),
      inspectCredentialIsolation: async () => ({ cellCredentialRefs: ["github-prod"], agentCredentialRefs: ["GITHUB_TOKEN"], complete: true }),
      probeProviderEgress: async ({ caller }) => caller === "cell",
      inspectRawWriteReachability: async () => ({ routes: ["vercel.deployment.promote"], complete: true }),
      inspectReadCoverage: async () => ({ surfaces: [], complete: true }),
      inspectDeclaredSurface: async () => ({ networkPolicyDigest: declaredSurface.networkPolicyDigest, providerEndpoints: declaredSurface.providerEndpoints, schemaDigest: declaredSurface.schemaDigest }),
    },
    nonce: "challenge-2",
  });
  const result = await runFlyTopologyProbe(probe, { tenant: "tenant-1", observedAt: "2026-08-10T12:00:00.000Z", expiresAt: "2026-08-10T12:01:00.000Z" });
  assert.equal(result.evidence.credentialIsolation, "failed");
  assert.equal(result.evidence.rawWriteReachability, "failed");
  assert.equal(result.evidence.providerEgress, "verified");
});

test("Fly topology probe fails closed on an unlisted raw write route", async () => {
  const probe = createFlyTopologyProbe({
    allowLive: true,
    declaredSurface,
    operations: {
      inspectRuntimeIdentity: async ({ nonce }) => ({ nonce, runtimeSession: "session-1", imageDigest: declaredSurface.runtimeImageDigest }),
      inspectCredentialIsolation: async () => ({ cellCredentialRefs: ["github-prod"], agentCredentialRefs: [], complete: true }),
      probeProviderEgress: async ({ caller }) => caller === "cell",
      inspectRawWriteReachability: async () => ({ routes: ["unknown.browser.write"], complete: true }),
      inspectReadCoverage: async () => ({ surfaces: [], complete: true }),
      inspectDeclaredSurface: async () => ({ networkPolicyDigest: declaredSurface.networkPolicyDigest, providerEndpoints: declaredSurface.providerEndpoints, schemaDigest: declaredSurface.schemaDigest }),
    },
    nonce: "challenge-3",
  });
  const result = await runFlyTopologyProbe(probe, { tenant: "tenant-1", observedAt: "2026-08-10T12:00:00.000Z", expiresAt: "2026-08-10T12:01:00.000Z" });
  assert.equal(result.evidence.rawWriteReachability, "failed");
});

test("live Fly probes require explicit acknowledgement", () => {
  assert.throws(() => createFlyTopologyProbe({ declaredSurface, operations: {} as never }), /allowLive/);
});
