#!/usr/bin/env node
// A ~40-line stdio MCP server used only for the real end-to-end smoke of
// `reelier mcp` (see README's "Record" section). One tool: add {a, b}.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "demo-downstream", version: "0.0.1" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "add",
      description: "Adds two numbers and returns {result}.",
      inputSchema: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === "add") {
    const { a, b } = args ?? {};
    return { content: [{ type: "text", text: JSON.stringify({ result: a + b }) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
