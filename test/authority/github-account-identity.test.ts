import assert from "node:assert/strict";
import test from "node:test";
import { probeGitHubAccountIdentity } from "../../src/authority/host/github-account-identity.js";
import { authorityDigest } from "../../src/authority/wire.js";

const route: any = { v: "reelier.json-https-route/v1", providerId: "github", connectorId: "github", accountId: "42", providerAccountIdentity: "octocat", endpointId: "github", origin: "https://api.github.com", allowedMethods: ["GET"], allowedPathPrefixes: ["/user"], credentialSlotId: "slot", responseSemanticsProfileId: "github", reconciliationRecipeId: "github", readEndpointId: "github", egressPolicyDigest: `sha256:${"a".repeat(64)}` };

test("GitHub identity probe binds account/login, route digest, and one-use slot descriptor", async () => {
  let reads = 0;
  const identity = await probeGitHubAccountIdentity({ route, now: () => new Date("2026-01-01T00:00:00.000Z"), secretLease: { credentialSlotId: "slot", slotInstanceId: "instance", slotVersion: "1", slotExpiresAt: "2027-01-01T00:00:00.000Z", readOnce: () => { reads++; return "secret"; } }, transport: { async request(input) { assert.equal(input.route.endpointId, "github"); assert.equal(input.path, "/user"); return { status: 200, body: JSON.stringify({ id: 42, login: "octocat" }) }; } } });
  assert.equal(reads, 1);
  assert.equal(identity.providerAccountId, "42");
  assert.equal(identity.providerLogin, "octocat");
  assert.equal(identity.routeDigest, authorityDigest(route));
});

test("GitHub identity probe refuses lease-slot, account, and expiry substitution", async () => {
  const base: any = { route, now: () => new Date("2026-01-01T00:00:00.000Z"), secretLease: { credentialSlotId: "other", slotInstanceId: "instance", slotVersion: "1", slotExpiresAt: "2027-01-01T00:00:00.000Z", readOnce: () => "secret" }, transport: { async request() { return { status: 200, body: { id: 42, login: "octocat" } }; } } };
  await assert.rejects(() => probeGitHubAccountIdentity(base), /slot/i);
  await assert.rejects(() => probeGitHubAccountIdentity({ ...base, secretLease: { ...base.secretLease, credentialSlotId: "slot", slotExpiresAt: "2025-01-01T00:00:00.000Z" } }), /expired/i);
  await assert.rejects(() => probeGitHubAccountIdentity({ ...base, secretLease: { ...base.secretLease, credentialSlotId: "slot" }, transport: { async request() { return { status: 200, body: { id: 99, login: "attacker" } }; } } }), /mismatch/i);
});

