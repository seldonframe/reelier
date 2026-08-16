import { defineTool } from "eve/tools";
import { z } from "zod";
import { callAdapterContractTool } from "../lib/adapter-contract.js";

export const MODEL_INPUT_KEYS = [] as const;

export default defineTool({
  description: "Bind the Eve session to the frozen Reelier Adapter Contract v1.",
  inputSchema: z.strictObject({}),
  async execute() {
    return callAdapterContractTool("reelier_adapter_contract", {}, "adapter.contract");
  },
});
