import { test } from "node:test";
import assert from "node:assert/strict";
import { createOperatorUsageSnapshotV1, operatorPlanV1 } from "../../src/operator/usage.js";

test("Operator plans charge for managed authority capacity, not inference or receipts", () => {
  assert.equal(operatorPlanV1("managed-personal").monthlyPriceUsd, 49);
  assert.equal(operatorPlanV1("managed-team").maxConcurrentExecutions, 50);
  const usage = createOperatorUsageSnapshotV1({ plan: "managed-team", governedExecutionUnits: 12, humanReviews: 2, receiptsRecorded: 40 });
  assert.equal(usage.receiptsAreBillable, false);
  assert.deepEqual(Object.keys(usage).sort(), ["governedExecutionUnits", "humanReviews", "plan", "receiptsAreBillable", "receiptsRecorded", "v"] .sort());
});

test("negative or unknown usage is refused", () => {
  assert.throws(() => createOperatorUsageSnapshotV1({ plan: "free-local", governedExecutionUnits: -1, humanReviews: 0, receiptsRecorded: 0 }));
  assert.throws(() => operatorPlanV1("unknown" as never));
});

