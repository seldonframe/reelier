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

test("canonical HTTPS dispatch acquires and consumes the slot before transport, with no canary in result", async () => {
  const route = {
    v: "reelier.json-https-route/v1" as const, providerId: "github", connectorId: "github", accountId: "acct",
    providerAccountIdentity: "github:acct", endpointId: "github.write", origin: "https://127.0.0.1",
    allowedMethods: ["PUT" as const], allowedPathPrefixes: ["/labels"], credentialSlotId: "github.tracer",
    responseSemanticsProfileId: "github.labels.v1", reconciliationRecipeId: "github.labels.read.v1", readEndpointId: "github.read",
    egressPolicyDigest: "sha256:" + "1".repeat(64),
  };
  const read = { ...route, endpointId: "github.read", allowedMethods: ["GET" as const] };
  let acquired = "";
  let consumed = false;
  const adapter = createJsonHttpsDispatchAdapter({ endpoints: [], routes: [route, read], secrets: {
    async resolve() { throw new Error("legacy resolver must not be used"); },
    async acquireSlot(slotId: string) { acquired = slotId; return { readOnce: () => { consumed = true; return "CANARY_SLOT_VALUE"; }, description: { v: "reelier.secret-lease-description/v1", slotId, instanceId: "i", version: "v", expiresAt: new Date(Date.now() + 1000).toISOString() } }; },
  } });
  const result = await adapter.dispatch({ reservation: { reservationId: "r", state: "reserved", intent: { effectDigest: "sha256:" + "1".repeat(64) } }, effect: { endpointId: "github.write", method: "PUT", path: "/labels", query: "", headers: {}, bodyBase64: Buffer.from("{}").toString("base64") }, effectCanonicalBase64: "e30=", effectDigest: "sha256:" + "1".repeat(64) });
  assert.equal(acquired, "github.tracer");
  assert.equal(consumed, true);
  assert.equal(JSON.stringify(result).includes("CANARY_SLOT_VALUE"), false);
});

test("canonical HTTPS dispatch refuses unknown response semantics profiles before acquiring a credential slot", async () => {
  const route = {
    v: "reelier.json-https-route/v1" as const, providerId: "github", connectorId: "github", accountId: "acct",
    providerAccountIdentity: "github:acct", endpointId: "github.write", origin: "https://127.0.0.1",
    allowedMethods: ["PUT" as const], allowedPathPrefixes: ["/labels"], credentialSlotId: "github.tracer",
    responseSemanticsProfileId: "unknown.profile", reconciliationRecipeId: "github.labels.read", readEndpointId: "github.read",
    egressPolicyDigest: "sha256:" + "1".repeat(64),
  };
  const read = { ...route, endpointId: "github.read", allowedMethods: ["GET" as const] };
  let acquired = false;
  const adapter = createJsonHttpsDispatchAdapter({ routes: [route, read], endpoints: [], secrets: {
    async resolve() { throw new Error("legacy resolver must not be used"); },
    async acquireSlot() { acquired = true; return { readOnce: () => "secret" }; },
  } });
  const result = await adapter.dispatch({ reservation: { reservationId: "r", state: "reserved", intent: { effectDigest: "sha256:" + "1".repeat(64) } }, effect: { endpointId: "github.write", method: "PUT", path: "/labels", query: "", headers: {}, bodyBase64: Buffer.from("{}").toString("base64") }, effectCanonicalBase64: "e30=", effectDigest: "sha256:" + "1".repeat(64) });
  assert.equal(result.kind, "definitive-failure");
  assert.equal(acquired, false);
});

test("canonical HTTPS dispatch binds the sealed operator configuration digest", async () => {
  const route = {
    v: "reelier.json-https-route/v1" as const, providerId: "github", connectorId: "github", accountId: "acct",
    providerAccountIdentity: "github:acct", endpointId: "github.write", origin: "https://127.0.0.1",
    allowedMethods: ["PUT" as const], allowedPathPrefixes: ["/labels"], credentialSlotId: "github.tracer",
    responseSemanticsProfileId: "github.labels.v1", reconciliationRecipeId: "github.labels.read", readEndpointId: "github.read",
    egressPolicyDigest: "sha256:" + "1".repeat(64),
  };
  const read = { ...route, endpointId: "github.read", allowedMethods: ["GET" as const] };
  const adapter = createJsonHttpsDispatchAdapter({ routes: [route, read], endpoints: [], operatorConfigurationDigest: "sha256:" + "2".repeat(64), secrets: { async resolve() { throw new Error("legacy resolver must not be used"); }, async acquireSlot() { return { readOnce: () => "secret" }; } } } as any);
  const base = { reservationId: "r", state: "reserved" as const, intent: { effectDigest: "sha256:" + "1".repeat(64), routeAuthority: { operatorConfigurationDigest: "sha256:" + "3".repeat(64) } as any } };
  const result = await adapter.dispatch({ reservation: base, effect: { endpointId: "github.write", method: "PUT", path: "/labels", query: "", headers: {}, bodyBase64: Buffer.from("{}").toString("base64") }, effectCanonicalBase64: "e30=", effectDigest: "sha256:" + "1".repeat(64) });
  assert.equal(result.kind, "definitive-failure");
});
