// `reelier serve` — the AGENT-NATIVE tool-server: exposes Reelier's own
// commands (scan, from-session, replay, push) as MCP tools, so any
// MCP-capable coding agent (Claude Code, Cursor, Windsurf, Codex, ...) can
// call Reelier mid-session instead of shelling out to the CLI.
//
// This is the OPPOSITE role from `reelier mcp` (src/recorder.ts's
// buildProxyServer, wired up in src/cli.ts's cmdMcp): that command is the
// RECORDER — it fronts *other* MCP servers (via --wrap) so their calls can
// be captured into a trace. `reelier serve` fronts *Reelier itself* — no
// --wrap, no downstream server to record; it just exposes Reelier's own
// functionality as callable tools. Don't confuse the two: `mcp` records,
// `serve` exposes.
//
// Every tool below is a thin wrapper over an existing module — no new
// engine logic:
//   reelier_scan          -> scan.ts's scanTranscripts
//   reelier_from_session   -> session.ts's compileSessionTranscript
//   reelier_replay         -> runner.ts's runSkill (always Level 0 — the
//                             LLM is never constructed or called from this
//                             surface; that mirrors `reelier run`'s default
//                             and keeps a tool-server call inert without a
//                             human explicitly opting into `--max-level`
//                             from the CLI)
//   reelier_push           -> push.ts's pushSkill
//
// Honesty rule (matching the CLI, and CLAUDE.md's "optimistic path" guard):
// a tool never fabricates a success. `reelier_scan`/`reelier_from_session`
// over a session with nothing replayable return an explicit empty/skip
// result — never a fake skill. `reelier_replay` returns the runner's real
// RunRecord (whatever it actually measured). `reelier_push` reports
// pushed / skipped-no-key / failed explicitly, never silently swallowing an
// error into a success.

import { readFile, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { scanTranscripts, type ScannedSession } from "./scan.js";
import { compileSessionTranscript, type SessionSkip } from "./session.js";
import type { OpenQuestion } from "./compile.js";
import { parseSkill } from "./skill.js";
import { runSkill, builtinTools, readRunRecords, type RunRecord } from "./runner.js";
import { diffRunRecords, type RunDiff } from "./diff.js";
import { connectDownstream, type DownstreamConnection } from "./mcp-client.js";
import { buildMcpTools } from "./mcp-tool.js";
import { pushSkill, type PushResult } from "./push.js";

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// reelier_scan
// ---------------------------------------------------------------------------

export interface ScanToolInput {
  /** Directory to scan for agent session transcripts. Defaults to ~/.claude/projects. */
  dir?: string;
}

export interface ScanToolResult {
  rootDir: string;
  totalSessions: number;
  replayableSessions: number;
  sessions: ScannedSession[];
}

/**
 * Discover replayable workflows in an agent's session history. Writes
 * nothing. A directory with zero sessions (or zero replayable ones) is
 * reported honestly as `totalSessions: 0` / `replayableSessions: 0` — never
 * upgraded into a fabricated result.
 */
export async function runScanTool(input: ScanToolInput): Promise<ScanToolResult> {
  const rootDir = input.dir ?? path.join(os.homedir(), ".claude", "projects");
  const sessions = await scanTranscripts(rootDir);
  return {
    rootDir,
    totalSessions: sessions.length,
    replayableSessions: sessions.filter((s) => s.replayableCount > 0).length,
    sessions,
  };
}

const scanToolInputSchema = {
  type: "object" as const,
  properties: {
    dir: { type: "string", description: "Directory to scan for agent session transcripts (default: ~/.claude/projects)." },
  },
};

// ---------------------------------------------------------------------------
// reelier_from_session
// ---------------------------------------------------------------------------

export interface FromSessionToolInput {
  /** Path to a session transcript (.jsonl) to compile. */
  transcriptPath: string;
  /** Skill name (also the default output filename stem). */
  name?: string;
  /** Output path for the compiled SKILL.md. Defaults to `<cwd>/<name>.skill.md`. */
  out?: string;
  /** Overwrite an existing file at the output path. */
  force?: boolean;
}

export interface FromSessionToolSuccess {
  ok: true;
  skillPath: string;
  steps: number;
  asserts: number;
  binds: number;
  servers: string[];
  replayableCount: number;
  skipped: SessionSkip[];
  openQuestions: OpenQuestion[];
}

export interface FromSessionToolFailure {
  ok: false;
  reason: string;
  skipped: SessionSkip[];
}

export type FromSessionToolResult = FromSessionToolSuccess | FromSessionToolFailure;

/**
 * Compile a SKILL.md from a session transcript. When the transcript has no
 * deterministically-replayable tool calls, returns `{ ok: false, reason,
 * skipped }` — never fabricates a skill out of non-replayable actions (file
 * edits, shell commands, subagent calls, ...). Refuses to silently
 * overwrite an existing file unless `force` is set (matches the CLI's
 * `from-session --force`).
 */
export async function runFromSessionTool(input: FromSessionToolInput): Promise<FromSessionToolResult> {
  const source = await readFile(input.transcriptPath, "utf8");
  const traceFileName = path.basename(input.transcriptPath);
  const name = input.name ?? traceFileName.replace(/\.jsonl$/i, "");

  const result = compileSessionTranscript(source, { name, traceFileName });

  if (!result.ok) {
    return { ok: false, reason: result.reason, skipped: result.skipped };
  }

  const outPath = input.out ?? path.join(process.cwd(), `${result.compileResult.name}.skill.md`);
  if (!input.force && (await fileExists(outPath))) {
    throw new Error(`Refusing to overwrite existing file ${outPath} — pass force:true to overwrite.`);
  }
  await writeFile(outPath, result.skillSource, "utf8");

  return {
    ok: true,
    skillPath: outPath,
    steps: result.compileResult.stats.steps,
    asserts: result.compileResult.stats.asserts,
    binds: result.compileResult.stats.binds,
    servers: result.servers,
    replayableCount: result.replayableCount,
    skipped: result.skipped,
    openQuestions: result.compileResult.openQuestions,
  };
}

const fromSessionToolInputSchema = {
  type: "object" as const,
  properties: {
    transcriptPath: { type: "string", description: "Path to a session transcript (.jsonl) to compile." },
    name: { type: "string", description: "Skill name (also the default output filename stem)." },
    out: { type: "string", description: "Output path for the compiled SKILL.md (default: <cwd>/<name>.skill.md)." },
    force: { type: "boolean", description: "Overwrite an existing file at the output path." },
  },
  required: ["transcriptPath"],
};

// ---------------------------------------------------------------------------
// reelier_replay
// ---------------------------------------------------------------------------

export interface ReplayToolInput {
  /** Path to a .skill.md file to run. */
  skillPath: string;
  vars?: Record<string, string>;
  /** Downstream MCP server command line(s) to connect for MCP-tool steps (same shape as the CLI's --wrap). */
  wrap?: string[];
  allowDestructive?: boolean;
  /** Permit `idempotent-write` steps to execute. Default false — replay is read-only. */
  allowWrites?: boolean;
  cwd?: string;
}

/**
 * Run a skill at Level 0 (deterministic replay only — the LLM is never
 * constructed or called from this surface) and return the real run record.
 * Never fabricates a passed/failed verdict: whatever runSkill actually
 * measured is what's returned, unmodified.
 */
export async function runReplayTool(input: ReplayToolInput): Promise<RunRecord> {
  const source = await readFile(input.skillPath, "utf8");
  const skill = parseSkill(source);

  const downstreams: DownstreamConnection[] = [];
  try {
    for (const spec of input.wrap ?? []) {
      downstreams.push(await connectDownstream(spec));
    }
    const tools = downstreams.length > 0 ? { ...builtinTools, ...buildMcpTools(downstreams) } : undefined;

    return await runSkill(skill, {
      vars: input.vars,
      allowDestructive: input.allowDestructive ?? false,
      allowWrites: input.allowWrites ?? false,
      tools,
      maxLevel: 0,
      cwd: input.cwd,
      skillPath: input.skillPath,
    });
  } finally {
    await Promise.all(downstreams.map((d) => d.close().catch(() => {})));
  }
}

const replayToolInputSchema = {
  type: "object" as const,
  properties: {
    skillPath: { type: "string", description: "Path to a .skill.md file to run." },
    vars: { type: "object", description: "Template variable bindings ({{name}} -> value) — e.g. a computed date window so a relative-date skill replays against the current period, not a frozen one." },
    wrap: {
      type: "array",
      items: { type: "string" },
      description: "Downstream MCP server command line(s) to connect for MCP-tool steps (same shape as the CLI's --wrap).",
    },
    allowDestructive: { type: "boolean", description: "Allow steps whose effect is 'destructive' to run." },
    allowWrites: { type: "boolean", description: "Allow 'idempotent-write' steps to execute. Default false — replay is READ-ONLY, so re-running never re-fires writes." },
    cwd: { type: "string", description: "Working directory the run record is written under (default: process cwd)." },
  },
  required: ["skillPath"],
};

// ---------------------------------------------------------------------------
// reelier_push
// ---------------------------------------------------------------------------

export interface PushToolInput {
  /** Path to a .skill.md file whose run records should be pushed. */
  skillPath: string;
  all?: boolean;
  dryRun?: boolean;
  withSkill?: boolean;
  cwd?: string;
}

export type PushToolResult =
  | { outcome: "ok"; result: PushResult }
  | { outcome: "skipped-no-key"; message: string }
  | { outcome: "failed"; message: string };

/**
 * Push run records (and, on first push, the skill file) for a skill to
 * Reelier Cloud. Reads REELIER_CLOUD_URL/REELIER_CLOUD_KEY from env, exactly
 * like `reelier push`. Missing config is reported as `skipped-no-key`, not
 * silently treated as a no-op success; any other failure (read error, no run
 * records) is reported as `failed` with the real error message.
 */
export async function runPushTool(input: PushToolInput): Promise<PushToolResult> {
  try {
    const result = await pushSkill(input.skillPath, {
      cwd: input.cwd,
      all: input.all,
      dryRun: input.dryRun,
      withSkill: input.withSkill,
    });
    return { outcome: "ok", result };
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes("REELIER_CLOUD_URL") || message.includes("REELIER_CLOUD_KEY")) {
      return { outcome: "skipped-no-key", message };
    }
    return { outcome: "failed", message };
  }
}

const pushToolInputSchema = {
  type: "object" as const,
  properties: {
    skillPath: { type: "string", description: "Path to a .skill.md file whose run records should be pushed." },
    all: { type: "boolean", description: "Ignore/reset the cursor — reconsider every record from the start." },
    dryRun: { type: "boolean", description: "Report what would push; make no network calls, touch no state." },
    withSkill: { type: "boolean", description: "Upload the skill file even if it was already uploaded before." },
    cwd: { type: "string", description: "Working directory to resolve .reelier/ state under (default: process cwd)." },
  },
  required: ["skillPath"],
};

// ---------------------------------------------------------------------------
// reelier_diff
// ---------------------------------------------------------------------------

export interface DiffToolInput {
  /** Skill name (the .reelier/runs/<skill>.jsonl stem) whose runs to compare. */
  skill: string;
  cwd?: string;
  /** 0-based index of the baseline run (default: second-to-last). */
  baselineIndex?: number;
  /** 0-based index of the candidate run (default: last). */
  candidateIndex?: number;
}

export type DiffToolResult = { ok: true; diff: RunDiff } | { ok: false; reason: string };

/**
 * Compare two runs of the same skill and report SAME vs DRIFTED. Defaults to
 * the last two runs in .reelier/runs/<skill>.jsonl. Honest when fewer than two
 * runs exist (never fabricates a "same" out of a single run).
 */
export async function runDiffTool(input: DiffToolInput): Promise<DiffToolResult> {
  const cwd = input.cwd ?? process.cwd();
  const file = path.join(cwd, ".reelier", "runs", `${input.skill}.jsonl`);
  let records: RunRecord[] = [];
  try {
    records = await readRunRecords(file);
  } catch {
    records = [];
  }
  if (records.length < 2) {
    return {
      ok: false,
      reason: `Need at least 2 runs of "${input.skill}" to diff — found ${records.length} at ${file}. Replay it again (reelier_replay / reelier run), then diff.`,
    };
  }
  const candIdx = input.candidateIndex ?? records.length - 1;
  const baseIdx = input.baselineIndex ?? records.length - 2;
  const baseline = records[baseIdx];
  const candidate = records[candIdx];
  if (!baseline || !candidate) {
    return { ok: false, reason: `Index out of range: have ${records.length} runs (valid 0..${records.length - 1}).` };
  }
  return { ok: true, diff: diffRunRecords(baseline, candidate) };
}

const diffToolInputSchema = {
  type: "object" as const,
  properties: {
    skill: { type: "string", description: "Skill name (the .reelier/runs/<skill>.jsonl stem) whose runs to compare." },
    cwd: { type: "string", description: "Working directory where .reelier/ lives (default: process cwd)." },
    baselineIndex: { type: "number", description: "0-based index of the baseline run (default: second-to-last)." },
    candidateIndex: { type: "number", description: "0-based index of the candidate run (default: the last run)." },
  },
  required: ["skill"],
};

// ---------------------------------------------------------------------------
// MCP server wiring
// ---------------------------------------------------------------------------

const TOOL_DESCRIPTIONS: Record<string, string> = {
  reelier_scan:
    "Discover replayable workflows in an agent's session history (defaults to ~/.claude/projects). Returns each " +
    "session's transcript path — feed one to reelier_from_session. Only MCP/HTTP tool-call sequences are replayable; " +
    "native file/shell actions are reported as skipped, never fabricated into a fake result. USE WHEN: deciding which " +
    "past work is worth compiling into a replayable skill.",
  reelier_from_session:
    "Compile a SKILL.md from a session transcript. USE WHEN: the work ALREADY happened (this session or by hand) — " +
    "recording can't be retroactive. NOT for work that hasn't happened yet (record that live via the reelier mcp " +
    "proxy). Get the transcriptPath from reelier_scan first. Returns the written skill's path, stats, and open " +
    "questions — or, honestly, that nothing in the transcript was replayable. If the workflow used a relative time " +
    "window (\"this week\"), bind it to a date variable (e.g. {{today-7d}}) so later replays pull the CURRENT window, " +
    "not a frozen one — the openQuestions output flags this.",
  reelier_replay:
    "Run a skill file at Level 0 (deterministic replay, zero LLM calls) and return the real run record: per-step " +
    "outcomes, timing, totals, and — when a step drifted — why (the failing assertion). Never fabricates a pass. " +
    "Reproduces the recorded TOOL CALLS (MCP/HTTP) only — no LLM reasoning or prose step re-runs. It does NOT " +
    "schedule itself: pair with cron/CI for recurring runs. Pass vars to fill {{templated}} inputs (e.g. a computed " +
    "date window) so a replay pulls current data. READ-ONLY by default: 'idempotent-write' steps are held back " +
    "(reported as a refused/failed step) unless you pass allowWrites — so replaying never re-fires a write.",
  reelier_push:
    "Push a skill's local run records (and, on first push, the skill file) to Reelier Cloud, where each receipt gets " +
    "a shareable permalink + verified-replay badge. Requires REELIER_CLOUD_URL/REELIER_CLOUD_KEY in env — reports " +
    "skipped-no-key honestly when they're absent. USE WHEN: a run's receipt should be durable or shareable.",
  reelier_diff:
    "Compare two runs of the same skill and report SAME or DRIFTED — the drift-detector for a recorded baseline " +
    "replayed on a schedule. Compares per-step outcomes, structure, and heal-level from .reelier/runs/<skill>.jsonl " +
    "(defaults to the last two runs); data values that legitimately change run-to-run are NOT drift. Drifted steps " +
    "carry why (the failing assertion). To check a MODEL upgrade: re-record the workflow with the new model, then " +
    "diff against your frozen baseline — replaying a pinned skill can't reveal model changes (replay never calls a " +
    "model). Honest when there aren't two runs yet.",
};

function textResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/**
 * Build (but do not connect) the Reelier tool-server. Pure/testable — the
 * caller wires up a transport (stdio for the real CLI, InMemory for tests),
 * same convention as recorder.ts's buildProxyServer.
 */
export function buildToolServer(): Server {
  const server = new Server({ name: "reelier-tools", version: "0.0.1" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: "reelier_scan", description: TOOL_DESCRIPTIONS.reelier_scan, inputSchema: scanToolInputSchema },
      {
        name: "reelier_from_session",
        description: TOOL_DESCRIPTIONS.reelier_from_session,
        inputSchema: fromSessionToolInputSchema,
      },
      { name: "reelier_replay", description: TOOL_DESCRIPTIONS.reelier_replay, inputSchema: replayToolInputSchema },
      { name: "reelier_push", description: TOOL_DESCRIPTIONS.reelier_push, inputSchema: pushToolInputSchema },
      { name: "reelier_diff", description: TOOL_DESCRIPTIONS.reelier_diff, inputSchema: diffToolInputSchema },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<Record<string, unknown>> => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case "reelier_scan":
          return textResult(await runScanTool(args as ScanToolInput));
        case "reelier_from_session":
          if (typeof args.transcriptPath !== "string" || !args.transcriptPath) {
            return errorResult(new Error("reelier_from_session requires a string 'transcriptPath' argument."));
          }
          return textResult(await runFromSessionTool(args as unknown as FromSessionToolInput));
        case "reelier_replay":
          if (typeof args.skillPath !== "string" || !args.skillPath) {
            return errorResult(new Error("reelier_replay requires a string 'skillPath' argument."));
          }
          return textResult(await runReplayTool(args as unknown as ReplayToolInput));
        case "reelier_push":
          if (typeof args.skillPath !== "string" || !args.skillPath) {
            return errorResult(new Error("reelier_push requires a string 'skillPath' argument."));
          }
          return textResult(await runPushTool(args as unknown as PushToolInput));
        case "reelier_diff":
          if (typeof args.skill !== "string" || !args.skill) {
            return errorResult(new Error("reelier_diff requires a string 'skill' argument."));
          }
          return textResult(await runDiffTool(args as unknown as DiffToolInput));
        default:
          return errorResult(new Error(`Unknown tool: ${name}`));
      }
    } catch (err) {
      return errorResult(err);
    }
  });

  return server;
}
