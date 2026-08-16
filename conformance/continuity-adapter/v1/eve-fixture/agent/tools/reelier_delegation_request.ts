import { defineTool } from "eve/tools";
import { z } from "zod";
import { callAdapterContractTool } from "../lib/adapter-contract.js";

export const MODEL_INPUT_KEYS = ["child", "effects"] as const;

export default defineTool({
  description: "Request a narrower child allocation through the shared Reelier Adapter Contract.",
  inputSchema: z.strictObject({ child: z.strictObject({ principalId: z.string().min(1) }), effects: z.number().int().nonnegative() }),
  async execute(input) {
    return callAdapterContractTool("reelier_delegation_request", input, "delegations.request");
  },
});
