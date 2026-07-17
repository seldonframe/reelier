// The escalation ladder's LLM-facing half: build a bounded prompt from a
// diverged step, call the (injected) LLM client, and strictly validate its
// response against the assert/bind grammar before ever letting it near the
// skill file. The model never writes the skill — it only ever emits a
// narrow JSON patch; src/writeback.ts applies it deterministically.
//
// L1 re-evaluates the SAME already-captured observation with patched
// asserts/binds (zero side effects by construction — no re-execution).
// L2 may additionally propose patched `args` for a single re-execution,
// but only ever gets asked for read | idempotent-write steps — the runner
// refuses to call resolveL2 at all for a destructive step (Level 3 territory,
// handled entirely by src/runner.ts before this module is involved).

import { AssertParseError, BindParseError, evalAssert, evalBind, type Observation } from "./assert.js";
import type { Step } from "./skill.js";
import type { LlmClient } from "./llm.js";
import { renderStepBlock } from "./writeback.js";

export interface EscalateUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface EscalatePatch {
  verdict: "patch";
  asserts: string[];
  binds: string[];
  reason: string;
  usage: EscalateUsage;
}

export interface EscalateRealFailure {
  verdict: "real-failure";
  reason: string;
  usage: EscalateUsage;
}

export type L1Result = EscalatePatch | EscalateRealFailure;

export interface L2Patch extends Omit<EscalatePatch, "verdict"> {
  verdict: "patch";
  /** Only present when the LLM proposed re-derived args for a single re-execution. */
  args?: unknown;
}

export type L2Result = L2Patch | EscalateRealFailure;

export interface SkillContext {
  skillName: string;
  /** Variables bound so far in this run — the only names a patched `args` template may reference. */
  bindings: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Bounded observation summary — never sends the full body or a full JSON
// dump, just enough for the model to spot a shape drift.
// ---------------------------------------------------------------------------

interface Leaf {
  path: string;
  value: unknown;
}

function flattenForSummary(value: unknown, prefix: string, out: Leaf[]): void {
  if (out.length >= 200) return; // hard cap: a huge body can't blow up the prompt
  if (value === null || typeof value !== "object") {
    if (prefix !== "") out.push({ path: prefix, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => flattenForSummary(v, prefix ? `${prefix}.${i}` : `${i}`, out));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    flattenForSummary(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

function summarizeScalar(value: unknown): string {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/** status, body truncated to ~2000 chars, and a truncated sample of json.<path> = <scalar> leaves. */
export function summarizeObservation(obs: Observation): string {
  const bodyTrunc =
    obs.body.length > 2000 ? `${obs.body.slice(0, 2000)}…(truncated, ${obs.body.length} chars total)` : obs.body;

  const lines = [`status: ${obs.status}`, `body (truncated to 2000 chars):`, bodyTrunc];

  try {
    const parsed: unknown = JSON.parse(obs.body);
    const leaves: Leaf[] = [];
    flattenForSummary(parsed, "", leaves);
    if (leaves.length > 0) {
      lines.push("json paths (sample, truncated):");
      for (const leaf of leaves.slice(0, 40)) {
        lines.push(`  json.${leaf.path} = ${summarizeScalar(leaf.value)}`);
      }
    }
  } catch {
    // Body isn't JSON — nothing to list, that's fine (body text above still stands).
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const GRAMMAR_REFERENCE = `Assert grammar (each line is exactly one of, no "- assert:" prefix):
  status == <int>
  status != <int>
  body contains "<text>"
  body not contains "<text>"
  json.<dotpath> is array
  json.<dotpath> is set
  json.<dotpath> length > <int>
  json.<dotpath> length < <int>
  json.<dotpath> == <json-scalar>
  json.<dotpath> != <json-scalar>
  json.<dotpath> > <json-scalar>
  json.<dotpath> < <json-scalar>

Bind grammar (each line is exactly one of, no "- bind:" prefix):
  <name> = json.<dotpath>
  <name> = body match /<regex>/   (first capture group)

Do not invent new assert/bind kinds. Every line you emit must match this grammar exactly, or it will be rejected and this escalation will be recorded as a real failure.`;

const L1_SYSTEM_PROMPT = `You are Reelier's Level-1 escalation resolver.

A recorded, deterministic replay step just diverged: its assertions and/or binds failed against the tool call's result. The tool call itself already ran and its result (the "observation" below) is fixed — you are NOT re-running anything, only re-reading the same observation with fresh eyes to see if the step's asserts/binds are just stale (e.g. a JSON field moved from json.id to json.data.id after an upstream API change).

Decide:
- If you can patch the step's assert/bind lines so they correctly describe THIS observation, return a "patch".
- If the observation shows a genuine failure (an error, missing data, wrong data) that no assert/bind rewrite can honestly paper over, return "real-failure".

${GRAMMAR_REFERENCE}

Respond with ONLY a raw JSON object (no prose, no markdown fences), one of:
  {"verdict":"patch","asserts":["..."],"binds":["..."],"reason":"one sentence"}
  {"verdict":"real-failure","reason":"one sentence"}`;

const L2_SYSTEM_PROMPT = `You are Reelier's Level-2 escalation resolver.

A recorded, deterministic replay step diverged and Level 1 (re-reading the existing observation) could not heal it. You are being asked because this step's effect is read or idempotent-write (never destructive — the harness already screened that out before calling you) and re-running it once is safe.

You may propose re-derived "args" for a single re-execution of this step's tool call, in addition to patched asserts/binds for the NEW observation that call will produce. Only use {{name}} placeholders for variable names already listed as "Currently bound variables" below — anything else will be rejected.

Decide:
- If a patched args + asserts/binds would plausibly make this step succeed, return a "patch" (args is optional — omit it if only asserts/binds need to change).
- If nothing you can propose would honestly fix it, return "real-failure".

${GRAMMAR_REFERENCE}

Respond with ONLY a raw JSON object (no prose, no markdown fences), one of:
  {"verdict":"patch","asserts":["..."],"binds":["..."],"args":{...},"reason":"one sentence"}
  {"verdict":"patch","asserts":["..."],"binds":["..."],"reason":"one sentence"}
  {"verdict":"real-failure","reason":"one sentence"}`;

function buildUserPrompt(step: Step, observation: Observation, failures: string[], skillContext?: SkillContext): string {
  const stepText = renderStepBlock(step).join("\n");
  const failureText = failures.length > 0 ? failures.map((f) => `- ${f}`).join("\n") : "(no failure messages recorded)";
  const obsText = summarizeObservation(observation);
  const boundText = skillContext
    ? `\n\nCurrently bound variables (usable as {{name}} in args): ${
        Object.keys(skillContext.bindings).join(", ") || "(none)"
      }`
    : "";
  return `Step as currently written:\n${stepText}\n\nDivergence (why replay failed):\n${failureText}\n\nObservation from the tool call that already ran:\n${obsText}${boundText}`;
}

// ---------------------------------------------------------------------------
// Strict response validation — reject anything that isn't cleanly
// expressible in the assert/bind grammar, rather than let a malformed patch
// anywhere near the skill file.
// ---------------------------------------------------------------------------

const NEUTRAL_OBS: Observation = { status: 0, headers: {}, body: "{}" };

/** Grammar-only check: does this line parse, independent of whether it'd evaluate true against real data? */
function validateAssertSyntax(line: string): string | null {
  try {
    evalAssert(line, NEUTRAL_OBS);
    return null;
  } catch (err) {
    if (err instanceof AssertParseError) return err.message;
    throw err;
  }
}

function validateBindSyntax(line: string): string | null {
  try {
    evalBind(line, NEUTRAL_OBS);
    return null;
  } catch (err) {
    if (err instanceof BindParseError) return err.message;
    throw err;
  }
}

interface ExtractedFields {
  asserts: string[];
  binds: string[];
  reason: string;
  args?: unknown;
  hasArgs: boolean;
}

/**
 * A skill file's assert/bind grammar is one expression per physical line —
 * that's the format's unit (src/skill.ts parses "- assert: <line>" as a
 * single bullet). An LLM-proposed line containing an embedded \n or \r would
 * split into multiple physical lines once written back by
 * serializeSkill/renderStepBlock, silently turning one assert into two (one
 * of them garbage) or, worse, injecting a bogus "### Step N" header that
 * bricks the file for every future parseSkill call. Reject defensively here
 * — layer 1 of 2 (layer 2 is the tightened `body contains` regex in
 * src/assert.ts, which never accepts an embedded newline from ANY caller,
 * not just the escalation ladder).
 */
function containsNewline(line: string): boolean {
  return line.includes("\n") || line.includes("\r");
}

function extractPatchFields(rec: Record<string, unknown>): { ok: true; fields: ExtractedFields } | { ok: false; error: string } {
  if (!Array.isArray(rec.asserts) || !rec.asserts.every((a) => typeof a === "string")) {
    return { ok: false, error: "patch.asserts must be a JSON array of strings" };
  }
  if (!Array.isArray(rec.binds) || !rec.binds.every((b) => typeof b === "string")) {
    return { ok: false, error: "patch.binds must be a JSON array of strings" };
  }
  const asserts = rec.asserts as string[];
  const binds = rec.binds as string[];
  for (const a of asserts) {
    if (containsNewline(a)) {
      return { ok: false, error: `patched assert ${JSON.stringify(a)} contains an embedded newline — one physical line per assert, no exceptions` };
    }
    const err = validateAssertSyntax(a);
    if (err) return { ok: false, error: `invalid patched assert ${JSON.stringify(a)}: ${err}` };
  }
  for (const b of binds) {
    if (containsNewline(b)) {
      return { ok: false, error: `patched bind ${JSON.stringify(b)} contains an embedded newline — one physical line per bind, no exceptions` };
    }
    const err = validateBindSyntax(b);
    if (err) return { ok: false, error: `invalid patched bind ${JSON.stringify(b)}: ${err}` };
  }
  const reason = typeof rec.reason === "string" && rec.reason.length > 0 ? rec.reason : "(no reason given)";
  const hasArgs = Object.prototype.hasOwnProperty.call(rec, "args") && rec.args !== undefined;
  return { ok: true, fields: { asserts, binds, reason, args: rec.args, hasArgs } };
}

/** First {{name}} in `value` (recursively, over string leaves) that isn't a key of `bindings`, or undefined if all are bound. */
function findUnboundTemplateVar(value: unknown, bindings: Record<string, unknown>): string | undefined {
  if (typeof value === "string") {
    const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(value))) {
      if (!(m[1] in bindings)) return m[1];
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findUnboundTemplateVar(v, bindings);
      if (hit) return hit;
    }
    return undefined;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const hit = findUnboundTemplateVar(v, bindings);
      if (hit) return hit;
    }
    return undefined;
  }
  return undefined;
}

function readVerdict(json: unknown, usage: EscalateUsage): { rec: Record<string, unknown> } | { fail: EscalateRealFailure } {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { fail: { verdict: "real-failure", reason: "LLM response was not a JSON object", usage } };
  }
  const rec = json as Record<string, unknown>;
  if (rec.verdict === "real-failure") {
    return {
      fail: {
        verdict: "real-failure",
        reason: typeof rec.reason === "string" && rec.reason.length > 0 ? rec.reason : "(no reason given)",
        usage,
      },
    };
  }
  if (rec.verdict !== "patch") {
    return {
      fail: { verdict: "real-failure", reason: `LLM response had an unrecognized verdict: ${JSON.stringify(rec.verdict)}`, usage },
    };
  }
  return { rec };
}

/**
 * A patch with `asserts: []` trivially "passes" re-evaluation (nothing to
 * check) and would downgrade a previously-checked step to permanently
 * unchecked while flipping the run green — a step that used to prove
 * something now proves nothing, silently, forever (write-back persists it).
 * Refuse that specific shape: an empty-asserts patch is only legitimate when
 * the step had no assertions before the heal either (a genuinely unchecked
 * step staying unchecked is fine).
 */
function assertionsWereStripped(step: Step, patchedAsserts: string[]): boolean {
  return step.asserts.length > 0 && patchedAsserts.length === 0;
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export interface ResolveL1Input {
  step: Step;
  /** The observation the diverged step's tool call already produced — re-read, never re-fetched. */
  observation: Observation;
  failures: string[];
  llm: LlmClient;
  model: string;
}

export async function resolveL1(input: ResolveL1Input): Promise<L1Result> {
  const { step, observation, failures, llm, model } = input;
  const { json, usage } = await llm.completeJson({
    model,
    system: L1_SYSTEM_PROMPT,
    user: buildUserPrompt(step, observation, failures),
    maxTokens: 1024,
  });

  const verdict = readVerdict(json, usage);
  if ("fail" in verdict) return verdict.fail;

  const extracted = extractPatchFields(verdict.rec);
  if (!extracted.ok) return { verdict: "real-failure", reason: extracted.error, usage };

  if (assertionsWereStripped(step, extracted.fields.asserts)) {
    return { verdict: "real-failure", reason: "heal removed all assertions — refusing", usage };
  }

  return {
    verdict: "patch",
    asserts: extracted.fields.asserts,
    binds: extracted.fields.binds,
    reason: extracted.fields.reason,
    usage,
  };
}

export interface ResolveL2Input {
  step: Step;
  skillContext: SkillContext;
  /** The observation from the most recent (failed) attempt at this step — used only to build the prompt, never re-evaluated directly (L2 re-executes and evaluates the NEW observation). */
  observation: Observation;
  failures: string[];
  llm: LlmClient;
  model: string;
}

export async function resolveL2(input: ResolveL2Input): Promise<L2Result> {
  const { step, skillContext, observation, failures, llm, model } = input;
  const { json, usage } = await llm.completeJson({
    model,
    system: L2_SYSTEM_PROMPT,
    user: buildUserPrompt(step, observation, failures, skillContext),
    maxTokens: 1536,
  });

  const verdict = readVerdict(json, usage);
  if ("fail" in verdict) return verdict.fail;

  const extracted = extractPatchFields(verdict.rec);
  if (!extracted.ok) return { verdict: "real-failure", reason: extracted.error, usage };

  if (assertionsWereStripped(step, extracted.fields.asserts)) {
    return { verdict: "real-failure", reason: "heal removed all assertions — refusing", usage };
  }

  let args: unknown;
  if (extracted.fields.hasArgs) {
    const argsVal = extracted.fields.args;
    if (typeof argsVal !== "object" || argsVal === null || Array.isArray(argsVal)) {
      return { verdict: "real-failure", reason: "patch.args must be a JSON object", usage };
    }
    const unbound = findUnboundTemplateVar(argsVal, skillContext.bindings);
    if (unbound) {
      return { verdict: "real-failure", reason: `patch.args references unbound template variable {{${unbound}}}`, usage };
    }
    args = argsVal;
  }

  return {
    verdict: "patch",
    asserts: extracted.fields.asserts,
    binds: extracted.fields.binds,
    args,
    reason: extracted.fields.reason,
    usage,
  };
}
