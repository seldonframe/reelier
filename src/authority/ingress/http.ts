import type { IncomingMessage, ServerResponse } from "node:http";
import { authenticateOutcomeRequest } from "../keys.js";
import type { AuthorityMcpHandler } from "./mcp.js";

export async function handleAuthorityHttp(request: IncomingMessage, response: ServerResponse, handler: AuthorityMcpHandler, context: { readonly tenant: string; readonly requester: string }, artifactStage?: (input: unknown, context: { readonly tenant: string; readonly requester: string }) => Promise<unknown>): Promise<void> {
  try {
    if (request.method !== "POST" && request.method !== "GET") return write(response, 405, { verdict: "refused", reasonCode: "method-not-allowed" });
    const url = new URL(request.url ?? "/", "http://authority.invalid");
    if (url.pathname === "/v1/artifacts" && request.method === "POST") {
      if (!artifactStage) return write(response, 503, { verdict: "refused", reasonCode: "artifact-staging-unavailable", lifecycleState: "unavailable", requestId: "" });
      return write(response, 202, await artifactStage(await readJson(request), context));
    }
    const match = /^\/v1\/outcomes\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
    if (!match) return write(response, 404, { verdict: "refused", reasonCode: "not-found" });
    const alias = decodeURIComponent(match[1]);
    const body = request.method === "POST" ? await readJson(request) : { requestId: match[2] };
    if (request.method === "GET") return write(response, 200, await handler.status(body, context));
    const normalized = normalizeIngressRequest(body);
    authenticateOutcomeRequest({ tenant: context.tenant, requester: context.requester, definitionAlias: alias, request: normalized });
    return write(response, 202, await handler.outcome(alias, normalized, context));
  } catch { return write(response, 400, { verdict: "refused", reasonCode: "invalid-request", lifecycleState: "refused", requestId: "" }); }
}
async function readJson(request: IncomingMessage): Promise<unknown> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); if (Buffer.concat(chunks).length > 64 * 1024) throw new Error("request too large"); return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
function write(response: ServerResponse, status: number, value: unknown): void { response.statusCode = status; response.setHeader("content-type", "application/json"); response.setHeader("connection", "close"); response.end(JSON.stringify(value)); }
function normalizeIngressRequest(value: unknown): unknown { if (!value || typeof value !== "object" || Array.isArray(value)) return value; const raw = value as Record<string, unknown>; return raw.v === undefined ? { v: "reelier.outcome-request/v1", ...raw } : value; }
