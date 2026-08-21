import assert from "node:assert/strict";
import test from "node:test";
import { createReservedDispatchHandle } from "../../src/authority/gate.js";
import {
  compileEffectTransportV1,
  digestEffectTransportBindingV1,
  type EffectTransportHostBindingsV1,
  type EffectTransportPortsV1,
} from "../../src/authority/host/effect-transports.js";
import { createOutcomeKernel, type OutcomeKernelStorage, type StoredEffectLifecycleV1 } from "../../src/authority/host/outcome-kernel.js";
import { digestMissionClaimV1, digestToolEffectContractV1, type GovernedReceiptV1, type MissionClaimV1, type ToolEffectContractV1 } from "../../src/authority/tool-effect-contract.js";
import { authorityDigest } from "../../src/authority/wire.js";
import { CALENDAR_LIKE_BINDING, CALENDAR_LIKE_CONTRACT, SLACK_LIKE_BINDING, SLACK_LIKE_CONTRACT, SLIDES_LIKE_BINDING, SLIDES_LIKE_CONTRACT } from "./fixtures/tool-effect-contracts.js";

const sha = (digit: string): string => `sha256:${digit.repeat(64)}`;
const at = (milliseconds: number): string => new Date(milliseconds).toISOString();
const host: EffectTransportHostBindingsV1 = Object.freeze({ credential: "credential-super-secret", account: "account-1", destination: "destination-1", limit: "limit-1" });

test("MCP compilation closes model input before host injection and omits credentials from evidence", async () => {
  let resolved = 0;
  let received: unknown;
  const compiled = compileEffectTransportV1({
    contract: SLACK_LIKE_CONTRACT,
    binding: SLACK_LIKE_BINDING,
    modelInput: { channel: "general", text: "hello" },
    resolveHostBindings: async refs => { resolved++; assert.deepEqual(refs, SLACK_LIKE_CONTRACT.bindings); return host; },
    ports: { mcp: { call: async request => { received = request; return { outcome: "ok", data: { messageId: "m-1" } }; } } },
  });
  assert.equal(resolved, 0);
  const outcome = await compiled.adapter.dispatch(dispatchState(SLACK_LIKE_CONTRACT, compiled.effect));
  assert.equal(resolved, 1);
  assert.deepEqual(received, {
    server: "hermetic-slack", tool: "send_message",
    arguments: { model: { channel: "general", text: "hello" }, host: { account: "account-1", destination: "destination-1", limit: "limit-1" } },
    credential: "credential-super-secret",
  });
  assert.equal(outcome.kind, "acknowledged");
  assert.doesNotMatch(JSON.stringify({ effect: compiled.effect, evidence: compiled.evidence, outcome }), /credential-super-secret/);

  for (const invalid of [{ channel: "general", text: "hello", tenant: "model-owned" }, { channel: "general" }]) {
    let touchedHost = 0;
    assert.throws(() => compileEffectTransportV1({ contract: SLACK_LIKE_CONTRACT, binding: SLACK_LIKE_BINDING, modelInput: invalid, resolveHostBindings: async () => { touchedHost++; return host; }, ports: {} }), /model|field|closed/i);
    assert.equal(touchedHost, 0);
  }
});

test("reviewed HTTP compilation binds method, origin, path, schemas, and response projection", async () => {
  const calls: unknown[] = [];
  const ports: EffectTransportPortsV1 = { http: { call: async request => { calls.push(request); return calls.length === 1 ? { outcome: "ok", data: { eventId: "event-9", state: "accepted", ignored: "outside projection" } } : { outcome: "ok", data: { eventId: "event-9", state: "visible", ignored: "outside projection" } }; } } };
  const compiled = compileEffectTransportV1({ contract: CALENDAR_LIKE_CONTRACT, binding: CALENDAR_LIKE_BINDING, modelInput: { eventId: "event-9", title: "Review" }, resolveHostBindings: async () => host, ports });
  const dispatched = await compiled.adapter.dispatch(dispatchState(CALENDAR_LIKE_CONTRACT, compiled.effect));
  const reconciled = await compiled.adapter.reconcile!(dispatchState(CALENDAR_LIKE_CONTRACT, compiled.effect), dispatched);
  assert.deepEqual(calls, [
    { method: "POST", url: "https://calendar.invalid/calendars/destination-1/events", body: { model: { eventId: "event-9", title: "Review" }, host: { account: "account-1", destination: "destination-1", limit: "limit-1" } }, credential: "credential-super-secret", requestSchemaDigest: sha("3") },
    { method: "GET", url: "https://calendar.invalid/calendars/destination-1/events/event-9", body: null, credential: "credential-super-secret", requestSchemaDigest: sha("4") },
  ]);
  assert.equal(reconciled.reconciliationStatus, "matched");
  assert.equal(reconciled.normalizedProjectionDigest, authorityDigest({ "/eventId": "event-9", "/state": "visible" }));

  const changed = { ...CALENDAR_LIKE_BINDING, method: "PATCH" as const };
  assert.notEqual(digestEffectTransportBindingV1(changed), CALENDAR_LIKE_CONTRACT.operationDigest);
  assert.throws(() => compileEffectTransportV1({ contract: CALENDAR_LIKE_CONTRACT, binding: changed, modelInput: { eventId: "event-9", title: "Review" }, resolveHostBindings: async () => host, ports }), /binding|digest|contract/i);
});

test("CLI uses a fixed executable, argv array, and exact environment-name allowlist", async () => {
  let request: unknown;
  const compiled = compileEffectTransportV1({
    contract: SLIDES_LIKE_CONTRACT,
    binding: SLIDES_LIKE_BINDING,
    modelInput: { title: "Q3; Remove-Item C:/" },
    resolveHostBindings: async () => host,
    ports: { cli: { spawn: async input => { request = input; return { outcome: "ok", data: { deckId: "quarterly", revision: 2 } }; } } },
  });
  await compiled.adapter.dispatch(dispatchState(SLIDES_LIKE_CONTRACT, compiled.effect));
  assert.deepEqual(request, {
    executable: "C:/reviewed/bin/slides-tool.exe",
    argv: ["update", "--deck", "destination-1", "--title", "Q3; Remove-Item C:/"],
    env: { SLIDES_TOKEN: "credential-super-secret" },
  });
  assert.throws(() => compileEffectTransportV1({ contract: SLIDES_LIKE_CONTRACT, binding: { ...SLIDES_LIKE_BINDING, shell: true } as never, modelInput: { title: "Q3" }, resolveHostBindings: async () => host, ports: {} }), /closed|field|binding/i);
  assert.throws(() => compileEffectTransportV1({ contract: SLIDES_LIKE_CONTRACT, binding: { ...SLIDES_LIKE_BINDING, argvTemplates: "update --all" } as never, modelInput: { title: "Q3" }, resolveHostBindings: async () => host, ports: {} }), /argv|binding/i);
});

test("template value validation completes before any host secret resolution", async () => {
  let resolutions = 0;
  const compiled = compileEffectTransportV1({
    contract: SLIDES_LIKE_CONTRACT,
    binding: SLIDES_LIKE_BINDING,
    modelInput: { title: { nested: "not-an-argv-scalar" } },
    resolveHostBindings: async () => { resolutions++; return host; },
    ports: { cli: { spawn: async () => ({ outcome: "ok", data: {} }) } },
  });
  await assert.rejects(() => compiled.adapter.dispatch(dispatchState(SLIDES_LIKE_CONTRACT, compiled.effect)), /template|scalar|model/i);
  assert.equal(resolutions, 0);
});

test("provider DTOs are detached before reads and hostile accessors, proxies, callables, and oversize input stay inert", async () => {
  let getters = 0;
  for (const response of [
    Object.defineProperty({}, "outcome", { enumerable: true, get() { getters++; return "ok"; } }),
    { outcome: "ok", data: new Proxy({}, { get() { getters++; throw new Error("trap"); } }) },
    { outcome: "ok", data: { callback() {} } },
    { outcome: "ok", data: "x".repeat(1_100_000) },
  ]) {
    const compiled = compileEffectTransportV1({ contract: SLACK_LIKE_CONTRACT, binding: SLACK_LIKE_BINDING, modelInput: { channel: "general", text: "hello" }, resolveHostBindings: async () => host, ports: { mcp: { call: async () => response as never } } });
    await assert.rejects(() => compiled.adapter.dispatch(dispatchState(SLACK_LIKE_CONTRACT, compiled.effect)), /provider|data|accessor|proxy|callable|large|bounded|inert/i);
  }
  assert.equal(getters, 0);

  let modelGetter = 0, resolverCalls = 0;
  const hostileModel = Object.defineProperty({ channel: "general" }, "text", { enumerable: true, get() { modelGetter++; return "hello"; } });
  assert.throws(() => compileEffectTransportV1({ contract: SLACK_LIKE_CONTRACT, binding: SLACK_LIKE_BINDING, modelInput: hostileModel, resolveHostBindings: async () => { resolverCalls++; return host; }, ports: {} }), /model|accessor|data/i);
  assert.equal(modelGetter, 0);
  assert.equal(resolverCalls, 0);
});

test("ambiguous writes use authoritative readback without resend and semantic conflicts are explicit", async () => {
  let sends = 0, reads = 0;
  const ports: EffectTransportPortsV1 = { http: { call: async request => request.method === "POST" ? (sends++, { outcome: "unknown", data: null }) : (reads++, { outcome: "conflict", data: { eventId: "event-9", state: "other" } }) } };
  const compiled = compileEffectTransportV1({ contract: CALENDAR_LIKE_CONTRACT, binding: CALENDAR_LIKE_BINDING, modelInput: { eventId: "event-9", title: "Review" }, resolveHostBindings: async () => host, ports });
  const state = dispatchState(CALENDAR_LIKE_CONTRACT, compiled.effect);
  const ambiguous = await compiled.adapter.dispatch(state);
  assert.equal(ambiguous.kind, "ambiguous");
  const readback = await compiled.adapter.reconcile!(state, ambiguous);
  assert.equal(readback.reconciliationStatus, "conflict");
  assert.deepEqual({ sends, reads }, { sends: 1, reads: 1 });
});

test("three unrelated adapters run through the unchanged Outcome kernel with honest grades", async () => {
  const cases = [
    { contract: SLACK_LIKE_CONTRACT, binding: SLACK_LIKE_BINDING, model: { channel: "general", text: "hello" }, ports: { mcp: { call: async () => ({ outcome: "ok", data: { messageId: "m-1" } }) } }, status: "absent" },
    { contract: CALENDAR_LIKE_CONTRACT, binding: CALENDAR_LIKE_BINDING, model: { eventId: "event-9", title: "Review" }, ports: { http: { call: async () => ({ outcome: "ok", data: { eventId: "event-9", state: "visible" } }) } }, status: "partial" },
    { contract: SLIDES_LIKE_CONTRACT, binding: SLIDES_LIKE_BINDING, model: { title: "Q3" }, ports: { cli: { spawn: async () => ({ outcome: "ok", data: { deckId: "quarterly", revision: 2 } }) } }, status: "verified" },
  ] as const;
  for (let index = 0; index < cases.length; index++) {
    const item = cases[index], compiled = compileEffectTransportV1({ contract: item.contract, binding: item.binding, modelInput: item.model, resolveHostBindings: async () => host, ports: item.ports });
    const result = await runThroughKernel(item.contract, compiled, `reservation-${index}`);
    assert.equal(result.effects[0]!.status, item.status, item.contract.provider);
  }
});

function dispatchState(contract: ToolEffectContractV1, effect: unknown) {
  const effectDigest = digestToolEffectContractV1(contract);
  return { reservation: { reservationId: "reservation-1", state: "reserved" as const, intent: { effectDigest, effectCanonicalBase64: "e30=" } }, effect, effectCanonicalBase64: "e30=", effectDigest };
}

async function runThroughKernel(contract: ToolEffectContractV1, compiled: ReturnType<typeof compileEffectTransportV1>, reservationId: string) {
  const effectDigest = digestToolEffectContractV1(contract), state = dispatchState(contract, compiled.effect) as any;
  state.reservation.reservationId = reservationId;
  const handle = createReservedDispatchHandle(state), storage = durableStorage(), mission: MissionClaimV1 = { v: "reelier.mission-claim/v1", missionId: `mission-${reservationId}`, mandateDigest: sha("7"), promptDigest: sha("8"), contractDigests: [effectDigest], claimedAt: at(1_000) };
  const ledgerState: any = { ...state.reservation, intent: { ...state.reservation.intent } };
  const coordinator: any = {
    describe: () => ({ reservationId, state: ledgerState.state, effectDigest, allocationId: null }),
    dispatch: async () => {
      ledgerState.state = "dispatched";
      let result = await compiled.adapter.dispatch(state);
      if (result.kind !== "ambiguous" && compiled.adapter.reconcile) result = await compiled.adapter.reconcile(state, result);
      ledgerState.state = result.kind === "ambiguous" ? "ambiguous" : result.reconciliationStatus && result.reconciliationStatus !== "not-attempted" ? "reconciled" : result.kind;
      return result;
    },
    reconcile: async () => { const result = await compiled.adapter.reconcile!(state, { kind: "ambiguous", resultDigest: sha("9") }); ledgerState.state = "reconciled"; return result; },
    recover: async () => [], cancel: async () => { throw new Error("not used"); },
  };
  const kernel = createOutcomeKernel({ storage, coordinator, ledger: { getReservation: async () => ledgerState } as any, now: () => 2_000, authorization: async () => "active" });
  await kernel.claimMission(mission);
  return kernel.execute({ missionId: mission.missionId, effects: [{ contract, handle, verifier: compiled.verifier }] });
}

function durableStorage(): OutcomeKernelStorage {
  const missions = new Map<string, MissionClaimV1>(), effects = new Map<string, StoredEffectLifecycleV1>(), receipts = new Map<string, { receiptId: string; receiptDigest: string; receiptRef: string }>();
  return {
    durable: true,
    async claimMission(claim) { const prior = missions.get(claim.missionId); if (prior) return digestMissionClaimV1(prior) === digestMissionClaimV1(claim) ? { status: "exact-existing", claim: prior } : { status: "conflict" }; missions.set(claim.missionId, claim); return { status: "claimed", claim }; },
    async loadMission(id) { return missions.get(id) ?? null; },
    async loadEffect(_missionId, id) { return effects.get(id) ?? null; },
    async storeEffect(value, revision) { const prior = effects.get(value.reservation.reservationId); if ((prior?.revision ?? 0) !== revision) return { status: "conflict" }; const stored = Object.freeze({ ...value, revision: revision + 1 }); effects.set(value.reservation.reservationId, stored); return { status: "stored", value: stored }; },
    async compareAndPublishReceipt(receipt: GovernedReceiptV1, receiptDigest: string) { const prior = receipts.get(receipt.receiptId); if (prior && prior.receiptDigest !== receiptDigest) return { status: "conflict" }; const head = prior ?? { receiptId: receipt.receiptId, receiptDigest, receiptRef: authorityDigest(receipt) }; receipts.set(receipt.receiptId, head); return { status: prior ? "exact-existing" : "published", receiptDigest: head.receiptDigest, receiptRef: head.receiptRef }; },
    async loadReceipt(id) { return receipts.get(id) ?? null; },
  };
}
