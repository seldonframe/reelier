// Deferred-probe resolution (docs/specs/artifact-attestation-v1.md §8).
//
// Slice 1 attests the emission; this resolves the OUTCOME when the provider's
// record finally appears — a message-id, an event API, a bounce or delivery
// webhook. It also covers the settled refund, which has the same shape: an
// irreversible effect whose post-state exists, just late.
//
// THREE CONSTRAINTS SHAPE EVERYTHING HERE, and each is a verified property of
// the code rather than a preference (§8.2):
//
//   1. Run records carry no id and are appended one JSON line each, so there
//      is nothing to resolve back INTO.
//   2. `.reelier/runs/<skill>.jsonl` has exactly one writer and it is an
//      append; the cloud exposes only POST and hash-chains every row, so an
//      in-place edit is a detectable chain break.
//   3. The attest salt is per-run, in-memory, and never recorded — so a
//      later-computed `post` is not comparable to the original `pre` even if
//      it could be written.
//
// Therefore a resolution is a SECOND record joined by `write.approvalHash` and
// `emit.artifactDigest`, never an amendment. It publishes its own independent
// observation, which proves post-state AT RESOLUTION TIME and NOT a delta
// across the write — and it is graded `partial` accordingly, never `exact`.
// Flattening those two would be exactly the overclaim never-list #8 forbids.

import { digestSha256 } from "./canonical-json.js";
import type { RunRecord, StepAttest } from "./runner.js";

/** A deferred attestation awaiting resolution, plus the join keys it resolves back through. */
export interface PendingAttestation {
  /** The step number in the record this came from. */
  step: number;
  /** The declared probe's tool name. */
  selector: string;
  /** Absolute instant the provider record was expected by. */
  deferredUntil: string;
  /** Which approval authorized the emission — the join key back to the authorization. */
  approvalHash?: string;
  /** The artifact commitment this outcome belongs to — the join key back to the emission. */
  artifactDigest?: string;
}

/**
 * The projected observation a resolution probe produced, or the reason it did
 * not. Structurally the runner's `ProbeResult`, restated here so this module
 * does not depend on the runner's private probe plumbing.
 */
export type ResolutionProbe =
  | { ok: true; projected: Record<string, string> }
  | { ok: false; reason: string };

/** Every deferred attestation in a record still awaiting resolution. */
export function pendingAttestations(record: RunRecord): PendingAttestation[] {
  const out: PendingAttestation[] = [];
  for (const step of record.steps ?? []) {
    const attest = step.attest;
    if (attest === undefined || attest.confidence !== "pending") continue;
    // A pending attestation with no deadline is unrepresentable from this
    // package's writer (the runner always stamps one). Skipped rather than
    // defaulted: inventing a deadline would let a hand-edited record decide
    // when Reelier stops waiting.
    if (typeof attest.deferredUntil !== "string" || attest.deferredUntil === "") continue;
    out.push({
      step: step.n,
      selector: attest.selector ?? "",
      deferredUntil: attest.deferredUntil,
      ...(step.write?.approvalHash !== undefined ? { approvalHash: step.write.approvalHash } : {}),
      ...(step.emit?.artifactDigest !== undefined ? { artifactDigest: step.emit.artifactDigest } : {}),
    });
  }
  return out;
}

/**
 * Grade one deferred attestation against a resolution attempt.
 *
 * The state machine, and why each arm is what it is:
 *
 *  - **probe resolved declared fields → `partial`.** Never `exact`: `exact` is
 *    reserved for a two-sided pre/post pair captured around one dispatch under
 *    one salt, and this is a single observation taken later. It is real
 *    evidence about the provider's record; it is not evidence of a delta.
 *  - **deadline not yet reached, nothing resolved → stays `pending`.** The
 *    provider may still be catching up, and calling it absent early would
 *    manufacture a finding out of ordinary latency.
 *  - **deadline reached, nothing resolved → `absent`.** A state that never
 *    resolves and never expires stops being read, and a state nobody reads is
 *    one an operator has learned to ignore. `absent` here claims ONLY that
 *    Reelier stopped waiting — never that the send failed, was not delivered,
 *    or was wrong. The wording is load-bearing and is test-pinned.
 *
 * `pending` and `absent` MUST NOT render as a pass on any surface
 * (never-list #1). Nothing in this function can produce a pass.
 */
export function resolveDeferred(
  pending: PendingAttestation,
  probe: ResolutionProbe | undefined,
  now: number
): StepAttest {
  const base = { method: "declared-probe" as const, selector: pending.selector };
  const deadline = Date.parse(pending.deferredUntil);
  // An unparseable deadline is treated as NOT elapsed: inventing "expired"
  // from a value we could not read would be a claim we did not earn. Same
  // reasoning the runner's approval-expiry check states for its own parse.
  const elapsed = Number.isFinite(deadline) && now >= deadline;

  const resolved = probe?.ok === true && Object.keys(probe.projected).length > 0 ? probe.projected : undefined;

  if (resolved !== undefined) {
    return {
      ...base,
      post: { hash: unsaltedResolutionHash(resolved), at: new Date(now).toISOString() },
      confidence: "partial",
      reason:
        "deferred-resolved: post-state observed at resolution time; this is not a delta across the write " +
        "(the original run's salt is gone, so the two sides are not comparable)",
    };
  }

  if (elapsed) {
    const why = probe === undefined ? "no resolution attempt produced an observation" : probe.ok ? "the probe resolved none of the declared fields" : probe.reason;
    return {
      ...base,
      confidence: "absent",
      // Names only what happened to the WAIT. Says nothing about the send.
      reason: `deferred-deadline-elapsed: ${pending.deferredUntil} passed and ${why}. Reelier stopped waiting; this is not evidence about what the write did.`,
    };
  }

  return {
    ...base,
    confidence: "pending",
    deferredUntil: pending.deferredUntil,
    reason: probe === undefined ? "deferred: not yet resolved" : probe.ok ? "deferred: the probe resolved none of the declared fields" : `deferred: ${probe.reason}`,
  };
}

/**
 * Build the SECOND record a resolution publishes (§8.2 [Normative]).
 *
 * It is not, and cannot be, an amendment: run records carry no id, the local
 * ledger has exactly one writer and it is an append, and the cloud exposes
 * only POST over hash-chained rows. So the resolution stands on its own and is
 * joined back through `write.approvalHash` and `emit.artifactDigest`, which
 * are unsalted and cross-run-stable precisely so a join like this is possible.
 *
 * Every step is `unchecked` — "ran, zero assertions", SPEC §4.3's honest-
 * success state. A resolution asserts nothing; its entire claim is the attest
 * block, whose `confidence` carries the four-state discipline. An elapsed
 * deadline is therefore never a step failure, because nothing about the write
 * failed — Reelier merely stopped waiting.
 *
 * Returns `undefined` when there is nothing to resolve, so a caller never
 * appends an empty record to the ledger.
 */
export function buildResolutionRecord(
  skillName: string,
  resolutions: { pending: PendingAttestation; attest: StepAttest }[],
  startedAtMs: number,
  finishedAtMs: number
): RunRecord | undefined {
  if (resolutions.length === 0) return undefined;
  const steps = resolutions.map(({ pending, attest }) => ({
    n: pending.step,
    title: `Deferred resolution — step ${pending.step} (${pending.selector})`,
    level: 0 as const,
    outcome: "unchecked" as const,
    ms: 0,
    failures: [] as string[],
    attest,
  }));
  return {
    skill: skillName,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    // No step failed: a resolution evaluates no assertion. The attest
    // confidences are where the claims live, and `pending`/`absent` among them
    // MUST NOT be rendered as a pass by any consumer (never-list #1).
    passed: true,
    // Deliberately NOT set: `reelier push` refuses an entire batch carrying
    // `mockFailures`, so reusing that field here would wedge the operator's push.
    steps,
    totals: {
      steps: steps.length,
      passed: 0,
      unchecked: steps.length,
      skipped: 0,
      failed: 0,
      ms: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
    },
  };
}

/**
 * The resolution observation's commitment. UNSALTED, unlike the runner's
 * within-run attest hashes — and the difference is forced rather than chosen:
 * the salt that made those comparable was per-run and is gone, so a fresh salt
 * would produce a value comparable to nothing at all. What is left is a plain
 * commitment to what the resolution observed, which is what a second record
 * can honestly carry. Raw values never appear either way.
 */
function unsaltedResolutionHash(projected: Record<string, string>): string {
  return digestSha256({ projection: projected, v: 1 });
}
