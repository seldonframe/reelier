import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

type CanonicalAgentTools = Readonly<{
  AGENT_TOOL_CONTRACTS_V1: readonly Readonly<{ name: string; inputSchema: Readonly<Record<string, unknown>> }>[];
  parseAgentToolOutputV1(name: string, value: unknown): Readonly<Record<string, unknown>>;
}>;

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("reelier/package.json"));
const canonical = await import(pathToFileURL(join(packageRoot, "dist/authority/ingress/agent-tool-contracts.js")).href) as CanonicalAgentTools;
const { AGENT_TOOL_CONTRACTS_V1, parseAgentToolOutputV1 } = canonical;

export { parseAgentToolOutputV1 };

/** Eve consumes the canonical JSON Schema directly; tool files never restate quartet fields. */
export function eveAgentToolInputSchema(name: string): z.ZodType {
  const contract = AGENT_TOOL_CONTRACTS_V1.find(item => item.name === name);
  if (!contract) throw new TypeError("canonical Reelier agent tool is unavailable");
  return z.fromJSONSchema(contract.inputSchema as never);
}
