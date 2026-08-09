import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export interface AuthorityIngressOutcome { readonly requestId: string; readonly verdict: "accepted" | "refused"; readonly reasonCode: string; readonly lifecycleState: string; readonly receiptRef?: string; }
export interface AuthorityMcpHandler { outcome(alias: string, input: unknown, context: { readonly tenant: string; readonly requester: string }): Promise<AuthorityIngressOutcome>; status(input: unknown, context: { readonly tenant: string; readonly requester: string }): Promise<AuthorityIngressOutcome>; }
export interface AuthorityMcpDefinition { readonly alias: string; readonly description?: string; }

export function buildAuthorityMcpServer(definitions: readonly AuthorityMcpDefinition[], handler: AuthorityMcpHandler, context: { readonly tenant: string; readonly requester: string }): Server {
  const server = new Server({ name: "reelier-authority", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    ...definitions.map(definition => ({ name: `reelier_outcome_${definition.alias}`, description: definition.description ?? `Request governed outcome ${definition.alias}`, inputSchema: { type: "object", additionalProperties: false, required: ["requestId", "sourceRefs", "choices"], properties: { requestId: { type: "string" }, sourceRefs: { type: "object", additionalProperties: { type: "string" } }, choices: { type: "object", additionalProperties: false } } } })),
    { name: "reelier_outcome_status", description: "Read the redacted lifecycle of a governed outcome.", inputSchema: { type: "object", additionalProperties: false, required: ["requestId"], properties: { requestId: { type: "string" } } } },
  ] }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const name = request.params.name; const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const value = name === "reelier_outcome_status" ? await handler.status(args, context) : name.startsWith("reelier_outcome_") ? await handler.outcome(name.slice("reelier_outcome_".length), args, context) : undefined;
      if (!value) throw new Error("unknown authority tool");
      return { content: [{ type: "text", text: JSON.stringify(value) }] };
    } catch { return { isError: true, content: [{ type: "text", text: JSON.stringify({ verdict: "refused", reasonCode: "host-unavailable", lifecycleState: "unavailable", requestId: "" }) }] }; }
  });
  return server;
}
