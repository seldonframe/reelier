import { defineTool } from "eve/tools";
import { z } from "zod";
import { identifyAuthenticatedWorkload } from "../lib/binding.js";
import { proposeRemoteOutcome } from "../lib/cell.js";

export const MODEL_INPUT_KEYS = ["outcomeRef"] as const;

export default defineTool({
  description: "Resolve one authenticated opaque Outcome reference without dispatching a provider effect.",
  inputSchema: z.strictObject({ outcomeRef: z.string().regex(/^(?:jobref|outcomeref)_[0-9a-f]{64}$/) }),
  async execute(input, ctx) {
    identifyAuthenticatedWorkload(ctx);
    return proposeRemoteOutcome(input.outcomeRef);
  },
});
