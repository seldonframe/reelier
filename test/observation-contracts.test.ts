import test from "node:test";
import assert from "node:assert/strict";
import {
  clusterObservedActionsWithManifests,
  normalizeConnectionAdoption,
  normalizeConnectionDescriptor,
  normalizeConnectionInventoryEntry,
  normalizeHostCoverage,
  normalizeObservedAction,
} from "reelier/observation";
import { normalizeSignedJobCard } from "reelier/authority";

test("observed action rejects fields outside the portable atom schema", () => {
  assert.throws(() => normalizeObservedAction({
    v: "reelier.observed-action/v1",
    adapterId: "mcp",
    sessionId: "s1",
    actionId: "a1",
    tool: "gmail.send",
    fieldNames: [],
    sourceKinds: [],
    destinationKinds: [],
    effect: "idempotent-write",
    coverage: "observed",
    readBackTools: [],
    observedAt: "2026-08-09T00:00:00.000Z",
    rawArguments: "must-not-cross-boundary",
  }), /closed|unrecognized|unknown/i);
});

test("connection descriptors preserve account identity without secrets", () => {
  const descriptor = normalizeConnectionDescriptor({
    v: "reelier.connection-descriptor/v1",
    connectionId: "conn_1",
    kind: "adopted-mcp-stdio",
    provider: { id: "gmail", toolServerName: "gmail-mcp" },
    callableRoute: { kind: "mcp-stdio", routeId: "claude.gmail", endpointIds: ["gmail.read", "gmail.send"] },
    account: { status: "verified", identity: "google:user:123" },
    toolSchemas: [{ toolName: "gmail.get_profile", digest: "sha256:" + "a".repeat(64) }],
    secretOwner: "host",
    coverage: normalizeHostCoverage({
      v: "reelier.host-coverage/v1",
      host: "claude-code",
      observation: "observed",
      outcomeInvocation: "supported",
      exclusiveEnforcement: "declared-surface",
      limitations: [],
    }),
  });
  assert.equal(descriptor.account.identity, "google:user:123");
  assert.equal("accessToken" in descriptor, false);
  assert.throws(() => normalizeConnectionDescriptor({ ...descriptor, accessToken: "secret" }), /closed|invalid|unrecognized|unknown/i);
});

test("connection adoption is closed and round-trips without credential material", () => {
  const adoption = normalizeConnectionAdoption({
    v: "reelier.connection-adoption/v1",
    adoptionId: "adoption_1",
    descriptorDigest: "sha256:" + "b".repeat(64),
    selectedAccountIdentity: "google:user:123",
    mode: "existing",
    sidecarRouteId: "sidecar.gmail",
    rawWriteReachability: "unknown",
    activationState: "inactive",
    signedDeploymentBinding: null,
    secureConnectionCommitment: null,
  });
  assert.deepEqual(normalizeConnectionAdoption(JSON.parse(JSON.stringify(adoption))), adoption);
  assert.throws(() => normalizeConnectionAdoption({ ...adoption, refreshToken: "secret" }), /closed|invalid|unrecognized|unknown/i);
  assert.throws(() => normalizeConnectionAdoption({ ...adoption, mode: "managed", activationState: "active", rawWriteReachability: "reachable" }), /invalid/i);
  assert.throws(() => normalizeConnectionAdoption({ ...adoption, activationState: "active", signedDeploymentBinding: null }), /invalid/i);
});

test("unverified inventory entries cannot fabricate a usable descriptor", () => {
  const entry = normalizeConnectionInventoryEntry({
    v: "reelier.connection-inventory-entry/v1",
    discoveryId: "discovery_1",
    provider: "gmail",
    connectionKind: "host-private",
    status: "shadow-only",
    routeStatus: "host-private",
    accountVerification: { status: "unverified" },
    schemaVerification: { status: "unverified", expectedDigests: [], observedDigests: [] },
    reasonCodes: ["host-private-route"],
  });
  assert.equal(entry.descriptor, undefined);
  assert.throws(() => normalizeConnectionInventoryEntry({ ...entry, descriptor: { v: "reelier.connection-descriptor/v1" } }), /descriptor|invalid/i);
});

test("usable inventory entries require coherent callable verification", () => {
  const descriptor = normalizeConnectionDescriptor({
    v: "reelier.connection-descriptor/v1",
    connectionId: "conn_1",
    kind: "adopted-mcp-stdio",
    provider: { id: "gmail", toolServerName: "gmail-mcp" },
    callableRoute: { kind: "mcp-stdio", routeId: "claude.gmail", endpointIds: ["gmail.get_profile"] },
    account: { status: "verified", identity: "google:user:123" },
    toolSchemas: [{ toolName: "gmail.get_profile", digest: "sha256:" + "a".repeat(64) }],
    secretOwner: "host",
    coverage: normalizeHostCoverage({ v: "reelier.host-coverage/v1", host: "claude-code", observation: "unknown", outcomeInvocation: "supported", exclusiveEnforcement: "unknown", limitations: [] }),
  });
  const usable = { v: "reelier.connection-inventory-entry/v1", discoveryId: "discovery_1", provider: "gmail", connectionKind: "adopted-mcp-stdio", status: "usable", routeStatus: "callable", accountVerification: { status: "verified", identity: "google:user:123" }, schemaVerification: { status: "verified", expectedDigests: ["sha256:" + "a".repeat(64)], observedDigests: ["sha256:" + "a".repeat(64)] }, reasonCodes: [], descriptor };
  assert.equal(normalizeConnectionInventoryEntry(usable).status, "usable");
  assert.throws(() => normalizeConnectionInventoryEntry({ ...usable, routeStatus: "unsupported" }), /usable|coherent|invalid/i);
  assert.throws(() => normalizeConnectionInventoryEntry({ ...usable, provider: "slack" }), /usable|coherent|invalid/i);
  assert.throws(() => normalizeConnectionInventoryEntry({ ...usable, accountVerification: { status: "unverified" } }), /usable|coherent|invalid/i);
  assert.throws(() => normalizeConnectionInventoryEntry({ ...usable, accountVerification: { status: "verified", identity: "google:user:123", expectedIdentity: "google:user:999" } }), /usable|coherent|invalid/i);
  assert.throws(() => normalizeConnectionInventoryEntry({ ...usable, schemaVerification: { status: "verified", expectedDigests: ["sha256:" + "b".repeat(64)], observedDigests: ["sha256:" + "a".repeat(64)] } }), /usable|coherent|invalid/i);
  assert.throws(() => normalizeConnectionInventoryEntry({ ...usable, descriptor: { ...descriptor, callableRoute: { ...descriptor.callableRoute, kind: "mcp-http" } } }), /usable|coherent|invalid/i);
});

test("signed job cards reject unreviewed authority fields", () => {
  const card = normalizeSignedJobCard({
    v: "reelier.signed-job-card/v1",
    signerId: "operator_1",
    signature: { alg: "ed25519", sig: Buffer.alloc(64, 1).toString("base64") },
    jobId: "job_1",
    title: "Reply to qualified customer requests",
    taskShapeDigest: "sha256:" + "a".repeat(64),
    semanticClasses: ["communication_commit_v1"],
    definitionAliases: ["gmail_reply_send_v1"],
    connectorIds: ["conn_1"],
    accountIdentities: ["google:user:123"],
    connectionDescriptorDigests: ["sha256:" + "e".repeat(64)],
    sourceRefs: ["source_1"],
    audiences: ["agent_1"],
    limitsDigest: "sha256:" + "b".repeat(64),
    instructionsDigest: "sha256:" + "c".repeat(64),
    packDigests: ["sha256:" + "d".repeat(64)],
    exceptionPolicy: ["ambiguous-never-resend"],
    coverage: "declared-surface",
  });
  assert.equal(card.jobId, "job_1");
  assert.throws(() => normalizeSignedJobCard({ ...card, monetaryAuthority: "not-a-job-field" }), /closed|invalid|unrecognized|unknown/i);
});

test("candidate pack matches come only from installed manifest identities", () => {
  const action = normalizeObservedAction({
    v: "reelier.observed-action/v1",
    adapterId: "mcp",
    sessionId: "s1",
    actionId: "a1",
    tool: "composio__GMAIL_SEND_EMAIL",
    fieldNames: ["thread_id", "body"],
    sourceKinds: ["gmail.thread"],
    destinationKinds: ["gmail.message"],
    effect: "idempotent-write",
    coverage: "observed",
    readBackTools: ["composio__GMAIL_GET_MESSAGE"],
    observedAt: "2026-08-09T00:00:00.000Z",
  });
  const candidate = clusterObservedActionsWithManifests([action], "candidate_3", 3, [
    { alias: "gmail_reply_send_v1", toolPatterns: ["composio__GMAIL_SEND_EMAIL"] },
    { alias: "unrelated_v1", toolPatterns: ["slack_send_message"] },
  ]);
  assert.deepEqual(candidate.compatiblePacks, ["gmail_reply_send_v1"]);
});
