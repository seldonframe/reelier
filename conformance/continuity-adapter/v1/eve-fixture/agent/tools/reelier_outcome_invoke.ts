import { defineTool } from "eve/tools";
import { z } from "zod";
import { continuityRuntime } from "../lib/runtime.js";
import { recordPathCOperation } from "../lib/adapter-contract.js";

export const MODEL_INPUT_KEYS = ["jobRef", "requestId", "sourceRefs", "choices"] as const;

const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const inputSchema = z.strictObject({
  jobRef: z.string().min(1).max(128),
  requestId: z.string().min(1).max(256),
  sourceRefs: z.record(z.string(), z.string()),
  choices: z.record(z.string(), scalar),
});

export default defineTool({
  description: "Invoke a discovered job through the authenticated loopback Path C port.",
  inputSchema,
  async execute(input, ctx) {
    const response = await continuityRuntime(ctx).requestOutcome({ v: "reelier.outcome-request/v1", requestId: input.requestId, sourceRefs: input.sourceRefs, choices: input.choices });
    await recordPathCOperation("outcomes.invoke", input, response as unknown as Record<string, unknown>);
    return response;
  },
});
