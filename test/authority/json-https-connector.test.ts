import test from "node:test";
import assert from "node:assert/strict";
import { createJsonHttpsDispatchAdapter } from "reelier/authority/host";

test("HTTPS dispatch refuses an effect whose endpoint is not operator configured", async () => {
  const adapter = createJsonHttpsDispatchAdapter({ endpoints: [], secrets: { async resolve() { return "never"; } } });
  const result = await adapter.dispatch({ reservation: { reservationId: "r", state: "reserved", intent: { effectDigest: "sha256:" + "1".repeat(64) } }, effect: { endpointId: "agent-chosen" }, effectCanonicalBase64: "e30=", effectDigest: "sha256:" + "1".repeat(64) });
  assert.equal(result.kind, "definitive-failure");
  assert.equal(result.providerStatus, undefined);
});

test("HTTPS dispatch rejects duplicate endpoint identities at construction", () => {
  const endpoint = { endpointId: "same", baseUrl: "https://example.test", allowedMethods: ["POST"] as const, allowedPathPrefixes: ["/v1"], accountIdentity: "acct" };
  assert.throws(() => createJsonHttpsDispatchAdapter({ endpoints: [endpoint, endpoint], secrets: { async resolve() { return "never"; } } }), /duplicate/);
});
