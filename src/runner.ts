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
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import type { Skill, Step, StepAttestDecl } from "./skill.js";
import { evalAssert, evalBind, type Observation, type ObservationRef } from "./assert.js";
import { builtinTools, type Tool, type ToolContext } from "./tools.js";
// Re-exported from the "." package entry too (in addition to "./tools")
// purely for caller convenience — a consumer already importing RunOptions/
// runSkill from here shouldn't need a second import just for the builtin
// tool registry.
export { builtinTools };
import type { LlmClient } from "./llm.js";
import { resolveL1, resolveL2 } from "./escalate.js";
import { applyWritebackSafely } from "./writeback.js";
import { computeApprovalHash, computeIdempotencyKey } from "./approval.js";
import { digestSha256 } from "./canonical-json.js";

export type StepOutcome = "passed" | "failed" | "unchecked" | "skipped";

export interface StepWhy {
  /** Why this step diverged — the load-bearing failure, verbatim from the real assertion/tool result. Present on a failed step. Never fabricated. */
  trigger?: string;
  /** What an escalation changed to heal this step — from the real L1/L2 patch reason. Present on a healed step. */
  change?: string;
}

/**
 * The write receipt: present iff a write-effect (idempotent-write/destructive)
 * step actually dispatched its tool call — never for a refused/mocked step.
 * Spec: docs/specs/flight-recorder-v2.md §2.
 */
export interface StepWrite {
  /** computeIdempotencyKey(tool, tool.server ?? null, filledArgs) — per-run identity of this exact write. */
  idempotencyKey: string;
  /** true = executed via a matching Step.approve hash; false = executed via the legacy --allow-writes/--yes flags. */
  approved: boolean;
  /** Best-effort, honestly-labeled extraction from the tool's JSON response body — absent when nothing was found. */
  resource?: { id?: string; version?: string };
  /** Set when an earlier step in THIS run wrote with the identical idempotencyKey — the step number of that earlier step. */
  duplicateOf?: number;
}

export interface AttestState {
  hash: string;
  at: string;
}

export interface StepAttest {
  method: "response-derived" | "declared-probe";
  /** The probe TOOL NAME only (e.g. "github.get_comment") — identifies which tool observed
   * the state. Never the args template: a record is a publishable artifact and the record
   * format carries no other tool args. */
  selector?: string;
  pre?: AttestState;
  post?: AttestState;
  delta?: { changed: number; fields?: string[] };
  confidence: "exact" | "partial" | "pending" | "absent";
  reason?: string;
}

export interface StepRecord {
  n: number;
  title: string;
  /** 0 = ran deterministically (or wasn't attempted); 1/2 = healed at that escalation level. */
  level: 0 | 1 | 2;
  outcome: StepOutcome;
  ms: number;
  failures: string[];
  /**
   * LLM token usage summed across every escalation attempt on this step
   * (incl. failed ones) — 0 attempts means this is absent, not zero.
   * `model` (added for the $ meter, src/cost.ts) is the model of the
   * HIGHEST escalation level actually invoked on this step (L2's model if
   * L2 ran, else L1's) — a known simplification: if a step tried L1 then
   * L2 with two different models, the summed tokens above are priced
   * entirely at the L2 rate by the cost meter. Rare in practice (most
   * steps resolve at whichever level they first reach) and never silently
   * wrong — just less precise than per-attempt model tracking would be.
   */
  llm?: { inputTokens: number; outputTokens: number; model?: string };
  /**
   * Highest escalation ladder level TRIED for this step — present whenever
   * escalation ran at all (success or failure), absent when it never ran
   * (either the step didn't diverge, or maxLevel was 0). Distinct from
   * `level`, which records only the level that HEALED it (0 if it never
   * healed, even after an escalation attempt).
   */
  escalationAttempted?: 0 | 1 | 2;
  /** Present only when this step drifted (trigger) or healed (change); absent for an unchanged step. Never fabricated — see docs/specs/receipt-why.md. */
  why?: StepWhy;
  /** Present iff this step's tool actually dispatched a write-effect call — see StepWrite. */
  write?: StepWrite;
  /** State attestation (consequence-layer §1) — present iff a write-effect step actually dispatched. Hashes over a field projection, never raw values. absent/pending are never a pass. */
  attest?: StepAttest;
  /**
   * Provider-issued request-id refs captured from this step's Observation
   * (trust-ladder spec §3) — extends the write receipt's honesty discipline
   * to EVERY executed step, not just writes: a read step's response can
   * carry a cross-checkable reference too. Omitted when the tool call
   * captured none (allowlist-only; never fabricated). Absent for a mocked
   * step (`--fail N`) — no real dispatch happened, nothing to capture.
   */
  refs?: ObservationRef[];
  /**
   * Set (true) iff this step's observation was a synthetic injected failure
   * (`--fail N[=status]`, docs/specs/flight-recorder-v2.md §3) rather than a
   * real tool dispatch. A mocked step never gets a `write` block — no tool
   * call happened, so there's nothing to receipt.
   */
  mocked?: true;
}

export interface RunRecord {
  skill: string;
  startedAt: string;
  finishedAt: string;
  passed: boolean;
  /**
   * sha256 (64 lowercase hex chars) of the exact skill-file bytes that
   * produced this run — stamped at RUN time by the caller (cmdRun/
   * compileReplayAndReceipt/runReplayTool all already hold the source they
   * just read to parse the skill), the most truthful moment to capture it.
   * Optional: absent when the caller didn't pass `skillContentSha256` (e.g.
   * a caller with no file on disk to hash). See push.ts's pushSkill for the
   * push-time fallback used on older records that predate this field.
   */
  skillContentSha256?: string;
  /**
   * Set (true) only when this run's manifest preflight was explicitly
   * bypassed via `--ignore-manifest` (docs/specs/flight-recorder-v2.md §1) —
   * the break-glass path. Absent on every run that had no manifest to check,
   * or whose manifest preflight ran normally, so pre-v2 records (and normal
   * v2 ones) stay byte-identical.
   */
  manifestIgnored?: true;
  /**
   * Sorted step numbers that had an injected failure this run (`--fail
   * N[=status]`, docs/specs/flight-recorder-v2.md §3) — present only when
   * `RunOptions.mockFailures` was non-empty. A mock run is a local recovery
   * test, never a real receipt: `reelier push` refuses to push a record that
   * carries this field (src/push.ts).
   */
  mockFailures?: number[];
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
  /** Permit `idempotent-write` steps to execute. Default false — replay is read-only. `allowDestructive` implies this. */
  allowWrites?: boolean;
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
  /** sha256 of the skill-file bytes the caller read to produce `skill` — stamped verbatim onto the resulting RunRecord. See RunRecord.skillContentSha256. */
  skillContentSha256?: string;
  /** Threaded verbatim onto RunRecord.manifestIgnored — set by the caller (cmdRun) when `--ignore-manifest` bypassed the manifest preflight. The runner itself never evaluates a manifest; this is purely a receipt annotation. */
  manifestIgnored?: boolean;
  /**
   * `--fail N[=status]` (docs/specs/flight-recorder-v2.md §3): step number ->
   * HTTP status to inject as a synthetic Observation instead of dispatching
   * that step's real tool call. The synthetic failure flows into the SAME
   * assert/bind evaluation and, on divergence, the SAME escalation ladder a
   * real failure would hit. Absent/empty = no injection, today's behavior.
   */
  mockFailures?: Record<number, number>;
  /** Declared-probe timeout in ms (consequence-layer §1.6). Default 2000. A probe that exceeds it degrades the attestation, never the step. */
  probeTimeoutMs?: number;
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

/**
 * Best-effort, honestly-labeled resource extraction from a write tool's
 * response body (docs/specs/flight-recorder-v2.md §2): `id` from
 * `body.id ?? body._id`, `version` from `body.version ?? body.etag ??
 * body.revision ?? body.sha` — each stringified only when the raw value is a
 * string or number (never guessed at from anything else). Returns undefined
 * (never `{}`) when the body isn't JSON, isn't an object, or has neither
 * field — a step never gets a fabricated resource.
 */
function extractResource(obs: Observation): { id?: string; version?: string } | undefined {
  let body: unknown;
  try {
    body = JSON.parse(obs.body);
  } catch {
    return undefined;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return undefined;
  const rec = body as Record<string, unknown>;
  const idRaw = rec.id ?? rec._id;
  const versionRaw = rec.version ?? rec.etag ?? rec.revision ?? rec.sha;
  const id = typeof idRaw === "string" || typeof idRaw === "number" ? String(idRaw) : undefined;
  const version = typeof versionRaw === "string" || typeof versionRaw === "number" ? String(versionRaw) : undefined;
  if (id === undefined && version === undefined) return undefined;
  return { ...(id !== undefined ? { id } : {}), ...(version !== undefined ? { version } : {}) };
}

/** Build the write receipt for a write-effect step whose tool call just dispatched. See StepWrite. */
function buildStepWrite(
  toolName: string,
  tool: Tool,
  filledArgs: unknown,
  obs: Observation,
  approved: boolean
): StepWrite {
  const idempotencyKey = computeIdempotencyKey(toolName, tool.server ?? null, filledArgs);
  const resource = extractResource(obs);
  return { idempotencyKey, approved, ...(resource ? { resource } : {}) };
}

/** Default projection field allowlists for response-derived attestation — identity/version class only, never content. Exported so tests fuzz the REAL lists instead of a copy that silently decays. */
export const ATTEST_BODY_FIELDS = ["id", "_id", "version", "etag", "revision", "sha", "updated_at", "node_id"] as const;
export const ATTEST_HEADER_FIELDS = ["etag", "last-modified"] as const;

/**
 * Project an Observation down to the fields that identify/version its
 * resource. With an explicit projection: those top-level body keys only.
 * Without: the conservative default allowlists above (body + headers).
 * Values are stringified for hashing and NEVER stored in any record.
 */
export function projectObservation(obs: Observation, projection?: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  let body: unknown;
  try { body = JSON.parse(obs.body); } catch { body = undefined; }
  const rec = body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
  if (projection) {
    if (rec) {
      for (const key of projection) {
        const v = rec[key];
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[`body.${key}`] = String(v);
      }
    }
    return out;
  }
  if (rec) {
    for (const key of ATTEST_BODY_FIELDS) {
      const v = rec[key];
      if (typeof v === "string" || typeof v === "number") out[`body.${key}`] = String(v);
    }
  }
  for (const key of ATTEST_HEADER_FIELDS) {
    const v = obs.headers[key];
    if (typeof v === "string" && v.length > 0) out[`header.${key}`] = v;
  }
  return out;
}

/**
 * A salted commitment over a field projection (final-review S3). A bare
 * sha256 over a low-entropy projection (a boolean, an enum, a small id) is
 * trivially preimage-reversible from a shared/pushed record, and the changed
 * field NAMES in `delta.fields` hand the attacker the dictionary. The salt is
 * per-attest, held in memory only, and NEVER recorded — pre and post for the
 * SAME attest share it, so within-record change detection (pre === post iff
 * the projection didn't change) survives, while cross-run hash joins are
 * deliberately sacrificed. A hash is not encryption; this makes it not
 * brute-forceable either.
 */
function newAttestSalt(): string {
  return randomBytes(16).toString("hex");
}

function saltedProjectionHash(projected: Record<string, string>, salt: string): string {
  return digestSha256({ projection: projected, salt });
}

/** Consequence-layer §1.3 `response-derived`: state derived from the write's own response. Ceiling `partial`; `absent` + reason when nothing derivable. Never fabricated. Hash is a salted commitment (see newAttestSalt). */
export function buildResponseDerivedAttest(obs: Observation): StepAttest {
  const projected = projectObservation(obs);
  if (Object.keys(projected).length === 0) {
    return { method: "response-derived", confidence: "absent", reason: "no-derivable-state" };
  }
  return {
    method: "response-derived",
    post: { hash: saltedProjectionHash(projected, newAttestSalt()), at: new Date().toISOString() },
    confidence: "partial",
  };
}

export const DEFAULT_PROBE_TIMEOUT_MS = 2000;

export type ProbeResult =
  | { ok: true; obs: Observation; projected: Record<string, string> }
  | { ok: false; reason: string };

/**
 * Run the declared paired read with a hard timeout. Failure DEGRADES
 * (returns a reason) — it must never fail or delay-fail the step
 * (consequence-layer §1.6). Exported for `reelier approve --probe`
 * (state-conditioned approval §4.2): probes dispatch in exactly two
 * contexts — at run time under a matched approval, and at approve time
 * interactively with literal args (I-13); this is the single code path
 * for both. The raw `obs` rides along so the state-conditioned paths can
 * compute their TYPE-TAGGED projection (src/expect-mac.ts) from the same
 * single observation that feeds the salted attest projection (I-4).
 */
export async function runProbe(
  decl: StepAttestDecl,
  tools: Record<string, Tool>,
  bindings: Record<string, unknown>,
  ctx: ToolContext,
  now: number,
  timeoutMs: number
): Promise<ProbeResult> {
  const probeTool = tools[decl.tool];
  if (!probeTool) return { ok: false, reason: `probe-tool-unknown: '${decl.tool}'` };
  if (probeTool.effect !== "read") {
    return { ok: false, reason: `probe-not-read: '${decl.tool}' has effect '${probeTool.effect}' — a probe must be a read` };
  }
  let filled: unknown;
  try {
    filled = fillTemplate(decl.args, bindings, now);
  } catch (err) {
    return { ok: false, reason: `probe-template: ${(err as Error).message}` };
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    const obs = await Promise.race([
      probeTool.run(filled, ctx),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`probe timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return { ok: true, obs, projected: projectObservation(obs, decl.projection) };
  } catch (err) {
    return { ok: false, reason: `probe-failed: ${(err as Error).message}` };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Changed projection-field NAMES between two captures — names only, never values. */
function computeDelta(pre: Record<string, string>, post: Record<string, string>): { changed: number; fields?: string[] } {
  const keys = [...new Set([...Object.keys(pre), ...Object.keys(post)])].sort();
  const fields = keys.filter((k) => pre[k] !== post[k]);
  return fields.length > 0 ? { changed: fields.length, fields } : { changed: 0 };
}

/** Evaluate a step's asserts/binds against `obs`, in place, into `failures`/`localBinds` (shared by the real-dispatch and mocked-dispatch paths in executeStep). */
function evaluateAssertsAndBinds(
  step: Step,
  obs: Observation,
  failures: string[],
  localBinds: Record<string, unknown>
): void {
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
}

async function executeStep(
  step: Step,
  bindings: Record<string, unknown>,
  tools: Record<string, Tool>,
  ctx: ToolContext,
  now: number,
  mockStatus?: number,
  probeTimeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS
): Promise<{
  outcome: StepOutcome;
  ms: number;
  failures: string[];
  observation?: Observation;
  binds: Record<string, unknown>;
  write?: StepWrite;
  attest?: StepAttest;
  mocked?: true;
}> {
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

  if (mockStatus !== undefined) {
    // Mocked-failure replay (`--fail N[=status]`, docs/specs/flight-recorder-v2.md
    // §3): a mocked step dispatches NOTHING — no tool call happens, so the
    // approval/write gates below are never reached (there's no side effect
    // to guard; you can recovery-test a write skill without --allow-writes).
    // The template is still filled — a template error is a real divergence
    // and must surface normally — then a synthetic Observation flows into
    // the SAME assert/bind evaluation and, on failure, the SAME escalation
    // ladder a real failure would hit.
    try {
      fillTemplate(step.actionArgs, bindings, now);
    } catch (err) {
      failures.push(`Template fill failed: ${(err as Error).message}`);
      return { outcome: "failed", ms: Date.now() - started, failures, binds: localBinds };
    }
    const obs: Observation = {
      status: mockStatus,
      headers: {},
      body: `reelier: injected failure (--fail ${step.n})`,
    };
    evaluateAssertsAndBinds(step, obs, failures, localBinds);

    const ms = Date.now() - started;
    if (failures.length > 0) {
      return { outcome: "failed", ms, failures, observation: obs, binds: localBinds, mocked: true };
    }
    if (step.asserts.length === 0) {
      return { outcome: "unchecked", ms, failures, observation: obs, binds: localBinds, mocked: true };
    }
    return { outcome: "passed", ms, failures, observation: obs, binds: localBinds, mocked: true };
  }

  // Read-only by default: a write step never re-fires on replay unless the
  // caller opts in. `read` steps (incl. POST-that-reads marked `effect: read`)
  // are never gated; this only holds back `idempotent-write`/`destructive`.
  // Falls back to the tool's intrinsic effect when the step didn't override one.
  const effectiveEffect = step.effect ?? tool.effect;
  const isWrite = effectiveEffect === "idempotent-write" || effectiveEffect === "destructive";

  if (isWrite) {
    if (step.approve !== undefined) {
      // Hash-bound approval (docs/specs/flight-recorder-v2.md §2) is the
      // FINAL boundary on a write step: a human stamped this hash (`reelier
      // approve`) against the step's exact tool+args template. If it still
      // matches, this executes with NO flag needed at all. If it doesn't —
      // the step drifted since it was approved — this fails closed and NO
      // flag (--allow-writes, --yes) can override that refusal.
      const expected = computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: step.expect });
      if (step.approve !== expected) {
        failures.push(
          `Approval mismatch on write step — the step's tool/args/attest changed since it was approved. ` +
            `Re-review and re-approve: reelier approve <skill.md>. (--allow-writes/--yes do NOT override an approval mismatch.)`
        );
        return { outcome: "failed", ms: Date.now() - started, failures, binds: localBinds };
      }
      // Hash matches: the human approved exactly this operation — execute, no flag needed.
    } else if (effectiveEffect === "destructive" && !ctx.allowDestructive) {
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
    } else if (effectiveEffect === "idempotent-write" && !ctx.allowWrites) {
      let filledArgs: unknown;
      try {
        filledArgs = fillTemplate(step.actionArgs, bindings, now);
      } catch (err) {
        filledArgs = `<error: ${(err as Error).message}>`;
      }
      failures.push(
        `Refusing to execute a write step (effect: idempotent-write) — replay is read-only by default. ` +
          `Pass --allow-writes to execute it. Filled action: ${step.actionTool} ${JSON.stringify(filledArgs)}`
      );
      return { outcome: "failed", ms: Date.now() - started, failures, binds: localBinds };
    }
  }

  let filledArgs: unknown;
  try {
    filledArgs = fillTemplate(step.actionArgs, bindings, now);
  } catch (err) {
    failures.push(`Template fill failed: ${(err as Error).message}`);
    return { outcome: "failed", ms: Date.now() - started, failures, binds: localBinds };
  }

  // A declared probe dispatches ONLY when this write executed via a matching
  // `approve:` hash (final-review S2): the approval hash binding of `attest:`
  // (src/approval.ts) is the sole defense against an unreviewed probe args
  // template exfiltrating live bindings through a probe URL, and it only
  // engages on the approve path. On the flag path (--allow-writes/--yes) the
  // probe never fires and the attest degrades honestly (see below). A
  // defined `step.approve` here is guaranteed to have MATCHED — a mismatch
  // returned above before any dispatch.
  const probeApproved = step.attest !== undefined && step.approve !== undefined;

  // Pre-probe (declared-probe attestation, consequence-layer §1.2): captured
  // strictly BEFORE dispatch or never. Runs only for write steps that
  // declared one — reads never probe, and a probe failure never gates the
  // write. The `pre` timestamp is captured HERE, the instant the pre-probe
  // actually resolves, never stamped later — that's the honesty rule.
  let preProbe: ProbeResult | undefined;
  let preAt: string | undefined;
  // ONE salt for this step's whole attest — pre and post commit with the same
  // salt so within-record equality semantics hold (see newAttestSalt).
  const attestSalt = newAttestSalt();
  if (isWrite && step.attest && probeApproved) {
    preProbe = await runProbe(step.attest, tools, bindings, ctx, now, probeTimeoutMs);
    preAt = new Date().toISOString();
  }

  let obs: Observation;
  try {
    obs = await tool.run(filledArgs, ctx);
  } catch (err) {
    failures.push(`Tool execution failed: ${(err as Error).message}`);
    // A throw AFTER dispatch is not "never dispatched" — the write-effect
    // call went out and its side effect may have landed server-side (e.g. a
    // response timeout after the server applied the write). If the pre-probe
    // already captured evidence, preserve it (final-review minor F4): a
    // one-sided attest, confidence "partial", reason "dispatch-failed" —
    // never silently drop the only state evidence for the incident.
    let throwAttest: StepAttest | undefined;
    if (isWrite && step.attest && probeApproved && preProbe !== undefined && preProbe.ok && Object.keys(preProbe.projected).length > 0) {
      throwAttest = {
        method: "declared-probe",
        selector: step.attest.tool,
        pre: { hash: saltedProjectionHash(preProbe.projected, attestSalt), at: preAt! },
        confidence: "partial",
        reason: "dispatch-failed",
      };
    }
    return { outcome: "failed", ms: Date.now() - started, failures, binds: localBinds, ...(throwAttest !== undefined ? { attest: throwAttest } : {}) };
  }

  // The write receipt reflects that the tool call actually dispatched — it's
  // stamped here, BEFORE assert evaluation, because the side effect already
  // happened regardless of whether the step's assertions later hold.
  const write = isWrite ? buildStepWrite(step.actionTool, tool, filledArgs, obs, step.approve !== undefined) : undefined;

  let attest: StepAttest | undefined;
  if (isWrite) {
    if (step.attest && probeApproved) {
      const postProbe = await runProbe(step.attest, tools, bindings, ctx, now, probeTimeoutMs);
      const postAt = new Date().toISOString();
      const selector = step.attest.tool;
      const preSide = preProbe && preProbe.ok && Object.keys(preProbe.projected).length > 0 ? preProbe.projected : undefined;
      const postSide = postProbe.ok && Object.keys(postProbe.projected).length > 0 ? postProbe.projected : undefined;
      const reasons = [
        preProbe && !preProbe.ok ? `pre: ${preProbe.reason}` : preSide === undefined ? "pre: empty-projection" : undefined,
        !postProbe.ok ? `post: ${postProbe.reason}` : postSide === undefined ? "post: empty-projection" : undefined,
      ].filter((r): r is string => r !== undefined);
      if (preSide && postSide) {
        attest = {
          method: "declared-probe",
          selector,
          pre: { hash: saltedProjectionHash(preSide, attestSalt), at: preAt! },
          post: { hash: saltedProjectionHash(postSide, attestSalt), at: postAt },
          delta: computeDelta(preSide, postSide),
          confidence: "exact",
        };
      } else if (preSide || postSide) {
        attest = {
          method: "declared-probe",
          selector,
          ...(preSide !== undefined ? { pre: { hash: saltedProjectionHash(preSide, attestSalt), at: preAt! } } : {}),
          ...(postSide !== undefined ? { post: { hash: saltedProjectionHash(postSide, attestSalt), at: postAt } } : {}),
          confidence: "partial",
          reason: reasons.join("; "),
        };
      } else {
        attest = { method: "declared-probe", selector, confidence: "absent", reason: reasons.join("; ") };
      }
    } else {
      attest = buildResponseDerivedAttest(obs);
      if (step.attest) {
        // A probe WAS declared but this write executed via the flag path
        // (--allow-writes/--yes), so no approval hash ever bound the probe's
        // args template — the probe was withheld (see probeApproved above)
        // and the attest honestly records why it degraded.
        const reason = "probe-requires-approval";
        attest = { ...attest, reason: attest.reason !== undefined ? `${attest.reason}; ${reason}` : reason };
      }
    }
  }

  evaluateAssertsAndBinds(step, obs, failures, localBinds);

  const ms = Date.now() - started;
  if (failures.length > 0) {
    return { outcome: "failed", ms, failures, observation: obs, binds: localBinds, write, attest };
  }
  if (step.asserts.length === 0) {
    // Honest-success rule: zero assertions never counts as "passed".
    return { outcome: "unchecked", ms, failures, observation: obs, binds: localBinds, write, attest };
  }
  return { outcome: "passed", ms, failures, observation: obs, binds: localBinds, write, attest };
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
 * L2 approval mismatch: the hash recomputed over the L2 candidate template
 * (tool/args/attest) no longer matches `step.approve`. Mirrors
 * level3Message's shape — spec §2: "patched args that leave the approved
 * template → the write is NOT re-executed at L2." Two distinct causes land
 * here: (1) the LLM's proposed args genuinely diverge from the approved
 * template, or (2) the approval is simply stale — the step's `tool:`,
 * `args:`, or `attest:` was edited by hand after `reelier approve` last ran,
 * so even an L2 candidate identical to the step's own (edited) template no
 * longer hashes to what was approved. Either way the write is NOT
 * re-executed; this message doesn't try to distinguish them, it just names
 * both possibilities and points at the fix.
 */
function l2ApprovalMismatchMessage(step: Step): string {
  return (
    `Approval mismatch on L2-patched write step ${step.n} (${step.title}) — either the LLM's proposed args leave ` +
    `the template a human approved, or the approval is stale because tool/args/attest was edited since it was ` +
    `last approved. Level 2 auto-repair never re-executes a write whose approval doesn't match. ` +
    `Re-review and re-approve: reelier approve <skill.md>. (The write was NOT re-executed.)`
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
  llm?: { inputTokens: number; outputTokens: number; model?: string };
  /** Highest level TRIED, present iff escalation was actually attempted (i.e. L1 was invoked). */
  escalationAttempted?: 1 | 2;
  /** What the heal changed, from the real patch reason — present only on a successful heal. */
  why?: StepWhy;
  /** Fresh write receipt from the L2 re-execution's real tool call — absent when only L1 ran (L1 never re-executes). */
  write?: StepWrite;
  /** Fresh refs from the L2 re-execution's real tool call — same "absent when only L1 ran" rule as `write`. */
  refs?: ObservationRef[];
  /** Fresh attest from the L2 re-execution's real tool call — same "absent when only L1 ran" rule as `write`. */
  attest?: StepAttest;
}> {
  const maxLevel = options.maxLevel ?? 0;
  if (maxLevel < 1 || !options.llm) {
    return { outcome: "failed", level: 0, failures: initialFailures };
  }

  let failures = initialFailures;
  let usage: { inputTokens: number; outputTokens: number; model?: string } | undefined;
  // L1 is always the first (and, at minimum, only) level tried once we get
  // this far — set it now so every return path below reports at least 1.
  let escalationAttempted: 1 | 2 = 1;

  const l1Model = options.llmModel ?? "claude-haiku-4-5-20251001";
  const l1 = await resolveL1({
    step,
    observation,
    failures,
    llm: options.llm,
    model: l1Model,
  });
  // `model` is stamped onto the running usage total after every stage so it
  // always reflects the HIGHEST level actually invoked (see StepRecord.llm's
  // doc comment) — L2's model overwrites L1's below if L2 runs.
  usage = { ...addUsage(usage, l1.usage), model: l1Model };

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
      return { outcome, level: 1, failures: [], llm: usage, escalationAttempted, why: { change: `L1: ${l1.reason}` } };
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

  const l2Model = options.llmL2Model ?? "claude-sonnet-5";
  const l2 = await resolveL2({
    step,
    skillContext: { skillName: skill.name, bindings },
    observation,
    failures,
    llm: options.llm,
    model: l2Model,
  });
  usage = { ...addUsage(usage, l2.usage), model: l2Model };

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

  const l2Tool = tools[step.actionTool];
  // Only relevant for a write-effect step; destructive never reaches L2
  // (checked above), so this is idempotent-write or read.
  const l2EffectiveEffect = step.effect ?? l2Tool.effect;
  const l2IsWrite = l2EffectiveEffect === "idempotent-write";

  if (l2IsWrite && step.approve !== undefined) {
    // Approval binds {tool, args: TEMPLATE} (src/approval.ts) — recompute it
    // over the L2 CANDIDATE template (l2.args if the LLM proposed new args,
    // else the step's own unchanged template) and require it to still match
    // what a human approved. This is the FINAL boundary extending to L2: no
    // flag overrides it, and a mismatch means the write is NEVER dispatched.
    const l2ArgsTemplate = l2.args !== undefined ? l2.args : step.actionArgs;
    // `attest` MUST be bound here exactly as cmdApprove stamped it — omitting
    // it computes the legacy hash and makes an approved+attested step
    // permanently un-healable at L2 with a fabricated mismatch reason
    // (final-review S1/S4). ApprovalHashInput makes omission a compile error.
    const l2ExpectedHash = computeApprovalHash({ actionTool: step.actionTool, actionArgs: l2ArgsTemplate, attest: step.attest, expect: step.expect });
    if (l2ExpectedHash !== step.approve) {
      failures = [...failures, l2ApprovalMismatchMessage(step)];
      return { outcome: "failed", level: 0, failures, llm: usage, escalationAttempted };
    }
    // Hash matches: the human's approval still covers whatever L2 is about to run.
  }

  let obs2: Observation;
  try {
    obs2 = await l2Tool.run(filledArgs, toolCtx);
  } catch (err) {
    failures = [...failures, `L2 re-execution failed: ${(err as Error).message}`];
    return { outcome: "failed", level: 0, failures, llm: usage, escalationAttempted };
  }

  // The re-execution's write receipt reflects the FRESH tool call (not the
  // original, now-stale one) — L2's whole point is that a new call just
  // happened. `approved` is truthful here: if step.approve was defined, the
  // gate above already proved it matched THIS exact candidate template
  // before dispatch — a mismatch never reaches this line.
  const l2Write = l2IsWrite ? buildStepWrite(step.actionTool, l2Tool, filledArgs, obs2, step.approve !== undefined) : undefined;
  const l2Attest = l2IsWrite ? buildResponseDerivedAttest(obs2) : undefined;

  const reEval2 = reEvaluatePatch(l2.asserts, l2.binds, obs2);
  if (!reEval2.ok) {
    failures = [...failures, ...reEval2.failures.map((f) => `L2 patch didn't hold: ${f}`)];
    return { outcome: "failed", level: 0, failures, llm: usage, escalationAttempted, write: l2Write, refs: obs2.refs, attest: l2Attest };
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
  return {
    outcome,
    level: 2,
    failures: [],
    llm: usage,
    escalationAttempted,
    why: { change: `L2: ${l2.reason}` },
    write: l2Write,
    refs: obs2.refs,
    attest: l2Attest,
  };
}

/** Run a skill's steps in order. Stops (marks remaining steps "skipped") on the first divergence. */
export async function runSkill(skill: Skill, options: RunOptions = {}): Promise<RunRecord> {
  const cwd = options.cwd ?? process.cwd();
  const tools = options.tools ?? builtinTools;
  const toolCtx: ToolContext = {
    allowDestructive: options.allowDestructive ?? false,
    // Allowing destructive implies allowing writes (destructive ⊃ write).
    allowWrites: (options.allowWrites ?? false) || (options.allowDestructive ?? false),
  };
  const bindings: Record<string, unknown> = { ...(options.vars ?? {}) };
  // A single snapshot for the whole run — every fillTemplate call inside this
  // run shares it, so {{today}}/{{today±Nd}} can never resolve to a
  // different calendar day mid-run (e.g. across a UTC midnight boundary).
  const now = Date.now();
  const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  const startedAt = new Date().toISOString();
  const stepRecords: StepRecord[] = [];
  let diverged = false;
  // Tracks the FIRST step number to write with a given idempotency key in
  // THIS run — a later step with the identical key is recorded (never
  // failed) as a duplicate of that first one.
  const writeKeySeen = new Map<string, number>();

  for (const step of skill.steps) {
    if (diverged) {
      const rec: StepRecord = { n: step.n, title: step.title, level: 0, outcome: "skipped", ms: 0, failures: [] };
      stepRecords.push(rec);
      options.onStep?.(rec, { tool: step.actionTool, args: step.actionArgs });
      continue;
    }

    const started = Date.now();
    const mockStatus = options.mockFailures?.[step.n];
    const exec = await executeStep(step, bindings, tools, toolCtx, now, mockStatus, probeTimeoutMs);
    let outcome = exec.outcome;
    let failures = exec.failures;
    let level: 0 | 1 | 2 = 0;
    let llmUsage: { inputTokens: number; outputTokens: number; model?: string } | undefined;
    let escalationAttempted: 0 | 1 | 2 | undefined;
    let why: StepWhy | undefined;
    let write = exec.write;
    let attest = exec.attest;
    // Extends the write receipt's discipline to EVERY executed step (spec
    // §3) — a read step's Observation can carry cross-checkable refs too.
    // `exec.observation` is set on every REAL (or mocked-synthetic) dispatch
    // path; a refused-write step never reaches a dispatch, so this is
    // naturally undefined there, exactly like `write`.
    let refs = exec.observation?.refs;
    // Register/dedupe the MAIN-PATH write's key immediately — BEFORE any
    // escalation runs. This matters when L2 later re-dispatches the same
    // step: without registering here first, a step that wrote twice (main
    // dispatch, then an L2 re-dispatch with the identical args) would have
    // its main-path write silently discarded (superseded by the fresh L2
    // one below) and the fact that TWO real writes happened in this run
    // would escape duplicate detection entirely (fr2-slice2-review.md #4).
    if (write) {
      const firstSeenAt = writeKeySeen.get(write.idempotencyKey);
      if (firstSeenAt !== undefined) {
        write = { ...write, duplicateOf: firstSeenAt };
      } else {
        writeKeySeen.set(write.idempotencyKey, step.n);
      }
    }
    // The load-bearing divergence, captured BEFORE escalation appends L1/L2 noise.
    const initialTrigger = exec.outcome === "failed" ? exec.failures[0] : undefined;

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
      if (outcome === "failed") why = { trigger: initialTrigger ?? failures[0] };
      else if (escalated.why) why = escalated.why;
      // L2's re-execution produces a FRESH write (a new tool call actually
      // happened) — it supersedes step 1's original, now-stale attempt for
      // THIS record. The main-path key was already registered above, so an
      // L2 re-dispatch with the IDENTICAL key (args unchanged) is honestly
      // flagged as a duplicate of that earlier attempt — even when "earlier"
      // means this very step, which really did write twice.
      if (escalated.write && !exec.mocked) {
        const firstSeenAt = writeKeySeen.get(escalated.write.idempotencyKey);
        write = firstSeenAt !== undefined ? { ...escalated.write, duplicateOf: firstSeenAt } : escalated.write;
        if (firstSeenAt === undefined) writeKeySeen.set(escalated.write.idempotencyKey, step.n);
      } else if (escalated.write) {
        write = escalated.write;
      }
      // Same "fresh L2 dispatch supersedes the stale main-path attempt"
      // reasoning as `write` above — L2 actually re-called the tool, so its
      // refs (if any) are what THIS record should reflect. `escalated.refs`
      // is only set when a real L2 dispatch happened (see attemptEscalation).
      if (escalated.refs !== undefined) refs = escalated.refs;
      // Same "fresh L2 dispatch supersedes the stale main-path attempt"
      // reasoning as `write`/`refs` above.
      if (escalated.attest !== undefined) attest = escalated.attest;
    }
    // A step that failed without an observation (tool threw) skips escalation —
    // still record why it diverged.
    if (outcome === "failed" && !why) why = { trigger: initialTrigger ?? failures[0] };

    // A mocked step (`--fail N`) never dispatched a real tool call, even if
    // its own escalation subsequently healed via a REAL L2 re-execution —
    // never receipt a write (or refs) on a step whose original attempt was
    // synthetic (and never let its key pollute the dup map above, either).
    if (exec.mocked) {
      write = undefined;
      refs = undefined;
      attest = undefined;
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
      ...(why ? { why } : {}),
      ...(write ? { write } : {}),
      ...(attest ? { attest } : {}),
      ...(refs && refs.length > 0 ? { refs } : {}),
      ...(exec.mocked ? { mocked: true as const } : {}),
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
  const mockFailureSteps = Object.keys(options.mockFailures ?? {})
    .map(Number)
    .sort((a, b) => a - b);

  const record: RunRecord = {
    skill: skill.name,
    startedAt,
    finishedAt,
    passed: failedCount === 0,
    ...(options.skillContentSha256 ? { skillContentSha256: options.skillContentSha256 } : {}),
    ...(options.manifestIgnored ? { manifestIgnored: true } : {}),
    ...(mockFailureSteps.length > 0 ? { mockFailures: mockFailureSteps } : {}),
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
