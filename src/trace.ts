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
        break;
      case "note":
        lines.push(`[note] ${rec.ts} — ${rec.text}`);
        break;
      case "call":
        lines.push(`[call #${rec.i}] ${rec.ts} — ${rec.tool} ${summarize(rec.args)}`);
        break;
      case "result":
        lines.push(`[result #${rec.i}] ${rec.ok ? "ok" : "ERROR"} (${rec.ms}ms) ${summarize(rec.body)}`);
        break;
      default: {
        const _exhaustive: never = rec;
        lines.push(`[unknown] ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
  return lines;
}
