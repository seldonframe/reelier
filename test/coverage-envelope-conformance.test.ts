import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  BUILTIN_ROUTE_ADAPTERS,
  createClaudeCodeRouteDiscoverySnapshotV1,
  createCodexRouteDiscoverySnapshotV1,
  createRouteDiscoveryAdapterRegistryV1,
} from "../src/routes/adapters.js";
import { discoverRouteCoverage } from "../src/routes/discovery.js";
import type { RouteCoverageV1 } from "../src/routes/types.js";

const coverage = await import(pathToFileURL(resolve("conformance/coverage-envelope/v0/check.mjs")).href);
const digest = (char: string) => `sha256:${char.repeat(64)}`;
const now = new Date("2026-08-16T01:00:00.000Z");
const codexConfig = "C:/private/.codex/config.toml";
const claudeConfig = "C:/private/.claude.json";
const claudePlugin = "C:/private/plugins/mail/mcp.json";

function sourceEvidence(sourceRef: string, identity: string, content: string) {
  return { sourceRef, sourceInstanceIdentityDigest: digest(identity), canonicalBytes: "{}", fileIdentityDigest: digest(content) };
}

async function codexRows(): Promise<readonly RouteCoverageV1[]> {
  const report = {
    homedir: "C:/private",
    configPath: codexConfig,
    config: {
      configPath: codexConfig,
      location: "parsed" as const,
      servers: [
        { name: "mail.wrapped", origin: codexConfig, location: "parsed" as const, transport: "stdio" as const, routing: "wrapped" as const },
        { name: "mail.remote", origin: codexConfig, location: "parsed" as const, transport: "url" as const, routing: "unwrapped" as const },
      ],
      plugins: [],
      marketplaces: [],
    },
    plugins: [],
    inspectedLocations: [codexConfig],
    routeEvidence: [sourceEvidence(codexConfig, "1", "2")],
  };
  const snapshot = createCodexRouteDiscoverySnapshotV1({
    report,
    observedAt: now.toISOString(),
    freshnessMs: 60_000,
    contractIdentityDigest: digest("3"),
    findings: [
      { kind: "direct-http", routeKey: "mail.direct", sourceRef: codexConfig },
      { kind: "host-private", routeKey: "mail.private", sourceRef: codexConfig },
    ],
  });
  return discoverRouteCoverage({ registry: createRouteDiscoveryAdapterRegistryV1(), now, snapshots: [snapshot] });
}

async function claudeRows(): Promise<readonly RouteCoverageV1[]> {
  const view = {
    host: "claude-code" as const,
    sources: [{ path: claudeConfig, location: "parsed" as const, servers: [{ name: "mail.wrapped", origin: claudeConfig, location: "parsed" as const, transport: "stdio" as const, routing: "wrapped" as const }] }],
    plugins: [{
      registration: { name: "mail", marketplace: "official", enabled: true },
      inspected: true,
      location: "parsed" as const,
      manifestPath: claudePlugin,
      candidatesTried: [],
      servers: [{ name: "mail.plugin", origin: claudePlugin, location: "parsed" as const, transport: "stdio" as const, routing: "unwrapped" as const }],
    }],
    inspectedLocations: [claudeConfig, claudePlugin],
    pluginRegistry: { location: "parsed" as const },
    pluginSource: claudePlugin,
    routeEvidence: [sourceEvidence(claudeConfig, "4", "5"), sourceEvidence(claudePlugin, "6", "7")],
  };
  const snapshot = createClaudeCodeRouteDiscoverySnapshotV1({ view, observedAt: now.toISOString(), freshnessMs: 60_000, contractIdentityDigest: digest("8"), findings: [] });
  return discoverRouteCoverage({ registry: createRouteDiscoveryAdapterRegistryV1(), now, snapshots: [snapshot] });
}

function envelopeInput(harnessId: "codex" | "claude-code", routes: readonly RouteCoverageV1[], overrides: Record<string, unknown> = {}) {
  const adapter = harnessId === "codex" ? BUILTIN_ROUTE_ADAPTERS.codex : BUILTIN_ROUTE_ADAPTERS.claudeCode;
  return {
    v: "reelier.coverage-envelope-input/v0",
    harness: { id: harnessId, instanceIdentityDigest: digest("9") },
    adapter: { id: adapter.sourceId, digest: adapter.sourceDigest },
    requestedMode: "observed",
    evaluatedAt: now.toISOString(),
    sources: [{ kind: "host-config", sourceInstanceIdentityDigest: digest("a"), contentDigest: digest("b"), evidenceStatus: "verified", reasonCodes: [] }],
    routes,
    claims: {
      topology: { status: "unchecked", evidenceDigest: null },
      completeness: { status: "unchecked", evidenceDigest: null },
    },
    ...overrides,
  };
}

function verifiedRoute(harnessId: "codex" | "claude-code" = "codex"): RouteCoverageV1 {
  return {
    v: "reelier.route-coverage/v1", routeId: `route_${"1".repeat(64)}`, hostId: harnessId,
    discoverySource: "host-config", transport: "mcp-stdio", observation: "observed", replay: "available",
    outcome: "activated", enforcement: "verified", observedAt: now.toISOString(),
    freshUntil: new Date(now.getTime() + 60_000).toISOString(), evidenceDigest: digest("c"),
    topologyEvidenceDigest: digest("d"), evidenceRefs: [`source:${harnessId}:host-config`], reasonCodes: ["wrapped-route-observed"],
  };
}

test("Codex and Claude discovery rows map to an observed envelope without gaining enforcement", async () => {
  const codex = coverage.buildCoverageEnvelope(envelopeInput("codex", await codexRows()));
  assert.equal(codex.status, "failed");
  assert.equal(codex.mode, "observed");
  assert.equal(codex.inventory.length, 4);
  assert.equal(codex.wrappedRoutes.length, 1);
  assert.equal(codex.unwrappedRoutes.length, 3);
  assert.equal(codex.directHttpRoutes.length, 1);
  assert.equal(codex.privateHostRoutes.length, 1);
  assert.ok(codex.reasonCodes.includes("route-enforcement-unchecked"));

  const claude = coverage.buildCoverageEnvelope(envelopeInput("claude-code", await claudeRows(), {
    sources: [
      { kind: "host-config", sourceInstanceIdentityDigest: digest("4"), contentDigest: digest("5"), evidenceStatus: "verified", reasonCodes: [] },
      { kind: "plugin-manifest", sourceInstanceIdentityDigest: digest("6"), contentDigest: digest("7"), evidenceStatus: "verified", reasonCodes: [] },
    ],
  }));
  assert.equal(claude.status, "failed");
  assert.deepEqual(claude.wrappedRoutes.length, 1);
  assert.deepEqual(claude.privateHostRoutes.length, 1);
  assert.ok(claude.inventory.some((route: any) => route.discoverySource === "plugin-manifest" && route.routing === "unwrapped"));
});

test("catalog-only, stale, and unwrapped route evidence are explicit non-success", () => {
  const catalog: RouteCoverageV1 = { ...verifiedRoute(), discoverySource: "openapi", transport: "https", observation: "unknown", replay: "candidate", outcome: "unknown", enforcement: "absent", topologyEvidenceDigest: null, reasonCodes: ["catalog-is-non-authorizing"] };
  const catalogReport = coverage.buildCoverageEnvelope(envelopeInput("codex", [catalog]));
  assert.equal(catalogReport.status, "failed");
  assert.deepEqual(catalogReport.reasonCodes, ["catalog-only-evidence", "completeness-unchecked", "route-enforcement-absent", "route-observation-unknown", "route-routing-unknown", "topology-unchecked"]);

  const stale = coverage.buildCoverageEnvelope(envelopeInput("codex", [{ ...verifiedRoute(), freshUntil: now.toISOString() }], { evaluatedAt: new Date(now.getTime() + 1).toISOString() }));
  assert.equal(stale.status, "failed");
  assert.equal(stale.freshness.status, "stale");
  assert.ok(stale.reasonCodes.includes("evidence-stale"));

  const unwrapped: RouteCoverageV1 = { ...verifiedRoute(), observation: "uncovered", enforcement: "absent", topologyEvidenceDigest: null, reasonCodes: ["route-unwrapped"] };
  const unwrappedReport = coverage.buildCoverageEnvelope(envelopeInput("codex", [unwrapped]));
  assert.equal(unwrappedReport.status, "failed");
  assert.deepEqual(unwrappedReport.unwrappedRoutes, [unwrapped.routeId]);
  assert.ok(unwrappedReport.reasonCodes.includes("route-uncovered"));
});

test("verified completeness cannot override bypasses or unknown routing", () => {
  const direct: RouteCoverageV1 = { ...verifiedRoute(), discoverySource: "direct-http", transport: "https", observation: "uncovered", enforcement: "absent", topologyEvidenceDigest: null, reasonCodes: ["direct-http-bypass"] };
  const report = coverage.buildCoverageEnvelope(envelopeInput("codex", [verifiedRoute(), direct], {
    requestedMode: "enforced",
    claims: { topology: { status: "verified", evidenceDigest: digest("e") }, completeness: { status: "verified", evidenceDigest: digest("f") } },
  }));
  assert.equal(report.status, "failed");
  assert.equal(report.mode, "observed");
  assert.ok(report.reasonCodes.includes("completeness-contradicted-by-inventory"));
  assert.ok(report.reasonCodes.includes("enforced-mode-refused"));
  assert.deepEqual(report.directHttpRoutes, [direct.routeId]);
});

test("unknown, uncovered, unchecked, absent, and pending evidence never passes", () => {
  const cases = [
    ["unknown", envelopeInput("codex", [{ ...verifiedRoute(), observation: "unknown", enforcement: "absent", topologyEvidenceDigest: null }])],
    ["uncovered", envelopeInput("codex", [{ ...verifiedRoute(), observation: "uncovered", enforcement: "absent", topologyEvidenceDigest: null }])],
    ["unchecked", envelopeInput("codex", [{ ...verifiedRoute(), enforcement: "unchecked", topologyEvidenceDigest: null }])],
    ["absent", envelopeInput("codex", [{ ...verifiedRoute(), enforcement: "absent", topologyEvidenceDigest: null }])],
    ["pending", envelopeInput("codex", [verifiedRoute()], { sources: [{ kind: "host-config", sourceInstanceIdentityDigest: digest("a"), contentDigest: digest("b"), evidenceStatus: "pending", reasonCodes: ["source-pending"] }] })],
  ] as const;
  for (const [label, input] of cases) assert.equal(coverage.buildCoverageEnvelope(input).status, "failed", label);
});

test("only a fresh fully verified envelope can retain enforced mode and pass", () => {
  const report = coverage.buildCoverageEnvelope(envelopeInput("codex", [verifiedRoute()], {
    requestedMode: "enforced",
    claims: { topology: { status: "verified", evidenceDigest: digest("e") }, completeness: { status: "verified", evidenceDigest: digest("f") } },
  }));
  assert.equal(report.status, "passed");
  assert.equal(report.mode, "enforced");
  assert.deepEqual(report.reasonCodes, []);
  assert.equal(coverage.validateCoverageEnvelopeReport(report), true);
  assert.equal(coverage.validateCoverageEnvelopeReport({ ...report, surprise: true }), false);
});

test("the input contract is exact and binds adapter identity to the harness", () => {
  assert.throws(() => coverage.buildCoverageEnvelope({ ...envelopeInput("codex", [verifiedRoute()]), surprise: true }), /invalid|additional/i);
  assert.throws(() => coverage.buildCoverageEnvelope({ ...envelopeInput("codex", [verifiedRoute()]), adapter: { id: "reelier-claude-code-coverage", digest: BUILTIN_ROUTE_ADAPTERS.claudeCode.sourceDigest } }), /identity|invalid/i);
});
