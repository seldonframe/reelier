import assert from "node:assert/strict";
import test from "node:test";
import {
  createOutcomeKernel,
  createTrustedObservationVerifier,
  type OutcomeKernelStorage,
  type StoredEffectLifecycleV1,
} from "reelier/authority/host";
// @ts-ignore compiled tests share the opaque handle brand with the built public host package.
import { createReservedDispatchHandle } from "../../../dist/authority/gate.js";
import { digestToolEffectContractV1, type MissionClaimV1, type ToolEffectContractV1 } from "reelier/authority";

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

function durableFixture(): OutcomeKernelStorage & { effects: Map<string, StoredEffectLifecycleV1>; loseHead: boolean; publishCalls: number; published: Map<string, readonly string[]>; dropReceipt(receiptId: string): void } {
  const missions = new Map<string, { digest: string; claim: MissionClaimV1 }>();
  const effects = new Map<string, StoredEffectLifecycleV1>();
  const receipts = new Map<string, string>();
  return {
    durable: true, effects, loseHead: false, publishCalls: 0, published: new Map(),
    dropReceipt(receiptId) { receipts.delete(receiptId); },
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
    async publishReceipt(receipt) { this.publishCalls++; const prior = this.published.get(receipt.receiptId) ?? []; this.published.set(receipt.receiptId, Object.freeze([...prior, JSON.stringify(receipt)])); const ref = sha("9"); receipts.set(receipt.receiptId, ref); return this.loseHead ? { durable: false as const } : { durable: true as const, receiptRef: ref }; },
    async loadReceipt(receiptId) { const receiptRef = receipts.get(receiptId); return receiptRef && !this.loseHead ? { receiptRef } : null; },
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
function handle(id: string) { const effectDigest = digestToolEffectContractV1(contract("identity_1")); const opaque = createReservedDispatchHandle({ reservation: reservation(id, "reserved", effectDigest), effect: {}, effectCanonicalBase64: "e30=", effectDigest }); handleIds.set(opaque as object, id); return opaque; }

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
  assert.equal(store.publishCalls, 1);

  store.dropReceipt(receiptId);
  const republished = await kernel.execute({ missionId: "mission_1", effects: [{ contract: reviewed, reservationId: "r1", verifier: createTrustedObservationVerifier({ contractDigest: digest, verify: () => { throw new Error("terminal Outcome must not be reverified"); } }) }] });
  assert.deepEqual(republished.effects[0], firstEffect);
  assert.equal(counters.send, 1);
  assert.equal(store.publishCalls, 2);
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
