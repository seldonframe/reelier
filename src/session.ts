// `reelier from-session` / `reelier scan` support: turn a Claude Code (or
// compatible) agent session transcript — the standard Anthropic message
// JSONL Claude Code already writes at
// ~/.claude/projects/<project>/<uuid>.jsonl — into a Reelier trace and,
// through the EXISTING compiler (src/compile.ts), a SKILL.md.
//
// The honesty rule (non-negotiable): Reelier can only deterministically
// replay its own builtins (http.get/http.post) and MCP-server tool calls
// (mcp__<server>__<tool>). It can NOT replay Claude Code's native tools
// (Bash, Read, Edit, Write, Grep, Glob, Task, WebFetch, ...) — those are
// non-deterministic or file-mutating. This module filters to the
// replayable subset and reports exactly what it skipped and why; it never
// compiles a "skill" out of non-replayable actions, and never fabricates a
// skill when nothing replayable was found.

import type { TraceRecord } from "./recorder.js";
import { compile, renderSkillMd, classifyEffect, type CompileResult } from "./compile.js";
import { parseSkill } from "./skill.js";
import {
  detectSessionFormat,
  parseCodexTranscript,
  parseOpenClawTranscript,
  type SessionFormatId,
} from "./session-formats.js";

export type { SessionFormatId } from "./session-formats.js";
export { detectSessionFormat, SESSION_FORMAT_LABELS } from "./session-formats.js";

// ---------------------------------------------------------------------------
// Parsing — tolerant of the real file format. Verified against actual
// ~/.claude/projects/*/*.jsonl transcripts, not an assumed schema:
//  - Most lines are `{"type": "assistant"|"user"|..., "message": {"content": [...]}}`
//    plus a bunch of other line `type`s (queue-operation, attachment/hook
//    output, summary, ...) that carry no `message.content` array — skipped.
//  - An assistant message's content array carries `{type:"tool_use", id, name, input}` blocks.
//  - The FOLLOWING user message's content array carries the matching
//    `{type:"tool_result", tool_use_id, content, is_error?}` block — `content`
//    is sometimes a plain string, sometimes an array of `{type:"text", text}`
//    blocks (confirmed both shapes occur in real transcripts).
//  - `is_error` (snake_case) marks a failed call; absent/false means ok.
// ---------------------------------------------------------------------------

/** Guard against a single pathological line (e.g. a huge embedded file read) blowing up JSON.parse/memory. */
const MAX_LINE_CHARS = 5_000_000;

export interface SessionToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface SessionToolResult {
  toolUseId: string;
  ok: boolean;
  /** Raw `tool_result.content` — string or array of content blocks, exactly as the transcript stored it. */
  content: unknown;
}

export interface SessionPair {
  /** First-seen order among tool_use blocks in the transcript (0-based). */
  order: number;
  call: SessionToolCall;
  result: SessionToolResult | undefined;
}

export interface ParsedSessionTranscript {
  pairs: SessionPair[];
  /** Lines that were skipped because they didn't parse as JSON, or exceeded MAX_LINE_CHARS. */
  malformedLines: number;
  /** Total non-blank lines seen, for reporting. */
  totalLines: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface RawToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

function asToolUseBlock(block: unknown): RawToolUseBlock | undefined {
  if (!isRecord(block) || block.type !== "tool_use") return undefined;
  if (typeof block.id !== "string" || typeof block.name !== "string") return undefined;
  return { type: "tool_use", id: block.id, name: block.name, input: block.input };
}

interface RawToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
}

function asToolResultBlock(block: unknown): RawToolResultBlock | undefined {
  if (!isRecord(block) || block.type !== "tool_result") return undefined;
  if (typeof block.tool_use_id !== "string") return undefined;
  return { type: "tool_result", tool_use_id: block.tool_use_id, content: block.content, is_error: block.is_error === true };
}

/**
 * Parse a transcript with a specific known format, or auto-detect it from
 * content (session-formats.ts's detectSessionFormat) and fall back to the
 * Claude Code parser when nothing else matches — this is the SAME fallback
 * every from-session call has always had (an unrecognized/malformed
 * transcript parses to 0 replayable calls rather than erroring), now just
 * explicit about which parser ran.
 */
export function parseSessionTranscriptForFormat(source: string, format?: SessionFormatId): ParsedSessionTranscript {
  const resolved = format ?? detectSessionFormat(source) ?? "claude-code";
  if (resolved === "codex") return parseCodexTranscript(source);
  if (resolved === "openclaw") return parseOpenClawTranscript(source);
  return parseSessionTranscript(source);
}

/** Parse a session transcript's raw JSONL text into ordered tool_use/tool_result pairs. Never throws on a malformed line — counts and skips it instead. */
export function parseSessionTranscript(source: string): ParsedSessionTranscript {
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
    if (!isRecord(obj)) {
      malformedLines++;
      continue;
    }
    const message = obj.message;
    if (!isRecord(message) || !Array.isArray(message.content)) continue;

    if (obj.type === "assistant") {
      for (const block of message.content) {
        const tu = asToolUseBlock(block);
        if (tu) calls.push({ id: tu.id, name: tu.name, input: tu.input });
      }
    } else if (obj.type === "user") {
      for (const block of message.content) {
        const tr = asToolResultBlock(block);
        if (tr) resultsById.set(tr.tool_use_id, { toolUseId: tr.tool_use_id, ok: tr.is_error !== true, content: tr.content });
      }
    }
  }

  const pairs: SessionPair[] = calls.map((call, order) => ({ order, call, result: resultsById.get(call.id) }));
  return { pairs, malformedLines, totalLines };
}

// ---------------------------------------------------------------------------
// Replayability classification — the honesty gate. Default-deny: only
// Reelier's own builtins and mcp__<server>__<tool> calls are replayable;
// every Claude Code native tool (Bash, Read, Edit, Write, Grep, Glob, Task,
// WebFetch, ToolSearch, ...) is rejected by NOT matching either allowed
// shape, not by an incomplete blacklist.
// ---------------------------------------------------------------------------

export interface ReplayableClassification {
  replayable: true;
  /** Tool name to record in the compiled trace — the bare MCP tool name (server prefix stripped) or the builtin name, matching what buildMcpTools() exposes it as (mcp-tool.ts) so the compiled skill actually replays against a --wrap'd downstream. */
  traceTool: string;
  server?: string;
}

export interface NonReplayableClassification {
  replayable: false;
  reason: string;
}

export type ToolReplayClassification = ReplayableClassification | NonReplayableClassification;

const BUILTIN_TOOL_NAMES = new Set(["http.get", "http.post"]);

/** `mcp__<server>__<tool>` -> {server, tool}. Splits on literal "__" (not single "_"), which is what Claude Code's naming scheme guarantees never appears inside a bare server/tool name pair boundary — verified against real transcripts (server names use hyphens or single underscores, e.g. "claude-in-chrome", "ccd_session_mgmt", never "__"). */
function splitMcpToolName(name: string): { server: string; tool: string } | undefined {
  const parts = name.split("__");
  if (parts.length < 3 || parts[0] !== "mcp") return undefined;
  const server = parts[1];
  const tool = parts.slice(2).join("__");
  if (!server || !tool) return undefined;
  return { server, tool };
}

export function classifyToolUse(name: string): ToolReplayClassification {
  if (BUILTIN_TOOL_NAMES.has(name)) {
    return { replayable: true, traceTool: name };
  }
  if (name.startsWith("mcp__")) {
    const split = splitMcpToolName(name);
    if (!split) {
      return { replayable: false, reason: `malformed MCP tool name '${name}' — could not extract a server/tool pair, skipping rather than guessing` };
    }
    return { replayable: true, traceTool: split.tool, server: split.server };
  }
  return {
    replayable: false,
    reason:
      `'${name}' is a Claude Code native tool (file/shell/search/subagent action), not one of Reelier's own ` +
      `builtins (http.get/http.post) or an MCP server tool call — it can't be deterministically replayed, so it's never compiled into a skill.`,
  };
}

// ---------------------------------------------------------------------------
// Trace construction — reuses the exact TraceRecord/McpCallResult shapes the
// live recorder (src/recorder.ts) and compiler (src/compile.ts) already
// agree on, so the EXISTING compiler runs unmodified.
// ---------------------------------------------------------------------------

export interface SessionSkip {
  toolUseId: string;
  name: string;
  reason: string;
}

/** Per-replayable-call effect classification of a session's trace (see compile.ts's classifyEffect — reused, not re-derived). Unknown-verb calls are counted under `destructive` (the classifier's safe default), never optimistically read. */
export interface SessionEffectBreakdown {
  read: number;
  "idempotent-write": number;
  destructive: number;
}

function emptyEffectBreakdown(): SessionEffectBreakdown {
  return { read: 0, "idempotent-write": 0, destructive: 0 };
}

export interface SessionTraceBuild {
  records: TraceRecord[];
  replayableCount: number;
  skipped: SessionSkip[];
  servers: string[];
  effects: SessionEffectBreakdown;
  /** Replayable calls whose classification fell through to unknown→destructive (no verb recognized) — a subset of `effects.destructive`. */
  unknownCount: number;
  /** Unique tool names behind `unknownCount`, for the scan KPI's "top blockers" line. */
  unknownTools: string[];
}

/** Reshape a transcript's `tool_result.content` into the McpCallResult shape compile.ts expects in a "result" record's body (mcp-tool.ts's mcpResultToObservation reads `.content` items of `type: "text"`). */
function toMcpCallResultBody(content: unknown, ok: boolean): unknown {
  const blocks: Array<{ type: "text"; text: string }> = [];
  if (typeof content === "string") {
    blocks.push({ type: "text", text: content });
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
        blocks.push({ type: "text", text: item.text });
      }
    }
  }
  return { content: blocks, isError: !ok };
}

/**
 * Filter a parsed transcript to its replayable subset and build the
 * TraceRecord[] the existing compiler consumes. Every skipped call
 * (non-replayable tool, or a replayable tool whose result never showed up in
 * the transcript — recording cut off mid-call) is reported, never silently
 * dropped.
 */
export function buildTraceFromSession(parsed: ParsedSessionTranscript, name: string): SessionTraceBuild {
  const skipped: SessionSkip[] = [];
  const servers = new Set<string>();
  const bodyRecords: TraceRecord[] = [];
  const effects = emptyEffectBreakdown();
  const unknownTools = new Set<string>();
  let unknownCount = 0;
  let seq = 1;
  let i = 0;

  for (const pair of parsed.pairs) {
    const cls = classifyToolUse(pair.call.name);
    if (!cls.replayable) {
      skipped.push({ toolUseId: pair.call.id, name: pair.call.name, reason: cls.reason });
      continue;
    }
    if (!pair.result) {
      skipped.push({
        toolUseId: pair.call.id,
        name: pair.call.name,
        reason: "no matching tool_result found in the transcript (recording may have been interrupted, or this line was truncated) — skipped rather than guessed at the outcome",
      });
      continue;
    }

    const classified = classifyEffect(cls.traceTool);
    effects[classified.effect]++;
    if (classified.unknown) {
      unknownCount++;
      unknownTools.add(cls.traceTool);
    }

    if (cls.server) {
      servers.add(cls.server);
      bodyRecords.push({
        t: "note",
        seq: seq++,
        ts: new Date().toISOString(),
        text: `From your session — mcp__${cls.server}__${cls.traceTool}`,
      });
    }

    const idx = i++;
    bodyRecords.push({ t: "call", seq: seq++, i: idx, ts: new Date().toISOString(), tool: cls.traceTool, args: pair.call.input });
    bodyRecords.push({
      t: "result",
      seq: seq++,
      i: idx,
      ok: pair.result.ok,
      ms: 0,
      body: toMcpCallResultBody(pair.result.content, pair.result.ok),
    });
  }

  const metaRecord: TraceRecord = { t: "meta", seq: 0, name, startedAt: new Date().toISOString(), wrapped: [...servers] };
  return {
    records: [metaRecord, ...bodyRecords],
    replayableCount: i,
    skipped,
    servers: [...servers],
    effects,
    unknownCount,
    unknownTools: [...unknownTools],
  };
}

// ---------------------------------------------------------------------------
// Top-level: parse + filter + compile + render, in one call. Mirrors
// init.ts's compileDemoTrace (round-trips the render through parseSkill
// before handing it back) but adds the "nothing replayable" honest failure
// mode that a live recording (which only ever logs replayable calls in the
// first place) never needs.
// ---------------------------------------------------------------------------

export interface FromSessionOptions {
  /** Skill name (also the default output filename stem). */
  name: string;
  /** Basename of the transcript file, embedded in the skill's description line. */
  traceFileName: string;
  /** Force a specific source format instead of auto-detecting from content (the CLI's `--agent` override). */
  format?: SessionFormatId;
}

export interface FromSessionSuccess {
  ok: true;
  skillSource: string;
  compileResult: CompileResult;
  replayableCount: number;
  skipped: SessionSkip[];
  servers: string[];
}

export interface FromSessionNothingReplayable {
  ok: false;
  reason: string;
  skipped: SessionSkip[];
}

export function compileSessionTranscript(source: string, opts: FromSessionOptions): FromSessionSuccess | FromSessionNothingReplayable {
  const parsed = parseSessionTranscriptForFormat(source, opts.format);
  const built = buildTraceFromSession(parsed, opts.name);

  if (built.replayableCount === 0) {
    return {
      ok: false,
      reason:
        "no deterministically-replayable tool calls found in this session — Reelier replays API/MCP tool workflows, not file edits or shell commands.",
      skipped: built.skipped,
    };
  }

  const compileResult = compile(built.records);
  const skillSource = renderSkillMd(compileResult, opts.traceFileName);
  // Sanity check, same rule as cmdCompile/compileDemoTrace: the compiler must
  // always produce a skill its own parser accepts before it's handed back.
  parseSkill(skillSource);

  return {
    ok: true,
    skillSource,
    compileResult,
    replayableCount: built.replayableCount,
    skipped: built.skipped,
    servers: built.servers,
  };
}

// ---------------------------------------------------------------------------
// Discovery (reelier scan) — a cheap per-transcript summary, without writing
// anything. Reuses parseSessionTranscript + the same classification so a
// session's "replayable" verdict in `scan` and in `from-session` can never
// disagree.
// ---------------------------------------------------------------------------

export interface SessionSummary {
  path: string;
  totalToolCalls: number;
  replayableCount: number;
  skippedCount: number;
  servers: string[];
  malformedLines: number;
  /** Effect breakdown of the REPLAYABLE calls only (classifyEffect, reused from compile.ts) — replayability tells you Reelier CAN re-issue a call, this tells you whether doing so is safe to repeat. */
  effects: SessionEffectBreakdown;
  /** true iff replayableCount > 0 and every replayable call classified as `read` — the ideal replay target. False (not "unknown") whenever there are zero replayable calls, since there's nothing to call read-only. */
  readOnly: boolean;
  /** Replayable calls that classified unknown→destructive (subset of `effects.destructive`) — the self-improvement signal behind scan's "blocked ONLY by unknown-verb tools" line. */
  unknownCount: number;
  /** Unique tool names behind `unknownCount`. */
  unknownTools: string[];
}

export function summarizeSession(source: string, path: string, format?: SessionFormatId): SessionSummary {
  const parsed = parseSessionTranscriptForFormat(source, format);
  const built = buildTraceFromSession(parsed, "scan-summary");
  return {
    path,
    totalToolCalls: parsed.pairs.length,
    replayableCount: built.replayableCount,
    skippedCount: built.skipped.length,
    servers: built.servers,
    malformedLines: parsed.malformedLines,
    effects: built.effects,
    readOnly: built.replayableCount > 0 && built.effects["idempotent-write"] === 0 && built.effects.destructive === 0,
    unknownCount: built.unknownCount,
    unknownTools: built.unknownTools,
  };
}
