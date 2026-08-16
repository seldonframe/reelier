import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
    routeEvidenceDigest: routeEvidenceDigest(routes),
    sources: [{ kind: "host-config", sourceInstanceIdentityDigest: digest("a"), contentDigest: digest("b"), evidenceStatus: "verified", reasonCodes: [] }],
    routes,
    claims: {
      topology: { status: "unchecked", evidenceDigest: null },
      completeness: { status: "unchecked", evidenceDigest: null },
    },
    ...overrides,
  };
}

function routeEvidenceDigest(routes: readonly RouteCoverageV1[]) {
  const evidence = [...routes]
    .sort((left, right) => Buffer.from(left.routeId).compare(Buffer.from(right.routeId)))
    .map((route) => route);
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical({ v: "reelier.route-evidence-commitment/v1", evidence })), "utf8").digest("hex")}`;
}

function inputCommitmentDigest(input: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical({ v: "reelier.coverage-envelope-input-commitment/v0", input })), "utf8").digest("hex")}`;
}

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function withIntegrity(report: any) {
  const { integrityDigest: ignored, ...payload } = report;
  void ignored;
  const integrityDigest = `sha256:${createHash("sha256").update(JSON.stringify(canonical({ v: "reelier.coverage-envelope-integrity/v0", report: payload })), "utf8").digest("hex")}`;
  return { ...payload, integrityDigest };
}

function freshSource(kind: "host-config" | "plugin-manifest", identity: string, content: string) {
  return {
    kind, sourceInstanceIdentityDigest: digest(identity), contentDigest: digest(content), evidenceStatus: "verified",
    observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), reasonCodes: [],
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
  assert.deepEqual(catalogReport.reasonCodes, ["catalog-only-evidence", "completeness-unchecked", "discovery-is-non-authorizing", "provenance-asserted-only", "route-enforcement-absent", "route-observation-unknown", "route-routing-unknown", "source-freshness-absent", "topology-unchecked"]);

  const stale = coverage.buildCoverageEnvelope(envelopeInput("codex", [{ ...verifiedRoute(), freshUntil: new Date(now.getTime() + 1).toISOString() }], {
    evaluatedAt: new Date(now.getTime() + 2).toISOString(), sources: [freshSource("host-config", "a", "b")],
  }));
  assert.equal(stale.status, "failed");
  assert.equal(stale.freshness.status, "stale");
  assert.ok(stale.reasonCodes.includes("evidence-stale"));

  const unwrapped: RouteCoverageV1 = { ...verifiedRoute(), observation: "uncovered", enforcement: "absent", topologyEvidenceDigest: null, reasonCodes: ["route-unwrapped"] };
  const unwrappedReport = coverage.buildCoverageEnvelope(envelopeInput("codex", [unwrapped]));
  assert.equal(unwrappedReport.status, "failed");
  assert.deepEqual(unwrappedReport.unwrappedRoutes, [unwrapped.routeId]);
  assert.ok(unwrappedReport.reasonCodes.includes("route-uncovered"));
});

test("discovery-only completeness claims cannot override bypasses or unknown routing", () => {
  const direct: RouteCoverageV1 = { ...verifiedRoute(), routeId: `route_${"2".repeat(64)}`, discoverySource: "direct-http", transport: "https", observation: "uncovered", enforcement: "absent", topologyEvidenceDigest: null, reasonCodes: ["direct-http-bypass"] };
  const report = coverage.buildCoverageEnvelope(envelopeInput("codex", [verifiedRoute(), direct], {
    claims: { topology: { status: "verified", evidenceDigest: digest("e") }, completeness: { status: "verified", evidenceDigest: digest("f") } },
  }));
  assert.equal(report.status, "failed");
  assert.equal(report.mode, "observed");
  assert.ok(report.reasonCodes.includes("completeness-contradicted-by-inventory"));
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

test("the discovery-only contract rejects an enforced request and labels asserted provenance honestly", () => {
  assert.throws(() => coverage.buildCoverageEnvelope(envelopeInput("codex", [verifiedRoute()], {
    requestedMode: "enforced",
    claims: { topology: { status: "verified", evidenceDigest: digest("e") }, completeness: { status: "verified", evidenceDigest: digest("f") } },
  })), /invalid|requestedMode|observed/i);
  const input = envelopeInput("codex", [verifiedRoute()]);
  const report = coverage.buildCoverageEnvelope(input);
  assert.equal(report.status, "failed");
  assert.equal(report.mode, "observed");
  assert.ok(report.reasonCodes.includes("discovery-is-non-authorizing"));
  assert.ok(report.reasonCodes.includes("provenance-asserted-only"));
  assert.deepEqual(report.provenance, {
    status: "asserted",
    adapter: "asserted",
    sources: "asserted",
    routeEvidenceDigest: routeEvidenceDigest([verifiedRoute()]),
    inputCommitmentDigest: inputCommitmentDigest(input),
  });
  assert.match(report.integrityDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(coverage.validateCoverageEnvelopeReport(report, input), true);
  assert.equal(coverage.validateCoverageEnvelopeReport(report), false);
  assert.equal(coverage.validateCoverageEnvelopeReport({ ...report, surprise: true }, input), false);
});

test("the input contract binds built-in adapter identity and adapter-produced route evidence", () => {
  assert.throws(() => coverage.buildCoverageEnvelope({ ...envelopeInput("codex", [verifiedRoute()]), surprise: true }), /invalid|additional/i);
  assert.throws(() => coverage.buildCoverageEnvelope({ ...envelopeInput("codex", [verifiedRoute()]), adapter: { id: "reelier-claude-code-coverage", digest: BUILTIN_ROUTE_ADAPTERS.claudeCode.sourceDigest } }), /identity|invalid/i);
  assert.throws(() => coverage.buildCoverageEnvelope({ ...envelopeInput("codex", [verifiedRoute()]), adapter: { id: BUILTIN_ROUTE_ADAPTERS.codex.sourceId, digest: digest("f") } }), /adapter.*digest|provenance/i);
  assert.throws(() => coverage.buildCoverageEnvelope({ ...envelopeInput("codex", [verifiedRoute()]), routeEvidenceDigest: digest("f") }), /route.*evidence|commitment/i);

  const input = envelopeInput("codex", [verifiedRoute()]);
  const report = coverage.buildCoverageEnvelope(input);
  assert.match(report.integrityDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(coverage.validateCoverageEnvelopeReport({ ...report, harness: { ...report.harness, instanceIdentityDigest: digest("8") } }, input), false);
  assert.equal(coverage.validateCoverageEnvelopeReport(withIntegrity({ ...report, inventory: [{ ...report.inventory[0], evidenceDigest: digest("f") }] }), input), false);
});

test("source freshness is bounded and future-dated route or source observations are rejected", () => {
  const staleSource = freshSource("host-config", "a", "b");
  const stale = coverage.buildCoverageEnvelope(envelopeInput("codex", [verifiedRoute()], {
    evaluatedAt: new Date(now.getTime() + 60_001).toISOString(),
    sources: [{ ...staleSource, freshUntil: new Date(now.getTime() + 60_000).toISOString() }],
  }));
  assert.equal(stale.freshness.status, "stale");
  assert.ok(stale.reasonCodes.includes("evidence-stale"));

  assert.throws(() => coverage.buildCoverageEnvelope(envelopeInput("codex", [verifiedRoute()], {
    sources: [{ ...staleSource, observedAt: new Date(now.getTime() + 1).toISOString() }],
  })), /future|observation/i);
  assert.throws(() => coverage.buildCoverageEnvelope(envelopeInput("codex", [{ ...verifiedRoute(), observedAt: new Date(now.getTime() + 1).toISOString() }])), /future|observation/i);
  assert.throws(() => coverage.buildCoverageEnvelope(envelopeInput("codex", [{ ...verifiedRoute(), observedAt: "2026-99-99T01:00:00.000Z" }])), /time|timestamp|observation/i);
  assert.throws(() => coverage.buildCoverageEnvelope(envelopeInput("codex", [verifiedRoute()], { evaluatedAt: "2026-02-30T01:00:00.000Z" })), /time|timestamp|evaluated/i);
  assert.throws(() => coverage.buildCoverageEnvelope(envelopeInput("codex", [{ ...verifiedRoute(), freshUntil: new Date(now.getTime() + 24 * 60 * 60_000 + 1).toISOString() }])), /freshness|interval|bounded/i);
});

test("report validation recomputes reasons, route mappings, evidence, claims, and status invariants", () => {
  const input = envelopeInput("codex", [verifiedRoute()]);
  const report = coverage.buildCoverageEnvelope(input);
  assert.equal(coverage.validateCoverageEnvelopeReport({ ...report, adapter: { id: "reelier-claude-code-coverage", digest: BUILTIN_ROUTE_ADAPTERS.claudeCode.sourceDigest } }, input), false);
  assert.equal(coverage.validateCoverageEnvelopeReport({ ...report, inventory: [{ ...report.inventory[0], hostId: "claude-code" }] }, input), false);
  assert.equal(coverage.validateCoverageEnvelopeReport({ ...report, wrappedRoutes: [] }, input), false);
  assert.equal(coverage.validateCoverageEnvelopeReport({ ...report, directHttpRoutes: [report.inventory[0].routeId] }, input), false);
  assert.equal(coverage.validateCoverageEnvelopeReport({ ...report, claims: { ...report.claims, topology: { status: "verified", evidenceDigest: null } } }, input), false);
  assert.equal(coverage.validateCoverageEnvelopeReport(withIntegrity({ ...report, reasonCodes: report.reasonCodes.filter((reason: string) => reason !== "source-freshness-absent") }), input), false);
  assert.equal(coverage.validateCoverageEnvelopeReport(withIntegrity({ ...report, status: "passed", mode: "enforced", reasonCodes: [] }), input), false);
  assert.equal(coverage.validateCoverageEnvelopeReport(withIntegrity({ ...report, sources: [{ ...report.sources[0], evidenceStatus: "failed" }] }), input), false);
  assert.equal(coverage.validateCoverageEnvelopeReport({ ...report, provenance: { ...report.provenance, status: "verified" } }, input), false);
});

test("report validation rejects a recomputed route status upgrade without the original adapter input", () => {
  const originalRoute: RouteCoverageV1 = {
    ...verifiedRoute(), observation: "unknown", enforcement: "absent", topologyEvidenceDigest: null, reasonCodes: [],
  };
  const input = envelopeInput("codex", [originalRoute]);
  const report = coverage.buildCoverageEnvelope(input);
  const upgradedRoute = {
    ...report.inventory[0], observation: "observed", enforcement: "verified",
    topologyEvidenceDigest: digest("d"), reasonCodes: ["wrapped-route-observed"], routing: "wrapped",
  };
  const upgraded = withIntegrity({
    ...report,
    inventory: [upgradedRoute],
    wrappedRoutes: [upgradedRoute.routeId],
    reasonCodes: [
      "completeness-unchecked", "discovery-is-non-authorizing", "provenance-asserted-only",
      "source-freshness-absent", "topology-unchecked",
    ],
  });

  assert.equal(coverage.validateCoverageEnvelopeReport(upgraded, input), false);
});

test("report validation rejects a recomputed claim upgrade without the original input commitment", () => {
  const input = envelopeInput("codex", [verifiedRoute()]);
  const report = coverage.buildCoverageEnvelope(input);
  const upgraded = withIntegrity({
    ...report,
    claims: { ...report.claims, topology: { status: "verified", evidenceDigest: digest("e") } },
    reasonCodes: report.reasonCodes.filter((reason: string) => reason !== "topology-unchecked"),
  });

  assert.equal(coverage.validateCoverageEnvelopeReport(upgraded, input), false);
});

test("bypass reasons override conflicting wrapped evidence", () => {
  const conflicted = { ...verifiedRoute(), reasonCodes: ["wrapped-route-observed", "direct-http-bypass"] };
  const report = coverage.buildCoverageEnvelope(envelopeInput("codex", [conflicted]));
  assert.deepEqual(report.wrappedRoutes, []);
  assert.deepEqual(report.unwrappedRoutes, [conflicted.routeId]);
  assert.equal(report.inventory[0].routing, "unwrapped");
});

test("CLI refusal remains a closed schema-valid non-success envelope", () => {
  const cli = spawnSync(process.execPath, [resolve("conformance/coverage-envelope/v0/check.mjs")], { encoding: "utf8" });
  assert.equal(cli.status, 2);
  const report = JSON.parse(cli.stdout);
  assert.equal(report.status, "failed");
  assert.equal(coverage.validateCoverageEnvelopeReport(report), true);
  assert.ok(report.reasonCodes.includes("no-routes-discovered"));
  assert.equal(report.harness, null);
  assert.equal(report.adapter, null);
  assert.deepEqual(report.sources, []);
  assert.equal(report.provenance, null);
  assert.equal(report.integrityDigest, null);
  assert.equal(coverage.validateCoverageEnvelopeReport({ ...report, reasonCodes: ["input-unavailable"] }), false);
  assert.equal(coverage.validateCoverageEnvelopeReport({ ...report, freshness: { ...report.freshness, evaluatedAt: "2026-99-99T00:00:00.000Z" } }), false);
  assert.equal(coverage.validateCoverageEnvelopeReport({ ...report, claims: { ...report.claims, topology: { status: "unchecked", evidenceDigest: null } } }), false);
});
