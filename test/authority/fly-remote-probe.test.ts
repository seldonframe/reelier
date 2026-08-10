import test from "node:test";
import assert from "node:assert/strict";
import { createFlyRemoteTopologyOperations, digestFlyPolicyDeployment, probePinnedFlyBinary } from "../../src/authority/host/fly-remote-probe.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const resource = {
  appName: "reelier-cell",
  authorityMachineId: "cell123",
  agentAppName: "reelier-agent",
  agentMachineId: "agent123",
  egressAppName: "reelier-egress",
  egressMachineId: "gateway123",
  apiCredentialRef: "env:FLY_API_TOKEN",
  flyctlPath: "flyctl",
  flyctlVersion: "0.3.200",
} as const;

function snapshot(role: "agent" | "cell" | "gateway", nonce: string) {
  return {
    v: "reelier.topology-probe-snapshot/v1" as const,
    role,
    nonce,
    runtimeSession: `${role}-session`,
    providerCredentialRefs: role === "cell" ? ["GITHUB_TOKEN"] : [],
    unexpectedCredentialRefs: [],
    rawWriteRouteIds: [],
    readSurfaceIds: ["github.issue.read"],
    providerEndpoints: ["api.github.com"],
    schemaDigest: digest("a"),
  };
}

test("remote Fly operations join actual image and policy state to in-machine probes", async () => {
  const calls: string[] = [];
  const deployedPolicyDigest = digestFlyPolicyDeployment({ authority: digest("b"), agent: digest("d"), gateway: digest("d") });
  const operations = createFlyRemoteTopologyOperations({
    resource,
    expected: { providerEndpoints: ["api.github.com"], schemaDigest: digest("a"), networkPolicyDigest: deployedPolicyDigest, runtimeImageDigest: digest("c"), authorityImageDigest: digest("c"), gatewayImageDigest: digest("c") },
    async getMachine(app, machine) { calls.push(`machine:${app}:${machine}`); return { state: "started", imageDigest: digest("c") }; },
    async getNetworkPolicyDigest(app) { calls.push(`policy:${app}`); return app === resource.appName ? digest("b") : digest("d"); },
    async runProbe(app, machine, action, argument) {
      calls.push(`probe:${app}:${machine}:${action}:${argument}`);
      if (action === "snapshot") return snapshot(app === resource.agentAppName ? "agent" : app === resource.egressAppName ? "gateway" : "cell", argument);
      return { v: "reelier.topology-probe-egress/v1", endpoint: argument, reachable: app === resource.appName };
    },
  });
  const context = { nonce: "challenge-1", mode: "live" as const, tenant: "tenant-1", observedAt: "2026-08-10T12:00:00.000Z", expiresAt: "2026-08-10T12:01:00.000Z" };
  assert.deepEqual(await operations.inspectRuntimeIdentity(context), { nonce: "challenge-1", runtimeSession: "agent-session", imageDigest: digest("c") });
  assert.deepEqual(await operations.inspectCredentialIsolation(context), { cellCredentialRefs: ["GITHUB_TOKEN"], agentCredentialRefs: [], unexpectedCredentialRefs: [], complete: true });
  assert.equal(await operations.probeProviderEgress({ endpoint: "api.github.com", caller: "cell", context }), true);
  assert.equal(await operations.probeProviderEgress({ endpoint: "api.github.com", caller: "agent", context }), false);
  assert.deepEqual(await operations.inspectDeclaredSurface(context), { networkPolicyDigest: deployedPolicyDigest, providerEndpoints: ["api.github.com"], schemaDigest: digest("a") });
  assert.equal(calls.some(call => call === "machine:reelier-cell:cell123"), true);
  assert.equal(calls.some(call => call === "policy:reelier-cell"), true);
});

test("remote Fly operations fail closed on stopped or substituted Machines", async () => {
  const operations = createFlyRemoteTopologyOperations({
    resource,
    expected: { providerEndpoints: ["api.github.com"], schemaDigest: digest("a"), networkPolicyDigest: digest("b"), runtimeImageDigest: digest("c"), authorityImageDigest: digest("c"), gatewayImageDigest: digest("c") },
    async getMachine() { return { state: "stopped", imageDigest: digest("f") }; },
    async getNetworkPolicyDigest() { return digest("b"); },
    async runProbe(app, _machine, _action, argument) { return snapshot(app === resource.agentAppName ? "agent" : "cell", argument); },
  });
  const context = { nonce: "challenge-1", mode: "live" as const, tenant: "tenant-1", observedAt: "2026-08-10T12:00:00.000Z", expiresAt: "2026-08-10T12:01:00.000Z" };
  await assert.rejects(async () => operations.inspectRuntimeIdentity(context), /not started/);
});

test("pinned flyctl probe validates the exact version", async () => {
  assert.equal(await probePinnedFlyBinary("flyctl", "0.3.200", 100, async () => ({ code: 0, output: "flyctl v0.3.200 linux/amd64" })), "available");
  assert.equal(await probePinnedFlyBinary("flyctl", "0.3.200", 100, async () => ({ code: 0, output: "flyctl v0.3.201 linux/amd64" })), "missing");
});
