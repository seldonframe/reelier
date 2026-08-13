import test from "node:test";
import assert from "node:assert/strict";
import { compileCloudflareTokenRoll, parseCloudflareTokenRollPolicy, reconcileCloudflareTokenRoll, validateCloudflareTokenRollChoices, type CloudflareTokenProjection } from "reelier/packs";

const source: CloudflareTokenProjection = { accountId: "acct_demo", tokenId: "token_demo", tokenName: "deploy-token", scopes: ["com.cloudflare.api.account.zone.read", "com.cloudflare.api.account.zone.write"], resources: ["com.cloudflare.api.account.zone:zone_demo"], expiresAt: "2026-12-31T00:00:00.000Z", status: "active" };
const policyInput = { accountId: "acct_demo", tokenId: "token_demo", tokenName: "deploy-token", scopes: ["com.cloudflare.api.account.zone.read", "com.cloudflare.api.account.zone.write"], resources: ["com.cloudflare.api.account.zone:zone_demo"], expiresAt: "2027-01-31T00:00:00.000Z" };

test("Cloudflare token rotation binds metadata and never carries a secret", () => {
  assert.throws(() => validateCloudflareTokenRollChoices({ token: "attacker-secret" }));
  const policy = parseCloudflareTokenRollPolicy(policyInput);
  const effect = compileCloudflareTokenRoll({ source, policy });
  assert.equal(effect.endpointId, "cloudflare.api_token.roll");
  assert.equal(effect.method, "POST");
  assert.equal(effect.path, "/client/v4/accounts/acct_demo/tokens/token_demo/roll");
  assert.deepEqual(JSON.parse(Buffer.from(effect.bodyBase64, "base64").toString("utf8")), { name: "deploy-token", scopes: policyInput.scopes, resources: policyInput.resources, expiresAt: policyInput.expiresAt });
  assert.doesNotMatch(JSON.stringify(effect), /secret|token-value|bearer/i);
  assert.equal(effect.reconciliation.recipeId, "cloudflare_api_token_roll_readback_v1");
});

test("Cloudflare token rotation refuses widening and reconciles metadata only", () => {
  const policy = parseCloudflareTokenRollPolicy(policyInput);
  assert.throws(() => compileCloudflareTokenRoll({ source: { ...source, scopes: ["com.cloudflare.api.account.zone.read"] }, policy }));
  assert.equal(reconcileCloudflareTokenRoll({ expected: source, policy, response: { body: { result: { id: "token_demo", accountId: "acct_demo", name: "deploy-token", scopes: policyInput.scopes, resources: policyInput.resources, expiresAt: policyInput.expiresAt, status: "active", value: "never-store-this" } } } }).status, "matched");
  assert.equal(reconcileCloudflareTokenRoll({ expected: source, policy, response: { body: { result: { id: "token_demo", accountId: "acct_demo", name: "deploy-token", scopes: ["com.cloudflare.api.account.zone.read"], resources: policyInput.resources, expiresAt: policyInput.expiresAt, status: "active" } } } }).status, "conflict");
  assert.equal(reconcileCloudflareTokenRoll({ expected: source, policy, response: { status: 404, body: {} } }).status, "not-applied");
});
