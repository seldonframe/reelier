import { defineTool } from "eve/tools";
import { z } from "zod";
import { continuityRuntime } from "../lib/runtime.js";

export const MODEL_INPUT_KEYS = ["choices", "requestId", "sourceRefs"] as const;

const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const inputSchema = z.strictObject({
  choices: z.record(z.string(), scalar),
  requestId: z.string().min(1).max(256),
  sourceRefs: z.record(z.string(), z.string()),
});

export default defineTool({
  description: "Request one governed Outcome through the host-owned loopback Path C port.",
  inputSchema,
  async execute(input, ctx) {
    return continuityRuntime(ctx).requestOutcome({ v: "reelier.outcome-request/v1", ...input });
  },
});
