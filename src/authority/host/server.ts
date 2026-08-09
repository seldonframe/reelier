import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildAuthorityMcpServer, type AuthorityIngressOutcome, type AuthorityMcpHandler } from "../ingress/mcp.js";
import { handleAuthorityHttp } from "../ingress/http.js";
import type { AuthorityHostConfig } from "./config.js";

export interface AuthorityHostRuntime {
  readonly outcome: (alias: string, input: unknown, context: { readonly tenant: string; readonly requester: string }) => Promise<AuthorityIngressOutcome>;
  readonly status: (input: unknown, context: { readonly tenant: string; readonly requester: string }) => Promise<AuthorityIngressOutcome>;
}

export interface AuthorityHostServer {
  readonly mcp: ReturnType<typeof buildAuthorityMcpServer>;
  readonly http: Server;
  readonly startStdio: () => Promise<void>;
  readonly startHttp: (port: number, host?: string) => Promise<void>;
  readonly close: () => Promise<void>;
}

/** One host-neutral server for every supported agent adapter. Provider effects remain injected. */
export function createAuthorityHostServer(config: AuthorityHostConfig, runtime: AuthorityHostRuntime): AuthorityHostServer {
  const handler: AuthorityMcpHandler = { outcome: runtime.outcome, status: runtime.status };
  const context = { tenant: config.tenant, requester: config.requester };
  const mcp = buildAuthorityMcpServer(config.definitions.map(alias => ({ alias })), handler, context);
  const http = createServer((request: IncomingMessage, response: ServerResponse) => { void handleAuthorityHttp(request, response, handler, context); });
  return {
    mcp,
    http,
    startStdio: async () => { await mcp.connect(new StdioServerTransport()); },
    startHttp: async (port, host = "127.0.0.1") => { await new Promise<void>((resolve, reject) => { const onError = (error: Error) => { http.off("listening", onListening); reject(error); }; const onListening = () => { http.off("error", onError); resolve(); }; http.once("error", onError); http.once("listening", onListening); http.listen(port, host); }); },
    close: async () => { await new Promise<void>(resolve => { if (!http.listening) return resolve(); http.close(() => resolve()); }); },
  };
}
