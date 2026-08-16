import { defineTool } from "eve/tools";
import { z } from "zod";
import { callAdapterContractTool } from "../lib/adapter-contract.js";

export const MODEL_INPUT_KEYS = ["taskId"] as const;

export default defineTool({
  description: "Read the redacted task state through the shared Reelier Adapter Contract.",
  inputSchema: z.strictObject({ taskId: z.string().min(1) }),
  async execute(input) {
    return callAdapterContractTool("reelier_task_status", input, "tasks.status");
  },
});
