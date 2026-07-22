// Format detection + parsers for agent session transcripts OTHER than Claude
// Code's own JSONL (session.ts owns that one). Every parser here produces the
// exact same ParsedSessionTranscript shape session.ts already defines, so the
// shared pipeline (buildTraceFromSession -> compile -> renderSkillMd) runs
// completely unmodified for every source — these are thin format adapters,
// not parallel implementations.
//
// The honesty gate (non-negotiable, see CLAUDE.md / the from-session-adapters
// plan): a parser only exists here when the on-disk shape is grounded in
// primary-source evidence (the agent's own source code or official docs).
// Formats that would require reverse-engineering an undocumented/binary
// store (Cursor, Windsurf — both VSCode forks persisting chat state in a
// SQLite `state.vscdb`) get a detector + an honest "not yet supported"
// message, never a fabricated parser.

import os from "node:os";
import path from "node:path";
import { readdir } from "node:fs/promises";
import type { ParsedSessionTranscript, SessionPair, SessionToolCall, SessionToolResult } from "./session.js";

const MAX_LINE_CHARS = 5_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse up to `limit` JSON-object lines from the front of a transcript, tolerantly (used only for format sniffing — the real parsers below re-walk the whole file). */
function firstParsedLines(source: string, limit = 40): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const raw of source.split(/\r\n|\n/)) {
    const line = raw.trim();
    if (!line || line.length > MAX_LINE_CHARS) continue;
    try {
      const obj = JSON.parse(line);
      if (isRecord(obj)) out.push(obj);
    } catch {
      continue;
    }
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Format registry
// ---------------------------------------------------------------------------

/** Every format Reelier can actually parse into a trace (excludes the SQLite-based stub sources — those never produce a ParsedSessionTranscript). */
export type SessionFormatId = "claude-code" | "codex" | "openclaw";

export const SESSION_FORMAT_LABELS: Record<SessionFormatId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex CLI",
  openclaw: "OpenClaw",
};

/**
 * Sniff which known JSONL format a transcript is, from its content alone (not
 * the file path — `reelier from-session` must work on a copied/renamed
 * file). Returns undefined when nothing recognizable is found; callers fall
 * back to the Claude Code parser, which already degrades honestly (0
 * replayable calls) rather than guessing.
 *
 * Detection order is most-specific-first so a false match never shadows a
 * real one:
 *  1. Codex: RolloutLine's `{"type":"response_item","payload":{"type":"function_call"|...}}`
 *     — verified against codex-rs/protocol/src/protocol.rs (`RolloutItem`,
 *     `#[serde(tag = "type", content = "payload", rename_all = "snake_case")]`)
 *     and codex-rs/protocol/src/models.rs (`ResponseItem`, tag "type").
 *  2. OpenClaw: a `{"type":"session", ..., "cwd": ...}` header line (verified
 *     against openclaw/openclaw src/agents/sessions/session-manager-types.ts
 *     `SessionHeader`), or a `{"type":"message","message":{"role":...}}` entry
 *     whose message carries a `toolCall` content block or is a `toolResult`
 *     (same file, `SessionMessageEntry` / packages/llm-core/src/types.ts
 *     `ToolCall`/`ToolResultMessage`).
 *  3. Claude Code: `{"type":"assistant"|"user","message":{"content":[...]}}`
 *     — session.ts's own documented shape.
 */
export function detectSessionFormat(source: string): SessionFormatId | undefined {
  const lines = firstParsedLines(source);
  for (const obj of lines) {
    if (obj.type === "response_item" && isRecord(obj.payload) && typeof obj.payload.type === "string") {
      return "codex";
    }
    if (obj.type === "session" && "cwd" in obj) {
      return "openclaw";
    }
    if (obj.type === "message" && isRecord(obj.message) && typeof obj.message.role === "string") {
      const role = obj.message.role;
      const content = obj.message.content;
      if (role === "toolResult") return "openclaw";
      if (role === "assistant" && Array.isArray(content) && content.some((b) => isRecord(b) && b.type === "toolCall")) {
        return "openclaw";
      }
    }
  }
  for (const obj of lines) {
    if ((obj.type === "assistant" || obj.type === "user") && isRecord(obj.message) && Array.isArray(obj.message.content)) {
      return "claude-code";
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Codex CLI — ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl
//
// Evidence:
//  - Directory + filename: codex-rs/rollout/src/lib.rs (`SESSIONS_SUBDIR =
//    "sessions"`), codex-rs/rollout/src/list.rs (`rollout_date_parts` strips
//    a `rollout-` prefix and reads YYYY-MM-DD out of the filename;
//    `get_threads` joins `codex_home.join(SESSIONS_SUBDIR)` and lists with
//    `ThreadListLayout::NestedByDate`), and codex-rs/rollout/src/recorder.rs's
//    doc comment showing a real example path
//    `~/.codex/sessions/rollout-2025-05-07T17-24-21-<uuid>.jsonl`.
//  - Line shape: codex-rs/protocol/src/protocol.rs `RolloutLine` (`{timestamp,
//    ordinal?, ...RolloutItem}`, `RolloutItem` serde-tagged
//    `{"type":"response_item","payload": ResponseItem}`.
//  - Tool call: codex-rs/protocol/src/models.rs `ResponseItem::FunctionCall`
//    (`{"type":"function_call","name","arguments" (JSON-encoded string,
//    per the field's own doc comment),"call_id"}`).
//  - Tool result: `ResponseItem::FunctionCallOutput`
//    (`{"type":"function_call_output","call_id","output"}`) where `output`
//    (`FunctionCallOutputPayload`) has a hand-written `Serialize` impl that
//    emits EITHER a plain string OR the raw `FunctionCallOutputContentItem[]`
//    array directly (no wrapper object, no error flag on the wire — `success`
//    is never serialized). Content items use `{"type":"input_text","text"}`
//    (also models.rs).
//  - MCP tool naming: codex-rs/core/src/tools/handlers/mcp.rs uses the same
//    `mcp__<server>__<tool>` convention as Claude Code
//    (`MCP_TOOL_NAME_DELIMITER = "__"`), so `session.ts`'s existing
//    `classifyToolUse`/`splitMcpToolName` need no changes to recognize it.
// ---------------------------------------------------------------------------

/** Codex's `function_call_output.output` -> the shape session.ts's toMcpCallResultBody already knows how to read (a plain string, or an array of `{type:"text",text}` blocks) — mapping `input_text` -> `text` here rather than teaching the shared reducer a second content-item vocabulary. */
function codexOutputToContent(output: unknown): unknown {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const blocks: Array<{ type: "text"; text: string }> = [];
    for (const item of output) {
      if (isRecord(item) && item.type === "input_text" && typeof item.text === "string") {
        blocks.push({ type: "text", text: item.text });
      }
    }
    return blocks;
  }
  return output;
}

export function parseCodexTranscript(source: string): ParsedSessionTranscript {
  const lines = source.split(/\r\n|\n/);
  const calls: SessionToolCall[] = [];
  const resultsById = new Map<string, SessionToolResult>();
  let malformedLines = 0;
  let totalLines = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    totalLines++;
    if (line.length > MAX_LINE_CHARS) {
      malformedLines++;
      continue;
    }
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      malformedLines++;
      continue;
    }
    if (!isRecord(obj) || obj.type !== "response_item" || !isRecord(obj.payload)) continue;
    const payload = obj.payload;

    if (payload.type === "function_call") {
      const name = payload.name;
      const callId = payload.call_id;
      if (typeof name !== "string" || typeof callId !== "string") continue;
      let input: unknown = payload.arguments;
      if (typeof input === "string") {
        try {
          input = JSON.parse(input);
        } catch {
          // Arguments didn't decode as JSON — keep the raw string rather than guessing.
        }
      }
      calls.push({ id: callId, name, input });
    } else if (payload.type === "function_call_output") {
      const callId = payload.call_id;
      if (typeof callId !== "string") continue;
      // No error flag on the wire (see the doc comment above) — assume ok;
      // an actual failure still shows up as error text inside the content.
      resultsById.set(callId, { toolUseId: callId, ok: true, content: codexOutputToContent(payload.output) });
    }
  }

  const pairs: SessionPair[] = calls.map((call, order) => ({ order, call, result: resultsById.get(call.id) }));
  return { pairs, malformedLines, totalLines };
}

// ---------------------------------------------------------------------------
// OpenClaw — ~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl
//
// Evidence:
//  - State dir: openclaw/openclaw src/config/paths.ts (`NEW_STATE_DIRNAME =
//    ".openclaw"`, `newStateDir` joins it under the user's home dir).
//  - Sessions dir: src/config/sessions/paths.ts `resolveAgentSessionsDir`
//    (`path.join(root, "agents", id, "sessions")`) and
//    `resolveSessionTranscriptPathInDir` (`${sessionId}.jsonl`).
//  - Line shapes: src/agents/sessions/session-manager-types.ts —
//    `SessionHeader` (`{"type":"session","id","timestamp","cwd",...}`, first
//    line of a file) and `SessionMessageEntry`
//    (`{"type":"message","id","parentId","timestamp","message": AgentMessage}`).
//  - Tool call / result: packages/llm-core/src/types.ts — an assistant
//    `AssistantMessage.content` array item can be a `ToolCall`
//    (`{"type":"toolCall","id","name","arguments"}`, arguments already a
//    parsed object, NOT a JSON string); the paired turn is a top-level
//    `ToolResultMessage` (`{"role":"toolResult","toolCallId","toolName",
//    "content":[{"type":"text","text"}|{"type":"image",...}],"isError"}`) —
//    note this is the SAME `{type:"text",text}` content-item shape Claude
//    Code uses, so no remapping is needed before handing it to
//    session.ts's toMcpCallResultBody.
//  - MCP tool naming: `mcp__` prefix confirmed in src/agents/cli-runner/
//    tool-policy.ts and execute.ts — same `mcp__<server>__<tool>` convention.
// ---------------------------------------------------------------------------

export function parseOpenClawTranscript(source: string): ParsedSessionTranscript {
  const lines = source.split(/\r\n|\n/);
  const calls: SessionToolCall[] = [];
  const resultsById = new Map<string, SessionToolResult>();
  let malformedLines = 0;
  let totalLines = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    totalLines++;
    if (line.length > MAX_LINE_CHARS) {
      malformedLines++;
      continue;
    }
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      malformedLines++;
      continue;
    }
    if (!isRecord(obj) || obj.type !== "message" || !isRecord(obj.message)) continue;
    const message = obj.message;
    const role = message.role;

    if (role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isRecord(block) || block.type !== "toolCall") continue;
        if (typeof block.id !== "string" || typeof block.name !== "string") continue;
        calls.push({ id: block.id, name: block.name, input: block.arguments });
      }
    } else if (role === "toolResult") {
      const toolCallId = message.toolCallId;
      if (typeof toolCallId !== "string") continue;
      resultsById.set(toolCallId, {
        toolUseId: toolCallId,
        ok: message.isError !== true,
        content: message.content,
      });
    }
  }

  const pairs: SessionPair[] = calls.map((call, order) => ({ order, call, result: resultsById.get(call.id) }));
  return { pairs, malformedLines, totalLines };
}

// ---------------------------------------------------------------------------
// Cursor / Windsurf — STUB, deliberately not parsed.
//
// Both are VSCode forks. Chat/composer history persists in a SQLite
// `state.vscdb` (VSCode's own global/workspace key-value store), which
// neither project documents as a public schema:
//  - Location: `<appdata>/<Product>/User/globalStorage/state.vscdb` (and a
//    per-workspace copy under `.../User/workspaceStorage/<hash>/state.vscdb`)
//    on all three OSes, where `<Product>` is `Cursor` or `Windsurf`.
//  - Cursor's DB stores rows in a `cursorDiskKV` table keyed
//    `composerData:<composerId>` (session metadata) and
//    `bubbleId:<composerId>:<bubbleId>` (individual messages) — reverse-
//    engineered by third parties (e.g. the cursor-history / cursor-chronicle
//    OSS projects), never an officially published schema.
//  - Windsurf centralizes chat data in the SAME global `state.vscdb` under
//    keys like `aiChat.chatdata` / `cascade.chatdata` — also undocumented,
//    also third-party reverse-engineered.
// Per the honesty gate: no parser is built against undocumented, unstable
// SQLite internals. This module only detects the store's presence and
// reports it — never fabricates a parse.
// ---------------------------------------------------------------------------

export type StubAgentId = "cursor" | "windsurf";

export interface StubAgentSource {
  id: StubAgentId;
  label: string;
  /** `User/globalStorage` dir — home of the single global `state.vscdb`; per-workspace copies live in the sibling `User/workspaceStorage/<hash>/` dirs, also probed. */
  globalStorageDir: string;
  workspaceStorageDir: string;
  findings: string;
}

/**
 * VSCode-fork user-data root for a given product, per OS. Verified locations:
 * Windows `%APPDATA%\<Product>`, macOS `~/Library/Application Support/<Product>`,
 * Linux `~/.config/<Product>`.
 *
 * Uses `path.win32`/`path.posix` explicitly (not the ambient `path` module,
 * which is locked to the HOST os) so the target `platform` argument — not
 * whatever OS Reelier happens to be running on — decides the separator.
 * `probeStubSource` still only ever gets called with the real host platform
 * in production; the explicit split just makes that decision testable.
 */
function vscodeForkUserDataDir(product: "Cursor" | "Windsurf", platform: NodeJS.Platform, homedir: string, env: NodeJS.ProcessEnv): string {
  const p = platform === "win32" ? path.win32 : path.posix;
  if (platform === "win32") {
    const appData = env.APPDATA ?? p.join(homedir, "AppData", "Roaming");
    return p.join(appData, product);
  }
  if (platform === "darwin") {
    return p.join(homedir, "Library", "Application Support", product);
  }
  return p.join(homedir, ".config", product);
}

export function stubAgentSources(
  homedir: string = os.homedir(),
  platform: NodeJS.Platform = os.platform(),
  env: NodeJS.ProcessEnv = process.env
): StubAgentSource[] {
  const p = platform === "win32" ? path.win32 : path.posix;
  const cursorRoot = vscodeForkUserDataDir("Cursor", platform, homedir, env);
  const windsurfRoot = vscodeForkUserDataDir("Windsurf", platform, homedir, env);
  return [
    {
      id: "cursor",
      label: "Cursor",
      globalStorageDir: p.join(cursorRoot, "User", "globalStorage"),
      workspaceStorageDir: p.join(cursorRoot, "User", "workspaceStorage"),
      findings:
        "Cursor stores chat/composer history in a SQLite state.vscdb (cursorDiskKV table, composerData:<id> / " +
        "bubbleId:<composerId>:<bubbleId> keys) that Cursor does not publish a schema for — format not yet supported.",
    },
    {
      id: "windsurf",
      label: "Windsurf",
      globalStorageDir: p.join(windsurfRoot, "User", "globalStorage"),
      workspaceStorageDir: p.join(windsurfRoot, "User", "workspaceStorage"),
      findings:
        "Windsurf stores chat/Cascade history in the same kind of SQLite state.vscdb (undocumented keys such as " +
        "aiChat.chatdata / cascade.chatdata) — format not yet supported.",
    },
  ];
}

/** Depth-capped, best-effort count of `state.vscdb` files under a stub source's known dirs. Never throws — a missing dir (product not installed) counts as 0, same honest-degradation rule as findTranscriptFiles in scan.ts. */
export async function probeStubSource(src: StubAgentSource): Promise<{ found: number; paths: string[] }> {
  const paths: string[] = [];

  async function scanForVscdb(dir: string, depth: number): Promise<void> {
    if (depth > 3) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanForVscdb(full, depth + 1);
      } else if (entry.isFile() && entry.name === "state.vscdb") {
        paths.push(full);
      }
    }
  }

  await scanForVscdb(src.globalStorageDir, 0);
  await scanForVscdb(src.workspaceStorageDir, 0);
  return { found: paths.length, paths };
}
