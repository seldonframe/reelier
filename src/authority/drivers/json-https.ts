import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { TransportEffect } from "../types.js";

const FORBIDDEN = new Set(["authorization", "cookie", "host"]);
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const SAFE_PUBLIC = (address: string) => {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || a === 0 || a >= 224);
  }
  const normalized = address.toLowerCase();
  return !(normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb"));
};

export interface JsonHttpsEndpoint {
  readonly endpointId: string;
  readonly baseUrl: string;
  readonly allowedMethods: readonly ("GET" | "POST" | "PUT" | "PATCH" | "DELETE")[];
  readonly allowedPathPrefixes: readonly string[];
  readonly secretRef?: string;
  readonly accountIdentity: string;
}

export interface JsonHttpsSecretResolver { resolve(reference: string): Promise<string>; }
export interface JsonHttpsResponse { readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: Buffer; readonly requestBytesDigest: string; }
export interface JsonHttpsRead { readonly endpointId: string; readonly method?: "GET"; readonly path: string; readonly query?: string; readonly headers?: Readonly<Record<string, string>>; }

export class JsonHttpsSecurityError extends Error { override name = "JsonHttpsSecurityError"; }

export async function executeJsonHttpsEffect(effect: TransportEffect, endpoint: JsonHttpsEndpoint, secrets: JsonHttpsSecretResolver, options: { readonly timeoutMs?: number; readonly maxResponseBytes?: number } = {}): Promise<JsonHttpsResponse> {
  if (effect.endpointId !== endpoint.endpointId) throw new JsonHttpsSecurityError("effect endpoint does not match configured endpoint");
  if (!endpoint.allowedMethods.includes(effect.method)) throw new JsonHttpsSecurityError("method is not allowed for endpoint");
  validatePath(effect.path, endpoint);
  validateQuery(effect.query);
  validateHeaders(effect.headers);
  const body = Buffer.from(effect.bodyBase64, "base64");
  const secret = endpoint.secretRef ? await secrets.resolve(endpoint.secretRef) : undefined;
  return requestPinned(endpoint, effect.method, effect.path, effect.query, effect.headers, body, secret, options);
}

export async function executeJsonHttpsRead(read: JsonHttpsRead, endpoint: JsonHttpsEndpoint, secrets: JsonHttpsSecretResolver, options: { readonly timeoutMs?: number; readonly maxResponseBytes?: number } = {}): Promise<JsonHttpsResponse> {
  if (read.endpointId !== endpoint.endpointId) throw new JsonHttpsSecurityError("read endpoint does not match configured endpoint");
  if (!endpoint.allowedMethods.includes("GET")) throw new JsonHttpsSecurityError("GET is not allowed for endpoint");
  validatePath(read.path, endpoint);
  validateQuery(read.query ?? "");
  validateHeaders(read.headers ?? {});
  const secret = endpoint.secretRef ? await secrets.resolve(endpoint.secretRef) : undefined;
  return requestPinned(endpoint, "GET", read.path, read.query ?? "", read.headers ?? {}, Buffer.alloc(0), secret, options);
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

async function requestPinned(endpoint: JsonHttpsEndpoint, method: string, path: string, query: string, headers: Readonly<Record<string, string>>, body: Buffer, secret: string | undefined, options: { readonly timeoutMs?: number; readonly maxResponseBytes?: number }): Promise<JsonHttpsResponse> {
  let base: URL;
  try { base = new URL(endpoint.baseUrl); } catch { throw new JsonHttpsSecurityError("invalid endpoint base URL"); }
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" && base.pathname !== "") throw new JsonHttpsSecurityError("endpoint base URL must be HTTPS origin only");
  const addresses = await dnsLookup(base.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !SAFE_PUBLIC(item.address))) throw new JsonHttpsSecurityError("endpoint resolved to a non-public address");
  const chosen = addresses[0].address;
  const target = new URL(path + (query ? `?${query}` : ""), base);
  if (target.origin !== base.origin) throw new JsonHttpsSecurityError("effect escaped configured endpoint origin");
  const requestHeaders: Record<string, string> = { ...headers, ...(body.length ? { "content-length": String(body.length) } : {}) };
  if (secret) requestHeaders.authorization = `Bearer ${secret}`;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxResponseBytes = Math.min(options.maxResponseBytes ?? MAX_RESPONSE_BYTES, MAX_RESPONSE_BYTES);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) throw new TypeError("invalid HTTPS timeout");
  const { createHash } = await import("node:crypto");
  const requestBytesDigest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  return new Promise((resolve, reject) => {
    const req = httpsRequest({ protocol: "https:", hostname: base.hostname, port: base.port || 443, method, path: `${target.pathname}${target.search}`, headers: requestHeaders, servername: base.hostname, lookup: (_hostname, _options, callback) => callback(null, chosen, isIP(chosen)) }, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", chunk => { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length; if (size > maxResponseBytes) { req.destroy(new JsonHttpsSecurityError("response exceeds configured limit")); return; } chunks.push(bytes); });
      response.on("end", () => { const out: Record<string, string> = {}; for (const [key, value] of Object.entries(response.headers)) if (typeof value === "string") out[key] = value; resolve({ status: response.statusCode ?? 0, headers: out, body: Buffer.concat(chunks), requestBytesDigest }); });
      response.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new JsonHttpsSecurityError("HTTPS request timed out")));
    req.on("error", reject);
    if (body.length) req.write(body);
    req.end();
  });
}
