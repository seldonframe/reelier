import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { createPinnedLookup } from "../drivers/json-https.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const DNS = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SECRET_SHAPE = /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|AUTH|CREDENTIAL)(?:_|$)/i;

export interface TopologyProbeMachineConfigV1 {
  readonly v: "reelier.topology-probe-config/v1";
  readonly role: "agent" | "cell" | "gateway";
  readonly runtimeSession: string;
  readonly providerCredentialEnvNames: readonly string[];
  readonly allowedCredentialEnvNames: readonly string[];
  readonly rawWriteRouteIds: readonly string[];
  readonly readSurfaceIds: readonly string[];
  readonly providerEndpoints: readonly string[];
  readonly egressProxy: Readonly<{ baseUrl: string; bearerEnvName: string }> | null;
  readonly schemaDigest: string;
}

export interface TopologyProbeSnapshotV1 {
  readonly v: "reelier.topology-probe-snapshot/v1";
  readonly role: "agent" | "cell" | "gateway";
  readonly nonce: string;
  readonly runtimeSession: string;
  readonly providerCredentialRefs: readonly string[];
  readonly unexpectedCredentialRefs: readonly string[];
  readonly rawWriteRouteIds: readonly string[];
  readonly readSurfaceIds: readonly string[];
  readonly providerEndpoints: readonly string[];
  readonly schemaDigest: string;
}

export interface TopologyProbeEgressV1 {
  readonly v: "reelier.topology-probe-egress/v1";
  readonly endpoint: string;
  readonly reachable: boolean;
}

export type TopologyProbeCommandResult = TopologyProbeSnapshotV1 | TopologyProbeEgressV1;

export async function runTopologyProbeCommand(input: Readonly<{
  action: "snapshot" | "egress";
  argument: string;
  config: unknown;
  env?: Readonly<Record<string, string | undefined>>;
  connect?: (endpoint: string) => Promise<boolean>;
}>): Promise<TopologyProbeCommandResult> {
  const config = parseTopologyProbeMachineConfig(input.config);
  if (input.action === "snapshot") {
    if (!ID.test(input.argument)) throw new TypeError("topology probe nonce is invalid");
    const env = input.env ?? process.env;
    const present = new Set(Object.keys(env).filter(name => env[name] !== undefined));
    const runtimeSession = typeof env.FLY_MACHINE_ID === "string" && ID.test(env.FLY_MACHINE_ID) ? env.FLY_MACHINE_ID : config.runtimeSession;
    const providerCredentialRefs = config.providerCredentialEnvNames.filter(name => present.has(name));
    const allowed = new Set([...config.providerCredentialEnvNames, ...config.allowedCredentialEnvNames]);
    const unexpectedCredentialRefs = [...present].filter(name => SECRET_SHAPE.test(name) && !allowed.has(name)).sort();
    return Object.freeze({
      v: "reelier.topology-probe-snapshot/v1" as const,
      role: config.role,
      nonce: input.argument,
      runtimeSession,
      providerCredentialRefs: Object.freeze(providerCredentialRefs),
      unexpectedCredentialRefs: Object.freeze(unexpectedCredentialRefs),
      rawWriteRouteIds: config.rawWriteRouteIds,
      readSurfaceIds: config.readSurfaceIds,
      providerEndpoints: config.providerEndpoints,
      schemaDigest: config.schemaDigest,
    });
  }
  if (input.action !== "egress") throw new TypeError("topology probe action is invalid");
  const endpoint = normalizeEndpoint(input.argument);
  if (!config.providerEndpoints.includes(endpoint)) throw new TypeError("topology probe endpoint is not declared");
  const reachable = await (input.connect ?? (host => probeProviderHttps(host, config.egressProxy, input.env ?? process.env)))(endpoint);
  return Object.freeze({ v: "reelier.topology-probe-egress/v1" as const, endpoint, reachable: Boolean(reachable) });
}

export function parseTopologyProbeMachineConfig(value: unknown): TopologyProbeMachineConfigV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("topology probe config must be an object");
  const raw = value as Record<string, unknown>;
  const keys = ["v", "role", "runtimeSession", "providerCredentialEnvNames", "allowedCredentialEnvNames", "rawWriteRouteIds", "readSurfaceIds", "providerEndpoints", "egressProxy", "schemaDigest"];
  if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) throw new TypeError("topology probe config is closed");
  if (raw.v !== "reelier.topology-probe-config/v1" || (raw.role !== "agent" && raw.role !== "cell" && raw.role !== "gateway")) throw new TypeError("topology probe config identity is invalid");
  if (typeof raw.runtimeSession !== "string" || !ID.test(raw.runtimeSession)) throw new TypeError("topology probe runtime session is invalid");
  if (typeof raw.schemaDigest !== "string" || !DIGEST.test(raw.schemaDigest)) throw new TypeError("topology probe schema digest is invalid");
  const providerCredentialEnvNames = stringList(raw.providerCredentialEnvNames, "provider credential environment", ENV_NAME, true);
  const allowedCredentialEnvNames = stringList(raw.allowedCredentialEnvNames, "allowed credential environment", ENV_NAME, true);
  if (providerCredentialEnvNames.some(name => allowedCredentialEnvNames.includes(name))) throw new TypeError("topology probe credential lists overlap");
  return Object.freeze({
    v: "reelier.topology-probe-config/v1",
    role: raw.role,
    runtimeSession: raw.runtimeSession,
    providerCredentialEnvNames,
    allowedCredentialEnvNames,
    rawWriteRouteIds: stringList(raw.rawWriteRouteIds, "raw write route", ID, true),
    readSurfaceIds: stringList(raw.readSurfaceIds, "read surface", ID, true),
    providerEndpoints: dnsList(raw.providerEndpoints),
    egressProxy: parseEgressProxy(raw.egressProxy),
    schemaDigest: raw.schemaDigest,
  });
}

async function probeProviderHttps(hostname: string, proxy: TopologyProbeMachineConfigV1["egressProxy"], env: Readonly<Record<string, string | undefined>>): Promise<boolean> {
  if (proxy) return probeHttpsThroughProxy(hostname, proxy, env);
  try {
    const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) return false;
    const chosen = addresses[0].address;
    return await new Promise<boolean>(resolve => {
      let settled = false;
      const finish = (value: boolean) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
      const request = httpsRequest({ method: "HEAD", hostname, port: 443, path: "/", servername: hostname, lookup: createPinnedLookup(chosen), headers: { "user-agent": "reelier-topology-probe/1" } }, response => { response.resume(); finish(true); });
      request.once("error", () => finish(false));
      const timer = setTimeout(() => { request.destroy(); finish(false); }, 5_000);
      timer.unref();
      request.end();
    });
  } catch { return false; }
}

async function probeHttpsThroughProxy(hostname: string, proxy: NonNullable<TopologyProbeMachineConfigV1["egressProxy"]>, env: Readonly<Record<string, string | undefined>>): Promise<boolean> {
  try {
    const origin = new URL(proxy.baseUrl);
    const bearer = env[proxy.bearerEnvName];
    if (!bearer) return false;
    const addresses = await dnsLookup(origin.hostname, { all: true, verbatim: true });
    if (!addresses.length) return false;
    const chosen = addresses[0].address;
    return await new Promise<boolean>(resolve => {
      let settled = false;
      const finish = (value: boolean) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
      const request = httpRequest({ protocol: "http:", hostname: origin.hostname, port: origin.port || 8443, method: "CONNECT", path: `${hostname}:443`, headers: { "Proxy-Authorization": `Bearer ${bearer}` }, lookup: createPinnedLookup(chosen) });
      request.once("connect", (response, socket, head) => {
        if (response.statusCode !== 200 || head.length) { socket.destroy(); finish(false); return; }
        const secure = tlsConnect({ socket, servername: hostname, rejectUnauthorized: true });
        secure.once("secureConnect", () => { secure.destroy(); finish(true); }); secure.once("error", () => finish(false));
      });
      request.once("error", () => finish(false)); request.end();
      const timer = setTimeout(() => { request.destroy(); finish(false); }, 5_000); timer.unref();
    });
  } catch { return false; }
}

function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  }
  const normalized = address.toLowerCase();
  return !(normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized));
}

function normalizeEndpoint(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("topology probe endpoint is invalid");
  const endpoint = value.toLowerCase();
  if (!DNS.test(endpoint)) throw new TypeError("topology probe endpoint is invalid");
  return endpoint;
}

function dnsList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) throw new TypeError("topology probe provider endpoints are invalid");
  const list = value.map(normalizeEndpoint).sort();
  if (new Set(list).size !== list.length) throw new TypeError("topology probe provider endpoints must be unique");
  return Object.freeze(list);
}

function parseEgressProxy(value: unknown): TopologyProbeMachineConfigV1["egressProxy"] {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("topology probe egress proxy is invalid");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== 2 || typeof raw.baseUrl !== "string" || typeof raw.bearerEnvName !== "string" || !ENV_NAME.test(raw.bearerEnvName)) throw new TypeError("topology probe egress proxy is closed");
  let origin: URL; try { origin = new URL(raw.baseUrl); } catch { throw new TypeError("topology probe egress proxy is invalid"); }
  if (origin.protocol !== "http:" || !origin.hostname.endsWith(".internal") || origin.pathname !== "/" || origin.username || origin.password || origin.search || origin.hash) throw new TypeError("topology probe egress proxy is invalid");
  return Object.freeze({ baseUrl: origin.toString().replace(/\/$/, ""), bearerEnvName: raw.bearerEnvName });
}

function stringList(value: unknown, label: string, pattern: RegExp, emptyAllowed: boolean): readonly string[] {
  if (!Array.isArray(value) || (!emptyAllowed && value.length === 0) || value.length > 128 || value.some(item => typeof item !== "string" || !pattern.test(item))) throw new TypeError(`topology probe ${label} list is invalid`);
  const list = [...value].sort() as string[];
  if (new Set(list).size !== list.length) throw new TypeError(`topology probe ${label} list must be unique`);
  return Object.freeze(list);
}
