import test from "node:test";
import assert from "node:assert/strict";
import { foldContinuity } from "../../src/continuity/fold.js";
import { consequence, digest, opened } from "./fixtures.js";

test("fold exposes only active decisions and preserves terminal obligations", () => {
  const events = [
    opened,
    { type: "decision.recorded", eventId: "e2", decisionId: "d1", statement: "Use API v1", decidedBy: "human", binding: true, evidenceDigest: digest("1") },
    { type: "decision.recorded", eventId: "e3", decisionId: "d2", statement: "Use API v2", decidedBy: "human", binding: true, evidenceDigest: digest("2") },
    { type: "decision.superseded", eventId: "e4", decisionId: "d1", supersededByDecisionId: "d2" },
    { type: "obligation.opened", eventId: "e5", obligationId: "o1", statement: "Run tests", acceptanceEvidence: "test output", ownerWorkloadId: "builder" },
    { type: "obligation.transitioned", eventId: "e6", obligationId: "o1", to: "satisfied", reason: "green", evidenceDigest: digest("3") },
  ] as const;
  const state = foldContinuity(events);
  assert.deepEqual(state.activeDecisions.map((item) => item.decisionId), ["d2"]);
  assert.equal(state.obligations.get("o1")?.state, "satisfied");
  assert.throws(() => foldContinuity([...events, {
    type: "obligation.transitioned",
    eventId: "e7",
    obligationId: "o1",
    to: "blocked",
    reason: "reopen",
    evidenceDigest: null,
  }]), /terminal/i);
});

test("fold follows Path C consequence lifecycle and refuses resend-shaped regressions", () => {
  const reserved = consequence("e2", "reserved");
  const dispatched = consequence("e3", "dispatched");
  const ambiguous = consequence("e4", "ambiguous");
  const reconciled = consequence("e5", "reconciled", digest("9"));
  assert.equal(
    foldContinuity([opened, reserved, dispatched, ambiguous, reconciled]).consequences.get("operation_1")?.state,
    "reconciled",
  );
  assert.throws(
    () => foldContinuity([opened, reserved, dispatched, ambiguous, consequence("e5", "dispatched")]),
    /illegal consequence transition/i,
  );
});

test("fold refuses duplicate creations, missing references, and reservation swaps", () => {
  const obligation = {
    type: "obligation.opened" as const,
    eventId: "e2",
    obligationId: "o1",
    statement: "Run tests",
    acceptanceEvidence: "test output",
    ownerWorkloadId: "builder",
  };
  assert.throws(() => foldContinuity([opened, obligation, { ...obligation, eventId: "e3" }]), /duplicate obligation/i);
  assert.throws(() => foldContinuity([opened, {
    type: "decision.superseded",
    eventId: "e2",
    decisionId: "missing",
    supersededByDecisionId: "also-missing",
  }]), /missing decision/i);
  assert.throws(() => foldContinuity([
    opened,
    consequence("e2", "reserved"),
    { ...consequence("e3", "dispatched"), reservationId: "reservation_2" },
  ]), /reservation/i);
});

test("fold returns maps and active arrays in stable identifier order", () => {
  const state = foldContinuity([
    opened,
    { type: "claim.recorded", eventId: "e2", claimId: "z", statement: "Last", status: "unchecked", evidenceDigest: null },
    { type: "claim.recorded", eventId: "e3", claimId: "a", statement: "First", status: "absent", evidenceDigest: null },
  ]);
  assert.deepEqual([...state.claims.keys()], ["a", "z"]);
});
