import { appendFile, chmod, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net, { type Server } from "node:net";
import { normalizeObservedAction, type ObservedActionV1, type ObservationAdapterV1 } from "./index.js";

export type ObservationHost = "mcp" | "codex" | "claude-code" | "cursor" | "openclaw" | "eve" | "hermes" | "herdr";

export interface ObservationEnvelopeV1 {
  readonly v: "reelier.observation-envelope/v1";
  readonly sequence: number;
  readonly sessionId: string;
  readonly event: "action" | "session-start" | "session-end" | "task-start" | "task-end";
  readonly payload: unknown;
}

export interface ObservationService {
  readonly endpoint: string;
  readonly start: () => Promise<string>;
  readonly ingest: (envelope: unknown) => Promise<void>;
  readonly close: () => Promise<void>;
}

export function createObservationAdapter(host: ObservationHost): ObservationAdapterV1 {
  const adapterId = `observation-${host}-v1`;
  return Object.freeze({
    id: adapterId,
    host,
    observe(input: unknown): readonly ObservedActionV1[] {
      const raw = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
      const sessionId = typeof raw.sessionId === "string" && raw.sessionId ? raw.sessionId : "unknown-session";
      const items = Array.isArray(raw.actions) ? raw.actions : Array.isArray(input) ? input : [];
      return Object.freeze(items.map((item, index) => normalizeObservedAction({ ...(item as Record<string, unknown>), v: "reelier.observed-action/v1", adapterId, sessionId, actionId: typeof (item as Record<string, unknown>).actionId === "string" ? (item as Record<string, unknown>).actionId : `${sessionId}-${index}` })).map(action => Object.freeze(action)));
    },
  });
}

export function matchInstalledPacks(candidate: Readonly<{ actions: readonly Readonly<{ tool: string; effect?: string }>[] }>, manifests: readonly Readonly<{ alias: string; toolPatterns: readonly string[] }>[]): readonly string[] {
  const tools = new Set(candidate.actions.map(action => action.tool));
  return Object.freeze(manifests.filter(manifest => manifest.toolPatterns.length > 0 && manifest.toolPatterns.every(pattern => tools.has(pattern))).map(manifest => manifest.alias).sort());
}

export function createObservationService(options: Readonly<{ adapter: ObservationAdapterV1; onAction?: (action: ObservedActionV1) => void; appendPath?: string; socketPath?: string }>): ObservationService {
  if (!options || typeof options !== "object" || !options.adapter) throw new TypeError("observation adapter is required");
  const lastSequences = new Map<string, number>();
  let closed = false;
  let server: Server | undefined;
  const appendPath = options.appendPath ? path.resolve(options.appendPath) : null;
  const endpoint = options.socketPath ?? (process.platform === "win32" ? `\\\\.\\pipe\\reelier-observation-${process.pid}` : path.join(os.tmpdir(), `reelier-observation-${process.pid}.sock`));
  async function ingest(value: unknown): Promise<void> {
    if (closed) throw new Error("observation service is closed");
    const envelope = parseEnvelope(value);
    const previous = lastSequences.get(envelope.sessionId) ?? -1;
    if (envelope.sequence !== previous + 1) throw new TypeError("observation sequence must be contiguous per session");
    lastSequences.set(envelope.sessionId, envelope.sequence);
    if (appendPath) { await mkdir(path.dirname(appendPath), { recursive: true }); await appendFile(appendPath, `${JSON.stringify(envelope)}\n`, "utf8"); }
    if (envelope.event !== "action") return;
    for (const action of options.adapter.observe({ sessionId: envelope.sessionId, actions: [envelope.payload] })) options.onAction?.(action);
  }
  const start = async (): Promise<string> => {
    if (server) return endpoint;
    if (process.platform !== "win32") await rm(endpoint, { force: true });
    server = net.createServer(socket => {
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("data", chunk => {
        buffer += chunk;
        if (Buffer.byteLength(buffer, "utf8") > 1_048_576) { socket.destroy(); return; }
        for (;;) {
          const newline = buffer.indexOf("\n");
          if (newline < 0) break;
          const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try { void ingest(JSON.parse(line)).catch(() => socket.destroy()); } catch { socket.destroy(); }
        }
      });
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(endpoint, () => resolve()); });
    if (process.platform !== "win32") await chmod(endpoint, 0o600);
    return endpoint;
  };
  return Object.freeze({ endpoint, start, ingest, close: async () => { closed = true; if (server) await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; if (process.platform !== "win32") await rm(endpoint, { force: true }); } });
}

export function parseObservationEnvelope(value: unknown): ObservationEnvelopeV1 {
  return parseEnvelope(value);
}

function parseEnvelope(value: unknown): ObservationEnvelopeV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("observation envelope must be an object");
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw).sort().join("\0");
  if (keys !== "event\0payload\0sequence\0sessionId\0v" || raw.v !== "reelier.observation-envelope/v1" || !Number.isSafeInteger(raw.sequence) || (raw.sequence as number) < 0 || typeof raw.sessionId !== "string" || !raw.sessionId || !["action", "session-start", "session-end", "task-start", "task-end"].includes(String(raw.event))) throw new TypeError("invalid observation envelope");
  return Object.freeze({ v: raw.v, sequence: raw.sequence as number, sessionId: raw.sessionId, event: raw.event as ObservationEnvelopeV1["event"], payload: raw.payload });
}

export async function removeObservationLog(file: string): Promise<void> { await rm(path.resolve(file), { force: true }); }
