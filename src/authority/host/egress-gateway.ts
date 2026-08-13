import { createServer, type Server } from "node:http";
import { lookup as dnsLookup } from "node:dns/promises";
import { connect as netConnect, type Socket } from "node:net";
import { timingSafeEqual } from "node:crypto";
import type { Duplex } from "node:stream";
import type { SecretResolver } from "./secret-resolver.js";
import { assertLinuxAuthorityCellHost } from "./platform.js";
import { assertAllPublicAddresses } from "../client/ip.js";
import { createTotalDeadline } from "../net/deadline.js";

const DNS = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SECRET_REF = /^(?:env:[A-Za-z_][A-Za-z0-9_]{0,127}|file:.+)$/;

export interface AuthorityEgressGatewayConfigV1 {
  readonly v: "reelier.egress-gateway-config/v1";
  readonly bearerRef: string;
  readonly allowedHosts: readonly string[];
}

export interface AuthorityEgressGateway {
  readonly start: (port: number, host: string) => Promise<Readonly<{ port: number; host: string }>>;
  readonly close: () => Promise<void>;
}

export interface AuthorityEgressGatewayOptions {
  readonly config: unknown;
  readonly secrets: SecretResolver;
  readonly resolve?: (hostname: string) => Promise<readonly Readonly<{ address: string; family: number }>[]>;
  readonly dial?: (input: Readonly<{ address: string; port: number }>) => Promise<Duplex>;
  readonly timeoutMs?: number;
  readonly monotonicNow?: () => number;
}

export function parseAuthorityEgressGatewayConfig(value: unknown): AuthorityEgressGatewayConfigV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("egress gateway config must be an object");
  const raw = value as Record<string, unknown>;
  const keys = ["v", "bearerRef", "allowedHosts"];
  if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) throw new TypeError("egress gateway config is closed");
  if (raw.v !== "reelier.egress-gateway-config/v1" || typeof raw.bearerRef !== "string" || !SECRET_REF.test(raw.bearerRef)) throw new TypeError("egress gateway config identity is invalid");
  if (!Array.isArray(raw.allowedHosts) || raw.allowedHosts.length === 0 || raw.allowedHosts.length > 64) throw new TypeError("egress gateway host list is invalid");
  const allowedHosts = raw.allowedHosts.map(item => {
    if (typeof item !== "string" || !DNS.test(item.toLowerCase())) throw new TypeError("egress gateway host is invalid");
    return item.toLowerCase();
  }).sort();
  if (new Set(allowedHosts).size !== allowedHosts.length) throw new TypeError("egress gateway hosts must be unique");
  return Object.freeze({ v: "reelier.egress-gateway-config/v1", bearerRef: raw.bearerRef, allowedHosts: Object.freeze(allowedHosts) });
}

export function createAuthorityEgressGateway(options: AuthorityEgressGatewayOptions): AuthorityEgressGateway {
  assertLinuxAuthorityCellHost();
  const config = parseAuthorityEgressGatewayConfig(options.config);
  if (!options.secrets || typeof options.secrets.resolve !== "function") throw new TypeError("egress gateway secret resolver is required");
  const resolve = options.resolve ?? (hostname => dnsLookup(hostname, { all: true, verbatim: true }));
  const dial = options.dial ?? dialTcp;
  let server: Server | undefined;
  return Object.freeze({
    async start(port: number, host: string) {
      if (server) throw new TypeError("egress gateway is already started");
      if (!Number.isSafeInteger(port) || port < 0 || port > 65535 || typeof host !== "string" || !host.length) throw new TypeError("egress gateway listen address is invalid");
      server = createServer((_request, response) => { response.writeHead(405, { Connection: "close" }); response.end(); });
      server.on("connect", async (request, client, head) => {
        const refuse = (status: 400 | 403 | 407 | 502) => {
          const label = status === 407 ? "Proxy Authentication Required" : status === 403 ? "Forbidden" : status === 502 ? "Bad Gateway" : "Bad Request";
          if (!client.destroyed) client.end(`HTTP/1.1 ${status} ${label}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        };
        try {
          const deadline = createTotalDeadline({ timeoutMs: options.timeoutMs ?? 15_000, monotonicNow: options.monotonicNow });
          let upstream: Duplex | undefined;
          const timer = setTimeout(() => { client.destroy(); upstream?.destroy(); }, deadline.remainingMs("credential"));
          timer.unref(); client.once("close", () => clearTimeout(timer));
          deadline.remainingMs("credential");
          const expected = await options.secrets.resolve(config.bearerRef);
          deadline.remainingMs("credential");
          const authorization = request.headers["proxy-authorization"];
          const supplied = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
          if (!constantTimeEqual(supplied, expected)) { refuse(407); return; }
          const target = parseConnectTarget(request.url);
          if (!config.allowedHosts.includes(target.hostname)) { refuse(403); return; }
          deadline.remainingMs("dns");
          const addresses = await resolve(target.hostname);
          let pinned: readonly Readonly<{ address: string; family: 4 | 6 }>[];
          try { pinned = assertAllPublicAddresses(addresses.map(item => item.address)); } catch { refuse(502); return; }
          deadline.remainingMs("connect");
          upstream = await dial({ address: pinned[0]!.address, port: 443 });
          let opened = false;
          const open = () => {
            if (opened || client.destroyed) return;
            opened = true;
            client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            if (head.length) upstream.write(head);
            client.pipe(upstream); upstream.pipe(client);
          };
          if (isSocket(upstream) && upstream.connecting) upstream.once("connect", open); else open();
          upstream.once("error", () => { if (!opened) refuse(502); else client.destroy(); });
          client.once("error", () => upstream.destroy()); client.once("close", () => upstream.destroy());
        } catch { refuse(502); }
      });
      await new Promise<void>((resolveStart, reject) => { server!.once("error", reject); server!.listen(port, host, () => { server!.off("error", reject); resolveStart(); }); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("egress gateway did not bind a TCP address");
      return Object.freeze({ port: address.port, host });
    },
    async close() {
      if (!server) return;
      const closing = server; server = undefined;
      await new Promise<void>((resolveClose, reject) => closing.close(error => error ? reject(error) : resolveClose()));
    },
  });
}

function parseConnectTarget(value: string | undefined): Readonly<{ hostname: string; port: 443 }> {
  if (!value || value.length > 300) throw new TypeError("egress gateway CONNECT target is invalid");
  const match = /^([^:]+):443$/.exec(value);
  const hostname = match?.[1]?.toLowerCase();
  if (!hostname || !DNS.test(hostname)) throw new TypeError("egress gateway CONNECT target is invalid");
  return Object.freeze({ hostname, port: 443 });
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function dialTcp(input: Readonly<{ address: string; port: number }>): Promise<Socket> {
  return Promise.resolve(netConnect({ host: input.address, port: input.port }));
}
function isSocket(value: Duplex): value is Socket { return typeof (value as Socket).connecting === "boolean"; }
