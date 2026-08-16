import { access, writeFile } from "node:fs/promises";
import { defineTool } from "eve/tools";
import type { ContinuityCheckpointV1 } from "reelier/continuity";
import { z } from "zod";
import { checkpointDigests, checkpointProtocolVersion, continuityRuntime } from "../lib/runtime.js";

export const MODEL_INPUT_KEYS = ["events", "evidenceRefs", "expectedCursor", "agentMemo"] as const;

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u);
const text = z.string().min(1).max(16_384);
const nullableDigest = digest.nullable();
const claimStatus = z.enum(["failed", "unchecked", "absent"]);
const eventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("task.opened"), eventId: identifier, outcome: text, completionProjection: text, nonGoals: z.array(text) }),
  z.strictObject({ type: z.literal("decision.recorded"), eventId: identifier, decisionId: identifier, statement: text, decidedBy: identifier, binding: z.boolean(), evidenceDigest: nullableDigest }),
  z.strictObject({ type: z.literal("decision.superseded"), eventId: identifier, decisionId: identifier, supersededByDecisionId: identifier }),
  z.strictObject({ type: z.literal("obligation.opened"), eventId: identifier, obligationId: identifier, statement: text, acceptanceEvidence: text, ownerWorkloadId: identifier }),
  z.strictObject({ type: z.literal("obligation.transitioned"), eventId: identifier, obligationId: identifier, to: z.enum(["blocked", "satisfied", "abandoned"]), reason: text, evidenceDigest: nullableDigest }),
  z.strictObject({ type: z.literal("claim.recorded"), eventId: identifier, claimId: identifier, statement: text, status: claimStatus, evidenceDigest: nullableDigest }),
  z.strictObject({ type: z.literal("claim.updated"), eventId: identifier, claimId: identifier, status: claimStatus, evidenceDigest: nullableDigest }),
  z.strictObject({ type: z.literal("consequence.noted"), eventId: identifier, semanticOperationId: identifier, reservationId: identifier, state: z.enum(["reserved", "dispatched", "acknowledged", "definitive-failure", "ambiguous", "cancelled", "reconciled"]), evidenceDigest: nullableDigest }),
  z.strictObject({ type: z.literal("exception.opened"), eventId: identifier, exceptionId: identifier, reason: text, evidenceDigest: nullableDigest }),
  z.strictObject({ type: z.literal("exception.resolved"), eventId: identifier, exceptionId: identifier, resolution: text, evidenceDigest: digest }),
]);

const inputSchema = z.strictObject({
  events: z.array(eventSchema),
  evidenceRefs: z.array(digest),
  expectedCursor: z.number().int().nonnegative(),
  agentMemo: text.optional(),
});

export default defineTool({
  description: "Append an unchecked continuity checkpoint for the authenticated task and workload.",
  inputSchema,
  async execute(input, ctx) {
    const actor = await continuityRuntime(ctx).identify();
    const digests = checkpointDigests();
    const checkpoint: ContinuityCheckpointV1 = {
      v: checkpointProtocolVersion(),
      taskId: actor.taskId,
      expectedCursor: input.expectedCursor,
      actorPrincipalId: actor.principalId,
      workloadId: actor.workloadId,
      jobCardDigest: digests.jobCardDigest,
      authoritySnapshotDigest: digests.authoritySnapshotDigest,
      proposedEvents: input.events,
      evidenceRefs: input.evidenceRefs,
      ...(input.agentMemo === undefined ? {} : { agentMemo: { status: "unchecked", text: input.agentMemo } }),
    };
    const result = await continuityRuntime(ctx).checkpoint(checkpoint);
    if (process.env.REELIER_CHECKPOINT_CUT_MARKER) {
      let cutAlreadyReached = false;
      try { await access(process.env.REELIER_CHECKPOINT_CUT_MARKER); cutAlreadyReached = true; } catch {}
      if (!cutAlreadyReached) {
        await writeFile(process.env.REELIER_CHECKPOINT_CUT_MARKER, "committed\n", "utf8");
        await new Promise<never>(() => {});
      }
    }
    return result.ok
      ? { ok: true as const, cursor: result.cursor, segmentDigest: result.segmentDigest }
      : {
          ok: false as const,
          reason: result.reason,
          expectedCursor: result.expectedCursor,
          actualCursor: result.actualCursor,
        };
  },
});
