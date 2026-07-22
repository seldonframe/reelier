// Deterministic trace -> SKILL.md compiler. Zero LLM calls. Design
// principles (settled): minimal assertions (assert only on what downstream
// steps consume + basic success), honest gaps (steps we can't derive a
// meaningful assertion for stay assertion-less and get listed as an open
// question rather than papered over), review-before-save (caller decides
// whether to overwrite), conservative effect classes (an unrecognized verb
// defaults to `destructive` so a human reviews once).

import { readFileSync } from "node:fs";
import type { TraceRecord } from "./recorder.js";
import type { Effect } from "./skill.js";
import { mcpResultToObservation } from "./mcp-tool.js";
import type { McpCallResult } from "./mcp-client.js";
import { classifyEffect, type ToolEffectAnnotations } from "./effect-verbs.js";

/**
 * The installed reelier version, for the SKILL.md provenance frontmatter
 * (`recorded_with:`). Read once, synchronously (renderSkillMd itself is
 * sync and is called from several non-async call sites — see init.ts,
 * session.ts, cli.ts), the same file cli.ts's `--version` reads
 * (`../package.json` relative to src/), just via readFileSync instead of
 * the async readFile it uses.
 */
function readReelierVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

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

// Field names that commonly identify an array element. Data, not logic: used
// only to ORDER the field-match suggestion in the open question below — never
// to change what matches or to downgrade a flag.
const IDENTIFYING_FIELD_NAMES = ["id", "uuid", "key", "slug", "name", "email", "handle", "code", "title", "label"];

/** Value at a dot-path expressed as pre-split segments (numeric segments index into arrays). */
function valueAtPathSegments(node: unknown, parts: string[]): unknown {
  let cur = node;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = Array.isArray(cur) ? cur[Number(p)] : (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * Open-question text for a bind whose path traverses an array index — asks
 * whether the position is stable and, when the indexed element is an object
 * with scalar fields, suggests selecting by a field match instead (flag-only:
 * the bind itself stays exactly the recorded indexed path).
 */
function arrayIndexOpenQuestion(dotpath: string, sourceJson: unknown): string {
  const parts = dotpath.split(".");
  let lastNumericIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    if (/^\d+$/.test(parts[i])) lastNumericIdx = i;
  }
  const index = parts[lastNumericIdx];
  const element = valueAtPathSegments(sourceJson, parts.slice(0, lastNumericIdx + 1));
  let fieldKeys: string[] = [];
  if (element !== null && typeof element === "object" && !Array.isArray(element)) {
    const scalarKeys = Object.entries(element as Record<string, unknown>)
      .filter(([, v]) => v === null || typeof v !== "object")
      .map(([k]) => k);
    fieldKeys = [
      ...IDENTIFYING_FIELD_NAMES.filter((k) => scalarKeys.includes(k)),
      ...scalarKeys.filter((k) => !IDENTIFYING_FIELD_NAMES.includes(k)),
    ].slice(0, 3);
  }
  const selectBy =
    fieldKeys.length > 0
      ? `select it by a field match (e.g. the element whose ${fieldKeys.join("/")} matches)`
      : `select it by matching its value`;
  return (
    `bind uses an index-based path 'json.${dotpath}' — is element [${index}] positionally stable across runs, ` +
    `or should this ${selectBy}? Index-based binds drift if the array's order or contents change between runs.`
  );
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
  /** The literal's own "T..." time suffix, verbatim, when it had one (e.g. "T09:30:00Z"). */
  timeSuffix?: string;
}

// Matches YYYY-MM-DD optionally followed by a time suffix (T...). Deliberately
// anchored start-to-end so it never partially matches inside a longer token
// (a version string like "1.2.3" has no dashes at all; a UUID's first
// hyphen-delimited group is 8 hex digits, not exactly 4 decimal digits, so
// it never reaches the month/day groups below).
const ISO_DATE_LITERAL_RE = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Parse a string as an ISO date literal, validating the calendar date is REAL:
 * rejects out-of-range fields ("2026-13-40") and, via a Date.UTC round-trip,
 * roll-over dates like "2026-02-30" or a non-leap "2026-02-29" — Date.UTC
 * silently shifts those to March, and an offset suggestion computed from the
 * shifted date would be fabricated math, not the recorded literal's.
 */
function parseIsoDateLiteral(value: string): IsoCalendarDate | undefined {
  const m = value.match(ISO_DATE_LITERAL_RE);
  if (!m) return undefined;
  const y = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  // Round-trip: Date.UTC never errors on an impossible day, it rolls into the
  // next month (also maps years 0-99 to 1900+y) — any mismatch means the
  // literal isn't the calendar date it claims to be.
  const roundTrip = new Date(Date.UTC(y, month - 1, day));
  if (roundTrip.getUTCFullYear() !== y || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) {
    return undefined;
  }
  return { y, m: month, d: day, timeSuffix: m[4] || undefined };
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

/**
 * For a datetime literal carrying an explicit UTC offset, the UTC calendar
 * date (YYYY-MM-DD) when it differs from the date as written — e.g.
 * "2026-07-11T23:30:00-05:00" is 2026-07-12 in UTC. Returns undefined when
 * they agree, or when the literal has no time/offset to compare against.
 * {{today±Nd}} resolves as a UTC date (runner.ts), so this is exactly the
 * case where the suggested offset is ambiguous by one day.
 */
function utcCalendarDateIfDifferent(lit: IsoCalendarDate): string | undefined {
  if (!lit.timeSuffix) return undefined;
  const m = lit.timeSuffix.match(/^T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m || !m[4] || m[4] === "Z") return undefined; // no explicit non-UTC offset — the written date IS the UTC date
  const om = m[4].match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!om) return undefined;
  const offsetMinutes = (om[1] === "-" ? -1 : 1) * (Number(om[2]) * 60 + Number(om[3]));
  const utcMs = Date.UTC(lit.y, lit.m - 1, lit.d, Number(m[1]), Number(m[2]), Number(m[3] ?? "0")) - offsetMinutes * 60_000;
  const utcStr = new Date(utcMs).toISOString().slice(0, 10);
  const writtenStr = `${String(lit.y).padStart(4, "0")}-${String(lit.m).padStart(2, "0")}-${String(lit.d).padStart(2, "0")}`;
  return utcStr === writtenStr ? undefined : utcStr;
}

/** Build the open-question text for one detected date literal. `diffDays` = literal's date-as-written minus the recording date. */
function dateLiteralOpenQuestion(dateStr: string, lit: IsoCalendarDate, diffDays: number, recordingDateStr: string): string {
  // A datetime literal's time-of-day is NOT reproduced by {{today±Nd}} (the
  // runner resolves those to bare YYYY-MM-DD) — the honest suggestion is to
  // substitute only the date part and keep the recorded suffix verbatim.
  const replaceWith = (varForm: string): string =>
    lit.timeSuffix
      ? `replace the date part with {{${varForm}}} keeping the time suffix ("{{${varForm}}}${lit.timeSuffix}")`
      : `replace with {{${varForm}}}`;
  const utcDay = utcCalendarDateIfDifferent(lit);
  const utcNote = utcDay
    ? ` Note: its UTC offset places it on a different UTC calendar day (${utcDay}) — {{today}} forms resolve as UTC dates, so confirm which day is intended.`
    : "";
  if (diffDays === 0) {
    return (
      `literal date "${dateStr}" — if this means 'today at run time', ${replaceWith("today")} ` +
      `(it resolved to today on the recording date ${recordingDateStr}); if it is a fixed date, keep it.${utcNote}`
    );
  }
  if (diffDays < 0 && -diffDays <= 365) {
    const n = -diffDays;
    return (
      `literal date "${dateStr}" — if this means '${n} ${n === 1 ? "day" : "days"} before run time', ${replaceWith(`today-${n}d`)} ` +
      `(it resolved to that offset on the recording date ${recordingDateStr}); if it is a fixed date, keep it.${utcNote}`
    );
  }
  if (diffDays > 0 && diffDays <= 365) {
    return (
      `literal date "${dateStr}" — if this means '${diffDays} ${diffDays === 1 ? "day" : "days"} after run time', ${replaceWith(`today+${diffDays}d`)} ` +
      `(it resolved to that offset on the recording date ${recordingDateStr}); if it is a fixed date, keep it.${utcNote}`
    );
  }
  return (
    `literal date "${dateStr}" is more than 365 days from the recording date ${recordingDateStr} — ` +
    `no {{today±Nd}} computed form applies (max offset is 365 days); if it's meant to be relative to run ` +
    `time you'll need to handle it by hand, otherwise it's likely a genuinely fixed date.`
  );
}

/** Open-question text for a string that matches the ISO date SHAPE but is not a real calendar date (e.g. "2026-02-30"). Honest flag, no fabricated offset math. */
function impossibleDateOpenQuestion(value: string): string {
  return (
    `literal "${value}" is date-shaped but not a real calendar date — if it's a mistyped date, fix it before ` +
    `this skill replays; if it's an id that merely looks like a date, keep it.`
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
// Effect classification — lives with its verb data in effect-verbs.ts
// (annotation trust ladder + token matching). Re-exported here so existing
// importers (session.ts, cli.ts, tests) keep one stable seam.
// ---------------------------------------------------------------------------

export { classifyEffect, type ToolEffectAnnotations };

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
  let metaToolAnnotations: Record<string, ToolEffectAnnotations> | undefined;
  const calls: RawCall[] = [];
  const resultsByIndex = new Map<number, RawResult>();

  let pendingNotes: string[] = [];
  const globalOpenQuestions: OpenQuestion[] = [];

  for (const rec of records) {
    switch (rec.t) {
      case "meta":
        name = rec.name;
        metaStartedAt = rec.startedAt;
        metaToolAnnotations = rec.toolAnnotations;
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
      let matched: { sourceStepN: number; dotpath: string; sourceJson: unknown } | undefined;

      // Search prior results, most recent first.
      for (const priorCall of [...calls].filter((c) => c.i < call.i).sort((a, b) => b.i - a.i)) {
        const json = parsedResultJson.get(priorCall.i);
        if (json === undefined) continue;
        const leaves: Leaf[] = [];
        flattenJson(json, "", leaves);
        const hit = leaves.find((leaf) => leaf.value === candidate.value);
        if (hit) {
          matched = { sourceStepN: priorCall.i + 1, dotpath: hit.path, sourceJson: json };
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
            addOpenQuestion(matched.sourceStepN, arrayIndexOpenQuestion(matched.dotpath, matched.sourceJson));
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

  // -- Param lints: date / id / timestamp literals ---------------------------
  // Scans the FINAL filled args (post dataflow-recovery), so a literal that
  // was actually recovered as a bind reference above is already {{varname}}
  // by this point and never double-flagged here. Flag-only, never substitute.
  // Date suggestions need meta.startedAt; id/timestamp lints don't (a UUID
  // needs no date context). The SAME literal repeated across 3+ steps
  // collapses into ONE consolidated open question on its first step instead
  // of per-step duplicates (the lint text depends only on the literal value +
  // recording date, so every occurrence would have said the same thing).

  const recordingDate = metaStartedAt ? parseIsoDateLiteral(metaStartedAt.slice(0, 10)) : undefined;
  const recordingDateStr = metaStartedAt?.slice(0, 10);

  const lintByLiteral = new Map<string, { steps: Set<number>; text: string }>();
  function recordLint(literal: string, stepN: number, text: string): void {
    const entry = lintByLiteral.get(literal);
    if (entry) {
      entry.steps.add(stepN);
      return;
    }
    lintByLiteral.set(literal, { steps: new Set([stepN]), text });
  }

  for (const call of calls) {
    const stepN = call.i + 1;
    const finalArgs = filledArgsByCall.get(call.i);
    const leaves: Leaf[] = [];
    collectStringLeaves(finalArgs, "", leaves);
    for (const leaf of leaves) {
      const value = leaf.value as string;
      if (ISO_DATE_LITERAL_RE.test(value)) {
        const literal = parseIsoDateLiteral(value);
        if (!literal) {
          // Date-SHAPED but not a real calendar date (e.g. "2026-02-30"):
          // computing an offset from the Date.UTC roll-over would be a lie —
          // flag the impossibility instead.
          recordLint(value, stepN, impossibleDateOpenQuestion(value));
        } else if (recordingDate && recordingDateStr) {
          const diffDays = daysBetweenUtc(recordingDate, literal);
          recordLint(value, stepN, dateLiteralOpenQuestion(value, literal, diffDays, recordingDateStr));
        }
        continue; // a date-shaped literal is never also a UUID/timestamp
      }
      const q = idOrTimestampOpenQuestion(value);
      if (q) recordLint(value, stepN, q);
    }
  }

  for (const { steps: lintSteps, text } of lintByLiteral.values()) {
    const stepNs = [...lintSteps].sort((a, b) => a - b);
    if (stepNs.length >= 3) {
      addOpenQuestion(stepNs[0], `${text} (appears in steps ${stepNs.join(", ")} — one variable?)`);
    } else {
      for (const s of stepNs) addOpenQuestion(s, text);
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

    const { effect, unknown } = classifyEffect(call.tool, metaToolAnnotations?.[call.tool]);
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

/**
 * Provenance for `reelier compile --from-skill`: the compiled skill carries
 * the source instruction skill's identity (name via CompileResult.name,
 * description verbatim here) while every step still comes from the recorded
 * trace alone — the provenance line + changelog say so explicitly.
 */
export interface FromSkillProvenance {
  /** Basename of the Agent-Skills instruction skill whose identity was carried over. */
  sourceFileName: string;
  /** The source skill's own description, carried verbatim into the compiled frontmatter. */
  description: string;
}

/** Render a CompileResult as a SKILL.md source string. */
export function renderSkillMd(result: CompileResult, traceFileName: string, fromSkill?: FromSkillProvenance): string {
  const date = isoDate();
  const lines: string[] = [];
  const provenance = fromSkill ? `${fromSkill.sourceFileName} + ${traceFileName}` : traceFileName;

  lines.push("---");
  lines.push(`name: ${result.name}`);
  lines.push(
    fromSkill
      ? `description: ${fromSkill.description}`
      : `description: Compiled from ${traceFileName} (${result.steps.length} calls) on ${date}`
  );
  lines.push(`recorded_with: reelier v${readReelierVersion()}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${result.name}`);
  lines.push("");
  if (fromSkill) {
    lines.push(
      `Compiled from ${fromSkill.sourceFileName} + ${traceFileName} — every step below comes from that recorded trace; none were generated from the instruction text.`
    );
    lines.push("");
  }
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
  lines.push(`- ${date} — compiled from ${provenance} (${result.steps.length} calls, ${result.steps.length} steps)`);
  lines.push("");

  lines.push(
    `_Recorded with [Reelier](https://reelier.com/?utm_source=skill-md) — replay: \`npx -y reelier run ${result.name}.skill.md\`_`
  );
  lines.push("");

  return lines.join("\n");
}
