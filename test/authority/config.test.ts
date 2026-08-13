import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadAuthorityHostConfig, validateAuthorityHostConfig } from "../../src/authority/host/config.js";

test("authority YAML accepts nested endpoint mappings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-authority-config-"));
  const file = path.join(root, "authority.yml");
  await writeFile(file, [
    "version: 1", "tenant: tenant", "requester: operator", "definitions: []", "topology: same-user", "endpoints:",
    "  - endpointId: github", "    baseUrl: https://api.github.test", "    accountIdentity: acct", "    allowedMethods: [\"GET\"]", "    allowedPathPrefixes: [\"/repos\"]",
  ].join("\n"));
  const { config } = await loadAuthorityHostConfig(file);
  assert.equal(config.endpoints[0]?.endpointId, "github");
});

test("authority endpoint accepts only an explicit Fly-internal egress proxy", () => {
  const base = { version: 1 as const, tenant: "tenant", requester: "operator", definitions: [], topology: "isolated", ledgerDir: "ledger", decisionDir: "decisions", receiptDir: "receipts" };
  const endpoint = { endpointId: "github", baseUrl: "https://api.github.com", accountIdentity: "acct", allowedMethods: ["GET"], allowedPathPrefixes: ["/repos"], egressProxy: { baseUrl: "http://reelier-egress.internal:8443", bearerRef: "env:REELIER_EGRESS_GATEWAY_BEARER" } };
  const parsed = validateAuthorityHostConfig({ ...base, endpoints: [endpoint] });
  assert.deepEqual(parsed.endpoints[0].egressProxy, endpoint.egressProxy);
  assert.throws(() => validateAuthorityHostConfig({ ...base, endpoints: [{ ...endpoint, egressProxy: { ...endpoint.egressProxy, baseUrl: "https://public.example" } }] }), /egress proxy/);
  assert.throws(() => validateAuthorityHostConfig({ ...base, endpoints: [{ ...endpoint, egressProxy: { ...endpoint.egressProxy, token: "plaintext" } }] }), /closed/);
});

test("legacy endpoints do not silently become canonical native HTTPS route authority", () => {
  const config = validateAuthorityHostConfig({ version: 1, tenant: "tenant", requester: "operator", definitions: [], endpoints: [{ endpointId: "github", baseUrl: "https://api.github.com", accountIdentity: "acct", allowedMethods: ["PUT"], allowedPathPrefixes: ["/repos"] }] });
  assert.equal("nativeHttpsRoutes" in config, false);
});

test("canonical native HTTPS routes carry only opaque credential slot ids", () => {
  const base = { version: 1 as const, tenant: "tenant", requester: "operator", definitions: [], topology: "isolated" as const };
  const route = {
    v: "reelier.json-https-route/v1" as const, providerId: "github", connectorId: "github", accountId: "acct",
    providerAccountIdentity: "github:acct", endpointId: "github.write", origin: "https://api.github.com",
    allowedMethods: ["PUT" as const, "POST" as const], allowedPathPrefixes: ["/z", "/a"], credentialSlotId: "github.tracer",
    responseSemanticsProfileId: "github.labels.v1", reconciliationRecipeId: "github.labels.read.v1", readEndpointId: "github.read",
    egressPolicyDigest: "sha256:" + "1".repeat(64),
  };
  const parsed = validateAuthorityHostConfig({ ...base, nativeHttpsRoutes: [route, { ...route, endpointId: "github.read", allowedMethods: ["GET"], readEndpointId: "github.read" }] });
  assert.equal(parsed.nativeHttpsRoutes?.[0]?.credentialSlotId, "github.tracer");
  assert.deepEqual(parsed.nativeHttpsRoutes?.[0]?.allowedMethods, ["POST", "PUT"]);
  assert.deepEqual(parsed.nativeHttpsRoutes?.[0]?.allowedPathPrefixes, ["/a", "/z"]);
  assert.equal(Object.isFrozen(parsed.nativeHttpsRoutes), true);
  assert.equal(Object.isFrozen(parsed.nativeHttpsRoutes?.[0]), true);
  assert.equal(JSON.stringify(parsed).includes("secretRef"), false);
  assert.throws(() => validateAuthorityHostConfig({ ...base, nativeHttpsRoutes: [{ ...route, secretRef: "env:CANARY" }] }), /route|unknown|invalid/i);
  assert.throws(() => validateAuthorityHostConfig({ ...base, endpoints: [{ endpointId: "github.write", baseUrl: "https://api.github.com", accountIdentity: "acct", allowedMethods: ["PUT"], allowedPathPrefixes: ["/repos"] }], nativeHttpsRoutes: [route, { ...route, endpointId: "github.read", allowedMethods: ["GET"], readEndpointId: "github.read" }] }), /overlap|identit/i);
});
