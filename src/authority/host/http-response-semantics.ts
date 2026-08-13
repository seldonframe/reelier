import { authorityDigest } from "../wire.js";

export interface MaterializedHttpRequestProjectionV1 {
  readonly v: "reelier.materialized-http-request/v1";
  readonly method: "POST" | "PUT" | "PATCH" | "DELETE";
  readonly origin: string;
  readonly normalizedPath: string;
  readonly normalizedQuery: string;
  readonly reviewedHeaders: Readonly<Record<string, string>>;
  readonly bodyDigest: string;
}

export interface HttpResponseSemanticsProfileV1 {
  readonly v: "reelier.http-response-semantics/v1";
  readonly profileId: string;
  readonly acknowledgedStatuses: readonly number[];
}

export type HttpResponseObservation =
  | Readonly<{ kind: "response"; status: number }>
  | Readonly<{ kind: "disconnect" | "malformed" | "overflow" | "deadline" }>;

export function materializedHttpRequestDigest(projection: MaterializedHttpRequestProjectionV1): string {
  return authorityDigest(normalizeProjection(projection));
}

export function parseHttpResponseSemanticsProfileV1(value: unknown): HttpResponseSemanticsProfileV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("HTTP response semantics profile is invalid");
  const raw = value as Record<string, unknown>;
  if (Object.getPrototypeOf(value) !== Object.prototype || Object.keys(raw).sort().join(",") !== "acknowledgedStatuses,profileId,v") throw new TypeError("HTTP response semantics profile contains unknown fields");
  if (raw.v !== "reelier.http-response-semantics/v1" || typeof raw.profileId !== "string" || !Array.isArray(raw.acknowledgedStatuses) || raw.acknowledgedStatuses.length === 0) throw new TypeError("HTTP response semantics profile is invalid");
  const statuses = raw.acknowledgedStatuses;
  if (statuses.some(status => !Number.isInteger(status) || (status as number) < 200 || (status as number) > 299) || new Set(statuses as number[]).size !== statuses.length) throw new TypeError("HTTP response semantics statuses are invalid");
  return Object.freeze({ v: raw.v, profileId: raw.profileId, acknowledgedStatuses: Object.freeze([...(statuses as number[])].sort((a, b) => a - b)) });
}

export function classifyHttpResponse(profile: HttpResponseSemanticsProfileV1, observation: HttpResponseObservation): "acknowledged" | "ambiguous" {
  if (observation.kind !== "response") return "ambiguous";
  return profile.acknowledgedStatuses.includes(observation.status) ? "acknowledged" : "ambiguous";
}

function normalizeProjection(value: MaterializedHttpRequestProjectionV1): MaterializedHttpRequestProjectionV1 {
  if (!value || value.v !== "reelier.materialized-http-request/v1") throw new TypeError("materialized request projection is invalid");
  if (!/^https:\/\/[^/?#]+$/.test(value.origin) || !value.normalizedPath.startsWith("/") || value.normalizedPath.includes("..") || value.normalizedPath.includes("\\") || value.normalizedPath.includes("?") || value.normalizedPath.includes("#") || value.normalizedQuery.startsWith("?") || /[\r\n]/.test(value.normalizedQuery)) throw new TypeError("materialized request projection route is invalid");
  const headers: Record<string, string> = {};
  for (const [name, header] of Object.entries(value.reviewedHeaders)) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name) || /[\r\n]/.test(header) || header.length > 512 || ["authorization", "cookie", "host", "proxy-authorization"].includes(name.toLowerCase())) throw new TypeError("materialized request projection contains a secret header");
    headers[name.toLowerCase()] = header;
  }
  return Object.freeze({ ...value, origin: new URL(value.origin).origin, normalizedPath: value.normalizedPath, normalizedQuery: normalizeQuery(value.normalizedQuery), reviewedHeaders: Object.freeze(Object.fromEntries(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)))) });
}

function normalizeQuery(query: string): string {
  if (!query) return "";
  const pairs = query.split("&");
  for (const pair of pairs) {
    const rawKey = pair.split("=", 1)[0]!;
    let key: string;
    try { key = decodeURIComponent(rawKey).toLowerCase(); } catch { throw new TypeError("materialized request projection contains malformed query encoding"); }
    if (/(?:token|secret|password|credential|authorization|api[-_]?key)/.test(key)) throw new TypeError("materialized request projection contains a secret query field");
  }
  return pairs.sort().join("&");
}
