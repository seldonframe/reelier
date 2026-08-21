import { defineTool } from "eve/tools";
import { identifyAuthenticatedWorkload } from "../lib/binding.js";
import { statusRemoteOutcome } from "../lib/cell.js";
import { eveAgentToolInputSchema } from "../lib/agent-tool-schema.js";

export const MODEL_INPUT_KEYS = ["requestId"] as const;

export default defineTool({
  description: "Read the redacted lifecycle status of one governed Outcome request.",
  inputSchema: eveAgentToolInputSchema("reelier_outcome_status"),
  async execute(input, ctx) {
    identifyAuthenticatedWorkload(ctx);
    return statusRemoteOutcome((input as {requestId:string}).requestId);
  },
});
