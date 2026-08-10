import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FsDelegationBudgetLedger } from "../../src/authority/host/delegation-budget.js";

test("delegation budgets conserve effects across nested children and return unused allocation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-budget-"));
  try {
    const ledger = new FsDelegationBudgetLedger(root);
    await ledger.createRoot({ taskId: "task_1", allocationId: "root", effects: 5 });
    await ledger.allocate({ allocationId: "child_a", parentAllocationId: "root", effects: 3, maxFanOut: 3 });
    await ledger.allocate({ allocationId: "child_b", parentAllocationId: "root", effects: 2, maxFanOut: 3 });
    await assert.rejects(() => ledger.allocate({ allocationId: "child_c", parentAllocationId: "root", effects: 1, maxFanOut: 3 }), /budget|remaining|allocation/i);
    await ledger.consume({ allocationId: "child_a", effects: 1 });
    await ledger.allocate({ allocationId: "grandchild", parentAllocationId: "child_a", effects: 1, maxFanOut: 2 });
    await ledger.returnUnused({ allocationId: "grandchild", effects: 1 });
    await ledger.returnUnused({ allocationId: "child_b", effects: 2 });
    const state = await ledger.get("root");
    assert.deepEqual(state && { effects: state.effects, reserved: state.reserved, consumed: state.consumed, returned: state.returned, remaining: state.remaining }, { effects: 5, reserved: 2, consumed: 1, returned: 3, remaining: 2 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent child allocation cannot exceed the conserved root budget", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-budget-race-"));
  try {
    await new FsDelegationBudgetLedger(root).createRoot({ taskId: "task_1", allocationId: "root", effects: 10 });
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => new FsDelegationBudgetLedger(root).allocate({ allocationId: `child_${i}`, parentAllocationId: "root", effects: 1, maxFanOut: 100 }).then(() => true, () => false)));
    assert.equal(results.filter(Boolean).length, 10);
    const state = await new FsDelegationBudgetLedger(root).get("root");
    assert.equal(state?.reserved, 10);
    assert.equal(state?.remaining, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("revocation prevents new allocation and consumption", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-budget-revoke-"));
  try {
    const ledger = new FsDelegationBudgetLedger(root);
    await ledger.createRoot({ taskId: "task_1", allocationId: "root", effects: 2 });
    await ledger.allocate({ allocationId: "child", parentAllocationId: "root", effects: 1, maxFanOut: 2 });
    await ledger.revokeTask("task_1");
    await assert.rejects(() => ledger.allocate({ allocationId: "other", parentAllocationId: "root", effects: 1, maxFanOut: 2 }), /revok/i);
    await assert.rejects(() => ledger.consume({ allocationId: "child", effects: 1 }), /revok/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fan-out is enforced independently of remaining effects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-budget-fanout-"));
  try {
    const ledger = new FsDelegationBudgetLedger(root);
    await ledger.createRoot({ taskId: "task_1", allocationId: "root", effects: 10 });
    await ledger.allocate({ allocationId: "child", parentAllocationId: "root", effects: 1, maxFanOut: 1 });
    await assert.rejects(() => ledger.allocate({ allocationId: "sibling", parentAllocationId: "root", effects: 1, maxFanOut: 1 }), /fan.?out/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
