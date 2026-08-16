import { defineTool } from "eve/tools";
import { z } from "zod";
import { callAdapterContractTool } from "../lib/adapter-contract.js";

const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const inputSchema = z.strictObject({
  jobRef: z.string().min(1).max(128),
  requestId: z.string().min(1).max(256),
  sourceRefs: z.record(z.string(), z.string()),
  choices: z.record(z.string(), scalar),
});

export default defineTool({
  description: "Invoke the frozen Reelier v0 adapter contract through the live Eve process.",
  inputSchema,
  async execute(input) {
    return callAdapterContractTool("reelier_outcome_invoke", input, "outcomes.invoke");
  },
});
