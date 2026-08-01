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
import type { StepAttest, StepStateCheck } from "./runner.js";

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

/**
 * The probe→dispatch window in ms, or undefined when it can't be honestly
 * rendered: either timestamp missing, negative (clock skew), or absurd
 * (> 60 s — the window is an in-process gap between the probe resolving and
 * the dispatch being issued; anything beyond a minute is a clock artifact,
 * not a measurement). A14: the figure is OMITTED, never clamped, never
 * declared with a special string, never fabricated.
 */
function measuredWindowMs(observedAt: string | undefined, dispatchedAt: string | undefined): number | undefined {
  if (observedAt === undefined || dispatchedAt === undefined) return undefined;
  const w = Date.parse(dispatchedAt) - Date.parse(observedAt);
  if (Number.isNaN(w) || w < 0 || w > 60_000) return undefined;
  return w;
}

/**
 * CLI text for a step's state check (state-conditioned approval §5.4).
 * These strings are stable API — they become gate-event labels. The copy
 * law, test-pinned: match is a MUTED fact (no color, no symbol, never an
 * endorsement); mismatch is the recorder stamp (loud — the string is
 * sanctioned asymmetrically because it errs toward self-incrimination);
 * unevaluated is its own state, never either. Forbidden on this surface:
 * "verified", "safe", "no drift", "atomic", "guaranteed", and any
 * state-was-X-at-dispatch claim (only observations are claimable).
 */
export function renderStateCheckLines(check: StepStateCheck, dispatchedAt: string | undefined): string[] {
  if (check.outcome === "match") {
    const w = measuredWindowMs(check.observedAt, dispatchedAt);
    const windowPart = w !== undefined ? ` · window ${w} ms` : "";
    return [`pre-state check: match (approved ${check.expectedAt} · observed ${check.observedAt}${windowPart})`];
  }
  if (check.outcome === "mismatch") {
    // Gate mode (S8): a REFUSED mismatch must never wear the recorder's
    // "executed against …" stamp — nothing executed. The diagnosis lines
    // (changed/absent) are observations and render either way.
    const lines =
      check.action === "refused"
        ? [`pre-state check: mismatch — write refused before dispatch (approved ${check.expectedAt} · observed ${check.observedAt})`]
        : [
            "⚠ executed against state that differs from the state this approval was granted against —",
            `  pre-state commitment mismatch (approved ${check.expectedAt} · observed ${check.observedAt})`,
          ];
    if (check.changedFields && check.changedFields.length > 0) {
      // P1.5: an EARNED approve-time claim — per-field MAC inequality under
      // the held key proves the committed value differs (names only).
      lines.push(`  fields changed since approval: ${check.changedFields.join(", ")}`);
    }
    if (check.absentFields && check.absentFields.length > 0) {
      lines.push(`  declared fields absent at execute: ${check.absentFields.join(", ")}`);
    }
    return lines;
  }
  // `reason` is always present on a runner-produced unevaluated check; the
  // fallback marks a malformed/hand-crafted record and is deliberately NOT
  // registry-shaped (the reason registry is closed — never mint a label).
  const uneval = `pre-state check: not evaluated — ${check.reason ?? "(no reason recorded — malformed record)"}`;
  // Gate mode (S8): an opted-in repo refuses on unevaluated too (revocation
  // means fail-closed) — say so, muted, without minting a new reason label.
  return [check.action === "refused" ? `${uneval} — write refused (state gate)` : uneval];
}

/**
 * Mismatches — stamped (recorder) OR refused (gate mode, S8): both observed
 * the same fact about the world, and a refusal must never erase the evidence
 * that produced it. Match is not a finding (it's a fact).
 *
 * `unevaluated` is generally not a finding either: nothing was observed to
 * differ, so a probe timeout or a deleted key is a gap in evidence rather
 * than something learned. W5-T3 adds the ONE exception, and it is narrow by
 * construction — `approval-expired` is a finding about the APPROVAL rather
 * than about the world. The runner established it with certainty from the
 * binding's own committed TTL, no probe required, which is exactly what
 * separates it from every other unevaluated reason.
 *
 * Without this, a recorder-mode run whose approval had expired printed
 * `PASSED` with no finding tag: the per-step line said "not evaluated —
 * approval-expired", the summary said nothing, and "in recorder mode it must
 * not silently look fine" held at the step and failed at the summary.
 *
 * Matched on the reason prefix, not on `action`, deliberately: gate mode
 * rewrites `action` to `"refused"` for EVERY unevaluated outcome, so keying
 * on that would newly count key-unavailable and probe-timeout refusals as
 * findings — a behaviour change this slice has no business making.
 */
export function stateCheckFindingsCount(steps: Array<{ stateCheck?: StepStateCheck }>): number {
  return steps.filter(
    (s) =>
      s.stateCheck?.outcome === "mismatch" ||
      (s.stateCheck?.outcome === "unevaluated" && s.stateCheck.reason?.startsWith("approval-expired:") === true)
  ).length;
}

/**
 * The run summary's finding tag (§5.4): ` · N finding(s)` when any step
 * stamped OR refused on a pre-state mismatch, empty otherwise. The tag
 * itself never feeds the exit code or PASSED/FAILED (I-9) — a finding is
 * about the world, not the run. In gate mode a refused run legitimately
 * prints BOTH FAILED and a finding tag: the refusal (in `failures[]`)
 * flips the outcome, the finding preserves what was observed. Exported so
 * the string format is test-pinned.
 */
export function findingsSummaryTag(steps: Array<{ stateCheck?: StepStateCheck }>): string {
  const findings = stateCheckFindingsCount(steps);
  return findings > 0 ? ` · ${findings} finding${findings === 1 ? "" : "s"}` : "";
}
