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

export interface HttpResponseSemanticsProfileRegistry {
  readonly profile: (profileId: string) => HttpResponseSemanticsProfileV1 | undefined;
}

/** Builds a closed registry so a route cannot silently select unreviewed behavior. */
export function createHttpResponseSemanticsProfileRegistry(profiles: readonly HttpResponseSemanticsProfileV1[]): HttpResponseSemanticsProfileRegistry {
  if (!Array.isArray(profiles) || Object.getPrototypeOf(profiles) !== Array.prototype) throw new TypeError("HTTP response semantics profile registry is invalid");
  const descriptors = Object.getOwnPropertyDescriptors(profiles);
  const names = Object.keys(descriptors);
  if (Object.getOwnPropertySymbols(profiles).length > 0 || names.length !== profiles.length + 1 || !names.includes("length") || names.some(name => name !== "length" && (!/^(?:0|[1-9]\d*)$/.test(name) || Number(name) >= profiles.length)) || Object.values(descriptors).some(descriptor => !("value" in descriptor) || descriptor.get || descriptor.set)) throw new TypeError("HTTP response semantics profile registry is invalid");
  const indexed = new Map<string, HttpResponseSemanticsProfileV1>();
  for (const value of profiles) {
    const profile = parseHttpResponseSemanticsProfileV1(value);
    if (indexed.has(profile.profileId)) throw new TypeError("duplicate HTTP response semantics profile");
    indexed.set(profile.profileId, profile);
  }
  return Object.freeze({ profile: (profileId: string) => typeof profileId === "string" ? indexed.get(profileId) : undefined });
}

export function lookupHttpResponseSemanticsProfile(registry: HttpResponseSemanticsProfileRegistry, profileId: string): HttpResponseSemanticsProfileV1 | undefined {
  if (!registry || typeof registry.profile !== "function" || typeof profileId !== "string") throw new TypeError("HTTP response semantics profile lookup is invalid");
  return registry.profile(profileId);
}

/** Digest commits both profile identity and the exact acknowledged-status behavior. */
export function httpResponseSemanticsProfileDigest(profile: HttpResponseSemanticsProfileV1): string {
  return authorityDigest(parseHttpResponseSemanticsProfileV1(profile));
}

export type HttpResponseObservation =
  | Readonly<{ kind: "response"; status: number }>
  | Readonly<{ kind: "disconnect" | "malformed" | "overflow" | "deadline" }>;

export function materializedHttpRequestDigest(projection: MaterializedHttpRequestProjectionV1): string {
  return authorityDigest(normalizeProjection(projection));
}

export function parseHttpResponseSemanticsProfileV1(value: unknown): HttpResponseSemanticsProfileV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("HTTP response semantics profile is invalid");
  if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) throw new TypeError("HTTP response semantics profile contains unknown fields");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).sort().join(",") !== "acknowledgedStatuses,profileId,v" || Object.values(descriptors).some(descriptor => !("value" in descriptor) || descriptor.get || descriptor.set)) throw new TypeError("HTTP response semantics profile contains unknown or accessor fields");
  const raw = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, (descriptor as PropertyDescriptor).value])) as Record<string, unknown>;
  if (raw.v !== "reelier.http-response-semantics/v1" || typeof raw.profileId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(raw.profileId) || !Array.isArray(raw.acknowledgedStatuses) || raw.acknowledgedStatuses.length === 0 || Object.getPrototypeOf(raw.acknowledgedStatuses) !== Array.prototype) throw new TypeError("HTTP response semantics profile is invalid");
  const statusValues = raw.acknowledgedStatuses as readonly unknown[];
  const statusDescriptors = Object.getOwnPropertyDescriptors(statusValues);
  const statusNames = Object.keys(statusDescriptors);
  if (Object.getOwnPropertySymbols(statusValues).length > 0 || statusNames.length !== statusValues.length + 1 || !statusNames.includes("length") || statusNames.some(key => key !== "length" && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= statusValues.length)) || Object.values(statusDescriptors).some(descriptor => !("value" in descriptor) || descriptor.get || descriptor.set)) throw new TypeError("HTTP response semantics statuses are invalid");
  const statuses = statusValues;
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
    const separator = pair.indexOf("=");
    if (separator <= 0) throw new TypeError("materialized request projection query must use key=value pairs");
    const rawKey = pair.split("=", 1)[0]!;
    const rawValue = pair.slice(separator + 1);
    let key: string;
    try { key = decodeURIComponent(rawKey).toLowerCase(); decodeURIComponent(rawValue); } catch { throw new TypeError("materialized request projection contains malformed query encoding"); }
    if (/(?:token|secret|password|credential|authorization|api[-_]?key)/.test(key)) throw new TypeError("materialized request projection contains a secret query field");
  }
  return pairs.sort().join("&");
}
