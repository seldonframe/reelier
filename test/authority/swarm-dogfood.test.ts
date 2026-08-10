import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPrincipalRegistry } from "../../src/authority/host/principal-registry.js";
import { FsDelegationBudgetLedger } from "../../src/authority/host/delegation-budget.js";

test("hermetic ten-principal swarm keeps one effect and cascades root revocation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-swarm-dogfood-"));
  try {
    const budget = new FsDelegationBudgetLedger(root);
    await budget.createRoot({ taskId: "task_swarm", allocationId: "root", effects: 1 });
    await budget.allocate({ allocationId: "release", parentAllocationId: "root", effects: 1, maxFanOut: 10 });
    const registry = createPrincipalRegistry({ tenant: "tenant_1" });
    const principals = await Promise.all(Array.from({ length: 10 }, (_, index) => registry.issue({ principalId: `agent_${index}`, taskId: "task_swarm", grantId: `grant_${index}`, grantDigest: "sha256:" + "abcdef0123456789"[index].repeat(64), allocationId: "release", runtimeSessionId: `session_${index}`, jobId: "release_v1", authorityCellId: "cell_1", expiresAt: "2099-01-01T00:00:00.000Z" })));
    assert.equal(principals.length, 10);
    await Promise.all(principals.map(() => budget.consumeOnce({ allocationId: "release", reservationId: "semantic-release-1", effects: 1 }).catch(() => undefined)));
    assert.equal((await budget.get("root"))?.consumed, 1);
    await budget.revokeTask("task_swarm");
    await registry.revokeTask("task_swarm");
    await assert.rejects(() => budget.consumeOnce({ allocationId: "release", reservationId: "semantic-release-2", effects: 1 }), /revok/i);
    await assert.rejects(() => registry.resolve(principals[0].token), /invalid|revok/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
