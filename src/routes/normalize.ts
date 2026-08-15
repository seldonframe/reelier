import { parseBootstrapSchema, parseCanonicalTime } from "../bootstrap/normalize.js";
import type { RouteCoverageV1 } from "./types.js";

export function parseRouteCoverageV1(value: unknown): RouteCoverageV1 {
  const parsed = parseBootstrapSchema<RouteCoverageV1>("route-coverage", value);
  if (parseCanonicalTime(parsed.freshUntil, "route freshness time") <= parseCanonicalTime(parsed.observedAt, "route observation time")) throw new TypeError("route coverage freshness interval is invalid");
  assertSortedUnique(parsed.evidenceRefs, "route evidence references");
  if (parsed.evidenceRefs.some(reference => /[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(reference))) throw new TypeError("route evidence references cannot contain endpoint URLs");
  assertSortedUnique(parsed.reasonCodes, "route reason codes");
  if (parsed.enforcement === "verified" && parsed.topologyEvidenceDigest === null) throw new TypeError("verified route enforcement requires topology evidence");
  if (parsed.enforcement !== "verified" && parsed.topologyEvidenceDigest !== null) throw new TypeError("topology evidence cannot upgrade an unverified route");
  return parsed;
}

export function normalizeRouteCoverageV1(values: unknown): readonly RouteCoverageV1[] {
  if (!Array.isArray(values)) throw new TypeError("route coverage must be an array");
  const parsed = values.map(parseRouteCoverageV1);
  const ids = new Set<string>();
  for (const row of parsed) if (ids.has(row.routeId)) throw new TypeError("route coverage contains duplicate route IDs"); else ids.add(row.routeId);
  return Object.freeze([...parsed].sort((left, right) => Buffer.from(left.routeId).compare(Buffer.from(right.routeId))));
}

function assertSortedUnique(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index++) if (Buffer.from(values[index - 1]).compare(Buffer.from(values[index])) >= 0) throw new TypeError(`${label} must be unique and UTF-8 byte sorted`);
}
