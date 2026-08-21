import assert from "node:assert/strict";
import test from "node:test";
import {
  type OutcomeKernelStorage,
  type StoredEffectLifecycleV1,
} from "reelier/authority/host";
import { createOutcomeKernel, createTrustedObservationVerifier, createTrustedOutcomePredecessorPolicyV1 } from "../../src/authority/host/outcome-kernel.js";
// @ts-ignore compiled tests share the opaque handle brand with the built public host package.
import { createReservedDispatchHandle } from "../../../dist/authority/gate.js";
import { digestGovernedReceiptV1, digestMissionClaimV1, digestToolEffectContractV1, type GovernedReceiptV1, type MissionClaimV1, type ToolEffectContractV1 } from "reelier/authority";

const sha = (c: string) => `sha256:${c.repeat(64)}`;
const at = (n: number) => new Date(n).toISOString();

function contract(identity: string, maximumEvidenceGrade: ToolEffectContractV1["maximumEvidenceGrade"] = "verified"): ToolEffectContractV1 {
  return {
    v: "reelier.tool-effect-contract/v1", contractId: `contract_${identity}`, provider: "arbitrary-provider", operation: "mutate",
    operationDigest: sha("1"), schemaDigest: sha("2"), policyDigest: sha("3"), effectClass: "idempotent-write",
    model: { fields: ["value"], maxBytes: 1024 }, bindings: { credentialRef: "credential", accountRef: "account", destinationRef: "destination", limitRef: "limit" },
    semanticIdentity: identity, idempotencyKey: `idempotency_${identity}`,
    readback: maximumEvidenceGrade === "verified" ? { operation: "read", projection: ["/id"] } : null,
    result: { success: ["ok"], conflict: ["exists"], definitiveFailure: ["rejected"], ambiguity: ["unknown"] }, maximumEvidenceGrade,
  };
}

function mission(id = "mission_1", contracts: readonly ToolEffectContractV1[] = [contract("identity_1")]): MissionClaimV1 {
  return { v: "reelier.mission-claim/v1", missionId: id, mandateDigest: sha("4"), promptDigest: sha("5"), contractDigests: contracts.map(digestToolEffectContractV1), claimedAt: at(1_000) };
}

function reservation(id: string, state = "reserved", effectDigest = digestToolEffectContractV1(contract("identity_1"))) {
  return { reservationId: id, state, intent: { effectDigest, effectCanonicalBase64: "e30=" } } as any;
}

function durableFixture(): OutcomeKernelStorage & { effects: Map<string, StoredEffectLifecycleV1>; loseHead: boolean; atomicCalls: number; durableCreates: number; published: Map<string, readonly string[]>; dropReceipt(receiptId: string): void; seedReceiptClaim(receiptId: string, receiptDigest: string, receiptRef: string): void; compareAndPublishReceipt(receipt: GovernedReceiptV1, receiptDigest: string): Promise<any> } {
  const missions = new Map<string, { digest: string; claim: MissionClaimV1 }>();
  const effects = new Map<string, StoredEffectLifecycleV1>();
  const receipts = new Map<string, { receiptId: string; receiptDigest: string; receiptRef: string }>();
  const receiptClaims = new Map<string, { digest: string; ref: string }>();
  return {
    durable: true, effects, loseHead: false, atomicCalls: 0, durableCreates: 0, published: new Map(),
    dropReceipt(receiptId) { receipts.delete(receiptId); },
    seedReceiptClaim(receiptId, receiptDigest, receiptRef) { receiptClaims.set(receiptId, { digest: receiptDigest, ref: receiptRef }); },
    async claimMission(claim, digest) {
      const prior = missions.get(claim.missionId);
      if (!prior) { missions.set(claim.missionId, { claim, digest }); return { status: "claimed" as const, claim }; }
      return prior.digest === digest ? { status: "exact-existing" as const, claim: prior.claim } : { status: "conflict" as const };
    },
    async loadMission(missionId) { return missions.get(missionId)?.claim ?? null; },
    async loadEffect(_missionId, reservationId) { return effects.get(reservationId) ?? null; },
    async storeEffect(value, expectedRevision) {
      const prior = effects.get(value.reservation.reservationId);
      if ((prior?.revision ?? 0) !== expectedRevision) return { status: "conflict" as const };
      const stored = Object.freeze({ ...value, revision: expectedRevision + 1 }); effects.set(value.reservation.reservationId, stored); return { status: "stored" as const, value: stored };
    },
    async compareAndPublishReceipt(receipt, receiptDigest) {
      this.atomicCalls++;
      const priorBytes = this.published.get(receipt.receiptId) ?? []; this.published.set(receipt.receiptId, Object.freeze([...priorBytes, JSON.stringify(receipt)]));
      const prior = receiptClaims.get(receipt.receiptId);
      if (prior && prior.digest !== receiptDigest) return { status: "conflict" as const };
      const claim = prior ?? { digest: receiptDigest, ref: sha("9") };
      if (!prior) { receiptClaims.set(receipt.receiptId, claim); this.durableCreates++; }
      receipts.set(receipt.receiptId, { receiptId: receipt.receiptId, receiptDigest: claim.digest, receiptRef: claim.ref });
      return { status: prior ? "exact-existing" as const : "published" as const, receiptDigest: claim.digest, receiptRef: claim.ref };
    },
    async loadReceipt(receiptId) { const head = receipts.get(receiptId); return head && !this.loseHead ? { ...head } : null; },
  };
}

function coordinator(states: Map<string, any>, counters: { send: number; readback: number }) {
  return {
    describe(handle: any) { const state = states.get(handleIds.get(handle)!); return Object.freeze({ reservationId: state.reservationId, state: state.state, effectDigest: state.intent.effectDigest, allocationId: state.intent.executionContext?.allocationId ?? null }); },
    async dispatch(handle: any) { counters.send++; const state = states.get(handleIds.get(handle)!); state.state = "acknowledged"; return { kind: "acknowledged" as const, resultDigest: sha("a"), reconciliationStatus: "matched" as const, normalizedProjectionDigest: sha("b") }; },
    async reconcile(reservationId: string) { counters.readback++; const state = states.get(reservationId); state.state = "reconciled"; return { kind: "acknowledged" as const, resultDigest: sha("c"), reconciliationStatus: "matched" as const, normalizedProjectionDigest: sha("b") }; },
    async cancel() { throw new Error("not used"); }, async recover() { for (const state of states.values()) { if (state.state === "reserved") state.state = "cancelled"; else if (state.state === "dispatched") state.state = "ambiguous"; } return []; },
  } as any;
}

const handleIds = new WeakMap<object, string>();
function handle(id: string, reviewed = contract("identity_1")) { const effectDigest = digestToolEffectContractV1(reviewed); const opaque = createReservedDispatchHandle({ reservation: reservation(id, "reserved", effectDigest), effect: {}, effectCanonicalBase64: "e30=", effectDigest }); handleIds.set(opaque as object, id); return opaque; }

function verifierFor(value: ToolEffectContractV1, verify = true) { return createTrustedObservationVerifier({ contractDigest: digestToolEffectContractV1(value), verify: () => verify }); }

test("durable mission claim converges under a barrier and changed semantics conflict", async () => {
  const store = durableFixture(); let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  const original = store.claimMission.bind(store); let arrivals = 0;
  store.claimMission = async (...args) => { arrivals++; if (arrivals < 2) await barrier; else release(); return original(...args); };
  const kernel = createOutcomeKernel({ storage: store, coordinator: {} as any, ledger: {} as any, now: () => 2_000, authorization: async () => "active" });
  const [first, second] = await Promise.all([kernel.claimMission(mission()), kernel.claimMission(mission())]);
  assert.deepEqual(new Set([first.status, second.status]), new Set(["claimed", "exact-existing"]));
  await assert.rejects(() => kernel.claimMission({ ...mission(), promptDigest: sha("d") }), /conflict/i);
});

test("revocation and expiry refuse before dispatch", async () => {
  for (const status of ["revoked", "expired"] as const) {
    const store = durableFixture(), states = new Map([["r1", reservation("r1")]]), counters = { send: 0, readback: 0 };
    const kernel = createOutcomeKernel({ storage: store, coordinator: coordinator(states, counters), ledger: { getReservation: async () => states.get("r1") } as any, now: () => 2_000, authorization: async () => status });
    await kernel.claimMission(mission());
    const reviewed = contract("identity_1");
    await assert.rejects(() => kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, handle: handle("r1"), verifier: verifierFor(reviewed) }] }), new RegExp(status));
    assert.equal(counters.send, 0);
  }
});

test("crash after provider response restarts from the ledger without resending", async () => {
  const store = durableFixture(), states = new Map([["r1", reservation("r1")]]), counters = { send: 0, readback: 0 }; let crash = true;
  const options = { storage: store, coordinator: coordinator(states, counters), ledger: { getReservation: async () => states.get("r1") } as any, now: () => 2_000, authorization: async () => "active" as const, onBoundary: (name: string) => { if (crash && name === "provider-response") throw new Error("crash:provider-response"); } };
  const first = createOutcomeKernel(options); await first.claimMission(mission());
  const reviewed = contract("identity_1");
  await assert.rejects(() => first.execute({ missionId: "mission_1", effects: [{ contract: reviewed, handle: handle("r1"), verifier: verifierFor(reviewed) }] }), /crash/);
  crash = false;
  const restarted = createOutcomeKernel(options);
  const outcome = await restarted.execute({ missionId: "mission_1", effects: [{ contract: reviewed, reservationId: "r1", verifier: verifierFor(reviewed) }] });
  assert.equal(counters.send, 1);
  assert.equal(outcome.status, "pending");
});

test("every durable lifecycle boundary restarts without a second provider write", async () => {
  for (const crashBoundary of ["reservation", "provider-response", "attempt", "observation", "outcome", "receipt"] as const) {
    const store = durableFixture(), states = new Map([["r1", reservation("r1")]]), counters = { send: 0, readback: 0 };
    let inject = true;
    const common = { storage: store, coordinator: coordinator(states, counters), ledger: { getReservation: async () => states.get("r1") } as any, now: () => 2_000, authorization: async () => "active" as const, onBoundary: (name: string) => { if (inject && name === crashBoundary) throw new Error(`crash:${name}`); } };
    const reviewed = contract("identity_1"), first = createOutcomeKernel(common); await first.claimMission(mission());
    await assert.rejects(() => first.execute({ missionId: "mission_1", effects: [{ contract: reviewed, handle: handle("r1"), verifier: verifierFor(reviewed) }] }), new RegExp(`crash:${crashBoundary}`));
    inject = false;
    await createOutcomeKernel(common).execute({ missionId: "mission_1", effects: [{ contract: reviewed, reservationId: "r1", verifier: verifierFor(reviewed) }] });
    assert.equal(counters.send, crashBoundary === "reservation" ? 0 : 1, crashBoundary);
  }
});

test("a crash after the atomic mission claim converges to the exact prior semantics", async () => {
  const store = durableFixture(); let inject = true;
  const kernel = createOutcomeKernel({ storage: store, coordinator: {} as any, ledger: {} as any, now: () => 2_000, authorization: async () => "active", onBoundary(name) { if (inject && name === "mission-claim") throw new Error("crash:mission-claim"); } });
  await assert.rejects(() => kernel.claimMission(mission()), /crash:mission-claim/);
  inject = false;
  assert.equal((await createOutcomeKernel({ storage: store, coordinator: {} as any, ledger: {} as any, now: () => 2_000, authorization: async () => "active" }).claimMission(mission())).status, "exact-existing");
});

test("ambiguous restart is readback-only and a lost receipt head prevents verified aggregation", async () => {
  const second = contract("identity_2", "pending");
  const store = durableFixture(), states = new Map([["r1", reservation("r1", "ambiguous")], ["r2", reservation("r2", "reserved", digestToolEffectContractV1(second))]]), counters = { send: 0, readback: 0 };
  store.loseHead = true;
  const kernel = createOutcomeKernel({ storage: store, coordinator: coordinator(states, counters), ledger: { getReservation: async (id: string) => states.get(id) } as any, now: () => 2_000, authorization: async () => "active" });
  const first = contract("identity_1");
  await kernel.claimMission(mission("mission_1", [first, second]));
  const outcome = await kernel.execute({ missionId: "mission_1", effects: [
    { contract: first, handle: handle("r1"), verifier: verifierFor(first) },
    { contract: second, handle: handle("r2"), verifier: verifierFor(second, false) },
  ] });
  assert.equal(counters.readback, 1);
  assert.equal(counters.send, 1);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.effects.map(effect => effect.status), ["verified", "absent"]);
  assert.equal(outcome.receiptsDurable, false);
});

test("trusted observation verification is contract-bound and invoked exactly once", async () => {
  const store = durableFixture(), states = new Map([["r1", reservation("r1")]]), counters = { send: 0, readback: 0 }, reviewed = contract("identity_1");
  let verifies = 0;
  const kernel = createOutcomeKernel({ storage: store, coordinator: coordinator(states, counters), ledger: { getReservation: async () => states.get("r1") } as any, now: () => 2_000, authorization: async () => "active" });
  await kernel.claimMission(mission());
  await kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, handle: handle("r1"), verifier: createTrustedObservationVerifier({ contractDigest: digestToolEffectContractV1(reviewed), verify: () => { verifies++; return true; } }) }] });
  assert.equal(verifies, 1);

  const wrong = contract("identity_wrong"), secondStore = durableFixture(), secondStates = new Map([["r2", reservation("r2")]]);
  const secondKernel = createOutcomeKernel({ storage: secondStore, coordinator: coordinator(secondStates, counters), ledger: { getReservation: async () => secondStates.get("r2") } as any, now: () => 2_000, authorization: async () => "active" });
  await secondKernel.claimMission(mission("mission_2", [reviewed]));
  await assert.rejects(() => secondKernel.execute({ missionId: "mission_2", effects: [{ contract: reviewed, handle: handle("r2"), verifier: verifierFor(wrong) }] }), /binding mismatch/);
});

test("missing durable storage refuses and hermetic ambiguity cannot become verified", async () => {
  assert.throws(() => createOutcomeKernel({ coordinator: {} as any, ledger: {} as any, now: () => 2_000, authorization: async () => "active" }), /durable storage/i);
  const states = new Map([["r1", reservation("r1", "ambiguous")]]), counters = { send: 0, readback: 0 };
  const kernel = createOutcomeKernel({ mode: "hermetic", coordinator: coordinator(states, counters), ledger: { getReservation: async () => states.get("r1") } as any, now: () => 2_000, authorization: async () => "active" });
  await kernel.claimMission(mission());
  const reviewed = contract("identity_1");
  const outcome = await kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, handle: handle("r1"), verifier: verifierFor(reviewed) }] });
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.receiptsDurable, false);
  assert.deepEqual(counters, { send: 0, readback: 1 });
});

test("the reviewed contract digest must match both the described handle and durable ledger projection", async () => {
  const reviewed = contract("identity_1"), expectedDigest = digestToolEffectContractV1(reviewed);
  for (const mismatch of ["described", "ledger", "state", "allocation"] as const) {
    const store = durableFixture(), counters = { send: 0, readback: 0 };
    const current = reservation("r1") as any;
    current.intent.effectDigest = mismatch === "ledger" ? sha("e") : expectedDigest;
    current.intent.executionContext = { allocationId: mismatch === "allocation" ? "allocation_current" : "allocation_1" };
    const described = { reservationId: "r1", state: mismatch === "state" ? "ambiguous" : "reserved", effectDigest: mismatch === "described" ? sha("f") : expectedDigest, allocationId: "allocation_1" };
    const kernel = createOutcomeKernel({
      storage: store,
      ledger: { getReservation: async () => current } as any,
      coordinator: { describe: () => described, dispatch: async () => { counters.send++; throw new Error("must not dispatch"); } } as any,
      now: () => 2_000,
      authorization: async () => "active",
    });
    await kernel.claimMission(mission());
    await assert.rejects(() => kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, handle: handle("r1"), verifier: verifierFor(reviewed) }] }), /projection|contract|digest|state|allocation/i, mismatch);
    assert.equal(counters.send, 0, mismatch);
  }
});

test("terminal retries adopt the stored Outcome and durable receipt without reverification or provider resend", async () => {
  const reviewed = contract("identity_1"), digest = digestToolEffectContractV1(reviewed);
  const store = durableFixture(), states = new Map([["r1", reservation("r1")]]), counters = { send: 0, readback: 0 };
  states.get("r1")!.intent.effectDigest = digest;
  let verifies = 0;
  const kernel = createOutcomeKernel({ storage: store, coordinator: coordinator(states, counters), ledger: { getReservation: async () => states.get("r1") } as any, now: () => 2_000, authorization: async () => "active" });
  await kernel.claimMission(mission());
  const first = await kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, handle: handle("r1"), verifier: createTrustedObservationVerifier({ contractDigest: digest, verify: () => { verifies++; return true; } }) }] });
  const firstEffect = first.effects[0]!, receiptId = [...store.published.keys()][0]!;
  const retry = await kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, reservationId: "r1", verifier: createTrustedObservationVerifier({ contractDigest: digest, verify: () => { throw new Error("terminal Outcome must not be reverified"); } }) }] });
  assert.deepEqual(retry.effects[0], firstEffect);
  assert.equal(verifies, 1);
  assert.equal(counters.send, 1);
  assert.equal(store.atomicCalls, 1);

  store.dropReceipt(receiptId);
  const republished = await kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, reservationId: "r1", verifier: createTrustedObservationVerifier({ contractDigest: digest, verify: () => { throw new Error("terminal Outcome must not be reverified"); } }) }] });
  assert.deepEqual(republished.effects[0], firstEffect);
  assert.equal(counters.send, 1);
  assert.equal(store.atomicCalls, 2);
  assert.equal(store.durableCreates, 1);
  assert.deepEqual(store.published.get(receiptId), [store.published.get(receiptId)![0], store.published.get(receiptId)![0]]);
  const receipts = store.published.get(receiptId)!.map(value => JSON.parse(value));
  assert.equal(receipts[0].receiptId, receipts[1].receiptId);
  assert.equal(receipts[0].issuedAt, receipts[1].issuedAt);
  assert.equal(republished.effects[0]!.outcomeId, firstEffect.outcomeId);
  assert.equal(republished.effects[0]!.completedAt, firstEffect.completedAt);
});

test("a contract without readback grades absent before its maximum-grade fallback", async () => {
  const reviewed = contract("identity_absent", "partial"), digest = digestToolEffectContractV1(reviewed);
  const store = durableFixture(), states = new Map([["r1", reservation("r1")]]), counters = { send: 0, readback: 0 };
  states.get("r1")!.intent.effectDigest = digest;
  const kernel = createOutcomeKernel({ storage: store, coordinator: coordinator(states, counters), ledger: { getReservation: async () => states.get("r1") } as any, now: () => 2_000, authorization: async () => "active" });
  await kernel.claimMission(mission("mission_1", [reviewed]));
  const result = await kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, handle: handle("r1"), verifier: verifierFor(reviewed, false) }] });
  assert.equal(result.effects[0]!.status, "absent");
  assert.equal(result.status, "absent");
});

test("hostile coordinator and storage DTO accessors are rejected without execution", async () => {
  const reviewed = contract("identity_1"), digest = digestToolEffectContractV1(reviewed), store = durableFixture();
  let getterCalls = 0;
  const hostile = Object.defineProperty({ reservationId: "r1", state: "reserved", allocationId: null }, "effectDigest", { enumerable: true, get() { getterCalls++; return digest; } });
  const kernel = createOutcomeKernel({ storage: store, coordinator: { describe: () => hostile } as any, ledger: { getReservation: async () => reservation("r1") } as any, now: () => 2_000, authorization: async () => "active" });
  await kernel.claimMission(mission());
  await assert.rejects(() => kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, handle: handle("r1"), verifier: verifierFor(reviewed) }] }), /data|accessor|projection|inert/i);
  assert.equal(getterCalls, 0);

  const ledgerStore = durableFixture(); let ledgerGetters = 0;
  const ledgerIntent = Object.defineProperty({}, "effectDigest", { enumerable: true, get() { ledgerGetters++; return digest; } });
  const ledgerKernel = createOutcomeKernel({ storage: ledgerStore, coordinator: { describe: () => ({ reservationId: "r1", state: "reserved", effectDigest: digest, allocationId: null }) } as any, ledger: { getReservation: async () => ({ reservationId: "r1", state: "reserved", intent: ledgerIntent }) } as any, now: () => 2_000, authorization: async () => "active" });
  await ledgerKernel.claimMission(mission());
  await assert.rejects(() => ledgerKernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, handle: handle("r1"), verifier: verifierFor(reviewed) }] }), /data|ledger|inert/i);
  assert.equal(ledgerGetters, 0);

  const storedStore = durableFixture(), storedState = reservation("r1", "acknowledged", digest); let storedGetters = 0;
  storedStore.loadEffect = async () => Object.defineProperty({ v: "reelier.stored-effect-lifecycle/v1", missionId: "mission_1", missionDigest: sha("1"), contractDigest: digest, reservation: {}, attempt: null, observation: null, outcome: null }, "revision", { enumerable: true, get() { storedGetters++; return 1; } }) as any;
  const storedKernel = createOutcomeKernel({ storage: storedStore, coordinator: coordinator(new Map([["r1", storedState]]), { send: 0, readback: 0 }), ledger: { getReservation: async () => storedState } as any, now: () => 2_000, authorization: async () => "active" });
  await storedKernel.claimMission(mission());
  await assert.rejects(() => storedKernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, reservationId: "r1", verifier: verifierFor(reviewed) }] }), /data|stored|inert/i);
  assert.equal(storedGetters, 0);

  const providerStore = durableFixture(), providerState = reservation("r1", "reserved", digest); let providerGetters = 0;
  const providerKernel = createOutcomeKernel({ storage: providerStore, coordinator: { describe: () => ({ reservationId: "r1", state: "reserved", effectDigest: digest, allocationId: null }), dispatch: async () => Object.defineProperty({ resultDigest: sha("a") }, "kind", { enumerable: true, get() { providerGetters++; return "acknowledged"; } }) } as any, ledger: { getReservation: async () => providerState } as any, now: () => 2_000, authorization: async () => "active" });
  await providerKernel.claimMission(mission());
  await assert.rejects(() => providerKernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, handle: handle("r1"), verifier: verifierFor(reviewed) }] }), /data|dispatch|inert/i);
  assert.equal(providerGetters, 0);

  const receiptStore = durableFixture(), receiptStates = new Map([["r1", reservation("r1", "reserved", digest)]]), receiptCounters = { send: 0, readback: 0 };
  const receiptKernel = createOutcomeKernel({ storage: receiptStore, coordinator: coordinator(receiptStates, receiptCounters), ledger: { getReservation: async () => receiptStates.get("r1") } as any, now: () => 2_000, authorization: async () => "active" });
  await receiptKernel.claimMission(mission());
  await receiptKernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, handle: handle("r1"), verifier: verifierFor(reviewed) }] });
  let receiptGetters = 0;
  receiptStore.loadReceipt = async () => Object.defineProperty({}, "receiptRef", { enumerable: true, get() { receiptGetters++; return sha("9"); } }) as any;
  await assert.rejects(() => receiptKernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, reservationId: "r1", verifier: verifierFor(reviewed) }] }), /data|receipt|inert/i);
  assert.equal(receiptGetters, 0);
  assert.equal(receiptCounters.send, 1);
});

test("concurrent different mission semantics produce one claim and one conflict behind the same barrier", async () => {
  const store = durableFixture(); let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  const original = store.claimMission.bind(store); let arrivals = 0;
  store.claimMission = async (...args) => { arrivals++; if (arrivals < 2) await barrier; else release(); return original(...args); };
  const kernel = createOutcomeKernel({ storage: store, coordinator: {} as any, ledger: {} as any, now: () => 2_000, authorization: async () => "active" });
  const results = await Promise.allSettled([kernel.claimMission(mission()), kernel.claimMission({ ...mission(), promptDigest: sha("d") })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected" && /conflict/i.test(String(result.reason))).length, 1);
});

test("storage claim and load results are bound to the submitted and queried identities", async () => {
  const submitted = mission(), reviewed = contract("identity_1"), digest = digestToolEffectContractV1(reviewed);
  for (const mutation of ["claim-id", "claim-digest", "load-id", "effect-mission", "effect-reservation"] as const) {
    const store = durableFixture(), states = new Map([["r1", reservation("r1", "acknowledged", digest)]]), counters = { send: 0, readback: 0 };
    if (mutation === "claim-id" || mutation === "claim-digest") {
      store.claimMission = async () => ({ status: "claimed" as const, claim: mutation === "claim-id" ? { ...submitted, missionId: "mission_other" } : { ...submitted, promptDigest: sha("e") } });
    }
    const kernel = createOutcomeKernel({ storage: store, coordinator: coordinator(states, counters), ledger: { getReservation: async () => states.get("r1") } as any, now: () => 2_000, authorization: async () => "active" });
    if (mutation === "claim-id" || mutation === "claim-digest") {
      await assert.rejects(() => kernel.claimMission(submitted), /claim|mission|digest|identity/i, mutation);
      continue;
    }
    await kernel.claimMission(submitted);
    if (mutation === "load-id") store.loadMission = async () => ({ ...submitted, missionId: "mission_other" });
    else {
      const base = { v: "reelier.stored-effect-lifecycle/v1" as const, missionId: mutation === "effect-mission" ? "mission_other" : "mission_1", missionDigest: digestMissionClaimV1(submitted), contractDigest: digest, reservation: { v: "reelier.effect-reservation/v1" as const, reservationId: mutation === "effect-reservation" ? "r_other" : "r1", semanticIdentity: reviewed.semanticIdentity, contractDigest: digest, reservedAt: submitted.claimedAt }, attempt: null, observation: null, outcome: null, revision: 1 };
      store.loadEffect = async () => base;
    }
    await assert.rejects(() => kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, reservationId: "r1", verifier: verifierFor(reviewed) }] }), /mission|reservation|query|identity|stored/i, mutation);
    assert.equal(counters.send, 0, mutation);
  }
});

test("invalid optional ledger issuedAt refuses without accessor execution or fallback", async () => {
  const reviewed = contract("identity_1"), digest = digestToolEffectContractV1(reviewed);
  for (const hostile of ["accessor", "invalid"] as const) {
    const store = durableFixture(); let getters = 0;
    const intent: any = { effectDigest: digest };
    if (hostile === "accessor") Object.defineProperty(intent, "issuedAt", { enumerable: true, get() { getters++; return at(1_000); } }); else intent.issuedAt = "not-a-time";
    const current = { reservationId: "r1", state: "reserved", intent };
    const kernel = createOutcomeKernel({ storage: store, coordinator: { describe: () => ({ reservationId: "r1", state: "reserved", effectDigest: digest, allocationId: null }) } as any, ledger: { getReservation: async () => current } as any, now: () => 2_000, authorization: async () => "active" });
    await kernel.claimMission(mission());
    await assert.rejects(() => kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, handle: handle("r1"), verifier: verifierFor(reviewed) }] }), /issued|time|data|ledger/i, hostile);
    assert.equal(getters, 0, hostile);
  }
});

test("concurrent missing-head retries atomically converge on one durable receipt creation and one ref", async () => {
  const reviewed = contract("identity_1"), digest = digestToolEffectContractV1(reviewed), store = durableFixture(), states = new Map([["r1", reservation("r1", "reserved", digest)]]), counters = { send: 0, readback: 0 };
  let crash = true;
  const options = { storage: store, coordinator: coordinator(states, counters), ledger: { getReservation: async () => states.get("r1") } as any, now: () => 2_000, authorization: async () => "active" as const, onBoundary: (name: string) => { if (crash && name === "outcome") throw new Error("crash:outcome"); } };
  const first = createOutcomeKernel(options); await first.claimMission(mission());
  await assert.rejects(() => first.execute({ missionId: "mission_1", effects: [{ contract: reviewed, handle: handle("r1"), verifier: verifierFor(reviewed) }] }), /crash:outcome/);
  crash = false;
  const original = store.compareAndPublishReceipt.bind(store); let arrivals = 0; let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  store.compareAndPublishReceipt = async (...args) => { arrivals++; if (arrivals < 2) await barrier; else release(); return original(...args); };
  const retry = createOutcomeKernel(options), verifier = createTrustedObservationVerifier({ contractDigest: digest, verify: () => { throw new Error("stored terminal outcome must not reverify"); } });
  const [left, right] = await Promise.all([retry.execute({ missionId: "mission_1", effects: [{ contract: reviewed, reservationId: "r1", verifier }] }), retry.execute({ missionId: "mission_1", effects: [{ contract: reviewed, reservationId: "r1", verifier }] })]);
  assert.equal(store.atomicCalls, 2);
  assert.equal(store.durableCreates, 1);
  assert.deepEqual(left.receiptRefs, right.receiptRefs);
  assert.equal(left.receiptRefs.length, 1);
  assert.equal(counters.send, 1);
});

test("an atomic receipt identity conflict refuses without provider resend", async () => {
  const reviewed = contract("identity_1"), digest = digestToolEffectContractV1(reviewed), store = durableFixture(), states = new Map([["r1", reservation("r1", "reserved", digest)]]), counters = { send: 0, readback: 0 };
  const kernel = createOutcomeKernel({ storage: store, coordinator: coordinator(states, counters), ledger: { getReservation: async () => states.get("r1") } as any, now: () => 2_000, authorization: async () => "active" });
  await kernel.claimMission(mission());
  const first = await kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, handle: handle("r1"), verifier: verifierFor(reviewed) }] });
  const receiptId = [...store.published.keys()][0]!;
  store.dropReceipt(receiptId);
  store.seedReceiptClaim(receiptId, sha("e"), sha("8"));
  await assert.rejects(() => kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, reservationId: "r1", verifier: verifierFor(reviewed) }] }), /receipt.*conflict|conflict.*receipt/i);
  assert.equal(first.effects[0]!.status, "verified");
  assert.equal(counters.send, 1);
});

test("an atomic publication ref that disagrees with the durable head refuses as integrity drift", async () => {
  const reviewed = contract("identity_1"), digest = digestToolEffectContractV1(reviewed), store = durableFixture(), states = new Map([["r1", reservation("r1", "reserved", digest)]]), counters = { send: 0, readback: 0 };
  const kernel = createOutcomeKernel({ storage: store, coordinator: coordinator(states, counters), ledger: { getReservation: async () => states.get("r1") } as any, now: () => 2_000, authorization: async () => "active" });
  await kernel.claimMission(mission());
  await kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, handle: handle("r1"), verifier: verifierFor(reviewed) }] });
  const receiptId = [...store.published.keys()][0]!, originalLoad = store.loadReceipt.bind(store); let reads = 0;
  store.loadReceipt = async id => ++reads === 1 ? null : originalLoad(id);
  store.compareAndPublishReceipt = async (receipt, receiptDigest) => { assert.equal(receipt.receiptId, receiptId); return { status: "exact-existing" as const, receiptDigest, receiptRef: sha("8") }; };
  await assert.rejects(() => kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, reservationId: "r1", verifier: verifierFor(reviewed) }] }), /receipt|head|ref|integrity|mismatch/i);
  assert.equal(counters.send, 1);
});

test("successful lifecycle stores cannot substitute any submitted mission, contract, or nested reservation identity", async () => {
  const reviewed = contract("identity_1"), contractDigest = digestToolEffectContractV1(reviewed), submittedMission = mission(), submittedMissionDigest = digestMissionClaimV1(submittedMission);
  for (const mutation of ["mission-id", "reservation-id", "mission-digest", "contract-digest", "semantic-identity"] as const) {
    const store = durableFixture(), states = new Map([["r1", reservation("r1", "reserved", contractDigest)]]), counters = { send: 0, readback: 0 };
    const original = store.storeEffect.bind(store);
    store.storeEffect = async (value, revision) => {
      const result = await original(value, revision);
      if (result.status !== "stored") return result;
      const changedContractDigest = mutation === "contract-digest" ? sha("e") : result.value.contractDigest;
      return { status: "stored" as const, value: Object.freeze({
        ...result.value,
        missionId: mutation === "mission-id" ? "mission_other" : result.value.missionId,
        missionDigest: mutation === "mission-digest" ? sha("f") : result.value.missionDigest,
        contractDigest: changedContractDigest,
        reservation: Object.freeze({
          ...result.value.reservation,
          reservationId: mutation === "reservation-id" ? "r_other" : result.value.reservation.reservationId,
          contractDigest: changedContractDigest,
          semanticIdentity: mutation === "semantic-identity" ? "identity_other" : result.value.reservation.semanticIdentity,
        }),
      }) };
    };
    const kernel = createOutcomeKernel({ storage: store, coordinator: coordinator(states, counters), ledger: { getReservation: async () => states.get("r1") } as any, now: () => 2_000, authorization: async () => "active" });
    await kernel.claimMission(submittedMission);
    await assert.rejects(() => kernel.execute({ missionId: submittedMission.missionId, effects: [{ contract: reviewed, handle: handle("r1"), verifier: verifierFor(reviewed) }] }), /stored|lifecycle|identity|semantics|digest|reservation/i, mutation);
    assert.equal(counters.send, 0, mutation);
    assert.equal(submittedMissionDigest, digestMissionClaimV1(submittedMission));
  }
});

test("pre-existing receipt heads require the exact receipt ID and digest before adoption", async () => {
  const reviewed = contract("identity_1"), digest = digestToolEffectContractV1(reviewed), store = durableFixture(), states = new Map([["r1", reservation("r1", "reserved", digest)]]), counters = { send: 0, readback: 0 };
  const kernel = createOutcomeKernel({ storage: store, coordinator: coordinator(states, counters), ledger: { getReservation: async () => states.get("r1") } as any, now: () => 2_000, authorization: async () => "active" });
  await kernel.claimMission(mission());
  const first = await kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, handle: handle("r1"), verifier: verifierFor(reviewed) }] });
  const receiptId = [...store.published.keys()][0]!, receipt = JSON.parse(store.published.get(receiptId)![0]!) as GovernedReceiptV1, receiptDigest = digestGovernedReceiptV1(receipt), receiptRef = first.receiptRefs[0]!;
  const atomicCalls = store.atomicCalls;

  store.loadReceipt = async () => ({ receiptId, receiptDigest, receiptRef } as any);
  const converged = await kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, reservationId: "r1", verifier: verifierFor(reviewed) }] });
  assert.deepEqual(converged.receiptRefs, [receiptRef]);
  assert.equal(store.atomicCalls, atomicCalls);
  assert.equal(counters.send, 1);

  for (const head of [
    { receiptRef },
    { receiptId: "receipt_unrelated", receiptDigest, receiptRef },
    { receiptId, receiptDigest: sha("e"), receiptRef },
  ]) {
    store.loadReceipt = async () => head as any;
    await assert.rejects(() => kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, reservationId: "r1", verifier: verifierFor(reviewed) }] }), /receipt|head|identity|digest|closed/i);
    assert.equal(counters.send, 1);
  }
});

test("host-authenticated predecessor policy requires an earlier verified Outcome and exact durable receipt head", async () => {
  const predecessor = contract("linear_comment"), successor = contract("linear_status");
  const predecessorDigest = digestToolEffectContractV1(predecessor), successorDigest = digestToolEffectContractV1(successor);
  const policy = createTrustedOutcomePredecessorPolicyV1({ predecessorContractDigest: predecessorDigest, successorContractDigest: successorDigest });
  const store = durableFixture(), states = new Map([
    ["comment", reservation("comment", "reserved", predecessorDigest)],
    ["status", reservation("status", "reserved", successorDigest)],
  ]), counters = { send: 0, readback: 0 };
  const options = { storage: store, coordinator: coordinator(states, counters), ledger: { getReservation: async (id: string) => states.get(id) } as any, now: () => 2_000, authorization: async () => "active" as const, predecessorPolicy: policy };
  const first = createOutcomeKernel(options); await first.claimMission(mission("linear_mission", [predecessor, successor]));

  await assert.rejects(() => first.execute({ missionId: "linear_mission", effects: [{ contract: successor, handle: handle("status", successor), verifier: verifierFor(successor) }] }), /predecessor|receipt/i);
  assert.equal(counters.send, 0);

  const comment = await first.execute({ missionId: "linear_mission", effects: [{ contract: predecessor, handle: handle("comment", predecessor), verifier: verifierFor(predecessor) }] });
  assert.equal(comment.effects[0]!.status, "verified");
  assert.equal(counters.send, 1);

  const restarted = createOutcomeKernel(options);
  const completed = await restarted.execute({ missionId: "linear_mission", effects: [
    { contract: predecessor, reservationId: "comment", verifier: verifierFor(predecessor) },
    { contract: successor, handle: handle("status", successor), verifier: verifierFor(successor) },
  ] });
  assert.deepEqual(completed.effects.map(effect => effect.status), ["verified", "verified"]);
  assert.equal(counters.send, 2);

  for (const status of ["pending", "partial", "failed"] as const) {
    const stored = store.effects.get("comment")!;
    store.effects.set("comment", Object.freeze({ ...stored, outcome: Object.freeze({ ...stored.outcome!, status }) }));
    states.set("status-2", reservation("status-2", "reserved", successorDigest));
    await assert.rejects(() => restarted.execute({ missionId: "linear_mission", effects: [
      { contract: predecessor, reservationId: "comment", verifier: verifierFor(predecessor) },
      { contract: successor, handle: handle("status-2", successor), verifier: verifierFor(successor) },
    ] }), /predecessor|verified/i);
    assert.equal(counters.send, 2);
  }

  const verified = store.effects.get("comment")!;
  store.effects.set("comment", Object.freeze({ ...verified, outcome: Object.freeze({ ...verified.outcome!, status: "verified" }) }));
  const originalLoadReceipt = store.loadReceipt.bind(store);
  store.loadReceipt = async receiptId => { const head = await originalLoadReceipt(receiptId); return head && { ...head, receiptDigest: sha("e") }; };
  states.set("status-3", reservation("status-3", "reserved", successorDigest));
  await assert.rejects(() => restarted.execute({ missionId: "linear_mission", effects: [
    { contract: predecessor, reservationId: "comment", verifier: verifierFor(predecessor) },
    { contract: successor, handle: handle("status-3", successor), verifier: verifierFor(successor) },
  ] }), /receipt|digest|predecessor/i);
  assert.equal(counters.send, 2);

  const wrongPolicy = createTrustedOutcomePredecessorPolicyV1({ predecessorContractDigest: digestToolEffectContractV1(contract("wrong_comment")), successorContractDigest: successorDigest });
  const wrongKernel = createOutcomeKernel({ ...options, predecessorPolicy: wrongPolicy });
  store.loadReceipt = originalLoadReceipt;
  states.set("status-4", reservation("status-4", "reserved", successorDigest));
  await assert.rejects(() => wrongKernel.execute({ missionId: "linear_mission", effects: [
    { contract: predecessor, reservationId: "comment", verifier: verifierFor(predecessor) },
    { contract: successor, handle: handle("status-4", successor), verifier: verifierFor(successor) },
  ] }), /predecessor/i);
  assert.equal(counters.send, 2);
});
