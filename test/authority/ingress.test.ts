import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildAuthorityMcpServer } from "reelier/authority/host";

test("authority MCP exposes a compact job catalog and loaded Outcome fallback", async () => {
  const server = buildAuthorityMcpServer([{ alias: "gmail_reply_send_v1" }], {
    async outcome() { return { requestId: "r1", verdict: "accepted", reasonCode: "accepted", lifecycleState: "reconciled" }; },
    async status() { return { requestId: "r1", verdict: "accepted", reasonCode: "accepted", lifecycleState: "reconciled" }; },
    async jobsSearch() { return { requestId: "", verdict: "accepted", reasonCode: "jobs-found", lifecycleState: "catalog", jobs: [{ jobId: "job_1", alias: "gmail_reply_send_v1" }] }; },
    async jobLoad() { return { requestId: "", verdict: "accepted", reasonCode: "job-loaded", lifecycleState: "loaded", jobRef: "job_1" }; },
    async invoke() { return { requestId: "r1", verdict: "accepted", reasonCode: "accepted", lifecycleState: "reconciled" }; },
  }, { tenant: "tenant_1", requester: "agent_1" }, async input => input);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1" }, { capabilities: {} });
  await client.connect(clientTransport);
  const names = (await client.listTools()).tools.map(tool => tool.name).sort();
  assert.deepEqual(names, ["reelier_jobs_search", "reelier_job_load", "reelier_delegation_request", "reelier_delegation_status", "reelier_task_status", "reelier_outcome_invoke", "reelier_outcome_gmail_reply_send_v1", "reelier_outcome_status", "reelier_artifact_stage"].sort());
  const loaded = await client.callTool({ name: "reelier_job_load", arguments: { jobId: "job_1" } });
  assert.match(String(((loaded as unknown as { content: Array<{ text: string }> }).content[0]).text), /job-loaded/);
  await client.close();
  await server.close();
});
