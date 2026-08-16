import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LedgerState } from "../../src/authority/ledger.js";
import type {
  AuthenticatedWorkloadV1,
  ContinuityCheckpointV1,
  ContinuityEventV1,
  VerifierProducedConsequenceEventV1,
} from "../../src/continuity/types.js";

export const digest = (character: string): string => `sha256:${character.repeat(64)}`;

export const actor: AuthenticatedWorkloadV1 = {
  v: "reelier.authenticated-workload/v1",
  taskId: "task_1",
  principalId: "principal_1",
  workloadId: "workload_1",
  runtimeSessionId: "session_1",
  harnessId: "codex",
};

export const successorActor: AuthenticatedWorkloadV1 = {
  ...actor,
  workloadId: "workload_2",
  runtimeSessionId: "session_2",
  harnessId: "claude-code",
};

export const opened: ContinuityEventV1 = {
  type: "task.opened",
  eventId: "event_1",
  outcome: "Ship the bounded release",
  completionProjection: "GitHub label projection matches",
  nonGoals: ["production deployment"],
};

export const decision: ContinuityEventV1 = {
  type: "decision.recorded",
  eventId: "event_2",
  decisionId: "decision_1",
  statement: "Use the bounded authority path",
  decidedBy: "human",
  binding: true,
  evidenceDigest: digest("d"),
};

export function consequence(
  eventId: string,
  state: Exclude<LedgerState, "issued">,
  receiptDigest: string = digest("c"),
): VerifierProducedConsequenceEventV1 {
  const receiptChain = [receiptDigest];
  const priorReceiptLinks = [{ receiptDigest, priorReceiptDigest: null }];
  return {
    type: "consequence.observed",
    eventId,
    semanticOperationId: "operation_1",
    reservationId: "reservation_1",
    state,
    authorityEvidenceDigest: digest("e"),
    receiptDigest,
    verification: {
      v: "reelier.verified-native-outcome-proof/v1",
      status: "verified",
      graphDigest: digest("a"),
      publicationDigest: digest("b"),
      journalReservationId: "journal_reservation_1",
      routeAuthorityDigest: digest("c"),
      writeRouteDigest: digest("d"),
      readRouteDigest: digest("e"),
      accountDigest: digest("f"),
      authenticatedProviderIdentityDigest: digest("1"),
      authenticatedIdentityDigest: digest("2"),
      materializedRequestDigest: digest("3"),
      responseSemanticsProfileDigest: digest("4"),
      responseObservationDigest: digest("5"),
      preStateEvidenceDigest: digest("6"),
      postStateEvidenceDigest: digest("7"),
      expectedPostProjectionDigest: digest("7"),
      claimStatuses: {
        authorization: "verified",
        sourceCompleteness: "verified",
        dispatch: "verified",
        providerAcknowledgment: "verified",
        reconciliation: "verified",
        topology: "unchecked",
        completeness: "unchecked",
      },
      confidence: "exact",
      authoritativeStateSource: "hermetic-github-fixture",
      reconciliationVerdict: "matched",
      reconciliationDigest: digest("8"),
      noResend: { status: "verified", resendCount: 0 },
      receiptChain,
      receiptChainDigest: digest("9"),
      priorReceiptLinks,
      priorReceiptLinksDigest: digest("a"),
      collectionCountsDigest: digest("b"),
      cleanupParentReceiptDigest: null,
      terminalDigest: digest("c"),
      currentTrustObservationDigest: digest("d"),
    },
  } as unknown as VerifierProducedConsequenceEventV1;
}

export const reservedConsequence = consequence("event_2", "reserved");
export const dispatchedConsequence = consequence("event_3", "dispatched");
export const ambiguousConsequence = consequence("event_4", "ambiguous");

export function consequenceNote(
  eventId: string,
  state: Exclude<LedgerState, "issued">,
): Extract<ContinuityEventV1, { type: "consequence.noted" }> {
  return {
    type: "consequence.noted",
    eventId,
    semanticOperationId: "operation_1",
    reservationId: "reservation_1",
    state,
    evidenceDigest: null,
  };
}

export function checkpoint(
  expectedCursor: number,
  proposedEvents: readonly ContinuityEventV1[],
): ContinuityCheckpointV1 {
  return {
    v: "reelier.continuity-checkpoint/v1",
    taskId: "task_1",
    expectedCursor,
    actorPrincipalId: "principal_1",
    workloadId: "workload_1",
    jobCardDigest: digest("a"),
    authoritySnapshotDigest: digest("b"),
    proposedEvents,
    evidenceRefs: [],
  };
}

export async function withRoot<T>(callback: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "reelier-continuity-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
