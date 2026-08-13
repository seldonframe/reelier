import test from "node:test";
import assert from "node:assert/strict";
import { createMcpDispatchAdapter } from "reelier/authority/host";

test("adopted MCP dispatch calls only the operator-mapped tool and redacts provider bodies", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const adapter = createMcpDispatchAdapter({
    connection: {
      async call(name: string, args: unknown) { calls.push({ name, args }); return { content: [{ type: "text", text: "provider-secret" }] }; },
      async close() {},
    } as never,
    routes: [{ endpointId: "gmail.users.messages.send", toolName: "composio__GMAIL_SEND_EMAIL", encodeArgs: effect => ({ sealed: (effect as { bodyBase64: string }).bodyBase64 }) }],
  });
  const outcome = await adapter.dispatch({
    reservation: { reservationId: "reservation_1", state: "reserved", intent: { effectDigest: "sha256:" + "a".repeat(64) } },
    effect: { v: "reelier.transport-effect/v1", endpointId: "gmail.users.messages.send", bodyBase64: "YQ==" },
    effectCanonicalBase64: "",
    effectDigest: "sha256:" + "a".repeat(64),
  });
  assert.equal(outcome.kind, "acknowledged");
  assert.equal(calls[0].name, "composio__GMAIL_SEND_EMAIL");
  assert.deepEqual(calls[0].args, { sealed: "YQ==" });
  assert.equal(JSON.stringify(outcome).includes("provider-secret"), false);
});

test("adopted MCP dispatch refuses an unmapped endpoint without calling the connector", async () => {
  let calls = 0;
  const adapter = createMcpDispatchAdapter({ connection: { async call() { calls++; return { content: [] }; }, async close() {} } as never, routes: [] });
  const outcome = await adapter.dispatch({ reservation: { reservationId: "reservation_2", state: "reserved", intent: { effectDigest: "sha256:" + "b".repeat(64) } }, effect: { endpointId: "unknown" }, effectCanonicalBase64: "", effectDigest: "sha256:" + "b".repeat(64) });
  assert.equal(outcome.kind, "definitive-failure");
  assert.equal(calls, 0);
});
