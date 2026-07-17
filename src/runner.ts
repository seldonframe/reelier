// The runner loop: for each step, fill {{var}} holes from bindings, execute
// the tool, evaluate assertions, extract binds, continue. Any assertion
// failure or missing bind is a divergence — v0 just records the failure and
// stops (the escalation ladder comes later). Linear only.

import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { Skill, Step } from "./skill.js";
import { evalAssert, evalBind, type Observation } from "./assert.js";
import { builtinTools, type Tool, type ToolContext } from "./tools.js";

export type StepOutcome = "passed" | "failed" | "unchecked" | "skipped";

export interface StepRecord {
  n: number;
  title: string;
  level: 0;
  outcome: StepOutcome;
  ms: number;
  failures: string[];
}

export interface RunRecord {
  skill: string;
  startedAt: string;
  finishedAt: string;
  passed: boolean;
  steps: StepRecord[];
  totals: {
    steps: number;
    passed: number;
    failed: number;
    ms: number;
  };
}

export interface RunOptions {
  vars?: Record<string, string>;
  allowDestructive?: boolean;
  tools?: Record<string, Tool>;
  /** Directory under which .reelier/runs/<skill>.jsonl is written. Defaults to cwd. */
  cwd?: string;
  /** When true, do not execute anything or write a run record — just report filled actions. */
  dryRun?: boolean;
  onStep?: (record: StepRecord, filledAction: { tool: string; args: unknown }) => void;
}

export interface DryRunStep {
  n: number;
  title: string;
  tool: string;
  args: unknown;
  effect: string;
}

/** Recursively fill {{var}} placeholders inside string values of a JSON-like structure. */
export function fillTemplate(value: unknown, bindings: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (whole, name: string) => {
      if (!(name in bindings)) {
        throw new Error(`Unbound template variable {{${name}}}`);
      }
      const v = bindings[name];
      return typeof v === "string" ? v : JSON.stringify(v);
    });
  }
  if (Array.isArray(value)) {
    return value.map((v) => fillTemplate(v, bindings));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = fillTemplate(v, bindings);
    }
    return out;
  }
  return value;
}

/** Produce the filled action for every step without executing anything. */
export function dryRunSkill(skill: Skill, vars: Record<string, string> = {}): DryRunStep[] {
  const bindings: Record<string, unknown> = { ...vars };
  return skill.steps.map((step) => {
    let args: unknown;
    try {
      args = fillTemplate(step.actionArgs, bindings);
    } catch (err) {
      args = `<error: ${(err as Error).message}>`;
    }
    return { n: step.n, title: step.title, tool: step.actionTool, args, effect: step.effect };
  });
}

function runRecordPath(cwd: string, skillName: string): string {
  return path.join(cwd, ".reelier", "runs", `${skillName}.jsonl`);
}

async function executeStep(
  step: Step,
  bindings: Record<string, unknown>,
  tools: Record<string, Tool>,
  ctx: ToolContext
): Promise<{ outcome: StepOutcome; ms: number; failures: string[] }> {
  const started = Date.now();
  const failures: string[] = [];

  const tool = tools[step.actionTool];
  if (!tool) {
    failures.push(`Unknown tool '${step.actionTool}'`);
    return { outcome: "failed", ms: Date.now() - started, failures };
  }

  if (step.effect === "destructive" && !ctx.allowDestructive) {
    let filledArgs: unknown;
    try {
      filledArgs = fillTemplate(step.actionArgs, bindings);
    } catch (err) {
      filledArgs = `<error: ${(err as Error).message}>`;
    }
    failures.push(
      `Refusing to execute destructive step without --yes. Filled action: ${step.actionTool} ${JSON.stringify(
        filledArgs
      )}`
    );
    return { outcome: "failed", ms: Date.now() - started, failures };
  }

  let filledArgs: unknown;
  try {
    filledArgs = fillTemplate(step.actionArgs, bindings);
  } catch (err) {
    failures.push(`Template fill failed: ${(err as Error).message}`);
    return { outcome: "failed", ms: Date.now() - started, failures };
  }

  let obs: Observation;
  try {
    obs = await tool.run(filledArgs, ctx);
  } catch (err) {
    failures.push(`Tool execution failed: ${(err as Error).message}`);
    return { outcome: "failed", ms: Date.now() - started, failures };
  }

  for (const assertLine of step.asserts) {
    try {
      const result = evalAssert(assertLine, obs);
      if (!result.ok) {
        failures.push(result.message);
      }
    } catch (err) {
      failures.push(`Assert error on '${assertLine}': ${(err as Error).message}`);
    }
  }

  for (const bindLine of step.binds) {
    try {
      const result = evalBind(bindLine, obs);
      if (!result.ok) {
        failures.push(result.message);
      } else {
        bindings[result.name] = result.value;
      }
    } catch (err) {
      failures.push(`Bind error on '${bindLine}': ${(err as Error).message}`);
    }
  }

  const ms = Date.now() - started;
  if (failures.length > 0) {
    return { outcome: "failed", ms, failures };
  }
  if (step.asserts.length === 0) {
    // Honest-success rule: zero assertions never counts as "passed".
    return { outcome: "unchecked", ms, failures };
  }
  return { outcome: "passed", ms, failures };
}

/** Run a skill's steps in order. Stops (marks remaining steps "skipped") on the first divergence. */
export async function runSkill(skill: Skill, options: RunOptions = {}): Promise<RunRecord> {
  const cwd = options.cwd ?? process.cwd();
  const tools = options.tools ?? builtinTools;
  const toolCtx: ToolContext = { allowDestructive: options.allowDestructive ?? false };
  const bindings: Record<string, unknown> = { ...(options.vars ?? {}) };

  const startedAt = new Date().toISOString();
  const stepRecords: StepRecord[] = [];
  let diverged = false;

  for (const step of skill.steps) {
    if (diverged) {
      const rec: StepRecord = { n: step.n, title: step.title, level: 0, outcome: "skipped", ms: 0, failures: [] };
      stepRecords.push(rec);
      options.onStep?.(rec, { tool: step.actionTool, args: step.actionArgs });
      continue;
    }

    const { outcome, ms, failures } = await executeStep(step, bindings, tools, toolCtx);
    const rec: StepRecord = { n: step.n, title: step.title, level: 0, outcome, ms, failures };
    stepRecords.push(rec);
    options.onStep?.(rec, { tool: step.actionTool, args: step.actionArgs });

    if (outcome === "failed") {
      diverged = true;
    }
  }

  const finishedAt = new Date().toISOString();
  const passedCount = stepRecords.filter((s) => s.outcome === "passed" || s.outcome === "unchecked").length;
  const failedCount = stepRecords.filter((s) => s.outcome === "failed").length;
  const totalMs = stepRecords.reduce((sum, s) => sum + s.ms, 0);

  const record: RunRecord = {
    skill: skill.name,
    startedAt,
    finishedAt,
    passed: failedCount === 0,
    steps: stepRecords,
    totals: { steps: stepRecords.length, passed: passedCount, failed: failedCount, ms: totalMs },
  };

  if (!options.dryRun) {
    const filePath = runRecordPath(cwd, skill.name);
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, JSON.stringify(record) + "\n", "utf8");
  }

  return record;
}
