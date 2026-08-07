import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverOpportunities, type AgentOpportunity, type DiscoverySessionInput } from "./discovery.js";
import { agentSources, scanAgentSessions } from "./scan.js";
import { validateReelierPluginV1, type ReelierPluginV1 } from "./plugin.js";
import { detectMcpConfigs } from "./init.js";

export interface BridgeOptions {
  discovery?: (plugin: ReelierPluginV1) => Promise<AgentOpportunity[]>;
  nonce?: string;
  allowedOrigins?: string[];
}

export interface BridgeServer extends Server {}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 256 * 1024) throw new Error("request body exceeds 256kb");
  }
  return body;
}

async function defaultDiscovery(): Promise<AgentOpportunity[]> {
  const sessions = await scanAgentSessions(os.homedir());
  const formats = new Map(agentSources(os.homedir()).map((source) => [source.id, source.format]));
  const inputs: DiscoverySessionInput[] = [];
  for (const session of sessions) {
    try {
      inputs.push({
        content: await readFile(session.path, "utf8"),
        path: session.path,
        project: session.project,
        sourceId: session.sourceId,
        sourceLabel: session.sourceLabel,
        mtimeMs: session.mtimeMs,
        format: formats.get(session.sourceId),
      });
    } catch {
      // A transcript disappearing during a read is not a bridge failure.
    }
  }
  return discoverOpportunities(inputs);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

const PRIVATE_KEY = /(authorization|api[-_]?key|credential|password|private[-_]?key|prompt|raw[-_]?trace|secret|token|cookie|header|env|home|transcript|sessionpath|absolute.?path)/i;
function privateHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "::1" || hostname === "127.0.0.1" || hostname.startsWith("10.") || hostname.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
}
function sanitize(value: unknown, removed: string[], key = ""): unknown {
  if (PRIVATE_KEY.test(key)) { removed.push(key); return undefined; }
  if (typeof value === "string") {
    if (/^(?:[A-Za-z]:[\\/]|\\\\|\/Users\/|\/home\/|\/tmp\/)/.test(value)) { removed.push(key || "path"); return undefined; }
    try {
      const url = new URL(value);
      if (privateHost(url.hostname)) { removed.push(key || "privateUrl"); return undefined; }
    } catch { /* not a URL */ }
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => sanitize(entry, removed, `${key}[${index}]`)).filter((entry) => entry !== undefined);
  if (typeof value !== "object" || value === null) return value;
  const output: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(value)) {
    const clean = sanitize(child, removed, childKey);
    if (clean !== undefined) output[childKey] = clean;
  }
  return output;
}

function sanitizeOpportunities(opportunities: AgentOpportunity[]): AgentOpportunity[] {
  return opportunities.map((opportunity) => ({ ...opportunity, sessionPaths: [] }));
}

export function createBridgeServer(options: BridgeOptions = {}): BridgeServer {
  const discovery = options.discovery ?? (() => defaultDiscovery());
  const nonce = options.nonce ?? randomBytes(24).toString("base64url");
  const allowedOrigins = new Set(options.allowedOrigins ?? ["http://localhost", "http://127.0.0.1"]);
  return createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "origin");
    }
    if (request.method === "OPTIONS") {
      if (origin && !allowedOrigins.has(origin)) { json(response, 403, { error: "origin not allowed" }); return; }
      response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      response.setHeader("access-control-allow-headers", "content-type,x-reelier-nonce");
      response.writeHead(204);
      response.end();
      return;
    }
    try {
      if (request.method === "GET" && request.url === "/health") {
        json(response, 200, { protocol: "ReelierPluginV1", status: "ok" });
        return;
      }
      if (request.method === "GET" && request.url === "/v1/capabilities") {
        const configs = await detectMcpConfigs(process.cwd(), os.homedir());
        json(response, 200, {
          schemaVersion: "ReelierPluginV1",
          protocol: "ReelierLocalBridgeV1",
          nonce,
          endpoints: { recommend: "/v1/recommend", workCard: "/v1/work-card" },
          local: {
            mcpConfigs: configs.map((config) => ({ label: config.label, present: true })),
            installedHarnesses: agentSources(os.homedir()).map((source) => ({ id: source.id, label: source.label })),
          },
        });
        return;
      }
      if (request.method !== "POST" || !["/v1/recommend", "/v1/work-card"].includes(request.url ?? "")) {
        json(response, 404, { error: "not found" });
        return;
      }
      if (request.headers["x-reelier-nonce"] !== nonce) { json(response, 401, { error: "capabilities nonce required" }); return; }
      const parsed: unknown = JSON.parse(await readBody(request));
      const envelope = typeof parsed === "object" && parsed !== null && "plugin" in parsed ? parsed as { plugin?: unknown; workCard?: unknown } : { plugin: parsed };
      const validation = validateReelierPluginV1(envelope.plugin);
      if (!validation.ok) {
        json(response, 400, { error: "invalid ReelierPluginV1 manifest", details: validation.errors });
        return;
      }
      if (request.url === "/v1/work-card") {
        const removedFields: string[] = [];
        const cleanWorkCard = sanitize(envelope.workCard ?? {}, removedFields);
        json(response, 200, { schemaVersion: "ReelierWorkCardV1", plugin: validation.value, accepted: true, workCard: cleanWorkCard, removedFields: [...new Set(removedFields)].sort() });
        return;
      }
      json(response, 200, { schemaVersion: "ReelierRecommendationV1", plugin: validation.value, opportunities: sanitizeOpportunities(await discovery(validation.value)) });
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}
