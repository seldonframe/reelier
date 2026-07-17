#!/usr/bin/env node
// Hand-rolled argv parsing (no commander). Two subcommands: run, bench.

import { readFile } from "node:fs/promises";
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

async function cmdRun(args: ParsedArgs): Promise<number> {
  const skillPath = args.positional[0];
  if (!skillPath) {
    console.error("Usage: reelier run <skill.md> [--dry-run] [--yes] [--var name=value ...]");
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

    const record = await runSkill(skill, {
      vars: args.vars,
      allowDestructive: args.flags.has("yes"),
      tools,
      onStep: (rec) => {
        const icon =
          rec.outcome === "passed" || rec.outcome === "unchecked" ? "✓" : rec.outcome === "skipped" ? "○" : "✗";
        const tag = rec.outcome === "unchecked" ? " (unchecked: no assertions)" : "";
        console.log(`${icon} Step ${rec.n} — ${rec.title} [${rec.outcome}${tag}] ${fmtDuration(rec.ms)}`);
        for (const f of rec.failures) {
          console.log(`    - ${f}`);
        }
      },
    });

    console.log("");
    console.log(
      `${record.passed ? "PASSED" : "FAILED"}: ${record.totals.passed}/${record.totals.steps} steps ok, ${
        record.totals.failed
      } failed, ${fmtDuration(record.totals.ms)} total`
    );

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

  const first = records[0];
  const latest = records[records.length - 1];
  const passCount = records.filter((r) => r.passed).length;
  const passRate = ((passCount / records.length) * 100).toFixed(1);

  const failureCounts = new Map<string, number>();
  for (const r of records) {
    for (const s of r.steps) {
      if (s.outcome === "failed") {
        const key = `Step ${s.n} — ${s.title}`;
        failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1);
      }
    }
  }

  console.log(`Bench: ${skill.name}`);
  console.log(`  runs:        ${records.length}`);
  console.log(`  pass rate:   ${passRate}% (${passCount}/${records.length})`);
  console.log(`  first run:   ${fmtDuration(first.totals.ms)} (${first.startedAt})`);
  console.log(`  latest run:  ${fmtDuration(latest.totals.ms)} (${latest.startedAt})`);
  console.log(`  LLM calls:   0 (Level 0)`);
  if (failureCounts.size > 0) {
    console.log(`  per-step failure counts:`);
    for (const [step, count] of failureCounts) {
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
    default:
      console.error("Usage: reelier <run|bench|mcp|trace> [options]");
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
