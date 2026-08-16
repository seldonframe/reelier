import { defineTool } from "eve/tools";
import { z } from "zod";
import { continuityRuntime } from "../lib/runtime.js";
import { callAdapterContractTool, recordPathCOperation } from "../lib/adapter-contract.js";

export const MODEL_INPUT_KEYS = ["requestId"] as const;

const inputSchema = z.strictObject({ requestId: z.string().min(1).max(256) });

export default defineTool({
  description: "Read the redacted lifecycle status of one governed Outcome request.",
  inputSchema,
  async execute(input, ctx) {
    if (process.env.REELIER_EVE_AGENT_ADAPTER_V0 === "1") return callAdapterContractTool("reelier_outcome_status", input, "outcomes.status");
    const response = await continuityRuntime(ctx).statusOutcome(input);
    await recordPathCOperation("outcomes.status", input, response as unknown as Record<string, unknown>);
    return response;
  },
});
