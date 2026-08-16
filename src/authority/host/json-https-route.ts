import { authorityDigest } from "../wire.js";

const VERSION = "reelier.json-https-route/v1" as const;
const KEYS = ["v", "providerId", "connectorId", "accountId", "providerAccountIdentity", "endpointId", "origin", "allowedMethods", "allowedPathPrefixes", "credentialSlotId", "responseSemanticsProfileId", "reconciliationRecipeId", "readEndpointId", "egressPolicyDigest", "projectionSchemaDigest"] as const;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:(?!0{64}$)[0-9a-f]{64}$/;

type JsonHttpsMethod = typeof METHODS[number];

export interface JsonHttpsRouteV1 {
  readonly v: "reelier.json-https-route/v1";
  readonly providerId: string;
  readonly connectorId: string;
  readonly accountId: string;
  readonly providerAccountIdentity: string;
  readonly endpointId: string;
  readonly origin: string;
  readonly allowedMethods: readonly JsonHttpsMethod[];
  readonly allowedPathPrefixes: readonly string[];
  readonly credentialSlotId: string;
  readonly responseSemanticsProfileId: string;
  readonly reconciliationRecipeId: string;
  readonly readEndpointId: string;
  readonly egressPolicyDigest: string;
  readonly projectionSchemaDigest: string;
}

export type CanonicalJsonHttpsRouteV1 = Readonly<JsonHttpsRouteV1>;

export interface JsonHttpsRouteRegistry {
  readonly route: (endpointId: string) => CanonicalJsonHttpsRouteV1 | undefined;
}

/** Parses route authority without reading accessors or accepting inherited keys. */
export function parseJsonHttpsRouteV1(value: unknown): CanonicalJsonHttpsRouteV1 {
  const raw = closedObject(value, "JSON HTTPS route");
  if (raw.v !== VERSION) throw new TypeError("JSON HTTPS route version is invalid");
  const strings = ["providerId", "connectorId", "accountId", "providerAccountIdentity", "endpointId", "credentialSlotId", "responseSemanticsProfileId", "reconciliationRecipeId", "readEndpointId"] as const;
  for (const key of strings) if (typeof raw[key] !== "string" || !IDENTIFIER.test(raw[key] as string)) throw new TypeError(`JSON HTTPS route ${key} is invalid`);
  if (typeof raw.origin !== "string") throw new TypeError("JSON HTTPS route origin is invalid");
  if (typeof raw.egressPolicyDigest !== "string" || !DIGEST.test(raw.egressPolicyDigest)) throw new TypeError("JSON HTTPS route egress policy digest is invalid");
  if (typeof raw.projectionSchemaDigest !== "string" || !DIGEST.test(raw.projectionSchemaDigest)) throw new TypeError("JSON HTTPS route projection schema digest is invalid");
  const origin = canonicalOrigin(raw.origin);
  const allowedMethods = canonicalMethods(raw.allowedMethods);
  const allowedPathPrefixes = canonicalPaths(raw.allowedPathPrefixes);
  return Object.freeze({ v: VERSION, providerId: raw.providerId as string, connectorId: raw.connectorId as string, accountId: raw.accountId as string, providerAccountIdentity: raw.providerAccountIdentity as string, endpointId: raw.endpointId as string, origin, allowedMethods, allowedPathPrefixes, credentialSlotId: raw.credentialSlotId as string, responseSemanticsProfileId: raw.responseSemanticsProfileId as string, reconciliationRecipeId: raw.reconciliationRecipeId as string, readEndpointId: raw.readEndpointId as string, egressPolicyDigest: raw.egressPolicyDigest, projectionSchemaDigest: raw.projectionSchemaDigest });
}

export function canonicalizeJsonHttpsRoute(value: JsonHttpsRouteV1): CanonicalJsonHttpsRouteV1 {
  return parseJsonHttpsRouteV1(value);
}

export function jsonHttpsRouteDigest(value: JsonHttpsRouteV1): string {
  return authorityDigest(canonicalizeJsonHttpsRoute(value));
}

export function createJsonHttpsRouteRegistry(routes: readonly JsonHttpsRouteV1[]): JsonHttpsRouteRegistry {
  if (!Array.isArray(routes) || Object.getPrototypeOf(routes) !== Array.prototype || hasAccessor(routes)) throw new TypeError("JSON HTTPS route registry is invalid");
  const parsed = routes.map(parseJsonHttpsRouteV1);
  const byEndpointId = new Map(parsed.map(route => [route.endpointId, route]));
  if (byEndpointId.size !== parsed.length) throw new TypeError("duplicate JSON HTTPS route endpoint id");
  for (const route of parsed) {
    const readRoute = byEndpointId.get(route.readEndpointId);
    if (!readRoute || !readRoute.allowedMethods.includes("GET")) throw new TypeError("JSON HTTPS route read endpoint must be a registered GET route");
    if (readRoute.providerId !== route.providerId || readRoute.connectorId !== route.connectorId || readRoute.accountId !== route.accountId || readRoute.providerAccountIdentity !== route.providerAccountIdentity || readRoute.origin !== route.origin || readRoute.credentialSlotId !== route.credentialSlotId || readRoute.egressPolicyDigest !== route.egressPolicyDigest || readRoute.projectionSchemaDigest !== route.projectionSchemaDigest) throw new TypeError("JSON HTTPS route read endpoint equivalence mismatch");
  }
  return Object.freeze({ route: (endpointId: string) => typeof endpointId === "string" ? byEndpointId.get(endpointId) : undefined });
}

export function lookupJsonHttpsRoute(registry: JsonHttpsRouteRegistry, endpointId: string): CanonicalJsonHttpsRouteV1 | undefined {
  if (!registry || typeof registry.route !== "function" || typeof endpointId !== "string") throw new TypeError("JSON HTTPS route lookup is invalid");
  return registry.route(endpointId);
}

function closedObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} is invalid`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const missing=KEYS.filter(key=>!(key in descriptors));
  if(missing.length)throw new TypeError(`${label} missing ${missing.join(", ")}`);
  if (Object.keys(descriptors).length !== KEYS.length || Object.keys(descriptors).some(key => !KEYS.includes(key as typeof KEYS[number])) || Object.values(descriptors).some(descriptor => !("value" in descriptor) || descriptor.get || descriptor.set)) throw new TypeError(`${label} contains unknown or accessor fields`);
  return Object.fromEntries(KEYS.map(key => [key, descriptors[key]!.value]));
}

function canonicalOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError("JSON HTTPS route origin is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.hostname.includes("*") || value !== url.origin) throw new TypeError("JSON HTTPS route origin must be a canonical HTTPS origin");
  return url.origin;
}

function canonicalMethods(value: unknown): readonly JsonHttpsMethod[] {
  const values = inertArray(value, "allowed methods");
  if (!values.length || values.some(item => typeof item !== "string" || !METHODS.includes(item as JsonHttpsMethod)) || new Set(values).size !== values.length) throw new TypeError("JSON HTTPS route allowed methods are invalid");
  return Object.freeze(([...values] as JsonHttpsMethod[]).sort());
}

function canonicalPaths(value: unknown): readonly string[] {
  const values = inertArray(value, "allowed path prefixes");
  if (!values.length || values.some(item => typeof item !== "string" || !validPath(item))) throw new TypeError("JSON HTTPS route allowed path prefixes are invalid");
  const normalized = (values as string[]).map(item => item === "/" ? item : item.replace(/\/+$/, ""));
  if (new Set(normalized).size !== normalized.length) throw new TypeError("duplicate normalized JSON HTTPS route path prefix");
  return Object.freeze(normalized.sort());
}

function inertArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || !hasExactArrayKeys(value) || hasAccessor(value)) throw new TypeError(`JSON HTTPS route ${label} must be an inert array`);
  return Array.from(value);
}

function hasExactArrayKeys(value: unknown[]): boolean {
  const names = Object.getOwnPropertyNames(value);
  return Object.getOwnPropertySymbols(value).length === 0 && names.length === value.length + 1 && names.includes("length") && names.every(name => name === "length" || (/^(?:0|[1-9]\d*)$/.test(name) && Number(name) < value.length));
}
function hasAccessor(value: object): boolean { return Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !("value" in descriptor) || descriptor.get || descriptor.set); }
function validPath(value: string): boolean {
  if (!value.startsWith("/") || value.includes("//") || value.includes("\\") || /[?#]/.test(value) || !value.split("/").every((part, index) => index === 0 || (part !== "." && part !== ".."))) return false;
  try { return new URL(value, "https://route.invalid").pathname === value; } catch { return false; }
}
