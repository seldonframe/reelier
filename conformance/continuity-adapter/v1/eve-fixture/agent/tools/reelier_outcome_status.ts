import { defineTool } from "eve/tools";
import { z } from "zod";
import { continuityRuntime } from "../lib/runtime.js";

export const MODEL_INPUT_KEYS = ["requestId"] as const;

const inputSchema = z.strictObject({ requestId: z.string().min(1).max(256) });

export default defineTool({
  description: "Read the redacted lifecycle status of one governed Outcome request.",
  inputSchema,
  async execute(input, ctx) {
    return continuityRuntime(ctx).statusOutcome(input);
  },
});
