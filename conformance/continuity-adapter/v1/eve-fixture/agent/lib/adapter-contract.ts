import { appendFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type JsonRecord = Record<string, unknown>;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function record(event: JsonRecord): Promise<void> {
  const path = process.env.REELIER_EVE_CONTRACT_TRACE;
  if (path) await appendFile(path, `${JSON.stringify({ observedAt: new Date().toISOString(), ...event })}\n`, "utf8");
}

function resultJson(result: unknown, toolName: string): JsonRecord {
  const text = (result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content?.find(part => part.type === "text")?.text;
  if (typeof text !== "string") throw new TypeError(`${toolName} returned no JSON text`);
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${toolName} returned a non-record`);
  return value as JsonRecord;
}

export async function callAdapterContractTool(toolName: string, input: JsonRecord, operation: string): Promise<JsonRecord> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [required("REELIER_ADAPTER_CONTRACT_SERVER"), "--harness", "eve"],
    cwd: process.cwd(),
    env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
  });
  const client = new Client({ name: "reelier-eve-live-contract", version: "1.0.0" }, { capabilities: {} });
  try {
    await client.connect(transport);
    const result = resultJson(await client.callTool({ name: toolName, arguments: input }), toolName);
    await record({ tool: toolName, operation, input, response: result });
    return result;
  } finally {
    await client.close().catch(() => {});
  }
}

export async function recordPathCOperation(operation: string, input: JsonRecord, response: JsonRecord): Promise<void> {
  await record({ tool: operation === "outcomes.invoke" ? "reelier_outcome_invoke" : "reelier_outcome_status", operation, input, response });
}
