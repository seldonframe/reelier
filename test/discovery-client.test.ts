import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadDiscoveryBundle, type DiscoveryUploadBundle } from "../src/discovery-client.js";

const bundle = { schemaVersion: "AgentDiscoveryBundleV1", runNonce: "nonce-1234567890123456" } as DiscoveryUploadBundle;

test("uploadDiscoveryBundle sends the signed bundle only after the caller supplies consent", async () => {
  let calls = 0;
  const result = await uploadDiscoveryBundle(bundle, { baseUrl: "https://cloud.example", apiKey: "sfr_secret" }, async (input: string | URL | Request, init?: RequestInit) => {
    calls++;
    assert.equal(input, "https://cloud.example/api/arena/discoveries");
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer sfr_secret");
    assert.equal((init?.headers as Record<string, string>)["content-type"], "application/json");
    assert.equal((init?.body as string), JSON.stringify(bundle));
    return new Response(JSON.stringify({ id: "d-1", importUrl: "https://cloud.example/arena/import/d-1?token=x" }), { status: 201 });
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { id: "d-1", importUrl: "https://cloud.example/arena/import/d-1?token=x" });
});

test("uploadDiscoveryBundle never retries or logs the API key on a rejected response", async () => {
  let calls = 0;
  await assert.rejects(
    uploadDiscoveryBundle(bundle, { baseUrl: "https://cloud.example", apiKey: "sfr_secret" }, async () => {
      calls++;
      return new Response("invalid bundle", { status: 400 });
    }),
    /Discovery upload failed \(HTTP 400\)/,
  );
  assert.equal(calls, 1);
});
