import test from "node:test";
import assert from "node:assert/strict";
import { normalizeContinuityCheckpoint } from "../../src/continuity/normalize.js";
import { actor, checkpoint, digest, opened, reservedConsequence } from "./fixtures.js";

test("checkpoint normalization binds the host-authenticated actor", () => {
  const result = normalizeContinuityCheckpoint({
    ...checkpoint(0, [opened]),
    agentMemo: { status: "unchecked", text: "Start with tests" },
  }, actor);
  assert.equal(result.actor.runtimeSessionId, "session_1");
  assert.equal(result.checkpoint.proposedEvents[0]?.type, "task.opened");
});

test("checkpoint normalization refuses actor substitution and unknown fields", () => {
  const base = checkpoint(0, []);
  assert.throws(
    () => normalizeContinuityCheckpoint({ ...base, actorPrincipalId: "attacker" }, actor),
    /authenticated actor/i,
  );
  assert.throws(
    () => normalizeContinuityCheckpoint({ ...base, surprise: true }, actor),
    /unknown|shape/i,
  );
  assert.throws(
    () => normalizeContinuityCheckpoint({ ...base, agentMemo: { status: "verified", text: "done" } }, actor),
    /unchecked/i,
  );
});

test("checkpoint normalization refuses ungrounded binding and verified claims", () => {
  assert.throws(() => normalizeContinuityCheckpoint(checkpoint(0, [{
    type: "decision.recorded",
    eventId: "event_2",
    decisionId: "decision_1",
    statement: "Deploy now",
    decidedBy: "agent",
    binding: true,
    evidenceDigest: null,
  }]), actor), /binding decision.*evidence/i);
  assert.throws(() => normalizeContinuityCheckpoint(checkpoint(0, [{
    type: "claim.recorded",
    eventId: "event_2",
    claimId: "claim_1",
    statement: "Deployment passed",
    status: "verified",
    evidenceDigest: null,
  } as never]), actor), /verified.*evidence/i);
  assert.throws(() => normalizeContinuityCheckpoint(checkpoint(0, [{
    type: "claim.recorded",
    eventId: "event_3",
    claimId: "claim_2",
    statement: "Deployment passed",
    status: "verified",
    evidenceDigest: digest("c"),
  } as never]), actor), /verified.*verifier|public checkpoint.*verified/i);
});

test("public checkpoints cannot construct authority-verified consequences", () => {
  assert.throws(
    () => normalizeContinuityCheckpoint(checkpoint(0, [reservedConsequence as never]), actor),
    /consequence.*verifier|public checkpoint.*authority/i,
  );
});

test("checkpoint normalization rejects malformed digests and duplicate event IDs", () => {
  assert.throws(
    () => normalizeContinuityCheckpoint({ ...checkpoint(0, []), jobCardDigest: digest("z").slice(0, -1) }, actor),
    /digest/i,
  );
  assert.throws(
    () => normalizeContinuityCheckpoint(checkpoint(0, [opened, opened]), actor),
    /duplicate event/i,
  );
});
