import { defineTool } from "eve/tools";
import { z } from "zod";
import { identifyAuthenticatedWorkload } from "../lib/binding.js";
import { searchCellJobs } from "../lib/cell.js";

export const MODEL_INPUT_KEYS = ["query"] as const;

const inputSchema = z.strictObject({ query: z.string().max(256).optional() });

export default defineTool({
  description: "Search the remote Reelier Authority Cell's deployed job catalogue. Read-only: no Outcome is invoked and nothing is written.",
  inputSchema,
  async execute(input, ctx) {
    // The same binding invariant the continuity tools enforce: a follow-up from a different
    // principal, task, or workload refuses here rather than reaching the Cell's bearer.
    identifyAuthenticatedWorkload(ctx);
    return searchCellJobs(input.query ?? "");
  },
});
