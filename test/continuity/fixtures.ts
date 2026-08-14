import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LedgerState } from "../../src/authority/ledger.js";
import type {
  AuthenticatedWorkloadV1,
  ContinuityCheckpointV1,
  ContinuityEventV1,
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
  receiptDigest: string | null = null,
): ContinuityEventV1 {
  return {
    type: "consequence.observed",
    eventId,
    semanticOperationId: "operation_1",
    reservationId: "reservation_1",
    state,
    authorityEvidenceDigest: digest(eventId.at(-1) ?? "e"),
    receiptDigest,
  };
}

export const reservedConsequence = consequence("event_2", "reserved");
export const dispatchedConsequence = consequence("event_3", "dispatched");
export const ambiguousConsequence = consequence("event_4", "ambiguous");

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
