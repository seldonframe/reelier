import type { ClaimStatus } from "../authority/types.js";
import type {
  AuthenticatedWorkloadV1,
  ContinuityCheckpointV1,
  ContinuityEventV1,
  NormalizedCheckpointV1,
} from "./types.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const CLAIM_STATUSES = new Set<ClaimStatus>(["verified", "failed", "unchecked", "absent"]);
const CONSEQUENCE_STATES = new Set([
  "reserved",
  "dispatched",
  "acknowledged",
  "definitive-failure",
  "ambiguous",
  "cancelled",
  "reconciled",
]);

export class ContinuityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContinuityValidationError";
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ContinuityValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
  label = "object",
): void {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new ContinuityValidationError(`${label} has unknown fields: ${unknown.join(", ")}`);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  if (missing.length > 0) throw new ContinuityValidationError(`${label} has invalid shape; missing: ${missing.join(", ")}`);
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new ContinuityValidationError(`${label} must be a bounded identifier`);
  }
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 16_384) {
    throw new ContinuityValidationError(`${label} must be bounded non-empty text`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new ContinuityValidationError(`${label} must be boolean`);
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new ContinuityValidationError(`${label} must be a canonical sha256 digest`);
  }
  return value;
}

function nullableDigest(value: unknown, label: string): string | null {
  return value === null ? null : digest(value, label);
}

function stringArray(value: unknown, label: string, mode: "text" | "digest"): readonly string[] {
  if (!Array.isArray(value)) throw new ContinuityValidationError(`${label} must be an array`);
  const output = value.map((item, index) => mode === "digest"
    ? digest(item, `${label}[${index}]`)
    : text(item, `${label}[${index}]`));
  if (new Set(output).size !== output.length) throw new ContinuityValidationError(`${label} contains duplicates`);
  return output;
}

function eventBase(record: Record<string, unknown>, keys: readonly string[], label: string): string {
  exactKeys(record, ["type", "eventId", ...keys], [], label);
  return identifier(record.eventId, `${label}.eventId`);
}

function claimStatus(value: unknown, label: string): ClaimStatus {
  if (typeof value !== "string" || !CLAIM_STATUSES.has(value as ClaimStatus)) {
    throw new ContinuityValidationError(`${label} is not a claim status`);
  }
  return value as ClaimStatus;
}

function claimEvidence(status: ClaimStatus, value: unknown, label: string): string | null {
  const evidence = nullableDigest(value, label);
  if ((status === "verified" || status === "failed") && evidence === null) {
    throw new ContinuityValidationError(`${status} claim requires evidence`);
  }
  return evidence;
}

function normalizeEvent(value: unknown, index: number): ContinuityEventV1 {
  const record = object(value, `proposedEvents[${index}]`);
  const type = record.type;
  if (typeof type !== "string") throw new ContinuityValidationError(`proposedEvents[${index}].type must be text`);
  const label = `event ${type}`;

  switch (type) {
    case "task.opened": {
      const eventId = eventBase(record, ["outcome", "completionProjection", "nonGoals"], label);
      return { type, eventId, outcome: text(record.outcome, `${label}.outcome`), completionProjection: text(record.completionProjection, `${label}.completionProjection`), nonGoals: stringArray(record.nonGoals, `${label}.nonGoals`, "text") };
    }
    case "decision.recorded": {
      const eventId = eventBase(record, ["decisionId", "statement", "decidedBy", "binding", "evidenceDigest"], label);
      const binding = boolean(record.binding, `${label}.binding`);
      const evidenceDigest = nullableDigest(record.evidenceDigest, `${label}.evidenceDigest`);
      if (binding && evidenceDigest === null) throw new ContinuityValidationError("binding decision requires evidence");
      return { type, eventId, decisionId: identifier(record.decisionId, `${label}.decisionId`), statement: text(record.statement, `${label}.statement`), decidedBy: identifier(record.decidedBy, `${label}.decidedBy`), binding, evidenceDigest };
    }
    case "decision.superseded": {
      const eventId = eventBase(record, ["decisionId", "supersededByDecisionId"], label);
      return { type, eventId, decisionId: identifier(record.decisionId, `${label}.decisionId`), supersededByDecisionId: identifier(record.supersededByDecisionId, `${label}.supersededByDecisionId`) };
    }
    case "obligation.opened": {
      const eventId = eventBase(record, ["obligationId", "statement", "acceptanceEvidence", "ownerWorkloadId"], label);
      return { type, eventId, obligationId: identifier(record.obligationId, `${label}.obligationId`), statement: text(record.statement, `${label}.statement`), acceptanceEvidence: text(record.acceptanceEvidence, `${label}.acceptanceEvidence`), ownerWorkloadId: identifier(record.ownerWorkloadId, `${label}.ownerWorkloadId`) };
    }
    case "obligation.transitioned": {
      const eventId = eventBase(record, ["obligationId", "to", "reason", "evidenceDigest"], label);
      if (record.to !== "blocked" && record.to !== "satisfied" && record.to !== "abandoned") throw new ContinuityValidationError(`${label}.to is invalid`);
      const evidenceDigest = nullableDigest(record.evidenceDigest, `${label}.evidenceDigest`);
      if (record.to === "satisfied" && evidenceDigest === null) throw new ContinuityValidationError("satisfied obligation requires evidence");
      return { type, eventId, obligationId: identifier(record.obligationId, `${label}.obligationId`), to: record.to, reason: text(record.reason, `${label}.reason`), evidenceDigest };
    }
    case "claim.recorded": {
      const eventId = eventBase(record, ["claimId", "statement", "status", "evidenceDigest"], label);
      const status = claimStatus(record.status, `${label}.status`);
      return { type, eventId, claimId: identifier(record.claimId, `${label}.claimId`), statement: text(record.statement, `${label}.statement`), status, evidenceDigest: claimEvidence(status, record.evidenceDigest, `${label}.evidenceDigest`) };
    }
    case "claim.updated": {
      const eventId = eventBase(record, ["claimId", "status", "evidenceDigest"], label);
      const status = claimStatus(record.status, `${label}.status`);
      return { type, eventId, claimId: identifier(record.claimId, `${label}.claimId`), status, evidenceDigest: claimEvidence(status, record.evidenceDigest, `${label}.evidenceDigest`) };
    }
    case "consequence.observed": {
      const eventId = eventBase(record, ["semanticOperationId", "reservationId", "state", "authorityEvidenceDigest", "receiptDigest"], label);
      if (typeof record.state !== "string" || !CONSEQUENCE_STATES.has(record.state)) throw new ContinuityValidationError(`${label}.state is invalid`);
      return { type, eventId, semanticOperationId: identifier(record.semanticOperationId, `${label}.semanticOperationId`), reservationId: identifier(record.reservationId, `${label}.reservationId`), state: record.state as Exclude<import("../authority/ledger.js").LedgerState, "issued">, authorityEvidenceDigest: digest(record.authorityEvidenceDigest, `${label}.authorityEvidenceDigest`), receiptDigest: nullableDigest(record.receiptDigest, `${label}.receiptDigest`) };
    }
    case "exception.opened": {
      const eventId = eventBase(record, ["exceptionId", "reason", "evidenceDigest"], label);
      return { type, eventId, exceptionId: identifier(record.exceptionId, `${label}.exceptionId`), reason: text(record.reason, `${label}.reason`), evidenceDigest: nullableDigest(record.evidenceDigest, `${label}.evidenceDigest`) };
    }
    case "exception.resolved": {
      const eventId = eventBase(record, ["exceptionId", "resolution", "evidenceDigest"], label);
      return { type, eventId, exceptionId: identifier(record.exceptionId, `${label}.exceptionId`), resolution: text(record.resolution, `${label}.resolution`), evidenceDigest: digest(record.evidenceDigest, `${label}.evidenceDigest`) };
    }
    default:
      throw new ContinuityValidationError(`unknown continuity event type: ${type}`);
  }
}

export function normalizeAuthenticatedWorkload(value: unknown): AuthenticatedWorkloadV1 {
  const record = object(value, "authenticated actor");
  exactKeys(record, ["v", "taskId", "principalId", "workloadId", "runtimeSessionId", "harnessId"], [], "authenticated actor");
  if (record.v !== "reelier.authenticated-workload/v1") throw new ContinuityValidationError("authenticated actor version is invalid");
  return {
    v: record.v,
    taskId: identifier(record.taskId, "authenticated actor.taskId"),
    principalId: identifier(record.principalId, "authenticated actor.principalId"),
    workloadId: identifier(record.workloadId, "authenticated actor.workloadId"),
    runtimeSessionId: identifier(record.runtimeSessionId, "authenticated actor.runtimeSessionId"),
    harnessId: identifier(record.harnessId, "authenticated actor.harnessId"),
  };
}

export function normalizeContinuityCheckpoint(value: unknown, actorValue: unknown): NormalizedCheckpointV1 {
  const actor = normalizeAuthenticatedWorkload(actorValue);
  const record = object(value, "continuity checkpoint");
  exactKeys(record, ["v", "taskId", "expectedCursor", "actorPrincipalId", "workloadId", "jobCardDigest", "authoritySnapshotDigest", "proposedEvents", "evidenceRefs"], ["agentMemo"], "continuity checkpoint");
  if (record.v !== "reelier.continuity-checkpoint/v1") throw new ContinuityValidationError("continuity checkpoint version is invalid");
  const taskId = identifier(record.taskId, "continuity checkpoint.taskId");
  const actorPrincipalId = identifier(record.actorPrincipalId, "continuity checkpoint.actorPrincipalId");
  const workloadId = identifier(record.workloadId, "continuity checkpoint.workloadId");
  if (taskId !== actor.taskId || actorPrincipalId !== actor.principalId || workloadId !== actor.workloadId) {
    throw new ContinuityValidationError("continuity checkpoint does not match the authenticated actor");
  }
  if (!Number.isSafeInteger(record.expectedCursor) || (record.expectedCursor as number) < 0) {
    throw new ContinuityValidationError("continuity checkpoint.expectedCursor must be a non-negative safe integer");
  }
  if (!Array.isArray(record.proposedEvents)) throw new ContinuityValidationError("continuity checkpoint.proposedEvents must be an array");
  const proposedEvents = record.proposedEvents.map(normalizeEvent);
  const eventIds = proposedEvents.map((event) => event.eventId);
  if (new Set(eventIds).size !== eventIds.length) throw new ContinuityValidationError("continuity checkpoint contains duplicate event IDs");

  let agentMemo: ContinuityCheckpointV1["agentMemo"];
  if (record.agentMemo !== undefined) {
    const memo = object(record.agentMemo, "continuity checkpoint.agentMemo");
    exactKeys(memo, ["status", "text"], [], "continuity checkpoint.agentMemo");
    if (memo.status !== "unchecked") throw new ContinuityValidationError("agent memo status must be unchecked");
    agentMemo = { status: "unchecked", text: text(memo.text, "continuity checkpoint.agentMemo.text") };
  }

  const checkpoint: ContinuityCheckpointV1 = {
    v: record.v,
    taskId,
    expectedCursor: record.expectedCursor as number,
    actorPrincipalId,
    workloadId,
    jobCardDigest: digest(record.jobCardDigest, "continuity checkpoint.jobCardDigest"),
    authoritySnapshotDigest: digest(record.authoritySnapshotDigest, "continuity checkpoint.authoritySnapshotDigest"),
    proposedEvents,
    evidenceRefs: [...stringArray(record.evidenceRefs, "continuity checkpoint.evidenceRefs", "digest")].sort(),
    ...(agentMemo === undefined ? {} : { agentMemo }),
  };
  return { actor, checkpoint };
}
