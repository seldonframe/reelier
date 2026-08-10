import test from "node:test";
import assert from "node:assert/strict";
import { parseCloudflareTokenCreatePolicy, parseVercelProjectEnvironmentSecretSetPolicy } from "reelier/packs";
import { createCloudflareTokenCreateHttpsProvider, createVercelProjectEnvironmentSecretHttpsProvider } from "../../src/authority/host/secret-provider-clients.js";

const endpoint = (endpointId: string, allowedMethods: readonly ("GET" | "POST")[]) => ({ endpointId, baseUrl: "https://provider.example.test", allowedMethods, allowedPathPrefixes: ["/"], secretRef: "env:PROVIDER_TOKEN", accountIdentity: "account_1" });
const secrets = { async resolve() { return "bootstrap-secret"; } };

test("Cloudflare HTTPS provider sends exact approved creation bytes and finds one deterministic token name", async () => {
  const policy = parseCloudflareTokenCreatePolicy({ accountId: "acct_demo", tokenName: "reelier-deploy-token", permissionGroupIds: ["perm_1"], resources: { "com.cloudflare.api.account.zone.zone_1": "*" }, notBefore: "2026-08-10T00:00:00.000Z", expiresAt: "2026-08-11T00:00:00.000Z", requestIpIn: [], requestIpNotIn: [] });
  let writtenBody: Record<string, unknown> | undefined;
  const provider = createCloudflareTokenCreateHttpsProvider({
    createEndpoint: endpoint("cloudflare.api_token.create", ["POST"]),
    listEndpoint: endpoint("cloudflare.api_token.find", ["GET"]),
    secrets,
    executeEffect: async effect => { writtenBody = JSON.parse(Buffer.from(effect.bodyBase64, "base64").toString("utf8")); return { status: 200, headers: {}, body: Buffer.from('{"success":true,"result":{"value":"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN"}}'), requestBytesDigest: "sha256:" + "1".repeat(64) }; },
    executeRead: async read => ({ status: 200, headers: {}, body: Buffer.from(JSON.stringify({ success: true, result: [{ id: "tok_other", name: "other" }, { id: "tok_1", name: policy.tokenName, status: "active", policies: [{ effect: "allow", permission_groups: [{ id: "perm_1" }], resources: policy.resources }], not_before: policy.notBefore, expires_on: policy.expiresAt }] })), requestBytesDigest: "sha256:" + "2".repeat(64) }),
  });
  const created = await provider.createToken(policy);
  assert.equal(created.status, 200);
  assert.equal(writtenBody?.name, policy.tokenName);
  assert.equal("value" in (writtenBody ?? {}), false);
  const found = await provider.findToken(policy) as Record<string, unknown>;
  assert.equal(found.id, "tok_1");
  assert.equal(found.accountId, policy.accountId);
});

test("Vercel HTTPS provider materializes a sensitive variable only inside the confidential request", async () => {
  const secret = new TextEncoder().encode("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN");
  const policy = parseVercelProjectEnvironmentSecretSetPolicy({ teamId: "team_demo", projectId: "proj_demo", environment: "production", key: "CLOUDFLARE_API_TOKEN", secretDigest: "sha256:" + "a".repeat(64) });
  let bodyDuringCall = "";
  let retainedBody: Uint8Array | undefined;
  const provider = createVercelProjectEnvironmentSecretHttpsProvider({
    writeEndpoint: endpoint("vercel.project.environment.secret.set", ["POST"]),
    readEndpoint: endpoint("vercel.project.environment.secret.get", ["GET"]),
    secrets,
    executeConfidential: async request => { bodyDuringCall = Buffer.from(request.body).toString("utf8"); retainedBody = request.body; return { status: 200, headers: {}, body: Buffer.from('[{"id":"env_1","key":"CLOUDFLARE_API_TOKEN","type":"sensitive","target":["production"]}]'), requestBytesDigest: "sha256:" + "3".repeat(64) }; },
    executeRead: async () => ({ status: 200, headers: {}, body: Buffer.from(JSON.stringify({ envs: [{ id: "env_1", key: policy.key, type: "sensitive", target: [policy.environment] }] })), requestBytesDigest: "sha256:" + "4".repeat(64) }),
  });
  const created = await provider.setEnvironmentSecret({ ...policy, secret });
  assert.match(bodyDuringCall, /"type":"sensitive"/);
  assert.match(bodyDuringCall, /abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN/);
  assert.ok(retainedBody);
  assert.equal(retainedBody.every(byte => byte === 0), true, "client zeroes its confidential request bytes");
  assert.deepEqual(created, { teamId: policy.teamId, projectId: policy.projectId, environment: policy.environment, key: policy.key, type: "sensitive", status: "active", id: "env_1" });
  assert.equal((await provider.readEnvironmentSecretMetadata(policy) as Record<string, unknown>).id, "env_1");
});
