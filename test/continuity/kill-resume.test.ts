import test from "node:test";
import assert from "node:assert/strict";
import { createContinuityRuntimeAdapter } from "../../src/continuity/adapter.js";
import { FsContinuityLedger } from "../../src/continuity/fs-ledger.js";
import {
  actor,
  ambiguousConsequence,
  checkpoint,
  dispatchedConsequence,
  opened,
  reservedConsequence,
  successorActor,
  withRoot,
} from "./fixtures.js";

test("a replacement harness resumes ambiguity without issuing another Outcome", async () => {
  await withRoot(async root => {
    let requests = 0;
    const requestOutcome = async () => {
      requests += 1;
      throw new Error("replacement must reconcile, never redispatch");
    };
    const first = createContinuityRuntimeAdapter({
      ledger: new FsContinuityLedger(root),
      identify: async () => actor,
      requestOutcome,
    });
    await first.checkpoint(checkpoint(0, [
      opened,
      reservedConsequence,
      dispatchedConsequence,
      ambiguousConsequence,
    ]));

    const successor = createContinuityRuntimeAdapter({
      ledger: new FsContinuityLedger(root),
      identify: async () => successorActor,
      requestOutcome,
    });
    const resumed = await successor.open("task_1");
    assert.equal(resumed.taskId, "task_1");
    assert.deepEqual(resumed.sections.nextSafeActions, ["reconcile-before-retry"]);
    assert.equal(requests, 0);
  });
});

test("adapter refuses a host identity from another task", async () => {
  await withRoot(async root => {
    const first = createContinuityRuntimeAdapter({
      ledger: new FsContinuityLedger(root),
      identify: async () => actor,
      requestOutcome: async () => { throw new Error("unused"); },
    });
    await first.checkpoint(checkpoint(0, [opened]));
    const otherTaskActor = { ...successorActor, taskId: "task_2" };
    const successor = createContinuityRuntimeAdapter({
      ledger: new FsContinuityLedger(root),
      identify: async () => otherTaskActor,
      requestOutcome: async () => { throw new Error("unused"); },
    });
    await assert.rejects(() => successor.open("task_1"), /cross-task|authenticated task/i);
  });
});
