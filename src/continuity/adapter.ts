import type { AuthorityIngressOutcome } from "../authority/ingress/mcp.js";
import type { OutcomeRequest } from "../authority/types.js";
import type { ContinuityAppendResultV1, FsContinuityLedger } from "./fs-ledger.js";
import { normalizeAuthenticatedWorkload } from "./normalize.js";
import { createResumeProjection, type ResumeProjectionV1 } from "./projection.js";
import type { AuthenticatedWorkloadV1, ContinuityCheckpointV1 } from "./types.js";

export type OutcomeRequesterV1 = (
  actor: AuthenticatedWorkloadV1,
  input: OutcomeRequest,
) => Promise<AuthorityIngressOutcome>;

export interface ContinuityRuntimeAdapterV1 {
  identify(): Promise<AuthenticatedWorkloadV1>;
  open(taskId: string): Promise<ResumeProjectionV1>;
  checkpoint(input: ContinuityCheckpointV1): Promise<ContinuityAppendResultV1>;
  requestOutcome(input: OutcomeRequest): Promise<AuthorityIngressOutcome>;
}

export interface ContinuityRuntimeAdapterOptionsV1 {
  readonly ledger: FsContinuityLedger;
  readonly identify: () => Promise<AuthenticatedWorkloadV1>;
  readonly requestOutcome: OutcomeRequesterV1;
}

export function createContinuityRuntimeAdapter(
  options: ContinuityRuntimeAdapterOptionsV1,
): ContinuityRuntimeAdapterV1 {
  const identify = async (): Promise<AuthenticatedWorkloadV1> => {
    return normalizeAuthenticatedWorkload(await options.identify());
  };
  return {
    identify,
    async open(taskId) {
      const actor = await identify();
      if (actor.taskId !== taskId) {
        throw new TypeError(`cross-task continuity access refused: authenticated task ${actor.taskId} cannot open ${taskId}`);
      }
      return createResumeProjection(await options.ledger.read(taskId));
    },
    async checkpoint(input) {
      return options.ledger.append(await identify(), input);
    },
    async requestOutcome(input) {
      return options.requestOutcome(await identify(), input);
    },
  };
}
