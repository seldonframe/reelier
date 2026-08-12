import { lstat, readFile, realpath } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { parseAuthorityCellConnectionV1, type AuthorityCellConnectionV1 } from "./config.js";

export type AuthorityCellLiveResult = Readonly<{ state: "verified" | "failed" | "unchecked" | "absent"; reasonCode: string; cellId?: string; adapterContractDigest?: string }>;
export interface AuthorityCellClientDependencies { readonly resolveToken?: (reference: AuthorityCellConnectionV1["bearerTokenRef"]) => Promise<string>; readonly request?: (url: string, init: RequestInit) => Promise<Response>; readonly credentialRoot?: string; readonly resolveAddresses?: (hostname: string) => Promise<readonly string[]>; }

/** Client-only live identity check. The token is resolved only here and never returned or logged. */
export async function checkAuthorityCellLive(value: unknown, dependencies: AuthorityCellClientDependencies = {}): Promise<AuthorityCellLiveResult> {
  let connection: AuthorityCellConnectionV1;
  try { connection = parseAuthorityCellConnectionV1(value); } catch { return { state: "failed", reasonCode: "connection-invalid" }; }
  try {
    let token: string;
    try { token = await (dependencies.resolveToken ?? (reference => resolveToken(reference, dependencies.credentialRoot)))(connection.bearerTokenRef); }
    catch { return { state: "absent", reasonCode: "token-unavailable" }; }
    const addresses = await (dependencies.resolveAddresses ?? resolveAddresses)(new URL(connection.endpoint).hostname);
    if (!addresses.length || addresses.some(address => !isPublicAddress(address)) && !isExplicitLoopbackHttp(connection.endpoint, addresses)) return { state: "failed", reasonCode: "endpoint-address-refused" };
    const response = dependencies.request
      ? await dependencies.request(`${connection.endpoint}/v1/identity`, { method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" }, redirect: "error" })
      : await pinnedIdentityRequest(connection.endpoint, token, addresses[0]!);
    if (!response.ok) return { state: "failed", reasonCode: response.status === 401 ? "authentication-failed" : "identity-unavailable" };
    const identity = await response.json() as Record<string, unknown>;
    if (identity.v !== "reelier.authority-cell-identity/v1" || typeof identity.cellId !== "string" || typeof identity.adapterContractDigest !== "string") return { state: "failed", reasonCode: "identity-invalid" };
    if (identity.cellId !== connection.expectedCellId) return { state: "failed", reasonCode: "cell-id-mismatch", cellId: identity.cellId };
    if (identity.adapterContractDigest !== connection.adapterContractDigest) return { state: "failed", reasonCode: "adapter-contract-mismatch", cellId: identity.cellId, adapterContractDigest: identity.adapterContractDigest };
    return { state: "verified", reasonCode: "identity-verified", cellId: identity.cellId, adapterContractDigest: identity.adapterContractDigest };
  } catch { return { state: "unchecked", reasonCode: "identity-unavailable" }; }
}

async function resolveToken(reference: AuthorityCellConnectionV1["bearerTokenRef"], credentialRoot = path.resolve(".reelier", "credentials")): Promise<string> {
  if (reference.startsWith("env:")) { const value = process.env[reference.slice(4)]; if (!value) throw new Error("unavailable"); return value; }
  const file = path.resolve(reference.slice(5)); const root = path.resolve(credentialRoot); const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("unavailable");
  let current = root;
  for (const part of relative.split(path.sep)) { const stat = await lstat(current); if (stat.isSymbolicLink()) throw new Error("unavailable"); current = path.join(current, part); }
  const stat = await lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unavailable");
  const [canonicalRoot, canonicalFile] = await Promise.all([realpath(root), realpath(file)]);
  const canonicalRelative = path.relative(canonicalRoot, canonicalFile); if (canonicalRelative.startsWith("..") || path.isAbsolute(canonicalRelative)) throw new Error("unavailable");
  const value = (await readFile(file, "utf8")).trim(); if (!value) throw new Error("unavailable"); return value;
}

async function resolveAddresses(hostname: string): Promise<readonly string[]> {
  if (isIpAddress(hostname)) return [hostname];
  return (await lookup(hostname, { all: true, verbatim: true })).map(entry => entry.address);
}
function isExplicitLoopbackHttp(endpoint: string, addresses: readonly string[]): boolean { const url = new URL(endpoint); return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1") && addresses.every(isLoopbackAddress); }
function isIpAddress(address: string): boolean { return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address) || address.includes(":"); }
function isLoopbackAddress(address: string): boolean { return address === "::1" || address.startsWith("127."); }
function isPublicAddress(address: string): boolean {
  const value = address.toLowerCase().replace(/^::ffff:/, "");
  const mapped = mappedIpv4(value); if (mapped) return isPublicAddress(mapped);
  if (value.includes(":")) return !(value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") || value.startsWith("ff"));
  const parts = value.split(".").map(Number); const [a, b] = parts;
  return parts.length === 4 && parts.every(part => part >= 0 && part <= 255) && !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || a >= 224);
}
function mappedIpv4(value: string): string | undefined {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return undefined;
  const source = value.replace(/^\[|\]$/g, ""); const pivot = source.indexOf("::");
  const left = pivot < 0 ? source.split(":") : source.slice(0, pivot).split(":").filter(Boolean); const right = pivot < 0 ? [] : source.slice(pivot + 2).split(":").filter(Boolean);
  if (left.some(part => !/^[0-9a-f]{1,4}$/i.test(part)) || right.some(part => !/^[0-9a-f]{1,4}$/i.test(part)) || left.length + right.length > 8) return undefined;
  const parts = pivot < 0 ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (parts.length !== 8 || parts.slice(0, 5).some(part => Number.parseInt(part, 16) !== 0) || Number.parseInt(parts[5]!, 16) !== 0xffff) return undefined;
  const high = Number.parseInt(parts[6]!, 16); const low = Number.parseInt(parts[7]!, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}
async function pinnedIdentityRequest(endpoint: string, token: string, address: string): Promise<Response> {
  const url = new URL(`${endpoint}/v1/identity`);
  return new Promise((resolve, reject) => { const request = url.protocol === "https:" ? httpsRequest : httpRequest; const options = { method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" }, ...(url.protocol === "https:" ? { servername: url.hostname } : {}), lookup: (_host: string, _options: unknown, callback: (error: Error | null, address: string, family: number) => void) => callback(null, address, address.includes(":") ? 6 : 4) }; const req = request(url, options, response => { const chunks: Buffer[] = []; response.on("data", chunk => chunks.push(Buffer.from(chunk))); response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 0 }))); }); req.once("error", reject); req.end(); });
}
