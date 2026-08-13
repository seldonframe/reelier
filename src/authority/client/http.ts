import { lstat, readFile, realpath } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { parseAuthorityCellConnectionV1, type AuthorityCellConnectionV1 } from "./config.js";
import { assertAllPublicAddresses, normalizeIpLiteral } from "./ip.js";
import { createTotalDeadline, type TotalDeadline } from "../net/deadline.js";

export type AuthorityCellLiveResult = Readonly<{ state: "verified" | "failed" | "unchecked" | "absent"; reasonCode: string; cellId?: string; adapterContractDigest?: string }>;
export interface AuthorityCellClientDependencies { readonly resolveToken?: (reference: AuthorityCellConnectionV1["bearerTokenRef"]) => Promise<string>; readonly request?: (url: string, init: RequestInit) => Promise<Response>; readonly credentialRoot?: string; readonly resolveAddresses?: (hostname: string) => Promise<readonly string[]>; readonly timeoutMs?: number; readonly monotonicNow?: () => number; }

/** Client-only live identity check. The token is resolved only here and never returned or logged. */
export async function checkAuthorityCellLive(value: unknown, dependencies: AuthorityCellClientDependencies = {}): Promise<AuthorityCellLiveResult> {
  let connection: AuthorityCellConnectionV1;
  try { connection = parseAuthorityCellConnectionV1(value); } catch { return { state: "failed", reasonCode: "connection-invalid" }; }
  try {
    const deadline = createTotalDeadline({ timeoutMs: dependencies.timeoutMs ?? 15_000, monotonicNow: dependencies.monotonicNow });
    deadline.remainingMs("dns");
    const addresses = await (dependencies.resolveAddresses ?? resolveAddresses)(new URL(connection.endpoint).hostname);
    let pinned: readonly Readonly<{ address: string; family: 4 | 6 }>[];
    try { pinned = assertAllPublicAddresses(addresses); } catch { return { state: "failed", reasonCode: "endpoint-address-refused" }; }
    deadline.remainingMs("credential");
    let token: string;
    try { token = await (dependencies.resolveToken ?? (reference => resolveToken(reference, dependencies.credentialRoot)))(connection.bearerTokenRef); }
    catch { return { state: "absent", reasonCode: "token-unavailable" }; }
    deadline.remainingMs("identity");
    const response = dependencies.request
      ? await dependencies.request(`${connection.endpoint}/v1/identity`, { method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" }, redirect: "error" })
      : await pinnedIdentityRequest(connection.endpoint, token, pinned[0]!.address, deadline);
    deadline.remainingMs("body");
    if (response.status >= 300 && response.status < 400) return { state: "failed", reasonCode: "identity-unavailable" };
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
  const literal = normalizeIpLiteral(hostname);
  if (literal) return [literal];
  return (await lookup(hostname, { all: true, verbatim: true })).map(entry => entry.address);
}
async function pinnedIdentityRequest(endpoint: string, token: string, address: string, deadline: TotalDeadline): Promise<Response> {
  const url = new URL(`${endpoint}/v1/identity`);
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    let settled = false;
    const finish = (error?: Error, response?: Response) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(response!); };
    const options = { method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" }, ...(url.protocol === "https:" ? { servername: url.hostname } : {}), lookup: (_host: string, _options: unknown, callback: (error: Error | null, address: string, family: number) => void) => callback(null, address, address.includes(":") ? 6 : 4) };
    const req = request(url, options, response => { const chunks: Buffer[] = []; let bytes = 0; response.on("data", chunk => { const value = Buffer.from(chunk); bytes += value.length; if (bytes > 1024 * 1024) req.destroy(new Error("identity response exceeds configured limit")); else chunks.push(value); }); response.on("end", () => finish(undefined, new Response(Buffer.concat(chunks), { status: response.statusCode ?? 0 }))); response.once("error", finish); });
    const timer = setTimeout(() => { req.destroy(new Error("authority identity deadline expired")); finish(new Error("authority identity deadline expired")); }, deadline.remainingMs("connect"));
    timer.unref(); req.once("error", finish); req.end();
  });
}
