import type { CodexCoverageReport, CoverageServer, PluginCoverage } from "../../coverage.js";
import { BUILTIN_ROUTE_ADAPTERS, buildHarnessRouteRow, type HarnessRouteSurfaceV1, type HarnessSourceInstanceV1 } from "../adapters.js";
import type { RouteCoverageV1 } from "../types.js";

export interface TranslateCodexCoverageInputV1 {
  readonly report: CodexCoverageReport;
  readonly observedAt: string;
  readonly freshnessMs: number;
  readonly sourceDigest: string;
  readonly contractIdentityDigest: string;
  readonly canonicalConfigBytes: string;
  readonly fileIdentityDigest: string;
  readonly sourceInstances: readonly HarnessSourceInstanceV1[];
  readonly surfaces: readonly HarnessRouteSurfaceV1[];
}

export function translateCodexCoverage(input: TranslateCodexCoverageInputV1): readonly RouteCoverageV1[] {
  const rows: RouteCoverageV1[] = [];
  if (input.report.config.location !== "parsed") rows.push(row(input, unknownSurface(source(input, input.report.configPath), "host-config", "registry", input.report.config.location === "unreadable" ? "config-unreadable" : "config-absent"), source(input, input.report.configPath)));
  for (const server of input.report.config.servers) rows.push(serverRow(input, server, "host-config", source(input, server.origin)));
  for (const plugin of input.report.plugins) {
    const pluginSource = source(input, plugin.manifestPath ?? plugin.registration.name);
    if (!plugin.inspected || plugin.location !== "parsed") {
      if (plugin.registration.enabled && plugin.location !== "parsed") rows.push(row(input, unknownPluginSurface(plugin, pluginSource), pluginSource));
      continue;
    }
    for (const server of plugin.servers) rows.push(serverRow(input, server, "plugin-manifest", source(input, server.origin)));
  }
  for (const surface of input.surfaces) rows.push(row(input, surface, surfaceEvidence(input, surface)));
  return Object.freeze(rows.sort((left, right) => Buffer.from(left.discoverySource).compare(Buffer.from(right.discoverySource)) || Buffer.from(left.routeId).compare(Buffer.from(right.routeId))));
}

function serverRow(input: TranslateCodexCoverageInputV1, server: CoverageServer, discoverySource: "host-config" | "plugin-manifest", evidence: HarnessSourceInstanceV1): RouteCoverageV1 {
  const wrapped = server.location === "parsed" && server.routing === "wrapped";
  const staticEvidenceAbsent = evidence.evidenceKind === "absent";
  const unreadable = server.location === "unreadable" || server.routing === undefined || staticEvidenceAbsent;
  return row(input, {
    sourceInstanceIdentityDigest: evidence.sourceInstanceIdentityDigest, routeKey: server.name, discoverySource,
    transport: server.transport === "url" ? "mcp-http" : server.transport === "stdio" ? "mcp-stdio" : "unknown",
    observation: unreadable ? "unknown" : wrapped ? "observed" : "uncovered", replay: "unknown", outcome: "unknown",
    enforcement: wrapped && !unreadable ? "unchecked" : "absent", topologyEvidenceDigest: null,
    evidenceRefs: [`source:codex:${discoverySource}`], reasonCodes: staticEvidenceAbsent ? ["static-evidence-absent"] : unreadable ? ["entry-unreadable"] : wrapped ? ["wrapped-route-observed"] : [discoverySource === "plugin-manifest" ? "plugin-private" : "route-unwrapped"], catalogMetadata: false,
  }, evidence);
}

function row(input: TranslateCodexCoverageInputV1, surface: HarnessRouteSurfaceV1, evidence: HarnessSourceInstanceV1): RouteCoverageV1 {
  return buildHarnessRouteRow({ adapter: BUILTIN_ROUTE_ADAPTERS.codex, harnessId: "codex", observedAt: input.observedAt, freshnessMs: input.freshnessMs, observationSourceDigest: input.sourceDigest, contractIdentityDigest: input.contractIdentityDigest, surface, evidence });
}

function source(input: TranslateCodexCoverageInputV1, sourceRef: string): HarnessSourceInstanceV1 {
  const found = input.sourceInstances.find(value => value.sourceRef === sourceRef);
  if (found) return found;
  throw new TypeError("Codex route source instance evidence is missing");
}

function surfaceEvidence(input: TranslateCodexCoverageInputV1, surface: HarnessRouteSurfaceV1): HarnessSourceInstanceV1 {
  const found = input.sourceInstances.find(value => value.sourceInstanceIdentityDigest === surface.sourceInstanceIdentityDigest);
  if (!found) throw new TypeError("Codex harness surface evidence is missing");
  return found;
}

function unknownSurface(evidence: HarnessSourceInstanceV1, discoverySource: "host-config", routeKey: string, reason: string): HarnessRouteSurfaceV1 {
  return { sourceInstanceIdentityDigest: evidence.sourceInstanceIdentityDigest, routeKey, discoverySource, transport: "unknown", observation: "unknown", replay: "unknown", outcome: "unknown", enforcement: "absent", topologyEvidenceDigest: null, evidenceRefs: ["source:codex:host-config"], reasonCodes: [reason], catalogMetadata: false };
}

function unknownPluginSurface(plugin: PluginCoverage, evidence: HarnessSourceInstanceV1): HarnessRouteSurfaceV1 {
  return { sourceInstanceIdentityDigest: evidence.sourceInstanceIdentityDigest, routeKey: plugin.registration.name, discoverySource: "plugin-manifest", transport: "unknown", observation: "unknown", replay: "unknown", outcome: "unknown", enforcement: "absent", topologyEvidenceDigest: null, evidenceRefs: ["source:codex:plugin-registry"], reasonCodes: [plugin.location === "unreadable" ? "plugin-unreadable" : "plugin-missing"], catalogMetadata: false };
}
