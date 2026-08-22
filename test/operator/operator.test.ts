import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuthorityAgentToolsV1 } from "../../src/authority/host/agent-tools.js";
import { createOperatorSupervisorV1 } from "../../src/operator/operator.js";
import { createOperatorSessionStoreV1 } from "../../src/operator/session-store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function processFactory() {
  return {
    async launch() {
      let stopped = false;
      return {
        sessionId: "session-operator-1",
        invocation: { executable: "codex", args: [], cwd: "C:/repo" },
        events: (async function* () {
          yield { v: "reelier.operator-event/v1" as const, harness: "codex" as const, sessionId: "session-operator-1", kind: "completed" as const, payloadDigest: "sha256:ok", at: "2026-08-21T00:00:00.000Z" };
        })(),
        async stop() { stopped = true; },
        get wasStopped() { return stopped; },
      };
    },
  } as never;
}

function cell(calls: string[]): Pick<AuthorityAgentToolsV1, "outcomeRequest" | "outcomeStatus"> {
  return {
    async outcomeRequest(input) { calls.push(`request:${String((input as { requestId: string }).requestId)}`); return { requestId: "req-1", verdict: "accepted", reasonCode: "accepted", lifecycleState: "pending" }; },
    async outcomeStatus(input) { calls.push(`status:${String((input as { requestId: string }).requestId)}`); return { requestId: "req-1", verdict: "accepted", reasonCode: "reconciled", lifecycleState: "reconciled", receiptRef: "receipt-1" }; },
  };
}

test("harness completion never upgrades an unchecked Cell result", async () => {
  const calls: string[] = [];
  const supervisor = createOperatorSupervisorV1({ cell: cell(calls), processFactory: processFactory() });
  const state = await supervisor.start({
    harness: "codex",
    cwd: "C:/repo",
    prompt: "finish issue",
    cellRequest: { outcomeRef: "outcomeref_" + "a".repeat(64), requestId: "req-1", sourceRefs: {}, choices: {} },
    context: { tenant: "tenant-1", requester: "operator" },
  });
  assert.equal(state.cellLifecycle, "pending");
  const events = await supervisor.observe(state.sessionId);
  assert.equal(events[0]?.kind, "completed");
  const after = await supervisor.status(state.sessionId);
  assert.equal(after.cellLifecycle, "reconciled");
  assert.deepEqual(calls, ["request:req-1", "status:req-1"]);
});

test("a refused Cell result remains refused even when the harness exits cleanly", async () => {
  const supervisor = createOperatorSupervisorV1({
    cell: {
      async outcomeRequest() { return { requestId: "req-2", verdict: "refused", reasonCode: "not-authorized", lifecycleState: "refused" }; },
      async outcomeStatus() { return { requestId: "req-2", verdict: "refused", reasonCode: "not-authorized", lifecycleState: "refused" }; },
    },
    processFactory: processFactory(),
  });
  const state = await supervisor.start({ harness: "codex", cwd: "C:/repo", prompt: "ignore policy", cellRequest: { outcomeRef: "outcomeref_" + "b".repeat(64), requestId: "req-2", sourceRefs: {}, choices: {} }, context: { tenant: "tenant-1", requester: "operator" } });
  await supervisor.observe(state.sessionId);
  assert.equal((await supervisor.status(state.sessionId)).cellVerdict, "refused");
});

test("a recreated supervisor returns persisted Cell state without relaunching or dispatching", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-supervisor-"));
  try {
    const store = createOperatorSessionStoreV1({ root, now: () => "2026-08-21T00:00:00.000Z" });
    let statusCalls = 0;
    const cell = {
      async outcomeRequest() { return { requestId: "req-restart", verdict: "accepted" as const, reasonCode: "pending", lifecycleState: "pending" }; },
      async outcomeStatus() { statusCalls += 1; return { requestId: "req-restart", verdict: "accepted" as const, reasonCode: "reconciled", lifecycleState: "reconciled", receiptRef: "receipt" }; },
    };
    const first = createOperatorSupervisorV1({ cell, processFactory: processFactory(), sessionStore: store });
    const state = await first.start({ harness: "codex", cwd: "C:/repo", prompt: "restart-safe task", cellRequest: { outcomeRef: "outcomeref_" + "c".repeat(64), requestId: "req-restart", sourceRefs: {}, choices: {} }, context: { tenant: "tenant-1", requester: "operator" } });
    const reopened = createOperatorSupervisorV1({ cell, processFactory: processFactory(), sessionStore: store });
    const recovered = await reopened.status(state.sessionId);
    assert.equal(recovered.cellLifecycle, "pending");
    assert.equal(recovered.harnessLifecycle, "running");
    assert.equal(statusCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
