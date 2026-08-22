import { test } from "node:test";
import assert from "node:assert/strict";
import { createOperatorLocalCellV1 } from "../../src/operator/local-cell.js";
import type { AuthorityAgentToolsV1 } from "../../src/authority/host/agent-tools.js";

test("local Operator Cell is only a quartet adapter and preserves Cell lifecycle", async () => {
  const calls: string[] = [];
  const agentTools: AuthorityAgentToolsV1 = {
    async agentStatus() { return { requestId: "", verdict: "accepted", reasonCode: "ready", lifecycleState: "ready", outcomeRefs: [], capability: {} as never }; },
    async outcomeProposal() { return { requestId: "req-local", verdict: "accepted", reasonCode: "proposed", lifecycleState: "proposed", outcomeRef: "outcomeref_" + "a".repeat(64) }; },
    async outcomeRequest(input) { calls.push("request"); return { requestId: (input as { requestId: string }).requestId, verdict: "accepted", reasonCode: "pending", lifecycleState: "pending" }; },
    async outcomeStatus(input) { calls.push("status"); return { requestId: (input as { requestId: string }).requestId, verdict: "accepted", reasonCode: "reconciled", lifecycleState: "reconciled", receiptRef: "sha256:" + "b".repeat(64) }; },
  };
  const local = createOperatorLocalCellV1({
    agentTools,
    processFactory: {
      async launch() {
        return { sessionId: "local-session", invocation: { executable: "codex", args: [], cwd: "C:/repo" }, events: (async function* () { yield { v: "reelier.operator-event/v1" as const, harness: "codex" as const, sessionId: "local-session", kind: "completed" as const, payloadDigest: "sha256:c", at: "2026-08-21T00:00:00.000Z" }; })(), async stop() {} };
      },
    } as never,
  });
  const state = await local.supervisor.start({ harness: "codex", cwd: "C:/repo", prompt: "complete bounded issue", cellRequest: { outcomeRef: "outcomeref_" + "a".repeat(64), requestId: "req-local", sourceRefs: {}, choices: {} }, context: { tenant: "tenant", requester: "operator" } });
  await local.supervisor.observe(state.sessionId);
  const done = await local.supervisor.status(state.sessionId);
  assert.equal(local.mode, "local-cell");
  assert.equal(done.cellLifecycle, "reconciled");
  assert.deepEqual(calls, ["request", "status"]);
});

