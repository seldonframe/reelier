import { defineTool } from "eve/tools";
import { identifyAuthenticatedWorkload } from "../lib/binding.js";
import { readRemoteAgentStatus } from "../lib/cell.js";
import { eveAgentToolInputSchema } from "../lib/agent-tool-schema.js";

export const MODEL_INPUT_KEYS = [] as const;

export default defineTool({
  description: "Read the authenticated Eve agent's redacted governed-Outcome capability and opaque references.",
  inputSchema: eveAgentToolInputSchema("reelier_agent_status"),
  async execute(_input, ctx) {
    identifyAuthenticatedWorkload(ctx);
    return readRemoteAgentStatus();
  },
});
