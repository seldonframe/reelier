import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export interface AuthorityIngressOutcome { readonly requestId: string; readonly verdict: "accepted" | "refused"; readonly reasonCode: string; readonly lifecycleState: string; readonly receiptRef?: string; }
export interface AuthorityMcpHandler { outcome(alias: string, input: unknown, context: { readonly tenant: string; readonly requester: string }): Promise<AuthorityIngressOutcome>; status(input: unknown, context: { readonly tenant: string; readonly requester: string }): Promise<AuthorityIngressOutcome>; jobsSearch?: (input: unknown, context: { readonly tenant: string; readonly requester: string }) => Promise<unknown>; jobLoad?: (input: unknown, context: { readonly tenant: string; readonly requester: string }) => Promise<unknown>; invoke?: (input: unknown, context: { readonly tenant: string; readonly requester: string }) => Promise<AuthorityIngressOutcome>; }
export interface AuthorityMcpDefinition { readonly alias: string; readonly description?: string; }

export function buildAuthorityMcpServer(definitions: readonly AuthorityMcpDefinition[], handler: AuthorityMcpHandler, context: { readonly tenant: string; readonly requester: string }, artifactStage?: (input: unknown, context: { readonly tenant: string; readonly requester: string }) => Promise<unknown>): Server {
  const server = new Server({ name: "reelier-authority", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    { name: "reelier_jobs_search", description: "Find deployed jobs without loading every Outcome schema.", inputSchema: { type: "object", additionalProperties: false, properties: { query: { type: "string", maxLength: 256 } } } },
    { name: "reelier_job_load", description: "Load one deployed job and its bounded Outcome.", inputSchema: { type: "object", additionalProperties: false, required: ["jobId"], properties: { jobId: { type: "string", minLength: 1, maxLength: 128 } } } },
    { name: "reelier_outcome_invoke", description: "Invoke a loaded bounded Outcome on hosts without dynamic tool lists.", inputSchema: { type: "object", additionalProperties: false, required: ["jobRef", "requestId", "sourceRefs", "choices"], properties: { jobRef: { type: "string" }, requestId: { type: "string" }, sourceRefs: { type: "object", additionalProperties: { type: "string" } }, choices: { type: "object", additionalProperties: false } } } },
    ...definitions.map(definition => ({ name: `reelier_outcome_${definition.alias}`, description: definition.description ?? `Request governed outcome ${definition.alias}`, inputSchema: { type: "object", additionalProperties: false, required: ["requestId", "sourceRefs", "choices"], properties: { requestId: { type: "string" }, sourceRefs: { type: "object", additionalProperties: { type: "string" } }, choices: { type: "object", additionalProperties: false } } } })),
    { name: "reelier_outcome_status", description: "Read the redacted lifecycle of a governed outcome.", inputSchema: { type: "object", additionalProperties: false, required: ["requestId"], properties: { requestId: { type: "string" } } } },
    ...(artifactStage ? [{ name: "reelier_artifact_stage", description: "Stage text for a reviewed outcome; returns an opaque commitment only.", inputSchema: { type: "object", additionalProperties: false, required: ["requestId", "text", "mediaType"], properties: { requestId: { type: "string" }, text: { type: "string", maxLength: 262144 }, mediaType: { type: "string", const: "text/plain" }, sourceBinding: { type: "string" } } } }] : []),
  ] }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const name = request.params.name; const supplied = (request.params.arguments ?? {}) as Record<string, unknown>; const args = supplied.v === undefined ? { v: "reelier.outcome-request/v1", ...supplied } : supplied;
    try {
      const value = name === "reelier_jobs_search" && handler.jobsSearch ? await handler.jobsSearch(args, context)
        : name === "reelier_job_load" && handler.jobLoad ? await handler.jobLoad(args, context)
        : name === "reelier_outcome_invoke" && handler.invoke ? await handler.invoke(args, context)
        : name === "reelier_outcome_status" ? await handler.status(args, context)
        : name === "reelier_artifact_stage" && artifactStage ? await artifactStage(args, context)
        : name.startsWith("reelier_outcome_") ? await handler.outcome(name.slice("reelier_outcome_".length), args, context) : undefined;
      if (!value) throw new Error("unknown authority tool");
      return { content: [{ type: "text", text: JSON.stringify(value) }] };
    } catch { return { isError: true, content: [{ type: "text", text: JSON.stringify({ verdict: "refused", reasonCode: "host-unavailable", lifecycleState: "unavailable", requestId: "" }) }] }; }
  });
  return server;
}
