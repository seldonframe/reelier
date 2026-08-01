// Read-only pretty-printer for a Reelier trace (.jsonl). For humans, and for
// hand-writing skills from traces until the compiler exists.

import type { TraceRecord } from "./recorder.js";

function summarize(value: unknown, maxLen = 80): string {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

/**
 * Normalize a legacy `meta.policyGap` into the superseding `meta.policy`
 * (docs/specs/policy-attestation-v1.md §3.1). Applied here, in the ONE
 * reader every trace consumer goes through (`reelier trace`, `compile`,
 * `from-session`), so nothing downstream has to know `policyGap` existed.
 *
 * The condition `policyGap` was set on is exactly the `failed` condition, so
 * the mapping is total. It carries NO digest: nothing hashed the file at
 * record time and re-deriving one now is impossible — the file has moved on,
 * or is gone. A missing digest on a `failed` record therefore does not mean
 * "no file was found"; `absent` is the state that means that.
 *
 * A record carrying BOTH fields prefers `policy` — a writer emits one or the
 * other, never the pair, so seeing both means the `policyGap` is stale.
 * This is a READ-side normalization only: its output is never written into a
 * skill, because a skill carries no policy field at all (§3).
 */
function normalizeLegacyPolicy(rec: TraceRecord): TraceRecord {
  if (rec.t !== "meta") return rec;
  if (rec.policy || !rec.policyGap) return rec;
  return { ...rec, policy: { status: "failed" } };
}

export function parseTraceLines(source: string): TraceRecord[] {
  const records: TraceRecord[] = [];
  for (const raw of source.split(/\r\n|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    records.push(normalizeLegacyPolicy(JSON.parse(line) as TraceRecord));
  }
  return records;
}

/**
 * Render the four-state policy claim (docs/specs/policy-attestation-v1.md).
 * States the fact and stops. `verified` gets no celebratory marker — it
 * says a file was loaded and parsed, never that the run was safe — and
 * `absent` gets no alarm: most operators have no policy.yml, and that is a
 * legitimate configuration, not a deficiency. Overstating in the alarm
 * direction is the same sin as understating.
 */
function formatPolicyLines(policy: NonNullable<Extract<TraceRecord, { t: "meta" }>["policy"]>): string[] {
  const where = policy.sourcePath ? ` (${policy.sourcePath})` : "";
  const digest = policy.digest ? ` ${policy.digest.slice(0, "sha256:".length + 12)}…` : "";
  switch (policy.status) {
    case "verified": {
      const counts = policy.rules
        ? ` — ${policy.rules.deny} deny, ${policy.rules.dryRun} dry-run` +
          (policy.unmatchedRules !== undefined
            ? `; ${policy.unmatchedRules} of ${policy.rules.toolScoped} tool rule(s) matched no wrapped tool`
            : "")
        : "";
      return [`[meta] policy: verified${where}${digest}${counts}`];
    }
    case "failed":
      return [
        `[meta] policy: failed${where}${digest} — the file did not parse; enforcement degraded to deny-nothing for this session.`,
      ];
    case "unchecked":
      // Strictly weaker than `failed`, and never to be rendered as it: this
      // names an UNKNOWN seatbelt, not a known-dead one.
      return [`[meta] policy: unchecked${where} — the file exists and could not be read; its rules are unknown.`];
    case "absent":
      return [`[meta] policy: absent — no policy file at the project or global path.`];
  }
}

/** Format a parsed trace as human-readable lines (one entry per record, in file order). */
export function formatTrace(records: TraceRecord[]): string[] {
  const lines: string[] = [];
  for (const rec of records) {
    switch (rec.t) {
      case "meta":
        lines.push(`[meta] ${rec.name} started ${rec.startedAt} — wrapping: ${rec.wrapped.join(", ") || "(none)"}`);
        // A meta with no policy field predates the field entirely: render
        // nothing, so pre-policy traces print exactly as they always did.
        if (rec.policy) lines.push(...formatPolicyLines(rec.policy));
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
