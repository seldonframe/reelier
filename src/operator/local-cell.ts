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
}

export function createOperatorLocalCellV1(input: {
  readonly agentTools: AuthorityAgentToolsV1;
  readonly processFactory?: ReturnType<typeof createOperatorHarnessProcessV1>;
}): OperatorLocalCellV1 {
  return Object.freeze({
    mode: "local-cell" as const,
    agentTools: input.agentTools,
    supervisor: createOperatorSupervisorV1({ cell: input.agentTools, processFactory: input.processFactory }),
  });
}
