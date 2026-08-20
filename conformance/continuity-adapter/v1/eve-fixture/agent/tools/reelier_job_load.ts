import { defineTool } from "eve/tools";
import { z } from "zod";
import { identifyAuthenticatedWorkload } from "../lib/binding.js";
import { loadCellJob } from "../lib/cell.js";

export const MODEL_INPUT_KEYS = ["jobRef"] as const;

const inputSchema = z.strictObject({ jobRef: z.string().min(1).max(128) });

export default defineTool({
  description: "Load one opaque job reference from the remote Reelier Authority Cell. Read-only: loading resolves the reference, it never invokes the Outcome.",
  inputSchema,
  async execute(input, ctx) {
    identifyAuthenticatedWorkload(ctx);
    return loadCellJob(input.jobRef);
  },
});
