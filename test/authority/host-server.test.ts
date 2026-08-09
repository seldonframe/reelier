import test from "node:test";
import assert from "node:assert/strict";
import { createAuthorityHostServer } from "reelier/authority/host";

test("common host serves the same closed outcome over HTTP", async () => {
  const server = createAuthorityHostServer(
    { version: 1, tenant: "tenant_1", requester: "operator_1", definitions: ["gmail_reply_send_v1"], topology: "same-user", ledgerDir: ".", decisionDir: ".", receiptDir: ".", endpoints: [] },
    {
      async outcome(alias, input, context) {
        assert.equal(alias, "gmail_reply_send_v1");
        assert.deepEqual(context, { tenant: "tenant_1", requester: "operator_1" });
        return { requestId: String((input as Record<string, unknown>).requestId), verdict: "accepted", reasonCode: "accepted", lifecycleState: "reserved" };
      },
      async status(input) { return { requestId: String((input as Record<string, unknown>).requestId), verdict: "accepted", reasonCode: "found", lifecycleState: "ambiguous" }; },
    },
  );
  await server.startHttp(0);
  const address = server.http.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/outcomes/gmail_reply_send_v1`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "r1", sourceRefs: { thread: "opaque" }, choices: {} }) });
  assert.equal(response.status, 202);
  assert.equal((await response.json() as { lifecycleState: string }).lifecycleState, "reserved");
  await server.close();
});
