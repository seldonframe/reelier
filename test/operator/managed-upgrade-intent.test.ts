import { createHmac } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createManagedUpgradeIntentV1,
  createManagedUpgradeIntentConsumerV1,
  parseManagedUpgradeIntentV1,
  recordConsequentialBoundaryV1,
} from "../../src/operator/managed-upgrade-intent.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const secret = "local-test-key";
const sign = (payload: string) => createHmac("sha256", secret).update(payload).digest("hex");

test("a signed contextual upgrade intent is closed, exact, expiring, and one-shot", () => {
  const intent = createManagedUpgradeIntentV1({
    missionRef: "mission-1",
    localEvidenceDigest: digest("a"),
    requestedOperations: ["github_release_pr_merge_v1"],
    targetSummaryDigest: digest("b"),
    returnChannelRef: "return-1",
    issuedAt: "2026-08-24T12:00:00.000Z",
    expiresAt: "2026-08-24T12:10:00.000Z",
    nonce: "nonce-1",
    sign,
  });
  assert.deepEqual(Object.keys(intent), ["version", "missionRef", "localEvidenceDigest", "requestedOperations", "targetSummaryDigest", "returnChannelRef", "issuedAt", "expiresAt", "nonce", "signature"]);
  const consumer = createManagedUpgradeIntentConsumerV1({ intent, now: () => "2026-08-24T12:05:00.000Z", verify: (payload, signature) => sign(payload) === signature });
  assert.equal(consumer.consume().missionRef, "mission-1");
  assert.throws(() => consumer.consume(), /already consumed/);
  assert.throws(() => parseManagedUpgradeIntentV1({ ...intent, repository: "secret/repo" }), /shape/);
  assert.throws(() => createManagedUpgradeIntentConsumerV1({ intent: { ...intent, targetSummaryDigest: digest("c") }, now: () => "2026-08-24T12:05:00.000Z", verify: (payload, signature) => sign(payload) === signature }).consume(), /signature/);
  assert.throws(() => createManagedUpgradeIntentConsumerV1({ intent, now: () => "2026-08-24T12:10:00.000Z", verify: () => true }).consume(), /expired/);
});

test("managed upgrade intents accept every valid base64url signature prefix", () => {
  for (const prefix of ["_", "-"]) {
    const signature = `${prefix}${"a".repeat(85)}`;
    const intent = createManagedUpgradeIntentV1({
      missionRef: "mission-signature",
      localEvidenceDigest: digest("a"),
      requestedOperations: ["github_release_pr_merge_v1"],
      targetSummaryDigest: digest("b"),
      returnChannelRef: "return-signature",
      issuedAt: "2026-08-24T12:00:00.000Z",
      expiresAt: "2026-08-24T12:10:00.000Z",
      nonce: "nonce-signature",
      sign: () => signature,
    });
    assert.equal(intent.signature, signature);
  }
});

test("the contextual CTA appears once for an exact reviewed consequence and never for local work", () => {
  assert.equal(recordConsequentialBoundaryV1({ missionRef: "mission-1", operation: "local.commit", seen: new Set() }), null);
  const seen = new Set<string>();
  const first = recordConsequentialBoundaryV1({ missionRef: "mission-1", operation: "github_release_pr_merge_v1", seen });
  assert.equal(first, "Ready to merge. Continue natively, or let Reelier execute and verify it with bounded authority: reelier operator autopilot mission-1");
  assert.equal(recordConsequentialBoundaryV1({ missionRef: "mission-1", operation: "github_release_pr_merge_v1", seen }), null);
  assert.equal(recordConsequentialBoundaryV1({ missionRef: "mission-1", operation: "unknown_provider_write", seen: new Set() }), null);
});
