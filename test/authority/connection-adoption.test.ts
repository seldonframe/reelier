import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import type { DownstreamConnection } from "../../src/mcp-client.js";
import { connectionDescriptorDigest, createOpaqueConnectionRouteRegistry } from "../../src/connections.js";
import { normalizeConnectionAdoption, normalizeConnectionDescriptor } from "../../src/observation/index.js";
import { signJobCard, signedJobCardDigest } from "../../src/authority/job.js";

const sha = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;
const descriptor = normalizeConnectionDescriptor({
  v: "reelier.connection-descriptor/v1", connectionId: "github", kind: "adopted-mcp-stdio",
  provider: { id: "github", toolServerName: "github-mcp" },
  callableRoute: { kind: "mcp-stdio", routeId: "route.github", endpointIds: ["issues.get", "issues.labels.set"] },
  account: { status: "verified", identity: "github:fixlyai" },
  toolSchemas: [{ toolName: "issues.labels.set", digest: sha("a") }, { toolName: "issues.get", digest: sha("b") }],
  secretOwner: "host", coverage: { v: "reelier.host-coverage/v1", host: "codex", observation: "observed", outcomeInvocation: "supported", exclusiveEnforcement: "unknown", limitations: ["raw-write-reachability-unmeasured"] },
});

function signedCard() {
  const key = generateKeyPairSync("ed25519");
  return { key, card: signJobCard({ v: "reelier.signed-job-card/v1", jobId: "release", title: "Release", taskShapeDigest: sha("c"), semanticClasses: ["record_state_set_v1"], definitionAliases: ["github_issue_labels_set_v1"], connectorIds: ["github"], accountIdentities: ["github:fixlyai"], connectionDescriptorDigests: [connectionDescriptorDigest(descriptor)], sourceRefs: ["issue"], audiences: ["operator"], limitsDigest: sha("d"), instructionsDigest: sha("e"), packDigests: [sha("f")], exceptionPolicy: ["ambiguous-reconcile"], coverage: "declared-surface" }, "human", key.privateKey) };
}

test("descriptor digest is JCS stable and an active adoption binds the signed job", () => {
  const reordered = normalizeConnectionDescriptor({ ...descriptor, toolSchemas: [...descriptor.toolSchemas].reverse(), callableRoute: { ...descriptor.callableRoute, endpointIds: [...descriptor.callableRoute.endpointIds].reverse() } });
  assert.equal(connectionDescriptorDigest(reordered), connectionDescriptorDigest(descriptor));
  const { card } = signedCard();
  const adoption = normalizeConnectionAdoption({ v: "reelier.connection-adoption/v1", adoptionId: "adopt_1", descriptorDigest: connectionDescriptorDigest(descriptor), selectedAccountIdentity: descriptor.account.identity, mode: "existing", sidecarRouteId: descriptor.callableRoute.routeId, rawWriteReachability: "reachable", activationState: "active", signedDeploymentBinding: signedJobCardDigest(card), secureConnectionCommitment: null });
  assert.equal(adoption.signedDeploymentBinding, signedJobCardDigest(card));
  assert.equal(JSON.stringify(adoption).includes("token"), false);
});

test("managed adoption cannot activate without refused raw writes and a secure commitment", () => {
  const { card } = signedCard();
  const base = { v: "reelier.connection-adoption/v1", adoptionId: "adopt_1", descriptorDigest: connectionDescriptorDigest(descriptor), selectedAccountIdentity: descriptor.account.identity, mode: "managed", sidecarRouteId: descriptor.callableRoute.routeId, rawWriteReachability: "refused", activationState: "active", signedDeploymentBinding: signedJobCardDigest(card), secureConnectionCommitment: null };
  assert.throws(() => normalizeConnectionAdoption(base), /managed|secure|invalid/i);
  assert.doesNotThrow(() => normalizeConnectionAdoption({ ...base, secureConnectionCommitment: sha("9") }));
});

test("opaque route registry checks exact descriptor and does not open routes until explicit resolution", async () => {
  let opened = 0;
  const connection = { name: "github", tools: [], async call() { return { content: [] }; }, async close() {} } satisfies DownstreamConnection;
  const registry = createOpaqueConnectionRouteRegistry();
  registry.register({ sidecarRouteId: "route.github", descriptor, resolve: async () => { opened++; return connection; } });
  assert.equal(opened, 0);
  const { card } = signedCard();
  const adoption = normalizeConnectionAdoption({ v: "reelier.connection-adoption/v1", adoptionId: "adopt_1", descriptorDigest: connectionDescriptorDigest(descriptor), selectedAccountIdentity: descriptor.account.identity, mode: "existing", sidecarRouteId: "route.github", rawWriteReachability: "unknown", activationState: "active", signedDeploymentBinding: signedJobCardDigest(card), secureConnectionCommitment: null });
  assert.equal(await registry.resolve(descriptor, adoption), connection);
  assert.equal(opened, 1);
  await assert.rejects(() => registry.resolve({ ...descriptor, account: { status: "verified", identity: "github:other" } }, adoption), /descriptor|account|route/i);
  const missing = createOpaqueConnectionRouteRegistry();
  await assert.rejects(() => missing.resolve(descriptor, adoption), /route.*missing/i);
});
