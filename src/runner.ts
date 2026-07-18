// The runner loop: for each step, fill {{var}} holes from bindings, execute
// the tool, evaluate assertions, extract binds, continue. Any assertion
// failure or missing bind is a divergence.
//
// At --max-level 0 (the default) a divergence just stops the run — the LLM
// is never constructed or called, full stop; BYOK spend is opt-in.
//
// At --max-level >= 1, a divergence first tries Level 1: re-evaluate the
// SAME already-captured observation with an LLM-patched assert/bind set —
// zero side effects by construction, since nothing is re-executed. If that
// doesn't hold and --max-level >= 2, and the step's effect isn't
// destructive, Level 2 asks the LLM to propose patched args and re-executes
// the step exactly once against the fresh result. A destructive step never
// auto-re-runs at L2 — that's Level 3, a human fixing the skill by hand.
//
// A successful heal (L1 or L2) is written back to the skill file
// immediately (src/writeback.ts) — the whole point of the ladder is that
// the same drift never has to escalate twice.

import { mkdir, appendFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import type { Skill, Step } from "./skill.js";
import { evalAssert, evalBind, type Observation } from "./assert.js";
import { builtinTools, type Tool, type ToolContext } from "./tools.js";
// Re-exported from the "." package entry too (in addition to "./tools")
// purely for caller convenience — a consumer already importing RunOptions/
// runSkill from here shouldn't need a second import just for the builtin
// tool registry.
export { builtinTools };
import type { LlmClient } from "./llm.js";
import { resolveL1, resolveL2 } from "./escalate.js";
import { applyWritebackSafely } from "./writeback.js";

export type StepOutcome = "passed" | "failed" | "unchecked" | "skipped";

export interface StepRecord {
  n: number;
  title: string;
  /** 0 = ran deterministically (or wasn't attempted); 1/2 = healed at that escalation level. */
  level: 0 | 1 | 2;
  outcome: StepOutcome;
  ms: number;
  failures: string[];
  /** LLM token usage summed across every escalation attempt on this step (incl. failed ones) — 0 attempts means this is absent, not zero. */
  llm?: { inputTokens: number; outputTokens: number };
  /**
   * Highest escalation ladder level TRIED for this step — present whenever
   * escalation ran at all (success or failure), absent when it never ran
   * (either the step didn't diverge, or maxLevel was 0). Distinct from
   * `level`, which records only the level that HEALED it (0 if it never
   * healed, even after an escalation attempt).
   */
  escalationAttempted?: 0 | 1 | 2;
}

export interface RunRecord {
  skill: string;
  startedAt: string;
  finishedAt: string;
  passed: boolean;
  steps: StepRecord[];
  totals: {
    steps: number;
    /** Steps whose outcome is exactly "passed" — never includes "unchecked". */
    passed: number;
    /** Steps that ran with zero assertions (honest-success rule: never counted as "passed"). */
    unchecked: number;
    /** Steps skipped because an earlier step diverged and didn't heal. */
    skipped: number;
    failed: number;
    ms: number;
    /** 0 for a pure-L0 run (no escalation ever attempted). */
    llmInputTokens: number;
    llmOutputTokens: number;
  };
}

export interface RunOptions {
  vars?: Record<string, string>;
  allowDestructive?: boolean;
  tools?: Record<string, Tool>;
  /** Directory under which .reelier/runs/<skill>.jsonl is written. Defaults to cwd. */
  cwd?: string;
  /**
   * When true, `runSkill` still executes every step's tool call normally
   * (including a destructive step, subject to the usual `allowDestructive`
   * gate) — this only skips the final append to
   * `.reelier/runs/<skill>.jsonl`. It is NOT "no execution, no side
   * effects" — for that, use `dryRunSkill` instead, a separate function
   * that never calls a tool at all. (The CLI's `--dry-run` flag uses
   * `dryRunSkill`, not this option — see SPEC.md §6.1's "dryRun" note.)
   */
  dryRun?: boolean;
  onStep?: (record: StepRecord, filledAction: { tool: string; args: unknown }) => void;
  /** 0 (default) = pure deterministic replay, LLM never constructed or called. 1 = L1 only. 2 = L1 then L2. */
  maxLevel?: 0 | 1 | 2;
  /** Required (and only ever touched) when maxLevel >= 1. Constructing this is the caller's job — the runner never builds one itself. */
  llm?: LlmClient;
  llmModel?: string;
  llmL2Model?: string;
  /** Path to the skill's source file, required for write-back on a successful heal. Without it, a heal still passes this run but a stderr warning is printed (nothing to persist to). */
  skillPath?: string;
}

export interface DryRunStep {
  n: number;
  title: string;
  tool: string;
  args: unknown;
  effect: string;
}

// ---------------------------------------------------------------------------
// Computed date template vars — {{today}}, {{today-Nd}}, {{today+Nd}}.
// Deterministic, resolved at fill time against a single `now` snapshot (see
// fillTemplate's `now` param). Reserved names — see parseSkill's guard in
// src/skill.ts, which rejects a bind named `today`/`today±Nd` at parse time
// so a skill can never accidentally shadow these.
// ---------------------------------------------------------------------------

const COMPUTED_DATE_OFFSET_RE = /^today([+-])(\d+)d$/;

/** UTC calendar date (YYYY-MM-DD) for a given epoch-ms instant. */
function isoDateUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Resolve `name` as a computed date var against `now` (epoch ms).
 * Returns undefined if `name` isn't a computed-date form at all (so the
 * caller falls back to an ordinary bindings lookup). Throws if it IS a
 * `today±Nd` form but N is out of the supported 1-365 range — this is a
 * divergence, not a silent pass-through.
 */
function resolveComputedDateVar(name: string, now: number): string | undefined {
  if (name === "today") {
    return isoDateUtc(now);
  }
  const m = name.match(COMPUTED_DATE_OFFSET_RE);
  if (!m) return undefined;
  const sign = m[1] === "+" ? 1 : -1;
  const n = parseInt(m[2], 10);
  if (n < 1 || n > 365) {
    throw new Error(
      `Computed date var {{${name}}} has an offset of ${n} days — only 1-365 is supported`
    );
  }
  return isoDateUtc(now + sign * n * MS_PER_DAY);
}

/**
 * Recursively fill {{var}} placeholders inside string values of a JSON-like
 * structure. `{{today}}` / `{{today-Nd}}` / `{{today+Nd}}` (N = 1-365) are
 * computed deterministically from `now` (default `Date.now()`) rather than
 * looked up in `bindings` — see the module comment above. This is the one
 * place reelier deliberately introduces a run-time-dependent value; callers
 * that need reproducible fills across an entire run (dryRunSkill, runSkill)
 * pass a single `now` snapshot through every fillTemplate call so a run
 * never straddles a UTC midnight boundary mid-execution.
 */
export function fillTemplate(
  value: unknown,
  bindings: Record<string, unknown>,
  now: number = Date.now()
): unknown {
  if (typeof value === "string") {
    // Malformed date-offset forms ({{today+3}}, {{today-d}}, {{today+3x}})
    // would otherwise fail the main pattern below and ship downstream as
    // inert literal text — the exact typo class the date vars invite. Reject
    // them loudly as a divergence instead (reviewer P2-1, 0.3.0).
    const malformed = value.match(/\{\{\s*(today[+-][^}\s]*)\s*\}\}/g);
    if (malformed) {
      for (const m of malformed) {
        const body = m.replace(/^\{\{\s*|\s*\}\}$/g, "");
        if (!COMPUTED_DATE_OFFSET_RE.test(body)) {
          throw new Error(
            `Malformed computed date var {{${body}}} — supported forms are {{today}}, {{today-Nd}}, {{today+Nd}} (N = 1-365)`
          );
        }
      }
    }
    return value.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*|today[+-]\d+d)\s*\}\}/g, (whole, name: string) => {
      const computed = resolveComputedDateVar(name, now);
      if (computed !== undefined) return computed;
      if (!(name in bindings)) {
        throw new Error(`Unbound template variable {{${name}}}`);
      }
      const v = bindings[name];
      return typeof v === "string" ? v : JSON.stringify(v);
    });
  }
  if (Array.isArray(value)) {
    return value.map((v) => fillTemplate(v, bindings, now));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = fillTemplate(v, bindings, now);
    }
    return out;
  }
  return value;
}

/** Produce the filled action for every step without executing anything. */
export function dryRunSkill(skill: Skill, vars: Record<string, string> = {}, now: number = Date.now()): DryRunStep[] {
  const bindings: Record<string, unknown> = { ...vars };
  return skill.steps.map((step) => {
    let args: unknown;
    try {
      args = fillTemplate(step.actionArgs, bindings, now);
    } catch (err) {
      args = `<error: ${(err as Error).message}>`;
    }
    return { n: step.n, title: step.title, tool: step.actionTool, args, effect: step.effect };
  });
}

function runRecordPath(cwd: string, skillName: string): string {
  return path.join(cwd, ".reelier", "runs", `${skillName}.jsonl`);
}

/**
 * Read a skill's `.reelier/runs/<name>.jsonl` run-record file, one
 * `RunRecord` per non-blank line, in file order. Shared by `reelier bench`
 * and `reelier push` (src/cli.ts, src/push.ts) so both read the exact same
 * way — a promoted-out duplicate would risk drifting silently.
 */
export async function readRunRecords(filePath: string): Promise<RunRecord[]> {
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

async function executeStep(
  step: Step,
  bindings: Record<string, unknown>,
  tools: Record<string, Tool>,
  ctx: ToolContext,
  now: number
): Promise<{ outcome: StepOutcome; ms: number; failures: string[]; observation?: Observation; binds: Record<string, unknown> }> {
  const started = Date.now();
  const failures: string[] = [];
  // Binds are collected into a step-local map and only merged into the
  // shared `bindings` map by the caller when this step's outcome ends up
  // "passed"/"unchecked" (deterministic success) — never on "failed", even
  // though some binds may have evaluated successfully before an assert (or
  // a later bind) failed. Otherwise a step that fails on an assert AFTER
  // extracting binds would pollute shared state with values from a run that
  // never actually held, and a later heal that patches to a *smaller* bind
  // set would leave the dropped bind's stale value lingering for later steps.
  const localBinds: Record<string, unknown> = {};

  const tool = tools[step.actionTool];
  if (!tool) {
    failures.push(`Unknown tool '${step.actionTool}'`);
    return { outcome: "failed", ms: Date.now() - started, failures, binds: localBinds };
  }

  if (step.effect === "destructive" && !ctx.allowDestructive) {
    let filledArgs: unknown;
    try {
      filledArgs = fillTemplate(step.actionArgs, bindings, now);
    } catch (err) {
      filledArgs = `<error: ${(err as Error).message}>`;
    }
    failures.push(
      `Refusing to execute destructive step without --yes. Filled action: ${step.actionTool} ${JSON.stringify(
        filledArgs
      )}`
    );
    return { outcome: "failed", ms: Date.now() - started, failures, binds: localBinds };
  }

  let filledArgs: unknown;
  try {
    filledArgs = fillTemplate(step.actionArgs, bindings, now);
  } catch (err) {
    failures.push(`Template fill failed: ${(err as Error).message}`);
    return { outcome: "failed", ms: Date.now() - started, failures, binds: localBinds };
  }

  let obs: Observation;
  try {
    obs = await tool.run(filledArgs, ctx);
  } catch (err) {
    failures.push(`Tool execution failed: ${(err as Error).message}`);
    return { outcome: "failed", ms: Date.now() - started, failures, binds: localBinds };
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
        localBinds[result.name] = result.value;
      }
    } catch (err) {
      failures.push(`Bind error on '${bindLine}': ${(err as Error).message}`);
    }
  }

  const ms = Date.now() - started;
  if (failures.length > 0) {
    return { outcome: "failed", ms, failures, observation: obs, binds: localBinds };
  }
  if (step.asserts.length === 0) {
    // Honest-success rule: zero assertions never counts as "passed".
    return { outcome: "unchecked", ms, failures, observation: obs, binds: localBinds };
  }
  return { outcome: "passed", ms, failures, observation: obs, binds: localBinds };
}

/** Re-evaluate a patched assert/bind set against a fixed observation. Never re-executes anything. */
function reEvaluatePatch(
  asserts: string[],
  binds: string[],
  obs: Observation
): { ok: boolean; failures: string[]; bindings: Record<string, unknown> } {
  const failures: string[] = [];
  const newBindings: Record<string, unknown> = {};
  for (const a of asserts) {
    try {
      const result = evalAssert(a, obs);
      if (!result.ok) failures.push(result.message);
    } catch (err) {
      failures.push(`patched assert error on '${a}': ${(err as Error).message}`);
    }
  }
  for (const b of binds) {
    try {
      const result = evalBind(b, obs);
      if (!result.ok) failures.push(result.message);
      else newBindings[result.name] = result.value;
    } catch (err) {
      failures.push(`patched bind error on '${b}': ${(err as Error).message}`);
    }
  }
  return { ok: failures.length === 0, failures, bindings: newBindings };
}

function addUsage(
  a: { inputTokens: number; outputTokens: number } | undefined,
  b: { inputTokens: number; outputTokens: number }
): { inputTokens: number; outputTokens: number } {
  return { inputTokens: (a?.inputTokens ?? 0) + b.inputTokens, outputTokens: (a?.outputTokens ?? 0) + b.outputTokens };
}

function level3Message(step: Step): string {
  return (
    `Step ${step.n} (${step.title}) diverged and its effect is 'destructive' — Level 2 auto-repair never ` +
    `re-runs a destructive step (that would be an unreviewed side-effecting re-execution). Fix the skill by ` +
    `hand (edit its action/asserts/binds), or handle this as a Level 3 manual recovery.`
  );
}

/**
 * Attempt to heal a diverged step via the escalation ladder. Returns the
 * (possibly updated) outcome/failures/level/llm-usage, and mutates
 * `bindings` in place on a successful heal (matching the deterministic
 * path's behavior). Writes back a successful heal to `skill`/`skillPath`.
 */
async function attemptEscalation(
  skill: Skill,
  step: Step,
  observation: Observation,
  initialFailures: string[],
  bindings: Record<string, unknown>,
  tools: Record<string, Tool>,
  toolCtx: ToolContext,
  options: RunOptions,
  now: number
): Promise<{
  outcome: StepOutcome;
  level: 0 | 1 | 2;
  failures: string[];
  llm?: { inputTokens: number; outputTokens: number };
  /** Highest level TRIED, present iff escalation was actually attempted (i.e. L1 was invoked). */
  escalationAttempted?: 1 | 2;
}> {
  const maxLevel = options.maxLevel ?? 0;
  if (maxLevel < 1 || !options.llm) {
    return { outcome: "failed", level: 0, failures: initialFailures };
  }

  let failures = initialFailures;
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  // L1 is always the first (and, at minimum, only) level tried once we get
  // this far — set it now so every return path below reports at least 1.
  let escalationAttempted: 1 | 2 = 1;

  const l1 = await resolveL1({
    step,
    observation,
    failures,
    llm: options.llm,
    model: options.llmModel ?? "claude-haiku-4-5-20251001",
  });
  usage = addUsage(usage, l1.usage);

  if (l1.verdict === "patch") {
    const reEval = reEvaluatePatch(l1.asserts, l1.binds, observation);
    if (reEval.ok) {
      Object.assign(bindings, reEval.bindings);
      if (options.skillPath) {
        await applyWritebackSafely({
          skillPath: options.skillPath,
          skill,
          stepN: step.n,
          level: 1,
          patch: { asserts: l1.asserts, binds: l1.binds },
          reason: l1.reason,
        });
      } else {
        console.error(
          `WARNING: Level 1 heal of step ${step.n} succeeded for this run, but no skill file path was given — nothing was written back. The same drift will escalate again next run.`
        );
      }
      const outcome: StepOutcome = l1.asserts.length === 0 ? "unchecked" : "passed";
      return { outcome, level: 1, failures: [], llm: usage, escalationAttempted };
    }
    failures = [...failures, ...reEval.failures.map((f) => `L1 patch didn't hold: ${f}`)];
  } else {
    failures = [...failures, `L1: ${l1.reason}`];
  }

  if (maxLevel < 2) {
    return { outcome: "failed", level: 0, failures, llm: usage, escalationAttempted };
  }

  if (step.effect === "destructive") {
    failures = [...failures, level3Message(step)];
    return { outcome: "failed", level: 0, failures, llm: usage, escalationAttempted };
  }

  escalationAttempted = 2;

  const l2 = await resolveL2({
    step,
    skillContext: { skillName: skill.name, bindings },
    observation,
    failures,
    llm: options.llm,
    model: options.llmL2Model ?? "claude-sonnet-5",
  });
  usage = addUsage(usage, l2.usage);

  if (l2.verdict !== "patch") {
    failures = [...failures, `L2: ${l2.reason}`];
    return { outcome: "failed", level: 0, failures, llm: usage, escalationAttempted };
  }

  let filledArgs: unknown;
  try {
    filledArgs = l2.args !== undefined ? fillTemplate(l2.args, bindings, now) : fillTemplate(step.actionArgs, bindings, now);
  } catch (err) {
    failures = [...failures, `L2 patched args template fill failed: ${(err as Error).message}`];
    return { outcome: "failed", level: 0, failures, llm: usage, escalationAttempted };
  }

  let obs2: Observation;
  try {
    obs2 = await tools[step.actionTool].run(filledArgs, toolCtx);
  } catch (err) {
    failures = [...failures, `L2 re-execution failed: ${(err as Error).message}`];
    return { outcome: "failed", level: 0, failures, llm: usage, escalationAttempted };
  }

  const reEval2 = reEvaluatePatch(l2.asserts, l2.binds, obs2);
  if (!reEval2.ok) {
    failures = [...failures, ...reEval2.failures.map((f) => `L2 patch didn't hold: ${f}`)];
    return { outcome: "failed", level: 0, failures, llm: usage, escalationAttempted };
  }

  Object.assign(bindings, reEval2.bindings);
  if (options.skillPath) {
    await applyWritebackSafely({
      skillPath: options.skillPath,
      skill,
      stepN: step.n,
      level: 2,
      patch: { asserts: l2.asserts, binds: l2.binds, args: l2.args },
      reason: l2.reason,
    });
  } else {
    console.error(
      `WARNING: Level 2 heal of step ${step.n} succeeded for this run, but no skill file path was given — nothing was written back. The same drift will escalate again next run.`
    );
  }
  const outcome: StepOutcome = l2.asserts.length === 0 ? "unchecked" : "passed";
  return { outcome, level: 2, failures: [], llm: usage, escalationAttempted };
}

/** Run a skill's steps in order. Stops (marks remaining steps "skipped") on the first divergence. */
export async function runSkill(skill: Skill, options: RunOptions = {}): Promise<RunRecord> {
  const cwd = options.cwd ?? process.cwd();
  const tools = options.tools ?? builtinTools;
  const toolCtx: ToolContext = { allowDestructive: options.allowDestructive ?? false };
  const bindings: Record<string, unknown> = { ...(options.vars ?? {}) };
  // A single snapshot for the whole run — every fillTemplate call inside this
  // run shares it, so {{today}}/{{today±Nd}} can never resolve to a
  // different calendar day mid-run (e.g. across a UTC midnight boundary).
  const now = Date.now();

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

    const started = Date.now();
    const exec = await executeStep(step, bindings, tools, toolCtx, now);
    let outcome = exec.outcome;
    let failures = exec.failures;
    let level: 0 | 1 | 2 = 0;
    let llmUsage: { inputTokens: number; outputTokens: number } | undefined;
    let escalationAttempted: 0 | 1 | 2 | undefined;

    if (outcome === "passed" || outcome === "unchecked") {
      // Deterministic success: merge this step's binds into shared state.
      // Never done for a "failed" outcome — see executeStep's comment on
      // why binds are collected step-local until the outcome is known.
      Object.assign(bindings, exec.binds);
    } else if (outcome === "failed" && exec.observation) {
      const escalated = await attemptEscalation(
        skill,
        step,
        exec.observation,
        failures,
        bindings,
        tools,
        toolCtx,
        options,
        now
      );
      outcome = escalated.outcome;
      level = escalated.level;
      failures = escalated.failures;
      llmUsage = escalated.llm;
      escalationAttempted = escalated.escalationAttempted;
    }

    const ms = Date.now() - started;
    const rec: StepRecord = {
      n: step.n,
      title: step.title,
      level,
      outcome,
      ms,
      failures,
      ...(llmUsage ? { llm: llmUsage } : {}),
      ...(escalationAttempted !== undefined ? { escalationAttempted } : {}),
    };
    stepRecords.push(rec);
    options.onStep?.(rec, { tool: step.actionTool, args: step.actionArgs });

    if (outcome === "failed") {
      diverged = true;
    }
  }

  const finishedAt = new Date().toISOString();
  const passedCount = stepRecords.filter((s) => s.outcome === "passed").length;
  const uncheckedCount = stepRecords.filter((s) => s.outcome === "unchecked").length;
  const skippedCount = stepRecords.filter((s) => s.outcome === "skipped").length;
  const failedCount = stepRecords.filter((s) => s.outcome === "failed").length;
  const totalMs = stepRecords.reduce((sum, s) => sum + s.ms, 0);
  const llmInputTokens = stepRecords.reduce((sum, s) => sum + (s.llm?.inputTokens ?? 0), 0);
  const llmOutputTokens = stepRecords.reduce((sum, s) => sum + (s.llm?.outputTokens ?? 0), 0);

  const record: RunRecord = {
    skill: skill.name,
    startedAt,
    finishedAt,
    passed: failedCount === 0,
    steps: stepRecords,
    totals: {
      steps: stepRecords.length,
      passed: passedCount,
      unchecked: uncheckedCount,
      skipped: skippedCount,
      failed: failedCount,
      ms: totalMs,
      llmInputTokens,
      llmOutputTokens,
    },
  };

  if (!options.dryRun) {
    const filePath = runRecordPath(cwd, skill.name);
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, JSON.stringify(record) + "\n", "utf8");
  }

  return record;
}
