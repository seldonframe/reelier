import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadAuthorityHostConfig, validateAuthorityHostConfig } from "reelier/authority/host";

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
