// Deterministic trace -> SKILL.md compiler. Zero LLM calls. Design
// principles (settled): minimal assertions (assert only on what downstream
// steps consume + basic success), honest gaps (steps we can't derive a
// meaningful assertion for stay assertion-less and get listed as an open
// question rather than papered over), review-before-save (caller decides
// whether to overwrite), conservative effect classes (an unrecognized verb
// defaults to `destructive` so a human reviews once).

import type { TraceRecord } from "./recorder.js";
import type { Effect } from "./skill.js";
import { mcpResultToObservation } from "./mcp-tool.js";
import type { McpCallResult } from "./mcp-client.js";
import { EFFECT_VERBS } from "./effect-verbs.js";

export interface OpenQuestion {
  /** The step this open question is attached to, or undefined for a trace-global note (e.g. a trailing unclaimed note). */
  stepN?: number;
  text: string;
}

export interface CompiledStep {
  n: number;
  title: string;
  intent: string;
  tool: string;
  /** Args with dataflow-recovered values replaced by {{name}} placeholders. */
  args: unknown;
  asserts: string[];
  binds: string[];
  effect: Effect;
}

export interface CompileResult {
  name: string;
  steps: CompiledStep[];
  openQuestions: OpenQuestion[];
  stats: {
    steps: number;
    asserts: number;
    binds: number;
    effects: Record<Effect, number>;
  };
}

// ---------------------------------------------------------------------------
// JSON tree walking helpers (shared shape for both scanning call args for
// dataflow candidates, and flattening prior result bodies to search against).
// ---------------------------------------------------------------------------

interface Leaf {
  path: string;
  value: unknown;
}

function flattenJson(value: unknown, prefix: string, out: Leaf[]): void {
  if (value === null || typeof value !== "object") {
    if (prefix !== "") out.push({ path: prefix, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => flattenJson(v, prefix ? `${prefix}.${i}` : `${i}`, out));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    flattenJson(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

/** A scalar arg value eligible for dataflow search: string len>=4, or a number whose decimal form is len>=4. */
function isCandidateScalar(value: unknown): value is string | number {
  if (typeof value === "string") return value.length >= 4;
  if (typeof value === "number") return String(value).length >= 4;
  return false;
}

function collectArgCandidates(value: unknown, prefix: string, out: Leaf[]): void {
  if (isCandidateScalar(value)) {
    if (prefix !== "") out.push({ path: prefix, value });
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectArgCandidates(v, prefix ? `${prefix}.${i}` : `${i}`, out));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    collectArgCandidates(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

/** Deep-clone `obj` and set the value at a dot-path (numeric segments index into arrays). */
function setAtPath(obj: unknown, dotpath: string, newValue: unknown): unknown {
  const parts = dotpath.split(".");
  function recur(node: unknown, idx: number): unknown {
    const key = parts[idx];
    const isLast = idx === parts.length - 1;
    if (Array.isArray(node)) {
      const i = Number(key);
      const copy = node.slice();
      copy[i] = isLast ? newValue : recur(copy[i], idx + 1);
      return copy;
    }
    const record = { ...(node as Record<string, unknown>) };
    record[key] = isLast ? newValue : recur(record[key], idx + 1);
    return record;
  }
  return recur(obj, 0);
}

function isArrayIndexedPath(dotpath: string): boolean {
  return dotpath.split(".").some((seg) => /^\d+$/.test(seg));
}

// ---------------------------------------------------------------------------
// Date-literal detection — flag (never auto-substitute) arg string literals
// shaped like an ISO date, and suggest the equivalent {{today±Nd}} computed
// var (runner.ts) with the concrete offset computed from the trace's own
// recording date (meta.startedAt). Substitution is left to a human: whether
// a recorded "2026-07-11" means "11 days before whenever this replays" or a
// genuinely fixed date is intent the trace alone can't settle.
// ---------------------------------------------------------------------------

interface IsoCalendarDate {
  y: number;
  m: number;
  d: number;
}

// Matches YYYY-MM-DD optionally followed by a time suffix (T...). Deliberately
// anchored start-to-end so it never partially matches inside a longer token
// (a version string like "1.2.3" has no dashes at all; a UUID's first
// hyphen-delimited group is 8 hex digits, not exactly 4 decimal digits, so
// it never reaches the month/day groups below).
const ISO_DATE_LITERAL_RE = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Parse a string as an ISO date literal, validating month/day are in range (rejects e.g. "2026-13-40"). */
function parseIsoDateLiteral(value: string): IsoCalendarDate | undefined {
  const m = value.match(ISO_DATE_LITERAL_RE);
  if (!m) return undefined;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return { y: Number(m[1]), m: month, d: day };
}

/** Whole-day difference `b - a`, both interpreted as UTC calendar dates. */
function daysBetweenUtc(a: IsoCalendarDate, b: IsoCalendarDate): number {
  const aMs = Date.UTC(a.y, a.m - 1, a.d);
  const bMs = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((bMs - aMs) / (24 * 60 * 60 * 1000));
}

/** Recursively collect every string leaf in a JSON-like structure (unlike collectArgCandidates, no length floor — a bare date is only 10 chars). */
function collectStringLeaves(value: unknown, prefix: string, out: Leaf[]): void {
  if (typeof value === "string") {
    if (prefix !== "") out.push({ path: prefix, value });
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectStringLeaves(v, prefix ? `${prefix}.${i}` : `${i}`, out));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    collectStringLeaves(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

/** Build the open-question text for one detected date literal. `diffDays` = literal's date minus the recording date. */
function dateLiteralOpenQuestion(dateStr: string, diffDays: number, recordingDateStr: string): string {
  if (diffDays === 0) {
    return (
      `literal date "${dateStr}" — if this means 'today at run time', replace with {{today}} ` +
      `(it resolved to today on the recording date ${recordingDateStr}); if it is a fixed date, keep it.`
    );
  }
  if (diffDays < 0 && -diffDays <= 365) {
    const n = -diffDays;
    return (
      `literal date "${dateStr}" — if this means '${n} days before run time', replace with {{today-${n}d}} ` +
      `(it resolved to that offset on the recording date ${recordingDateStr}); if it is a fixed date, keep it.`
    );
  }
  if (diffDays > 0 && diffDays <= 365) {
    return (
      `literal date "${dateStr}" — if this means '${diffDays} days after run time', replace with {{today+${diffDays}d}} ` +
      `(it resolved to that offset on the recording date ${recordingDateStr}); if it is a fixed date, keep it.`
    );
  }
  return (
    `literal date "${dateStr}" is more than 365 days from the recording date ${recordingDateStr} — ` +
    `no {{today±Nd}} computed form applies (max offset is 365 days); if it's meant to be relative to run ` +
    `time you'll need to handle it by hand, otherwise it's likely a genuinely fixed date.`
  );
}

// Id / timestamp literals — same "flag, never auto-substitute" discipline as
// ISO dates: a UUID or a Unix-epoch-shaped number in a recorded arg is often a
// per-run identity (session/job/user id) or a "now" that gets frozen on replay.
const UUID_LITERAL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A digit-only string in a plausible Unix-epoch range: seconds (~2001–2038) or milliseconds. */
function unixTimestampKind(s: string): "seconds" | "milliseconds" | undefined {
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  if (s.length === 10 && n >= 1_000_000_000 && n <= 2_147_483_647) return "seconds";
  if (s.length === 13 && n >= 1_000_000_000_000 && n <= 2_147_483_647_000) return "milliseconds";
  return undefined;
}

/** Open-question text for an id/timestamp-shaped literal, or undefined if it's neither. */
function idOrTimestampOpenQuestion(value: string): string | undefined {
  if (UUID_LITERAL_RE.test(value)) {
    return (
      `literal id "${value}" looks like a UUID — if it identifies a record that changes each run ` +
      `(a session, job, or user id), make it a {{variable}} passed at run time; if it's a stable constant, keep it.`
    );
  }
  const ts = unixTimestampKind(value);
  if (ts) {
    return (
      `literal "${value}" looks like a Unix timestamp (${ts}) — if it means 'now' or a run-relative time it will ` +
      `be frozen on replay; make it a {{variable}} (or a computed date) if it should move, else keep it.`
    );
  }
  return undefined;
}

function sanitizeIdentifier(raw: string): string {
  let out = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  if (!/^[a-zA-Z_]/.test(out)) out = `v_${out}`;
  return out;
}

// ---------------------------------------------------------------------------
// Effect classification
// ---------------------------------------------------------------------------

const READ_VERBS = new Set<string>(EFFECT_VERBS.read);
const DESTRUCTIVE_VERBS = new Set<string>(EFFECT_VERBS.destructive);
const IDEMPOTENT_VERBS = new Set<string>(EFFECT_VERBS["idempotent-write"]);

/** Strip MCP-server namespace prefixes (double-underscore groups, e.g.
 *  `composio__`) so `composio__GMAIL_FETCH_EMAILS` classifies like
 *  `GMAIL_FETCH_EMAILS`. Dot namespaces keep their last segment as before. */
function normalizeToolName(tool: string): string {
  const lastSegment = tool.split(".").pop() ?? tool;
  return lastSegment.replace(/^(?:[A-Za-z0-9-]+__)+/, "");
}

/**
 * Token-based classification with destructive-wins precedence: ANY destructive
 * verb anywhere in the name forces `destructive` (so `search_and_purge` can
 * never classify read — position in the name carries no authority), then any
 * write verb, then read. No verb recognized → destructive + review flag.
 */
export function classifyEffect(tool: string): { effect: Effect; unknown: boolean } {
  if (tool === "http.get") return { effect: "read", unknown: false };
  if (tool === "http.post") return { effect: "idempotent-write", unknown: false };

  const tokens = normalizeToolName(tool).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.some((t) => DESTRUCTIVE_VERBS.has(t))) return { effect: "destructive", unknown: false };
  if (tokens.some((t) => IDEMPOTENT_VERBS.has(t))) return { effect: "idempotent-write", unknown: false };
  if (tokens.some((t) => READ_VERBS.has(t))) return { effect: "read", unknown: false };
  return { effect: "destructive", unknown: true };
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

interface RawCall {
  i: number;
  tool: string;
  args: unknown;
  note?: string;
}

interface RawResult {
  ok: boolean;
  body: unknown;
}

/** Compile a parsed trace into a CompileResult. `name` is the trace's own meta name (falls back to "compiled"). */
export function compile(records: TraceRecord[]): CompileResult {
  let name = "compiled";
  let metaStartedAt: string | undefined;
  const calls: RawCall[] = [];
  const resultsByIndex = new Map<number, RawResult>();

  let pendingNotes: string[] = [];
  const globalOpenQuestions: OpenQuestion[] = [];

  for (const rec of records) {
    switch (rec.t) {
      case "meta":
        name = rec.name;
        metaStartedAt = rec.startedAt;
        break;
      case "note":
        pendingNotes.push(rec.text);
        break;
      case "call": {
        const note = pendingNotes.length > 0 ? pendingNotes.join("; ") : undefined;
        pendingNotes = [];
        calls.push({ i: rec.i, tool: rec.tool, args: rec.args, note });
        break;
      }
      case "result":
        resultsByIndex.set(rec.i, { ok: rec.ok, body: rec.body });
        break;
    }
  }

  if (pendingNotes.length > 0) {
    globalOpenQuestions.push({
      text: `A note was recorded with no call after it (${JSON.stringify(
        pendingNotes.join("; ")
      )}) — recording may have stopped early, or this note is stale.`,
    });
  }

  // Parsed JSON body of each call's result, most-recent-first search order is
  // handled by the caller (we just expose per-call-index lookups here).
  const parsedResultJson = new Map<number, unknown>();
  for (const call of calls) {
    const result = resultsByIndex.get(call.i);
    if (!result) continue;
    try {
      const obs = mcpResultToObservation(result.body as McpCallResult);
      parsedResultJson.set(call.i, JSON.parse(obs.body));
    } catch {
      // Not parseable JSON — this call's result simply isn't searchable as a dataflow source.
    }
  }

  // -- Dataflow recovery -----------------------------------------------------

  const bindRegistry = new Map<string, string>(); // `${sourceStepN}:${dotpath}` -> varName
  const usedNames = new Set<string>();
  const bindsByStep = new Map<number, string[]>(); // stepN -> `- bind: ...` lines (in first-seen order)
  const assertsByStep = new Map<number, string[]>(); // stepN -> `- assert: ...` lines from dataflow (json.<path> is set)
  const stepOpenQuestions = new Map<number, OpenQuestion[]>();
  const filledArgsByCall = new Map<number, unknown>();

  function addOpenQuestion(stepN: number, text: string): void {
    const list = stepOpenQuestions.get(stepN) ?? [];
    list.push({ stepN, text });
    stepOpenQuestions.set(stepN, list);
  }

  // Track literal (non-derived) candidate values across steps for the
  // "promote to input" suggestion (rule 6).
  const literalOccurrences = new Map<string, Set<number>>(); // JSON.stringify(value) -> step numbers

  for (const call of calls) {
    const stepN = call.i + 1;
    const candidates: Leaf[] = [];
    collectArgCandidates(call.args, "", candidates);

    let args = call.args;

    for (const candidate of candidates) {
      let matched: { sourceStepN: number; dotpath: string } | undefined;

      // Search prior results, most recent first.
      for (const priorCall of [...calls].filter((c) => c.i < call.i).sort((a, b) => b.i - a.i)) {
        const json = parsedResultJson.get(priorCall.i);
        if (json === undefined) continue;
        const leaves: Leaf[] = [];
        flattenJson(json, "", leaves);
        const hit = leaves.find((leaf) => leaf.value === candidate.value);
        if (hit) {
          matched = { sourceStepN: priorCall.i + 1, dotpath: hit.path };
          break;
        }
      }

      if (matched) {
        const key = `${matched.sourceStepN}:${matched.dotpath}`;
        let varName = bindRegistry.get(key);
        if (!varName) {
          const segments = matched.dotpath.split(".");
          const last = segments[segments.length - 1];
          const isNumeric = /^\d+$/.test(last);
          const base = sanitizeIdentifier(
            isNumeric && segments.length > 1 ? `${segments[segments.length - 2]}_${last}` : last
          );
          varName = base;
          let suffix = 2;
          while (usedNames.has(varName)) {
            varName = `${base}${suffix++}`;
          }
          usedNames.add(varName);
          bindRegistry.set(key, varName);

          const bindLines = bindsByStep.get(matched.sourceStepN) ?? [];
          bindLines.push(`bind: ${varName} = json.${matched.dotpath}`);
          bindsByStep.set(matched.sourceStepN, bindLines);

          const assertLines = assertsByStep.get(matched.sourceStepN) ?? [];
          assertLines.push(`assert: json.${matched.dotpath} is set`);
          assertsByStep.set(matched.sourceStepN, assertLines);

          if (isArrayIndexedPath(matched.dotpath)) {
            addOpenQuestion(
              matched.sourceStepN,
              `bind uses an index-based path 'json.${matched.dotpath}' — drifts if the array's order or contents change between runs.`
            );
          }
        }
        args = setAtPath(args, candidate.path, `{{${varName}}}`);
      } else {
        const key = JSON.stringify(candidate.value);
        const set = literalOccurrences.get(key) ?? new Set<number>();
        set.add(stepN);
        literalOccurrences.set(key, set);
      }
    }

    filledArgsByCall.set(call.i, args);
  }

  // -- Date-literal detection ------------------------------------------------
  // Scans the FINAL filled args (post dataflow-recovery), so a literal date
  // that was actually recovered as a bind reference above is already
  // {{varname}} by this point and never double-flagged here.

  const recordingDate = metaStartedAt ? parseIsoDateLiteral(metaStartedAt.slice(0, 10)) : undefined;
  if (recordingDate) {
    const recordingDateStr = metaStartedAt!.slice(0, 10);
    for (const call of calls) {
      const stepN = call.i + 1;
      const finalArgs = filledArgsByCall.get(call.i);
      const leaves: Leaf[] = [];
      collectStringLeaves(finalArgs, "", leaves);
      for (const leaf of leaves) {
        const literal = parseIsoDateLiteral(leaf.value as string);
        if (!literal) continue;
        const diffDays = daysBetweenUtc(recordingDate, literal);
        addOpenQuestion(stepN, dateLiteralOpenQuestion(leaf.value as string, diffDays, recordingDateStr));
      }
    }
  }

  // Id / timestamp literals — flagged regardless of the recording date (a UUID
  // needs no date context), same flag-never-substitute discipline as dates.
  for (const call of calls) {
    const stepN = call.i + 1;
    const finalArgs = filledArgsByCall.get(call.i);
    const leaves: Leaf[] = [];
    collectStringLeaves(finalArgs, "", leaves);
    for (const leaf of leaves) {
      const q = idOrTimestampOpenQuestion(leaf.value as string);
      if (q) addOpenQuestion(stepN, q);
    }
  }

  // -- Promote-to-input suggestions (rule 6) ---------------------------------

  for (const [key, stepSet] of literalOccurrences) {
    if (stepSet.size < 2) continue;
    const stepNs = [...stepSet].sort((a, b) => a - b);
    const value: unknown = JSON.parse(key);
    addOpenQuestion(
      stepNs[0],
      `Value ${JSON.stringify(value)} appears literally in steps ${stepNs.join(
        ", "
      )} and was never found in any prior result — consider promoting it to an {{input}} variable instead of repeating it.`
    );
  }

  // -- Assemble steps ---------------------------------------------------------

  const steps: CompiledStep[] = [];
  const effectCounts: Record<Effect, number> = { read: 0, "idempotent-write": 0, destructive: 0 };
  let assertCount = 0;
  let bindCount = 0;

  for (const call of calls) {
    const stepN = call.i + 1;
    const result = resultsByIndex.get(call.i);

    let title: string;
    let intent: string;
    if (call.note) {
      title = call.note;
      intent = call.note;
    } else {
      const argKeys =
        call.args && typeof call.args === "object" && !Array.isArray(call.args)
          ? Object.keys(call.args as Record<string, unknown>)
          : [];
      title = `Call ${call.tool}`;
      intent = `Calls ${call.tool} with ${argKeys.length > 0 ? argKeys.join(", ") : "no arguments"}.`;
      addOpenQuestion(stepN, "no narration — describe what this step is for.");
    }

    const asserts = [...(assertsByStep.get(stepN) ?? [])];
    const binds = [...(bindsByStep.get(stepN) ?? [])];

    if (!result) {
      addOpenQuestion(stepN, "no result was recorded for this call — recording may have stopped mid-call.");
    } else if (!result.ok) {
      addOpenQuestion(stepN, "this step failed during recording — decide whether it belongs in the skill.");
    } else {
      asserts.push("assert: status == 200");
    }

    const { effect, unknown } = classifyEffect(call.tool);
    if (unknown) {
      addOpenQuestion(stepN, "verb unrecognized — downgraded to destructive until you review.");
    }
    effectCounts[effect]++;
    assertCount += asserts.length;
    bindCount += binds.length;

    steps.push({
      n: stepN,
      title,
      intent,
      tool: call.tool,
      args: filledArgsByCall.get(call.i),
      asserts: asserts.map((a) => a.replace(/^assert:\s*/, "")),
      binds: binds.map((b) => b.replace(/^bind:\s*/, "")),
      effect,
    });
  }

  const openQuestions: OpenQuestion[] = [
    ...globalOpenQuestions,
    ...[...stepOpenQuestions.values()].flat(),
  ].sort((a, b) => (a.stepN ?? Infinity) - (b.stepN ?? Infinity));

  return {
    name,
    steps,
    openQuestions,
    stats: { steps: steps.length, asserts: assertCount, binds: bindCount, effects: effectCounts },
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Render a CompileResult as a SKILL.md source string. */
export function renderSkillMd(result: CompileResult, traceFileName: string): string {
  const date = isoDate();
  const lines: string[] = [];

  lines.push("---");
  lines.push(`name: ${result.name}`);
  lines.push(`description: Compiled from ${traceFileName} (${result.steps.length} calls) on ${date}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${result.name}`);
  lines.push("");
  lines.push("Inputs: none — every bound value below was recovered automatically from a prior step's result.");
  lines.push("");
  lines.push("## Steps");
  lines.push("");

  for (const step of result.steps) {
    lines.push(`### Step ${step.n} — ${step.title}`);
    lines.push(`- intent: ${step.intent}`);
    lines.push(`- action: ${step.tool} ${JSON.stringify(step.args)}`);
    for (const a of step.asserts) lines.push(`- assert: ${a}`);
    for (const b of step.binds) lines.push(`- bind: ${b}`);
    lines.push(`- effect: ${step.effect}`);
    lines.push("");
  }

  lines.push("## Open questions");
  lines.push("");
  if (result.openQuestions.length === 0) {
    lines.push("- (none)");
  } else {
    for (const oq of result.openQuestions) {
      const where = oq.stepN !== undefined ? `Step ${oq.stepN}` : "(trailing note)";
      lines.push(`- ${where}: ${oq.text}`);
    }
  }
  lines.push("");

  lines.push("## Changelog");
  lines.push("");
  lines.push(`- ${date} — compiled from ${traceFileName} (${result.steps.length} calls, ${result.steps.length} steps)`);
  lines.push("");

  return lines.join("\n");
}
