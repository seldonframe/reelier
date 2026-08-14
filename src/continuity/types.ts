import type { LedgerState } from "../authority/ledger.js";
import type { ClaimStatus } from "../authority/types.js";

export interface AuthenticatedWorkloadV1 {
  readonly v: "reelier.authenticated-workload/v1";
  readonly taskId: string;
  readonly principalId: string;
  readonly workloadId: string;
  readonly runtimeSessionId: string;
  readonly harnessId: string;
}

export type ContinuityEventV1 =
  | Readonly<{ type: "task.opened"; eventId: string; outcome: string; completionProjection: string; nonGoals: readonly string[] }>
  | Readonly<{ type: "decision.recorded"; eventId: string; decisionId: string; statement: string; decidedBy: string; binding: boolean; evidenceDigest: string | null }>
  | Readonly<{ type: "decision.superseded"; eventId: string; decisionId: string; supersededByDecisionId: string }>
  | Readonly<{ type: "obligation.opened"; eventId: string; obligationId: string; statement: string; acceptanceEvidence: string; ownerWorkloadId: string }>
  | Readonly<{ type: "obligation.transitioned"; eventId: string; obligationId: string; to: "blocked" | "satisfied" | "abandoned"; reason: string; evidenceDigest: string | null }>
  | Readonly<{ type: "claim.recorded"; eventId: string; claimId: string; statement: string; status: ClaimStatus; evidenceDigest: string | null }>
  | Readonly<{ type: "claim.updated"; eventId: string; claimId: string; status: ClaimStatus; evidenceDigest: string | null }>
  | Readonly<{ type: "consequence.observed"; eventId: string; semanticOperationId: string; reservationId: string; state: Exclude<LedgerState, "issued">; authorityEvidenceDigest: string; receiptDigest: string | null }>
  | Readonly<{ type: "exception.opened"; eventId: string; exceptionId: string; reason: string; evidenceDigest: string | null }>
  | Readonly<{ type: "exception.resolved"; eventId: string; exceptionId: string; resolution: string; evidenceDigest: string }>;

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
