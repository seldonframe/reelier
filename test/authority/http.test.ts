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
      async delegationRequest(_input, context) { return { tenant: context.tenant, requester: context.requester, lifecycleState: "allocated" }; },
      async delegationStatus(_input, context) { return { tenant: context.tenant, requester: context.requester, lifecycleState: "allocated" }; },
      async taskCreate(input, context) { return { tenant: context.tenant, requester: context.requester, taskId: (input as { taskId: string }).taskId, lifecycleState: "active" }; },
      async taskStatus(_input, context) { return { tenant: context.tenant, requester: context.requester, lifecycleState: "active" }; },
    }, { tenant: "tenant_1", requester: "unused", resolvePrincipal: async header => header === "Bearer scoped" ? { tenant: "tenant_1", requester: "agent_1", executionContext: { v: "reelier.authority-execution-context/v1", taskId: "task_1", principalId: "agent_1", grantId: "grant_1", grantDigest: `sha256:${"a".repeat(64)}`, allocationId: "allocation_1", runtimeSessionId: "session_1", jobId: "job_1", authorityCellId: "cell_1" } } : undefined });
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
    const delegated = await postJson(`http://127.0.0.1:${address.port}/v1/delegations`, { tenant: "attacker", parentPrincipal: "attacker" });
    assert.equal(delegated.reasonCode, "invalid-request");
    const delegationStatus = await getJson(`http://127.0.0.1:${address.port}/v1/delegations/grant_1`);
    assert.equal(delegationStatus.requester, "agent_1");
    const createdTask = await postJson(`http://127.0.0.1:${address.port}/v1/tasks`, { taskId: "task_new", rootGrant: {}, effects: 1 });
    assert.equal(createdTask.taskId, "task_new");
    assert.equal(createdTask.requester, "agent_1");
    const taskStatus = await getJson(`http://127.0.0.1:${address.port}/v1/tasks/task_1`);
    assert.equal(taskStatus.requester, "agent_1");
    const forgedOutcome = await postJson(`http://127.0.0.1:${address.port}/v1/outcomes/example`, { requestId: "forged", sourceRefs: {}, choices: {}, taskId: "attacker-task", principalId: "attacker" });
    assert.equal(forgedOutcome.reasonCode, "invalid-request");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("authority REST invokes a loaded Outcome only through the opaque job reference", async () => {
  const seen: Array<Readonly<{ input: unknown; requester: string; taskId: string | undefined }>> = [];
  const server = createServer((request, response) => {
    void handleAuthorityHttp(request, response, {
      async outcome() { throw new Error("the invoke route must never reach the alias-direct handler"); },
      async status() { throw new Error("not reached"); },
      async invoke(input, context) {
        seen.push({ input, requester: context.requester, taskId: context.executionContext?.taskId });
        return { requestId: String((input as Record<string, unknown>).requestId ?? ""), verdict: "accepted", reasonCode: "accepted", lifecycleState: "reserved" };
      },
    }, { tenant: "tenant_1", requester: "unused", resolvePrincipal: async header => header === "Bearer scoped" ? { tenant: "tenant_1", requester: "agent_1", executionContext: { v: "reelier.authority-execution-context/v1", taskId: "task_1", principalId: "agent_1", grantId: "grant_1", grantDigest: `sha256:${"a".repeat(64)}`, allocationId: "allocation_1", runtimeSessionId: "session_1", jobId: "job_1", authorityCellId: "cell_1" } } : undefined });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const ref = `jobref_${"1".repeat(64)}`;
  const invoke = async (body: unknown, authorization?: string, reference = ref) => fetch(`${base}/v1/jobs/${reference}/invoke`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  try {
    // Unauthenticated is refused before the handler is consulted at all.
    const anonymous = await invoke({ requestId: "anonymous", sourceRefs: {}, choices: {} });
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await anonymous.json(), { verdict: "refused", reasonCode: "authentication-required", lifecycleState: "refused", requestId: "" });
    assert.equal(seen.length, 0);

    // The authenticated call reaches the SAME `handler.invoke` the MCP tool calls, with the same
    // stamped envelope, the same server-derived context, and the route's reference bound in.
    const accepted = await invoke({ requestId: "r1", sourceRefs: { thread: "opaque" }, choices: {} }, "Bearer scoped");
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), { requestId: "r1", verdict: "accepted", reasonCode: "accepted", lifecycleState: "reserved" });
    assert.deepEqual(seen[0]!.input, { v: "reelier.outcome-request/v1", requestId: "r1", sourceRefs: { thread: "opaque" }, choices: {}, jobRef: ref });
    assert.equal(seen[0]!.requester, "agent_1");
    assert.equal(seen[0]!.taskId, "task_1");

    // A caller-supplied envelope version is preserved rather than rewritten.
    const versioned = await invoke({ v: "reelier.outcome-request/v9", requestId: "r2", sourceRefs: {}, choices: {} }, "Bearer scoped");
    assert.equal(versioned.status, 202);
    assert.equal((seen[1]!.input as Record<string, unknown>).v, "reelier.outcome-request/v9");

    // A body that names a different reference is refused, never silently rebound to the route's.
    const mismatched = await invoke({ jobRef: `jobref_${"2".repeat(64)}`, requestId: "r3", sourceRefs: {}, choices: {} }, "Bearer scoped");
    assert.equal(mismatched.status, 400);
    assert.deepEqual(await mismatched.json(), { verdict: "refused", reasonCode: "invalid-request", lifecycleState: "refused", requestId: "" });
    assert.equal(seen.length, 2);

    // Malformed and non-record bodies refuse with the same closed shape: never a 500, never an
    // internal message, never a dispatch.
    for (const malformed of ["{not json", JSON.stringify([]), JSON.stringify("string"), ""]) {
      const response = await invoke(malformed, "Bearer scoped");
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { verdict: "refused", reasonCode: "invalid-request", lifecycleState: "refused", requestId: "" });
    }
    assert.equal(seen.length, 2);

    // GET is not an invoke, and the route is exact: neither degrades into the alias-direct handler.
    const wrongMethod = await fetch(`${base}/v1/jobs/${ref}/invoke`, { method: "GET", headers: { authorization: "Bearer scoped" } });
    assert.equal(wrongMethod.status, 404);
    assert.equal(seen.length, 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("authority REST refuses invoke when the host wires no invoke handler", async () => {
  const server = createServer((request, response) => {
    void handleAuthorityHttp(request, response, {
      async outcome() { throw new Error("not reached"); },
      async status() { throw new Error("not reached"); },
    }, { tenant: "tenant_1", requester: "unused", resolvePrincipal: async header => header === "Bearer scoped" ? { tenant: "tenant_1", requester: "agent_1", executionContext: { v: "reelier.authority-execution-context/v1", taskId: "task_1", principalId: "agent_1", grantId: "grant_1", grantDigest: `sha256:${"a".repeat(64)}`, allocationId: "allocation_1", runtimeSessionId: "session_1", jobId: "job_1", authorityCellId: "cell_1" } } : undefined });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/jobs/jobref_1/invoke`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer scoped" }, body: JSON.stringify({ requestId: "r1", sourceRefs: {}, choices: {} }) });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { verdict: "refused", reasonCode: "job-invocation-unavailable", lifecycleState: "unavailable", requestId: "" });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("authority identity is authenticated, closed, and server-derived", async () => {
  const server = createServer((request, response) => {
    void handleAuthorityHttp(request, response, {
      async outcome() { throw new Error("not reached"); },
      async status() { throw new Error("not reached"); },
    }, {
      tenant: "tenant_1",
      requester: "unused",
      resolvePrincipal: async (header: string | undefined) => header === "Bearer scoped" ? {
        tenant: "tenant_1", requester: "agent_1",
        executionContext: { v: "reelier.authority-execution-context/v1", taskId: "task_1", principalId: "agent_1", grantId: "grant_1", grantDigest: `sha256:${"a".repeat(64)}`, allocationId: "allocation_1", runtimeSessionId: "session_1", jobId: "job_1", authorityCellId: "cell_linux_1" },
      } : undefined,
      identity: { cellId: "cell_linux_1", adapterContractDigest: `sha256:${"b".repeat(64)}` },
    } as never);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const anonymous = await fetch(`http://127.0.0.1:${address.port}/v1/identity`);
    assert.equal(anonymous.status, 401);
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/identity`, { headers: { authorization: "Bearer scoped" } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      v: "reelier.authority-cell-identity/v1",
      cellId: "cell_linux_1",
      adapterContractDigest: `sha256:${"b".repeat(64)}`,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function getJson(url: string): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => { const req = httpRequest(url, { method: "GET", headers: { authorization: "Bearer scoped" } }, response => { let body = ""; response.setEncoding("utf8"); response.on("data", chunk => body += chunk); response.on("end", () => resolve(JSON.parse(body))); }); req.on("error", reject); req.end(); });
}
async function postJson(url: string, body: unknown): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => { const req = httpRequest(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer scoped" } }, response => { let text = ""; response.setEncoding("utf8"); response.on("data", chunk => text += chunk); response.on("end", () => resolve(JSON.parse(text))); }); req.on("error", reject); req.end(JSON.stringify(body)); });
}
