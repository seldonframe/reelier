// Argument provenance over a RECORDED trace (spec: docs/specs/argument-provenance-v1.md).
//
// WHY THIS EXISTS RATHER THAN A STATEFUL WRAP. Spec §4.2 puts the live-proxy
// resolver behind a standing architectural change: the wrap would have to retain
// a response corpus for the life of a session. A trace already IS that corpus,
// already on disk, already ordered. Analysing it after the fact needs no
// retention, adds no record to the live path, and leaves `reelier mcp --wrap`
// byte-for-byte what it was.
//
// The honest cost of the trade, stated where an implementer will read it:
//   - It is AFTER the fact. It cannot hold a call, and v1 gates nothing anyway.
//   - It sees only what was recorded. Outside a `reelier_start_recording`
//     window there is no trace at all, which is spec §4.2 item 1 in a form
//     where the absence is self-evident rather than silent: no file, no claim.
//   - The trace is REDACTED (spec §4.2 item 2, src/redact.ts). Values that
//     passed through the redactor are not held, so they are gaps — never
//     absences, and never matches (see `REDACTION_MARKER` below).
//
// This module gates nothing and changes no exit code (spec §2, rule 4).

import type { TraceRecord } from "./recorder.js";
import {
  buildSourceIndex,
  addressableMcpResultBody,
  enumerateScalarLeaves,
  resolveArgs,
  type LeafResolution,
  type ProvenanceSource,
} from "./provenance.js";

/**
 * Both `redact()` marker forms share this prefix: a bare `«redacted»` for
 * `sk-`/`Bearer`-shaped and key-positioned secrets, and `«redacted:NAME»` for a
 * `REELIER_REDACT`-declared env value (src/redact.ts).
 *
 * Matching on the prefix covers both. A business value that genuinely contains
 * this text degrades to `unresolved`, which is the safe direction.
 */
const REDACTION_MARKER = "«redacted";

function isRedacted(value: unknown): boolean {
  return typeof value === "string" && value.includes(REDACTION_MARKER);
}

export interface CallProvenance {
  /** The call index this trace assigned — the join to its `t: "call"` record. */
  i: number;
  tool: string;
  resolutions: LeafResolution[];
}

export interface TraceProvenance {
  calls: CallProvenance[];
  /**
   * Counts per state. Counting is permitted on this surface; a RATIO is not —
   * a ratio is a score, and a score is what never-list #3 forbids gating on
   * (spec §2, rule 2).
   */
  counts: { grounded: number; authored: number; unresolved: number };
}

/**
 * The addressable value inside a recorded MCP result body, or `undefined` when
 * there is none.
 *
 * Mirrors the "exactly one text content item that parses" discipline
 * `extractBodyRefs` already applies (src/mcp-tool.ts) — and for the same stated
 * reason: the proxy sees tool results, not HTTP transport, so a multi-block body
 * yields nothing rather than a guess. On the replay path that concatenation is
 * exactly what defeats `json.<dotpath>` (src/mcp-tool.ts:61-74).
 *
 * Deliberately WIDER than `parseBodyRecord` (src/expect-mac.ts) in one respect:
 * a top-level ARRAY is addressable here, by index. That function screens arrays
 * because a projection addresses named body keys; this addresses leaves, and
 * dropping every array-returning API would manufacture gaps out of a shape
 * `enumerateScalarLeaves` handles natively. The fourth namespace has explicitly
 * different rules (spec §6) and this is one of them.
 */
/**
 * Replace every redacted scalar leaf with `null`, which `enumerateScalarLeaves`
 * does not address. NULLING rather than DELETING is load-bearing: deleting an
 * array element would renumber every later index, so the coordinates this
 * reports would name leaves that are not the ones it read.
 *
 * Returns whether anything was masked, because a source that was only partly
 * held is a gap — the run no longer has a complete source set, and `authored`
 * is unearned for that whole call (spec §5.3).
 */
function maskRedacted(value: unknown): { value: unknown; masked: boolean } {
  let masked = false;
  const walk = (v: unknown): unknown => {
    if (isRedacted(v)) {
      masked = true;
      return null;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  const next = walk(value);
  return { value: next, masked };
}

/** A result record usable as a source: it dispatched, it came back, and Reelier did not synthesize it. */
function isUsableSource(rec: Extract<TraceRecord, { t: "result" }>): boolean {
  // `denied` and `dryRun` bodies are Reelier's OWN text (src/recorder.ts:384-400).
  // Grounding an outbound value in the proxy's refusal or its dry-run stub would
  // make Reelier the origin of the value (spec §5.1).
  return rec.ok === true && rec.denied !== true && rec.dryRun !== true;
}

/**
 * Resolve every dispatched call's arguments against the responses that came back
 * BEFORE it.
 *
 * Strictly prior is the whole of it. A tool that echoes its input back would
 * otherwise retroactively ground every argument it was handed, which is the
 * self-grounding loop this check exists to make visible.
 *
 * Sources accumulate in file order, which IS the association (src/recorder.ts's
 * serialized write queue). The index is rebuilt per call rather than merged
 * incrementally: `buildSourceIndex` resolves ties with an exact-before-normalized
 * pass over ALL sources at once, and merging per-source would let an earlier
 * source's normalized key beat a later source's exact one — a different
 * coordinate for the same answer. This is an offline read over a file of tens of
 * calls; paying O(n²) hashes to keep one tie-break rule is the right trade, and
 * the fix if it ever bites is an incremental index carrying the same rule, not a
 * second rule.
 */
export function analyzeTrace(records: TraceRecord[]): TraceProvenance {
  const resultByCall = new Map<number, Extract<TraceRecord, { t: "result" }>>();
  const provenanceByCall = new Map<number, Extract<TraceRecord, { t: "prov" }>>();
  for (const rec of records) {
    if (rec.t === "result" && !resultByCall.has(rec.i)) resultByCall.set(rec.i, rec);
    if (rec.t === "prov" && !provenanceByCall.has(rec.i)) provenanceByCall.set(rec.i, rec);
  }

  const sources: ProvenanceSource[] = [];
  const gapNotes: string[] = [];
  const calls: CallProvenance[] = [];
  const counts = { grounded: 0, authored: 0, unresolved: 0 };

  for (const rec of records) {
    if (rec.t === "call") {
      const outcome = resultByCall.get(rec.i);
      // A call that was blocked or stubbed never went out, so it has no
      // arguments to account for — the same rule `write` and `attest` follow
      // (spec §8.2). Reporting one would describe a dispatch that never happened.
      if (outcome && !isUsableSource(outcome) && (outcome.denied === true || outcome.dryRun === true)) continue;

      const recorded = provenanceByCall.get(rec.i);
      if (recorded) {
        const resolutions: LeafResolution[] = [
          ...(recorded.resolved ?? []).map((row): LeafResolution => ({
            path: row.path,
            state: "grounded",
            via: row.via,
            from: { source: `#${row.from.call}`, at: row.from.at },
          })),
          ...(recorded.authored ?? []).map((path): LeafResolution => ({ path, state: "authored" })),
          ...(recorded.unresolved ?? []).map((row): LeafResolution => ({
            path: row.path,
            state: "unresolved",
            reason: row.reason,
          })),
        ];
        counts.grounded += (recorded.resolved?.length ?? 0) + (recorded.truncated?.resolved ?? 0);
        counts.authored += (recorded.authored?.length ?? 0) + (recorded.truncated?.authored ?? 0);
        counts.unresolved += (recorded.unresolved?.length ?? 0) + (recorded.truncated?.unresolved ?? 0);
        calls.push({ i: rec.i, tool: rec.tool, resolutions });
        continue;
      }

      const index = buildSourceIndex(sources);
      const corpusGap = gapNotes.length > 0 ? gapNotes.join("; ") : undefined;
      const resolutions = resolveArgs(rec.args, index, corpusGap ? { corpusGap } : {});

      // A redacted ARGUMENT is a value whose bytes this trace does not hold, so
      // nothing can be established about it either way. Overriding here rather
      // than inside the resolver keeps redaction — a property of the trace FILE
      // — out of the pure core.
      const leaves = new Map(enumerateScalarLeaves(rec.args, "args").map((l) => [l.path, l.value]));
      const final = resolutions.map((r): LeafResolution =>
        isRedacted(leaves.get(r.path)) ? { path: r.path, state: "unresolved", reason: "redacted-argument" } : r
      );

      for (const r of final) counts[r.state]++;
      calls.push({ i: rec.i, tool: rec.tool, resolutions: final });
      continue;
    }

    if (rec.t === "result") {
      if (!isUsableSource(rec)) {
        // Not a gap: a denied, dry-run or failed call is not a source that went
        // missing, it is not a source at all. Counting it as a gap would suppress
        // every honest `authored` in a run that hit one deny rule.
        continue;
      }
      const body = addressableMcpResultBody(rec.body);
      if (body === undefined) {
        sources.push({ kind: "response", id: `#${rec.i}`, value: undefined });
        continue;
      }
      const { value, masked } = maskRedacted(body);
      if (masked) gapNotes.push(`redacted-values: #${rec.i}`);
      sources.push({ kind: "response", id: `#${rec.i}`, value });
    }
  }

  return { calls, counts };
}

/**
 * Render an analysis for a human.
 *
 * [Normative, spec §2] Every word here is load-bearing and the bans are pinned
 * by `test/provenance-cli.test.ts`:
 *
 *  - NO VERDICT VOCABULARY. `authored` is the word. Not "fabricated", not
 *    "hallucinated", not "suspicious". An agent legitimately authors values all
 *    day, and — on a trace, which never saw the conversation — so does a person
 *    who spoke one out loud.
 *  - NO SCORE. Counts, never a ratio. A ratio invites a threshold, a threshold
 *    is a score, and never-list #3 forbids gating on one. The number is not
 *    computed rather than computed-and-hidden.
 *  - `unresolved` IS NEITHER A PASS NOR A FAIL (never-list #1). It prints as
 *    itself, with its reason, and gets no glyph either way.
 *  - The block states its own ceiling. Lineage is not correctness (§9.3), and a
 *    surface that omits that will be read as a pass.
 */
export function formatProvenance(analysis: TraceProvenance): string[] {
  const lines: string[] = [
    "provenance — where each outbound argument value came from",
    "  grounded    the value also appears in a response recorded earlier in this trace",
    "  authored    it does not. Many values are written rather than looked up, and a value",
    "              a person spoke is authored too — this trace never saw the conversation.",
    "  unresolved  neither was established; the reason is shown",
    "  This reports lineage, never correctness: a grounded value can still be the wrong one.",
  ];

  const width = Math.max(
    12,
    ...analysis.calls.flatMap((c) => c.resolutions.map((r) => r.path.length))
  );

  for (const call of analysis.calls) {
    lines.push("");
    lines.push(`[call #${call.i}] ${call.tool}`);
    if (call.resolutions.length === 0) {
      lines.push("  (no addressable values)");
      continue;
    }
    for (const r of call.resolutions) {
      const path = r.path.padEnd(width);
      if (r.state === "grounded") {
        const via = r.via === "normalized" ? " (normalized)" : "";
        lines.push(`  ${path}  grounded    ${r.from.source} ${r.from.at}${via}`);
      } else if (r.state === "authored") {
        lines.push(`  ${path}  authored`);
      } else {
        lines.push(`  ${path}  unresolved  ${r.reason}`);
      }
    }
  }

  const { grounded, authored, unresolved } = analysis.counts;
  const values = grounded + authored + unresolved;
  lines.push("");
  lines.push(
    `${analysis.calls.length} call(s), ${values} value(s): ` +
      `${grounded} grounded, ${authored} authored, ${unresolved} unresolved`
  );
  return lines;
}
