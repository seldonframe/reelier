import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isPublicIpAddress, normalizeIpLiteral } from "./ip.js";

export interface AuthorityCellConnectionV1 {
  readonly v: "reelier.authority-cell-connection/v1";
  readonly endpoint: string;
  readonly transport: "http";
  readonly bearerTokenRef: `env:${string}` | `file:${string}`;
  readonly expectedCellId: string;
  readonly adapterContractDigest: `sha256:${string}`;
}

const KEYS = ["v", "endpoint", "transport", "bearerTokenRef", "expectedCellId", "adapterContractDigest"] as const;
const DIGEST = /^sha256:(?!0{64}$)[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

interface AuthorityCellClientRuntime {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly homedir?: string;
}

/** Closed, inert local configuration parser. It never dereferences token references. */
export function parseAuthorityCellConnectionV1(value: unknown): AuthorityCellConnectionV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("authority cell connection must be an object");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== KEYS.length || KEYS.some(key => !(key in descriptors)) || Object.keys(descriptors).some(key => !KEYS.includes(key as typeof KEYS[number])) || Object.values(descriptors).some(descriptor => !("value" in descriptor) || descriptor.get || descriptor.set)) throw new TypeError("authority cell connection is closed");
  const raw = Object.fromEntries(KEYS.map(key => [key, descriptors[key]!.value])) as Record<string, unknown>;
  if (raw.v !== "reelier.authority-cell-connection/v1" || raw.transport !== "http" || typeof raw.endpoint !== "string" || typeof raw.bearerTokenRef !== "string" || typeof raw.expectedCellId !== "string" || typeof raw.adapterContractDigest !== "string") throw new TypeError("authority cell connection is invalid");
  if (!IDENTIFIER.test(raw.expectedCellId) || !DIGEST.test(raw.adapterContractDigest)) throw new TypeError("authority cell connection identity or digest is invalid");
  return Object.freeze({ v: raw.v, endpoint: normalizeEndpoint(raw.endpoint), transport: raw.transport, bearerTokenRef: parseTokenReference(raw.bearerTokenRef), expectedCellId: raw.expectedCellId, adapterContractDigest: raw.adapterContractDigest as `sha256:${string}` });
}

export async function loadAuthorityCellConnection(file = defaultAuthorityCellConnectionFile()): Promise<AuthorityCellConnectionV1> {
  return parseAuthorityCellConnectionV1(JSON.parse(await readFile(path.resolve(file), "utf8")));
}

export async function writeAuthorityCellConnection(file: string, value: unknown): Promise<AuthorityCellConnectionV1> {
  const connection = parseAuthorityCellConnectionV1(value);
  const target = path.resolve(file);
  await assertSafeParent(path.dirname(target));
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(connection, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); await rename(temporary, target); }
  finally { /* a failed write leaves no authority artifact; best-effort cleanup is intentionally omitted */ }
  return connection;
}

async function assertSafeParent(directory: string): Promise<void> {
  const parsed = path.parse(directory); let current = parsed.root;
  for (const part of directory.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { const stat = await lstat(current); if (stat.isSymbolicLink()) throw new TypeError("authority cell connection parent is unsafe"); }
    catch (error) { if (error instanceof TypeError) throw error; await mkdir(current); const stat = await lstat(current); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new TypeError("authority cell connection parent is unsafe"); }
  }
}

export function defaultAuthorityCellConnectionFile(runtime: AuthorityCellClientRuntime = {}): string {
  if ((runtime.platform ?? process.platform) !== "win32") return path.resolve(".reelier", "authority-cell-connection.json");
  const env = runtime.env ?? process.env;
  const homedir = runtime.homedir ?? os.homedir();
  const localAppData = env.LOCALAPPDATA || path.join(homedir, "AppData", "Local");
  if (!path.isAbsolute(localAppData)) throw new TypeError("Windows authority cell connection location is unavailable");
  return path.join(path.resolve(localAppData), "Reelier", "authority-cell-connection.json");
}

export function authorityCellConnectionPathnameConfinement(_runtime: AuthorityCellClientRuntime = {}): "unchecked" {
  return "unchecked";
}

function normalizeEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError("authority cell endpoint is invalid"); }
  if (url.username || url.password || url.search || url.hash || (isUnsafeLiteral(url.hostname) && !(url.protocol === "http:" && isLoopback(url.hostname))) || (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname)))) throw new TypeError("authority cell endpoint is unsafe");
  const pathname = url.pathname.replace(/\/+$/, "") || "";
  return `${url.protocol}//${url.host}${pathname}`;
}

function isLoopback(hostname: string): boolean { return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(hostname); }
function isUnsafeLiteral(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalizeIpLiteral(host)) return !isPublicIpAddress(host);
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const [a, b] = host.split(".").map(Number); return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function parseTokenReference(value: string): `env:${string}` | `file:${string}` {
  if (/^env:[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value)) return value as `env:${string}`;
  const file = value.slice(5);
  if (value.startsWith("file:") && file && !/[\0\r\n]/.test(file) && !file.split(/[\\/]/).includes("..") && (path.isAbsolute(file) || path.win32.isAbsolute(file))) return value as `file:${string}`;
  throw new TypeError("authority cell token reference is invalid");
}
