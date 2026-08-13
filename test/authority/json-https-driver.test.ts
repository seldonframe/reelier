import test from "node:test";
import assert from "node:assert/strict";
import { createPinnedLookup, executeJsonHttpsEffect } from "../../src/authority/drivers/json-https.js";
import { createTotalDeadline } from "../../src/authority/net/deadline.js";

test("pinned DNS lookup supports Node's single-address callback shape", async () => {
  const lookup = createPinnedLookup("8.8.8.8");
  const result = await new Promise<{ address: string | import("node:dns").LookupAddress[]; family?: number }>((resolve, reject) => {
    lookup("example.test", { all: false }, (error, address, family) => error ? reject(error) : resolve({ address, family }));
  });
  assert.deepEqual(result, { address: "8.8.8.8", family: 4 });
});

test("pinned DNS lookup supports Node 24's all-addresses callback shape", async () => {
  const lookup = createPinnedLookup("2606:4700:4700::1111");
  const result = await new Promise<{ address: string | import("node:dns").LookupAddress[]; family?: number }>((resolve, reject) => {
    lookup("example.test", { all: true }, (error, address, family) => error ? reject(error) : resolve({ address, family }));
  });
  assert.deepEqual(result, { address: [{ address: "2606:4700:4700::1111", family: 6 }], family: undefined });
});

test("pinned DNS lookup refuses a non-IP pin", () => {
  assert.throws(() => createPinnedLookup("example.test"), /valid IP address/);
});

test("normal HTTPS effects reject oversized uploads before resolving credentials", async () => {
  let credentialResolved = false;
  await assert.rejects(() => executeJsonHttpsEffect({ endpointId: "endpoint", method: "POST", path: "/write", query: "", headers: {}, bodyBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64") } as never, { endpointId: "endpoint", baseUrl: "https://api.example", allowedMethods: ["POST"], allowedPathPrefixes: ["/write"], secretRef: "env:SECRET", accountIdentity: "account" }, { async resolve() { credentialResolved = true; throw new Error("must not resolve"); } }), /configured limit/i);
  assert.equal(credentialResolved, false);
});

test("total deadlines expose one absolute expiry for native HTTPS dispatch", () => {
  const deadline = createTotalDeadline({ timeoutMs: 100, monotonicNow: () => 50 });
  assert.equal(deadline.startedAtMs, 50);
  assert.equal(deadline.expiresAtMs, 150);
  assert.equal(deadline.absoluteDeadlineMs, 150);
});
