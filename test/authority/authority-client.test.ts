import test from "node:test";
import assert from "node:assert/strict";
import { assertAllPublicAddresses, classifyPublicAddress } from "../../src/authority/client/ip.js";
import { createTotalDeadline } from "../../src/authority/net/deadline.js";
import { checkAuthorityCellLive } from "../../src/authority/client/http.js";

test("the authority boundary refuses loopback, private, link-local, and mapped private addresses", () => {
  for (const address of ["127.0.0.1", "169.254.169.254", "10.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(classifyPublicAddress(address).ok, false, address);
  }
  for (const address of ["192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "2001:db8::1"]) assert.equal(classifyPublicAddress(address).ok, false, address);
  assert.throws(() => assertAllPublicAddresses(["203.0.113.10", "::ffff:127.0.0.1"]), /public/i);
});

test("injected identity requests receive the validated pin, deadline, and abort signal", async () => {
  const result = await checkAuthorityCellLive({ v: "reelier.authority-cell-connection/v1", endpoint: "https://cell.example", transport: "http", bearerTokenRef: "env:CELL_TOKEN", expectedCellId: "cell_1", adapterContractDigest: `sha256:${"a".repeat(64)}` }, {
    resolveAddresses: async () => ["8.8.8.8"],
    resolveToken: async () => "opaque",
    request: async (_url, _init, context) => {
      assert.equal(context.address, "8.8.8.8");
      assert.equal(context.deadline.absoluteDeadlineMs > context.deadline.startedAtMs, true);
      assert.equal(context.signal.aborted, false);
      return new Response(JSON.stringify({ v: "reelier.authority-cell-identity/v1", cellId: "cell_1", adapterContractDigest: `sha256:${"a".repeat(64)}` }), { status: 200 });
    },
  });
  assert.equal(result.state, "verified");
});

test("one monotonic deadline refuses every later authority stage after expiry", () => {
  let now = 0;
  const clock = { now: () => now };
  const deadline = createTotalDeadline({ timeoutMs: 100, monotonicNow: clock.now });
  assert.equal(deadline.absoluteDeadlineMs, 100);
  now = 101;
  for (const stage of ["credential", "identity", "source", "prepare", "authority", "budget", "ledger", "dns", "connect", "tls", "upload", "headers", "body"] as const) {
    assert.throws(() => deadline.remainingMs(stage), /deadline/i, stage);
  }
});
