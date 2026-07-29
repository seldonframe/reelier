// Pure CLI-text formatter for a step's StepAttest (src/runner.ts). Mirrors
// reelier-cloud's src/lib/attest.ts attestSummaryText/stepAttestLine
// semantics (same honesty rules: absent/pending never read as a pass, exact
// is the only confidence that gets an unqualified summary), adapted for
// plain-text CLI output rather than a {text, className} span. Also renders
// the pre-state fact — the cloud's PublicStepAttest deliberately strips
// pre/post hashes for the public receipt (see reelier-cloud's attest.ts
// header comment), but the CLI is running against the operator's own
// terminal, not an unauthenticated share link, so showing the pre-state
// commitment here is not the same disclosure decision.
//
// No new claims beyond what StepAttest actually recorded: this file never
// says "verified", "safe", "drift detected", or "no drift" — see
// docs/specs/flight-recorder-v2.md and the never-list this mirrors.
import type { StepAttest } from "./runner.js";

/**
 * sha256:<64 hex> -> sha256:<first4>…<last4>. Anything that doesn't match
 * that shape (malformed/short/empty) is returned verbatim — never throws,
 * never fabricates a longer hash than what's actually there.
 */
export function abbreviateHash(hash: string): string {
  const m = /^(sha256:)([0-9a-f]{16,})$/.exec(hash);
  if (!m) return hash;
  const [, prefix, hex] = m;
  return `${prefix}${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

/**
 * One-line human summary of confidence — the exact same shape as the
 * cloud's attestSummaryText, but confidence-first, method-agnostic (the
 * method distinction is carried by whether a pre-state line follows, not by
 * this line itself):
 *   exact + delta   -> "state: exact — 2 fields changed (body.etag, body.updated_at)"
 *   exact, 0 change -> "state: exact — no observed change"
 *   partial+reason  -> "state: partial — dispatch-failed"
 *   absent, no reason -> "state: absent"
 * Never a pass color/word for partial/absent/pending — this is plain text,
 * so the honesty rule here is: never phrase absent/partial/pending as
 * though something was confirmed.
 */
export function attestSummaryLine(attest: StepAttest): string {
  const head = `state: ${attest.confidence}`;
  if (attest.confidence === "exact" && attest.delta) {
    if (attest.delta.changed === 0) return `${head} — no observed change`;
    const noun = attest.delta.changed === 1 ? "field" : "fields";
    const names = attest.delta.fields && attest.delta.fields.length > 0 ? ` (${attest.delta.fields.join(", ")})` : "";
    return `${head} — ${attest.delta.changed} ${noun} changed${names}`;
  }
  return attest.reason ? `${head} — ${attest.reason}` : head;
}

/**
 * The pre-state fact line — renders ONLY when method === "declared-probe"
 * AND a pre capture actually exists. A response-derived attest never has a
 * real pre-state observation (it only ever sees the post-write response
 * body), so rendering this line for it would fabricate a "before" that was
 * never observed. Returns undefined when there's nothing honest to say.
 */
export function preStateLine(attest: StepAttest): string | undefined {
  if (attest.method !== "declared-probe" || !attest.pre) return undefined;
  return `state before this write: captured ${attest.pre.at} · commitment ${abbreviateHash(attest.pre.hash)}`;
}

/**
 * Full ordered set of plain-text lines for a step's attest: the summary
 * line always first, then the pre-state fact line iff preStateLine()
 * returns one. The CLI (src/cli.ts onStep) prints each with its own indent
 * prefix — this function owns content and ordering only.
 */
export function renderAttestLines(attest: StepAttest): string[] {
  const lines = [attestSummaryLine(attest)];
  const pre = preStateLine(attest);
  if (pre) lines.push(pre);
  return lines;
}
