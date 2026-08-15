import test from "node:test";
import assert from "node:assert/strict";
import { createDispatchCoordinator } from "reelier/authority/host";
import type {
  DurableDispatchPublicationHeadV1,
  DurableDispatchPublicationIdentityV1,
  DurableDispatchPublicationQueryV1,
} from "../../src/authority/host/dispatch.js";
import { sha } from "./profile-governance-fixture.js";
// @ts-ignore test-only import uses the built module so the opaque WeakMap brand is shared.
import { createReservedDispatchHandle } from "../../../dist/authority/gate.js";
// @ts-ignore test-only import uses the built platform seam shared by the public package import.
import { __testSetAuthorityCellHostPlatform } from "../../../dist/authority/host/platform.js";

const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
test.after(() => restorePlatform());

function ledger() {
  let state: any = { reservationId: "r1", state: "reserved", intent: { effectDigest: "sha256:" + "1".repeat(64) } };
  return { get: () => state, getReservation: async () => state, transition: async (id: string, expected: string, event: any) => { if (id !== "r1" || state.state !== expected) return { ok: false, reason: "state-conflict" as const }; if (event.to === "ambiguous" && "resultDigest" in event) return { ok: false, reason: "corruption" as const }; state = { ...state, state: event.to, resultDigest: event.resultDigest }; return { ok: true, status: "transitioned" as const, reservation: state }; }, recover: async () => ({ ok: true as const, reservations: [state], highWaterMark: null, topology: { directorySync: "verified" as const } }) } as any;
}

test("dispatch consumes an opaque handle once and records ambiguity on restart", async () => {
  const l = ledger(); let calls = 0; const coordinator = createDispatchCoordinator(l, { async dispatch() { calls++; throw new Error("socket lost"); } });
  const handle = createReservedDispatchHandle({ reservation: l.get(), effect: { x: 1 }, effectCanonicalBase64: "e30=", effectDigest: "sha256:" + "1".repeat(64) });
  const outcome = await coordinator.dispatch(handle); assert.equal(outcome.kind, "ambiguous"); assert.equal(calls, 1); assert.equal(l.get().state, "ambiguous");
  await assert.rejects(() => coordinator.dispatch(handle));
  const l2 = ledger(); await l2.transition("r1", "reserved", { to: "dispatched" }); const recovered = await createDispatchCoordinator(l2, { async dispatch() { throw new Error("must not resend"); } }).recover(); assert.deepEqual(recovered, ["r1"]); assert.equal(l2.get().state, "ambiguous");
});

test("publication is durable before acknowledged, cancelled, and recovered terminal transitions", async () => {
  const l = ledger(); const phases: string[] = [];
  const publication = { async publish(input: { phase: string }) { phases.push(input.phase); return { receiptRef: "sha256:" + "8".repeat(64), evidenceDigest: "sha256:" + "9".repeat(64) }; } };
  const coordinator = createDispatchCoordinator(l, { async dispatch() { return { kind: "acknowledged", resultDigest: "sha256:" + "1".repeat(64) }; } }, undefined, publication);
  const handle = createReservedDispatchHandle({ reservation: l.get(), effect: { x: 1 }, effectCanonicalBase64: "e30=", effectDigest: "sha256:" + "1".repeat(64) });
  const outcome = await coordinator.dispatch(handle); assert.equal(outcome.resultDigest, "sha256:" + "8".repeat(64)); assert.deepEqual(phases, ["dispatch"]);
  const l2 = ledger(); const publication2 = { async publish(input: { phase: string }) { phases.push(input.phase); return { receiptRef: "sha256:" + "a".repeat(64), evidenceDigest: "sha256:" + "b".repeat(64) }; } };
  const cancelCoordinator = createDispatchCoordinator(l2, { async dispatch() { throw new Error("must not dispatch"); } }, undefined, publication2);
  const cancelHandle = createReservedDispatchHandle({ reservation: l2.get(), effect: {}, effectCanonicalBase64: "e30=", effectDigest: "sha256:" + "1".repeat(64) }); await cancelCoordinator.cancel(cancelHandle); assert.ok(phases.includes("cancelled"));
  const l3 = ledger(); await l3.transition("r1", "reserved", { to: "dispatched" }); const recoverCoordinator = createDispatchCoordinator(l3, { async dispatch() { throw new Error("must not resend"); } }, undefined, publication2); await recoverCoordinator.recover(); assert.ok(phases.includes("ambiguous"));
});

test("restart recovery publishes cancellation and ambiguity before terminal ledger transitions", async () => {
  const phases: string[] = [];
  const l = ledger();
  const publication = { async publish(input: { phase: string; state: any }) { phases.push(`${input.phase}:${input.state.effectCanonicalBase64}`); return { receiptRef: "sha256:" + "7".repeat(64), evidenceDigest: "sha256:" + "6".repeat(64) }; } };
  const coordinator = createDispatchCoordinator(l, { async dispatch() { throw new Error("must not dispatch"); } }, undefined, publication);
  await coordinator.recover();
  assert.ok(phases.some(phase => phase.startsWith("cancelled:")));
  assert.equal(l.get().state, "cancelled");
});

test("dispatch performs authoritative read-back before publishing the terminal receipt", async () => {
  const l = ledger(); const order: string[] = [];
  const publication = { async publish(input: { phase: string; outcome: any }) { order.push(`publish:${input.outcome.reconciliationStatus}`); return { receiptRef: "sha256:" + "4".repeat(64), evidenceDigest: "sha256:" + "5".repeat(64) }; } };
  const coordinator = createDispatchCoordinator(l, {
    async dispatch() { order.push("dispatch"); return { kind: "acknowledged" as const, resultDigest: "sha256:" + "1".repeat(64) }; },
    async reconcile(_state, outcome) { order.push("reconcile"); return { ...outcome, reconciliationStatus: "matched" as const, normalizedProjectionDigest: "sha256:" + "2".repeat(64) }; },
  }, undefined, publication);
  const handle = createReservedDispatchHandle({ reservation: l.get(), effect: { x: 1 }, effectCanonicalBase64: "e30=", effectDigest: "sha256:" + "1".repeat(64) });
  const outcome = await coordinator.dispatch(handle);
  assert.equal(outcome.reconciliationStatus, "matched");
  assert.deepEqual(order, ["dispatch", "reconcile", "publish:matched", "publish:matched"]);
  assert.equal(l.get().state, "reconciled");
});

test("ambiguous reservations reconcile without invoking dispatch", async () => {
  const l = ledger();
  await l.transition("r1", "reserved", { to: "dispatched" });
  await l.transition("r1", "dispatched", { to: "ambiguous" });
  let dispatchCalls = 0;
  const publication = { async publish(input: { phase: string; priorReceiptDigest?: string | null }) {
    assert.equal(input.phase, "reconcile");
    assert.equal(input.priorReceiptDigest, null);
    return { receiptRef: "sha256:" + "4".repeat(64), evidenceDigest: "sha256:" + "5".repeat(64) };
  } };
  const coordinator = createDispatchCoordinator(l, {
    async dispatch() { dispatchCalls++; throw new Error("must not dispatch"); },
    async reconcile(_state, outcome) { return { ...outcome, reconciliationStatus: "matched" as const, normalizedProjectionDigest: "sha256:" + "6".repeat(64), kind: "acknowledged" as const }; },
  }, undefined, publication);
  const result = await coordinator.reconcile("r1");
  assert.equal(dispatchCalls, 0);
  assert.equal(result.reconciliationStatus, "matched");
  assert.equal(result.receiptRef, "sha256:" + "4".repeat(64));
  assert.equal(l.get().state, "reconciled");
});

test("dispatch binds one effect to the authenticated allocation and returns it on cancellation", async () => {
  const l = ledger();
  l.get().intent.executionContext = { allocationId: "alloc_1" };
  const calls: string[] = [];
  const budget = {
    async consumeOnce(input: { allocationId: string; reservationId: string; effects: number }) { calls.push(`consume:${input.allocationId}:${input.reservationId}:${input.effects}`); },
    async returnOnce(input: { allocationId: string; reservationId: string; effects: number }) { calls.push(`return:${input.allocationId}:${input.reservationId}:${input.effects}`); },
  };
  const coordinator = createDispatchCoordinator(l, { async dispatch() { return { kind: "acknowledged" as const, resultDigest: "sha256:" + "1".repeat(64) }; } }, undefined, undefined, budget);
  const handle = createReservedDispatchHandle({ reservation: l.get(), effect: {}, effectCanonicalBase64: "e30=", effectDigest: "sha256:" + "1".repeat(64) });
  await coordinator.dispatch(handle);
  assert.deepEqual(calls, ["consume:alloc_1:r1:1"]);
  const l2 = ledger(); l2.get().intent.executionContext = { allocationId: "alloc_2" };
  const cancelCoordinator = createDispatchCoordinator(l2, { async dispatch() { throw new Error("must not dispatch"); } }, undefined, undefined, budget);
  const cancelHandle = createReservedDispatchHandle({ reservation: l2.get(), effect: {}, effectCanonicalBase64: "e30=", effectDigest: "sha256:" + "1".repeat(64) });
  await cancelCoordinator.cancel(cancelHandle);
  assert.deepEqual(calls, ["consume:alloc_1:r1:1", "return:alloc_2:r1:1"]);
});

test("confidential dispatch evidence uses the exact materialized request digest", async () => {
  const l = ledger();
  let evidenceDigest = "";
  const coordinator = createDispatchCoordinator(l, {
    async dispatch() { return { kind: "acknowledged" as const, resultDigest: "sha256:" + "1".repeat(64), materializedRequestDigest: "sha256:" + "7".repeat(64) }; },
  }, { async persist(input) { evidenceDigest = input.dispatchedRequestDigest; } });
  const handle = createReservedDispatchHandle({ reservation: l.get(), effect: { x: 1 }, effectCanonicalBase64: "e30=", effectDigest: "sha256:" + "1".repeat(64) });
  await coordinator.dispatch(handle);
  assert.equal(evidenceDigest, "sha256:" + "7".repeat(64));
});

test("markerless dispatched recovery refuses before constructing a durable query", async () => {
  const l = ledger();
  await l.transition("r1", "reserved", { to: "dispatched" });
  const calls = { load: 0, reservation: 0, terminal: 0, transition: 0, reconcile: 0, provider: 0, portable: 0 };
  const originalTransition = l.transition;
  l.transition = async (...args: any[]) => { calls.transition += 1; return originalTransition(...args); };
  const publication = {
    async publish() { calls.terminal += 1; return { receiptRef: sha("1"), evidenceDigest: sha("2") }; },
    async publishReservation() { calls.reservation += 1; return { receiptRef: sha("3"), evidenceDigest: sha("4") }; },
    async loadDurableHead(_query: DurableDispatchPublicationQueryV1) { calls.load += 1; return null; },
  };
  const coordinator = createDispatchCoordinator(l, {
    async dispatch() { calls.provider += 1; throw new Error("must not send"); },
    async reconcile() { calls.reconcile += 1; throw new Error("must not reconcile"); },
  }, undefined, publication);
  calls.transition = 0;
  await assert.rejects(() => coordinator.recover(), /send-started|marker|integrity/i);
  assert.deepEqual(calls, { load: 0, reservation: 0, terminal: 0, transition: 0, reconcile: 0, provider: 0, portable: 0 });
});

test("durable publication identity is closed over the full persisted reservation intent", () => {
  const identity: DurableDispatchPublicationIdentityV1 = {
    v: "reelier.durable-dispatch-publication-identity/v1",
    reservationId: "r1",
    tenant: "tenant_1",
    requestDigest: sha("1"),
    capabilityDigest: sha("2"),
    effectDigest: sha("3"),
    routeAuthorityDigest: sha("4"),
    expectedDispatchedRequestDigest: sha("5"),
    reservationIntentDigest: sha("6"),
  };
  const query: DurableDispatchPublicationQueryV1 = { v: "reelier.durable-dispatch-publication-query/v1", identity, ledgerState: "dispatched", sendStarted: true };
  const head: DurableDispatchPublicationHeadV1 = { v: "reelier.durable-dispatch-publication-head/v1", identity, receiptRef: sha("7"), evidenceDigest: sha("8"), reservationReceiptRef: sha("7"), priorReceiptRef: null, phase: "reservation", terminalKind: null };
  assert.equal(query.identity.reservationIntentDigest, sha("6"));
  assert.equal(head.priorReceiptRef, null);
});
