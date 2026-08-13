import test from "node:test";
import assert from "node:assert/strict";
import { authorityDigest } from "../../src/authority/wire.js";
import {
  createDispatchCommitLease,
  createPreparedDispatch,
  consumePreparedDispatch,
  type MaterializedHttpRequestProjectionV1,
} from "../../src/authority/host/prepared-dispatch.js";

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

