import test from "node:test";
import assert from "node:assert/strict";
import { authorityDigest } from "../../src/authority/wire.js";
import {
  createDispatchCommitLease,
  createPreparedDispatch,
  consumePreparedDispatch,
  type MaterializedHttpRequestProjectionV1,
} from "../../src/authority/host/prepared-dispatch.js";
import { createDispatchCoordinator } from "../../src/authority/host/dispatch.js";
import { createReservedDispatchHandle } from "../../src/authority/gate.js";
import { prepareJsonHttpsEffect } from "../../src/authority/drivers/json-https.js";
import { createHttpResponseSemanticsProfileRegistry, parseHttpResponseSemanticsProfileV1 } from "../../src/authority/host/http-response-semantics.js";
import { createJsonHttpsDispatchAdapter } from "../../src/authority/host/json-https-connector.js";
import { jsonHttpsRouteDigest } from "../../src/authority/host/json-https-route.js";
import { profileGovernanceFixture } from "./profile-governance-fixture.js";

const digest = (value: unknown) => authorityDigest(value);
const projection: MaterializedHttpRequestProjectionV1 = Object.freeze({
  v: "reelier.materialized-http-request/v1",
  method: "PUT",
  origin: "https://api.github.com",
  normalizedPath: "/repos/fixlyai/reelier/issues/1/labels",
  normalizedQuery: "",
  reviewedHeaders: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
  bodyDigest: digest("body"),
});

test("prepared dispatch joint consumption sends once and refuses a second consume", async () => {
  profileGovernanceFixture();
  const events: string[] = [];
  const prepared = createPreparedDispatch({
    description: {
      v: "reelier.prepared-dispatch-description/v1",
      routeDigest: digest("route"),
      materializedRequestDigest: digest(projection),
      projection,
      authorityGeneration: "generation-1",
      authorityExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      absoluteDeadlineMs: performance.now() + 60_000,
      reservationId: "reservation-1",
      allocationId: "allocation-1",
    },
    send: async () => { events.push("send"); return { kind: "acknowledged", resultDigest: digest("result") }; },
  });
  const lease = createDispatchCommitLease({
    reservationId: "reservation-1", allocationId: "allocation-1", preparedDigest: prepared.description.materializedRequestDigest,
    authorityGeneration: "generation-1", authorityExpiresAt: prepared.description.authorityExpiresAt,
    absoluteDeadlineMs: prepared.description.absoluteDeadlineMs,
    commitGeneration: "commit-1",
  });
  assert.equal(JSON.stringify(prepared), "{}", "prepared capability must not serialize its request projection");
  const out = await consumePreparedDispatch(prepared, lease);
  assert.equal(out.kind, "acknowledged");
  assert.deepEqual(events, ["send"]);
  await assert.rejects(() => consumePreparedDispatch(prepared, lease), /consumed|invalid/i);
});

test("prepared dispatch rejects mismatched commit lease before send", async () => {
  let sends = 0;
  const prepared = createPreparedDispatch({
    description: {
      v: "reelier.prepared-dispatch-description/v1", routeDigest: digest("route"), materializedRequestDigest: digest(projection), projection,
      authorityGeneration: "generation-1", authorityExpiresAt: new Date(Date.now() + 60_000).toISOString(), absoluteDeadlineMs: performance.now() + 60_000,
      reservationId: "reservation-1", allocationId: "allocation-1",
    },
    send: async () => { sends++; return { kind: "acknowledged", resultDigest: digest("result") }; },
  });
  const lease = createDispatchCommitLease({ reservationId: "different", allocationId: "allocation-1", preparedDigest: prepared.description.materializedRequestDigest,
    authorityGeneration: "generation-1", authorityExpiresAt: prepared.description.authorityExpiresAt, absoluteDeadlineMs: prepared.description.absoluteDeadlineMs, commitGeneration: "commit-1" });
  await assert.rejects(() => consumePreparedDispatch(prepared, lease), /binding|reservation/i);
  assert.equal(sends, 0);
});

test("concurrent joint consumption claims both capabilities before either send", async () => {
  let sends = 0;
  const prepared = createPreparedDispatch({
    description: { v: "reelier.prepared-dispatch-description/v1", routeDigest: digest("route"), materializedRequestDigest: digest(projection), projection, authorityGeneration: "generation-1", authorityExpiresAt: new Date(Date.now() + 60_000).toISOString(), absoluteDeadlineMs: performance.now() + 60_000, reservationId: "reservation-1", allocationId: "allocation-1" },
    send: async () => { sends++; await new Promise(resolve => setTimeout(resolve, 1)); return { kind: "acknowledged", resultDigest: digest("result") }; },
  });
  const lease = createDispatchCommitLease({ reservationId: "reservation-1", allocationId: "allocation-1", preparedDigest: prepared.description.materializedRequestDigest, authorityGeneration: "generation-1", authorityExpiresAt: prepared.description.authorityExpiresAt, absoluteDeadlineMs: prepared.description.absoluteDeadlineMs, commitGeneration: "commit-1" });
  const results = await Promise.allSettled([consumePreparedDispatch(prepared, lease), consumePreparedDispatch(prepared, lease)]);
  assert.equal(sends, 1);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
});

test("injected clocks refuse stale authority and expired monotonic deadline before send", async () => {
  let sends = 0;
  const prepared = createPreparedDispatch({
    description: { v: "reelier.prepared-dispatch-description/v1", routeDigest: digest("route"), materializedRequestDigest: digest(projection), projection, authorityGeneration: "generation-1", authorityExpiresAt: new Date(1_000).toISOString(), absoluteDeadlineMs: 50, reservationId: "reservation-1", allocationId: "allocation-1" },
    send: async () => { sends++; return { kind: "acknowledged", resultDigest: digest("result") }; },
    wallClockNow: () => 2_000,
    monotonicNow: () => 100,
  } as never);
  const lease = createDispatchCommitLease({ reservationId: "reservation-1", allocationId: "allocation-1", preparedDigest: prepared.description.materializedRequestDigest, authorityGeneration: "generation-1", authorityExpiresAt: prepared.description.authorityExpiresAt, absoluteDeadlineMs: prepared.description.absoluteDeadlineMs, commitGeneration: "commit-1" });
  await assert.rejects(() => consumePreparedDispatch(prepared, lease), /expired/i);
  assert.equal(sends, 0);
});

test("native route digest binds every canonical route authority field", async () => {
  const route = { v: "reelier.json-https-route/v1" as const, providerId: "github", connectorId: "github", accountId: "acct", providerAccountIdentity: "github:acct", endpointId: "write", origin: "https://api.github.com", allowedMethods: ["PUT" as const], allowedPathPrefixes: ["/repos"], credentialSlotId: "slot", responseSemanticsProfileId: "profile-a", reconciliationRecipeId: "recipe", readEndpointId: "read", egressPolicyDigest: digest("egress"), projectionSchemaDigest: digest("projection") };
  const changed = { ...route, responseSemanticsProfileId: "profile-b" };
  const secrets = { async resolve() { return "unused"; }, async acquireSlot() { return { readOnce: () => "secret" }; } };
  const effect = { endpointId: "write", method: "PUT" as const, path: "/repos/a", query: "", headers: {}, bodyBase64: Buffer.from("{}").toString("base64") };
  const responseSemanticsProfiles = createHttpResponseSemanticsProfileRegistry([
    { v: "reelier.http-response-semantics/v1", profileId: "profile-a", acknowledgedStatuses: [200] },
    { v: "reelier.http-response-semantics/v1", profileId: "profile-b", acknowledgedStatuses: [200] },
  ]);
  const first = await prepareJsonHttpsEffect(effect as never, route, secrets, { responseSemanticsProfiles, reservationId: "r", allocationId: "a", authorityGeneration: "g", authorityExpiresAt: new Date(Date.now() + 60_000).toISOString() });
  const second = await prepareJsonHttpsEffect(effect as never, changed, secrets, { responseSemanticsProfiles, reservationId: "r", allocationId: "a", authorityGeneration: "g", authorityExpiresAt: new Date(Date.now() + 60_000).toISOString() });
  assert.notEqual(first.description.routeDigest, second.description.routeDigest);
});

test("native preparation rejects an unknown response profile before slot acquisition", async () => {
  const route = { v: "reelier.json-https-route/v1" as const, providerId: "github", connectorId: "github", accountId: "acct", providerAccountIdentity: "github:acct", endpointId: "write", origin: "https://api.github.com", allowedMethods: ["PUT" as const], allowedPathPrefixes: ["/repos"], credentialSlotId: "slot", responseSemanticsProfileId: "unreviewed", reconciliationRecipeId: "recipe", readEndpointId: "read", egressPolicyDigest: digest("egress"), projectionSchemaDigest: digest("projection") };
  const effect = { endpointId: "write", method: "PUT" as const, path: "/repos/a", query: "", headers: {}, bodyBase64: Buffer.from("{}").toString("base64") };
  let acquired = false;
  await assert.rejects(() => prepareJsonHttpsEffect(effect as never, route, { async resolve() { throw new Error("must not resolve"); }, async acquireSlot() { acquired = true; return { readOnce: () => "secret" }; } }, { responseSemanticsProfiles: createHttpResponseSemanticsProfileRegistry([{ v: "reelier.http-response-semantics/v1", profileId: "reviewed", acknowledgedStatuses: [200] }]) } as never), /profile/i);
  assert.equal(acquired, false);
});

test("native preparation rejects sealed operator and route authority drift before secret materialization", async () => {
  const route = { v: "reelier.json-https-route/v1" as const, providerId: "github", connectorId: "github", accountId: "acct", providerAccountIdentity: "github:acct", endpointId: "write", origin: "https://api.github.com", allowedMethods: ["PUT" as const], allowedPathPrefixes: ["/repos"], credentialSlotId: "slot", responseSemanticsProfileId: "reviewed", reconciliationRecipeId: "recipe", readEndpointId: "read", egressPolicyDigest: digest("egress"), projectionSchemaDigest: digest("projection") };
  const effect = { endpointId: "write", method: "PUT" as const, path: "/repos/a", query: "", headers: {}, bodyBase64: Buffer.from("{}").toString("base64") };
  const profiles = createHttpResponseSemanticsProfileRegistry([{ v: "reelier.http-response-semantics/v1", profileId: "reviewed", acknowledgedStatuses: [200] }]);
  let acquired = false;
  const secrets = { async resolve() { acquired = true; throw new Error("must not resolve"); }, async acquireSlot() { acquired = true; return { readOnce: () => "secret" }; } };
  const common = { responseSemanticsProfiles: profiles, operatorConfigurationDigest: digest("sealed-config"), routeAuthority: { operatorConfigurationDigest: digest("drifted-config"), routeDigest: jsonHttpsRouteDigest(route) } };
  await assert.rejects(() => prepareJsonHttpsEffect(effect as never, route, secrets, common as never), /operator|configuration|authority/i);
  assert.equal(acquired, false);
  await assert.rejects(() => prepareJsonHttpsEffect(effect as never, { ...route, origin: "https://other.example" }, secrets, { ...common, routeAuthority: { operatorConfigurationDigest: digest("sealed-config"), routeDigest: jsonHttpsRouteDigest(route) } } as never), /route|authority|origin/i);
  assert.equal(acquired, false);
});

test("certified adapter preparation passes and validates durable route authority before acquiring a slot", async () => {
  const route = { v: "reelier.json-https-route/v1" as const, providerId: "github", connectorId: "github", accountId: "acct", providerAccountIdentity: "github:acct", endpointId: "write", origin: "https://api.github.com", allowedMethods: ["PUT" as const], allowedPathPrefixes: ["/repos"], credentialSlotId: "slot", responseSemanticsProfileId: "reviewed", reconciliationRecipeId: "recipe", readEndpointId: "read", egressPolicyDigest: digest("egress"), projectionSchemaDigest: digest("projection") };
  const read = { ...route, endpointId: "read", allowedMethods: ["GET" as const] };
  let acquired = false;
  const adapter = createJsonHttpsDispatchAdapter({ endpoints: [], routes: [route, read], operatorConfigurationDigest: digest("sealed-config"), responseSemanticsProfiles: [{ v: "reelier.http-response-semantics/v1", profileId: "reviewed", acknowledgedStatuses: [200] }], secrets: { async resolve() { acquired = true; throw new Error("must not resolve"); }, async acquireSlot() { acquired = true; return { readOnce: () => "secret" }; } } });
  const state: any = { reservation: { reservationId: "r", state: "reserved", intent: { effectDigest: digest("effect"), routeAuthority: { operatorConfigurationDigest: digest("sealed-config"), routeDigest: digest("drifted-route") }, executionContext: { allocationId: "a" } } }, effect: { endpointId: "write", method: "PUT", path: "/repos/a", query: "", headers: {}, bodyBase64: Buffer.from("{}").toString("base64") }, effectCanonicalBase64: "e30=", effectDigest: digest("effect") };
  await assert.rejects(() => adapter.prepare!(state), /route|authority/i);
  assert.equal(acquired, false);
});

test("response semantics profiles reject sparse status arrays before canonicalization", () => {
  const statuses = new Array<number>(1);
  assert.throws(() => parseHttpResponseSemanticsProfileV1({ v: "reelier.http-response-semantics/v1", profileId: "sparse", acknowledgedStatuses: statuses }), /status/i);
});

test("prepared native behavior digest binds route, operator configuration, and response profile", async () => {
  const route = { v: "reelier.json-https-route/v1" as const, providerId: "github", connectorId: "github", accountId: "acct", providerAccountIdentity: "github:acct", endpointId: "write", origin: "https://api.github.com", allowedMethods: ["PUT" as const], allowedPathPrefixes: ["/repos"], credentialSlotId: "slot", responseSemanticsProfileId: "reviewed", reconciliationRecipeId: "recipe", readEndpointId: "read", egressPolicyDigest: digest("egress"), projectionSchemaDigest: digest("projection") };
  const effect = { endpointId: "write", method: "PUT" as const, path: "/repos/a", query: "", headers: {}, bodyBase64: Buffer.from("{}").toString("base64") };
  const profiles = createHttpResponseSemanticsProfileRegistry([{ v: "reelier.http-response-semantics/v1", profileId: "reviewed", acknowledgedStatuses: [200] }]);
  const options = { responseSemanticsProfiles: profiles, operatorConfigurationDigest: digest("sealed-config"), routeAuthority: { operatorConfigurationDigest: digest("sealed-config"), routeDigest: jsonHttpsRouteDigest(route), projectionSchemaDigest: route.projectionSchemaDigest }, reservationId: "r", allocationId: "a", authorityGeneration: "g", authorityExpiresAt: new Date(Date.now() + 60_000).toISOString() };
  const secrets = { async resolve() { return "unused"; }, async acquireSlot() { return { readOnce: () => "secret" }; } };
  const prepared = await prepareJsonHttpsEffect(effect as never, route, secrets, options as never);
  assert.match((prepared.description as any).behaviorDigest, /^sha256:[0-9a-f]{64}$/);
});

test("coordinator uses durable prepared commit boundary and recovery never resends", { skip: process.platform !== "linux" }, async () => {
  const events: string[] = [];
  let reservation: any = { reservationId: "reservation-1", state: "reserved", intent: { effectDigest: digest("effect"), allocationId: "allocation-1", executionContext: { allocationId: "allocation-1" } } };
  const ledger: any = {
    async getReservation() { return reservation; },
    async commitPreparedDispatch(input: any) {
      events.push("commit"); reservation = { ...reservation, state: "dispatched" };
      return createDispatchCommitLease({ reservationId: input.reservationId, allocationId: input.allocationId, preparedDigest: input.preparedDescription.materializedRequestDigest, authorityGeneration: input.expectedAuthorityGeneration, authorityExpiresAt: input.preparedDescription.authorityExpiresAt, absoluteDeadlineMs: input.absoluteDeadlineMs, commitGeneration: "commit-1", commit: async () => { events.push("send-started"); } });
    },
    async transition(_id: string, expected: string, event: any) { if (reservation.state !== expected) return { ok: false, reason: "state-conflict" }; reservation = { ...reservation, state: event.to }; events.push(`transition:${event.to}`); return { ok: true, status: "transitioned", reservation }; },
    async recover() { return { ok: true, reservations: [reservation], highWaterMark: null, topology: { directorySync: "verified" } }; },
  };
  const adapter: any = {
    async prepare() { events.push("prepare"); return createPreparedDispatch({ description: { v: "reelier.prepared-dispatch-description/v1", routeDigest: digest("route"), materializedRequestDigest: digest(projection), projection, authorityGeneration: "generation-1", authorityExpiresAt: new Date(Date.now() + 60_000).toISOString(), absoluteDeadlineMs: performance.now() + 60_000, reservationId: "reservation-1", allocationId: "allocation-1" }, send: async () => { events.push("send"); return { kind: "acknowledged", resultDigest: digest("result") }; } }); },
    async dispatch() { throw new Error("legacy dispatch must not run"); },
  };
  const handle = createReservedDispatchHandle({ reservation, effect: {}, effectCanonicalBase64: "e30=", effectDigest: digest("effect") });
  const outcome = await createDispatchCoordinator(ledger, adapter).dispatch(handle);
  assert.equal(outcome.kind, "acknowledged");
  assert.deepEqual(events, ["prepare", "commit", "send-started", "send", "transition:acknowledged"]);
  const recovered = await createDispatchCoordinator(ledger, { async dispatch() { throw new Error("must not resend"); } }).recover();
  assert.deepEqual(recovered, []);
});

test("coordinator does not permit an adapter-specific prepared send bypass", { skip: process.platform !== "linux" }, async () => {
  const reservation: any = { reservationId: "reservation-1", state: "reserved", intent: { effectDigest: digest("effect"), executionContext: { allocationId: "allocation-1" } } };
  const ledger: any = {
    async getReservation() { return reservation; },
    async commitPreparedDispatch(input: any) { return createDispatchCommitLease({ reservationId: input.reservationId, allocationId: input.allocationId, preparedDigest: input.preparedDescription.materializedRequestDigest, authorityGeneration: input.expectedAuthorityGeneration, authorityExpiresAt: input.preparedDescription.authorityExpiresAt, absoluteDeadlineMs: input.absoluteDeadlineMs, commitGeneration: "commit-1" }); },
    async transition(_id: string, _expected: string, event: any) { reservation.state = event.to; return { ok: true, status: "transitioned", reservation }; },
  };
  const adapter: any = { async prepare() { return createPreparedDispatch({ description: { v: "reelier.prepared-dispatch-description/v1", routeDigest: digest("route"), materializedRequestDigest: digest(projection), projection, authorityGeneration: "generation-1", authorityExpiresAt: new Date(Date.now() + 60_000).toISOString(), absoluteDeadlineMs: performance.now() + 60_000, reservationId: "reservation-1", allocationId: "allocation-1" }, send: async () => ({ kind: "acknowledged", resultDigest: digest("result") }) }); }, async dispatchPrepared() { throw new Error("bypass called"); }, async dispatch() { throw new Error("legacy called"); } };
  const handle = createReservedDispatchHandle({ reservation, effect: {}, effectCanonicalBase64: "e30=", effectDigest: digest("effect") });
  const outcome = await createDispatchCoordinator(ledger, adapter).dispatch(handle);
  assert.equal(outcome.kind, "acknowledged");
});
