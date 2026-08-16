import { canonicalJson, digestSha256 } from "../canonical-json.js";
import { assertOwnDataTree } from "../bootstrap/normalize.js";
import { liveCoverageEvidenceDigest, staticCoverageEvidenceDigest } from "../coverage.js";
import type { CodexCoverageReport, CoverageRouteSourceEvidence, CoverageView } from "../coverage.js";
import type { RouteCoverageV1 } from "./types.js";
import { translateCodexCoverage, type TranslateCodexCoverageInputV1 } from "./hosts/codex.js";
import { translateClaudeCodeCoverage, type TranslateClaudeCodeCoverageInputV1 } from "./hosts/claude-code.js";

const SHA256 = /^sha256:[0-9a-f]{64}$/;
export const MAX_ROUTE_FRESHNESS_MS = 24 * 60 * 60_000;

export interface HarnessRouteSurfaceV1 {
  readonly sourceInstanceIdentityDigest: string;
  readonly routeKey: string;
  readonly discoverySource: RouteCoverageV1["discoverySource"];
  readonly transport: RouteCoverageV1["transport"];
  readonly observation: RouteCoverageV1["observation"];
  readonly replay: RouteCoverageV1["replay"];
  readonly outcome: RouteCoverageV1["outcome"];
  readonly enforcement: RouteCoverageV1["enforcement"];
  readonly topologyEvidenceDigest: string | null;
  readonly evidenceRefs: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly catalogMetadata: boolean;
}

export interface HarnessSourceInstanceV1 {
  readonly sourceRef: string;
  readonly sourceInstanceIdentityDigest: string;
  readonly canonicalBytes: string;
  readonly fileIdentityDigest: string;
  readonly evidenceKind?: "static" | "live" | "absent";
}

export interface CodexRouteDiscoverySnapshotV1 { readonly v: "reelier.route-discovery-snapshot/v1"; readonly harnessId: "codex" }
export interface ClaudeCodeRouteDiscoverySnapshotV1 { readonly v: "reelier.route-discovery-snapshot/v1"; readonly harnessId: "claude-code" }
export type RouteDiscoverySnapshotV1 = CodexRouteDiscoverySnapshotV1 | ClaudeCodeRouteDiscoverySnapshotV1;

export type HarnessRouteFindingKindV1 = "direct-http" | "writable-browser" | "openapi" | "host-private" | "reviewed-mcp" | "activated-native" | "unreadable-registry" | "replay-candidate" | "outcome-candidate" | "shadow-candidate" | "unsupported-candidate";
export interface HarnessRouteFindingV1 { readonly kind: HarnessRouteFindingKindV1; readonly routeKey: string; readonly sourceRef: string }

export interface CreateCodexRouteDiscoverySnapshotInputV1 {
  readonly report: CodexCoverageReport;
  readonly observedAt: string;
  readonly freshnessMs: number;
  readonly contractIdentityDigest: string;
  readonly findings: readonly HarnessRouteFindingV1[];
}

export interface CreateClaudeCodeRouteDiscoverySnapshotInputV1 {
  readonly view: CoverageView;
  readonly observedAt: string;
  readonly freshnessMs: number;
  readonly contractIdentityDigest: string;
  readonly findings: readonly HarnessRouteFindingV1[];
}

export interface RouteDiscoveryAdapterV1 {
  readonly sourceId: "reelier-codex-coverage" | "reelier-claude-code-coverage";
  readonly harnessId: "codex" | "claude-code";
  readonly sourceVersion: string;
  readonly sourceDigest: string;
  readonly discover: (snapshot: RouteDiscoverySnapshotV1) => Promise<readonly RouteCoverageV1[]>;
}

export interface RouteDiscoveryAdapterRegistryV1 {
  readonly v: "reelier.route-discovery-adapter-registry/v1";
  readonly adapterDigests: readonly string[];
}

export interface RouteAdapterIdentityV1 {
  readonly sourceId: RouteDiscoveryAdapterV1["sourceId"];
  readonly harnessId: RouteDiscoveryAdapterV1["harnessId"];
  readonly sourceVersion: string;
  readonly sourceDigest: string;
}

export const BUILTIN_ROUTE_ADAPTERS = Object.freeze({
  codex: identity("reelier-codex-coverage", "codex"),
  claudeCode: identity("reelier-claude-code-coverage", "claude-code"),
});

const installedAdapters = Object.freeze([
  Object.freeze({ ...BUILTIN_ROUTE_ADAPTERS.codex, discover: async (snapshot: RouteDiscoverySnapshotV1) => translateCodexCoverage(snapshotPayload(snapshot, "codex") as TranslateCodexCoverageInputV1) }),
  Object.freeze({ ...BUILTIN_ROUTE_ADAPTERS.claudeCode, discover: async (snapshot: RouteDiscoverySnapshotV1) => translateClaudeCodeCoverage(snapshotPayload(snapshot, "claude-code") as TranslateClaudeCodeCoverageInputV1) }),
] satisfies readonly RouteDiscoveryAdapterV1[]);

const registryPayload = new WeakMap<RouteDiscoveryAdapterRegistryV1, readonly RouteDiscoveryAdapterV1[]>();
const snapshots = new WeakMap<RouteDiscoverySnapshotV1, TranslateCodexCoverageInputV1 | TranslateClaudeCodeCoverageInputV1>();

export function createRouteDiscoveryAdapterRegistryV1(): RouteDiscoveryAdapterRegistryV1 {
  const registry = Object.freeze({ v: "reelier.route-discovery-adapter-registry/v1" as const, adapterDigests: Object.freeze(installedAdapters.map(value => value.sourceDigest).sort()) });
  registryPayload.set(registry, installedAdapters);
  return registry;
}

export function installedRouteDiscoveryAdapters(registry: RouteDiscoveryAdapterRegistryV1): readonly RouteDiscoveryAdapterV1[] {
  const payload = registryPayload.get(registry);
  if (!payload) throw new TypeError("route discovery adapter registry is not installed by Reelier");
  return payload;
}

export function createCodexRouteDiscoverySnapshotV1(input: CreateCodexRouteDiscoverySnapshotInputV1): CodexRouteDiscoverySnapshotV1 {
  assertExactRecord(input, ["report", "observedAt", "freshnessMs", "contractIdentityDigest", "findings"], "Codex route snapshot input");
  const payload = createPayload("codex", input.report, input.observedAt, input.freshnessMs, input.contractIdentityDigest, input.findings) as TranslateCodexCoverageInputV1;
  const snapshot = Object.freeze({ v: "reelier.route-discovery-snapshot/v1" as const, harnessId: "codex" as const });
  snapshots.set(snapshot, payload);
  return snapshot;
}

export function createClaudeCodeRouteDiscoverySnapshotV1(input: CreateClaudeCodeRouteDiscoverySnapshotInputV1): ClaudeCodeRouteDiscoverySnapshotV1 {
  assertExactRecord(input, ["view", "observedAt", "freshnessMs", "contractIdentityDigest", "findings"], "Claude Code route snapshot input");
  const payload = createPayload("claude-code", input.view, input.observedAt, input.freshnessMs, input.contractIdentityDigest, input.findings) as TranslateClaudeCodeCoverageInputV1;
  const snapshot = Object.freeze({ v: "reelier.route-discovery-snapshot/v1" as const, harnessId: "claude-code" as const });
  snapshots.set(snapshot, payload);
  return snapshot;
}

export function buildHarnessRouteRow(input: Readonly<{
  adapter: RouteAdapterIdentityV1;
  harnessId: "codex" | "claude-code";
  observedAt: string;
  freshnessMs: number;
  observationSourceDigest: string;
  contractIdentityDigest: string;
  surface: HarnessRouteSurfaceV1;
  evidence: HarnessSourceInstanceV1;
}>): RouteCoverageV1 {
  assertOwnDataTree(input, "route adapter observation");
  if (input.adapter.harnessId !== input.harnessId) throw new TypeError("route adapter harness identity is invalid");
  assertEnvelope(input.observedAt, input.freshnessMs, input.observationSourceDigest, input.contractIdentityDigest);
  if (!SHA256.test(input.surface.sourceInstanceIdentityDigest) || !SHA256.test(input.evidence.sourceInstanceIdentityDigest) || input.surface.sourceInstanceIdentityDigest !== input.evidence.sourceInstanceIdentityDigest) throw new TypeError("route source instance identity is invalid");
  const catalog = input.surface.catalogMetadata;
  const observation = catalog ? "unknown" : input.surface.observation;
  const replay = catalog ? "candidate" : input.surface.replay;
  const outcome = catalog ? "unknown" : input.surface.outcome;
  const enforcement = catalog ? "absent" : input.surface.enforcement;
  const topologyEvidenceDigest = catalog ? null : input.surface.topologyEvidenceDigest;
  const routeId = opaqueRouteId({
    v: "reelier.route-identity/v1", harnessId: input.harnessId, adapterSourceId: input.adapter.sourceId,
    sourceInstanceIdentityDigest: input.surface.sourceInstanceIdentityDigest, discoverySource: input.surface.discoverySource,
    routeKey: input.surface.routeKey, transport: input.surface.transport,
  });
  const reasonCodes = catalog ? [...input.surface.reasonCodes, "catalog-is-non-authorizing"] : [...input.surface.reasonCodes];
  return Object.freeze({
    v: "reelier.route-coverage/v1", routeId, hostId: input.harnessId, discoverySource: input.surface.discoverySource,
    transport: input.surface.transport, observation, replay, outcome, enforcement, observedAt: input.observedAt,
    freshUntil: new Date(Date.parse(input.observedAt) + input.freshnessMs).toISOString(),
    evidenceDigest: digestSha256({
      v: "reelier.route-evidence/v1", adapterSourceId: input.adapter.sourceId, adapterSourceVersion: input.adapter.sourceVersion,
      adapterSourceDigest: input.adapter.sourceDigest, observationSourceDigest: input.observationSourceDigest,
      contractIdentityDigest: input.contractIdentityDigest, sourceEvidenceDigest: sourceEvidenceDigest(input.adapter, input.observationSourceDigest, input.evidence),
      routeId, observation, replay, outcome, enforcement, topologyEvidenceDigest,
    }),
    topologyEvidenceDigest, evidenceRefs: Object.freeze([...input.surface.evidenceRefs].sort()),
    reasonCodes: Object.freeze([...new Set(reasonCodes)].sort()),
  });
}

function sourceEvidenceDigest(adapter: RouteAdapterIdentityV1, observationSourceDigest: string, evidence: HarnessSourceInstanceV1): string {
  if ((evidence.evidenceKind ?? "static") === "static") return staticCoverageEvidenceDigest({
    sourceId: adapter.sourceId, sourceVersion: adapter.sourceVersion, sourceDigest: observationSourceDigest,
    canonicalBytes: evidence.canonicalBytes, fileIdentityDigest: evidence.fileIdentityDigest,
  });
  return liveCoverageEvidenceDigest({
    sourceId: adapter.sourceId, sourceVersion: adapter.sourceVersion, sourceDigest: observationSourceDigest,
    observation: { evidenceKind: evidence.evidenceKind, canonicalObservation: evidence.canonicalBytes },
  });
}

function identity(sourceId: RouteAdapterIdentityV1["sourceId"], harnessId: RouteAdapterIdentityV1["harnessId"]): RouteAdapterIdentityV1 {
  const sourceVersion = "1.0.0";
  return Object.freeze({ sourceId, harnessId, sourceVersion, sourceDigest: digestSha256({ v: "reelier.route-discovery-adapter/v1", sourceId, harnessId, sourceVersion }) });
}

function opaqueRouteId(identityValue: unknown): string {
  return `route_${digestSha256(identityValue).slice("sha256:".length)}`;
}

function assertEnvelope(observedAt: string, freshnessMs: number, sourceDigest: string, contractIdentityDigest: string): void {
  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== observedAt) throw new TypeError("route observation time is invalid");
  if (!Number.isSafeInteger(freshnessMs) || freshnessMs <= 0 || freshnessMs > MAX_ROUTE_FRESHNESS_MS) throw new TypeError("route freshness must be finite and bounded");
  if (!SHA256.test(sourceDigest) || !SHA256.test(contractIdentityDigest)) throw new TypeError("route evidence identity is invalid");
}

function snapshotPayload(snapshot: RouteDiscoverySnapshotV1, harnessId: RouteDiscoverySnapshotV1["harnessId"]): TranslateCodexCoverageInputV1 | TranslateClaudeCodeCoverageInputV1 {
  const payload = snapshots.get(snapshot);
  if (!payload || snapshot.harnessId !== harnessId) throw new TypeError("route discovery snapshot lacks Reelier provenance");
  return payload;
}

function createPayload(
  harnessId: "codex" | "claude-code",
  collector: CodexCoverageReport | CoverageView,
  observedAt: string,
  freshnessMs: number,
  contractIdentityDigest: string,
  findings: readonly HarnessRouteFindingV1[],
): TranslateCodexCoverageInputV1 | TranslateClaudeCodeCoverageInputV1 {
  assertOwnDataTree(collector, `${harnessId} coverage collector result`);
  assertEnvelope(observedAt, freshnessMs, digestSha256(sanitizeCollector(collector)), contractIdentityDigest);
  if (!Array.isArray(findings)) throw new TypeError("route findings must be an array");
  const detachedCollector = detachAndFreeze(collector);
  const detachedFindings = detachAndFreeze(findings);
  const routeEvidence = detachedCollector.routeEvidence ?? [];
  const sourceRefs = new Set<string>([
    ...routeEvidence.map(value => value.sourceRef),
    ...collectorOrigins(detachedCollector),
    ...detachedFindings.map(value => value.sourceRef),
  ]);
  const sourceInstances = Object.freeze([...sourceRefs].map(sourceRef => sourceEvidence(harnessId, sourceRef, routeEvidence, detachedCollector, detachedFindings)));
  const surfaces = Object.freeze(detachedFindings.map(value => surfaceFromFinding(harnessId, value, sourceInstances)));
  const common = {
    observedAt, freshnessMs, contractIdentityDigest, sourceDigest: digestSha256({ v: "reelier.route-collector-evidence/v1", harnessId, collector: sanitizeCollector(detachedCollector), routeEvidence }),
    sourceInstances, surfaces,
  };
  if (harnessId === "codex") {
    const report = detachedCollector as CodexCoverageReport;
    const configEvidence = sourceInstances.find(value => value.sourceRef === report.configPath) ?? sourceEvidence(harnessId, report.configPath, routeEvidence, detachedCollector, detachedFindings);
    return deepFreeze({ report, ...common, canonicalConfigBytes: configEvidence.canonicalBytes, fileIdentityDigest: configEvidence.fileIdentityDigest });
  }
  return deepFreeze({ view: detachedCollector as CoverageView, ...common });
}

function detachAndFreeze<T>(value: T): T {
  return deepFreeze(JSON.parse(canonicalJson(value)) as T);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function surfaceFromFinding(harnessId: "codex" | "claude-code", finding: HarnessRouteFindingV1, sourceInstances: readonly HarnessSourceInstanceV1[]): HarnessRouteSurfaceV1 {
  assertExactRecord(finding, ["kind", "routeKey", "sourceRef"], "route finding");
  if (!/^[A-Za-z0-9._~-]{1,128}$/.test(finding.routeKey) || typeof finding.sourceRef !== "string" || finding.sourceRef.length === 0) throw new TypeError("route finding identity is invalid");
  const sourceInstanceIdentityDigest = sourceInstances.find(value => value.sourceRef === finding.sourceRef)?.sourceInstanceIdentityDigest;
  if (!sourceInstanceIdentityDigest) throw new TypeError("route finding source instance evidence is missing");
  const fixed: Record<HarnessRouteFindingKindV1, Omit<HarnessRouteSurfaceV1, "sourceInstanceIdentityDigest" | "routeKey">> = {
    "direct-http": { discoverySource: "direct-http", transport: "https", observation: "uncovered", replay: "unknown", outcome: "unknown", enforcement: "absent", topologyEvidenceDigest: null, evidenceRefs: [`source:${harnessId}:direct-http`], reasonCodes: ["direct-http-bypass"], catalogMetadata: false },
    "writable-browser": { discoverySource: "writable-browser", transport: "browser", observation: "uncovered", replay: "unknown", outcome: "unknown", enforcement: "absent", topologyEvidenceDigest: null, evidenceRefs: [`source:${harnessId}:writable-browser`], reasonCodes: ["writable-browser-bypass"], catalogMetadata: false },
    openapi: { discoverySource: "openapi", transport: "https", observation: "unknown", replay: "candidate", outcome: "unknown", enforcement: "absent", topologyEvidenceDigest: null, evidenceRefs: [`source:${harnessId}:openapi`], reasonCodes: [], catalogMetadata: true },
    "host-private": { discoverySource: "host-private", transport: "opaque-host", observation: "partially-observed", replay: "unknown", outcome: "shadow-only", enforcement: "absent", topologyEvidenceDigest: null, evidenceRefs: [`source:${harnessId}:host-private`], reasonCodes: ["host-private"], catalogMetadata: false },
    "reviewed-mcp": { discoverySource: "host-config", transport: "mcp-stdio", observation: "observed", replay: "available", outcome: "outcome-capable", enforcement: "unchecked", topologyEvidenceDigest: null, evidenceRefs: [`source:${harnessId}:reviewed-mcp`], reasonCodes: ["reviewed-mcp"], catalogMetadata: false },
    "activated-native": { discoverySource: "native-config", transport: "https", observation: "observed", replay: "unavailable", outcome: "activated", enforcement: "unchecked", topologyEvidenceDigest: null, evidenceRefs: [`source:${harnessId}:native-config`], reasonCodes: ["activated-not-topology-verified"], catalogMetadata: false },
    "unreadable-registry": { discoverySource: "plugin-manifest", transport: "unknown", observation: "unknown", replay: "unknown", outcome: "unknown", enforcement: "absent", topologyEvidenceDigest: null, evidenceRefs: [`source:${harnessId}:plugin-registry`], reasonCodes: ["registry-unreadable"], catalogMetadata: false },
    "replay-candidate": { discoverySource: "unknown", transport: "unknown", observation: "unknown", replay: "candidate", outcome: "unknown", enforcement: "absent", topologyEvidenceDigest: null, evidenceRefs: [`source:${harnessId}:path-b`], reasonCodes: ["replay-candidate-only"], catalogMetadata: false },
    "outcome-candidate": { discoverySource: "native-config", transport: "https", observation: "partially-observed", replay: "unknown", outcome: "outcome-capable", enforcement: "unchecked", topologyEvidenceDigest: null, evidenceRefs: [`source:${harnessId}:path-c`], reasonCodes: ["outcome-capable-not-activated"], catalogMetadata: false },
    "shadow-candidate": { discoverySource: "unknown", transport: "unknown", observation: "unknown", replay: "unknown", outcome: "shadow-only", enforcement: "absent", topologyEvidenceDigest: null, evidenceRefs: [`source:${harnessId}:path-c`], reasonCodes: ["shadow-only"] , catalogMetadata: false },
    "unsupported-candidate": { discoverySource: "unknown", transport: "unknown", observation: "unknown", replay: "unavailable", outcome: "unsupported", enforcement: "absent", topologyEvidenceDigest: null, evidenceRefs: [`source:${harnessId}:path-c`], reasonCodes: ["unsupported"] , catalogMetadata: false },
  };
  const value = fixed[finding.kind];
  if (!value) throw new TypeError("route finding kind is invalid");
  return Object.freeze({ sourceInstanceIdentityDigest, routeKey: finding.routeKey, ...value });
}

function collectorOrigins(collector: CodexCoverageReport | CoverageView): string[] {
  if ("config" in collector) return [collector.configPath, ...collector.config.servers.map(server => server.origin), ...collector.plugins.flatMap(plugin => plugin.servers.map(server => server.origin))];
  return [...collector.sources.flatMap(source => [source.path, ...source.servers.map(server => server.origin)]), ...(collector.pluginSource ? [collector.pluginSource] : []), ...collector.plugins.flatMap(plugin => [plugin.manifestPath ?? plugin.registration.name, ...plugin.servers.map(server => server.origin)])];
}

function sourceEvidence(harnessId: "codex" | "claude-code", sourceRef: string, evidence: readonly CoverageRouteSourceEvidence[], collector: CodexCoverageReport | CoverageView, findings: readonly HarnessRouteFindingV1[]): HarnessSourceInstanceV1 {
  const exact = evidence.find(value => value.sourceRef === sourceRef);
  const sourceInstanceIdentityDigest = digestSha256({ v: "reelier.route-source-instance/v1", harnessId, sourceRef });
  if (exact) {
    if (!SHA256.test(exact.sourceInstanceIdentityDigest) || !SHA256.test(exact.fileIdentityDigest)) throw new TypeError("route source evidence identity is invalid");
    return Object.freeze({ ...exact, evidenceKind: "static" as const });
  }
  const findingKinds = findings.filter(value => value.sourceRef === sourceRef).map(value => value.kind).sort();
  const evidenceKind = findingKinds.length > 0 ? "live" : "absent";
  return Object.freeze({
    sourceRef, sourceInstanceIdentityDigest, evidenceKind,
    canonicalBytes: canonicalJson({ v: "reelier.sanitized-route-source/v1", harnessId, sourceKnown: collectorOrigins(collector).includes(sourceRef), findingKinds }),
    fileIdentityDigest: digestSha256({ v: "reelier.route-source-without-static-evidence/v1", harnessId, sourceInstanceIdentityDigest, evidenceKind }),
  });
}

function sanitizeCollector(collector: CodexCoverageReport | CoverageView): unknown {
  if ("config" in collector) return { config: { location: collector.config.location, servers: collector.config.servers.map(server => ({ name: server.name, location: server.location, transport: server.transport ?? null, routing: server.routing ?? null })) }, plugins: collector.plugins.map(plugin => ({ registration: plugin.registration, inspected: plugin.inspected, location: plugin.location, servers: plugin.servers.map(server => ({ name: server.name, location: server.location, transport: server.transport ?? null, routing: server.routing ?? null })) })) };
  return { host: collector.host, sources: collector.sources.map(source => ({ location: source.location, servers: source.servers.map(server => ({ name: server.name, location: server.location, transport: server.transport ?? null, routing: server.routing ?? null })) })), pluginRegistry: collector.pluginRegistry ?? null, plugins: collector.plugins.map(plugin => ({ registration: plugin.registration, inspected: plugin.inspected, location: plugin.location, servers: plugin.servers.map(server => ({ name: server.name, location: server.location, transport: server.transport ?? null, routing: server.routing ?? null })) })) };
}

function assertExactRecord(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  assertOwnDataTree(value, label);
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain record`);
  const actual = Reflect.ownKeys(value);
  if (actual.some(key => typeof key !== "string") || actual.length !== keys.length || keys.some(key => !actual.includes(key))) throw new TypeError(`${label} has unknown fields`);
}
