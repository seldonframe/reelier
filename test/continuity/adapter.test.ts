import test from "node:test";
import assert from "node:assert/strict";
import type { AuthorityIngressOutcome } from "../../src/authority/ingress/mcp.js";
import type { OutcomeRequest } from "../../src/authority/types.js";
import { createContinuityRuntimeAdapter } from "../../src/continuity/adapter.js";
import { FsContinuityLedger } from "../../src/continuity/fs-ledger.js";
import { actor, checkpoint, opened, withRoot } from "./fixtures.js";

test("adapter takes identity from the host and never from checkpoint prose", async () => {
  await withRoot(async root => {
    const adapter = createContinuityRuntimeAdapter({
      ledger: new FsContinuityLedger(root),
      identify: async () => actor,
      requestOutcome: async () => { throw new Error("unused Outcome requester"); },
    });
    assert.deepEqual(await adapter.identify(), actor);
    await assert.rejects(
      () => adapter.checkpoint({ ...checkpoint(0, [opened]), actorPrincipalId: "other" }),
      /authenticated actor/i,
    );
  });
});

test("adapter binds Outcome requests to host identity without adding provider authority", async () => {
  await withRoot(async root => {
    let observed: readonly [typeof actor, OutcomeRequest] | undefined;
    const outcome: AuthorityIngressOutcome = {
      requestId: "request_1",
      verdict: "accepted",
      reasonCode: "accepted",
      lifecycleState: "reserved",
      receiptRef: "receipt_1",
    };
    const adapter = createContinuityRuntimeAdapter({
      ledger: new FsContinuityLedger(root),
      identify: async () => actor,
      requestOutcome: async (identity, input) => {
        observed = [identity, input];
        return outcome;
      },
    });
    const request: OutcomeRequest = {
      v: "reelier.outcome-request/v1",
      requestId: "request_1",
      sourceRefs: { issue: "issue_1" },
      choices: { label: "ready" },
    };
    assert.deepEqual(await adapter.requestOutcome(request), outcome);
    assert.deepEqual(observed, [actor, request]);
    assert.deepEqual(Object.keys(observed?.[1] ?? {}).sort(), ["choices", "requestId", "sourceRefs", "v"]);
  });
});
