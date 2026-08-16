import { defineTool } from "eve/tools";
import { z } from "zod";
import { callAdapterContractTool } from "../lib/adapter-contract.js";

export const MODEL_INPUT_KEYS = ["query"] as const;

export default defineTool({
  description: "Discover deployed Reelier jobs through the shared Adapter Contract.",
  inputSchema: z.strictObject({ query: z.string().min(1).max(256) }),
  async execute(input) {
    return callAdapterContractTool("reelier_jobs_search", input, "jobs.search");
  },
});
