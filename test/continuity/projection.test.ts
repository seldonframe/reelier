import test from "node:test";
import assert from "node:assert/strict";
import { FsContinuityLedger, type ContinuitySnapshotV1 } from "../../src/continuity/fs-ledger.js";
import type { ContinuityEventV1 } from "../../src/continuity/types.js";
import { renderResumeMarkdown } from "../../src/continuity/markdown.js";
import { createResumeProjection } from "../../src/continuity/projection.js";
import {
  actor,
  checkpoint,
  consequenceNote,
  digest,
  opened,
  withRoot,
} from "./fixtures.js";

async function snapshot(events: readonly ContinuityEventV1[]): Promise<ContinuitySnapshotV1> {
  return withRoot(async root => {
    const ledger = new FsContinuityLedger(root);
    const appended = await ledger.append(actor, checkpoint(0, events));
    assert.equal(appended.ok, true);
    return ledger.read(actor.taskId);
  });
}

test("resume projection answers the seven continuity questions in stable order", async () => {
  const projection = createResumeProjection(await snapshot([
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

test("resume projection never decorates unchecked or absent claims as complete", async () => {
  const markdown = renderResumeMarkdown(createResumeProjection(await snapshot([opened, {
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

test("resume projection sorts binding decisions and exposes supersession count", async () => {
  const projection = createResumeProjection(await snapshot([
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
  }), /snapshot.*provenance|exact.*snapshot|nothing to resume/i);
});

test("resume projection refuses a structurally fabricated folded snapshot", async () => {
  const legitimate = await snapshot([opened]);
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
  assert.throws(() => createResumeProjection(fabricated as never), /snapshot.*provenance|provenance.*snapshot/i);

  assert.throws(() => createResumeProjection({
    ...legitimate,
    taskId: "task_fabricated",
    cursor: 777,
    jobCardDigest: digest("e"),
    authoritySnapshotDigest: digest("f"),
  }), /snapshot.*envelope|envelope.*snapshot/i);

  const mutated = await snapshot([opened]);
  (mutated.state!.claims as Map<string, unknown>).set("forged", {
    claimId: "forged",
    statement: "Mutated verified state",
    status: "verified",
    evidenceDigest: digest("f"),
  });
  const mutationProjection = createResumeProjection(mutated);
  assert.equal(mutationProjection.sections.evidenceAndUncertainty.uncertainClaims.some((item) => item.claimId === "forged"), false);
});

test("resume projection never reads prototype accessors from a registered snapshot or state", async () => {
  const snapshotAccessor = await snapshot([opened]);
  const originalTaskId = snapshotAccessor.taskId;
  delete (snapshotAccessor as { taskId?: string }).taskId;
  let snapshotAccessorReads = 0;
  Object.setPrototypeOf(snapshotAccessor, {
    get taskId() {
      snapshotAccessorReads += 1;
      return snapshotAccessorReads === 1 ? originalTaskId : "task_substituted";
    },
  });
  assert.throws(() => createResumeProjection(snapshotAccessor), /snapshot.*provenance|exact.*snapshot|inert/i);
  assert.equal(snapshotAccessorReads, 0);

  const stateAccessor = await snapshot([opened]);
  const state = stateAccessor.state! as { outcome?: string };
  const originalOutcome = state.outcome!;
  delete state.outcome;
  let stateAccessorReads = 0;
  Object.setPrototypeOf(state, {
    get outcome() {
      stateAccessorReads += 1;
      return stateAccessorReads <= 2 ? originalOutcome : "Substituted outcome";
    },
  });
  const projection = createResumeProjection(stateAccessor);
  assert.equal(projection.sections.outcomeOwed.outcome, originalOutcome);
  assert.equal(stateAccessorReads, 0);
});
