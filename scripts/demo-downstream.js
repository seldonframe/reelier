#!/usr/bin/env node
// A small stdio MCP server used for end-to-end smokes of `reelier mcp` /
// `reelier compile` / `reelier run` (see README's "Record" and "Compile"
// sections). Tools: add {a, b}; create_note {text} -> {id, text} (stateful,
// a fresh random id every call — replay must never depend on a recorded id
// value, which is exactly what the compiler's dataflow recovery exists to
// prove); get_note {id} -> {id, text, found}.

import { randomBytes } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "demo-downstream", version: "0.0.1" }, { capabilities: { tools: {} } });

const notes = new Map();

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
    {
      name: "create_note",
      description: "Creates a note and returns {id, text}. A fresh random id every call.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
    {
      name: "get_note",
      description: "Fetches a note by id and returns {id, text, found}.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
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
  if (name === "create_note") {
    const { text } = args ?? {};
    const id = `note_${randomBytes(4).toString("hex")}`;
    notes.set(id, text);
    return { content: [{ type: "text", text: JSON.stringify({ id, text }) }] };
  }
  if (name === "get_note") {
    const { id } = args ?? {};
    const found = notes.has(id);
    return {
      content: [{ type: "text", text: JSON.stringify({ id, text: found ? notes.get(id) : null, found }) }],
    };
  }
  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
