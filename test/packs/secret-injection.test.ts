import test from "node:test";
import assert from "node:assert/strict";
import { createSecretHandle } from "reelier/authority/host";
import { compileCloudflareTokenCreate, parseCloudflareTokenCreatePolicy, compileVercelProjectEnvironmentSecretSet, parseVercelProjectEnvironmentSecretSetPolicy } from "reelier/packs";
import { createCloudflareTokenCreateDispatchAdapter, createVercelProjectEnvironmentSecretDispatchAdapter } from "reelier/authority/host";

const expiry = "2099-01-01T00:00:00.000Z";

test("private Cloudflare token create effect carries only metadata and adapter injects one-use secret", async () => {
  const handle = createSecretHandle("cf-secret", { expiresAt: expiry });
  const policy = parseCloudflareTokenCreatePolicy({ accountId: "acct_demo", tokenName: "deploy-token", scopes: ["read"], resources: ["zone:demo"], secretDigest: handle.digest });
  const effect = compileCloudflareTokenCreate({ policy });
  assert.doesNotMatch(JSON.stringify(effect), /cf-secret/);
  assert.doesNotMatch(Buffer.from(effect.bodyBase64, "base64").toString(), /cf-secret/);
  let seen: Uint8Array | undefined;
  const adapter = createCloudflareTokenCreateDispatchAdapter({ secret: handle, provider: { async createToken(input) { seen = input.secret; return { id: "tok_1", accountId: input.accountId, name: input.tokenName, scopes: input.scopes, resources: input.resources, status: "active" }; }, async findToken() { return undefined; } } });
  const out = await adapter.dispatch({ effect, reservation: { reservationId: "r1" } } as never);
  assert.equal(out.kind, "acknowledged");
  assert.equal(Buffer.from(seen!).toString(), "cf-secret");
  assert.throws(() => handle.readOnce(), /unavailable/);
});

test("Cloudflare create adapter reports ambiguous after crash and reconciles metadata-only", async () => {
  const handle = createSecretHandle("cf-secret-2", { expiresAt: expiry });
  const policy = parseCloudflareTokenCreatePolicy({ accountId: "acct_demo", tokenName: "deploy-token", scopes: ["read"], resources: ["zone:demo"], secretDigest: handle.digest });
  const effect = compileCloudflareTokenCreate({ policy });
  let created = false;
  const adapter = createCloudflareTokenCreateDispatchAdapter({ secret: handle, provider: { async createToken() { created = true; throw new Error("crash-after-create"); }, async findToken(input) { return created ? { id: "tok_2", accountId: input.accountId, name: input.tokenName, scopes: input.scopes, resources: input.resources, status: "active" } : undefined; } } });
  const state = { effect, reservation: { reservationId: "r2" } } as never;
  const out = await adapter.dispatch(state);
  assert.equal(out.kind, "ambiguous");
  const reconciled = await adapter.reconcile!(state, out);
  assert.equal(reconciled.reconciliationStatus, "matched");
});

test("Vercel environment secret effect and adapter never expose plaintext", async () => {
  const handle = createSecretHandle("vercel-secret", { expiresAt: expiry });
  const policy = parseVercelProjectEnvironmentSecretSetPolicy({ teamId: "team_demo", projectId: "proj_demo", environment: "production", key: "API_KEY", secretDigest: handle.digest });
  const effect = compileVercelProjectEnvironmentSecretSet({ policy });
  assert.doesNotMatch(JSON.stringify(effect), /vercel-secret/);
  let seen: Uint8Array | undefined;
  const adapter = createVercelProjectEnvironmentSecretDispatchAdapter({ secret: handle, provider: { async setEnvironmentSecret(input) { seen = input.secret; return { teamId: input.teamId, projectId: input.projectId, environment: input.environment, key: input.key, status: "active" }; }, async readEnvironmentSecretMetadata() { return { teamId: "team_demo", projectId: "proj_demo", environment: "production", key: "API_KEY", status: "active" }; } } });
  const out = await adapter.dispatch({ effect, reservation: { reservationId: "r3" } } as never);
  assert.equal(out.kind, "acknowledged");
  assert.equal(Buffer.from(seen!).toString(), "vercel-secret");
  assert.equal((await adapter.reconcile!({ effect, reservation: { reservationId: "r3" } } as never, out)).reconciliationStatus, "matched");
});
