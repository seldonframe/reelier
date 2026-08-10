import test from "node:test";
import assert from "node:assert/strict";
import { compileCloudflareTokenCreate, parseCloudflareTokenCreatePolicy, compileVercelProjectEnvironmentSecretSet, parseVercelProjectEnvironmentSecretSetPolicy } from "reelier/packs";
import { createCloudflareTokenCreateDispatchAdapter, createMemoryConfidentialTransferStore, createVercelProjectEnvironmentSecretDispatchAdapter } from "reelier/authority/host";
import { authorityDigest } from "reelier/authority";

const handoffExpiry = "2099-01-01T00:00:00.000Z";
const tokenExpiry = "2098-12-31T00:00:00.000Z";
const tokenValue = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN";

const cloudflarePolicy = () => parseCloudflareTokenCreatePolicy({
  accountId: "acct_demo",
  tokenName: "reelier-deploy-token",
  permissionGroupIds: ["perm_zone_read", "perm_zone_write"],
  resources: { "com.cloudflare.api.account.zone.zone_demo": "*" },
  notBefore: "2026-08-10T00:00:00.000Z",
  expiresAt: tokenExpiry,
  requestIpIn: ["203.0.113.0/24"],
  requestIpNotIn: [],
});

test("Cloudflare token creation captures the provider-generated value into a one-use confidential transfer", async () => {
  const policy = cloudflarePolicy();
  const effect = compileCloudflareTokenCreate({ policy });
  const compiledBody = JSON.parse(Buffer.from(effect.bodyBase64, "base64").toString("utf8"));
  assert.equal(compiledBody.name, policy.tokenName);
  assert.equal("secretDigest" in compiledBody, false);
  assert.deepEqual(compiledBody.policies[0].permission_groups, [{ id: "perm_zone_read" }, { id: "perm_zone_write" }]);

  const transfers = createMemoryConfidentialTransferStore();
  let providerInput: unknown;
  const responseBytes = Buffer.from(JSON.stringify({ success: true, result: { id: "tok_1", name: policy.tokenName, status: "active", policies: compiledBody.policies, expires_on: tokenExpiry, not_before: policy.notBefore, value: tokenValue } }));
  const adapter = createCloudflareTokenCreateDispatchAdapter({
    transfer: { transferId: "transfer_1", destinationOutcome: "vercel_project_environment_secret_set_v1", destination: "vercel:team_demo/proj_demo:production", secretSlot: "value", expiresAt: handoffExpiry },
    transfers,
    provider: {
      async createToken(input) { providerInput = input; return { status: 200, body: responseBytes }; },
      async findToken() { return undefined; },
    },
  });
  const out = await adapter.dispatch({ effect, reservation: { reservationId: "r1" } } as never);

  assert.equal(out.kind, "acknowledged");
  assert.equal("secret" in (providerInput as object), false);
  assert.doesNotMatch(JSON.stringify(out), new RegExp(tokenValue));
  assert.equal(responseBytes.every(byte => byte === 0), true, "owned provider response buffer is zeroed after extraction");
  const captured = await transfers.take("transfer_1");
  assert.equal(captured.commitment.sourceOutcome, "r1");
  assert.equal(captured.commitment.destinationOutcome, "vercel_project_environment_secret_set_v1");
  assert.equal(captured.handle.digest, captured.commitment.valueDigest);
  assert.equal(Buffer.from(captured.handle.readOnce()).toString("utf8"), tokenValue);
  await assert.rejects(() => transfers.take("transfer_1"), /unavailable/i);
});

test("Cloudflare create ambiguity can reconcile metadata but never recreates a lost one-time value", async () => {
  const policy = cloudflarePolicy();
  const effect = compileCloudflareTokenCreate({ policy });
  const transfers = createMemoryConfidentialTransferStore();
  let creates = 0;
  const adapter = createCloudflareTokenCreateDispatchAdapter({
    transfer: { transferId: "transfer_2", destinationOutcome: "vercel_project_environment_secret_set_v1", destination: "vercel:team_demo/proj_demo:production", secretSlot: "value", expiresAt: handoffExpiry },
    transfers,
    provider: {
      async createToken() { creates += 1; throw new Error("connection-cut-after-provider-apply"); },
      async findToken() { return { id: "tok_2", accountId: policy.accountId, name: policy.tokenName, permissionGroupIds: policy.permissionGroupIds, resources: policy.resources, expiresAt: policy.expiresAt, notBefore: policy.notBefore, status: "active" }; },
    },
  });
  const state = { effect, reservation: { reservationId: "r2" } } as never;
  const out = await adapter.dispatch(state);
  assert.equal(out.kind, "ambiguous");
  const reconciled = await adapter.reconcile!(state, out);
  assert.equal(reconciled.reconciliationStatus, "matched");
  assert.equal(creates, 1);
  await assert.rejects(() => transfers.take("transfer_2"), /unavailable/i);
});

test("Vercel sensitive environment adapter consumes the exact captured value and zeroes its materialized bytes", async () => {
  const transfers = createMemoryConfidentialTransferStore();
  const source = Buffer.from(tokenValue, "utf8");
  await transfers.capture({ transferId: "transfer_3", sourceOutcome: "cloudflare-reservation", destinationOutcome: "vercel_project_environment_secret_set_v1", destination: "vercel:team_demo/proj_demo:production", secretSlot: "value", expiresAt: handoffExpiry, value: source });
  source.fill(0);
  const status = await transfers.status("transfer_3");
  assert.ok(status);
  const policy = parseVercelProjectEnvironmentSecretSetPolicy({ teamId: "team_demo", projectId: "proj_demo", environment: "production", key: "CLOUDFLARE_API_TOKEN", secretDigest: status.commitment.valueDigest });
  const effect = compileVercelProjectEnvironmentSecretSet({ policy });
  assert.doesNotMatch(JSON.stringify(effect), new RegExp(tokenValue));
  let observedDuringCall = "";
  let retainedReference: Uint8Array | undefined;
  const adapter = createVercelProjectEnvironmentSecretDispatchAdapter({ transferId: "transfer_3", transfers, provider: {
    async setEnvironmentSecret(input) { observedDuringCall = Buffer.from(input.secret).toString("utf8"); retainedReference = input.secret; return { metadata: { teamId: input.teamId, projectId: input.projectId, environment: input.environment, key: input.key, type: "sensitive", status: "active" }, requestBytesDigest: "sha256:" + "7".repeat(64) }; },
    async readEnvironmentSecretMetadata() { return { teamId: "team_demo", projectId: "proj_demo", environment: "production", key: "CLOUDFLARE_API_TOKEN", type: "sensitive", status: "active" }; },
  } });
  const out = await adapter.dispatch({ effect, reservation: { reservationId: "r3" } } as never);
  assert.equal(out.kind, "acknowledged");
  assert.equal(out.materializedRequestDigest, authorityDigest({ v: "reelier.materialized-provider-request/v1", endpointId: effect.endpointId, method: effect.method, path: effect.path, query: effect.query, headers: effect.headers, bodyDigest: "sha256:" + "7".repeat(64) }), "evidence binds the route and exact secret-bearing provider body without storing its bytes");
  assert.equal(observedDuringCall, tokenValue);
  assert.ok(retainedReference);
  assert.equal(retainedReference.every(byte => byte === 0), true, "materialized secret bytes are zeroed after provider call");
  assert.equal((await adapter.reconcile!({ effect, reservation: { reservationId: "r3" } } as never, out)).reconciliationStatus, "matched");
  await assert.rejects(() => transfers.take("transfer_3"), /unavailable/i);
});
