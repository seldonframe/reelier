import { canonicalJson, digestSha256 } from "../../canonical-json.js";
import type { CoverageServer, CoverageView } from "../../coverage.js";
import { BUILTIN_ROUTE_ADAPTERS, buildHarnessRouteRow, type HarnessRouteSurfaceV1, type HarnessSourceInstanceV1 } from "../adapters.js";
import type { RouteCoverageV1 } from "../types.js";

export interface TranslateClaudeCodeCoverageInputV1 {
  readonly view: CoverageView;
  readonly observedAt: string;
  readonly freshnessMs: number;
  readonly sourceDigest: string;
  readonly contractIdentityDigest: string;
  readonly sourceInstances: readonly HarnessSourceInstanceV1[];
  readonly surfaces: readonly HarnessRouteSurfaceV1[];
}

export function translateClaudeCodeCoverage(input: TranslateClaudeCodeCoverageInputV1): readonly RouteCoverageV1[] {
  const rows: RouteCoverageV1[] = [];
  for (const sourceView of input.view.sources) {
    const evidence = source(input, sourceView.path);
    if (sourceView.location !== "parsed") rows.push(row(input, unknownSurface(evidence, "host-config", sourceView.path.includes("#projects/") ? "project-registry" : "registry", sourceView.location === "unreadable" ? "config-unreadable" : "config-absent"), evidence));
    for (const server of sourceView.servers) rows.push(serverRow(input, server, "host-config", source(input, server.origin)));
  }
  if (input.view.pluginRegistry && input.view.pluginRegistry.location !== "parsed") {
    const evidence = source(input, "plugin-registry");
    rows.push(row(input, unknownSurface(evidence, "plugin-manifest", "registry", input.view.pluginRegistry.location === "unreadable" ? "registry-unreadable" : "registry-absent"), evidence));
  }
  for (const plugin of input.view.plugins) {
    const evidence = source(input, plugin.manifestPath ?? plugin.registration.name);
    if (!plugin.inspected || plugin.location !== "parsed") {
      if (plugin.enablement?.state !== "disabled" && plugin.registration.enabled && plugin.location !== "parsed") rows.push(row(input, unknownSurface(evidence, "plugin-manifest", plugin.registration.name, plugin.location === "unreadable" ? "plugin-unreadable" : "plugin-missing"), evidence));
      continue;
    }
    for (const server of plugin.servers) rows.push(serverRow(input, server, "plugin-manifest", source(input, server.origin)));
  }
  for (const surface of input.surfaces) rows.push(row(input, surface, surfaceEvidence(input, surface)));
  return Object.freeze(rows.sort((left, right) => Buffer.from(left.discoverySource).compare(Buffer.from(right.discoverySource)) || Buffer.from(left.routeId).compare(Buffer.from(right.routeId))));
}

function serverRow(input: TranslateClaudeCodeCoverageInputV1, server: CoverageServer, discoverySource: "host-config" | "plugin-manifest", evidence: HarnessSourceInstanceV1): RouteCoverageV1 {
  const wrapped = server.location === "parsed" && server.routing === "wrapped";
  const unreadable = server.location === "unreadable" || server.routing === undefined;
  return row(input, { sourceInstanceIdentityDigest: evidence.sourceInstanceIdentityDigest, routeKey: server.name, discoverySource, transport: server.transport === "url" ? "mcp-http" : server.transport === "stdio" ? "mcp-stdio" : "unknown", observation: unreadable ? "unknown" : wrapped ? "observed" : "uncovered", replay: "unknown", outcome: "unknown", enforcement: wrapped ? "unchecked" : "absent", topologyEvidenceDigest: null, evidenceRefs: [`source:claude-code:${discoverySource}`], reasonCodes: unreadable ? ["entry-unreadable"] : wrapped ? ["wrapped-route-observed"] : [discoverySource === "plugin-manifest" ? "plugin-private" : "route-unwrapped"], catalogMetadata: false }, evidence);
}

function row(input: TranslateClaudeCodeCoverageInputV1, surface: HarnessRouteSurfaceV1, evidence: HarnessSourceInstanceV1): RouteCoverageV1 {
  return buildHarnessRouteRow({ adapter: BUILTIN_ROUTE_ADAPTERS.claudeCode, harnessId: "claude-code", observedAt: input.observedAt, freshnessMs: input.freshnessMs, observationSourceDigest: input.sourceDigest, contractIdentityDigest: input.contractIdentityDigest, surface, evidence });
}

function source(input: TranslateClaudeCodeCoverageInputV1, sourceRef: string): HarnessSourceInstanceV1 {
  const found = input.sourceInstances.find(value => value.sourceRef === sourceRef);
  if (found) return found;
  throw new TypeError("Claude Code route source instance evidence is missing");
}

function surfaceEvidence(input: TranslateClaudeCodeCoverageInputV1, surface: HarnessRouteSurfaceV1): HarnessSourceInstanceV1 {
  const found = input.sourceInstances.find(value => value.sourceInstanceIdentityDigest === surface.sourceInstanceIdentityDigest);
  return found ?? { sourceRef: "sanitized-harness-surface", sourceInstanceIdentityDigest: surface.sourceInstanceIdentityDigest, canonicalBytes: canonicalJson({ discoverySource: surface.discoverySource, transport: surface.transport, observation: surface.observation, replay: surface.replay, outcome: surface.outcome, enforcement: surface.enforcement, topologyEvidenceDigest: surface.topologyEvidenceDigest, evidenceRefs: surface.evidenceRefs, reasonCodes: surface.reasonCodes, catalogMetadata: surface.catalogMetadata }), fileIdentityDigest: surface.sourceInstanceIdentityDigest };
}

function unknownSurface(evidence: HarnessSourceInstanceV1, discoverySource: "host-config" | "plugin-manifest", routeKey: string, reason: string): HarnessRouteSurfaceV1 {
  return { sourceInstanceIdentityDigest: evidence.sourceInstanceIdentityDigest, routeKey, discoverySource, transport: "unknown", observation: "unknown", replay: "unknown", outcome: "unknown", enforcement: "absent", topologyEvidenceDigest: null, evidenceRefs: [`source:claude-code:${discoverySource}`], reasonCodes: [reason], catalogMetadata: false };
}

export function claudeCodeSourceInstanceIdentity(sourceRef: string): string {
  return digestSha256({ v: "reelier.route-source-instance/v1", harnessId: "claude-code", sourceRef });
}
