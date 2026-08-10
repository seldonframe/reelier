import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { handleAuthorityHttp } from "reelier/authority/host";

test("authority REST exposes job search and load with host identity", async () => {
  const server = createServer((request, response) => {
    void handleAuthorityHttp(request, response, {
      async outcome() { return { requestId: "r1", verdict: "accepted", reasonCode: "accepted", lifecycleState: "reconciled" }; },
      async status() { return { requestId: "r1", verdict: "accepted", reasonCode: "accepted", lifecycleState: "reconciled" }; },
      async jobsSearch(_input, context) { return { tenant: context.tenant, requester: context.requester, jobs: [{ jobId: "job_1" }] }; },
      async jobLoad(input, context) { return { tenant: context.tenant, requester: context.requester, jobRef: (input as { jobId: string }).jobId }; },
    }, { tenant: "tenant_1", requester: "agent_1" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const search = await getJson(`http://127.0.0.1:${address.port}/v1/jobs?query=customer`);
    assert.deepEqual(search.jobs, [{ jobId: "job_1" }]);
    assert.equal(search.tenant, "tenant_1");
    const loaded = await postJson(`http://127.0.0.1:${address.port}/v1/jobs/job_1/load`, {});
    assert.equal(loaded.jobRef, "job_1");
    assert.equal(loaded.requester, "agent_1");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function getJson(url: string): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => { const req = httpRequest(url, { method: "GET" }, response => { let body = ""; response.setEncoding("utf8"); response.on("data", chunk => body += chunk); response.on("end", () => resolve(JSON.parse(body))); }); req.on("error", reject); req.end(); });
}
async function postJson(url: string, body: unknown): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => { const req = httpRequest(url, { method: "POST", headers: { "content-type": "application/json" } }, response => { let text = ""; response.setEncoding("utf8"); response.on("data", chunk => text += chunk); response.on("end", () => resolve(JSON.parse(text))); }); req.on("error", reject); req.end(JSON.stringify(body)); });
}
