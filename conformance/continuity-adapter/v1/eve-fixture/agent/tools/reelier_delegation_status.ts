import { defineTool } from "eve/tools";
import { z } from "zod";
import { callAdapterContractTool } from "../lib/adapter-contract.js";

export const MODEL_INPUT_KEYS = ["grantId"] as const;

export default defineTool({
  description: "Read a child delegation through the shared Reelier Adapter Contract.",
  inputSchema: z.strictObject({ grantId: z.string().min(1) }),
  async execute(input) {
    return callAdapterContractTool("reelier_delegation_status", input, "delegations.status");
  },
});
