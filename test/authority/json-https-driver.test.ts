import test from "node:test";
import assert from "node:assert/strict";
import { createPinnedLookup } from "../../src/authority/drivers/json-https.js";
import { createTotalDeadline } from "../../src/authority/net/deadline.js";

test("pinned DNS lookup supports Node's single-address callback shape", async () => {
  const lookup = createPinnedLookup("203.0.113.10");
  const result = await new Promise<{ address: string | import("node:dns").LookupAddress[]; family?: number }>((resolve, reject) => {
    lookup("example.test", { all: false }, (error, address, family) => error ? reject(error) : resolve({ address, family }));
  });
  assert.deepEqual(result, { address: "203.0.113.10", family: 4 });
});

test("pinned DNS lookup supports Node 24's all-addresses callback shape", async () => {
  const lookup = createPinnedLookup("2001:db8::10");
  const result = await new Promise<{ address: string | import("node:dns").LookupAddress[]; family?: number }>((resolve, reject) => {
    lookup("example.test", { all: true }, (error, address, family) => error ? reject(error) : resolve({ address, family }));
  });
  assert.deepEqual(result, { address: [{ address: "2001:db8::10", family: 6 }], family: undefined });
});

test("pinned DNS lookup refuses a non-IP pin", () => {
  assert.throws(() => createPinnedLookup("example.test"), /valid IP address/);
});

test("total deadlines expose one absolute expiry for native HTTPS dispatch", () => {
  const deadline = createTotalDeadline({ timeoutMs: 100, monotonicNow: () => 50 });
  assert.equal(deadline.startedAtMs, 50);
  assert.equal(deadline.expiresAtMs, 150);
  assert.equal(deadline.absoluteDeadlineMs, 150);
});
