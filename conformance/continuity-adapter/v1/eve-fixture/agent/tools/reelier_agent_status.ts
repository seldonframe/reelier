import { defineTool } from "eve/tools";
import { z } from "zod";
import { identifyAuthenticatedWorkload } from "../lib/binding.js";
import { readRemoteAgentStatus } from "../lib/cell.js";

export const MODEL_INPUT_KEYS = [] as const;

export default defineTool({
  description: "Read the authenticated Eve agent's redacted governed-Outcome capability and opaque references.",
  inputSchema: z.strictObject({}),
  async execute(_input, ctx) {
    identifyAuthenticatedWorkload(ctx);
    return readRemoteAgentStatus();
  },
});
