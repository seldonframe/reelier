// Builtin tool registry. A plain map so MCP-backed tools can be registered
// alongside these later without changing the runner.

import type { Observation } from "./assert.js";
import type { Effect } from "./skill.js";

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

export const builtinTools: Record<string, Tool> = {
  "http.get": {
    effect: "read",
    async run(args): Promise<Observation> {
      const url = requireString(args, "url");
      const res = await fetchWithTimeout(url, { method: "GET" });
      const body = await res.text();
      return { status: res.status, headers: headersToRecord(res.headers), body };
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
      return { status: res.status, headers: headersToRecord(res.headers), body: text };
    },
  },
};
