import test from "node:test";
import assert from "node:assert/strict";
import { foldContinuity } from "../../src/continuity/fold.js";
import type { ContinuitySnapshotV1 } from "../../src/continuity/fs-ledger.js";
import { renderResumeMarkdown } from "../../src/continuity/markdown.js";
import { createResumeProjection } from "../../src/continuity/projection.js";
import {
  consequenceNote,
  digest,
  opened,
} from "./fixtures.js";

function snapshot(events: Parameters<typeof foldContinuity>[0]): ContinuitySnapshotV1 {
  return {
    taskId: "task_1",
    cursor: 1,
    segmentDigest: digest("c"),
    jobCardDigest: digest("a"),
    authoritySnapshotDigest: digest("b"),
    state: foldContinuity(events),
  };
}

test("resume projection answers the seven continuity questions in stable order", () => {
  const projection = createResumeProjection(snapshot([
    opened,
    consequenceNote("event_2", "reserved"),
    consequenceNote("event_3", "dispatched"),
    consequenceNote("event_4", "ambiguous"),
  ]));
  assert.deepEqual(Object.keys(projection.sections), [
    "outcomeOwed",
    "bindingDecisions",
    "workState",
    "consequentialState",
    "remainingEnvelope",
    "evidenceAndUncertainty",
    "nextSafeActions",
  ]);
  assert.deepEqual(projection.sections.nextSafeActions, ["reconcile-before-retry"]);
  assert.match(renderResumeMarkdown(projection), /## 7\. Next safe actions[\s\S]*reconcile-before-retry/);
});

test("resume projection never decorates unchecked or absent claims as complete", () => {
  const markdown = renderResumeMarkdown(createResumeProjection(snapshot([opened, {
    type: "claim.recorded",
    eventId: "e_claim",
    claimId: "claim_1",
    statement: "The release is safe",
    status: "unchecked",
    evidenceDigest: null,
  }, {
    type: "claim.recorded",
    eventId: "e_absent",
    claimId: "claim_2",
    statement: "The external report exists",
    status: "absent",
    evidenceDigest: null,
  }])));
  assert.match(markdown, /unchecked/);
  assert.match(markdown, /absent/);
  assert.doesNotMatch(markdown, /✅|passed|complete\b/i);
});

test("resume projection sorts binding decisions and exposes supersession count", () => {
  const projection = createResumeProjection(snapshot([
    opened,
    { type: "decision.recorded", eventId: "e1", decisionId: "z", statement: "Old", decidedBy: "human", binding: true, evidenceDigest: digest("1") },
    { type: "decision.recorded", eventId: "e2", decisionId: "a", statement: "Current", decidedBy: "human", binding: true, evidenceDigest: digest("2") },
    { type: "decision.superseded", eventId: "e3", decisionId: "z", supersededByDecisionId: "a" },
  ]));
  assert.deepEqual(projection.sections.bindingDecisions.map((item) => item.decisionId), ["a"]);
  assert.equal(projection.sections.remainingEnvelope.supersededDecisionCount, 1);
});

test("resume projection refuses an empty ledger snapshot", () => {
  assert.throws(() => createResumeProjection({
    taskId: "task_1",
    cursor: 0,
    segmentDigest: null,
    jobCardDigest: null,
    authoritySnapshotDigest: null,
    state: null,
  }), /empty.*snapshot|nothing to resume/i);
});

test("resume projection refuses a structurally fabricated folded snapshot", () => {
  const legitimate = snapshot([opened]);
  const fabricated = {
    ...legitimate,
    state: {
      ...legitimate.state!,
      claims: new Map([["forged", {
        claimId: "forged",
        statement: "Fabricated verified state",
        status: "verified",
        evidenceDigest: digest("f"),
      }]]),
    },
  };
  assert.throws(() => createResumeProjection(fabricated as never), /fold.*provenance|provenance.*fold/i);

  const mutated = snapshot([opened]);
  (mutated.state!.claims as Map<string, unknown>).set("forged", {
    claimId: "forged",
    statement: "Mutated verified state",
    status: "verified",
    evidenceDigest: digest("f"),
  });
  assert.throws(() => createResumeProjection(mutated), /fold.*integrity|integrity.*fold/i);
});
