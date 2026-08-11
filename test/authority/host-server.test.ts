import test from "node:test";
import assert from "node:assert/strict";
import { createAuthorityHostServer, createPrincipalRegistry } from "reelier/authority/host";

test("common host serves the same closed outcome over HTTP", async () => {
  const principals = createPrincipalRegistry({ tenant: "tenant_1" });
  const credential = await principals.issue({ principalId: "agent_1", taskId: "task_1", grantId: "grant_1", grantDigest: `sha256:${"a".repeat(64)}`, allocationId: "allocation_1", runtimeSessionId: "session_1", jobId: "gmail_reply_send_v1", authorityCellId: "cell_1", expiresAt: "2099-01-01T00:00:00.000Z" });
  const server = createAuthorityHostServer(
    { version: 1, tenant: "tenant_1", requester: "operator_1", definitions: ["gmail_reply_send_v1"], topology: "same-user", ledgerDir: ".", decisionDir: ".", receiptDir: ".", endpoints: [] },
    {
      async outcome(alias, input, context) {
        assert.equal(alias, "gmail_reply_send_v1");
        assert.equal(context.tenant, "tenant_1");
        assert.equal(context.requester, "agent_1");
        assert.equal(context.executionContext?.taskId, "task_1");
        return { requestId: String((input as Record<string, unknown>).requestId), verdict: "accepted", reasonCode: "accepted", lifecycleState: "reserved" };
      },
      async status(input) { return { requestId: String((input as Record<string, unknown>).requestId), verdict: "accepted", reasonCode: "found", lifecycleState: "ambiguous" }; },
    }, { principalRegistry: principals },
  );
  await server.startHttp(0);
  const address = server.http.address();
  assert.ok(address && typeof address !== "string");
  const refused = await fetch(`http://127.0.0.1:${address.port}/v1/outcomes/gmail_reply_send_v1`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "r0", sourceRefs: { thread: "opaque" }, choices: {} }) });
  assert.equal(refused.status, 401);
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/outcomes/gmail_reply_send_v1`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${credential.token}` }, body: JSON.stringify({ requestId: "r1", sourceRefs: { thread: "opaque" }, choices: {} }) });
  assert.equal(response.status, 202);
  assert.equal((await response.json() as { lifecycleState: string }).lifecycleState, "reserved");
  await server.close();
});

test("HTTP never substitutes the configured requester when no scoped principal registry is present", async () => {
  const server = createAuthorityHostServer(
    { version: 1, tenant: "tenant_1", requester: "operator_1", definitions: [], ledgerDir: ".", decisionDir: ".", receiptDir: ".", endpoints: [] },
    { async outcome() { throw new Error("must not run"); }, async status() { throw new Error("must not run"); } },
  );
  await server.startHttp(0);
  const address = server.http.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/outcomes/example`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "r1" }) });
    assert.equal(response.status, 401);
  } finally { await server.close(); }
});
