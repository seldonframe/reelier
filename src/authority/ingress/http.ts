import type { IncomingMessage, ServerResponse } from "node:http";
import { authenticateOutcomeRequest } from "../keys.js";
import type { AuthorityMcpHandler } from "./mcp.js";

export async function handleAuthorityHttp(request: IncomingMessage, response: ServerResponse, handler: AuthorityMcpHandler, context: { readonly tenant: string; readonly requester: string; readonly requireBearer?: boolean; readonly authenticate?: (header: string | undefined) => Promise<boolean> }, artifactStage?: (input: unknown, context: { readonly tenant: string; readonly requester: string }) => Promise<unknown>): Promise<void> {
  try {
    if (context.authenticate ? !await context.authenticate(request.headers.authorization) : context.requireBearer && !/^Bearer\s+\S+$/.test(String(request.headers.authorization ?? ""))) return write(response, 401, { verdict: "refused", reasonCode: "authentication-required", lifecycleState: "refused", requestId: "" });
    if (request.method !== "POST" && request.method !== "GET") return write(response, 405, { verdict: "refused", reasonCode: "method-not-allowed" });
    const url = new URL(request.url ?? "/", "http://authority.invalid");
    if (url.pathname === "/v1/jobs" && request.method === "GET") {
      if (!handler.jobsSearch) return write(response, 503, { verdict: "refused", reasonCode: "job-catalog-unavailable", lifecycleState: "unavailable", requestId: "" });
      return write(response, 200, await handler.jobsSearch({ query: url.searchParams.get("query") ?? "" }, publicContext(context)));
    }
    const jobLoad = /^\/v1\/jobs\/([^/]+)\/load$/.exec(url.pathname);
    if (jobLoad && request.method === "POST") {
      if (!handler.jobLoad) return write(response, 503, { verdict: "refused", reasonCode: "job-catalog-unavailable", lifecycleState: "unavailable", requestId: "" });
      await readJson(request);
      return write(response, 200, await handler.jobLoad({ jobId: decodeURIComponent(jobLoad[1]) }, publicContext(context)));
    }
    if (url.pathname === "/v1/delegations" && request.method === "POST") {
      if (!handler.delegationRequest) return write(response, 503, { verdict: "refused", reasonCode: "delegation-unavailable", lifecycleState: "unavailable" });
      const body = await readJson(request);
      if (hasIdentityOverride(body)) throw new Error("delegation identity is host-bound");
      return write(response, 202, await handler.delegationRequest(body, publicContext(context)));
    }
    if (url.pathname === "/v1/tasks" && request.method === "POST") {
      if (!handler.taskCreate) return write(response, 503, { verdict: "refused", reasonCode: "task-unavailable", lifecycleState: "unavailable" });
      const body = await readJson(request);
      if (hasIdentityOverride(body)) throw new Error("task identity is host-bound");
      return write(response, 202, await handler.taskCreate(body, publicContext(context)));
    }
    const delegationStatus = /^\/v1\/delegations\/([^/]+)$/.exec(url.pathname);
    if (delegationStatus && request.method === "GET") {
      if (!handler.delegationStatus) return write(response, 503, { verdict: "refused", reasonCode: "delegation-unavailable", lifecycleState: "unavailable" });
      return write(response, 200, await handler.delegationStatus({ grantId: decodeURIComponent(delegationStatus[1]) }, publicContext(context)));
    }
    const taskStatus = /^\/v1\/tasks\/([^/]+)$/.exec(url.pathname);
    if (taskStatus && request.method === "GET") {
      if (!handler.taskStatus) return write(response, 503, { verdict: "refused", reasonCode: "task-unavailable", lifecycleState: "unavailable" });
      return write(response, 200, await handler.taskStatus({ taskId: decodeURIComponent(taskStatus[1]) }, publicContext(context)));
    }
    if (url.pathname === "/v1/artifacts" && request.method === "POST") {
      if (!artifactStage) return write(response, 503, { verdict: "refused", reasonCode: "artifact-staging-unavailable", lifecycleState: "unavailable", requestId: "" });
      return write(response, 202, await artifactStage(await readJson(request, 10 * 1024 * 1024), publicContext(context)));
    }
    const match = /^\/v1\/outcomes\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
    if (!match) return write(response, 404, { verdict: "refused", reasonCode: "not-found" });
    const alias = decodeURIComponent(match[1]);
    const body = request.method === "POST" ? await readJson(request) : { requestId: match[2] };
    if (request.method === "GET") return write(response, 200, await handler.status(body, publicContext(context)));
    const normalized = normalizeIngressRequest(body);
    authenticateOutcomeRequest({ tenant: context.tenant, requester: context.requester, definitionAlias: alias, request: normalized });
    return write(response, 202, await handler.outcome(alias, normalized, publicContext(context)));
  } catch { return write(response, 400, { verdict: "refused", reasonCode: "invalid-request", lifecycleState: "refused", requestId: "" }); }
}
async function readJson(request: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> { const chunks: Buffer[] = []; let total = 0; for await (const chunk of request) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); total += buffer.byteLength; if (total > maxBytes) throw new Error("request too large"); chunks.push(buffer); } return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
function write(response: ServerResponse, status: number, value: unknown): void { response.statusCode = status; response.setHeader("content-type", "application/json"); response.setHeader("connection", "close"); response.end(JSON.stringify(value)); }
function publicContext(context: { readonly tenant: string; readonly requester: string }): { readonly tenant: string; readonly requester: string } { return { tenant: context.tenant, requester: context.requester }; }
function hasIdentityOverride(value: unknown): boolean { return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).some(key => key === "tenant" || key === "requester" || key === "parentPrincipal")); }
function normalizeIngressRequest(value: unknown): unknown { if (!value || typeof value !== "object" || Array.isArray(value)) return value; const raw = value as Record<string, unknown>; return raw.v === undefined ? { v: "reelier.outcome-request/v1", ...raw } : value; }
