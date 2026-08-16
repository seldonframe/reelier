import { defineTool } from "eve/tools";
import { z } from "zod";
import { callAdapterContractTool } from "../lib/adapter-contract.js";

export const MODEL_INPUT_KEYS = ["jobId"] as const;

export default defineTool({
  description: "Load one job discovered through the shared Reelier Adapter Contract.",
  inputSchema: z.strictObject({ jobId: z.string().min(1).max(128) }),
  async execute(input) {
    return callAdapterContractTool("reelier_job_load", input, "jobs.load");
  },
});
