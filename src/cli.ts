#!/usr/bin/env node
// Hand-rolled argv parsing (no commander). Two subcommands: run, bench.

import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createInterface } from "node:readline/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseSkill, SkillParseError } from "./skill.js";
import { runSkill, dryRunSkill, readRunRecords, type RunRecord } from "./runner.js";
import { pushSkill, type PushRecordResult } from "./push.js";
import { builtinTools } from "./tools.js";
import { connectDownstream, type DownstreamConnection } from "./mcp-client.js";
import { buildMcpTools } from "./mcp-tool.js";
import { buildProxyServer, Recorder } from "./recorder.js";
import { parseTraceLines, formatTrace } from "./trace.js";
import { compile, renderSkillMd } from "./compile.js";
import { createLlmClient, resolveLlmConfig } from "./llm.js";
import {
  detectAgentConfig,
  reelierProxyCommandLine,
  planMcpConfigWrite,
  applyMcpConfigWrite,
  findNewestTraceFile,
  runDemoRecording,
  compileDemoTrace,
  formatReceipt,
  formatNextSteps,
  LAUNCH_BENCHMARK_COMPARISON,
  type DemoBenchmarkComparison,
} from "./init.js";
import { compileSessionTranscript, type SessionSkip } from "./session.js";
import { scanTranscripts, type ScannedSession } from "./scan.js";
import { planInstall, applyInstall, findLatestBackup, restoreFromBackup } from "./wrap.js";
import { buildToolServer } from "./serve.js";

interface ParsedArgs {
  positional: string[];
  flags: Set<string>;
  vars: Record<string, string>;
  wraps: string[];
  opts: Record<string, string>;
}

function parseArgv(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Set<string>();
  const vars: Record<string, string> = {};
  const wraps: string[] = [];
  const opts: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--var") {
      const kv = argv[++i];
      if (!kv || !kv.includes("=")) {
        throw new Error(`--var requires name=value, got: ${JSON.stringify(kv)}`);
      }
      const eq = kv.indexOf("=");
      vars[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (arg === "--wrap") {
      const val = argv[++i];
      if (!val) {
        throw new Error("--wrap requires a command-line string");
      }
      wraps.push(val);
    } else if (arg === "--trace-dir") {
      const val = argv[++i];
      if (!val) {
        throw new Error("--trace-dir requires a path");
      }
      opts["trace-dir"] = val;
    } else if (arg === "-o") {
      const val = argv[++i];
      if (!val) {
        throw new Error("-o requires an output path");
      }
      opts.o = val;
    } else if (
      arg === "--max-level" ||
      arg === "--llm-base-url" ||
      arg === "--llm-api-key" ||
      arg === "--llm-model" ||
      arg === "--llm-l2-model" ||
      arg === "--out" ||
      arg === "--name" ||
      arg === "--dir" ||
      arg === "--out-dir" ||
      arg === "--agent"
    ) {
      const val = argv[++i];
      if (!val) {
        throw new Error(`${arg} requires a value`);
      }
      opts[arg.slice(2)] = val;
    } else if (arg.startsWith("--")) {
      flags.add(arg.slice(2));
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags, vars, wraps, opts };
}

function fmtDuration(ms: number): string {
  return `${ms}ms`;
}

function parseMaxLevel(raw: string | undefined): 0 | 1 | 2 {
  if (raw === undefined) return 0;
  if (raw === "0") return 0;
  if (raw === "1") return 1;
  if (raw === "2") return 2;
  throw new Error(`--max-level must be 0, 1, or 2, got: ${JSON.stringify(raw)}`);
}

async function cmdRun(args: ParsedArgs): Promise<number> {
  const skillPath = args.positional[0];
  if (!skillPath) {
    console.error(
      "Usage: reelier run <skill.md> [--dry-run] [--yes] [--var name=value ...] [--max-level 0|1|2] " +
        "[--llm-base-url ...] [--llm-api-key ...] [--llm-model ...] [--llm-l2-model ...]"
    );
    return 1;
  }

  let maxLevel: 0 | 1 | 2;
  try {
    maxLevel = parseMaxLevel(args.opts["max-level"]);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  let source: string;
  try {
    source = await readFile(skillPath, "utf8");
  } catch (err) {
    console.error(`Could not read skill file ${skillPath}: ${(err as Error).message}`);
    return 1;
  }

  let skill;
  try {
    skill = parseSkill(source);
  } catch (err) {
    if (err instanceof SkillParseError) {
      console.error(`Malformed skill in ${skillPath}: ${err.message}`);
      return 1;
    }
    throw err;
  }

  if (args.flags.has("dry-run")) {
    const filled = dryRunSkill(skill, args.vars);
    console.log(`Dry run: ${skill.name} (${filled.length} steps)`);
    for (const step of filled) {
      console.log(`  Step ${step.n} — ${step.title} [${step.effect}]`);
      console.log(`    ${step.tool} ${JSON.stringify(step.args)}`);
    }
    return 0;
  }

  const downstreams: DownstreamConnection[] = [];
  try {
    for (const spec of args.wraps) {
      downstreams.push(await connectDownstream(spec));
    }

    const tools = downstreams.length > 0 ? { ...builtinTools, ...buildMcpTools(downstreams) } : undefined;

    // Rule: at --max-level 0 (default) the LLM is never constructed or
    // called. Only build it when escalation was actually requested.
    const llmConfig =
      maxLevel >= 1
        ? resolveLlmConfig({
            baseUrl: args.opts["llm-base-url"],
            apiKey: args.opts["llm-api-key"],
            model: args.opts["llm-model"],
            l2Model: args.opts["llm-l2-model"],
          })
        : undefined;

    const record = await runSkill(skill, {
      vars: args.vars,
      allowDestructive: args.flags.has("yes"),
      tools,
      maxLevel,
      llm: llmConfig ? createLlmClient(llmConfig) : undefined,
      llmModel: llmConfig?.model,
      llmL2Model: llmConfig?.l2Model,
      skillPath,
      onStep: (rec) => {
        const icon =
          rec.outcome === "passed" || rec.outcome === "unchecked" ? "✓" : rec.outcome === "skipped" ? "○" : "✗";
        const tag = rec.outcome === "unchecked" ? " (unchecked: no assertions)" : "";
        const levelTag = rec.level > 0 ? ` [healed L${rec.level}]` : "";
        console.log(`${icon} Step ${rec.n} — ${rec.title} [${rec.outcome}${tag}]${levelTag} ${fmtDuration(rec.ms)}`);
        for (const f of rec.failures) {
          console.log(`    - ${f}`);
        }
      },
    });

    console.log("");
    const okCount = record.totals.passed + record.totals.unchecked;
    const uncheckedTag = record.totals.unchecked > 0 ? ` (${record.totals.unchecked} unchecked)` : "";
    console.log(
      `${record.passed ? "PASSED" : "FAILED"}: ${okCount}/${record.totals.steps} steps ok${uncheckedTag}, ${
        record.totals.failed
      } failed, ${fmtDuration(record.totals.ms)} total`
    );
    if (record.totals.llmInputTokens > 0 || record.totals.llmOutputTokens > 0) {
      console.log(`LLM tokens: ${record.totals.llmInputTokens} in / ${record.totals.llmOutputTokens} out`);
    }

    return record.passed ? 0 : 1;
  } catch (err) {
    console.error(`Failed to connect --wrap downstream: ${(err as Error).message}`);
    return 1;
  } finally {
    await Promise.all(downstreams.map((d) => d.close().catch(() => {})));
  }
}

export interface BenchSummary {
  runs: number;
  passCount: number;
  passRate: string;
  firstMs: number;
  firstStartedAt: string;
  latestMs: number;
  latestStartedAt: string;
  totals: { passed: number; unchecked: number; skipped: number; failed: number };
  levelCounts: { 0: number; 1: number; 2: number };
  escalation: { l1Attempted: number; l1Healed: number; l2Attempted: number; l2Healed: number };
  llmInputTokens: number;
  llmOutputTokens: number;
  failureCounts: Map<string, number>;
}

/**
 * Per-record totals, honest across a mixed history: a record written before
 * 0.2.0 has no `totals.unchecked`/`totals.skipped` field (and its old
 * `totals.passed` counted "passed" OR "unchecked" together) — for those,
 * derive the split from the per-step outcomes instead, which were always
 * recorded correctly even when the rollup that summed them wasn't.
 */
function deriveRecordTotals(r: RunRecord): { passed: number; unchecked: number; skipped: number; failed: number } {
  if (r.totals.unchecked !== undefined) {
    return {
      passed: r.totals.passed,
      unchecked: r.totals.unchecked,
      skipped: r.totals.skipped ?? 0,
      failed: r.totals.failed,
    };
  }
  let passed = 0;
  let unchecked = 0;
  let skipped = 0;
  let failed = 0;
  for (const s of r.steps) {
    if (s.outcome === "passed") passed++;
    else if (s.outcome === "unchecked") unchecked++;
    else if (s.outcome === "skipped") skipped++;
    else if (s.outcome === "failed") failed++;
  }
  return { passed, unchecked, skipped, failed };
}

export function computeBenchSummary(records: RunRecord[]): BenchSummary {
  const first = records[0];
  const latest = records[records.length - 1];
  const passCount = records.filter((r) => r.passed).length;
  const passRate = ((passCount / records.length) * 100).toFixed(1);

  const failureCounts = new Map<string, number>();
  const levelCounts = { 0: 0, 1: 0, 2: 0 };
  const escalation = { l1Attempted: 0, l1Healed: 0, l2Attempted: 0, l2Healed: 0 };
  const totals = { passed: 0, unchecked: 0, skipped: 0, failed: 0 };
  let llmInputTokens = 0;
  let llmOutputTokens = 0;

  for (const r of records) {
    llmInputTokens += r.totals.llmInputTokens ?? 0;
    llmOutputTokens += r.totals.llmOutputTokens ?? 0;

    const t = deriveRecordTotals(r);
    totals.passed += t.passed;
    totals.unchecked += t.unchecked;
    totals.skipped += t.skipped;
    totals.failed += t.failed;

    for (const s of r.steps) {
      // Defensive against run records written before the escalation ladder
      // existed at all (no `level` field).
      levelCounts[s.level ?? 0]++;
      if (s.escalationAttempted !== undefined) {
        escalation.l1Attempted++;
        if (s.escalationAttempted === 2) escalation.l2Attempted++;
      }
      if (s.level === 1) escalation.l1Healed++;
      if (s.level === 2) escalation.l2Healed++;
      if (s.outcome === "failed") {
        const key = `Step ${s.n} — ${s.title}`;
        failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1);
      }
    }
  }

  return {
    runs: records.length,
    passCount,
    passRate,
    firstMs: first.totals.ms,
    firstStartedAt: first.startedAt,
    latestMs: latest.totals.ms,
    latestStartedAt: latest.startedAt,
    totals,
    levelCounts,
    escalation,
    llmInputTokens,
    llmOutputTokens,
    failureCounts,
  };
}

async function cmdBench(args: ParsedArgs): Promise<number> {
  const skillPath = args.positional[0];
  if (!skillPath) {
    console.error("Usage: reelier bench <skill.md>");
    return 1;
  }

  let source: string;
  try {
    source = await readFile(skillPath, "utf8");
  } catch (err) {
    console.error(`Could not read skill file ${skillPath}: ${(err as Error).message}`);
    return 1;
  }

  let skill;
  try {
    skill = parseSkill(source);
  } catch (err) {
    if (err instanceof SkillParseError) {
      console.error(`Malformed skill in ${skillPath}: ${err.message}`);
      return 1;
    }
    throw err;
  }

  const recordPath = path.join(process.cwd(), ".reelier", "runs", `${skill.name}.jsonl`);
  let records: RunRecord[];
  try {
    records = await readRunRecords(recordPath);
  } catch (err) {
    console.error(`No run records found at ${recordPath}: ${(err as Error).message}`);
    return 1;
  }

  if (records.length === 0) {
    console.error(`Run record file ${recordPath} is empty`);
    return 1;
  }

  const summary = computeBenchSummary(records);

  console.log(`Bench: ${skill.name}`);
  console.log(`  runs:        ${summary.runs}`);
  console.log(`  pass rate:   ${summary.passRate}% (${summary.passCount}/${summary.runs})`);
  console.log(`  first run:   ${fmtDuration(summary.firstMs)} (${summary.firstStartedAt})`);
  console.log(`  latest run:  ${fmtDuration(summary.latestMs)} (${summary.latestStartedAt})`);
  // Honesty rule: "passed" here is ONLY steps that actually verified an
  // assertion — never lump unchecked in with it (that's the whole point of
  // the totals-honesty fix; see runner.ts StepOutcome/RunRecord.totals).
  console.log(
    `  steps:       passed=${summary.totals.passed} unchecked=${summary.totals.unchecked} skipped=${summary.totals.skipped} failed=${summary.totals.failed} (across all runs)`
  );
  console.log(
    `  step levels: L0=${summary.levelCounts[0]} L1=${summary.levelCounts[1]} L2=${summary.levelCounts[2]} (across all runs)`
  );
  console.log(
    `  escalation:  L1 attempted=${summary.escalation.l1Attempted} healed=${summary.escalation.l1Healed}  L2 attempted=${summary.escalation.l2Attempted} healed=${summary.escalation.l2Healed} (a step that burned tokens and still failed shows here)`
  );
  console.log(`  LLM tokens:  ${summary.llmInputTokens} in / ${summary.llmOutputTokens} out (no cost math — tokens only)`);
  if (summary.failureCounts.size > 0) {
    console.log(`  per-step failure counts:`);
    for (const [step, count] of summary.failureCounts) {
      console.log(`    ${step}: ${count}`);
    }
  } else {
    console.log(`  per-step failure counts: none`);
  }

  return 0;
}

async function cmdMcp(args: ParsedArgs): Promise<number> {
  if (args.wraps.length === 0) {
    console.error(
      'Usage: reelier mcp --wrap "<command line>" [--wrap "<another>"] [--trace-dir <dir>]\n' +
        "  (this is the RECORDER — it fronts your OWN MCP server(s) so their calls can be captured into a " +
        "trace. To expose Reelier's own commands as tools instead, use 'reelier serve'.)"
    );
    return 1;
  }
  const traceDir = args.opts["trace-dir"] ?? path.join(process.cwd(), ".reelier", "traces");

  const downstreams: DownstreamConnection[] = [];
  try {
    for (const spec of args.wraps) {
      downstreams.push(await connectDownstream(spec));
    }
  } catch (err) {
    console.error(`Failed to connect --wrap downstream: ${(err as Error).message}`);
    await Promise.all(downstreams.map((d) => d.close().catch(() => {})));
    return 1;
  }

  const server = buildProxyServer(downstreams, { traceDir });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await server.close().catch(() => {});
    await Promise.all(downstreams.map((d) => d.close().catch(() => {})));
  };

  await new Promise<void>((resolve) => {
    process.stdin.on("close", resolve);
    process.stdin.on("end", resolve);
    process.on("SIGINT", () => resolve());
    process.on("SIGTERM", () => resolve());
  });
  await shutdown();

  return 0;
}

/**
 * `reelier serve` — the AGENT-NATIVE tool-server. Exposes Reelier's OWN
 * commands (scan, from-session, replay, push) as MCP tools an agent can
 * call mid-session. This is the OPPOSITE of `reelier mcp`: that command is
 * the recorder — it fronts *other* MCP servers (via --wrap) to capture
 * their calls. `reelier serve` takes no --wrap; it's Reelier fronting
 * itself. See src/serve.ts for the tool list + schemas.
 */
async function cmdServe(): Promise<number> {
  const server = buildToolServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await server.close().catch(() => {});
  };

  await new Promise<void>((resolve) => {
    process.stdin.on("close", resolve);
    process.stdin.on("end", resolve);
    process.on("SIGINT", () => resolve());
    process.on("SIGTERM", () => resolve());
  });
  await shutdown();

  return 0;
}

async function cmdTrace(args: ParsedArgs): Promise<number> {
  const tracePath = args.positional[0];
  if (!tracePath) {
    console.error("Usage: reelier trace <trace.jsonl>");
    return 1;
  }

  let source: string;
  try {
    source = await readFile(tracePath, "utf8");
  } catch (err) {
    console.error(`Could not read trace file ${tracePath}: ${(err as Error).message}`);
    return 1;
  }

  let records;
  try {
    records = parseTraceLines(source);
  } catch (err) {
    console.error(`Malformed trace file ${tracePath}: ${(err as Error).message}`);
    return 1;
  }

  for (const line of formatTrace(records)) {
    console.log(line);
  }
  return 0;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function cmdCompile(args: ParsedArgs): Promise<number> {
  const tracePath = args.positional[0];
  if (!tracePath) {
    console.error("Usage: reelier compile <trace.jsonl> [-o <out.skill.md>] [--force]");
    return 1;
  }

  let source: string;
  try {
    source = await readFile(tracePath, "utf8");
  } catch (err) {
    console.error(`Could not read trace file ${tracePath}: ${(err as Error).message}`);
    return 1;
  }

  let records;
  try {
    records = parseTraceLines(source);
  } catch (err) {
    console.error(`Malformed trace file ${tracePath}: ${(err as Error).message}`);
    return 1;
  }

  const result = compile(records);
  const traceFileName = path.basename(tracePath);
  const rendered = renderSkillMd(result, traceFileName);

  // Sanity check: the compiler must always produce a skill its own parser accepts.
  try {
    parseSkill(rendered);
  } catch (err) {
    console.error(`Internal error: compiled skill failed to round-trip through the skill parser: ${(err as Error).message}`);
    return 1;
  }

  const outPath = args.opts.o ?? path.join(process.cwd(), `${result.name}.skill.md`);

  if (!args.flags.has("force") && (await fileExists(outPath))) {
    console.error(`Refusing to overwrite existing file ${outPath} — pass --force to overwrite.`);
    return 1;
  }

  await writeFile(outPath, rendered, "utf8");

  console.log(`Wrote ${outPath}`);
  console.log(`  steps:   ${result.stats.steps}`);
  console.log(`  asserts: ${result.stats.asserts}`);
  console.log(`  binds:   ${result.stats.binds}`);
  console.log(
    `  effects: read=${result.stats.effects.read} idempotent-write=${result.stats.effects["idempotent-write"]} destructive=${result.stats.effects.destructive}`
  );
  console.log("");
  if (result.openQuestions.length === 0) {
    console.log("Open questions: (none)");
  } else {
    console.log(`Open questions (${result.openQuestions.length}):`);
    for (const oq of result.openQuestions) {
      const where = oq.stepN !== undefined ? `Step ${oq.stepN}` : "(trailing note)";
      console.log(`  - ${where}: ${oq.text}`);
    }
  }

  return 0;
}

function printSkipped(skipped: SessionSkip[]): void {
  if (skipped.length === 0) return;
  const byReason = new Map<string, string[]>();
  for (const s of skipped) {
    const list = byReason.get(s.reason) ?? [];
    list.push(s.name);
    byReason.set(s.reason, list);
  }
  console.log(`Skipped ${skipped.length} non-replayable/unresolved tool call(s):`);
  for (const [reason, names] of byReason) {
    const counts = new Map<string, number>();
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
    const nameList = [...counts.entries()].map(([n, c]) => (c > 1 ? `${n} x${c}` : n)).join(", ");
    console.log(`  - ${nameList}`);
    console.log(`    ${reason}`);
  }
}

async function cmdFromSession(args: ParsedArgs): Promise<number> {
  const transcriptPath = args.positional[0];
  if (!transcriptPath) {
    console.error("Usage: reelier from-session <transcript.jsonl> [--out <skill.md>] [--name <name>] [--force]");
    return 1;
  }

  let source: string;
  try {
    source = await readFile(transcriptPath, "utf8");
  } catch (err) {
    console.error(`Could not read transcript file ${transcriptPath}: ${(err as Error).message}`);
    return 1;
  }

  const traceFileName = path.basename(transcriptPath);
  const name = args.opts.name ?? traceFileName.replace(/\.jsonl$/i, "");

  const result = compileSessionTranscript(source, { name, traceFileName });

  console.log(`Scanned ${traceFileName}: ${result.ok ? result.replayableCount : 0} replayable call(s) found.`);
  console.log("");
  printSkipped(result.skipped);

  if (!result.ok) {
    console.log("");
    console.log(result.reason);
    return 1;
  }

  const outPath = args.opts.out ?? path.join(process.cwd(), `${result.compileResult.name}.skill.md`);
  if (!args.flags.has("force") && (await fileExists(outPath))) {
    console.error(`\nRefusing to overwrite existing file ${outPath} — pass --force to overwrite.`);
    return 1;
  }

  await writeFile(outPath, result.skillSource, "utf8");

  console.log("");
  console.log(`Wrote ${outPath}`);
  console.log(`  steps:   ${result.compileResult.stats.steps}`);
  console.log(`  asserts: ${result.compileResult.stats.asserts}`);
  console.log(`  binds:   ${result.compileResult.stats.binds}`);
  if (result.servers.length > 0) {
    console.log(`  MCP servers used: ${result.servers.join(", ")}`);
  }
  console.log("");
  if (result.compileResult.openQuestions.length === 0) {
    console.log("Open questions: (none)");
  } else {
    console.log(`Open questions (${result.compileResult.openQuestions.length}):`);
    for (const oq of result.compileResult.openQuestions) {
      const where = oq.stepN !== undefined ? `Step ${oq.stepN}` : "(trailing note)";
      console.log(`  - ${where}: ${oq.text}`);
    }
  }

  return 0;
}

function fmtSessionLine(index: number, s: ScannedSession): string {
  const when = new Date(s.mtimeMs).toISOString().slice(0, 16).replace("T", " ");
  if (s.replayableCount > 0) {
    const servers = s.servers.length > 0 ? ` — ${s.servers.join(", ")}` : "";
    return `  [${index}] ${s.project} · ${when} · ${s.replayableCount} replayable call(s)${servers}`;
  }
  return `  (skipped) ${s.project} · ${when} · no replayable tool calls found`;
}

async function cmdScan(args: ParsedArgs): Promise<number> {
  const rootDir = args.opts.dir ?? path.join(os.homedir(), ".claude", "projects");
  const yes = args.flags.has("yes");

  console.log(`Scanning ${rootDir} for agent session transcripts...`);
  const sessions = await scanTranscripts(rootDir);

  const replayable = sessions.filter((s) => s.replayableCount > 0);
  const skipped = sessions.filter((s) => s.replayableCount === 0);

  console.log("");
  console.log(
    `Found ${sessions.length} session(s) in your agent history · ${replayable.length} contain replayable workflows.`
  );
  console.log("");

  if (replayable.length === 0) {
    console.log("None of the scanned sessions contain a deterministically-replayable tool-call sequence (Reelier");
    console.log("replays API/MCP tool workflows, not file edits or shell commands) — nothing to compile.");
    if (skipped.length > 0) {
      console.log("");
      console.log(`Skipped (no replayable calls): ${skipped.length} session(s).`);
    }
    return 0;
  }

  console.log("Which should Reelier turn into a skill you can replay forever?");
  console.log("");
  for (let i = 0; i < replayable.length; i++) {
    console.log(fmtSessionLine(i + 1, replayable[i]));
  }
  if (skipped.length > 0) {
    console.log("");
    console.log(`(${skipped.length} other session(s) skipped — no replayable tool calls found, not offered as options.)`);
  }

  let selected: ScannedSession[];
  if (yes) {
    selected = replayable;
    console.log("");
    console.log(`--yes: compiling all ${selected.length} session(s) with replayable calls.`);
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answer: string;
    try {
      answer = (
        await rl.question(`\nSelect sessions to compile (comma-separated numbers, "all", or Enter for none): `)
      ).trim();
    } finally {
      rl.close();
    }
    if (answer === "" ) {
      console.log("No sessions selected — nothing compiled.");
      return 0;
    }
    if (answer.toLowerCase() === "all") {
      selected = replayable;
    } else {
      const indices = answer
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= replayable.length);
      selected = indices.map((n) => replayable[n - 1]);
      if (selected.length === 0) {
        console.log("No valid selection — nothing compiled.");
        return 0;
      }
    }
  }

  const outDir = args.opts["out-dir"] ?? path.join(process.cwd(), ".reelier", "skills-from-scan");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(outDir, { recursive: true });

  console.log("");
  let compiledCount = 0;
  for (const session of selected) {
    let source: string;
    try {
      source = await readFile(session.path, "utf8");
    } catch (err) {
      console.log(`  ${session.path}: could not re-read (${(err as Error).message}) — skipped.`);
      continue;
    }
    const traceFileName = path.basename(session.path);
    const name = `${session.project}-${traceFileName.replace(/\.jsonl$/i, "")}`;
    const result = compileSessionTranscript(source, { name, traceFileName });
    if (!result.ok) {
      // Shouldn't happen (scan already filtered to replayableCount > 0), but never fabricate a skill if it does.
      console.log(`  ${session.path}: ${result.reason}`);
      continue;
    }
    const outPath = path.join(outDir, `${name}.skill.md`);
    await writeFile(outPath, result.skillSource, "utf8");
    console.log(
      `  Wrote ${outPath} (${result.compileResult.stats.steps} steps, ${result.compileResult.stats.asserts} asserts, ${result.skipped.length} calls skipped)`
    );
    compiledCount++;
  }

  console.log("");
  console.log(`Compiled ${compiledCount}/${selected.length} selected session(s) into ${outDir}.`);
  return 0;
}

async function cmdInstall(args: ParsedArgs): Promise<number> {
  const agent = args.opts.agent ?? "auto";
  if (agent !== "auto" && agent !== "claude") {
    console.error(`Unsupported --agent '${agent}' — only 'claude' (or 'auto', which currently resolves to claude) is supported.`);
    return 1;
  }

  const cwd = process.cwd();
  const homedir = os.homedir();
  const detection = await detectAgentConfig(cwd, homedir);
  const configPath = detection.projectConfigExists
    ? detection.projectConfigPath
    : detection.userConfigExists
      ? detection.userConfigPath
      : undefined;

  if (!configPath) {
    console.error(
      `No MCP config found — checked ${detection.projectConfigPath} and ${detection.userConfigPath}. Configure ` +
        `at least one MCP server first (or run 'reelier init'), then re-run 'reelier install'.`
    );
    return 1;
  }

  console.log(`reelier install — wrapping the MCP servers in ${configPath} so recording is one phrase away.`);
  console.log("");

  const plan = await planInstall(configPath);
  for (const e of plan.entries) {
    if (e.action === "wrap") console.log(`  ${e.name}: will wrap`);
    else if (e.action === "already-wrapped") console.log(`  ${e.name}: already wrapped — left alone`);
    else console.log(`  ${e.name}: skipped — ${e.reason}`);
  }

  if (!plan.changed) {
    console.log("");
    console.log("Nothing to do — every configured server is already wrapped or can't be wrapped.");
    return 0;
  }

  if (args.flags.has("dry-run")) {
    console.log("");
    console.log("Dry run — resulting config would be:");
    console.log(
      plan.after
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n")
    );
    console.log("\nNothing written (--dry-run).");
    return 0;
  }

  const result = await applyInstall(plan);
  console.log("");
  console.log(`Wrapped ${result.wrappedCount} server(s) in ${configPath}.`);
  if (result.backupPath) console.log(`Original config backed up to ${result.backupPath}.`);
  console.log("");
  console.log("Restart your agent, then work normally. When you want to save a workflow, tell your agent:");
  console.log('  "record this" ... do the work ... "done"');
  console.log("Then compile it: reelier from-session <the .jsonl transcript your agent just wrote>");
  console.log("");
  console.log("To revert: reelier uninstall");
  return 0;
}

async function cmdUninstall(args: ParsedArgs): Promise<number> {
  const agent = args.opts.agent ?? "auto";
  if (agent !== "auto" && agent !== "claude") {
    console.error(`Unsupported --agent '${agent}' — only 'claude' (or 'auto', which currently resolves to claude) is supported.`);
    return 1;
  }

  const cwd = process.cwd();
  const homedir = os.homedir();
  const detection = await detectAgentConfig(cwd, homedir);
  const configPath = detection.projectConfigExists ? detection.projectConfigPath : detection.userConfigPath;

  const backup = await findLatestBackup(configPath);
  if (!backup) {
    console.error(
      `No reelier install backup found for ${configPath}. If you have a backup file from elsewhere, restore it ` +
        `manually by copying its contents back over ${configPath}.`
    );
    return 1;
  }

  await restoreFromBackup(configPath, backup);
  console.log(`Restored ${configPath} from ${backup}.`);
  return 0;
}

function fmtFieldErrors(fieldErrors: unknown): string {
  if (fieldErrors === undefined) return "(no field errors returned)";
  try {
    return JSON.stringify(fieldErrors);
  } catch {
    return String(fieldErrors);
  }
}

async function cmdPush(args: ParsedArgs): Promise<number> {
  const skillPath = args.positional[0];
  if (!skillPath) {
    console.error("Usage: reelier push <skill.md> [--all] [--dry-run] [--with-skill]");
    return 1;
  }

  const dryRun = args.flags.has("dry-run");
  const all = args.flags.has("all");
  const withSkill = args.flags.has("with-skill");

  let result;
  try {
    result = await pushSkill(skillPath, {
      all,
      dryRun,
      withSkill,
      onRecordResult: (r: PushRecordResult) => {
        if (dryRun) {
          console.log(`  [${r.index}] would push`);
          return;
        }
        switch (r.outcome) {
          case "pushed":
            console.log(`  [${r.index}] pushed${r.id ? ` id=${r.id}` : ""}`);
            break;
          case "rejected":
            console.log(
              `  [${r.index}] rejected (permanent — cursor advances past it): ${fmtFieldErrors(r.fieldErrors)}`
            );
            break;
          case "auth-failed":
            console.log(`  [${r.index}] auth failed (batch stops here): ${r.message}`);
            break;
          case "too-large":
            console.log(`  [${r.index}] rejected 413 (permanent — cursor advances past it): ${r.message}`);
            break;
          case "error":
            console.log(`  [${r.index}] error (batch stops here): ${r.message}`);
            break;
        }
      },
    });
  } catch (err) {
    // Deliberately just the error's message — resolvePushConfig() never puts
    // the key value into its message, and neither does anything else here.
    console.error((err as Error).message);
    return 1;
  }

  if (result.dryRun) {
    console.log("");
    console.log(
      `Dry run: would push ${result.candidateCount} new record(s) for skill '${result.skillName}' ` +
        `(cursor ${result.cursorBefore} -> ${result.cursorBefore + result.candidateCount}).`
    );
    console.log("Dry run: no network calls made, no state written.");
    return 0;
  }

  console.log("");
  if (result.skillUploaded) {
    console.log(`Skill '${result.skillName}' uploaded.`);
  } else {
    console.log(`Skill '${result.skillName}' upload skipped (already uploaded — pass --with-skill to force).`);
  }
  const rejectedNote = result.rejectedCount > 0 ? `, ${result.rejectedCount} permanently rejected` : "";
  console.log(
    `Pushed ${result.pushedCount}/${result.candidateCount} new record(s)${rejectedNote} for '${result.skillName}'. ` +
      `Cursor: ${result.cursorBefore} -> ${result.cursorAfter}.`
  );
  if (result.aborted) {
    console.log("Stopped early on a transient failure (auth or network/error) — cursor left at the last consumed record.");
    return 1;
  }
  return 0;
}

/**
 * Compile a trace, print the "these are the gaps I won't guess about" open
 * questions block, replay it once at Level 0 (zero LLM calls, optionally
 * against real `--wrap`'d downstream(s) for the recorded-session path), and
 * print the closing receipt. Shared by both `init` paths (demo and real
 * MCP recording) so the compile/replay/receipt steps behave identically
 * regardless of how the trace was produced.
 */
async function compileReplayAndReceipt(
  tracePath: string,
  cwd: string,
  demoBenchmark: DemoBenchmarkComparison | undefined,
  wraps: string[]
): Promise<number> {
  console.log("");
  console.log("Compiling live (zero LLM calls)...");
  const source = await readFile(tracePath, "utf8");
  const records = parseTraceLines(source);
  const skillPath = path.join(cwd, "reelier-init-demo.skill.md");

  let compiled;
  try {
    compiled = await compileDemoTrace(records, path.basename(tracePath), skillPath);
  } catch (err) {
    console.error(`Compile failed: ${(err as Error).message}`);
    return 1;
  }
  console.log(`  Wrote ${compiled.skillPath}`);
  console.log(
    `  steps: ${compiled.result.stats.steps}  asserts: ${compiled.result.stats.asserts}  binds: ${compiled.result.stats.binds}`
  );
  console.log("");
  if (compiled.result.openQuestions.length === 0) {
    console.log("Open questions: (none) — these are the gaps I won't guess about");
  } else {
    console.log(`Open questions (${compiled.result.openQuestions.length}) — these are the gaps I won't guess about:`);
    for (const oq of compiled.result.openQuestions) {
      const where = oq.stepN !== undefined ? `Step ${oq.stepN}` : "(trailing note)";
      console.log(`  - ${where}: ${oq.text}`);
    }
  }

  console.log("");
  console.log("Replaying once (Level 0 — the LLM is never constructed or called)...");

  const downstreams: DownstreamConnection[] = [];
  try {
    for (const spec of wraps) {
      downstreams.push(await connectDownstream(spec));
    }
    const tools = downstreams.length > 0 ? { ...builtinTools, ...buildMcpTools(downstreams) } : undefined;

    const skill = parseSkill(compiled.source);
    const record = await runSkill(skill, {
      cwd,
      tools,
      maxLevel: 0,
      skillPath: compiled.skillPath,
      onStep: (rec) => {
        const icon = rec.outcome === "passed" || rec.outcome === "unchecked" ? "✓" : rec.outcome === "skipped" ? "○" : "✗";
        console.log(`  ${icon} Step ${rec.n} — ${rec.title} [${rec.outcome}] ${rec.ms}ms`);
      },
    });

    // Level 0 must never touch the LLM — assert that rather than assuming
    // it before the receipt claims "0 tokens" (never claim a step succeeded
    // that didn't).
    if (record.totals.llmInputTokens !== 0 || record.totals.llmOutputTokens !== 0) {
      console.error(
        `WARNING: Level 0 replay reported nonzero LLM token usage (${record.totals.llmInputTokens} in / ` +
          `${record.totals.llmOutputTokens} out) — that should be structurally impossible. Reporting the real ` +
          `numbers below rather than a "0 tokens" claim that wouldn't be true.`
      );
    }

    for (const line of formatReceipt(record, demoBenchmark)) console.log(line);
    for (const line of formatNextSteps(compiled.skillPath)) console.log(line);

    if (!record.passed) {
      console.error("\nReplay did not pass — see the failures above. That's still your real result, not hidden.");
      return 1;
    }
    return 0;
  } catch (err) {
    console.error(`Replay failed: ${(err as Error).message}`);
    return 1;
  } finally {
    await Promise.all(downstreams.map((d) => d.close().catch(() => {})));
  }
}

async function runDemoPath(cwd: string): Promise<number> {
  console.log("");
  console.log("Recording the zero-setup demo — 2 real HTTP requests, nothing fabricated:");
  console.log("  1. GET @seldonframe/reelier's versioned npm registry metadata");
  console.log("  2. GET the package homepage, using the URL bound from step 1's response");
  console.log("");

  const traceDir = path.join(cwd, ".reelier", "traces");
  const recorder = new Recorder(traceDir);
  const recording = await runDemoRecording(recorder, { allowDestructive: false });
  if (!recording.ok) {
    console.error(`Recording failed: ${recording.message}`);
    return 1;
  }
  console.log(`  Recorded ${recording.tracePath}`);

  return compileReplayAndReceipt(recording.tracePath, cwd, LAUNCH_BENCHMARK_COMPARISON, []);
}

async function runRealPath(wrapCommand: string, cwd: string): Promise<number> {
  const traceDir = path.join(cwd, ".reelier", "traces");
  const tracePath = await findNewestTraceFile(traceDir);
  if (!tracePath) {
    console.error(
      `No trace found under ${traceDir} — recording may not have happened, or reelier_stop_recording was never ` +
        `called. Nothing to compile; re-run 'reelier init' once you've recorded a session.`
    );
    return 1;
  }
  console.log(`  Found trace ${tracePath}`);
  return compileReplayAndReceipt(tracePath, cwd, undefined, [wrapCommand]);
}

async function cmdInit(args: ParsedArgs): Promise<number> {
  const yes = args.flags.has("yes");
  const cwd = process.cwd();
  const homedir = os.homedir();

  console.log("Reelier init — record once, replay forever. Let's get your first receipt in under 60 seconds.");
  console.log("");

  const detection = await detectAgentConfig(cwd, homedir);
  console.log("Step 1 — agent config");
  console.log(
    `  project MCP config (${detection.projectConfigPath}): ${detection.projectConfigExists ? "found" : "not found"}`
  );
  console.log(
    `  user Claude config (${detection.userConfigPath}): ${detection.userConfigExists ? "found" : "not found"}`
  );
  console.log("");
  console.log("  To record a real agent session later, front an existing MCP server with reelier:");
  console.log(`    ${reelierProxyCommandLine("<your-mcp-server-command>")}`);
  console.log(
    "  Recording needs at least one --wrap'd downstream server — since we don't know yours yet, the default"
  );
  console.log("  below is the zero-setup demo path instead.");

  let wrapCommand: string | undefined;

  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const choice = (
        await rl.question("\nRecord a REAL session against your own MCP server instead of the demo? [y/N] ")
      )
        .trim()
        .toLowerCase();

      if (choice === "y" || choice === "yes") {
        const raw = (
          await rl.question("Paste the command line for your downstream MCP server (e.g. npx -y @your/mcp-server): ")
        ).trim();

        if (raw) {
          wrapCommand = raw;

          const writeChoice = (await rl.question(`Write/merge this into ${detection.projectConfigPath}? [y/N] `))
            .trim()
            .toLowerCase();
          if (writeChoice === "y" || writeChoice === "yes") {
            // A malformed existing .mcp.json (or any other read/write
            // failure here) must never abort the whole init — the file is
            // already left untouched by construction (planMcpConfigWrite
            // only reads+parses; applyMcpConfigWrite is never reached until
            // an explicit confirm below), so the honest recovery is to say
            // so and fall through to the zero-setup demo path rather than
            // crash with a raw SyntaxError.
            try {
              const plan = await planMcpConfigWrite(detection.projectConfigPath, wrapCommand);
              if (!plan.result.added) {
                console.log(
                  `  A "reelier" server is already configured in ${detection.projectConfigPath} — left untouched.`
                );
              } else {
                console.log("  Resulting .mcp.json:");
                console.log(
                  plan.after
                    .split("\n")
                    .map((l) => `    ${l}`)
                    .join("\n")
                );
                const confirm = (await rl.question("  Write this? [y/N] ")).trim().toLowerCase();
                if (confirm === "y" || confirm === "yes") {
                  await applyMcpConfigWrite(detection.projectConfigPath, plan.result.config);
                  console.log(
                    `  Wrote ${detection.projectConfigPath} (preserved ${plan.result.preservedServerNames.length} existing server(s)).`
                  );
                } else {
                  console.log("  Skipped — nothing written.");
                }
              }
            } catch (err) {
              console.log(
                `  Your existing ${detection.projectConfigPath} isn't valid JSON — leaving it untouched; ` +
                  `continuing with the demo path. (${(err as Error).message})`
              );
              wrapCommand = undefined;
            }
          }

          if (wrapCommand) {
            console.log("");
            console.log("  Restart your agent so it picks up the new MCP server, then tell it:");
            console.log('    "record yourself doing <the task you want to teach me>"');
            await rl.question("\n  Press Enter once you've finished recording and stopped the recording... ");
          }
        }
      }
    } finally {
      rl.close();
    }
  }

  if (wrapCommand) {
    return runRealPath(wrapCommand, cwd);
  }
  return runDemoPath(cwd);
}

async function main(): Promise<number> {
  const [, , cmd, ...rest] = process.argv;
  const args = parseArgv(rest);

  switch (cmd) {
    case "run":
      return cmdRun(args);
    case "bench":
      return cmdBench(args);
    case "mcp":
      return cmdMcp(args);
    case "serve":
      return cmdServe();
    case "trace":
      return cmdTrace(args);
    case "compile":
      return cmdCompile(args);
    case "push":
      return cmdPush(args);
    case "init":
      return cmdInit(args);
    case "from-session":
      return cmdFromSession(args);
    case "scan":
      return cmdScan(args);
    case "install":
      return cmdInstall(args);
    case "uninstall":
      return cmdUninstall(args);
    default:
      console.error(
        "Usage: reelier <run|bench|mcp|serve|trace|compile|push|init|from-session|scan|install|uninstall> [options]\n" +
          "  mcp   — RECORDER: fronts your own --wrap'd MCP server(s) to capture their calls into a trace.\n" +
          "  serve — TOOL-SERVER: exposes Reelier's own commands (scan/from-session/replay/push) as MCP tools."
      );
      return 1;
  }
}

main()
  .then((code) => {
    // Set exitCode rather than force-calling process.exit(): fetch's
    // underlying async handles need a turn of the event loop to close
    // cleanly (a forced exit() here can race that teardown on Windows).
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exitCode = 1;
  });
