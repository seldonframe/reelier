import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { createHash } from "node:crypto";
import { connect as tlsConnect } from "node:tls";
import type { TransportEffect } from "../types.js";
import { assertAllPublicAddresses } from "../client/ip.js";
import { createTotalDeadline, raceTotalDeadline, type TotalDeadline } from "../net/deadline.js";
import { jsonHttpsRouteDigest, type JsonHttpsRouteV1 } from "../host/json-https-route.js";
import { materializedHttpRequestDigest, type MaterializedHttpRequestProjectionV1 } from "../host/http-response-semantics.js";
import { createPreparedDispatch, type PreparedDispatch } from "../host/prepared-dispatch.js";
import { authorityDigest } from "../wire.js";

const FORBIDDEN = new Set(["authorization", "cookie", "host"]);
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
type JsonHttpsOptions = Readonly<{ timeoutMs?: number; maxResponseBytes?: number; maxRequestBytes?: number; monotonicNow?: () => number }>;

/** Legacy runtime endpoint configuration; canonical route authority is separate. */
export interface JsonHttpsEndpoint {
  readonly endpointId: string;
  readonly baseUrl: string;
  readonly allowedMethods: readonly ("GET" | "POST" | "PUT" | "PATCH" | "DELETE")[];
  readonly allowedPathPrefixes: readonly string[];
  readonly secretRef?: string;
  readonly accountIdentity: string;
  readonly egressProxy?: Readonly<{ baseUrl: string; bearerRef: string }>;
}

export interface JsonHttpsSecretResolver { resolve(reference: string): Promise<string>; acquireSlot?: (slotId: string) => Promise<{ readonly readOnce: () => string }>; }
export interface JsonHttpsResponse { readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: Buffer; readonly requestBytesDigest: string; readonly materializedRequestProjection?: MaterializedHttpRequestProjectionV1; readonly materializedRequestDigest?: string; }
export interface JsonHttpsRead { readonly endpointId: string; readonly method?: "GET"; readonly path: string; readonly query?: string; readonly headers?: Readonly<Record<string, string>>; }
export interface JsonHttpsConfidentialRequest { readonly endpointId: string; readonly method: "POST" | "PUT" | "PATCH" | "DELETE"; readonly path: string; readonly query?: string; readonly headers?: Readonly<Record<string, string>>; readonly body: Uint8Array; }

export class JsonHttpsSecurityError extends Error { override name = "JsonHttpsSecurityError"; }

/** Returns a DNS lookup function that preserves an already-validated address pin on every supported Node callback shape. */
export function createPinnedLookup(address: string): LookupFunction {
  const family = isIP(address);
  if (family !== 4 && family !== 6) throw new JsonHttpsSecurityError("pinned lookup requires a valid IP address");
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

export async function executeJsonHttpsEffect(effect: TransportEffect, endpoint: JsonHttpsEndpoint | JsonHttpsRouteV1, secrets: JsonHttpsSecretResolver, options: JsonHttpsOptions = {}): Promise<JsonHttpsResponse> {
  const runtimeEndpoint = materializeEndpoint(endpoint);
  const deadline = dispatchDeadline(options);
  deadline.remainingMs("prepare");
  if (effect.endpointId !== runtimeEndpoint.endpointId) throw new JsonHttpsSecurityError("effect endpoint does not match configured endpoint");
  if (!runtimeEndpoint.allowedMethods.includes(effect.method)) throw new JsonHttpsSecurityError("method is not allowed for endpoint");
  validatePath(effect.path, runtimeEndpoint);
  validateQuery(effect.query);
  validateHeaders(effect.headers);
  if (base64DecodedBytes(effect.bodyBase64) > MAX_REQUEST_BYTES) throw new JsonHttpsSecurityError("request exceeds configured limit");
  const body = Buffer.from(effect.bodyBase64, "base64");
  const secret = await materializeSecret(endpoint, secrets, deadline);
  deadline.remainingMs("credential"); const proxySecret = runtimeEndpoint.egressProxy ? await secrets.resolve(runtimeEndpoint.egressProxy.bearerRef) : undefined;
  const projection = buildMaterializedHttpRequestProjection(runtimeEndpoint, effect.method, effect.path, effect.query, effect.headers, body);
  return requestPinned(runtimeEndpoint, effect.method, effect.path, effect.query, effect.headers, body, secret, proxySecret, options, deadline, projection);
}

/** Materializes one consequential request without sending it; the returned capability owns the exact bytes. */
export async function prepareJsonHttpsEffect(effect: TransportEffect, endpoint: JsonHttpsEndpoint | JsonHttpsRouteV1, secrets: JsonHttpsSecretResolver, options: JsonHttpsOptions & Readonly<{ reservationId?: string; allocationId?: string; authorityGeneration?: string; authorityExpiresAt?: string }> = {}): Promise<PreparedDispatch> {
  const runtimeEndpoint = materializeEndpoint(endpoint);
  const deadline = dispatchDeadline(options);
  deadline.remainingMs("prepare");
  if (effect.endpointId !== runtimeEndpoint.endpointId || !runtimeEndpoint.allowedMethods.includes(effect.method)) throw new JsonHttpsSecurityError("effect is not allowed for endpoint");
  validatePath(effect.path, runtimeEndpoint); validateQuery(effect.query); validateHeaders(effect.headers);
  if (base64DecodedBytes(effect.bodyBase64) > MAX_REQUEST_BYTES) throw new JsonHttpsSecurityError("request exceeds configured limit");
  const body = Buffer.from(effect.bodyBase64, "base64");
  const secret = await materializeSecret(endpoint, secrets, deadline);
  const proxySecret = runtimeEndpoint.egressProxy ? await secrets.resolve(runtimeEndpoint.egressProxy.bearerRef) : undefined;
  const projection = buildMaterializedHttpRequestProjection(runtimeEndpoint, effect.method, effect.path, effect.query, effect.headers, body);
  const routeDigest = isNativeRoute(endpoint) ? jsonHttpsRouteDigest(endpoint) : authorityDigest({ v: "reelier.json-https-legacy-route/v1", endpointId: runtimeEndpoint.endpointId, baseUrl: runtimeEndpoint.baseUrl, allowedMethods: runtimeEndpoint.allowedMethods, allowedPathPrefixes: runtimeEndpoint.allowedPathPrefixes, accountIdentity: runtimeEndpoint.accountIdentity, secretRef: runtimeEndpoint.secretRef ?? null, egressProxy: runtimeEndpoint.egressProxy ?? null });
  const description = {
    v: "reelier.prepared-dispatch-description/v1" as const,
    routeDigest,
    materializedRequestDigest: materializedHttpRequestDigest(projection), projection,
    authorityGeneration: options.authorityGeneration ?? "legacy",
    authorityExpiresAt: options.authorityExpiresAt ?? new Date(Date.now() + (deadline.absoluteDeadlineMs - deadline.startedAtMs)).toISOString(),
    absoluteDeadlineMs: deadline.absoluteDeadlineMs,
    reservationId: options.reservationId ?? "unbound", allocationId: options.allocationId ?? "unbound",
  };
  return createPreparedDispatch({ description, monotonicNow: options.monotonicNow, send: async () => { try { const response = await requestPinned(runtimeEndpoint, effect.method, effect.path, effect.query, effect.headers, body, secret, proxySecret, options, deadline, projection); const resultDigest = authorityDigest({ v: "reelier.https-response/v1", endpointId: runtimeEndpoint.endpointId, status: response.status, headers: response.headers, bodyDigest: authorityDigest(response.body.toString("base64")) }); const malformed = Object.entries(response.headers).some(([name, value]) => name.toLowerCase() === "content-type" && value.toLowerCase().includes("json")) && response.body.length > 0 && (() => { try { JSON.parse(response.body.toString("utf8")); return false; } catch { return true; } })(); return Object.freeze({ kind: !malformed && response.status >= 200 && response.status < 300 ? "acknowledged" as const : "ambiguous" as const, resultDigest, providerStatus: response.status, responseDigest: resultDigest, materializedRequestDigest: response.materializedRequestDigest }); } finally { body.fill(0); } } });
}

export async function executeJsonHttpsRead(read: JsonHttpsRead, endpoint: JsonHttpsEndpoint | JsonHttpsRouteV1, secrets: JsonHttpsSecretResolver, options: JsonHttpsOptions = {}): Promise<JsonHttpsResponse> {
  const runtimeEndpoint = materializeEndpoint(endpoint);
  const deadline = dispatchDeadline(options);
  deadline.remainingMs("prepare");
  if (read.endpointId !== runtimeEndpoint.endpointId) throw new JsonHttpsSecurityError("read endpoint does not match configured endpoint");
  if (!runtimeEndpoint.allowedMethods.includes("GET")) throw new JsonHttpsSecurityError("GET is not allowed for endpoint");
  validatePath(read.path, runtimeEndpoint);
  validateQuery(read.query ?? "");
  validateHeaders(read.headers ?? {});
  const secret = await materializeSecret(endpoint, secrets, deadline);
  deadline.remainingMs("credential"); const proxySecret = runtimeEndpoint.egressProxy ? await secrets.resolve(runtimeEndpoint.egressProxy.bearerRef) : undefined;
  const body = Buffer.alloc(0);
  const projection = buildMaterializedHttpRequestProjection(runtimeEndpoint, "GET", read.path, read.query ?? "", read.headers ?? {}, body);
  return requestPinned(runtimeEndpoint, "GET", read.path, read.query ?? "", read.headers ?? {}, body, secret, proxySecret, options, deadline, projection);
}

function isNativeRoute(endpoint: JsonHttpsEndpoint | JsonHttpsRouteV1): endpoint is JsonHttpsRouteV1 { return "credentialSlotId" in endpoint; }
function materializeEndpoint(endpoint: JsonHttpsEndpoint | JsonHttpsRouteV1): JsonHttpsEndpoint {
  if (!isNativeRoute(endpoint)) return endpoint;
  return { endpointId: endpoint.endpointId, baseUrl: endpoint.origin, allowedMethods: endpoint.allowedMethods, allowedPathPrefixes: endpoint.allowedPathPrefixes, accountIdentity: endpoint.providerAccountIdentity };
}
async function materializeSecret(endpoint: JsonHttpsEndpoint | JsonHttpsRouteV1, secrets: JsonHttpsSecretResolver, deadline: TotalDeadline): Promise<string | undefined> {
  deadline.remainingMs("credential");
  if (isNativeRoute(endpoint)) {
    if (!secrets.acquireSlot) throw new JsonHttpsSecurityError("canonical route credential slot is unavailable");
    try { const lease = await secrets.acquireSlot(endpoint.credentialSlotId); return lease.readOnce(); } catch { throw new JsonHttpsSecurityError("canonical route credential slot is unavailable"); }
  }
  return endpoint.secretRef ? secrets.resolve(endpoint.secretRef) : undefined;
}

function validatePath(path: string, endpoint: JsonHttpsEndpoint): void {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("..") || path.includes("\\") || /[?#]/.test(path)) throw new JsonHttpsSecurityError("path must be a relative normalized path");
  if (!endpoint.allowedPathPrefixes.some(prefix => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`))) throw new JsonHttpsSecurityError("path is not allowed for endpoint");
}

function validateHeaders(headers: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name) || FORBIDDEN.has(name.toLowerCase())) throw new JsonHttpsSecurityError("forbidden or malformed header");
    if (typeof value !== "string" || value.length > 512 || /[\r\n]/.test(value)) throw new JsonHttpsSecurityError("malformed header value");
  }
}

function validateQuery(query: string): void {
  if (typeof query !== "string" || query.length > 4096 || /[\r\n]/.test(query) || query.startsWith("?") || query.includes("#") || query.includes("/")) throw new JsonHttpsSecurityError("query is not a safe relative query string");
  if (!query) return;
  for (const pair of query.split("&")) {
    const at = pair.indexOf("=");
    if (at <= 0 || at !== pair.lastIndexOf("=")) throw new JsonHttpsSecurityError("query must use key=value pairs");
    try { decodeURIComponent(pair.slice(0, at)); decodeURIComponent(pair.slice(at + 1)); } catch { throw new JsonHttpsSecurityError("query contains invalid escaping"); }
  }
}

function dispatchDeadline(options: JsonHttpsOptions): TotalDeadline {
  return createTotalDeadline({ timeoutMs: options.timeoutMs ?? 15_000, monotonicNow: options.monotonicNow });
}
function base64DecodedBytes(value: string): number { return Math.floor(value.length * 3 / 4) - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0); }

async function requestPinned(endpoint: JsonHttpsEndpoint, method: string, path: string, query: string, headers: Readonly<Record<string, string>>, body: Buffer, secret: string | undefined, proxySecret: string | undefined, options: JsonHttpsOptions, deadline: TotalDeadline, projection?: MaterializedHttpRequestProjectionV1): Promise<JsonHttpsResponse> {
  let base: URL;
  try { base = new URL(endpoint.baseUrl); } catch { throw new JsonHttpsSecurityError("invalid endpoint base URL"); }
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" && base.pathname !== "") throw new JsonHttpsSecurityError("endpoint base URL must be HTTPS origin only");
  const target = new URL(path + (query ? `?${query}` : ""), base);
  if (target.origin !== base.origin) throw new JsonHttpsSecurityError("effect escaped configured endpoint origin");
  const requestHeaders: Record<string, string> = { ...headers, ...(body.length ? { "content-length": String(body.length) } : {}) };
  if (secret) requestHeaders.authorization = `Bearer ${secret}`;
  const maxResponseBytes = Math.min(options.maxResponseBytes ?? MAX_RESPONSE_BYTES, MAX_RESPONSE_BYTES);
  const requestBytesDigest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  if (endpoint.egressProxy) {
    if (!proxySecret) throw new JsonHttpsSecurityError("egress proxy credential is unavailable");
    return requestThroughProxy(endpoint.egressProxy, base, target, method, requestHeaders, body, proxySecret, maxResponseBytes, requestBytesDigest, deadline, projection);
  }
  deadline.remainingMs("dns");
  const addresses = await raceTotalDeadline(deadline, "dns", dnsLookup(base.hostname, { all: true, verbatim: true }));
  let pinned: readonly Readonly<{ address: string; family: 4 | 6 }>[];
  try { pinned = assertAllPublicAddresses(addresses.map(item => item.address)); } catch { throw new JsonHttpsSecurityError("endpoint resolved to a non-public address"); }
  const chosen = pinned[0]!.address;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: JsonHttpsResponse) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value!); };
    const req = httpsRequest({ protocol: "https:", hostname: base.hostname, port: base.port || 443, method, path: `${target.pathname}${target.search}`, headers: requestHeaders, servername: base.hostname, lookup: createPinnedLookup(chosen) }, response => {
      if (settled) { response.destroy(); return; }
      try { deadline.remainingMs("headers"); } catch (error) { req.destroy(error as Error); finish(error as Error); return; }
      if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) { req.destroy(); finish(new JsonHttpsSecurityError("HTTPS redirects are refused")); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", chunk => { try { deadline.remainingMs("body"); } catch (error) { req.destroy(error as Error); return; } const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length; if (size > maxResponseBytes) { req.destroy(new JsonHttpsSecurityError("response exceeds configured limit")); return; } chunks.push(bytes); });
      response.on("end", () => { const out: Record<string, string> = {}; for (const [key, value] of Object.entries(response.headers)) if (typeof value === "string") out[key] = value; finish(undefined, { status: response.statusCode ?? 0, headers: out, body: Buffer.concat(chunks), requestBytesDigest, ...(projection ? { materializedRequestProjection: projection, materializedRequestDigest: materializedHttpRequestDigest(projection) } : {}) }); });
      response.on("error", finish);
    });
    const timer = setTimeout(() => { req.destroy(new JsonHttpsSecurityError("HTTPS total deadline expired")); finish(new JsonHttpsSecurityError("HTTPS total deadline expired")); }, deadline.remainingMs("connect"));
    timer.unref(); req.on("error", finish);
    try { deadline.remainingMs("upload"); if (body.length) req.write(body); } catch (error) { req.destroy(error as Error); finish(error as Error); return; }
    req.end();
  });
}

/** Executes host-materialized confidential bytes without placing them in a serializable TransportEffect. */
export async function executeJsonHttpsConfidentialRequest(request: JsonHttpsConfidentialRequest, endpoint: JsonHttpsEndpoint, secrets: JsonHttpsSecretResolver, options: JsonHttpsOptions = {}): Promise<JsonHttpsResponse> {
  const deadline = dispatchDeadline(options);
  deadline.remainingMs("prepare");
  if (request.endpointId !== endpoint.endpointId) throw new JsonHttpsSecurityError("confidential request endpoint does not match configured endpoint");
  if (!endpoint.allowedMethods.includes(request.method)) throw new JsonHttpsSecurityError("method is not allowed for endpoint");
  validatePath(request.path, endpoint); validateQuery(request.query ?? ""); validateHeaders(request.headers ?? {});
  const maxRequestBytes = Math.min(options.maxRequestBytes ?? MAX_REQUEST_BYTES, MAX_REQUEST_BYTES);
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1 || request.body.byteLength > maxRequestBytes) throw new JsonHttpsSecurityError("confidential request exceeds configured limit");
  const body = Buffer.from(request.body);
  deadline.remainingMs("credential"); const secret = endpoint.secretRef ? await secrets.resolve(endpoint.secretRef) : undefined;
  deadline.remainingMs("credential"); const proxySecret = endpoint.egressProxy ? await secrets.resolve(endpoint.egressProxy.bearerRef) : undefined;
  const projection = buildMaterializedHttpRequestProjection(endpoint, request.method, request.path, request.query ?? "", request.headers ?? {}, body);
  try { return await requestPinned(endpoint, request.method, request.path, request.query ?? "", request.headers ?? {}, body, secret, proxySecret, options, deadline, projection); }
  finally { body.fill(0); }
}

async function requestThroughProxy(proxy: NonNullable<JsonHttpsEndpoint["egressProxy"]>, base: URL, target: URL, method: string, headers: Readonly<Record<string, string>>, body: Buffer, proxySecret: string, maxResponseBytes: number, requestBytesDigest: string, deadline: TotalDeadline, projection?: MaterializedHttpRequestProjectionV1): Promise<JsonHttpsResponse> {
  let origin: URL;
  try { origin = new URL(proxy.baseUrl); } catch { throw new JsonHttpsSecurityError("invalid egress proxy URL"); }
  if (origin.protocol !== "http:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || !origin.hostname.endsWith(".internal")) throw new JsonHttpsSecurityError("egress proxy must be a credential-free Fly internal HTTP origin");
  if (!/^(?:env:[A-Za-z_][A-Za-z0-9_]{0,127}|file:.+)$/.test(proxy.bearerRef)) throw new JsonHttpsSecurityError("egress proxy credential reference is invalid");
  deadline.remainingMs("dns"); const addresses = await raceTotalDeadline(deadline, "dns", dnsLookup(origin.hostname, { all: true, verbatim: true }));
  let pinned: readonly Readonly<{ address: string; family: 4 | 6 }>[];
  try { pinned = assertAllPublicAddresses(addresses.map(item => item.address)); } catch { throw new JsonHttpsSecurityError("egress proxy resolved to a non-public address"); }
  const chosen = pinned[0]!.address;
  return new Promise((resolve, reject) => {
    let settled = false;
    let activeSocket: import("node:net").Socket | undefined;
    let secureSocket: import("node:tls").TLSSocket | undefined;
    let tunneledRequest: import("node:http").ClientRequest | undefined;
    const fail = (error: Error) => { if (settled) return; settled = true; clearTimeout(timer); reject(error); };
    const connectRequest = httpRequest({
      protocol: "http:", hostname: origin.hostname, port: origin.port || 8443, method: "CONNECT", path: `${base.hostname}:${base.port || "443"}`,
      headers: { "Proxy-Authorization": `Bearer ${proxySecret}` },
      lookup: createPinnedLookup(chosen),
    });
    connectRequest.once("connect", (response, socket, head) => {
      if (settled) { socket.destroy(); return; }
      activeSocket = socket;
      if (response.statusCode !== 200 || head.length) { socket.destroy(); fail(new JsonHttpsSecurityError("egress proxy refused the tunnel")); return; }
      try { deadline.remainingMs("tls"); } catch (error) { socket.destroy(error as Error); fail(error as Error); return; }
      const secure = secureSocket = tlsConnect({ socket, servername: base.hostname, rejectUnauthorized: true });
      secure.once("error", fail);
      secure.once("secureConnect", () => {
        if (settled) { secure.destroy(); return; }
        const request = tunneledRequest = httpRequest({
          method, path: `${target.pathname}${target.search}`, headers: { ...headers, Host: base.host }, agent: false,
          createConnection: () => secure,
        }, response => {
          if (settled) { response.destroy(); return; }
          collectResponse(response, request, maxResponseBytes, requestBytesDigest, deadline, value => { if (settled) return; settled = true; clearTimeout(timer); resolve(projection ? { ...value, materializedRequestProjection: projection, materializedRequestDigest: materializedHttpRequestDigest(projection) } : value); }, fail);
        });
        request.once("error", fail);
        try { deadline.remainingMs("upload"); if (body.length) request.write(body); } catch (error) { request.destroy(error as Error); fail(error as Error); return; }
        request.end();
      });
    });
    connectRequest.once("error", fail);
    connectRequest.end();
    const timer = setTimeout(() => { const error = new JsonHttpsSecurityError("egress proxy total deadline expired"); connectRequest.destroy(error); tunneledRequest?.destroy(error); secureSocket?.destroy(error); activeSocket?.destroy(error); fail(error); }, deadline.remainingMs("connect"));
    timer.unref();
  });
}

export function buildMaterializedHttpRequestProjection(endpoint: JsonHttpsEndpoint, method: "POST" | "PUT" | "PATCH" | "DELETE" | "GET", path: string, query: string, headers: Readonly<Record<string, string>>, body: Uint8Array): MaterializedHttpRequestProjectionV1 {
  if (method === "GET") {
    return buildProjection(endpoint, method, path, query, headers, body);
  }
  return buildProjection(endpoint, method, path, query, headers, body);
}

function buildProjection(endpoint: JsonHttpsEndpoint, method: "POST" | "PUT" | "PATCH" | "DELETE" | "GET", path: string, query: string, headers: Readonly<Record<string, string>>, body: Uint8Array): MaterializedHttpRequestProjectionV1 {
  for (const pair of query ? query.split("&") : []) {
    const key = pair.split("=", 1)[0]!.toLowerCase();
    if (/(?:token|secret|password|credential|authorization|api[-_]?key)/.test(key)) throw new JsonHttpsSecurityError("materialized request projection contains a secret query field");
  }
  const projectedHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) if (!["authorization", "cookie", "host", "proxy-authorization"].includes(name.toLowerCase())) projectedHeaders[name.toLowerCase()] = value;
  const projection = { v: "reelier.materialized-http-request/v1" as const, method: method as MaterializedHttpRequestProjectionV1["method"], origin: new URL(endpoint.baseUrl).origin, normalizedPath: path, normalizedQuery: query ? query.split("&").sort().join("&") : "", reviewedHeaders: projectedHeaders, bodyDigest: `sha256:${createHash("sha256").update(body).digest("hex")}` };
  return Object.freeze(projection);
}

function collectResponse(response: import("node:http").IncomingMessage, request: import("node:http").ClientRequest, maxResponseBytes: number, requestBytesDigest: string, deadline: TotalDeadline, resolve: (value: JsonHttpsResponse) => void, reject: (error: Error) => void): void {
  try { deadline.remainingMs("headers"); } catch (error) { request.destroy(error as Error); reject(error as Error); return; }
  if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) { request.destroy(); reject(new JsonHttpsSecurityError("HTTPS redirects are refused")); return; }
  const chunks: Buffer[] = []; let size = 0;
  response.on("data", chunk => { try { deadline.remainingMs("body"); } catch (error) { request.destroy(error as Error); return; } const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length; if (size > maxResponseBytes) { request.destroy(new JsonHttpsSecurityError("response exceeds configured limit")); return; } chunks.push(bytes); });
  response.on("end", () => { const out: Record<string, string> = {}; for (const [key, value] of Object.entries(response.headers)) if (typeof value === "string") out[key] = value; resolve({ status: response.statusCode ?? 0, headers: out, body: Buffer.concat(chunks), requestBytesDigest }); });
  response.on("error", reject);
}
