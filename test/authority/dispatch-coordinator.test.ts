import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createDispatchCoordinator } from "reelier/authority/host";
import type {
  DurableDispatchPublicationHeadV1,
  DurableDispatchPublicationIdentityV1,
  DurableDispatchPublicationQueryV1,
} from "../../src/authority/host/dispatch.js";
import { sha } from "./profile-governance-fixture.js";
import { authorityDigest } from "../../src/authority/wire.js";
import { signAuthorityDigest } from "../../src/authority/crypto.js";
// @ts-ignore built imports share opaque capability brands with the public package under test.
import { createDispatchCommitLease, createPreparedDispatch } from "../../../dist/authority/host/prepared-dispatch.js";
// @ts-ignore built helper shares the public package's projection contract.
import { materializedHttpRequestDigest } from "../../../dist/authority/host/http-response-semantics.js";
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

test("prepared dispatch carries accepted gate provenance into the durable reservation root before provider send", async () => {
  const projection = { v: "reelier.materialized-http-request/v1" as const, method: "POST" as const, origin: "https://provider.example", normalizedPath: "/write", normalizedQuery: "", reviewedHeaders: {}, bodyDigest: sha("0") };
  const materializedRequestDigest = materializedHttpRequestDigest(projection);
  let persisted: any = { reservationId: "r1", state: "reserved", intent: { tenant: "tenant_1", requestDigest: sha("1"), requestKey: sha("d"), outcomeKey: sha("e"), capabilityId: "capability_1", capabilityDigest: sha("2"), effectDigest: sha("3"), effectCanonicalBase64: "e30=", executionContext: { allocationId: "allocation_1" }, routeAuthority: { routeDigest: sha("f"), expectedMaterializedRequestDigest: materializedRequestDigest } } };
  const signedDecision = Object.freeze({ gateEventDigest: sha("6"), decisionContextDigest: sha("7") });
  const source = Object.freeze({ bundle: Object.freeze({ v: "reelier.source-bundle/v1", marker: "accepted-source" }) });
  const capability = Object.freeze({ v: "reelier.compiled-capability/v1", marker: "accepted-capability" });
  const state = {
    reservation: persisted, effect: { marker: "accepted-effect" }, effectCanonicalBase64: "e30=", effectDigest: sha("3"),
    signedDecision, source, capability,
  };
  const order: string[] = [];
  const ledgerWithPreparedCommit = {
    async getReservation() { return persisted; },
    async commitPreparedDispatch(input: any) {
      persisted = { ...persisted, state: "dispatched", sendStarted: true, intent: { ...persisted.intent, routeAuthority: { ...persisted.intent.routeAuthority, expectedMaterializedRequestDigest: materializedRequestDigest } } };
      return createDispatchCommitLease({ reservationId: input.reservationId, allocationId: input.allocationId, preparedDigest: input.preparedDescription.materializedRequestDigest, authorityGeneration: input.expectedAuthorityGeneration, authorityExpiresAt: input.preparedDescription.authorityExpiresAt, absoluteDeadlineMs: input.absoluteDeadlineMs, commitGeneration: "commit_1" });
    },
    async transition(_id: string, expected: string, event: any) { if (persisted.state !== expected) return { ok: false, reason: "state-conflict" }; persisted = { ...persisted, state: event.to, resultDigest: event.resultDigest }; return { ok: true, status: "transitioned", reservation: persisted }; },
    async recover() { return { ok: true, reservations: [persisted], highWaterMark: null, topology: { directorySync: "verified" } }; },
  } as any;
  const publication = {
    async publishReservation(input: { state: any }) {
      order.push("reservation");
      assert.equal(input.state.signedDecision, signedDecision);
      assert.equal(input.state.source, source);
      assert.equal(input.state.capability, capability);
      return { receiptRef: sha("8"), evidenceDigest: sha("9") };
    },
    async loadDurableHead() { return null; },
    async publish() { order.push("terminal"); return { receiptRef: sha("a"), evidenceDigest: sha("b") }; },
  };
  const coordinator = createDispatchCoordinator(ledgerWithPreparedCommit, {
    async prepare() { return createPreparedDispatch({ description: { v: "reelier.prepared-dispatch-description/v1", routeDigest: sha("f"), materializedRequestDigest, projection, authorityGeneration: "generation_1", authorityExpiresAt: new Date(Date.now() + 60_000).toISOString(), absoluteDeadlineMs: performance.now() + 60_000, reservationId: "r1", allocationId: "allocation_1" }, send: async () => { order.push("provider"); return { kind: "acknowledged", resultDigest: sha("c") }; } }); },
    async dispatch() { throw new Error("legacy provider path must not run"); },
  }, undefined, publication);
  const outcome = await coordinator.dispatch(createReservedDispatchHandle(state));
  assert.equal(outcome.kind, "acknowledged");
  assert.deepEqual(order.slice(0, 2), ["reservation", "provider"]);
});

test("reservation publication failure is classified before the provider boundary", async () => {
  const projection = { v: "reelier.materialized-http-request/v1" as const, method: "POST" as const, origin: "https://provider.example", normalizedPath: "/write", normalizedQuery: "", reviewedHeaders: {}, bodyDigest: sha("0") };
  const materializedRequestDigest = materializedHttpRequestDigest(projection);
  let persisted: any = { reservationId: "r1", state: "reserved", intent: { tenant: "tenant_1", requestDigest: sha("1"), capabilityDigest: sha("2"), effectDigest: sha("3"), effectCanonicalBase64: "e30=", executionContext: { allocationId: "allocation_1" }, routeAuthority: { routeDigest: sha("f"), expectedMaterializedRequestDigest: materializedRequestDigest } } };
  let providerCalls = 0;
  const coordinator = createDispatchCoordinator({
    async getReservation() { return persisted; },
    async commitPreparedDispatch(input: any) {
      persisted = { ...persisted, state: "dispatched", sendStarted: true };
      return createDispatchCommitLease({ reservationId: input.reservationId, allocationId: input.allocationId, preparedDigest: input.preparedDescription.materializedRequestDigest, authorityGeneration: input.expectedAuthorityGeneration, authorityExpiresAt: input.preparedDescription.authorityExpiresAt, absoluteDeadlineMs: input.absoluteDeadlineMs, commitGeneration: "commit_1" });
    },
  } as any, {
    async prepare() { return createPreparedDispatch({ description: { v: "reelier.prepared-dispatch-description/v1", routeDigest: sha("f"), materializedRequestDigest, projection, authorityGeneration: "generation_1", authorityExpiresAt: new Date(Date.now() + 60_000).toISOString(), absoluteDeadlineMs: performance.now() + 60_000, reservationId: "r1", allocationId: "allocation_1" }, send: async () => { providerCalls++; return { kind: "acknowledged", resultDigest: sha("c") }; } }); },
    async dispatch() { throw new Error("legacy path must not run"); },
  }, undefined, {
    async publishReservation() { throw new Error("secret-bearing receipt backend failure"); },
    async loadDurableHead() { return null; },
    async publish() { throw new Error("terminal publication must not run"); },
  });
  const handle = createReservedDispatchHandle({ reservation: persisted, effect: {}, effectCanonicalBase64: "e30=", effectDigest: sha("3") });
  await assert.rejects(() => coordinator.dispatch(handle), (error: any) => {
    assert.equal(error.classification, "reservation-publication-unavailable");
    assert.equal(error.phase, "reservation-publication");
    assert.equal(error.providerEffectPossible, false);
    assert.equal(String(error.message).includes("secret-bearing"), false);
    return true;
  });
  assert.equal(providerCalls, 0);
});

test("a stale colluding revalidator cannot cross credential, prepare, store, or provider boundaries", async () => {
  const generation = sha("1"), staleGeneration = sha("2");
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const projection = { v: "reelier.materialized-http-request/v1" as const, method: "POST" as const, origin: "https://provider.example", normalizedPath: "/write", normalizedQuery: "", reviewedHeaders: {}, bodyDigest: sha("3") };
  const materializedRequestDigest = materializedHttpRequestDigest(projection);
  const identityKeys = generateKeyPairSync("ed25519");
  const identityBody = {
    v: "reelier.authenticated-provider-identity/v1" as const,
    providerId: "github" as const,
    credentialSlotId: "slot_1",
    slotInstanceId: "instance_1",
    slotVersion: "version_1",
    slotExpiresAt: expiresAt,
    providerAccountId: "account_1",
    providerLogin: "account_1",
    routeDigest: sha("4"),
    observedAt: new Date().toISOString(),
  };
  const identity = Object.freeze({
    ...identityBody,
    signerId: "identity_1",
    signature: signAuthorityDigest(identityKeys.privateKey, "authority-evidence", authorityDigest(identityBody)),
  });
  const routeAuthority = Object.freeze({
    v: "reelier.route-authority-snapshot/v1" as const,
    connectorRegistrationDigest: sha("5"), operatorConfigurationDigest: sha("6"), routeDigest: identityBody.routeDigest,
    providerId: "github", connectorId: "github", accountId: "account_1", providerAccountIdentity: "github:account_1",
    endpointId: "write", credentialSlotId: identityBody.credentialSlotId, slotInstanceId: identityBody.slotInstanceId,
    slotVersion: identityBody.slotVersion, authenticatedProviderIdentityDigest: authorityDigest(identityBody),
    sourceReadRouteDigest: sha("7"), projectionSchemaDigest: sha("8"), expectedMaterializedRequestDigest: materializedRequestDigest,
    authorityGeneration: generation, authorityExpiresAt: expiresAt,
  });
  let persisted: any = {
    reservationId: "reservation_stale_generation",
    state: "reserved",
    intent: { tenant: "tenant_1", requestDigest: sha("9"), requestKey: sha("a"), outcomeKey: sha("b"), capabilityId: "capability_1", capabilityDigest: sha("c"), effectDigest: sha("d"), effectCanonicalBase64: "e30=", executionContext: { allocationId: "allocation_1" }, routeAuthority },
  };
  const effects = { credential: 0, prepare: 0, store: 0, provider: 0, commit: 0 };
  const testLedger = {
    async getReservation() { return persisted; },
    async commitPreparedDispatch() { effects.commit += 1; throw new Error("stale generation reached the ledger"); },
    async transition() { throw new Error("stale generation reached a ledger transition"); },
    async recover() { return { ok: true, reservations: [], highWaterMark: null, topology: { directorySync: "verified" } }; },
  } as any;
  const staleCurrent = { authorityGeneration: staleGeneration, authorityExpiresAt: expiresAt, routeAuthorityDigest: authorityDigest(routeAuthority), providerId: "github", connectorId: "github", accountId: "account_1", endpointId: "write" };
  const coordinator = createDispatchCoordinator(testLedger, {
    async prepare() {
      effects.prepare += 1;
      effects.credential += 1;
      return createPreparedDispatch({ description: { v: "reelier.prepared-dispatch-description/v1", routeDigest: routeAuthority.routeDigest, materializedRequestDigest, projection, authorityGeneration: staleGeneration, authorityExpiresAt: expiresAt, absoluteDeadlineMs: performance.now() + 60_000, reservationId: persisted.reservationId, allocationId: "allocation_1" }, send: async () => { effects.provider += 1; return { kind: "acknowledged", resultDigest: sha("e") }; } });
    },
    async dispatch() { effects.provider += 1; throw new Error("legacy provider path reached"); },
  }, undefined, {
    async publish() { effects.store += 1; return { receiptRef: sha("e"), evidenceDigest: sha("f") }; },
    async publishReservation() { effects.store += 1; return { receiptRef: sha("e"), evidenceDigest: sha("f") }; },
    async loadDurableHead() { return null; },
  }, undefined, {
    identityProbe: async () => identity,
    verifyIdentity: { purpose: "authority-evidence", signerId: identity.signerId, publicKey: identityKeys.publicKey },
    revalidator: { revalidate: async () => staleCurrent, routeReread: async () => routeAuthority },
  });
  const state = { reservation: persisted, effect: {}, effectCanonicalBase64: "e30=", effectDigest: persisted.intent.effectDigest };
  await assert.rejects(() => coordinator.dispatch(createReservedDispatchHandle(state)), /generation|route authority|binding|stale/i);
  assert.deepEqual(effects, { credential: 0, prepare: 0, store: 0, provider: 0, commit: 0 });
});

test("coordinator exposes a detached reservation projection without exposing the prepared send", async () => {
  const l = ledger();
  const coordinator = createDispatchCoordinator(l, { async dispatch() { throw new Error("must not dispatch"); } });
  const handle = createReservedDispatchHandle({ reservation: l.get(), effect: { secret: "not projected" }, effectCanonicalBase64: "e30=", effectDigest: sha("1") });
  const projection = coordinator.describe(handle);
  assert.deepEqual(projection, {
    reservationId: "r1",
    state: "reserved",
    effectDigest: sha("1"),
    allocationId: null,
  });
  assert.equal(Object.isFrozen(projection), true);
  assert.equal("effect" in projection, false);
});
