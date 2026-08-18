import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildAuthorityMcpServer, type AuthorityIngressOutcome, type AuthorityMcpHandler } from "../ingress/mcp.js";
import { handleAuthorityHttp } from "../ingress/http.js";
import type { AuthorityHostConfig } from "./config.js";
import type { StagedArtifactCommitmentV1 } from "./artifacts.js";
import type { AuthorityExecutionContextV1 } from "../types.js";
import type { PrincipalRegistry } from "./principal-registry.js";
import { assertLinuxAuthorityCellHost } from "./platform.js";
import { AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST } from "../adapter-contract.js";

type AuthorityContext = { readonly tenant: string; readonly requester: string; readonly executionContext?: AuthorityExecutionContextV1 };

export interface AuthorityHostRuntime {
  readonly directOutcomeAliases?: readonly string[];
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
export function createAuthorityHostServer(config: AuthorityHostConfig, runtime: AuthorityHostRuntime, options: Readonly<{ principalRegistry?: PrincipalRegistry; stdioExecutionContext?: AuthorityExecutionContextV1 }> = {}): AuthorityHostServer {
  assertLinuxAuthorityCellHost();
  const handler: AuthorityMcpHandler = { outcome: runtime.outcome, status: runtime.status, jobsSearch: runtime.jobsSearch, jobLoad: runtime.jobLoad, invoke: runtime.invoke, delegationRequest: runtime.delegationRequest, delegationStatus: runtime.delegationStatus, taskCreate: runtime.taskCreate, taskStatus: runtime.taskStatus };
  const stdioContext = { tenant: config.tenant, requester: config.requester, ...(options.stdioExecutionContext ? { executionContext: options.stdioExecutionContext } : {}) };
  const httpContext = { tenant: config.tenant, requester: config.requester, identity: { cellId: config.authorityCellId ?? config.tenant, adapterContractDigest: AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST }, resolvePrincipal: async (header: string | undefined) => { try { const raw = header?.startsWith("Bearer ") ? header.slice(7).trim() : ""; if (!raw || !options.principalRegistry) return undefined; const principal = await options.principalRegistry.resolve(raw); return { tenant: principal.tenant, requester: principal.principalId, executionContext: { v: "reelier.authority-execution-context/v1" as const, taskId: principal.taskId, principalId: principal.principalId, grantId: principal.grantId, grantDigest: principal.grantDigest, allocationId: principal.allocationId, runtimeSessionId: principal.runtimeSessionId, jobId: principal.jobId, authorityCellId: principal.authorityCellId } }; } catch { return undefined; } } };
  const mcp = buildAuthorityMcpServer((runtime.directOutcomeAliases ?? config.definitions).map(alias => ({ alias })), handler, stdioContext, runtime.artifactStage);
  const http = createServer((request: IncomingMessage, response: ServerResponse) => { void handleAuthorityHttp(request, response, handler, httpContext, runtime.artifactStage); });
  return {
    mcp,
    http,
    startStdio: async () => { await mcp.connect(new StdioServerTransport()); },
    startHttp: async (port, host = "127.0.0.1") => { await new Promise<void>((resolve, reject) => { const onError = (error: Error) => { http.off("listening", onListening); reject(error); }; const onListening = () => { http.off("error", onError); resolve(); }; http.once("error", onError); http.once("listening", onListening); http.listen(port, host); }); },
    close: async () => { await new Promise<void>(resolve => { if (!http.listening) return resolve(); http.close(() => resolve()); http.closeAllConnections?.(); }); },
  };
}
