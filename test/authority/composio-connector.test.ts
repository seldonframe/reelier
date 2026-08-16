import test from "node:test";
import assert from "node:assert/strict";
import { createComposioDispatchAdapter } from "reelier/authority/host";

test("Composio fallback dispatch uses only the operator route and redacts provider body", async () => {
  const calls: unknown[] = [];
  const adapter = createComposioDispatchAdapter({
    connection: { async call(toolName, args) { calls.push([toolName, args]); return { status: 200, body: { secret: "private" } }; } },
    routes: [{ endpointId: "composio.gmail.send", toolName: "GMAIL_SEND_EMAIL", encodeArgs: effect => ({ sealed: effect }) }],
  });
  const result = await adapter.dispatch({ reservation: { reservationId: "r", state: "reserved", intent: { effectDigest: "sha256:" + "1".repeat(64) } }, effect: { endpointId: "composio.gmail.send", body: "sealed" }, effectCanonicalBase64: "e30=", effectDigest: "sha256:" + "1".repeat(64) });
  assert.equal(result.kind, "acknowledged");
  assert.equal("secret" in result, false);
  assert.deepEqual(calls, [["GMAIL_SEND_EMAIL", { sealed: { endpointId: "composio.gmail.send", body: "sealed" } }]]);
});

test("Composio fallback refuses an unmapped endpoint without calling the connection", async () => {
  let called = false;
  const adapter = createComposioDispatchAdapter({ connection: { async call() { called = true; return {}; } }, routes: [] });
  const result = await adapter.dispatch({ reservation: { reservationId: "r", state: "reserved", intent: { effectDigest: "sha256:" + "1".repeat(64) } }, effect: { endpointId: "agent-chosen" }, effectCanonicalBase64: "e30=", effectDigest: "sha256:" + "1".repeat(64) });
  assert.equal(result.kind, "definitive-failure");
  assert.equal(called, false);
});
