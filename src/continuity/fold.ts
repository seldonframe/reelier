import type { LedgerState } from "../authority/ledger.js";
import type { ClaimStatus } from "../authority/types.js";
import type { ContinuityEventV1 } from "./types.js";

export class ContinuityFoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContinuityFoldError";
  }
}

export interface DecisionStateV1 {
  readonly decisionId: string;
  readonly statement: string;
  readonly decidedBy: string;
  readonly binding: boolean;
  readonly evidenceDigest: string | null;
  readonly supersededByDecisionId: string | null;
}

export interface ObligationStateV1 {
  readonly obligationId: string;
  readonly statement: string;
  readonly acceptanceEvidence: string;
  readonly ownerWorkloadId: string;
  readonly state: "open" | "blocked" | "satisfied" | "abandoned";
  readonly reason: string | null;
  readonly evidenceDigest: string | null;
}

export interface ClaimStateV1 {
  readonly claimId: string;
  readonly statement: string;
  readonly status: ClaimStatus;
  readonly evidenceDigest: string | null;
}

export interface ConsequenceStateV1 {
  readonly semanticOperationId: string;
  readonly reservationId: string;
  readonly state: Exclude<LedgerState, "issued">;
  readonly authorityEvidenceDigest: string;
  readonly receiptDigest: string | null;
}

export interface ExceptionStateV1 {
  readonly exceptionId: string;
  readonly reason: string;
  readonly openedEvidenceDigest: string | null;
  readonly state: "open" | "resolved";
  readonly resolution: string | null;
  readonly resolutionEvidenceDigest: string | null;
}

export interface ContinuityStateV1 {
  readonly events: readonly ContinuityEventV1[];
  readonly outcome: string;
  readonly completionProjection: string;
  readonly nonGoals: readonly string[];
  readonly decisions: ReadonlyMap<string, DecisionStateV1>;
  readonly activeDecisions: readonly DecisionStateV1[];
  readonly obligations: ReadonlyMap<string, ObligationStateV1>;
  readonly claims: ReadonlyMap<string, ClaimStateV1>;
  readonly consequences: ReadonlyMap<string, ConsequenceStateV1>;
  readonly exceptions: ReadonlyMap<string, ExceptionStateV1>;
  readonly resolvedExceptions: readonly ExceptionStateV1[];
  readonly evidenceRefs: readonly string[];
}

const CONSEQUENCE_EDGES: Readonly<Record<Exclude<LedgerState, "issued">, readonly Exclude<LedgerState, "issued">[]>> = {
  reserved: ["dispatched", "cancelled"],
  dispatched: ["acknowledged", "definitive-failure", "ambiguous"],
  acknowledged: ["reconciled"],
  "definitive-failure": ["reconciled"],
  ambiguous: ["reconciled"],
  cancelled: [],
  reconciled: [],
};

function sortedMap<T>(input: Map<string, T>): ReadonlyMap<string, T> {
  return new Map([...input.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function addEvidence(target: Set<string>, ...values: readonly (string | null)[]): void {
  for (const value of values) if (value !== null) target.add(value);
}

export function foldContinuity(events: readonly ContinuityEventV1[]): ContinuityStateV1 {
  if (events.length === 0 || events[0]?.type !== "task.opened") {
    throw new ContinuityFoldError("continuity history must begin with exactly one task.opened event");
  }

  const eventIds = new Set<string>();
  const decisions = new Map<string, DecisionStateV1>();
  const obligations = new Map<string, ObligationStateV1>();
  const claims = new Map<string, ClaimStateV1>();
  const consequences = new Map<string, ConsequenceStateV1>();
  const exceptions = new Map<string, ExceptionStateV1>();
  const evidenceRefs = new Set<string>();
  const opened = events[0];

  for (const [index, event] of events.entries()) {
    if (eventIds.has(event.eventId)) throw new ContinuityFoldError(`duplicate event ID: ${event.eventId}`);
    eventIds.add(event.eventId);
    if (event.type === "task.opened") {
      if (index !== 0) throw new ContinuityFoldError("continuity history contains more than one task.opened event");
      continue;
    }

    switch (event.type) {
      case "decision.recorded":
        if (decisions.has(event.decisionId)) throw new ContinuityFoldError(`duplicate decision: ${event.decisionId}`);
        decisions.set(event.decisionId, {
          decisionId: event.decisionId,
          statement: event.statement,
          decidedBy: event.decidedBy,
          binding: event.binding,
          evidenceDigest: event.evidenceDigest,
          supersededByDecisionId: null,
        });
        addEvidence(evidenceRefs, event.evidenceDigest);
        break;
      case "decision.superseded": {
        const prior = decisions.get(event.decisionId);
        const successor = decisions.get(event.supersededByDecisionId);
        if (prior === undefined) throw new ContinuityFoldError(`cannot supersede missing decision: ${event.decisionId}`);
        if (successor === undefined) throw new ContinuityFoldError(`cannot supersede with missing decision: ${event.supersededByDecisionId}`);
        if (!prior.binding || !successor.binding) throw new ContinuityFoldError("only binding decisions may participate in supersession");
        if (prior.supersededByDecisionId !== null) throw new ContinuityFoldError(`decision is already superseded: ${event.decisionId}`);
        if (event.decisionId === event.supersededByDecisionId) throw new ContinuityFoldError("a decision cannot supersede itself");
        decisions.set(event.decisionId, { ...prior, supersededByDecisionId: event.supersededByDecisionId });
        break;
      }
      case "obligation.opened":
        if (obligations.has(event.obligationId)) throw new ContinuityFoldError(`duplicate obligation: ${event.obligationId}`);
        obligations.set(event.obligationId, {
          obligationId: event.obligationId,
          statement: event.statement,
          acceptanceEvidence: event.acceptanceEvidence,
          ownerWorkloadId: event.ownerWorkloadId,
          state: "open",
          reason: null,
          evidenceDigest: null,
        });
        break;
      case "obligation.transitioned": {
        const prior = obligations.get(event.obligationId);
        if (prior === undefined) throw new ContinuityFoldError(`cannot transition missing obligation: ${event.obligationId}`);
        if (prior.state !== "open") throw new ContinuityFoldError(`obligation is terminal: ${event.obligationId}`);
        obligations.set(event.obligationId, { ...prior, state: event.to, reason: event.reason, evidenceDigest: event.evidenceDigest });
        addEvidence(evidenceRefs, event.evidenceDigest);
        break;
      }
      case "claim.recorded":
        if (claims.has(event.claimId)) throw new ContinuityFoldError(`duplicate claim: ${event.claimId}`);
        claims.set(event.claimId, { claimId: event.claimId, statement: event.statement, status: event.status, evidenceDigest: event.evidenceDigest });
        addEvidence(evidenceRefs, event.evidenceDigest);
        break;
      case "claim.updated": {
        const prior = claims.get(event.claimId);
        if (prior === undefined) throw new ContinuityFoldError(`cannot update missing claim: ${event.claimId}`);
        claims.set(event.claimId, { ...prior, status: event.status, evidenceDigest: event.evidenceDigest });
        addEvidence(evidenceRefs, event.evidenceDigest);
        break;
      }
      case "consequence.observed": {
        const prior = consequences.get(event.semanticOperationId);
        if (prior === undefined) {
          if (event.state !== "reserved") throw new ContinuityFoldError(`consequence must begin reserved: ${event.semanticOperationId}`);
        } else {
          if (prior.reservationId !== event.reservationId) throw new ContinuityFoldError(`consequence reservation changed: ${event.semanticOperationId}`);
          if (!CONSEQUENCE_EDGES[prior.state].includes(event.state)) {
            throw new ContinuityFoldError(`illegal consequence transition: ${prior.state} -> ${event.state}`);
          }
        }
        consequences.set(event.semanticOperationId, {
          semanticOperationId: event.semanticOperationId,
          reservationId: event.reservationId,
          state: event.state,
          authorityEvidenceDigest: event.authorityEvidenceDigest,
          receiptDigest: event.receiptDigest,
        });
        addEvidence(evidenceRefs, event.authorityEvidenceDigest, event.receiptDigest);
        break;
      }
      case "exception.opened":
        if (exceptions.has(event.exceptionId)) throw new ContinuityFoldError(`duplicate exception: ${event.exceptionId}`);
        exceptions.set(event.exceptionId, {
          exceptionId: event.exceptionId,
          reason: event.reason,
          openedEvidenceDigest: event.evidenceDigest,
          state: "open",
          resolution: null,
          resolutionEvidenceDigest: null,
        });
        addEvidence(evidenceRefs, event.evidenceDigest);
        break;
      case "exception.resolved": {
        const prior = exceptions.get(event.exceptionId);
        if (prior === undefined) throw new ContinuityFoldError(`cannot resolve missing exception: ${event.exceptionId}`);
        if (prior.state === "resolved") throw new ContinuityFoldError(`exception is already resolved: ${event.exceptionId}`);
        exceptions.set(event.exceptionId, { ...prior, state: "resolved", resolution: event.resolution, resolutionEvidenceDigest: event.evidenceDigest });
        addEvidence(evidenceRefs, event.evidenceDigest);
        break;
      }
    }
  }

  const orderedDecisions = sortedMap(decisions);
  const orderedExceptions = sortedMap(exceptions);
  return {
    events: [...events],
    outcome: opened.outcome,
    completionProjection: opened.completionProjection,
    nonGoals: [...opened.nonGoals],
    decisions: orderedDecisions,
    activeDecisions: [...orderedDecisions.values()].filter((decision) => decision.binding && decision.supersededByDecisionId === null),
    obligations: sortedMap(obligations),
    claims: sortedMap(claims),
    consequences: sortedMap(consequences),
    exceptions: orderedExceptions,
    resolvedExceptions: [...orderedExceptions.values()].filter((item) => item.state === "resolved"),
    evidenceRefs: [...evidenceRefs].sort(),
  };
}
