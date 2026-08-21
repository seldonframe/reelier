import { defineTool } from "eve/tools";
import { identifyAuthenticatedWorkload } from "../lib/binding.js";
import { requestRemoteOutcome } from "../lib/cell.js";
import { eveAgentToolInputSchema } from "../lib/agent-tool-schema.js";

export const MODEL_INPUT_KEYS = ["outcomeRef", "choices", "requestId", "sourceRefs"] as const;

export default defineTool({
  description: "Request one governed Outcome through the remote Reelier Authority Cell.",
  inputSchema: eveAgentToolInputSchema("reelier_outcome_request"),
  async execute(input, ctx) {
    identifyAuthenticatedWorkload(ctx);
    return requestRemoteOutcome(input as never);
  },
});
