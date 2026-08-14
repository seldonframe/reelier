import type { ClaimStatus } from "../authority/types.js";
import type { VerifiedNativeOutcomeProjectionV1 } from "../authority/certification/task-receipt-graph.js";
import { assertFoldedContinuityState, type ObligationStateV1 } from "./fold.js";
import { assertLedgerContinuitySnapshot, type ContinuitySnapshotV1 } from "./fs-ledger.js";
import type { UncheckedConsequenceProofV1 } from "./types.js";

export interface OutcomeOwedProjectionV1 {
  readonly outcome: string;
  readonly completionProjection: string;
  readonly nonGoals: readonly string[];
}

export interface DecisionProjectionV1 {
  readonly decisionId: string;
  readonly statement: string;
  readonly decidedBy: string;
  readonly evidenceDigest: string;
}

export interface ObligationProjectionV1 {
  readonly obligationId: string;
  readonly statement: string;
  readonly ownerWorkloadId: string;
  readonly acceptanceEvidence: string;
  readonly state: ObligationStateV1["state"];
  readonly reason: string | null;
  readonly evidenceDigest: string | null;
}

export interface WorkStateProjectionV1 {
  readonly open: readonly ObligationProjectionV1[];
  readonly blocked: readonly ObligationProjectionV1[];
  readonly satisfied: readonly ObligationProjectionV1[];
  readonly abandoned: readonly ObligationProjectionV1[];
}

export interface ConsequenceProjectionV1 {
  readonly semanticOperationId: string;
  readonly reservationId: string;
  readonly state: string;
  readonly authorityEvidenceDigest: string | null;
  readonly receiptDigest: string | null;
  readonly verification: VerifiedNativeOutcomeProjectionV1["verification"] | UncheckedConsequenceProofV1;
}

export interface RemainingEnvelopeProjectionV1 {
  readonly nonGoals: readonly string[];
  readonly openObligationIds: readonly string[];
  readonly blockedObligationIds: readonly string[];
  readonly supersededDecisionCount: number;
}

export interface ClaimProjectionV1 {
  readonly claimId: string;
  readonly statement: string;
  readonly status: ClaimStatus;
  readonly evidenceDigest: string | null;
}

export interface ExceptionProjectionV1 {
  readonly exceptionId: string;
  readonly reason: string;
  readonly evidenceDigest: string | null;
}

export interface EvidenceProjectionV1 {
  readonly evidenceRefs: readonly string[];
  readonly uncertainClaims: readonly ClaimProjectionV1[];
  readonly uncertainConsequences: readonly ConsequenceProjectionV1[];
  readonly unresolvedExceptions: readonly ExceptionProjectionV1[];
}

export type NextSafeActionV1 =
  | "reconcile-before-retry"
  | "refresh-authority"
  | "resolve-exception"
  | "request-human-decision"
  | "continue-preparation"
  | "request-outcome-acceptance";

export interface ResumeProjectionV1 {
  readonly v: "reelier.resume-projection/v1";
  readonly taskId: string;
  readonly cursor: number;
  readonly segmentDigest: string;
  readonly jobCardDigest: string;
  readonly authoritySnapshotDigest: string;
  readonly sections: {
    readonly outcomeOwed: OutcomeOwedProjectionV1;
    readonly bindingDecisions: readonly DecisionProjectionV1[];
    readonly workState: WorkStateProjectionV1;
    readonly consequentialState: readonly ConsequenceProjectionV1[];
    readonly remainingEnvelope: RemainingEnvelopeProjectionV1;
    readonly evidenceAndUncertainty: EvidenceProjectionV1;
    readonly nextSafeActions: readonly NextSafeActionV1[];
  };
}

function obligationProjection(obligation: ObligationStateV1): ObligationProjectionV1 {
  return {
    obligationId: obligation.obligationId,
    statement: obligation.statement,
    ownerWorkloadId: obligation.ownerWorkloadId,
    acceptanceEvidence: obligation.acceptanceEvidence,
    state: obligation.state,
    reason: obligation.reason,
    evidenceDigest: obligation.evidenceDigest,
  };
}

function nextSafeActions(
  consequences: readonly ConsequenceProjectionV1[],
  work: WorkStateProjectionV1,
  exceptions: readonly ExceptionProjectionV1[],
): readonly NextSafeActionV1[] {
  if (consequences.some((item) => item.state === "dispatched" || item.state === "ambiguous")) {
    return ["reconcile-before-retry"];
  }
  if (exceptions.length > 0) return ["resolve-exception"];
  if (work.blocked.length > 0) return ["request-human-decision"];
  if (work.open.length > 0) return ["continue-preparation"];
  return ["request-outcome-acceptance"];
}

export function createResumeProjection(snapshot: ContinuitySnapshotV1): ResumeProjectionV1 {
  if (
    snapshot.cursor === 0
    || snapshot.segmentDigest === null
    || snapshot.jobCardDigest === null
    || snapshot.authoritySnapshotDigest === null
    || snapshot.state === null
  ) {
    throw new TypeError("empty continuity snapshot has nothing to resume");
  }
  assertLedgerContinuitySnapshot(snapshot);
  assertFoldedContinuityState(snapshot.state);
  const state = snapshot.state;
  const obligations = [...state.obligations.values()].map(obligationProjection);
  const workState: WorkStateProjectionV1 = {
    open: obligations.filter((item) => item.state === "open"),
    blocked: obligations.filter((item) => item.state === "blocked"),
    satisfied: obligations.filter((item) => item.state === "satisfied"),
    abandoned: obligations.filter((item) => item.state === "abandoned"),
  };
  const consequentialState = [...state.consequences.values()].map((item): ConsequenceProjectionV1 => ({
    semanticOperationId: item.semanticOperationId,
    reservationId: item.reservationId,
    state: item.state,
    authorityEvidenceDigest: item.authorityEvidenceDigest,
    receiptDigest: item.receiptDigest,
    verification: item.verification,
  }));
  const unresolvedExceptions = [...state.exceptions.values()]
    .filter((item) => item.state === "open")
    .map((item): ExceptionProjectionV1 => ({ exceptionId: item.exceptionId, reason: item.reason, evidenceDigest: item.openedEvidenceDigest }));
  const evidenceAndUncertainty: EvidenceProjectionV1 = {
    evidenceRefs: [...state.evidenceRefs],
    uncertainClaims: [...state.claims.values()]
      .filter((item) => item.status !== "verified")
      .map((item): ClaimProjectionV1 => ({ claimId: item.claimId, statement: item.statement, status: item.status, evidenceDigest: item.evidenceDigest })),
    uncertainConsequences: consequentialState.filter((item) => item.verification.status !== "verified"),
    unresolvedExceptions,
  };
  return {
    v: "reelier.resume-projection/v1",
    taskId: snapshot.taskId,
    cursor: snapshot.cursor,
    segmentDigest: snapshot.segmentDigest,
    jobCardDigest: snapshot.jobCardDigest,
    authoritySnapshotDigest: snapshot.authoritySnapshotDigest,
    sections: {
      outcomeOwed: {
        outcome: state.outcome,
        completionProjection: state.completionProjection,
        nonGoals: [...state.nonGoals],
      },
      bindingDecisions: state.activeDecisions.map((item): DecisionProjectionV1 => ({
        decisionId: item.decisionId,
        statement: item.statement,
        decidedBy: item.decidedBy,
        evidenceDigest: item.evidenceDigest as string,
      })),
      workState,
      consequentialState,
      remainingEnvelope: {
        nonGoals: [...state.nonGoals],
        openObligationIds: workState.open.map((item) => item.obligationId),
        blockedObligationIds: workState.blocked.map((item) => item.obligationId),
        supersededDecisionCount: [...state.decisions.values()].filter((item) => item.supersededByDecisionId !== null).length,
      },
      evidenceAndUncertainty,
      nextSafeActions: nextSafeActions(consequentialState, workState, unresolvedExceptions),
    },
  };
}
