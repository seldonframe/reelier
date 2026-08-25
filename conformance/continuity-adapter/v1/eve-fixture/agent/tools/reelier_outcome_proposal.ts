import { defineTool } from "eve/tools";
import { identifyAuthenticatedWorkload } from "../lib/binding.js";
import { proposeRemoteOutcome } from "../lib/cell.js";
import { eveAgentToolInputSchema } from "../lib/agent-tool-schema.js";

export const MODEL_INPUT_KEYS = ["outcomeRef"] as const;

export default defineTool({
  description: "Resolve one authenticated opaque Outcome reference without dispatching a provider effect.",
  inputSchema: eveAgentToolInputSchema("reelier_outcome_proposal"),
  async execute(input, ctx) {
    identifyAuthenticatedWorkload(ctx);
    return proposeRemoteOutcome((input as {outcomeRef:string}).outcomeRef);
  },
});
