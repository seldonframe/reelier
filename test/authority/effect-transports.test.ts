import assert from "node:assert/strict";
import test from "node:test";
import { createReservedDispatchHandle } from "../../src/authority/gate.js";
import {
  compileEffectTransportV1,
  digestEffectTransportBindingV1,
  parseEffectTransportBindingV1,
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
const wire = (outcome: string, data: unknown): string => JSON.stringify({ outcome, data });
const slackSchemas = async (): Promise<string> => JSON.stringify({ serverSchemaDigest: SLACK_LIKE_BINDING.serverSchemaDigest, toolSchemaDigest: SLACK_LIKE_BINDING.toolSchemaDigest });

test("MCP compilation closes model input before host injection and omits credentials from evidence", async () => {
  let resolved = 0;
  let received: unknown;
  const compiled = compileEffectTransportV1({
    contract: SLACK_LIKE_CONTRACT,
    binding: SLACK_LIKE_BINDING,
    modelInput: { channel: "general", text: "hello" },
    resolveHostBindings: async refs => { resolved++; assert.deepEqual(refs, SLACK_LIKE_CONTRACT.bindings); return host; },
    ports: { mcp: { inspectSchemas: slackSchemas, call: async request => { received = request; return wire("ok", { messageId: "m-1" }); } } },
  });
  assert.equal(resolved, 0);
  const outcome = await compiled.adapter.dispatch(dispatchState(SLACK_LIKE_CONTRACT, compiled.effect));
  assert.equal(resolved, 1);
  assert.deepEqual(received, {
    server: "hermetic-slack", tool: "send_message", serverSchemaDigest: sha("1"), toolSchemaDigest: sha("2"),
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
  const ports: EffectTransportPortsV1 = { http: { call: async request => { calls.push(request); return calls.length === 1 ? wire("ok", { eventId: "event-9", state: "accepted", ignored: "outside projection" }) : wire("ok", { eventId: "event-9", state: "visible", ignored: "outside projection" }); } } };
  const compiled = compileEffectTransportV1({ contract: CALENDAR_LIKE_CONTRACT, binding: CALENDAR_LIKE_BINDING, modelInput: { eventId: "event-9", title: "Review" }, resolveHostBindings: async () => host, ports });
  const dispatched = await compiled.adapter.dispatch(dispatchState(CALENDAR_LIKE_CONTRACT, compiled.effect));
  const reconciled = await compiled.adapter.reconcile!(dispatchState(CALENDAR_LIKE_CONTRACT, compiled.effect), dispatched);
  assert.deepEqual(calls, [
    { method: "POST", url: "https://calendar.invalid/calendars/destination-1/events", body: { model: { eventId: "event-9", title: "Review" }, host: { account: "account-1", destination: "destination-1", limit: "limit-1" } }, credential: "credential-super-secret", requestSchemaDigest: sha("3") },
    { method: "GET", url: "https://calendar.invalid/calendars/destination-1/events/event-9", body: null, credential: "credential-super-secret", requestSchemaDigest: sha("4") },
  ]);
  assert.equal(reconciled.reconciliationStatus, "matched");
  assert.equal(reconciled.normalizedProjectionDigest, authorityDigest({
    v: "reelier.effect-authoritative-match/v1",
    contractDigest: digestToolEffectContractV1(CALENDAR_LIKE_CONTRACT),
    bindingDigest: digestEffectTransportBindingV1(CALENDAR_LIKE_BINDING),
    semanticIdentity: CALENDAR_LIKE_CONTRACT.semanticIdentity,
    modelDigest: authorityDigest({ eventId: "event-9", title: "Review" }),
    readbackOperation: CALENDAR_LIKE_CONTRACT.readback!.operation,
    projectionSchemaDigest: authorityDigest(CALENDAR_LIKE_CONTRACT.readback!.projection),
  }));

  const changed = { ...CALENDAR_LIKE_BINDING, method: "PATCH" as const };
  assert.notEqual(digestEffectTransportBindingV1(changed), CALENDAR_LIKE_CONTRACT.operationDigest);
  assert.throws(() => compileEffectTransportV1({ contract: CALENDAR_LIKE_CONTRACT, binding: changed, modelInput: { eventId: "event-9", title: "Review" }, resolveHostBindings: async () => host, ports }), /binding|digest|contract/i);
});

test("HTTP paths reject normalization, encoded separators, confusables, query, and fragment drift", async () => {
  for (const maliciousPath of [
    "/calendars/../admin",
    "/calendars/%2e%2e/admin",
    "/calendars/%252e%252e/admin",
    "/calendars\\admin",
    "/calendars/%5cadmin",
    "/calendars/∕admin",
    "/calendars/%E2%88%95admin",
    "/calendars/admin?mode=write",
    "/calendars/admin#fragment",
  ]) {
    assert.throws(() => parseEffectTransportBindingV1({ ...CALENDAR_LIKE_BINDING, pathTemplate: maliciousPath }), /HTTP path/i, maliciousPath);
  }

  for (const maliciousId of ["..", "%2e%2e", "a\\b", "a∕b", "a?mode=write", "a#fragment"]) {
    let readbackCalls = 0;
    const compiled = compileEffectTransportV1({
      contract: CALENDAR_LIKE_CONTRACT,
      binding: CALENDAR_LIKE_BINDING,
      modelInput: { eventId: maliciousId, title: "Review" },
      resolveHostBindings: async () => host,
      ports: { http: { call: async request => request.method === "POST" ? wire("unknown", null) : (readbackCalls++, wire("ok", { eventId: maliciousId, state: "visible" })) } },
    });
    const dispatched = await compiled.adapter.dispatch(dispatchState(CALENDAR_LIKE_CONTRACT, compiled.effect));
    await assert.rejects(() => compiled.adapter.reconcile!(dispatchState(CALENDAR_LIKE_CONTRACT, compiled.effect), dispatched), /HTTP.*path/i, maliciousId);
    assert.equal(readbackCalls, 0, maliciousId);
  }
});

test("CLI uses a fixed executable, argv array, and exact environment-name allowlist", async () => {
  let request: unknown;
  const compiled = compileEffectTransportV1({
    contract: SLIDES_LIKE_CONTRACT,
    binding: SLIDES_LIKE_BINDING,
    modelInput: { title: "Q3; Remove-Item C:/" },
    resolveHostBindings: async () => host,
    ports: { cli: { spawn: async input => { request = input; return wire("ok", { deckId: "quarterly", revision: 2 }); } } },
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
  assert.throws(() => compileEffectTransportV1({
    contract: SLIDES_LIKE_CONTRACT,
    binding: SLIDES_LIKE_BINDING,
    modelInput: { title: { nested: "not-an-argv-scalar" } },
    resolveHostBindings: async () => { resolutions++; return host; },
    ports: { cli: { spawn: async () => wire("ok", {}) } },
  }), /template|scalar|model/i);
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
    const compiled = compileEffectTransportV1({ contract: SLACK_LIKE_CONTRACT, binding: SLACK_LIKE_BINDING, modelInput: { channel: "general", text: "hello" }, resolveHostBindings: async () => host, ports: { mcp: { inspectSchemas: slackSchemas, call: async () => response as never } } });
    await assert.rejects(() => compiled.adapter.dispatch(dispatchState(SLACK_LIKE_CONTRACT, compiled.effect)), /transport boundary failed/i);
  }
  assert.equal(getters, 0);

  let modelGetter = 0, resolverCalls = 0;
  const hostileModel = Object.defineProperty({ channel: "general" }, "text", { enumerable: true, get() { modelGetter++; return "hello"; } });
  assert.throws(() => compileEffectTransportV1({ contract: SLACK_LIKE_CONTRACT, binding: SLACK_LIKE_BINDING, modelInput: hostileModel, resolveHostBindings: async () => { resolverCalls++; return host; }, ports: {} }), /model|accessor|data/i);
  assert.equal(modelGetter, 0);
  assert.equal(resolverCalls, 0);
});

test("provider responses cross the asynchronous port boundary only as serialized inert data", async () => {
  let traps = 0;
  const forbiddenRootDto = new Proxy({ outcome: "ok", data: {} }, { get() { traps++; throw new Error("provider trap"); } });
  void forbiddenRootDto;
  const ports = {
    mcp: {
      inspectSchemas: async () => JSON.stringify({ serverSchemaDigest: SLACK_LIKE_BINDING.serverSchemaDigest, toolSchemaDigest: SLACK_LIKE_BINDING.toolSchemaDigest }),
      call: async () => JSON.stringify({ outcome: "ok", data: { messageId: "m-1", then: "inert-data" } }),
    },
  } as any;
  const compiled = compileEffectTransportV1({ contract: SLACK_LIKE_CONTRACT, binding: SLACK_LIKE_BINDING, modelInput: { channel: "general", text: "hello" }, resolveHostBindings: async () => host, ports });
  const result = await compiled.adapter.dispatch(dispatchState(SLACK_LIKE_CONTRACT, compiled.effect));
  assert.equal(result.kind, "acknowledged");
  assert.equal(traps, 0);
});

test("provider and host boundary failures are replaced without leaking secret-bearing content", async () => {
  const secret = host.credential;
  const providerFailure = compileEffectTransportV1({
    contract: CALENDAR_LIKE_CONTRACT,
    binding: CALENDAR_LIKE_BINDING,
    modelInput: { eventId: "event-9", title: "Review" },
    resolveHostBindings: async () => host,
    ports: { http: { call: async () => { throw new Error(`provider response included ${secret} and arbitrary-body`); } } },
  });
  await assert.rejects(() => providerFailure.adapter.dispatch(dispatchState(CALENDAR_LIKE_CONTRACT, providerFailure.effect)), error => {
    const rendered = String(error);
    assert.match(rendered, /effect transport boundary failed/i);
    assert.doesNotMatch(rendered, new RegExp(`${secret}|arbitrary-body`));
    return true;
  });

  const resolverFailure = compileEffectTransportV1({
    contract: SLACK_LIKE_CONTRACT,
    binding: SLACK_LIKE_BINDING,
    modelInput: { channel: "general", text: "hello" },
    resolveHostBindings: async () => { throw new Error(`vault failed for ${secret}`); },
    ports: {},
  });
  await assert.rejects(() => resolverFailure.adapter.dispatch(dispatchState(SLACK_LIKE_CONTRACT, resolverFailure.effect)), error => {
    const rendered = String(error);
    assert.match(rendered, /host binding resolution failed/i);
    assert.doesNotMatch(rendered, new RegExp(secret));
    return true;
  });

  const readbackFailure = compileEffectTransportV1({
    contract: CALENDAR_LIKE_CONTRACT,
    binding: CALENDAR_LIKE_BINDING,
    modelInput: { eventId: "event-9", title: "Review" },
    resolveHostBindings: async () => host,
    ports: { http: { call: async request => {
      if (request.method === "POST") return wire("unknown", null);
      throw new Error(`readback body included ${secret} and arbitrary-readback-body`);
    } } },
  });
  const dispatched = await readbackFailure.adapter.dispatch(dispatchState(CALENDAR_LIKE_CONTRACT, readbackFailure.effect));
  await assert.rejects(() => readbackFailure.adapter.reconcile!(dispatchState(CALENDAR_LIKE_CONTRACT, readbackFailure.effect), dispatched), error => {
    const rendered = String(error);
    assert.match(rendered, /effect transport boundary failed/i);
    assert.doesNotMatch(rendered, new RegExp(`${secret}|arbitrary-readback-body`));
    return true;
  });
});

test("MCP runtime schema digests are checked and passed before the consequential call", async () => {
  let inspections = 0, calls = 0, received: any;
  const compile = (toolSchemaDigest: string) => compileEffectTransportV1({
    contract: SLACK_LIKE_CONTRACT,
    binding: SLACK_LIKE_BINDING,
    modelInput: { channel: "general", text: "hello" },
    resolveHostBindings: async () => host,
    ports: {
      mcp: {
        inspectSchemas: async () => {
          inspections++;
          return JSON.stringify({ serverSchemaDigest: SLACK_LIKE_BINDING.serverSchemaDigest, toolSchemaDigest });
        },
        call: async (request: any) => {
          calls++;
          received = request;
          return JSON.stringify({ outcome: "ok", data: { messageId: "m-1" } });
        },
      },
    } as any,
  });
  const valid = compile(SLACK_LIKE_BINDING.toolSchemaDigest);
  await valid.adapter.dispatch(dispatchState(SLACK_LIKE_CONTRACT, valid.effect));
  assert.deepEqual({ inspections, calls }, { inspections: 1, calls: 1 });
  assert.equal(received.serverSchemaDigest, SLACK_LIKE_BINDING.serverSchemaDigest);
  assert.equal(received.toolSchemaDigest, SLACK_LIKE_BINDING.toolSchemaDigest);

  const drifted = compile(sha("f"));
  await assert.rejects(() => drifted.adapter.dispatch(dispatchState(SLACK_LIKE_CONTRACT, drifted.effect)), /MCP schema drift/i);
  assert.deepEqual({ inspections, calls }, { inspections: 2, calls: 1 });
});

test("MCP readback binds its own runtime tool schema digest before the call", async () => {
  const readbackToolDigest = sha("a");
  const binding = Object.freeze({
    ...SLACK_LIKE_BINDING,
    readback: Object.freeze({ operation: "message.get", tool: "get_message", toolSchemaDigest: readbackToolDigest }),
  });
  const contract: ToolEffectContractV1 = Object.freeze({
    ...SLACK_LIKE_CONTRACT,
    operationDigest: digestEffectTransportBindingV1(binding),
    readback: Object.freeze({ operation: "message.get", projection: Object.freeze(["/messageId"]) }),
    maximumEvidenceGrade: "partial",
  });
  const inspected: unknown[] = [], called: any[] = [];
  const compile = (driftReadback: boolean) => compileEffectTransportV1({
    contract,
    binding,
    modelInput: { channel: "general", text: "hello" },
    resolveHostBindings: async () => host,
    ports: { mcp: {
      inspectSchemas: async request => {
        inspected.push(request);
        const expected = request.tool === binding.tool ? binding.toolSchemaDigest : binding.readback.toolSchemaDigest;
        return JSON.stringify({ serverSchemaDigest: binding.serverSchemaDigest, toolSchemaDigest: driftReadback && request.tool === binding.readback.tool ? sha("f") : expected });
      },
      call: async request => {
        called.push(request);
        return request.tool === binding.tool ? wire("unknown", null) : wire("ok", { messageId: "m-1" });
      },
    } },
  });
  const valid = compile(false), validState = dispatchState(contract, valid.effect);
  const ambiguous = await valid.adapter.dispatch(validState);
  const matched = await valid.adapter.reconcile!(validState, ambiguous);
  assert.equal(matched.reconciliationStatus, "matched");
  assert.deepEqual(inspected, [{ server: binding.server, tool: binding.tool }, { server: binding.server, tool: binding.readback.tool }]);
  assert.deepEqual(called.map(request => ({ server: request.server, tool: request.tool, serverSchemaDigest: request.serverSchemaDigest, toolSchemaDigest: request.toolSchemaDigest })), [
    { server: binding.server, tool: binding.tool, serverSchemaDigest: binding.serverSchemaDigest, toolSchemaDigest: binding.toolSchemaDigest },
    { server: binding.server, tool: binding.readback.tool, serverSchemaDigest: binding.serverSchemaDigest, toolSchemaDigest: binding.readback.toolSchemaDigest },
  ]);

  const drifted = compile(true), driftedState = dispatchState(contract, drifted.effect);
  const secondAmbiguous = await drifted.adapter.dispatch(driftedState);
  await assert.rejects(() => drifted.adapter.reconcile!(driftedState, secondAmbiguous), /MCP schema drift/i);
  assert.equal(called.length, 3);
});

test("ambiguous writes use authoritative readback without resend and semantic conflicts are explicit", async () => {
  let sends = 0, reads = 0;
  const ports: EffectTransportPortsV1 = { http: { call: async request => request.method === "POST" ? (sends++, wire("unknown", null)) : (reads++, wire("conflict", { eventId: "event-9", state: "other" })) } };
  const compiled = compileEffectTransportV1({ contract: CALENDAR_LIKE_CONTRACT, binding: CALENDAR_LIKE_BINDING, modelInput: { eventId: "event-9", title: "Review" }, resolveHostBindings: async () => host, ports });
  const state = dispatchState(CALENDAR_LIKE_CONTRACT, compiled.effect);
  const ambiguous = await compiled.adapter.dispatch(state);
  assert.equal(ambiguous.kind, "ambiguous");
  const readback = await compiled.adapter.reconcile!(state, ambiguous);
  assert.equal(readback.reconciliationStatus, "conflict");
  assert.deepEqual({ sends, reads }, { sends: 1, reads: 1 });
});

test("a durable pending write resumes after restart through authoritative readback without resend", async () => {
  let sends = 0, reads = 0;
  const storage = durableStorage();
  const reservationId = "reservation-restart";
  const effectDigest = digestToolEffectContractV1(SLIDES_LIKE_CONTRACT);
  const mission: MissionClaimV1 = {
    v: "reelier.mission-claim/v1",
    missionId: "mission-restart",
    mandateDigest: sha("7"),
    promptDigest: sha("8"),
    contractDigests: [effectDigest],
    claimedAt: at(1_000),
  };
  const compile = () => compileEffectTransportV1({
    contract: SLIDES_LIKE_CONTRACT,
    binding: SLIDES_LIKE_BINDING,
    modelInput: { title: "Q3" },
    resolveHostBindings: async () => host,
    ports: {
      cli: {
        spawn: async request => request.argv[0] === "update"
          ? (sends++, wire("unknown", null))
          : (reads++, wire("ok", { deckId: "quarterly", revision: 2 })),
      },
    },
  });
  let compiled = compile();
  const state = dispatchState(SLIDES_LIKE_CONTRACT, compiled.effect) as any;
  state.reservation.reservationId = reservationId;
  const ledgerState: any = { ...state.reservation, intent: { ...state.reservation.intent } };
  const coordinator: any = {
    describe: () => ({ reservationId, state: ledgerState.state, effectDigest, allocationId: null }),
    dispatch: async () => {
      ledgerState.state = "dispatched";
      const result = await compiled.adapter.dispatch(state);
      ledgerState.state = result.kind === "ambiguous" ? "ambiguous" : "acknowledged";
      return result;
    },
    reconcile: async () => {
      const result = await compiled.adapter.reconcile!(state, { kind: "ambiguous", resultDigest: sha("9") });
      ledgerState.state = "reconciled";
      return result;
    },
    recover: async () => [],
    cancel: async () => { throw new Error("not used"); },
  };
  let now = 2_000;
  const kernel = createOutcomeKernel({ storage, coordinator, ledger: { getReservation: async () => ledgerState } as any, now: () => now, authorization: async () => "active" });
  await kernel.claimMission(mission);
  const first = await kernel.execute({ missionId: mission.missionId, effects: [{ contract: SLIDES_LIKE_CONTRACT, handle: createReservedDispatchHandle(state), verifier: compiled.verifier }] });
  assert.equal(first.effects[0]!.status, "pending");

  compiled = compile();
  now = 3_000;
  const resumed = await kernel.execute({ missionId: mission.missionId, effects: [{ contract: SLIDES_LIKE_CONTRACT, reservationId, verifier: compiled.verifier }] });
  assert.equal(resumed.effects[0]!.status, "verified");
  assert.deepEqual({ sends, reads }, { sends: 1, reads: 1 });
});

test("three unrelated adapters run through the unchanged Outcome kernel with honest grades", async () => {
  const cases = [
    { contract: SLACK_LIKE_CONTRACT, binding: SLACK_LIKE_BINDING, model: { channel: "general", text: "hello" }, ports: { mcp: { inspectSchemas: slackSchemas, call: async () => wire("ok", { messageId: "m-1" }) } }, status: "absent" },
    { contract: CALENDAR_LIKE_CONTRACT, binding: CALENDAR_LIKE_BINDING, model: { eventId: "event-9", title: "Review" }, ports: { http: { call: async () => wire("ok", { eventId: "event-9", state: "visible" }) } }, status: "partial" },
    { contract: SLIDES_LIKE_CONTRACT, binding: SLIDES_LIKE_BINDING, model: { title: "Q3" }, ports: { cli: { spawn: async () => wire("ok", { deckId: "quarterly", revision: 2 }) } }, status: "verified" },
  ] as const;
  for (let index = 0; index < cases.length; index++) {
    const item = cases[index], compiled = compileEffectTransportV1({ contract: item.contract, binding: item.binding, modelInput: item.model, resolveHostBindings: async () => host, ports: item.ports });
    const publishedReceipts: GovernedReceiptV1[] = [];
    const result = await runThroughKernel(item.contract, compiled, `reservation-${index}`, publishedReceipts);
    assert.equal(result.effects[0]!.status, item.status, item.contract.provider);
    assert.equal(publishedReceipts.length, 1);
    assert.doesNotMatch(JSON.stringify(publishedReceipts[0]), /credential-super-secret/);
  }
});

function dispatchState(contract: ToolEffectContractV1, effect: unknown) {
  const effectDigest = digestToolEffectContractV1(contract);
  return { reservation: { reservationId: "reservation-1", state: "reserved" as const, intent: { effectDigest, effectCanonicalBase64: "e30=" } }, effect, effectCanonicalBase64: "e30=", effectDigest };
}

async function runThroughKernel(contract: ToolEffectContractV1, compiled: ReturnType<typeof compileEffectTransportV1>, reservationId: string, publishedReceipts: GovernedReceiptV1[] = []) {
  const effectDigest = digestToolEffectContractV1(contract), state = dispatchState(contract, compiled.effect) as any;
  state.reservation.reservationId = reservationId;
  const handle = createReservedDispatchHandle(state), storage = durableStorage(publishedReceipts), mission: MissionClaimV1 = { v: "reelier.mission-claim/v1", missionId: `mission-${reservationId}`, mandateDigest: sha("7"), promptDigest: sha("8"), contractDigests: [effectDigest], claimedAt: at(1_000) };
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

function durableStorage(publishedReceipts: GovernedReceiptV1[] = []): OutcomeKernelStorage {
  const missions = new Map<string, MissionClaimV1>(), effects = new Map<string, StoredEffectLifecycleV1>(), receipts = new Map<string, { receiptId: string; receiptDigest: string; receiptRef: string }>();
  return {
    durable: true,
    async claimMission(claim) { const prior = missions.get(claim.missionId); if (prior) return digestMissionClaimV1(prior) === digestMissionClaimV1(claim) ? { status: "exact-existing", claim: prior } : { status: "conflict" }; missions.set(claim.missionId, claim); return { status: "claimed", claim }; },
    async loadMission(id) { return missions.get(id) ?? null; },
    async loadEffect(_missionId, id) { return effects.get(id) ?? null; },
    async storeEffect(value, revision) { const prior = effects.get(value.reservation.reservationId); if ((prior?.revision ?? 0) !== revision) return { status: "conflict" }; const stored = Object.freeze({ ...value, revision: revision + 1 }); effects.set(value.reservation.reservationId, stored); return { status: "stored", value: stored }; },
    async compareAndPublishReceipt(receipt: GovernedReceiptV1, receiptDigest: string) { publishedReceipts.push(receipt); const prior = receipts.get(receipt.receiptId); if (prior && prior.receiptDigest !== receiptDigest) return { status: "conflict" }; const head = prior ?? { receiptId: receipt.receiptId, receiptDigest, receiptRef: authorityDigest(receipt) }; receipts.set(receipt.receiptId, head); return { status: prior ? "exact-existing" : "published", receiptDigest: head.receiptDigest, receiptRef: head.receiptRef }; },
    async loadReceipt(id) { return receipts.get(id) ?? null; },
  };
}
