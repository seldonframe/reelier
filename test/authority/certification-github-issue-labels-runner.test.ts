import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FsAuthorityLedger } from "../../src/authority/host/fs-ledger.js";
import { FsDelegationBudgetLedger } from "../../src/authority/host/delegation-budget.js";
import { createGitHubIssueLabelsRunnerHost } from "../../src/authority/certification/github-issue-labels-runner.js";

async function fixture(fault: "none" | "source-drift" | "effect-drift" = "none") {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-github-runner-"));
  const writes: unknown[] = [];
  let reads = 0;
  let revalidations = 0;
  const budget = new FsDelegationBudgetLedger(path.join(root, "budget"));
  await budget.createRoot({ taskId: "task_github_certification", allocationId: "allocation_github_certification", effects: 1 });
  const provider = Object.freeze({
    async readIssue() { reads += 1; return { owner: "fixlyai", repo: "reelier-certification", issueNumber: 1, issueState: "open", labels: fault === "source-drift" && reads === 2 ? ["drifted"] : ["before"] }; },
    async replaceLabels(effect: unknown) { writes.push(effect); return Object.freeze({ status: 200, acknowledgmentId: "ack_1" }); },
  });
  const cell = Object.freeze({ async revalidateCurrentPermit() { revalidations += 1; } });
  const ledgerRoot = path.join(root, "ledger"); await mkdir(ledgerRoot);
  const ledger = new FsAuthorityLedger(ledgerRoot, { now: () => Date.parse("2026-08-11T20:00:00.000Z") });
  const host = createGitHubIssueLabelsRunnerHost({ cell, ledger, budget, provider, fault });
  return { root, host, ledger, budget, writes, get reads() { return reads; }, get revalidations() { return revalidations; } };
}

test("fixed host-private runner rereads, revalidates, durably dispatches, consumes, then writes exactly once", async () => {
  const f = await fixture();
  try {
    const result = await f.host.run({ requestId: "request_normal" });
    assert.equal(result.status, "acknowledged");
    assert.equal(result.success, false, "provider acknowledgement alone is not reconciliation success");
    assert.equal(f.reads, 2);
    assert.equal(f.revalidations, 1);
    assert.equal(f.writes.length, 1);
    assert.equal((await f.ledger.getReservation(result.reservationId))?.state, "acknowledged");
    assert.equal((await f.budget.get("allocation_github_certification"))?.consumed, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("caller substitution is closed before reads, reservation, budget, or provider write", async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => f.host.run({ requestId: "request_substitution", provider: async () => undefined } as never), /closed|caller|unknown/i);
    assert.equal(f.reads, 0);
    assert.equal(f.writes.length, 0);
    assert.equal((await f.budget.get("allocation_github_certification"))?.consumed, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

for (const fault of ["source-drift", "effect-drift"] as const) test(`${fault} cancels the real reservation with zero provider writes`, async () => {
  const f = await fixture(fault);
  try {
    const result = await f.host.run({ requestId: `request_${fault.replace("-", "_")}` });
    assert.equal(result.status, "refused");
    assert.equal(f.writes.length, 0);
    assert.equal(f.revalidations, 0);
    assert.equal((await f.ledger.getReservation(result.reservationId))?.state, "cancelled");
    assert.equal((await f.budget.get("allocation_github_certification"))?.consumed, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
