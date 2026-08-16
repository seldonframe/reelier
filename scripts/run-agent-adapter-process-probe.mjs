import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";

const harnessId = process.argv[2] === "--harness" ? process.argv[3] : "";
const output = process.argv[4] === "--out" ? path.resolve(process.argv[5] ?? "") : "";
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(harnessId) || !output) throw new TypeError("usage: run-agent-adapter-process-probe.mjs --harness <id> --out <directory>");

const captureLog = path.join(output, "mcp-events.jsonl");
await mkdir(output, { recursive: true });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["scripts/serve-agent-adapter-contract.mjs", "--harness", harnessId],
  cwd: process.cwd(),
  env: { ...process.env, REELIER_ADAPTER_CAPTURE: captureLog },
  stderr: "pipe",
});
const client = new Client({ name: `reelier-${harnessId}-adapter-probe`, version: "0.32.1" }, { capabilities: {} });
const calls = [];
const call = async (name, args) => {
  calls.push(name);
  const result = await client.callTool({ name, arguments: args });
  const text = result?.content?.find(part => part?.type === "text")?.text;
  if (typeof text !== "string") throw new TypeError(`${name} returned no JSON text`);
  return JSON.parse(text);
};
let stderr = "";
transport.stderr?.on("data", chunk => { stderr += String(chunk); });
try {
  await client.connect(transport);
  const inventory = (await client.listTools()).tools.map(tool => tool.name);
  const contract = await call("reelier_adapter_contract", {});
  if (contract?.v !== "reelier.adapter-contract/v1" || !/^sha256:[0-9a-f]{64}$/.test(contract.digest)) throw new TypeError("adapter contract digest is not frozen");
  const search = { operation: "jobs.search", request: { query: "reversible record state" }, response: await call("reelier_jobs_search", { query: "reversible record state" }) };
  const discoveredJobRef = search.response.jobs[0]?.jobRef;
  const load = { operation: "jobs.load", request: { jobRef: discoveredJobRef }, response: await call("reelier_job_load", { jobId: discoveredJobRef }) };
  const childPrincipalId = `principal_${harnessId}_process_child`;
  const delegation = { operation: "delegations.request", request: { taskId: `task_${harnessId}_process`, parentAllocationId: `allocation_${harnessId}_root`, childPrincipalId, effects: 1 }, response: await call("reelier_delegation_request", { child: { principalId: childPrincipalId }, effects: 1 }) };
  const invoke = { operation: "outcomes.invoke", request: { jobRef: discoveredJobRef, requestId: `request_${harnessId}_process_1`, sourceRefs: { record: "opaque_process_ref" }, choices: {} }, response: await call("reelier_outcome_invoke", { jobRef: discoveredJobRef, requestId: `request_${harnessId}_process_1`, sourceRefs: { record: "opaque_process_ref" }, choices: {} }) };
  const status = { operation: "outcomes.status", request: { requestId: invoke.request.requestId }, response: await call("reelier_outcome_status", { requestId: invoke.request.requestId }) };
  const events = JSON.parse(`[${(await readFile(captureLog, "utf8")).trim().split("\n").filter(Boolean).join(",")}]`);
  const digest = value => `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
  const report = {
    v: "reelier.agent-adapter-process-report/v1",
    harnessId,
    adapterId: harnessId,
    execution: "process-boundary",
    contract: { v: contract.v, digest: contract.digest, bound: true },
    hostBinding: { taskId: `task_${harnessId}_process`, principalId: `principal_${harnessId}_process`, allocationId: `allocation_${harnessId}_root` },
    toolInventory: inventory,
    toolCalls: calls,
    transcript: [search, load, delegation, invoke, status],
    providerEffect: { dispatch: "absent", receipt: "absent", reason: "adapter-contract-pending" },
    coverage: { mode: "observed", topology: "unchecked", completeness: "unchecked", rawWriteReachability: "unknown" },
    eventDigest: digest(events),
    status: invoke.response.verdict === "refused" && invoke.response.reasonCode === "adapter-contract-pending" && status.response.pass === false ? "passed" : "failed",
    stderr: stderr.slice(-4000),
  };
  await writeFile(path.join(output, "process-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(output, "process-events.json"), `${JSON.stringify(events, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ harnessId, execution: report.execution, status: report.status, contractDigest: contract.digest, output })}\n`);
  process.exitCode = report.status === "passed" ? 0 : 1;
} finally {
  await client.close().catch(() => {});
}
