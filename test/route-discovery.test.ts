import test from "node:test";
import assert from "node:assert/strict";
import { createRouteDiscoveryAdapterRegistryV1 } from "../src/routes/adapters.js";
import { discoverRouteCoverage, refreshRouteCoverage } from "../src/routes/discovery.js";
import type { RouteCoverageV1 } from "../src/routes/types.js";

const digest = (char: string) => `sha256:${char.repeat(64)}`;
const now = new Date("2026-08-15T12:00:00.000Z");

const staticRoute = (overrides: Record<string, unknown>) => ({
  sourceId: "static-surfaces", sourceVersion: "1.0.0", sourceDigest: digest("1"), sourceKind: "static-route" as const,
  observedAt: now.toISOString(), freshnessMs: 15 * 60_000, routeKey: "route", hostId: "fixture-host",
  discoverySource: "unknown" as const, transport: "unknown" as const, observation: "unknown" as const,
  replay: "unknown" as const, outcome: "unknown" as const, enforcement: "absent" as const,
  topologyEvidenceDigest: null, evidenceRefs: [], reasonCodes: [], canonicalBytes: "{}", fileIdentityDigest: digest("2"),
  ...overrides,
});

test("route discovery preserves bypasses and same-name routes as separate evidence rows", async () => {
  const registry = createRouteDiscoveryAdapterRegistryV1();
  assert.ok(Object.isFrozen(registry));
  const rows = await discoverRouteCoverage({
    registry, now,
    observations: [
      staticRoute({ routeKey: "gmail.send", discoverySource: "host-config", transport: "mcp-stdio", observation: "observed", enforcement: "unchecked", reasonCodes: ["reviewed-wrap-route"] }),
      staticRoute({ sourceDigest: digest("3"), routeKey: "gmail.send", discoverySource: "plugin-manifest", transport: "mcp-stdio", observation: "uncovered", enforcement: "absent", reasonCodes: ["plugin-private"] }),
      staticRoute({ sourceDigest: digest("4"), routeKey: "gmail.send", discoverySource: "direct-http", transport: "https", observation: "uncovered", enforcement: "absent", reasonCodes: ["direct-http-bypass"] }),
      staticRoute({ sourceDigest: digest("5"), routeKey: "gmail.remote", discoverySource: "host-config", transport: "mcp-http", observation: "uncovered", enforcement: "absent", reasonCodes: ["remote-mcp-no-native-wrap"] }),
      staticRoute({ sourceDigest: digest("6"), routeKey: "browser.write", discoverySource: "writable-browser", transport: "browser", observation: "uncovered", enforcement: "absent", reasonCodes: ["writable-browser-bypass"] }),
      staticRoute({ sourceDigest: digest("7"), routeKey: "private.connection", discoverySource: "host-private", transport: "opaque-host", observation: "partially-observed", outcome: "shadow-only", enforcement: "absent", reasonCodes: ["host-private"] }),
      staticRoute({ sourceDigest: digest("8"), routeKey: "reviewed.mcp", discoverySource: "host-config", transport: "mcp-stdio", observation: "observed", replay: "available", outcome: "outcome-capable", enforcement: "unchecked", reasonCodes: ["reviewed-mcp"] }),
      staticRoute({ sourceDigest: digest("9"), routeKey: "native.activated", discoverySource: "native-config", transport: "https", observation: "observed", outcome: "activated", enforcement: "unchecked", reasonCodes: ["activated-not-topology-verified"] }),
      staticRoute({ sourceDigest: digest("a"), routeKey: "registry", discoverySource: "plugin-manifest", observation: "unknown", enforcement: "absent", reasonCodes: ["registry-unreadable"] }),
    ],
  });

  assert.deepEqual(rows.filter((row: RouteCoverageV1) => row.routeId.endsWith(":gmail.send")).map((row: RouteCoverageV1) => [row.routeId, row.observation, row.enforcement]), [
    ["direct-http:gmail.send", "uncovered", "absent"],
    ["host-config:gmail.send", "observed", "unchecked"],
    ["plugin-manifest:gmail.send", "uncovered", "absent"],
  ]);
  assert.equal(rows.length, 9);
  assert.equal(new Set(rows.map((row: RouteCoverageV1) => row.routeId)).size, rows.length);
  assert.ok(rows.every((row: RouteCoverageV1) => Date.parse(row.freshUntil) > Date.parse(row.observedAt)));
});

test("catalog observations can add a row but cannot upgrade trust identity topology or activation", async () => {
  const [row] = await discoverRouteCoverage({
    registry: createRouteDiscoveryAdapterRegistryV1(), now,
    observations: [{
      sourceId: "openapi-catalog", sourceVersion: "3.2.1", sourceDigest: digest("b"), sourceKind: "catalog" as const,
      observedAt: now.toISOString(), freshnessMs: 5 * 60_000, routeKey: "payments.refund", hostId: "catalog-host",
      discoverySource: "openapi" as const, transport: "https" as const,
      claimedObservation: "observed", claimedEnforcement: "verified", claimedIdentity: "verified",
      claimedTopologyEvidenceDigest: digest("c"), claimedOutcome: "activated",
    }],
  });
  assert.deepEqual({ observation: row.observation, enforcement: row.enforcement, topology: row.topologyEvidenceDigest, outcome: row.outcome }, {
    observation: "unknown", enforcement: "absent", topology: null, outcome: "unknown",
  });
  assert.deepEqual(row.reasonCodes, ["catalog-is-non-authorizing"]);
});

test("freshness refresh never preserves stale changed unreadable or missing certainty", () => {
  const baseline = [
    { v: "reelier.route-coverage/v1", routeId: "host-config:expired", hostId: "codex", discoverySource: "host-config", transport: "mcp-stdio", observation: "observed", replay: "available", outcome: "activated", enforcement: "verified", observedAt: "2026-08-15T10:00:00.000Z", freshUntil: "2026-08-15T11:00:00.000Z", evidenceDigest: digest("1"), topologyEvidenceDigest: digest("2"), evidenceRefs: ["source:codex"], reasonCodes: [] },
    { v: "reelier.route-coverage/v1", routeId: "host-config:changed", hostId: "codex", discoverySource: "host-config", transport: "mcp-stdio", observation: "observed", replay: "available", outcome: "activated", enforcement: "verified", observedAt: "2026-08-15T11:00:00.000Z", freshUntil: "2026-08-15T13:00:00.000Z", evidenceDigest: digest("3"), topologyEvidenceDigest: digest("4"), evidenceRefs: ["source:codex"], reasonCodes: [] },
    { v: "reelier.route-coverage/v1", routeId: "plugin-manifest:unreadable", hostId: "claude-code", discoverySource: "plugin-manifest", transport: "mcp-stdio", observation: "observed", replay: "candidate", outcome: "outcome-capable", enforcement: "unchecked", observedAt: "2026-08-15T11:00:00.000Z", freshUntil: "2026-08-15T13:00:00.000Z", evidenceDigest: digest("5"), topologyEvidenceDigest: null, evidenceRefs: ["source:claude"], reasonCodes: [] },
    { v: "reelier.route-coverage/v1", routeId: "host-config:missing", hostId: "codex", discoverySource: "host-config", transport: "mcp-stdio", observation: "observed", replay: "available", outcome: "outcome-capable", enforcement: "unchecked", observedAt: "2026-08-15T11:00:00.000Z", freshUntil: "2026-08-15T13:00:00.000Z", evidenceDigest: digest("6"), topologyEvidenceDigest: null, evidenceRefs: ["source:codex"], reasonCodes: [] },
  ] as const;
  const current = [
    { ...baseline[1], evidenceDigest: digest("7"), observedAt: "2026-08-15T12:00:00.000Z", freshUntil: "2026-08-15T12:15:00.000Z" },
    { ...baseline[2], observation: "unknown" as const, replay: "unknown" as const, outcome: "unknown" as const, enforcement: "absent" as const, evidenceDigest: digest("8"), observedAt: "2026-08-15T12:00:00.000Z", freshUntil: "2026-08-15T12:05:00.000Z", reasonCodes: ["registry-unreadable"] },
  ];
  const refreshed = refreshRouteCoverage({ baseline, current, now });
  assert.deepEqual(refreshed.map((row: RouteCoverageV1) => [row.routeId, row.observation, row.enforcement]), [
    ["host-config:changed", "unknown", "absent"],
    ["host-config:expired", "unknown", "absent"],
    ["host-config:missing", "unknown", "absent"],
    ["plugin-manifest:unreadable", "unknown", "absent"],
  ]);
  assert.ok(refreshed.every((row: RouteCoverageV1) => row.topologyEvidenceDigest === null && row.outcome !== "activated"));
});

test("adapter freshness is bounded and invalid discovery observations refuse", async () => {
  const registry = createRouteDiscoveryAdapterRegistryV1();
  for (const freshnessMs of [0, -1, Number.POSITIVE_INFINITY, 24 * 60 * 60_000 + 1]) {
    await assert.rejects(discoverRouteCoverage({ registry, now, observations: [staticRoute({ freshnessMs })] }), TypeError);
  }
});
