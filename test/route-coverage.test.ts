import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRouteCoverageV1, parseRouteCoverageV1 } from "../src/routes/normalize.js";
import { refreshRouteCoverage } from "../src/routes/discovery.js";

const digest = (char: string) => `sha256:${char.repeat(64)}`;
const route = (routeId = "route_1") => ({
  v: "reelier.route-coverage/v1", routeId, hostId: "host_1", discoverySource: "plugin-manifest",
  transport: "mcp-stdio", observation: "partially-observed", replay: "candidate", outcome: "outcome-capable",
  enforcement: "unchecked", observedAt: "2026-08-15T12:00:00.000Z", freshUntil: "2026-08-15T12:30:00.000Z",
  evidenceDigest: digest("1"), topologyEvidenceDigest: null, evidenceRefs: ["manifest:plugin_1"], reasonCodes: ["plugin-private"],
});

test("route coverage normalizes closed rows in route-id byte order", () => {
  const parsed = normalizeRouteCoverageV1([route("route_b"), route("route_a")]);
  assert.deepEqual(parsed.map((value: { readonly routeId: string }) => value.routeId), ["route_a", "route_b"]);
  assert.ok(Object.isFrozen(parsed) && parsed.every(Object.isFrozen));
});

test("route coverage refuses duplicate IDs and unknown enums", () => {
  assert.throws(() => normalizeRouteCoverageV1([route(), route()]), TypeError);
  for (const value of [
    { ...route(), discoverySource: "magic" }, { ...route(), transport: "stdio-shell" },
    { ...route(), observation: "complete" }, { ...route(), replay: "automatic" },
    { ...route(), outcome: "safe" }, { ...route(), enforcement: "pending" },
  ]) assert.throws(() => parseRouteCoverageV1(value), TypeError);
});

test("route evidence is inert, non-secret, ordered, and temporally bounded", () => {
  let reads = 0;
  const accessor = route();
  Object.defineProperty(accessor, "routeId", { enumerable: true, get() { reads++; return "route_1"; } });
  assert.throws(() => parseRouteCoverageV1(accessor), TypeError);
  assert.equal(reads, 0);
  const symbol = route() as Record<PropertyKey, unknown>; symbol[Symbol("secret")] = "x";
  for (const value of [
    symbol, Object.assign(Object.create({ x: 1 }), route()), { ...route(), token: "secret" },
    { ...route(), freshUntil: "2026-08-15T12:00:00.000Z" },
    { ...route(), evidenceRefs: ["b", "a"] }, { ...route(), reasonCodes: ["x", "x"] },
    { ...route(), topologyEvidenceDigest: digest("2") },
  ]) assert.throws(() => parseRouteCoverageV1(value), TypeError);
});

test("route evidence references are opaque and never endpoint URLs", () => {
  for (const evidenceRef of ["https://provider.example/token", "artifact:https://provider.example/private"]) {
    assert.throws(() => parseRouteCoverageV1({ ...route(), evidenceRefs: [evidenceRef] }), TypeError, evidenceRef);
  }
});

test("route refresh uses the injected clock at the exact freshness boundary", () => {
  const stale = route("route_stale");
  const refreshed = refreshRouteCoverage({ baseline: [stale], current: [], now: new Date(stale.freshUntil) });
  assert.equal(refreshed[0]?.observation, "unknown");
  assert.equal(refreshed[0]?.enforcement, "absent");
  assert.equal(refreshed[0]?.topologyEvidenceDigest, null);
});
