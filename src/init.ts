// `reelier init` — the 60-second first-run experience: guided
// detect-config -> record -> compile -> replay -> receipt loop. The pure,
// testable pieces (config detection, .mcp.json merge, trace->skill
// compile, receipt formatting) live here; src/cli.ts owns the interactive
// readline orchestration and process-level wiring only.
//
// Honesty rules (non-negotiable, per the landing hero's "first receipt in
// 60 seconds" claim): never report a step as having succeeded when it
// didn't, and every number in the closing receipt comes from the actual
// RunRecord this process just produced — nothing here is estimated.

import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Recorder } from "./recorder.js";
import { builtinTools, type Tool, type ToolContext } from "./tools.js";
import { compile, renderSkillMd, type CompileResult } from "./compile.js";
import { parseSkill } from "./skill.js";
import type { TraceRecord } from "./recorder.js";
import type { RunRecord } from "./runner.js";
import { writeFileAtomic } from "./writeback.js";

export async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Step 1 — detect agent config
// ---------------------------------------------------------------------------

export interface AgentConfigPaths {
  projectConfigPath: string;
  userConfigPath: string;
}

/** Where a Claude Code project MCP config (.mcp.json) and the user-scope config (~/.claude.json) would live for a given cwd/home. Pure — no I/O. */
export function agentConfigPaths(cwd: string, homedir: string): AgentConfigPaths {
  return {
    projectConfigPath: path.join(cwd, ".mcp.json"),
    userConfigPath: path.join(homedir, ".claude.json"),
  };
}

export interface AgentConfigDetection extends AgentConfigPaths {
  projectConfigExists: boolean;
  userConfigExists: boolean;
}

/** Detect whether a project `.mcp.json` and/or a user `~/.claude.json` exist. Testable against fixture directories — makes no assumption about the real machine's config. */
export async function detectAgentConfig(cwd: string, homedir: string): Promise<AgentConfigDetection> {
  const paths = agentConfigPaths(cwd, homedir);
  const [projectConfigExists, userConfigExists] = await Promise.all([
    fileExists(paths.projectConfigPath),
    fileExists(paths.userConfigPath),
  ]);
  return { ...paths, projectConfigExists, userConfigExists };
}

// ---------------------------------------------------------------------------
// The exact reelier proxy entry — printed for the user AND used to merge
// into .mcp.json when they opt in.
// ---------------------------------------------------------------------------

export interface McpServerEntry {
  command: string;
  args: string[];
}

/** The exact command line reelier prints to front an existing MCP server: `npx -y @seldonframe/reelier mcp --wrap "<wrapCommand>"`. */
export function reelierProxyCommandLine(wrapCommand: string): string {
  return `npx -y @seldonframe/reelier mcp --wrap ${JSON.stringify(wrapCommand)}`;
}

export function buildReelierServerEntry(wrapCommand: string): McpServerEntry {
  return { command: "npx", args: ["-y", "@seldonframe/reelier", "mcp", "--wrap", wrapCommand] };
}

// ---------------------------------------------------------------------------
// .mcp.json merge — pure. Preserves every existing server untouched; never
// clobbers an existing "reelier" entry (added: false signals "already
// there, left alone").
// ---------------------------------------------------------------------------

export interface McpConfigJson {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Parse an existing .mcp.json's raw text (undefined/empty text means "no file yet"). Throws if the file exists but its root isn't a JSON object — never silently discarded. */
export function parseMcpConfig(raw: string | undefined): McpConfigJson {
  if (raw === undefined || raw.trim() === "") return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Existing .mcp.json does not contain a JSON object at its root");
  }
  return parsed as McpConfigJson;
}

export interface MergeResult {
  config: McpConfigJson;
  added: boolean;
  preservedServerNames: string[];
}

/**
 * Merge a reelier proxy entry into an existing config under `serverName`
 * (default "reelier"), preserving every other server untouched. If a server
 * of that name already exists, the config is returned unchanged (added:
 * false) — init never silently overwrites a hand-configured entry.
 */
export function mergeReelierServer(config: McpConfigJson, entry: McpServerEntry, serverName = "reelier"): MergeResult {
  const existingServers = (config.mcpServers ?? {}) as Record<string, unknown>;
  const preservedServerNames = Object.keys(existingServers);
  if (serverName in existingServers) {
    return { config, added: false, preservedServerNames };
  }
  const merged: McpConfigJson = {
    ...config,
    mcpServers: { ...existingServers, [serverName]: entry },
  };
  return { config: merged, added: true, preservedServerNames };
}

export function formatMcpConfigJson(config: McpConfigJson): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Read (if present) and merge `.mcp.json` at `projectConfigPath`, returning
 * the before/after text and the merge result — WITHOUT writing anything.
 * Kept as a separate step from `applyMcpConfigWrite` so a caller can always
 * show the exact diff and get an explicit y/N before any write happens.
 */
export async function planMcpConfigWrite(
  projectConfigPath: string,
  wrapCommand: string
): Promise<{ before: string; after: string; result: MergeResult }> {
  let raw: string | undefined;
  if (await fileExists(projectConfigPath)) {
    raw = await readFile(projectConfigPath, "utf8");
  }
  const existing = parseMcpConfig(raw);
  const result = mergeReelierServer(existing, buildReelierServerEntry(wrapCommand));
  const before = raw ?? "(no existing file)";
  const after = formatMcpConfigJson(result.config);
  return { before, after, result };
}

/** Atomically write the merged config — the caller's job to have already gotten an explicit yes. */
export async function applyMcpConfigWrite(projectConfigPath: string, config: McpConfigJson): Promise<void> {
  await writeFileAtomic(projectConfigPath, formatMcpConfigJson(config));
}

// ---------------------------------------------------------------------------
// Newest trace lookup (path 2a — after the user records via a real MCP
// session, init needs to find what they just recorded).
// ---------------------------------------------------------------------------

/** The most recently modified `*.jsonl` trace under `traceDir`, or undefined if the directory doesn't exist or has none. */
export async function findNewestTraceFile(traceDir: string): Promise<string | undefined> {
  let entries: string[];
  try {
    entries = await readdir(traceDir);
  } catch {
    return undefined;
  }
  const jsonlFiles = entries.filter((e) => e.endsWith(".jsonl"));
  if (jsonlFiles.length === 0) return undefined;
  const withStats = await Promise.all(
    jsonlFiles.map(async (f) => {
      const p = path.join(traceDir, f);
      const st = await stat(p);
      return { p, mtimeMs: st.mtimeMs };
    })
  );
  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return withStats[0].p;
}

// ---------------------------------------------------------------------------
// Step 2b — the zero-setup demo path: a real 2-step workflow recorded
// through the same Recorder class the MCP proxy uses, so the resulting
// trace is a genuine, inspectable .reelier/traces/*.jsonl file, not a
// fabrication. Both requests are real (an injectable `tool` is only for
// tests, which supply a fake to keep unit tests network-free).
// ---------------------------------------------------------------------------

export interface DemoRecordingResult {
  ok: true;
  tracePath: string;
  homepage: string;
}

export interface DemoRecordingFailure {
  ok: false;
  message: string;
}

/** Wrap an Observation's body as an MCP-shaped tool result — the same shape a real MCP proxy call would have written (recorder.ts/mcp-tool.ts), which is what the compiler and `reelier trace` both expect to find in a "result" record's `body`. */
function toMcpResultBody(text: string, isError: boolean): unknown {
  return { content: [{ type: "text", text }], isError };
}

/**
 * Perform the real 2-step demo workflow — GET this package's *versioned*
 * npm registry metadata, bind its `homepage` field, then GET that homepage
 * URL verbatim — and record it through `recorder`.
 *
 * Step 1 deliberately hits `registry.npmjs.org/<pkg>/latest` (the flat,
 * single-version metadata endpoint) rather than the full packument
 * (`registry.npmjs.org/<pkg>`): a full packument nests a `versions` object
 * that mirrors `homepage` (and most other package-level fields) identically
 * inside every historical version entry, and the compiler's dataflow search
 * (compile.ts) binds to the FIRST leaf with a matching value in traversal
 * order — for a full packument that's an index-based path buried inside
 * `versions.<v>.*`, not the clean top-level one (verified against the live
 * registry response, not assumed — this is a real collision, not a
 * hypothetical one). The flat `/latest` endpoint has no such nested
 * duplicate, so `homepage` binds cleanly at the top level every time.
 *
 * Step 2 requests the bound `homepage` value verbatim (not embedded inside
 * a constructed URL) — the compiler's dataflow match is whole-value
 * equality, so the value that becomes `{{homepage}}` on replay must be
 * exactly what step 2's argument was recorded as.
 *
 * A failure at any point stops recording and returns `ok: false` with an
 * honest message; nothing here synthesizes a trace that didn't happen.
 */
export async function runDemoRecording(
  recorder: Recorder,
  toolCtx: ToolContext,
  tool: Tool = builtinTools["http.get"]
): Promise<DemoRecordingResult | DemoRecordingFailure> {
  const started = await recorder.start("reelier-init-demo", ["builtin:http.get"]);
  if (!started.ok) {
    return { ok: false, message: started.message };
  }

  recorder.note("Fetch @seldonframe/reelier's versioned npm registry metadata");
  const versionedUrl = "https://registry.npmjs.org/@seldonframe/reelier/latest";
  const i1 = recorder.recordCall("http.get", { url: versionedUrl });
  const t1 = Date.now();
  let obs1;
  try {
    obs1 = await tool.run({ url: versionedUrl }, toolCtx);
  } catch (err) {
    recorder.recordResult(i1, false, Date.now() - t1, toMcpResultBody((err as Error).message, true));
    await recorder.stop();
    return { ok: false, message: `Registry request failed: ${(err as Error).message}` };
  }
  const ok1 = obs1.status === 200;
  recorder.recordResult(i1, ok1, Date.now() - t1, toMcpResultBody(obs1.body, !ok1));
  if (!ok1) {
    await recorder.stop();
    return { ok: false, message: `Registry request returned HTTP ${obs1.status}` };
  }

  let versioned: unknown;
  try {
    versioned = JSON.parse(obs1.body);
  } catch (err) {
    await recorder.stop();
    return { ok: false, message: `Registry response was not valid JSON: ${(err as Error).message}` };
  }
  const homepage = (versioned as Record<string, unknown> | null)?.homepage;
  if (typeof homepage !== "string" || homepage.length < 4) {
    await recorder.stop();
    return {
      ok: false,
      message: "Registry response had no usable 'homepage' field to bind and chain into a second request.",
    };
  }

  recorder.note("Fetch the package homepage, using the URL bound from the registry response");
  const i2 = recorder.recordCall("http.get", { url: homepage });
  const t2 = Date.now();
  let obs2;
  try {
    obs2 = await tool.run({ url: homepage }, toolCtx);
  } catch (err) {
    recorder.recordResult(i2, false, Date.now() - t2, toMcpResultBody((err as Error).message, true));
    await recorder.stop();
    return { ok: false, message: `Homepage request failed: ${(err as Error).message}` };
  }
  const ok2 = obs2.status < 500;
  // Truncated defensively before it ever lands in a trace file — the demo
  // never asserts against this body, only that the fetch itself succeeded.
  recorder.recordResult(i2, ok2, Date.now() - t2, toMcpResultBody(obs2.body.slice(0, 5000), !ok2));

  const stopped = await recorder.stop();
  if (!stopped.ok) {
    return { ok: false, message: stopped.message };
  }
  return { ok: true, tracePath: stopped.path, homepage };
}

// ---------------------------------------------------------------------------
// Step 3 — compile it live.
// ---------------------------------------------------------------------------

export interface CompiledDemoSkill {
  skillPath: string;
  source: string;
  result: CompileResult;
}

/**
 * Compile a trace's records into a runner-ready skill and write it to
 * `skillPath` (always overwritten — this is a regenerated init artifact,
 * not hand-edited user work, unlike `reelier compile`'s own
 * refuse-without---force default). Sanity-checks the render round-trips
 * through parseSkill before writing — never written otherwise.
 */
export async function compileDemoTrace(
  records: TraceRecord[],
  traceFileName: string,
  skillPath: string
): Promise<CompiledDemoSkill> {
  const result = compile(records);
  const source = renderSkillMd(result, traceFileName);
  parseSkill(source);
  await writeFileAtomic(skillPath, source);
  return { skillPath, source, result };
}

// ---------------------------------------------------------------------------
// Step 5 — the receipt. Every number here comes straight from the
// RunRecord the replay just produced. `demoBenchmark`, when passed, is the
// one place this module cites a number that didn't come from *this* run —
// the launch benchmark's measured agent-vs-Reelier averages — always
// labeled as such.
// ---------------------------------------------------------------------------

export interface DemoBenchmarkComparison {
  agentAvgMs: number;
  agentAvgTokensIn: number;
}

/**
 * From docs/strategy/reelier-launch/benchmark-results.md, Task 1's Summary
 * KPI table ("Latency/run (avg)" and "Tokens/run (in/out) (avg)", Arm A —
 * agent, no Reelier), run date 2026-07-18T22:11:05.789Z. Measured, not
 * estimated — update both this comment and the values together if that
 * benchmark is ever re-run.
 */
export const LAUNCH_BENCHMARK_COMPARISON: DemoBenchmarkComparison = {
  agentAvgMs: 2842,
  agentAvgTokensIn: 18390,
};

export function formatReceipt(record: RunRecord, demoBenchmark?: DemoBenchmarkComparison): string[] {
  const lines: string[] = [];
  const llmTokensZero = record.totals.llmInputTokens === 0 && record.totals.llmOutputTokens === 0;

  lines.push("");
  lines.push("Your receipt:");
  lines.push(`  skill:        ${record.skill}`);
  lines.push(
    `  steps:        ${record.totals.steps} total, ${record.totals.passed} passed, ${record.totals.unchecked} unchecked, ${record.totals.failed} failed`
  );
  lines.push(`  replay time:  ${record.totals.ms}ms [measured]`);
  lines.push(
    `  LLM tokens:   ${
      llmTokensZero ? "0 [measured]" : `${record.totals.llmInputTokens} in / ${record.totals.llmOutputTokens} out [measured]`
    }`
  );

  if (demoBenchmark) {
    const agentTokensLabel = `~${Math.round(demoBenchmark.agentAvgTokensIn / 1000)}k`;
    const yourTokens = llmTokensZero ? "0" : String(record.totals.llmInputTokens + record.totals.llmOutputTokens);
    lines.push("");
    lines.push(
      `  An agent doing this re-reasons every run (~${(demoBenchmark.agentAvgMs / 1000).toFixed(1)}s, ${agentTokensLabel} tokens ` +
        `on our benchmark); your replay: ${record.totals.ms}ms, ${yourTokens} tokens.`
    );
  }

  return lines;
}

export function formatNextSteps(skillPath: string): string[] {
  return [
    "",
    "Next steps:",
    `  reelier run ${skillPath}      # replay again`,
    `  reelier push ${skillPath}     # sync receipts to Reelier Cloud (opt-in — see SPEC.md "Push")`,
    "  SPEC.md has the full trace / SKILL.md / run-record formats.",
  ];
}
