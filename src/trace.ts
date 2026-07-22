// Read-only pretty-printer for a Reelier trace (.jsonl). For humans, and for
// hand-writing skills from traces until the compiler exists.

import type { TraceRecord } from "./recorder.js";

function summarize(value: unknown, maxLen = 80): string {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

export function parseTraceLines(source: string): TraceRecord[] {
  const records: TraceRecord[] = [];
  for (const raw of source.split(/\r\n|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    records.push(JSON.parse(line) as TraceRecord);
  }
  return records;
}

/** Format a parsed trace as human-readable lines (one entry per record, in file order). */
export function formatTrace(records: TraceRecord[]): string[] {
  const lines: string[] = [];
  for (const rec of records) {
    switch (rec.t) {
      case "meta":
        lines.push(`[meta] ${rec.name} started ${rec.startedAt} — wrapping: ${rec.wrapped.join(", ") || "(none)"}`);
        if (rec.policyGap) {
          lines.push(`[meta] GAP: policy enforcement disabled this run — ${rec.policyGap}`);
        }
        break;
      case "note":
        lines.push(`[note] ${rec.ts} — ${rec.text}`);
        break;
      case "call":
        lines.push(`[call #${rec.i}] ${rec.ts} — ${rec.tool} ${summarize(rec.args)}`);
        break;
      case "result": {
        const tag = rec.denied ? "DENIED" : rec.dryRun ? "DRY-RUN" : rec.ok ? "ok" : "ERROR";
        const rule = rec.denied || rec.dryRun ? ` [policy: ${rec.rule}]` : "";
        lines.push(`[result #${rec.i}] ${tag} (${rec.ms}ms)${rule} ${summarize(rec.body)}`);
        break;
      }
      default: {
        const _exhaustive: never = rec;
        lines.push(`[unknown] ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
  return lines;
}
