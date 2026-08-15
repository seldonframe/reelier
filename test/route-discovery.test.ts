import test from "node:test";
import assert from "node:assert/strict";
import { createCodexRouteDiscoverySnapshotV1, createRouteDiscoveryAdapterRegistryV1 } from "../src/routes/adapters.js";
import { discoverRouteCoverage, refreshRouteCoverage } from "../src/routes/discovery.js";
import type { RouteCoverageV1 } from "../src/routes/types.js";

const digest = (char: string) => `sha256:${char.repeat(64)}`;
const now = new Date("2026-08-15T12:00:00.000Z");
const configPath = "C:/private/.codex/config.toml";
const pluginPath = "C:/private/plugins/gmail/mcp.json";

const finding = (kind: string, routeKey: string, sourceRef: string) => ({ kind, routeKey, sourceRef });

function codexReport() {
  return {
      homedir: "C:/private", configPath,
      config: { configPath, location: "parsed" as const, servers: [{ name: "gmail.send", origin: configPath, location: "parsed" as const, transport: "stdio" as const, routing: "wrapped" as const }, { name: "gmail.remote", origin: configPath, location: "parsed" as const, transport: "url" as const, routing: "unwrapped" as const }], plugins: [], marketplaces: [] },
      plugins: [{ registration: { name: "gmail", marketplace: "official", enabled: true }, inspected: true, location: "parsed" as const, manifestPath: pluginPath, candidatesTried: [], servers: [{ name: "gmail.send", origin: pluginPath, location: "parsed" as const, transport: "stdio" as const, routing: "unwrapped" as const }] }],
      inspectedLocations: [configPath],
      routeEvidence: [{ sourceRef: configPath, sourceInstanceIdentityDigest: digest("4"), canonicalBytes: "[mcp_servers.gmail]", fileIdentityDigest: digest("2") }, { sourceRef: pluginPath, sourceInstanceIdentityDigest: digest("5"), canonicalBytes: "{}", fileIdentityDigest: digest("6") }],
  };
}

function codexSnapshot(overrides: Record<string, unknown> = {}) {
  const base = {
    report: codexReport(),
    observedAt: now.toISOString(), freshnessMs: 15 * 60_000, contractIdentityDigest: digest("3"), findings: [], ...overrides,
  };
  return createCodexRouteDiscoverySnapshotV1(base as never);
}

test("route discovery preserves bypasses and same-name routes as separate opaque identities", async () => {
  const registry = createRouteDiscoveryAdapterRegistryV1();
  assert.ok(Object.isFrozen(registry));
  const rows = await discoverRouteCoverage({ registry, now, snapshots: [codexSnapshot({ findings: [
    finding("direct-http", "gmail.send", "direct:gmail"), finding("writable-browser", "browser.write", "browser:primary"),
    finding("host-private", "private.connection", "connection:private"), finding("reviewed-mcp", "reviewed.mcp", "reviewed:mcp"),
    finding("activated-native", "native.activated", "native:activated"), finding("unreadable-registry", "registry", "registry:unreadable"),
  ] })] });

  const gmail = rows.filter((row: RouteCoverageV1) =>
    (row.discoverySource === "direct-http" && row.reasonCodes.includes("direct-http-bypass")) ||
    (row.discoverySource === "host-config" && row.reasonCodes.includes("wrapped-route-observed")) ||
    (row.discoverySource === "plugin-manifest" && row.reasonCodes.includes("plugin-private")),
  );
  assert.deepEqual(gmail.map(row => [row.discoverySource, row.observation, row.enforcement]), [["direct-http", "uncovered", "absent"], ["host-config", "observed", "unchecked"], ["plugin-manifest", "uncovered", "absent"]]);
  assert.equal(rows.length, 9);
  assert.equal(new Set(rows.map(row => row.routeId)).size, rows.length);
  assert.ok(rows.every(row => /^route_[0-9a-f]{64}$/.test(row.routeId) && !row.routeId.includes(":")));
  assert.ok(rows.every(row => Date.parse(row.freshUntil) > Date.parse(row.observedAt)));
});

test("harness catalog metadata adds distinct rows but cannot upgrade trust identity topology or activation", async () => {
  const emptyReport = codexReport();
  const rows = await discoverRouteCoverage({ registry: createRouteDiscoveryAdapterRegistryV1(), now, snapshots: [codexSnapshot({ report: { ...emptyReport, config: { ...emptyReport.config, servers: [] }, plugins: [] }, findings: [
    finding("openapi", "payments.refund", "catalog:first"), finding("openapi", "payments.refund", "catalog:second"),
  ] })] });
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0]?.routeId, rows[1]?.routeId);
  assert.ok(rows.every(row => row.observation === "unknown" && row.enforcement === "absent" && row.topologyEvidenceDigest === null && row.outcome === "unknown"));
  assert.ok(rows.every(row => row.reasonCodes.includes("catalog-is-non-authorizing")));
});

test("opaque route identity is stable across mutable evidence and contract changes", async () => {
  const discover = (canonicalBytes: string, contractIdentityDigest: string) => {
    const report = codexReport();
    return discoverRouteCoverage({ registry: createRouteDiscoveryAdapterRegistryV1(), now, snapshots: [codexSnapshot({ report: { ...report, routeEvidence: report.routeEvidence.map((value: { sourceRef: string }) => value.sourceRef === configPath ? { ...value, canonicalBytes } : value) }, contractIdentityDigest })] });
  };
  const before = await discover("old", digest("2"));
  const after = await discover("new", digest("4"));
  assert.deepEqual(before.map(row => row.routeId), after.map(row => row.routeId));
  assert.notDeepEqual(before.map(row => row.evidenceDigest), after.map(row => row.evidenceDigest));
});

test("freshness refresh never preserves stale changed unreadable or missing certainty", () => {
  const opaque = (char: string) => `route_${char.repeat(64)}`;
  const baseline = [
    { v: "reelier.route-coverage/v1", routeId: opaque("1"), hostId: "codex", discoverySource: "host-config", transport: "mcp-stdio", observation: "observed", replay: "available", outcome: "activated", enforcement: "verified", observedAt: "2026-08-15T10:00:00.000Z", freshUntil: "2026-08-15T11:00:00.000Z", evidenceDigest: digest("1"), topologyEvidenceDigest: digest("2"), evidenceRefs: ["source:codex"], reasonCodes: [] },
    { v: "reelier.route-coverage/v1", routeId: opaque("2"), hostId: "codex", discoverySource: "host-config", transport: "mcp-stdio", observation: "observed", replay: "available", outcome: "activated", enforcement: "verified", observedAt: "2026-08-15T11:00:00.000Z", freshUntil: "2026-08-15T13:00:00.000Z", evidenceDigest: digest("3"), topologyEvidenceDigest: digest("4"), evidenceRefs: ["source:codex"], reasonCodes: [] },
    { v: "reelier.route-coverage/v1", routeId: opaque("3"), hostId: "claude-code", discoverySource: "plugin-manifest", transport: "mcp-stdio", observation: "observed", replay: "candidate", outcome: "outcome-capable", enforcement: "unchecked", observedAt: "2026-08-15T11:00:00.000Z", freshUntil: "2026-08-15T13:00:00.000Z", evidenceDigest: digest("5"), topologyEvidenceDigest: null, evidenceRefs: ["source:claude"], reasonCodes: [] },
    { v: "reelier.route-coverage/v1", routeId: opaque("4"), hostId: "codex", discoverySource: "host-config", transport: "mcp-stdio", observation: "observed", replay: "available", outcome: "outcome-capable", enforcement: "unchecked", observedAt: "2026-08-15T11:00:00.000Z", freshUntil: "2026-08-15T13:00:00.000Z", evidenceDigest: digest("6"), topologyEvidenceDigest: null, evidenceRefs: ["source:codex"], reasonCodes: [] },
  ] as const;
  const current = [
    { ...baseline[1], evidenceDigest: digest("7"), observedAt: "2026-08-15T12:00:00.000Z", freshUntil: "2026-08-15T12:15:00.000Z" },
    { ...baseline[2], observation: "unknown" as const, replay: "unknown" as const, outcome: "unknown" as const, enforcement: "absent" as const, evidenceDigest: digest("8"), observedAt: "2026-08-15T12:00:00.000Z", freshUntil: "2026-08-15T12:05:00.000Z", reasonCodes: ["registry-unreadable"] },
  ];
  const refreshed = refreshRouteCoverage({ baseline, current, now });
  assert.deepEqual(refreshed.map(row => [row.routeId, row.observation, row.enforcement]), [[opaque("1"), "unknown", "absent"], [opaque("2"), "unknown", "absent"], [opaque("3"), "unknown", "absent"], [opaque("4"), "unknown", "absent"]]);
  assert.ok(refreshed.every(row => row.topologyEvidenceDigest === null && row.outcome !== "activated"));
});

test("adapter freshness is bounded and invalid discovery snapshots refuse", async () => {
  for (const freshnessMs of [0, -1, Number.POSITIVE_INFINITY, 24 * 60 * 60_000 + 1]) assert.throws(() => codexSnapshot({ freshnessMs }), TypeError);
});

test("discovery refuses forged snapshots and caller-supplied route authority claims", async () => {
  const registry = createRouteDiscoveryAdapterRegistryV1();
  const valid = codexSnapshot();
  const forged = { ...valid, findings: [{ kind: "activated-native", routeKey: "forged", sourceRef: "forged", observation: "observed", outcome: "activated", enforcement: "verified", topologyEvidenceDigest: digest("f"), sourceInstanceIdentityDigest: digest("e") }] };
  await assert.rejects(discoverRouteCoverage({ registry, now, snapshots: [forged as never] }), /snapshot.*Reelier|provenance/i);
  assert.equal((await discoverRouteCoverage({ registry, now, snapshots: [valid] })).every(row => row.enforcement !== "verified"), true);
});

test("sealed snapshots detach collector evidence from post-seal caller mutation", async () => {
  const report = codexReport();
  const snapshot = createCodexRouteDiscoverySnapshotV1({ report, observedAt: now.toISOString(), freshnessMs: 60_000, contractIdentityDigest: digest("9"), findings: [] });
  const before = await discoverRouteCoverage({ registry: createRouteDiscoveryAdapterRegistryV1(), now, snapshots: [snapshot] });
  report.config.servers.push({ name: "evil.write", origin: configPath, location: "parsed", transport: "stdio", routing: "wrapped" });
  report.routeEvidence[0]!.canonicalBytes = "mutated";
  const after = await discoverRouteCoverage({ registry: createRouteDiscoveryAdapterRegistryV1(), now, snapshots: [snapshot] });
  assert.deepEqual(after, before);
});
