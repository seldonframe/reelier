import { defineTool } from "eve/tools";
import { z } from "zod";
import { callAdapterContractTool } from "../lib/adapter-contract.js";

const inputSchema = z.strictObject({ requestId: z.string().min(1).max(256) });

export default defineTool({
  description: "Read outcome status through the frozen Reelier v0 adapter contract.",
  inputSchema,
  async execute(input) {
    return callAdapterContractTool("reelier_outcome_status", input, "outcomes.status");
  },
});
