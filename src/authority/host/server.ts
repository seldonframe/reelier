import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildAuthorityMcpServer, type AuthorityIngressOutcome, type AuthorityMcpHandler } from "../ingress/mcp.js";
import { handleAuthorityHttp } from "../ingress/http.js";
import type { AuthorityHostConfig } from "./config.js";
import type { StagedArtifactCommitmentV1 } from "./artifacts.js";
import { createSecretResolver } from "./secret-resolver.js";
import type { AuthorityExecutionContextV1 } from "../types.js";
import type { PrincipalRegistry } from "./principal-registry.js";

type AuthorityContext = { readonly tenant: string; readonly requester: string; readonly executionContext?: AuthorityExecutionContextV1 };

export interface AuthorityHostRuntime {
  readonly outcome: (alias: string, input: unknown, context: AuthorityContext) => Promise<AuthorityIngressOutcome>;
  readonly status: (input: unknown, context: AuthorityContext) => Promise<AuthorityIngressOutcome>;
  readonly jobsSearch?: (input: unknown, context: AuthorityContext) => Promise<unknown>;
  readonly jobLoad?: (input: unknown, context: AuthorityContext) => Promise<unknown>;
  readonly invoke?: (input: unknown, context: AuthorityContext) => Promise<AuthorityIngressOutcome>;
  readonly artifactStage?: (input: unknown, context: AuthorityContext) => Promise<Readonly<{ requestId: string; verdict: "accepted" | "refused"; reasonCode: string; lifecycleState: string; commitment?: StagedArtifactCommitmentV1 }>>;
  readonly delegationRequest?: (input: unknown, context: AuthorityContext) => Promise<unknown>;
  readonly delegationStatus?: (input: unknown, context: AuthorityContext) => Promise<unknown>;
  readonly taskCreate?: (input: unknown, context: AuthorityContext) => Promise<unknown>;
  readonly taskStatus?: (input: unknown, context: AuthorityContext) => Promise<unknown>;
}

export interface AuthorityHostServer {
  readonly mcp: ReturnType<typeof buildAuthorityMcpServer>;
  readonly http: Server;
  readonly startStdio: () => Promise<void>;
  readonly startHttp: (port: number, host?: string) => Promise<void>;
  readonly close: () => Promise<void>;
}

/** One host-neutral server for every supported agent adapter. Provider effects remain injected. */
export function createAuthorityHostServer(config: AuthorityHostConfig, runtime: AuthorityHostRuntime, options: Readonly<{ principalRegistry?: PrincipalRegistry }> = {}): AuthorityHostServer {
  const handler: AuthorityMcpHandler = { outcome: runtime.outcome, status: runtime.status, jobsSearch: runtime.jobsSearch, jobLoad: runtime.jobLoad, invoke: runtime.invoke, delegationRequest: runtime.delegationRequest, delegationStatus: runtime.delegationStatus, taskCreate: runtime.taskCreate, taskStatus: runtime.taskStatus };
  const context = { tenant: config.tenant, requester: config.requester, requireBearer: Boolean(config.ingress?.bearerRef) || Boolean(options.principalRegistry), authenticate: options.principalRegistry ? undefined : config.ingress?.bearerRef ? async (header: string | undefined) => { try { const raw = header?.startsWith("Bearer ") ? header.slice(7) : ""; const expected = await createSecretResolver().resolve(config.ingress!.bearerRef!); const a = Buffer.from(raw); const b = Buffer.from(expected); return a.length === b.length && timingSafeEqual(a, b); } catch { return false; } } : undefined, resolvePrincipal: options.principalRegistry ? async (header: string | undefined) => { try { const raw = header?.startsWith("Bearer ") ? header.slice(7).trim() : ""; if (!raw) return undefined; const principal = await options.principalRegistry!.resolve(raw); return { tenant: principal.tenant, requester: principal.principalId, executionContext: { v: "reelier.authority-execution-context/v1" as const, taskId: principal.taskId, principalId: principal.principalId, grantId: principal.grantId, grantDigest: principal.grantDigest, allocationId: principal.allocationId, runtimeSessionId: principal.runtimeSessionId, jobId: principal.jobId, authorityCellId: principal.authorityCellId } }; } catch { return undefined; } } : undefined };
  const mcp = buildAuthorityMcpServer(config.definitions.map(alias => ({ alias })), handler, context, runtime.artifactStage);
  const http = createServer((request: IncomingMessage, response: ServerResponse) => { void handleAuthorityHttp(request, response, handler, context, runtime.artifactStage); });
  return {
    mcp,
    http,
    startStdio: async () => { await mcp.connect(new StdioServerTransport()); },
    startHttp: async (port, host = "127.0.0.1") => { if (!isLoopback(host) && !config.ingress?.bearerRef && !options.principalRegistry) throw new Error("non-loopback authority HTTP requires ingress bearer authentication"); await new Promise<void>((resolve, reject) => { const onError = (error: Error) => { http.off("listening", onListening); reject(error); }; const onListening = () => { http.off("error", onError); resolve(); }; http.once("error", onError); http.once("listening", onListening); http.listen(port, host); }); },
    close: async () => { await new Promise<void>(resolve => { if (!http.listening) return resolve(); http.close(() => resolve()); http.closeAllConnections?.(); }); },
  };
}

function isLoopback(host: string): boolean { const normalized = host.toLowerCase(); return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost"; }
