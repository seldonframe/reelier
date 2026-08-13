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
