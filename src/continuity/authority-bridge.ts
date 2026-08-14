import type { LedgerState } from "../authority/ledger.js";
import type { VerifiedAuthorityReceiptBundle } from "../authority/verify.js";
import { authorityDigest } from "../authority/wire.js";
import type { ContinuityEventV1 } from "./types.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
type ConsequenceState = Exclude<LedgerState, "issued">;

const NEXT: Readonly<Record<"issued" | ConsequenceState, readonly ConsequenceState[]>> = {
  issued: ["reserved"],
  reserved: ["dispatched", "cancelled"],
  dispatched: ["acknowledged", "definitive-failure", "ambiguous"],
  acknowledged: ["reconciled"],
  "definitive-failure": ["reconciled"],
  ambiguous: ["reconciled"],
  cancelled: [],
  reconciled: [],
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

/**
 * Projects cryptographically verified Path C evidence into the continuity
 * kernel. Redacted ingress outcomes are deliberately insufficient here: only
 * a verifier result whose bundle and evidence links still match can become
 * durable consequence truth.
 */
export function continuityEventsFromVerifiedAuthorityReceipt(
  verified: VerifiedAuthorityReceiptBundle,
): readonly Extract<ContinuityEventV1, { type: "consequence.observed" }>[] {
  const wrapper = record(verified, "verified authority receipt");
  const bundle = record(wrapper.bundle, "verified authority receipt bundle");
  if (!Object.isFrozen(verified) || !Object.isFrozen(verified.bundle)) {
    throw new TypeError("verified authority receipt must be the immutable verifier result");
  }
  if (typeof wrapper.digest !== "string" || !DIGEST.test(wrapper.digest) || authorityDigest(bundle) !== wrapper.digest) {
    throw new TypeError("verified authority receipt bundle digest mismatch");
  }

  const evidenceArtifact = record(bundle.evidence, "verified authority evidence artifact");
  const evidence = record(evidenceArtifact.value, "verified authority evidence");
  const receiptArtifact = record(bundle.receipt, "verified authority receipt artifact");
  const receipt = record(receiptArtifact.value, "verified authority receipt value");
  if (typeof evidenceArtifact.digest !== "string" || !DIGEST.test(evidenceArtifact.digest) || authorityDigest(evidence) !== evidenceArtifact.digest) {
    throw new TypeError("verified authority evidence digest mismatch");
  }
  if (typeof receiptArtifact.digest !== "string" || !DIGEST.test(receiptArtifact.digest) || authorityDigest(receipt) !== receiptArtifact.digest) {
    throw new TypeError("verified authority receipt digest mismatch");
  }
  if (receipt.evidenceDigest !== evidenceArtifact.digest) {
    throw new TypeError("receipt evidence digest mismatch");
  }

  const context = record(receipt.decisionContext, "verified authority decision context");
  if (
    receipt.receiptId !== evidence.receiptId
    || receipt.decisionContextDigest !== authorityDigest(context)
    || evidence.decisionContextDigest !== receipt.decisionContextDigest
    || evidence.gateEventDigest !== receipt.gateEventDigest
  ) {
    throw new TypeError("verified authority receipt decision context edge mismatch");
  }
  if (typeof wrapper.tenant !== "string" || context.tenant !== wrapper.tenant) {
    throw new TypeError("verified authority receipt tenant mismatch");
  }
  if (typeof context.requestKey !== "string" || !DIGEST.test(context.requestKey)) {
    throw new TypeError("verified authority receipt request key is invalid");
  }
  if (typeof evidence.reservationId !== "string" || !IDENTIFIER.test(evidence.reservationId)) {
    throw new TypeError("verified authority receipt reservation is invalid");
  }
  if (!Array.isArray(evidence.timeline) || evidence.timeline.length === 0) {
    throw new TypeError("verified authority evidence timeline is empty");
  }

  const eventIds = new Set<string>();
  let prior: "issued" | ConsequenceState = "issued";
  const events = evidence.timeline.map((entryValue, index) => {
    const entry = record(entryValue, `verified authority evidence timeline[${index}]`);
    if (typeof entry.state !== "string" || !Object.hasOwn(NEXT, entry.state)) {
      throw new TypeError("verified authority evidence timeline state is invalid");
    }
    const state = entry.state as ConsequenceState;
    if (!NEXT[prior].includes(state)) {
      throw new TypeError(`verified authority evidence timeline transition is invalid: ${prior} -> ${state}`);
    }
    if (typeof entry.eventDigest !== "string" || !DIGEST.test(entry.eventDigest) || eventIds.has(entry.eventDigest)) {
      throw new TypeError("verified authority evidence timeline event digest is invalid or duplicated");
    }
    eventIds.add(entry.eventDigest);
    prior = state;
    return Object.freeze({
      type: "consequence.observed" as const,
      eventId: entry.eventDigest,
      semanticOperationId: context.requestKey as string,
      reservationId: evidence.reservationId as string,
      state,
      authorityEvidenceDigest: evidenceArtifact.digest as string,
      receiptDigest: receiptArtifact.digest as string,
    });
  });
  return Object.freeze(events);
}
