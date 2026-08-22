import type { AuthorityAgentToolsV1 } from "../authority/host/agent-tools.js";
import { createOperatorHarnessProcessV1 } from "./process.js";
import { createOperatorSupervisorV1, type OperatorSupervisorV1 } from "./operator.js";

/**
 * The local Cell adapter is intentionally boring: the genuine runtime owns
 * reservations, providers, receipts, and recovery; this module only exposes
 * its canonical quartet to the Operator supervisor.
 */
export interface OperatorLocalCellV1 {
  readonly mode: "local-cell";
  readonly agentTools: AuthorityAgentToolsV1;
  readonly supervisor: OperatorSupervisorV1;
  readonly inspectEvidence: () => Promise<Readonly<Record<string, unknown>>>;
  readonly reviewOutcomes: (requestIds: readonly string[]) => Promise<void>;
}

export interface OperatorGenuineRuntimeV1 {
  readonly agentTools: AuthorityAgentToolsV1;
  readonly inspectEvidence: () => Promise<Readonly<Record<string, unknown>>>;
  readonly reviewOutcomes: (requestIds: readonly string[]) => Promise<void>;
}

export function createOperatorLocalCellV1(input: {
  readonly agentTools: AuthorityAgentToolsV1;
  readonly processFactory?: ReturnType<typeof createOperatorHarnessProcessV1>;
  readonly inspectEvidence?: () => Promise<Readonly<Record<string, unknown>>>;
  readonly reviewOutcomes?: (requestIds: readonly string[]) => Promise<void>;
}): OperatorLocalCellV1 {
  const inspectEvidence = input.inspectEvidence ?? (async () => Object.freeze({ completeness: "unchecked" }));
  const reviewOutcomes = input.reviewOutcomes ?? (async () => undefined);
  return Object.freeze({
    mode: "local-cell" as const,
    agentTools: input.agentTools,
    supervisor: createOperatorSupervisorV1({ cell: input.agentTools, processFactory: input.processFactory }),
    inspectEvidence,
    reviewOutcomes,
  });
}

/** Adapt the reviewed genuine runtime; this function owns no ledger or provider state. */
export function createOperatorLocalCellFromRuntimeV1(input: {
  readonly runtime: OperatorGenuineRuntimeV1;
  readonly processFactory?: ReturnType<typeof createOperatorHarnessProcessV1>;
}): OperatorLocalCellV1 {
  return createOperatorLocalCellV1({
    agentTools: input.runtime.agentTools,
    processFactory: input.processFactory,
    inspectEvidence: input.runtime.inspectEvidence,
    reviewOutcomes: input.runtime.reviewOutcomes,
  });
}
