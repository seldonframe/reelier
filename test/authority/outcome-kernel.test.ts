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

function reservation(id: string, state = "reserved") {
  return { reservationId: id, state, intent: { effectDigest: sha("7"), effectCanonicalBase64: "e30=" } } as any;
}

function durableFixture(): OutcomeKernelStorage & { effects: Map<string, StoredEffectLifecycleV1>; loseHead: boolean } {
  const missions = new Map<string, { digest: string; claim: MissionClaimV1 }>();
  const effects = new Map<string, StoredEffectLifecycleV1>();
  const receipts = new Map<string, string>();
  return {
    durable: true, effects, loseHead: false,
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
    async publishReceipt(receipt) { const ref = sha("9"); receipts.set(receipt.receiptId, ref); return this.loseHead ? { durable: false as const } : { durable: true as const, receiptRef: ref }; },
    async loadReceipt(receiptId) { const receiptRef = receipts.get(receiptId); return receiptRef && !this.loseHead ? { receiptRef } : null; },
  };
}

function coordinator(states: Map<string, any>, counters: { send: number; readback: number }) {
  return {
    describe(handle: any) { const state = states.get(handleIds.get(handle)!); return Object.freeze({ reservationId: state.reservationId, state: state.state, effectDigest: sha("7"), allocationId: null }); },
    async dispatch(handle: any) { counters.send++; const state = states.get(handleIds.get(handle)!); state.state = "acknowledged"; return { kind: "acknowledged" as const, resultDigest: sha("a"), reconciliationStatus: "matched" as const, normalizedProjectionDigest: sha("b") }; },
    async reconcile(reservationId: string) { counters.readback++; const state = states.get(reservationId); state.state = "reconciled"; return { kind: "acknowledged" as const, resultDigest: sha("c"), reconciliationStatus: "matched" as const, normalizedProjectionDigest: sha("b") }; },
    async cancel() { throw new Error("not used"); }, async recover() { for (const state of states.values()) { if (state.state === "reserved") state.state = "cancelled"; else if (state.state === "dispatched") state.state = "ambiguous"; } return []; },
  } as any;
}

const handleIds = new WeakMap<object, string>();
function handle(id: string) { const opaque = createReservedDispatchHandle({ reservation: reservation(id), effect: {}, effectCanonicalBase64: "e30=", effectDigest: sha("7") }); handleIds.set(opaque as object, id); return opaque; }

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
  assert.notEqual(outcome.status, "verified");
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
  const store = durableFixture(), states = new Map([["r1", reservation("r1", "ambiguous")], ["r2", reservation("r2")]]), counters = { send: 0, readback: 0 };
  store.loseHead = true;
  const kernel = createOutcomeKernel({ storage: store, coordinator: coordinator(states, counters), ledger: { getReservation: async (id: string) => states.get(id) } as any, now: () => 2_000, authorization: async () => "active" });
  const first = contract("identity_1"), second = contract("identity_2", "pending");
  await kernel.claimMission(mission("mission_1", [first, second]));
  const outcome = await kernel.execute({ missionId: "mission_1", effects: [
    { contract: first, handle: handle("r1"), verifier: verifierFor(first) },
    { contract: second, handle: handle("r2"), verifier: verifierFor(second, false) },
  ] });
  assert.equal(counters.readback, 1);
  assert.equal(counters.send, 1);
  assert.notEqual(outcome.status, "verified");
  assert.deepEqual(outcome.effects.map(effect => effect.status), ["verified", "pending"]);
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
  assert.notEqual(outcome.status, "verified");
  assert.equal(outcome.receiptsDurable, false);
  assert.deepEqual(counters, { send: 0, readback: 1 });
});
