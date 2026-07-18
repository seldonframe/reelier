#!/usr/bin/env node
// Hand-rolled argv parsing (no commander). Two subcommands: run, bench.

import { readFile, writeFile, access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseSkill, SkillParseError } from "./skill.js";
import { runSkill, dryRunSkill, type RunRecord } from "./runner.js";
import { builtinTools } from "./tools.js";
import { connectDownstream, type DownstreamConnection } from "./mcp-client.js";
import { buildMcpTools } from "./mcp-tool.js";
import { buildProxyServer } from "./recorder.js";
import { parseTraceLines, formatTrace } from "./trace.js";
import { compile, renderSkillMd } from "./compile.js";
import { createLlmClient, resolveLlmConfig } from "./llm.js";

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
      arg === "--llm-l2-model"
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

async function readRunRecords(filePath: string): Promise<RunRecord[]> {
  const records: RunRecord[] = [];
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    records.push(JSON.parse(trimmed) as RunRecord);
  }
  return records;
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
    console.error('Usage: reelier mcp --wrap "<command line>" [--wrap "<another>"] [--trace-dir <dir>]');
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
    case "trace":
      return cmdTrace(args);
    case "compile":
      return cmdCompile(args);
    default:
      console.error("Usage: reelier <run|bench|mcp|trace|compile> [options]");
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
