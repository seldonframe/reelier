import type { IncomingMessage, ServerResponse } from "node:http";
import { authenticateOutcomeRequest } from "../keys.js";
import type { AuthorityMcpHandler } from "./mcp.js";

export async function handleAuthorityHttp(request: IncomingMessage, response: ServerResponse, handler: AuthorityMcpHandler, context: { readonly tenant: string; readonly requester: string }): Promise<void> {
  try {
    if (request.method !== "POST" && request.method !== "GET") return write(response, 405, { verdict: "refused", reasonCode: "method-not-allowed" });
    const url = new URL(request.url ?? "/", "http://authority.invalid");
    const match = /^\/v1\/outcomes\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
    if (!match) return write(response, 404, { verdict: "refused", reasonCode: "not-found" });
    const alias = decodeURIComponent(match[1]);
    const body = request.method === "POST" ? await readJson(request) : { requestId: match[2] };
    if (request.method === "GET") return write(response, 200, await handler.status(body, context));
    authenticateOutcomeRequest({ tenant: context.tenant, requester: context.requester, definitionAlias: alias, request: body });
    return write(response, 202, await handler.outcome(alias, body, context));
  } catch { return write(response, 400, { verdict: "refused", reasonCode: "invalid-request", lifecycleState: "refused", requestId: "" }); }
}
async function readJson(request: IncomingMessage): Promise<unknown> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); if (Buffer.concat(chunks).length > 64 * 1024) throw new Error("request too large"); return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
function write(response: ServerResponse, status: number, value: unknown): void { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(value)); }
