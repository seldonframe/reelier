// The proxy recorder: an MCP server (on stdio, via `reelier mcp`) that sits
// between an agent and one or more downstream MCP servers. It re-exposes
// downstream tools 1:1 as pure passthrough (never touches the live path) and
// adds three control tools that, while recording, write a lossless JSONL
// trace of every call. No interpretation happens here — that's the
// (not-yet-built) compiler's job.

import { mkdir, readdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildToolRoutes, type DownstreamConnection, type McpCallResult, type ToolRoute } from "./mcp-client.js";
import { redact } from "./redact.js";

export type TraceRecord =
  | { t: "meta"; seq: number; name: string; startedAt: string; wrapped: string[] }
  | { t: "note"; seq: number; ts: string; text: string }
  | { t: "call"; seq: number; i: number; ts: string; tool: string; args: unknown }
  | { t: "result"; seq: number; i: number; ok: boolean; ms: number; body: unknown };

function textResult(text: string): McpCallResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Owns recording state + the append-only trace file. All writes are
 * serialized through a promise chain so concurrent tool calls can never
 * interleave out of seq order — order in the file IS the association.
 */
export class Recorder {
  private traceDir: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private recording = false;
  private currentPath: string | null = null;
  private currentName: string | null = null;
  private seq = 0;
  private callIndex = 0;
  private callCount = 0;

  constructor(traceDir: string) {
    this.traceDir = traceDir;
  }

  get isRecording(): boolean {
    return this.recording;
  }

  private nextSeq(): number {
    return this.seq++;
  }

  private write(record: TraceRecord): void {
    if (!this.currentPath) return;
    const filePath = this.currentPath;
    this.writeQueue = this.writeQueue.then(() => appendFile(filePath, JSON.stringify(record) + "\n", "utf8"));
  }

  private async flush(): Promise<void> {
    await this.writeQueue;
  }

  /** Pick the next `<name>-<n>.jsonl` path such that no existing trace is ever overwritten. */
  private async nextTracePath(name: string): Promise<string> {
    await mkdir(this.traceDir, { recursive: true });
    let entries: string[] = [];
    try {
      entries = await readdir(this.traceDir);
    } catch {
      entries = [];
    }
    const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)\\.jsonl$`);
    let maxN = 0;
    for (const entry of entries) {
      const m = entry.match(re);
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    }
    return path.join(this.traceDir, `${name}-${maxN + 1}.jsonl`);
  }

  async start(name: string, wrapped: string[]): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
    if (this.recording) {
      return {
        ok: false,
        message: `Already recording "${this.currentName}" to ${this.currentPath}. Call reelier_stop_recording first.`,
      };
    }
    const filePath = await this.nextTracePath(name);
    this.currentPath = filePath;
    this.currentName = name;
    this.seq = 0;
    this.callIndex = 0;
    this.callCount = 0;
    this.recording = true;
    this.write({ t: "meta", seq: this.nextSeq(), name, startedAt: new Date().toISOString(), wrapped });
    await this.flush();
    return { ok: true, path: filePath };
  }

  note(text: string): { ok: true } | { ok: false; message: string } {
    if (!this.recording) {
      return { ok: false, message: `Not recording — call reelier_start_recording first. Note ignored: ${text}` };
    }
    this.write({ t: "note", seq: this.nextSeq(), ts: new Date().toISOString(), text });
    return { ok: true };
  }

  /** Record a call (before it's dispatched downstream). Returns the call index shared with the matching result. */
  recordCall(tool: string, args: unknown): number {
    const i = this.callIndex++;
    this.callCount++;
    this.write({ t: "call", seq: this.nextSeq(), i, ts: new Date().toISOString(), tool, args: redact(args) });
    return i;
  }

  recordResult(i: number, ok: boolean, ms: number, body: unknown): void {
    this.write({ t: "result", seq: this.nextSeq(), i, ok, ms, body: redact(body) });
  }

  async stop(): Promise<{ ok: true; path: string; callCount: number } | { ok: false; message: string }> {
    if (!this.recording) {
      return { ok: false, message: "Not recording — nothing to stop." };
    }
    await this.flush();
    const result = { ok: true as const, path: this.currentPath!, callCount: this.callCount };
    this.recording = false;
    this.currentPath = null;
    this.currentName = null;
    return result;
  }
}

const CONTROL_TOOL_DESCRIPTIONS: Record<string, string> = {
  reelier_start_recording:
    "Begin recording the tool calls you're ABOUT to make as a Reelier trace — it captures only calls made " +
    "after this, so you cannot record work retroactively. If the workflow already happened earlier this " +
    "session, do NOT re-do it just to record it — compile it straight from history instead " +
    "(reelier_from_session, or the `reelier serve` scan→from_session path). Otherwise: call reelier_note " +
    "before each logical step to narrate intent, then call the tools you'd normally call — they pass " +
    "through unchanged and are logged. Call reelier_stop_recording when done.",
  reelier_note:
    "Narrate what you're about to do, in one sentence (e.g. \"I'm about to pull this week's " +
    "bookings\"). No-op if not currently recording.",
  reelier_stop_recording: "Stop the current recording and return the trace file path + how many calls were logged.",
};

export interface ProxyServerOptions {
  traceDir: string;
}

/**
 * Build (but do not connect) the proxy MCP server for a set of already-
 * connected downstreams. Pure/testable — connecting a transport is the
 * caller's job (stdio for the real CLI, InMemory for tests).
 */
export function buildProxyServer(downstreams: DownstreamConnection[], options: ProxyServerOptions): Server {
  const routes = buildToolRoutes(downstreams);
  const recorder = new Recorder(options.traceDir);

  const server = new Server({ name: "reelier-proxy", version: "0.0.1" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [
      ...Array.from(routes.values()).map((route: ToolRoute) => ({
        name: route.exposedName,
        description: route.tool.description,
        inputSchema: route.tool.inputSchema as { type: "object"; [k: string]: unknown },
      })),
      {
        name: "reelier_start_recording",
        description: CONTROL_TOOL_DESCRIPTIONS.reelier_start_recording,
        inputSchema: { type: "object" as const, properties: { name: { type: "string" } }, required: ["name"] },
      },
      {
        name: "reelier_note",
        description: CONTROL_TOOL_DESCRIPTIONS.reelier_note,
        inputSchema: { type: "object" as const, properties: { text: { type: "string" } }, required: ["text"] },
      },
      {
        name: "reelier_stop_recording",
        description: CONTROL_TOOL_DESCRIPTIONS.reelier_stop_recording,
        inputSchema: { type: "object" as const, properties: {} },
      },
    ];
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<Record<string, unknown>> => {
    const { name, arguments: args } = request.params;

    if (name === "reelier_start_recording") {
      const traceName = (args as Record<string, unknown> | undefined)?.name;
      if (typeof traceName !== "string" || !traceName) {
        return { ...textResult("reelier_start_recording requires a string 'name' argument."), isError: true };
      }
      const wrapped = downstreams.map((d) => d.name);
      const result = await recorder.start(traceName, wrapped);
      return result.ok ? textResult(`Recording started: ${result.path}`) : textResult(result.message);
    }

    if (name === "reelier_note") {
      const text = (args as Record<string, unknown> | undefined)?.text;
      if (typeof text !== "string" || !text) {
        return { ...textResult("reelier_note requires a string 'text' argument."), isError: true };
      }
      const result = recorder.note(text);
      return result.ok ? textResult(`Noted: ${text}`) : textResult(result.message);
    }

    if (name === "reelier_stop_recording") {
      const result = await recorder.stop();
      return result.ok
        ? textResult(`Recording stopped: ${result.path} (${result.callCount} calls)`)
        : textResult(result.message);
    }

    const route = routes.get(name);
    if (!route) {
      return { ...textResult(`Unknown tool: ${name}`), isError: true };
    }

    const isRecording = recorder.isRecording;
    const callIndex = isRecording ? recorder.recordCall(name, args) : -1;
    const started = Date.now();
    let result: McpCallResult;
    let ok = true;
    try {
      result = await route.downstream.call(route.realName, args);
      ok = !result.isError;
    } catch (err) {
      ok = false;
      result = { ...textResult(`Error: ${(err as Error).message}`), isError: true };
    }
    if (isRecording) {
      recorder.recordResult(callIndex, ok, Date.now() - started, result);
    }
    return result;
  });

  return server;
}
