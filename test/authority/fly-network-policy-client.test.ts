import test from "node:test";
import assert from "node:assert/strict";
import { provisionFlyNetworkPolicy, readFlyNetworkPolicyDigest } from "../../src/authority/host/fly-network-policy-client.js";

const policy = {
  name: "cell-default-deny",
  selector: { all: true },
  rules: [{ action: "allow", direction: "egress", ports: [{ protocol: "udp", port: 53 }] }],
} as const;

test("Fly policy provisioning writes one exact policy and verifies API read-back", async () => {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const result = await provisionFlyNetworkPolicy({
    allowLive: true,
    appName: "reelier-cell-demo",
    credentialRef: "env:FLY_API_TOKEN",
    policy,
    async request(input) {
      calls.push({ method: input.method, path: input.path, body: input.body });
      if (input.method === "POST") return { status: 200, body: { id: "np_1", ...policy } };
      return { status: 200, body: [{ id: "np_1", created_at: "ignored", ...policy }] };
    },
  });
  assert.equal(result.status, "verified");
  assert.match(result.digest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(calls, [
    { method: "POST", path: "/v1/apps/reelier-cell-demo/network_policies", body: policy },
    { method: "GET", path: "/v1/apps/reelier-cell-demo/network_policies/", body: null },
  ]);
});

test("Fly policy provisioning requires explicit live acknowledgement and exact read-back", async () => {
  await assert.rejects(() => provisionFlyNetworkPolicy({ appName: "cell", credentialRef: "env:FLY", policy, request: async () => ({ status: 200, body: [] }) }), /allowLive/);
  await assert.rejects(() => provisionFlyNetworkPolicy({ allowLive: true, appName: "cell", credentialRef: "env:FLY", policy, request: async input => input.method === "POST" ? { status: 200, body: {} } : { status: 200, body: [{ ...policy, rules: [{ action: "allow", direction: "egress", ports: [{ protocol: "tcp", port: 443 }] }] }] } }), /read-back/);
});

test("Fly policy digest reader strips provider metadata but rejects non-success", async () => {
  const digest = await readFlyNetworkPolicyDigest({ appName: "cell", credentialRef: "env:FLY", request: async () => ({ status: 200, body: [{ id: "np_1", ...policy }] }) });
  assert.match(digest, /^sha256:/);
  await assert.rejects(() => readFlyNetworkPolicyDigest({ appName: "cell", credentialRef: "env:FLY", request: async () => ({ status: 401, body: { error: "no" } }) }), /failed/);
});
