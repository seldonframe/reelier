import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

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
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(connection, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); await rename(temporary, target); }
  finally { /* a failed write leaves no authority artifact; best-effort cleanup is intentionally omitted */ }
  return connection;
}

export function defaultAuthorityCellConnectionFile(): string { return path.resolve(".reelier", "authority-cell-connection.json"); }

function normalizeEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError("authority cell endpoint is invalid"); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname)))) throw new TypeError("authority cell endpoint is unsafe");
  const pathname = url.pathname.replace(/\/+$/, "") || "";
  return `${url.protocol}//${url.host}${pathname}`;
}

function isLoopback(hostname: string): boolean { return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(hostname); }

function parseTokenReference(value: string): `env:${string}` | `file:${string}` {
  if (/^env:[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value)) return value as `env:${string}`;
  const file = value.slice(5);
  if (value.startsWith("file:") && file && !/[\0\r\n]/.test(file) && !file.split(/[\\/]/).includes("..") && (path.isAbsolute(file) || path.win32.isAbsolute(file))) return value as `file:${string}`;
  throw new TypeError("authority cell token reference is invalid");
}
