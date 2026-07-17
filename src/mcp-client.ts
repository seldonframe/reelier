// Shared MCP downstream connector. Used by both the recorder (src/recorder.ts,
// which re-exposes downstream tools as a proxy) and the runner (src/runner.ts
// callers, which replay recorded tool calls directly against a downstream).
//
// Deliberately dumb: connect, list tools, call tools, close. No interpretation.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/** A tool as reported by a downstream MCP server's tools/list. */
export interface DownstreamTool {
  name: string;
  description?: string;
  inputSchema: unknown;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
}

/** Raw MCP tools/call result shape (content blocks + optional error flag). */
export interface McpCallResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface DownstreamConnection {
  /** The downstream server's advertised name (falls back to the spec if unavailable). */
  name: string;
  tools: DownstreamTool[];
  call(toolName: string, args: unknown): Promise<McpCallResult>;
  close(): Promise<void>;
}

/**
 * Split a command-line string into argv, respecting simple single/double
 * quoting (no escape sequences, no shell expansion — this is not a shell).
 */
export function splitCommandLine(spec: string): string[] {
  const args: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let inArg = false;

  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inArg = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inArg) {
        args.push(cur);
        cur = "";
        inArg = false;
      }
      continue;
    }
    cur += ch;
    inArg = true;
  }
  if (quote) {
    throw new Error(`Unterminated quote in command line: ${JSON.stringify(spec)}`);
  }
  if (inArg) {
    args.push(cur);
  }
  return args;
}

/** Connect an MCP Client to an already-constructed transport and wrap it as a DownstreamConnection. */
async function connectDownstreamTransport(transport: Transport, fallbackName: string): Promise<DownstreamConnection> {
  const client = new Client({ name: "reelier", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);

  const listed = await client.listTools();
  const tools: DownstreamTool[] = listed.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations,
  }));

  const serverInfo = client.getServerVersion();
  const name = serverInfo?.name ?? fallbackName;

  return {
    name,
    tools,
    async call(toolName, args) {
      const result = await client.callTool({
        name: toolName,
        arguments: args as Record<string, unknown> | undefined,
      });
      return result as unknown as McpCallResult;
    },
    async close() {
      await client.close();
    },
  };
}

/**
 * Spawn a downstream MCP server over stdio from a full command line (e.g.
 * `npx -y @modelcontextprotocol/server-everything`), perform the initialize
 * handshake, and return a connection ready for tools/list + tools/call.
 */
export async function connectDownstream(spec: string): Promise<DownstreamConnection> {
  const argv = splitCommandLine(spec);
  if (argv.length === 0) {
    throw new Error(`Empty --wrap command line`);
  }
  const [command, ...args] = argv;
  const transport = new StdioClientTransport({ command, args });
  return connectDownstreamTransport(transport, spec);
}

/** Exported for tests, which link a fake in-process downstream via InMemoryTransport instead of spawning. */
export { connectDownstreamTransport };

export interface ToolRoute {
  /** The name this tool is exposed under to callers (after collision-prefixing). */
  exposedName: string;
  /** The name to call on the downstream server itself. */
  realName: string;
  downstream: DownstreamConnection;
  tool: DownstreamTool;
}

/**
 * Build the exposed-name -> route table for a list of downstreams, in order.
 * On a name collision, the later downstream's tool is exposed as
 * `<downstreamIndex>_<name>` (0-based index into `downstreams`), and a
 * warning is logged to stderr. This table is the single source of truth for
 * "recorded tool name == replayed tool name" — both the proxy and the runner
 * build routes with this same function so names agree.
 */
export function buildToolRoutes(downstreams: DownstreamConnection[]): Map<string, ToolRoute> {
  const routes = new Map<string, ToolRoute>();
  downstreams.forEach((downstream, idx) => {
    for (const tool of downstream.tools) {
      let exposedName = tool.name;
      if (routes.has(exposedName)) {
        exposedName = `${idx}_${tool.name}`;
        console.error(
          `[reelier] tool name collision: '${tool.name}' from downstream ${idx} (${downstream.name}) exposed as '${exposedName}'`
        );
      }
      routes.set(exposedName, { exposedName, realName: tool.name, downstream, tool });
    }
  });
  return routes;
}
