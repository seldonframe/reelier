import assert from "node:assert/strict";
import test from "node:test";
import * as effectTransports from "../../src/authority/host/effect-transports.js";
import { createReservedDispatchHandle } from "../../src/authority/gate.js";
import {
  compileEffectTransportV1 as compileEffectTransportWithHostKeyV1,
  compileGovernedEffectTransportV1,
  digestEffectTransportBindingV1,
  parseEffectTransportBindingV1,
  mintGovernedEffectTransportExecutorV1,
  type EffectTransportHostBindingsV1,
  type EffectTransportResultSinkV1,
  type TrustedEffectTransportExecutorCallbacksV1,
  type TrustedEffectTransportExecutorV1,
} from "../../src/authority/host/effect-transports.js";
import { consumeCoordinatorDispatchCallDelegateV1, createDispatchCoordinator, type CoordinatorDispatchCallV1 } from "../../src/authority/host/dispatch.js";
import { createOutcomeKernel, type OutcomeKernelStorage, type StoredEffectLifecycleV1 } from "../../src/authority/host/outcome-kernel.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import { digestGovernedOutcomeV1, digestMissionClaimV1, digestToolEffectContractV1, type GovernedReceiptV1, type MissionClaimV1, type ToolEffectContractV1 } from "../../src/authority/tool-effect-contract.js";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import { createDispatchCommitLease, preparedDispatchProjectionDigest } from "../../src/authority/host/prepared-dispatch.js";
import { CALENDAR_LIKE_BINDING, CALENDAR_LIKE_CONTRACT, SLACK_LIKE_BINDING, SLACK_LIKE_CONTRACT, SLIDES_LIKE_BINDING, SLIDES_LIKE_CONTRACT } from "./fixtures/tool-effect-contracts.js";

const sha = (digit: string): string => `sha256:${digit.repeat(64)}`;
const observationAuthKey = "0123456789abcdef".repeat(4);
const at = (milliseconds: number): string => new Date(milliseconds).toISOString();
const host: EffectTransportHostBindingsV1 = Object.freeze({ credential: "credential-super-secret", account: "account-1", destination: "destination-1", limit: "limit-1" });
const wire = (outcome: string, data: unknown): string => JSON.stringify({ outcome, data });
const succeed = (sink: EffectTransportResultSinkV1, outcome: string, data: unknown): void => sink.success(wire(outcome, data));
const slackSchemas = (_request: unknown, sink: EffectTransportResultSinkV1): void => sink.success(JSON.stringify({ serverSchemaDigest: SLACK_LIKE_BINDING.serverSchemaDigest, toolSchemaDigest: SLACK_LIKE_BINDING.toolSchemaDigest }));
type CompileEffectTransportInput = Omit<Parameters<typeof compileEffectTransportWithHostKeyV1>[0], "executor" | "observationAuthKey"> & {
  readonly executor?: TrustedEffectTransportExecutorV1;
  readonly ports?: TrustedEffectTransportExecutorCallbacksV1;
};
const compileEffectTransportV1 = (input: CompileEffectTransportInput, key = observationAuthKey) => {
  const { ports, ...rest } = input;
  return compileEffectTransportWithHostKeyV1({ ...rest, executor: rest.executor ?? mintTrustedExecutor(ports ?? {}), observationAuthKey: key } as Parameters<typeof compileEffectTransportWithHostKeyV1>[0]);
};

const mintTrustedExecutor = (callbacks: unknown): unknown =>
  (effectTransports as unknown as { mintTrustedEffectTransportExecutorV1(callbacks: unknown): unknown }).mintTrustedEffectTransportExecutorV1(callbacks);
const executorAuthority = (contract: ToolEffectContractV1, binding: unknown) => ({ contractDigest: digestToolEffectContractV1(contract), bindingDigest: digestEffectTransportBindingV1(binding), reservationId: "reservation-1" });

test("raw executor objects refuse before host binding resolution or provider execution", () => {
  let resolutions = 0, calls = 0;
  assert.throws(() => compileEffectTransportWithHostKeyV1({
    contract: CALENDAR_LIKE_CONTRACT,
    binding: CALENDAR_LIKE_BINDING,
    modelInput: { eventId: "event-9", title: "Review" },
    observationAuthKey,
    resolveHostBindings: async () => { resolutions++; return host; },
    executor: { http: { call: () => { calls++; } } },
  } as never), /trusted.*executor|minted.*capability/i);
  assert.deepEqual({ resolutions, calls }, { resolutions: 0, calls: 0 });
});

test("minting creates a blank opaque capability and trusted callback execution succeeds", async () => {
  let received: unknown;
  const executor = mintTrustedExecutor({
    http: { call: (request: unknown, sink: EffectTransportResultSinkV1): void => { received = request; succeed(sink, "ok", { eventId: "event-9", state: "accepted" }); } },
  });
  assert.deepEqual(Reflect.ownKeys(executor as object), []);
  assert.equal(Object.getPrototypeOf(executor), null);
  const compiled = compileEffectTransportWithHostKeyV1({
    contract: CALENDAR_LIKE_CONTRACT,
    binding: CALENDAR_LIKE_BINDING,
    modelInput: { eventId: "event-9", title: "Review" },
    observationAuthKey,
    resolveHostBindings: async () => host,
    executor,
  } as never);
  const outcome = await compiled.adapter.dispatch(dispatchState(CALENDAR_LIKE_CONTRACT, compiled.effect));
  assert.equal(outcome.kind, "acknowledged");
  assert.deepEqual(received, {
    method: "POST",
    url: "https://calendar.invalid/calendars/destination-1/events",
    body: { model: { eventId: "event-9", title: "Review" }, host: { account: "account-1", destination: "destination-1", limit: "limit-1" } },
    credential: "credential-super-secret",
    requestSchemaDigest: sha("3"),
    authority: executorAuthority(CALENDAR_LIKE_CONTRACT, CALENDAR_LIKE_BINDING),
  });
});

test("compiler passes exact internal contract binding and reservation authority to dispatch and readback", async () => {
  const calls: unknown[] = [];
  const compiled = compileEffectTransportV1({
    contract: CALENDAR_LIKE_CONTRACT,
    binding: CALENDAR_LIKE_BINDING,
    modelInput: { eventId: "event-9", title: "Review" },
    resolveHostBindings: async () => host,
    ports: { http: { call: (request, sink) => { calls.push(request); succeed(sink, "ok", { eventId: "event-9", state: "accepted" }); } } },
  });
  const state = dispatchState(CALENDAR_LIKE_CONTRACT, compiled.effect) as any;
  state.reservation = { ...state.reservation, intent: { ...state.reservation.intent, requestId: "incidental-legacy-request-id" } };
  const dispatched = await compiled.adapter.dispatch(state);
  await compiled.adapter.reconcile!(state, dispatched);
  const expectedAuthority = {
    contractDigest: digestToolEffectContractV1(CALENDAR_LIKE_CONTRACT),
    bindingDigest: digestEffectTransportBindingV1(CALENDAR_LIKE_BINDING),
    reservationId: state.reservation.reservationId,
  };
  assert.deepEqual((calls[0] as { authority?: unknown }).authority, expectedAuthority);
  assert.deepEqual((calls[1] as { authority?: unknown }).authority, expectedAuthority);
  assert.equal(Object.isFrozen((calls[0] as { authority: object }).authority), true);
});

test("a refused coordinator delegate bind stops before host resolution and provider execution", async () => {
  const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
  let reservation: any = { reservationId: "reservation-bind-collision", state: "reserved", intent: { effectDigest: digestToolEffectContractV1(SLACK_LIKE_CONTRACT) } };
  const ledger: any = {
    getReservation: async () => reservation,
    transition: async (reservationId: string, expected: string, event: { to: string; resultDigest?: string }) => {
      if (reservationId !== reservation.reservationId || reservation.state !== expected) return { ok: false, reason: "state-conflict" };
      reservation = { ...reservation, state: event.to, ...(event.resultDigest ? { resultDigest: event.resultDigest } : {}) };
      return { ok: true, status: "transitioned", reservation };
    },
    recover: async () => ({ ok: true, reservations: [reservation], highWaterMark: null, topology: { directorySync: "verified" } }),
  };
  let hostResolutions = 0, providerCalls = 0;
  let stateForReentry: ReturnType<typeof dispatchState> | undefined;
  let liveCall: CoordinatorDispatchCallV1 | undefined;
  let secondDispatch: Promise<Awaited<ReturnType<ReturnType<typeof compileEffectTransportV1>["adapter"]["dispatch"]>>> | undefined;
  const compiled = compileEffectTransportV1({
    contract: SLACK_LIKE_CONTRACT,
    binding: SLACK_LIKE_BINDING,
    modelInput: { channel: "general", text: "hello" },
    resolveHostBindings: async () => { hostResolutions++; return host; },
    ports: { mcp: {
      inspectSchemas: slackSchemas,
      call: (request, sink) => {
        providerCalls++;
        if (providerCalls === 1) {
          secondDispatch = compiled.adapter.dispatch(stateForReentry!, liveCall);
          const expected = { reservationId: stateForReentry!.reservation.reservationId, effectDigest: stateForReentry!.effectDigest };
          assert.equal(consumeCoordinatorDispatchCallDelegateV1(request.authority, expected), true);
          assert.equal(consumeCoordinatorDispatchCallDelegateV1(request.authority, expected), false);
        }
        succeed(sink, "ok", { messageId: `m-${providerCalls}` });
      },
    } },
  });
  const coordinator = createDispatchCoordinator(ledger, {
    dispatch: (state, call) => {
      stateForReentry = state as ReturnType<typeof dispatchState>;
      liveCall = call;
      return compiled.adapter.dispatch(state, call);
    },
  });
  const state = dispatchState(SLACK_LIKE_CONTRACT, compiled.effect) as any;
  state.reservation = reservation;
  try {
    const first = await coordinator.dispatch(createReservedDispatchHandle(state));
    const second = await secondDispatch!;
    assert.deepEqual(
      { first: first.kind, second: second.kind, hostResolutions, providerCalls },
      { first: "acknowledged", second: "definitive-failure", hostResolutions: 1, providerCalls: 1 },
    );
  } finally {
    restorePlatform();
  }
});

test("governed transport binds the original Path-C coordinator call before prepared host resolution", async () => {
  const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
  const pathEffect = { path: "joined" }, pathEffectDigest = authorityDigest(pathEffect);
  let hostResolutions = 0, providerCalls = 0, consumed = false, observedAuthority: unknown;
  const governedExecutor = mintGovernedEffectTransportExecutorV1({
    mcp: { inspectSchemas: slackSchemas, call: (request: any, sink: EffectTransportResultSinkV1) => { providerCalls++; observedAuthority = request.authority; consumed = consumeCoordinatorDispatchCallDelegateV1(request.authority, { reservationId: "governed-reservation", effectDigest: pathEffectDigest }); succeed(sink, "ok", { messageId: "m-governed" }); } },
  });
  const governedInput = {
    contract: SLACK_LIKE_CONTRACT, binding: SLACK_LIKE_BINDING, modelInput: { channel: "general", text: "hello" }, resolveHostBindings: async () => { hostResolutions++; return host; },
    observationAuthKey, executor: governedExecutor,
  } as const;
  assert.throws(() => compileEffectTransportWithHostKeyV1(governedInput as never), /trusted|governed|executor/i);
  assert.throws(() => compileGovernedEffectTransportV1({ ...governedInput, executor: mintTrustedExecutor({ mcp: { inspectSchemas: slackSchemas, call() {} } }) } as never), /trusted|governed|executor/i);
  const compiled = compileGovernedEffectTransportV1(governedInput);
  const requestDigest = authorityDigest({ v: "reelier.governed-effect-transport-request/v1", contractDigest: digestToolEffectContractV1(SLACK_LIKE_CONTRACT), bindingDigest: digestEffectTransportBindingV1(SLACK_LIKE_BINDING), model: { channel: "general", text: "hello" }, account: host.account, destination: host.destination, limit: host.limit });
  const projection = { v: "reelier.prepared-effect-projection/v1" as const, transport: "mcp", operationDigest: digestEffectTransportBindingV1(SLACK_LIKE_BINDING), requestDigest };
  const expectedMaterializedRequestDigest = preparedDispatchProjectionDigest(projection);
  let reservation: any = { reservationId: "governed-reservation", state: "reserved", intent: { tenant: "tenant", requestId: "authenticated-effect-request", requestDigest: sha("1"), capabilityDigest: sha("2"), effectDigest: pathEffectDigest, effectCanonicalBase64: authorityCanonicalBytes(pathEffect).toString("base64"), executionContext: { allocationId: "allocation-1" }, routeAuthority: { v: "reelier.route-authority-snapshot/v1", connectorRegistrationDigest: sha("3"), operatorConfigurationDigest: sha("4"), routeDigest: sha("5"), providerId: "provider", connectorId: "connector", accountId: "account", providerAccountIdentity: "identity", endpointId: "endpoint", credentialSlotId: "slot", slotInstanceId: "instance", slotVersion: "version", authenticatedProviderIdentityDigest: sha("6"), sourceReadRouteDigest: sha("7"), projectionSchemaDigest: sha("8"), expectedMaterializedRequestDigest, authorityGeneration: "generation-1", authorityExpiresAt: "2099-01-01T00:00:00.000Z" } }, limitAssignments: [], sequence: 0, updatedAt: "2026-08-21T00:00:00.000Z" };
  const state: any = { reservation, effect: pathEffect, effectDigest: pathEffectDigest, effectCanonicalBase64: authorityCanonicalBytes(pathEffect).toString("base64") };
  const ledger: any = {
    async getReservation() { return reservation; },
    async commitPreparedDispatch(input: any) {
      reservation = { ...reservation, state: "dispatched", sendStarted: true, sequence: reservation.sequence + 1 };
      return createDispatchCommitLease({ reservationId: input.reservationId, allocationId: input.allocationId, preparedDigest: input.preparedDescription.materializedRequestDigest, authorityGeneration: input.expectedAuthorityGeneration, authorityExpiresAt: input.preparedDescription.authorityExpiresAt, absoluteDeadlineMs: input.absoluteDeadlineMs, commitGeneration: "commit-1" });
    },
    async transition(_id: string, expected: string, event: any) { if (reservation.state !== expected) return { ok: false, reason: "state-conflict" }; reservation = { ...reservation, ...event, state: event.to, sequence: reservation.sequence + 1 }; return { ok: true, status: "transitioned", reservation }; },
    async recover() { return { ok: true, reservations: [reservation], highWaterMark: null, topology: { directorySync: "verified" } }; },
  };
  try {
    const coordinator = createDispatchCoordinator(ledger, { async dispatch(current) { return { kind: "definitive-failure", resultDigest: current.effectDigest }; }, async prepare(current, call) { return compiled.prepareGoverned(current, call!); } });
    const outcome = await coordinator.dispatch(createReservedDispatchHandle(state));
    assert.deepEqual({ kind: outcome.kind, hostResolutions, providerCalls, consumed }, { kind: "acknowledged", hostResolutions: 1, providerCalls: 1, consumed: true });
    assert.deepEqual(observedAuthority, { contractDigest: digestToolEffectContractV1(SLACK_LIKE_CONTRACT), bindingDigest: digestEffectTransportBindingV1(SLACK_LIKE_BINDING), reservationId: "governed-reservation", requestId: "authenticated-effect-request", governedEffectDigest: pathEffectDigest });
  } finally { restorePlatform(); }
});

test("trusted executor minting rejects functions, accessors, and proxies without executing traps", () => {
  let traps = 0;
  const accessor = Object.defineProperty(Object.create(null), "http", { enumerable: true, get() { traps++; return { call() {} }; } });
  const proxy = new Proxy(Object.create(null), { get() { traps++; throw new Error("executor trap"); }, ownKeys() { traps++; throw new Error("executor trap"); } });
  const callbackProxy = new Proxy(() => undefined, { get() { traps++; throw new Error("callback trap"); }, apply() { traps++; throw new Error("callback trap"); } });
  for (const invalid of [() => undefined, accessor, proxy, { http: { call: callbackProxy } }]) {
    assert.throws(() => mintTrustedExecutor(invalid), /trusted.*executor|callback|closed|data/i);
  }
  assert.equal(traps, 0);
});

test("Promise-returning executors are unsupported without inspecting constructor or species", async () => {
  let traps = 0;
  const returned = Promise.resolve();
  Object.defineProperty(returned, "constructor", { get() { traps++; throw new Error("species trap"); } });
  const executor = mintTrustedExecutor({ http: { call: (): void => returned as never } });
  const compiled = compileEffectTransportWithHostKeyV1({
    contract: CALENDAR_LIKE_CONTRACT,
    binding: CALENDAR_LIKE_BINDING,
    modelInput: { eventId: "event-9", title: "Review" },
    observationAuthKey,
    resolveHostBindings: async () => host,
    executor,
  } as never);
  await assert.rejects(() => compiled.adapter.dispatch(dispatchState(CALENDAR_LIKE_CONTRACT, compiled.effect)), /callback.*undefined|transport boundary failed/i);
  assert.equal(traps, 0);
});

test("MCP compilation closes model input before host injection and omits credentials from evidence", async () => {
  let resolved = 0;
  let received: unknown;
  const compiled = compileEffectTransportV1({
    contract: SLACK_LIKE_CONTRACT,
    binding: SLACK_LIKE_BINDING,
    modelInput: { channel: "general", text: "hello" },
    resolveHostBindings: async refs => { resolved++; assert.deepEqual(refs, SLACK_LIKE_CONTRACT.bindings); return host; },
    ports: { mcp: { inspectSchemas: slackSchemas, call: (request, sink) => { received = request; succeed(sink, "ok", { messageId: "m-1" }); } } },
  });
  assert.equal(resolved, 0);
  const outcome = await compiled.adapter.dispatch(dispatchState(SLACK_LIKE_CONTRACT, compiled.effect));
  assert.equal(resolved, 1);
  assert.deepEqual(received, {
    server: "hermetic-slack", tool: "send_message", serverSchemaDigest: sha("1"), toolSchemaDigest: sha("2"),
    arguments: { model: { channel: "general", text: "hello" }, host: { account: "account-1", destination: "destination-1", limit: "limit-1" } },
    credential: "credential-super-secret",
    authority: executorAuthority(SLACK_LIKE_CONTRACT, SLACK_LIKE_BINDING),
  });
  assert.equal(outcome.kind, "acknowledged");
  assert.doesNotMatch(JSON.stringify({ effect: compiled.effect, evidence: compiled.evidence, outcome }), /credential-super-secret/);
  assert.doesNotMatch(JSON.stringify({ effect: compiled.effect, evidence: compiled.evidence, outcome }), new RegExp(observationAuthKey));

  for (const invalid of [{ channel: "general", text: "hello", tenant: "model-owned" }, { channel: "general" }]) {
    let touchedHost = 0;
    assert.throws(() => compileEffectTransportV1({ contract: SLACK_LIKE_CONTRACT, binding: SLACK_LIKE_BINDING, modelInput: invalid, resolveHostBindings: async () => { touchedHost++; return host; }, ports: {} }), /model|field|closed/i);
    assert.equal(touchedHost, 0);
  }
});

test("observation authentication keys are exact inert host-only 256-bit values", () => {
  const base = {
    contract: SLACK_LIKE_CONTRACT,
    binding: SLACK_LIKE_BINDING,
    modelInput: { channel: "general", text: "hello" },
    resolveHostBindings: async () => host,
    executor: mintTrustedExecutor({}) as TrustedEffectTransportExecutorV1,
  };
  for (const invalid of ["", "a".repeat(63), "a".repeat(65), "A".repeat(64)]) {
    assert.throws(() => compileEffectTransportWithHostKeyV1({ ...base, observationAuthKey: invalid }), /authentication key|256 bits/i);
  }
  let traps = 0;
  const hostileKey = new Proxy(Object.create(null), { get: () => { traps++; throw new Error("key trap"); } });
  assert.throws(() => compileEffectTransportWithHostKeyV1({ ...base, observationAuthKey: hostileKey as never }), /authentication key|256 bits/i);
  assert.equal(traps, 0);
});

test("reviewed HTTP compilation binds method, origin, path, schemas, and response projection", async () => {
  const calls: unknown[] = [];
  const ports: TrustedEffectTransportExecutorCallbacksV1 = { http: { call: (request, sink) => { calls.push(request); succeed(sink, "ok", calls.length === 1 ? { eventId: "event-9", state: "accepted", ignored: "outside projection" } : { eventId: "event-9", state: "visible", ignored: "outside projection" }); } } };
  const compiled = compileEffectTransportV1({ contract: CALENDAR_LIKE_CONTRACT, binding: CALENDAR_LIKE_BINDING, modelInput: { eventId: "event-9", title: "Review" }, resolveHostBindings: async () => host, ports });
  const dispatched = await compiled.adapter.dispatch(dispatchState(CALENDAR_LIKE_CONTRACT, compiled.effect));
  const reconciled = await compiled.adapter.reconcile!(dispatchState(CALENDAR_LIKE_CONTRACT, compiled.effect), dispatched);
  assert.deepEqual(calls, [
    { method: "POST", url: "https://calendar.invalid/calendars/destination-1/events", body: { model: { eventId: "event-9", title: "Review" }, host: { account: "account-1", destination: "destination-1", limit: "limit-1" } }, credential: "credential-super-secret", requestSchemaDigest: sha("3"), authority: executorAuthority(CALENDAR_LIKE_CONTRACT, CALENDAR_LIKE_BINDING) },
    { method: "GET", url: "https://calendar.invalid/calendars/destination-1/events/event-9", body: null, credential: "credential-super-secret", requestSchemaDigest: sha("4"), authority: executorAuthority(CALENDAR_LIKE_CONTRACT, CALENDAR_LIKE_BINDING) },
  ]);
  assert.equal(reconciled.reconciliationStatus, "matched");
  assert.equal(reconciled.normalizedProjectionDigest, "sha256:88d35e15a1e20a2daac2ffce572cb49b65fe8519ce5c24b35c9f54773df5eb6c");

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
      ports: { http: { call: (request, sink) => request.method === "POST" ? succeed(sink, "unknown", null) : (readbackCalls++, succeed(sink, "ok", { eventId: maliciousId, state: "visible" })) } },
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
    ports: { cli: { spawn: (input, sink) => { request = input; succeed(sink, "ok", { deckId: "quarterly", revision: 2 }); } } },
  });
  await compiled.adapter.dispatch(dispatchState(SLIDES_LIKE_CONTRACT, compiled.effect));
  assert.deepEqual(request, {
    executable: "C:/reviewed/bin/slides-tool.exe",
    argv: ["update", "--deck", "destination-1", "--title", "Q3; Remove-Item C:/"],
    env: { SLIDES_TOKEN: "credential-super-secret" },
    authority: executorAuthority(SLIDES_LIKE_CONTRACT, SLIDES_LIKE_BINDING),
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
    ports: { cli: { spawn: (_request, sink) => succeed(sink, "ok", {}) } },
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
    const compiled = compileEffectTransportV1({ contract: SLACK_LIKE_CONTRACT, binding: SLACK_LIKE_BINDING, modelInput: { channel: "general", text: "hello" }, resolveHostBindings: async () => host, ports: { mcp: { inspectSchemas: slackSchemas, call: (_request, sink) => sink.success(response as never) } } });
    await assert.rejects(() => compiled.adapter.dispatch(dispatchState(SLACK_LIKE_CONTRACT, compiled.effect)), /transport boundary failed/i);
  }
  assert.equal(getters, 0);

  let modelGetter = 0, resolverCalls = 0;
  const hostileModel = Object.defineProperty({ channel: "general" }, "text", { enumerable: true, get() { modelGetter++; return "hello"; } });
  assert.throws(() => compileEffectTransportV1({ contract: SLACK_LIKE_CONTRACT, binding: SLACK_LIKE_BINDING, modelInput: hostileModel, resolveHostBindings: async () => { resolverCalls++; return host; }, ports: {} }), /model|accessor|data/i);
  assert.equal(modelGetter, 0);
  assert.equal(resolverCalls, 0);
});

test("a non-undefined callback return refuses without inspecting the returned root", async () => {
  let calls = 0, traps = 0;
  const returnedRoot = new Proxy(Object.create(null), { get() { traps++; throw new Error("provider trap"); } });
  const ports = {
    mcp: {
      inspectSchemas: slackSchemas,
      call: (_request: unknown, sink: EffectTransportResultSinkV1) => { calls++; queueMicrotask(() => sink.failure()); return returnedRoot; },
    },
  } as any;
  const compiled = compileEffectTransportV1({ contract: SLACK_LIKE_CONTRACT, binding: SLACK_LIKE_BINDING, modelInput: { channel: "general", text: "hello" }, resolveHostBindings: async () => host, ports });
  await assert.rejects(() => compiled.adapter.dispatch(dispatchState(SLACK_LIKE_CONTRACT, compiled.effect)), /effect transport boundary failed/i);
  assert.equal(calls, 1);
  assert.equal(traps, 0);
});

test("the first serialized sink settlement wins over double and late callbacks", async () => {
  const compiled = compileEffectTransportV1({
    contract: CALENDAR_LIKE_CONTRACT,
    binding: CALENDAR_LIKE_BINDING,
    modelInput: { eventId: "event-9", title: "Review" },
    resolveHostBindings: async () => host,
    ports: { http: { call: (_request, sink) => {
      succeed(sink, "ok", { eventId: "event-9", state: "accepted" });
      sink.failure();
      queueMicrotask(() => sink.success(new Proxy(Object.create(null), { get() { throw new Error("late trap"); } }) as never));
    } } },
  });
  const outcome = await compiled.adapter.dispatch(dispatchState(CALENDAR_LIKE_CONTRACT, compiled.effect));
  assert.equal(outcome.kind, "acknowledged");
  await new Promise<void>(resolve => setImmediate(resolve));
});

test("provider and host boundary failures are replaced without leaking secret-bearing content", async () => {
  const secret = host.credential;
  const providerFailure = compileEffectTransportV1({
    contract: CALENDAR_LIKE_CONTRACT,
    binding: CALENDAR_LIKE_BINDING,
    modelInput: { eventId: "event-9", title: "Review" },
    resolveHostBindings: async () => host,
    ports: { http: { call: () => { throw new Error(`provider response included ${secret} and arbitrary-body`); } } },
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
    ports: { http: { call: (request, sink) => {
      if (request.method === "POST") return succeed(sink, "unknown", null);
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
        inspectSchemas: (_request: unknown, sink: EffectTransportResultSinkV1) => {
          inspections++;
          sink.success(JSON.stringify({ serverSchemaDigest: SLACK_LIKE_BINDING.serverSchemaDigest, toolSchemaDigest }));
        },
        call: (request: any, sink: EffectTransportResultSinkV1) => {
          calls++;
          received = request;
          succeed(sink, "ok", { messageId: "m-1" });
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
      inspectSchemas: (request, sink) => {
        inspected.push(request);
        const expected = request.tool === binding.tool ? binding.toolSchemaDigest : binding.readback.toolSchemaDigest;
        sink.success(JSON.stringify({ serverSchemaDigest: binding.serverSchemaDigest, toolSchemaDigest: driftReadback && request.tool === binding.readback.tool ? sha("f") : expected }));
      },
      call: (request, sink) => {
        called.push(request);
        request.tool === binding.tool ? succeed(sink, "unknown", null) : succeed(sink, "ok", { messageId: "m-1" });
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
  const ports: TrustedEffectTransportExecutorCallbacksV1 = { http: { call: (request, sink) => request.method === "POST" ? (sends++, succeed(sink, "unknown", null)) : (reads++, succeed(sink, "conflict", { eventId: "event-9", state: "other" })) } };
  const compiled = compileEffectTransportV1({ contract: CALENDAR_LIKE_CONTRACT, binding: CALENDAR_LIKE_BINDING, modelInput: { eventId: "event-9", title: "Review" }, resolveHostBindings: async () => host, ports });
  const state = dispatchState(CALENDAR_LIKE_CONTRACT, compiled.effect);
  const ambiguous = await compiled.adapter.dispatch(state);
  assert.equal(ambiguous.kind, "ambiguous");
  const readback = await compiled.adapter.reconcile!(state, ambiguous);
  assert.equal(readback.reconciliationStatus, "conflict");
  assert.deepEqual({ sends, reads }, { sends: 1, reads: 1 });
});

test("same-schema contradictory readback values produce distinct projection commitments in receipts", async () => {
  const execute = async (stateValue: string) => {
    const receipts: GovernedReceiptV1[] = [];
    const compiled = compileEffectTransportV1({
      contract: CALENDAR_LIKE_CONTRACT,
      binding: CALENDAR_LIKE_BINDING,
      modelInput: { eventId: "event-9", title: "Review" },
      resolveHostBindings: async () => host,
      ports: { http: { call: (request, sink) => request.method === "POST" ? succeed(sink, "ok", { eventId: "event-9", state: "accepted" }) : succeed(sink, "ok", { eventId: "event-9", state: stateValue }) } },
    });
    const result = await runThroughKernel(CALENDAR_LIKE_CONTRACT, compiled, "reservation-contradictory", receipts);
    return { outcome: result.effects[0]!, receipt: receipts[0]! };
  };
  const visible = await execute("visible"), deleted = await execute("deleted");
  const visibleCommitment = visible.outcome.observation!.projectionDigest;
  const deletedCommitment = deleted.outcome.observation!.projectionDigest;
  assert.notEqual(visibleCommitment, deletedCommitment);
  assert.equal(visibleCommitment, "sha256:88d35e15a1e20a2daac2ffce572cb49b1933f744b4bae79a9a49e639b523c20b");
  assert.equal(visible.receipt.outcomeDigest, digestGovernedOutcomeV1(visible.outcome));
  assert.equal(deleted.receipt.outcomeDigest, digestGovernedOutcomeV1(deleted.outcome));
  assert.notEqual(visible.receipt.outcomeDigest, deleted.receipt.outcomeDigest);
});

test("forged matched projection evidence has no adapter provenance and never reaches a provider port", async () => {
  let portCalls = 0;
  const compiled = compileEffectTransportV1({
    contract: SLIDES_LIKE_CONTRACT,
    binding: SLIDES_LIKE_BINDING,
    modelInput: { title: "Q3" },
    resolveHostBindings: async () => host,
    ports: { cli: { spawn: () => { portCalls++; throw new Error("provider must stay unreachable"); } } },
  });
  const forged = Object.freeze({
    ...compiled,
    adapter: Object.freeze({
      async dispatch() {
        return Object.freeze({ kind: "acknowledged" as const, resultDigest: sha("b"), reconciliationStatus: "matched" as const, normalizedProjectionDigest: sha("a") });
      },
    }),
  });
  const result = await runThroughKernel(SLIDES_LIKE_CONTRACT, forged, "reservation-forged");
  assert.equal(result.effects[0]!.status, "partial");
  assert.equal(portCalls, 0);
});

test("projection provenance survives recompilation with the same host key and refuses a different key", async () => {
  const reservationId = "reservation-key-restart";
  const producer = compileEffectTransportV1({
    contract: SLIDES_LIKE_CONTRACT,
    binding: SLIDES_LIKE_BINDING,
    modelInput: { title: "Q3" },
    resolveHostBindings: async () => host,
    ports: { cli: { spawn: (_request, sink) => succeed(sink, "ok", { deckId: "quarterly", revision: 2 }) } },
  });
  const state = dispatchState(SLIDES_LIKE_CONTRACT, producer.effect) as any;
  state.reservation.reservationId = reservationId;
  const authenticated = await producer.adapter.reconcile!(state, { kind: "ambiguous", resultDigest: sha("9") });

  const evaluate = async (key: string) => {
    let portCalls = 0;
    const restarted = compileEffectTransportV1({
      contract: SLIDES_LIKE_CONTRACT,
      binding: SLIDES_LIKE_BINDING,
      modelInput: { title: "Q3" },
      resolveHostBindings: async () => host,
      ports: { cli: { spawn: () => { portCalls++; throw new Error("restart verifier must not call provider"); } } },
    }, key);
    const replay = Object.freeze({ ...restarted, adapter: Object.freeze({ async dispatch() { return authenticated; } }) });
    const result = await runThroughKernel(SLIDES_LIKE_CONTRACT, replay, reservationId);
    assert.equal(portCalls, 0);
    return result.effects[0]!.status;
  };

  assert.equal(await evaluate(observationAuthKey), "verified");
  assert.equal(await evaluate("fedcba9876543210".repeat(4)), "partial");
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
        spawn: (request, sink) => request.argv[0] === "update"
          ? (sends++, succeed(sink, "unknown", null))
          : (reads++, succeed(sink, "ok", { deckId: "quarterly", revision: 2 })),
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
  let kernel = createOutcomeKernel({ storage, coordinator, ledger: { getReservation: async () => ledgerState } as any, now: () => now, authorization: async () => "active" });
  await kernel.claimMission(mission);
  const first = await kernel.execute({ missionId: mission.missionId, effects: [{ contract: SLIDES_LIKE_CONTRACT, handle: createReservedDispatchHandle(state), verifier: compiled.verifier }] });
  assert.equal(first.effects[0]!.status, "pending");

  compiled = compile();
  now = 3_000;
  kernel = createOutcomeKernel({ storage, coordinator, ledger: { getReservation: async () => ledgerState } as any, now: () => now, authorization: async () => "active" });
  const resumed = await kernel.execute({ missionId: mission.missionId, effects: [{ contract: SLIDES_LIKE_CONTRACT, reservationId, verifier: compiled.verifier }] });
  assert.equal(resumed.effects[0]!.status, "verified");
  assert.deepEqual({ sends, reads }, { sends: 1, reads: 1 });
});

test("three unrelated adapters run through the same generic Outcome kernel with honest grades", async () => {
  const cases = [
    { contract: SLACK_LIKE_CONTRACT, binding: SLACK_LIKE_BINDING, model: { channel: "general", text: "hello" }, ports: { mcp: { inspectSchemas: slackSchemas, call: (_request: unknown, sink: EffectTransportResultSinkV1) => succeed(sink, "ok", { messageId: "m-1" }) } }, status: "absent" },
    { contract: CALENDAR_LIKE_CONTRACT, binding: CALENDAR_LIKE_BINDING, model: { eventId: "event-9", title: "Review" }, ports: { http: { call: (_request: unknown, sink: EffectTransportResultSinkV1) => succeed(sink, "ok", { eventId: "event-9", state: "visible" }) } }, status: "partial" },
    { contract: SLIDES_LIKE_CONTRACT, binding: SLIDES_LIKE_BINDING, model: { title: "Q3" }, ports: { cli: { spawn: (_request: unknown, sink: EffectTransportResultSinkV1) => succeed(sink, "ok", { deckId: "quarterly", revision: 2 }) } }, status: "verified" },
  ] as const;
  for (let index = 0; index < cases.length; index++) {
    const item = cases[index], compiled = compileEffectTransportV1({ contract: item.contract, binding: item.binding, modelInput: item.model, resolveHostBindings: async () => host, ports: item.ports });
    const publishedReceipts: GovernedReceiptV1[] = [];
    const result = await runThroughKernel(item.contract, compiled, `reservation-${index}`, publishedReceipts);
    assert.equal(result.effects[0]!.status, item.status, item.contract.provider);
    assert.equal(publishedReceipts.length, 1);
    assert.doesNotMatch(JSON.stringify(publishedReceipts[0]), /credential-super-secret/);
    assert.doesNotMatch(JSON.stringify(publishedReceipts[0]), new RegExp(observationAuthKey));
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
