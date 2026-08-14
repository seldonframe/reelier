import type { LedgerState } from "../authority/ledger.js";
import {
  readVerifiedNativeOutcomeProjections,
  type VerifiedCertificationTaskReceiptGraphV1,
} from "../authority/certification/task-receipt-graph.js";
import type { ContinuityEventV1 } from "./types.js";

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

/**
 * Projects verifier-produced native Path C proof into the continuity kernel.
 * The verifier result is registered opaquely by the full signed task-graph
 * verifier. Frozen objects, hashes, casts, and generic receipt bundles cannot
 * enter this path.
 */
export function continuityEventsFromVerifiedAuthorityReceipt(
  verified: VerifiedCertificationTaskReceiptGraphV1,
): readonly Extract<ContinuityEventV1, { type: "consequence.observed" }>[] {
  const eventIds = new Set<string>();
  const events = readVerifiedNativeOutcomeProjections(verified).flatMap((projection) => {
    let prior: "issued" | ConsequenceState = "issued";
    return projection.timeline.map((entry) => {
      const state = entry.state as ConsequenceState;
      if (!NEXT[prior].includes(state)) throw new TypeError(`verified native outcome timeline transition is invalid: ${prior} -> ${state}`);
      if (eventIds.has(entry.eventDigest)) throw new TypeError("verified native outcome timeline event digest is duplicated");
      eventIds.add(entry.eventDigest);
      prior = state;
      return Object.freeze({
        type: "consequence.observed" as const,
        eventId: entry.eventDigest,
        semanticOperationId: projection.semanticOperationId,
        reservationId: projection.reservationId,
        state,
        authorityEvidenceDigest: projection.authorityEvidenceDigest,
        receiptDigest: projection.receiptDigest,
        verification: projection.verification,
      });
    });
  });
  return Object.freeze(events);
}
