import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { normalizeOutcomeRequestV1 } from "./request.js";
import type { AuthorityExecutionContextV1 } from "../types.js";
import { agentToolMcpDefinitionsV1 } from "./agent-tool-contracts.js";
import { createAuthorityAgentTools, type AuthorityAgentToolsV1 } from "../host/agent-tools.js";

export interface AuthorityIngressOutcome { readonly requestId: string; readonly verdict: "accepted" | "refused"; readonly reasonCode: string; readonly lifecycleState: string; readonly receiptRef?: string; }
type AuthorityContext = { readonly tenant: string; readonly requester: string; readonly executionContext?: AuthorityExecutionContextV1 };
export interface AuthorityMcpHandler { outcome(alias: string, input: unknown, context: AuthorityContext): Promise<AuthorityIngressOutcome>; status(input: unknown, context: AuthorityContext): Promise<AuthorityIngressOutcome>; agentTools?: AuthorityAgentToolsV1; jobsSearch?: (input: unknown, context: AuthorityContext) => Promise<unknown>; jobLoad?: (input: unknown, context: AuthorityContext) => Promise<unknown>; invoke?: (input: unknown, context: AuthorityContext) => Promise<AuthorityIngressOutcome>; delegationRequest?: (input: unknown, context: AuthorityContext) => Promise<unknown>; delegationStatus?: (input: unknown, context: AuthorityContext) => Promise<unknown>; taskCreate?: (input: unknown, context: AuthorityContext) => Promise<unknown>; taskStatus?: (input: unknown, context: AuthorityContext) => Promise<unknown>; }
export interface AuthorityMcpDefinition { readonly alias: string; readonly description?: string; }

export function buildAuthorityMcpServer(definitions: readonly AuthorityMcpDefinition[], handler: AuthorityMcpHandler, context: AuthorityContext, artifactStage?: (input: unknown, context: AuthorityContext) => Promise<unknown>): Server {
  const server = new Server({ name: "reelier-authority", version: "1.0.0" }, { capabilities: { tools: {} } });
  const directOutcomeAliases = new Set(definitions.map(definition => definition.alias));
  const agentTools = handler.agentTools ?? createAuthorityAgentTools({
    jobsSearch: async (input, requestContext) => {
      if (!handler.jobsSearch) throw new TypeError("agent status is unavailable");
      return handler.jobsSearch(input, requestContext);
    },
    jobLoad: async (input, requestContext) => {
      if (!handler.jobLoad) throw new TypeError("Outcome proposal is unavailable");
      return handler.jobLoad(input, requestContext);
    },
    invoke: async (input, requestContext) => {
      if (!handler.invoke) throw new TypeError("Outcome request is unavailable");
      return handler.invoke(input, requestContext);
    },
    status: handler.status,
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    ...agentToolMcpDefinitionsV1(),
    { name: "reelier_jobs_search", description: "Find deployed jobs without loading every Outcome schema.", inputSchema: { type: "object", additionalProperties: false, properties: { query: { type: "string", maxLength: 256 } } } },
    { name: "reelier_job_load", description: "Load one deployed job and its bounded Outcome.", inputSchema: { type: "object", additionalProperties: false, required: ["jobId"], properties: { jobId: { type: "string", minLength: 1, maxLength: 128 } } } },
    { name: "reelier_delegation_request", description: "Request a narrower child authority from the authenticated parent task and allocation. Fan-out is computed by the Authority Cell.", inputSchema: { type: "object", additionalProperties: false, required: ["child", "effects"], properties: { child: { type: "object" }, effects: { type: "integer", minimum: 0 } } } },
    { name: "reelier_delegation_status", description: "Read the redacted state of a child delegation.", inputSchema: { type: "object", additionalProperties: false, required: ["grantId"], properties: { grantId: { type: "string" } } } },
    { name: "reelier_task_status", description: "Read the redacted authority graph for a task.", inputSchema: { type: "object", additionalProperties: false, required: ["taskId"], properties: { taskId: { type: "string" } } } },
    { name: "reelier_outcome_invoke", description: "Invoke a loaded bounded Outcome on hosts without dynamic tool lists.", inputSchema: { type: "object", additionalProperties: false, required: ["jobRef", "requestId", "sourceRefs", "choices"], properties: { jobRef: { type: "string" }, requestId: { type: "string" }, sourceRefs: { type: "object", additionalProperties: { type: "string" } }, choices: { type: "object", additionalProperties: false } } } },
    ...definitions.map(definition => ({ name: `reelier_outcome_${definition.alias}`, description: definition.description ?? `Request governed outcome ${definition.alias}`, inputSchema: { type: "object", additionalProperties: false, required: ["requestId", "sourceRefs", "choices"], properties: { requestId: { type: "string" }, sourceRefs: { type: "object", additionalProperties: { type: "string" } }, choices: { type: "object", additionalProperties: false } } } })),
    ...(artifactStage ? [{ name: "reelier_artifact_stage", description: "Stage text for a reviewed outcome; returns an opaque commitment only.", inputSchema: { type: "object", additionalProperties: false, required: ["requestId", "text", "mediaType"], properties: { requestId: { type: "string" }, text: { type: "string", maxLength: 262144 }, mediaType: { type: "string", const: "text/plain" }, sourceBinding: { type: "string" } } } }] : []),
  ] }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const name = request.params.name;
    const rawArgs = (request.params.arguments ?? {}) as Record<string, unknown>;
    const args = normalizeOutcomeRequestV1(rawArgs);
    try {
      const value = name === "reelier_agent_status" ? await agentTools.agentStatus(rawArgs, context)
        : name === "reelier_outcome_proposal" ? await agentTools.outcomeProposal(rawArgs, context)
        : name === "reelier_outcome_request" ? await agentTools.outcomeRequest(rawArgs, context)
        : name === "reelier_outcome_status" ? await agentTools.outcomeStatus(rawArgs, context)
        : name === "reelier_jobs_search" && handler.jobsSearch ? await handler.jobsSearch(args, context)
        : name === "reelier_job_load" && handler.jobLoad ? await handler.jobLoad(args, context)
        : name === "reelier_delegation_request" && handler.delegationRequest ? await handler.delegationRequest(args, context)
        : name === "reelier_delegation_status" && handler.delegationStatus ? await handler.delegationStatus(args, context)
        : name === "reelier_task_status" && handler.taskStatus ? await handler.taskStatus(args, context)
        : name === "reelier_outcome_invoke" && handler.invoke ? await handler.invoke(args, context)
        : name === "reelier_artifact_stage" && artifactStage ? await artifactStage(args, context)
        : name.startsWith("reelier_outcome_") && directOutcomeAliases.has(name.slice("reelier_outcome_".length)) ? await handler.outcome(name.slice("reelier_outcome_".length), args, context) : undefined;
      if (!value) throw new Error("unknown authority tool");
      return { structuredContent: value as Record<string, unknown>, content: [{ type: "text", text: JSON.stringify(value) }] };
    } catch { return { isError: true, content: [{ type: "text", text: JSON.stringify({ verdict: "refused", reasonCode: "host-unavailable", lifecycleState: "unavailable", requestId: "" }) }] }; }
  });
  return server;
}
