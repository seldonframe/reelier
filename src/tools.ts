// Builtin tool registry. A plain map so MCP-backed tools can be registered
// alongside these later without changing the runner.

import type { Observation, ObservationRef } from "./assert.js";
import type { Effect } from "./skill.js";
import { redact } from "./redact.js";

export interface ToolContext {
  /** Whether --yes was passed on the CLI (permits destructive effects to run). */
  allowDestructive: boolean;
  /**
   * Whether `idempotent-write` steps may execute. Optional; absent/false means
   * replay is READ-ONLY, so re-running a skill never re-fires its writes.
   * `reelier run --allow-writes` (and `--yes`, which implies it) opts in.
   * `read` steps are never gated.
   */
  allowWrites?: boolean;
}

export interface Tool {
  /** Intrinsic effect class of this tool, used when a step doesn't override it. */
  effect: Effect;
  /**
   * The downstream MCP server that advertises this tool (DownstreamConnection.name,
   * src/mcp-tool.ts's mcpTool), used to compute the write receipt's idempotency
   * key (src/approval.ts's computeIdempotencyKey). Absent for builtin http.*
   * tools, which have no server concept.
   */
  server?: string;
  run(args: unknown, ctx: ToolContext): Promise<Observation>;
}

const TIMEOUT_MS = 15_000;

function requireString(args: unknown, key: string): string {
  if (typeof args !== "object" || args === null) {
    throw new Error(`Tool args must be an object, got: ${JSON.stringify(args)}`);
  }
  const val = (args as Record<string, unknown>)[key];
  if (typeof val !== "string") {
    throw new Error(`Tool args missing required string field '${key}': ${JSON.stringify(args)}`);
  }
  return val;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

// Provider-issued request-id headers (trust-ladder spec §3) — an ALLOWLIST,
// never a heuristic scrape. The Fetch API's Headers object always exposes
// keys lowercased regardless of how the server sent them, so headersToRecord
// above already yields lowercase keys matching this list exactly.
const REQUEST_ID_HEADER_ALLOWLIST = [
  "request-id",
  "x-request-id",
  "x-amzn-requestid",
  "x-amz-request-id",
  "x-goog-request-id",
  "stripe-request-id",
  "cf-ray",
] as const;

/**
 * Capture allowlisted response headers into `Observation.refs` — omitted
 * entirely (never an empty array) when none were present. Values pass
 * through `redact()` like everything else that ends up in a receipt
 * (trust-ladder spec §3's "redaction wins" rule): a request-id happening to
 * equal a masked secret renders as redacted, not leaked.
 */
function extractHeaderRefs(headers: Record<string, string>): ObservationRef[] | undefined {
  const refs: ObservationRef[] = [];
  for (const key of REQUEST_ID_HEADER_ALLOWLIST) {
    const value = headers[key];
    if (typeof value === "string" && value.length > 0) {
      refs.push({ source: "header", key, value: redact(value) as string });
    }
  }
  return refs.length > 0 ? refs : undefined;
}

export const builtinTools: Record<string, Tool> = {
  "http.get": {
    effect: "read",
    async run(args): Promise<Observation> {
      const url = requireString(args, "url");
      const res = await fetchWithTimeout(url, { method: "GET" });
      const body = await res.text();
      const headers = headersToRecord(res.headers);
      const refs = extractHeaderRefs(headers);
      return { status: res.status, headers, body, ...(refs ? { refs } : {}) };
    },
  },
  "http.post": {
    effect: "idempotent-write",
    async run(args): Promise<Observation> {
      if (typeof args !== "object" || args === null) {
        throw new Error(`http.post args must be an object, got: ${JSON.stringify(args)}`);
      }
      const record = args as Record<string, unknown>;
      const url = requireString(args, "url");
      const headers = (record.headers as Record<string, string> | undefined) ?? {};
      const body = record.body;
      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers,
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      const text = await res.text();
      const responseHeaders = headersToRecord(res.headers);
      const refs = extractHeaderRefs(responseHeaders);
      return { status: res.status, headers: responseHeaders, body: text, ...(refs ? { refs } : {}) };
    },
  },
};
