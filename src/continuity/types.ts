import type { LedgerState } from "../authority/ledger.js";
import type { ClaimStatus } from "../authority/types.js";
import type { VerifiedNativeOutcomeProjectionV1 } from "../authority/certification/task-receipt-graph.js";

declare const VERIFIER_PRODUCED_CONSEQUENCE: unique symbol;

export interface AuthenticatedWorkloadV1 {
  readonly v: "reelier.authenticated-workload/v1";
  readonly taskId: string;
  readonly principalId: string;
  readonly workloadId: string;
  readonly runtimeSessionId: string;
  readonly harnessId: string;
}

export interface UncheckedConsequenceProofV1 {
  readonly v: "reelier.unchecked-consequence-proof/v1";
  readonly status: "unchecked";
  readonly evidenceDigest: string | null;
}

export interface VerifierProducedConsequenceEventV1 {
  readonly type: "consequence.observed";
  readonly eventId: string;
  readonly semanticOperationId: string;
  readonly reservationId: string;
  readonly state: Exclude<LedgerState, "issued">;
  readonly authorityEvidenceDigest: string;
  readonly receiptDigest: string;
  readonly verification: VerifiedNativeOutcomeProjectionV1["verification"];
  readonly [VERIFIER_PRODUCED_CONSEQUENCE]: true;
}

export type ContinuityEventV1 =
  | Readonly<{ type: "task.opened"; eventId: string; outcome: string; completionProjection: string; nonGoals: readonly string[] }>
  | Readonly<{ type: "decision.recorded"; eventId: string; decisionId: string; statement: string; decidedBy: string; binding: boolean; evidenceDigest: string | null }>
  | Readonly<{ type: "decision.superseded"; eventId: string; decisionId: string; supersededByDecisionId: string }>
  | Readonly<{ type: "obligation.opened"; eventId: string; obligationId: string; statement: string; acceptanceEvidence: string; ownerWorkloadId: string }>
  | Readonly<{ type: "obligation.transitioned"; eventId: string; obligationId: string; to: "blocked" | "satisfied" | "abandoned"; reason: string; evidenceDigest: string | null }>
  | Readonly<{ type: "claim.recorded"; eventId: string; claimId: string; statement: string; status: Exclude<ClaimStatus, "verified">; evidenceDigest: string | null }>
  | Readonly<{ type: "claim.updated"; eventId: string; claimId: string; status: Exclude<ClaimStatus, "verified">; evidenceDigest: string | null }>
  | Readonly<{ type: "consequence.noted"; eventId: string; semanticOperationId: string; reservationId: string; state: Exclude<LedgerState, "issued">; evidenceDigest: string | null }>
  | Readonly<{ type: "exception.opened"; eventId: string; exceptionId: string; reason: string; evidenceDigest: string | null }>
  | Readonly<{ type: "exception.resolved"; eventId: string; exceptionId: string; resolution: string; evidenceDigest: string }>;

export type ContinuityFoldEventV1 = ContinuityEventV1 | VerifierProducedConsequenceEventV1;

export interface ContinuityCheckpointV1 {
  readonly v: "reelier.continuity-checkpoint/v1";
  readonly taskId: string;
  readonly expectedCursor: number;
  readonly actorPrincipalId: string;
  readonly workloadId: string;
  readonly jobCardDigest: string;
  readonly authoritySnapshotDigest: string;
  readonly proposedEvents: readonly ContinuityEventV1[];
  readonly evidenceRefs: readonly string[];
  readonly agentMemo?: Readonly<{ status: "unchecked"; text: string }>;
}

export interface NormalizedCheckpointV1 {
  readonly actor: AuthenticatedWorkloadV1;
  readonly checkpoint: ContinuityCheckpointV1;
}
