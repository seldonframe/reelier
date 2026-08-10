import test from "node:test";
import assert from "node:assert/strict";
import {
  clusterObservedActionsWithManifests,
  normalizeConnectionDescriptor,
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
    provider: "gmail",
    accountIdentity: "google:user:123",
    toolSchemaDigests: ["sha256:" + "a".repeat(64)],
    sourceEndpointIds: ["gmail.read"],
    writeEndpointIds: ["gmail.send"],
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
  assert.equal(descriptor.accountIdentity, "google:user:123");
  assert.equal("accessToken" in descriptor, false);
  assert.throws(() => normalizeConnectionDescriptor({ ...descriptor, accessToken: "secret" }), /closed|invalid|unrecognized|unknown/i);
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
