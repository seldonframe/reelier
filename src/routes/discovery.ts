import { digestSha256 } from "../canonical-json.js";
import { normalizeRouteCoverageV1, parseRouteCoverageV1 } from "./normalize.js";
import { installedRouteDiscoveryAdapters, type RouteDiscoveryAdapterRegistryV1, type RouteDiscoverySnapshotV1 } from "./adapters.js";
import type { RouteCoverageV1 } from "./types.js";

export interface DiscoverRouteCoverageInputV1 {
  readonly registry: RouteDiscoveryAdapterRegistryV1;
  readonly now: Date;
  readonly snapshots: readonly RouteDiscoverySnapshotV1[];
  readonly baseline?: readonly unknown[];
}

export async function discoverRouteCoverage(input: DiscoverRouteCoverageInputV1): Promise<readonly RouteCoverageV1[]> {
  assertClock(input.now);
  const adapters = installedRouteDiscoveryAdapters(input.registry);
  const rows: RouteCoverageV1[] = [];
  for (const snapshot of input.snapshots) {
    const adapter = adapters.find(value => value.harnessId === snapshot.harnessId);
    if (!adapter) throw new TypeError(`no installed route discovery adapter for ${snapshot.harnessId}`);
    rows.push(...await adapter.discover(snapshot));
  }
  const normalized = normalizeRouteCoverageV1(rows);
  const ordered = Object.freeze([...normalized].sort(compareDiscoveredRows));
  return input.baseline ? refreshRouteCoverage({ baseline: input.baseline, current: ordered, now: input.now }) : ordered;
}

export function refreshRouteCoverage(input: Readonly<{ baseline: readonly unknown[]; current: readonly unknown[]; now: Date }>): readonly RouteCoverageV1[] {
  assertClock(input.now);
  const baseline = normalizeRouteCoverageV1(input.baseline);
  const current = normalizeRouteCoverageV1(input.current);
  const currentById = new Map(current.map(row => [row.routeId, row]));
  const rows: RouteCoverageV1[] = [];
  for (const prior of baseline) {
    const next = currentById.get(prior.routeId);
    currentById.delete(prior.routeId);
    if (!next) rows.push(downgrade(prior, input.now, Date.parse(prior.freshUntil) <= input.now.getTime() ? "evidence-expired" : "route-missing-on-refresh"));
    else if (next.observation === "unknown" || next.observation === "uncovered") rows.push(next);
    else if (next.evidenceDigest !== prior.evidenceDigest) rows.push(downgrade(next, input.now, "source-evidence-changed"));
    else if (Date.parse(next.freshUntil) <= input.now.getTime()) rows.push(downgrade(next, input.now, "evidence-expired"));
    else rows.push(next);
  }
  rows.push(...currentById.values());
  return normalizeRouteCoverageV1(rows);
}

function downgrade(row: RouteCoverageV1, now: Date, reason: string): RouteCoverageV1 {
  const observedAt = now.toISOString();
  return parseRouteCoverageV1({ ...row, observation: "unknown", replay: "unknown", outcome: "unknown", enforcement: "absent", topologyEvidenceDigest: null, observedAt, freshUntil: new Date(now.getTime() + 60_000).toISOString(), evidenceDigest: digestSha256({ v: "reelier.route-evidence-downgrade/v1", priorEvidenceDigest: row.evidenceDigest, observedAt, reason }), reasonCodes: [...new Set([...row.reasonCodes, reason])].sort() });
}

function assertClock(value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError("route discovery clock is invalid");
}

function compareDiscoveredRows(left: RouteCoverageV1, right: RouteCoverageV1): number {
  return Buffer.from(left.discoverySource).compare(Buffer.from(right.discoverySource)) || Buffer.from(left.routeId).compare(Buffer.from(right.routeId));
}
