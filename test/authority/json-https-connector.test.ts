import test from "node:test";
import assert from "node:assert/strict";
import { createJsonHttpsDispatchAdapter } from "../../src/authority/host/json-https-connector.js";

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

test("canonical HTTPS dispatch joins routes to opaque slot leases, never legacy secret refs", async () => {
  const route = {
    v: "reelier.json-https-route/v1" as const, providerId: "github", connectorId: "github", accountId: "acct",
    providerAccountIdentity: "github:acct", endpointId: "github.write", origin: "https://api.github.com",
    allowedMethods: ["PUT" as const], allowedPathPrefixes: ["/repos/acct/repo/issues/1/labels"], credentialSlotId: "github.tracer",
    responseSemanticsProfileId: "github.labels.v1", reconciliationRecipeId: "github.labels.read.v1", readEndpointId: "github.read",
    egressPolicyDigest: "sha256:" + "1".repeat(64),
  };
  const read = { ...route, endpointId: "github.read", allowedMethods: ["GET" as const] };
  let acquired = "";
  const adapter = createJsonHttpsDispatchAdapter({ routes: [route, read], endpoints: [], secrets: {
    async resolve() { throw new Error("legacy secret resolver must not be used"); },
    async acquireSlot(slotId: string) { acquired = slotId; return { readOnce: () => "CANARY", description: { v: "reelier.secret-lease-description/v1", slotId, instanceId: "i", version: "v", expiresAt: new Date(Date.now() + 1000).toISOString() } }; },
  } });
  const result = await adapter.dispatch({ reservation: { reservationId: "r", state: "reserved", intent: { effectDigest: "sha256:" + "1".repeat(64) } }, effect: { endpointId: "github.unknown" }, effectCanonicalBase64: "e30=", effectDigest: "sha256:" + "1".repeat(64) });
  assert.equal(result.kind, "definitive-failure");
  assert.equal(acquired, "");
});
