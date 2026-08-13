import test from "node:test";
import assert from "node:assert/strict";
import { assertAllPublicAddresses, classifyPublicAddress } from "../../src/authority/client/ip.js";
import { createTotalDeadline } from "../../src/authority/net/deadline.js";

test("the authority boundary refuses loopback, private, link-local, and mapped private addresses", () => {
  for (const address of ["127.0.0.1", "169.254.169.254", "10.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(classifyPublicAddress(address).ok, false, address);
  }
  assert.throws(() => assertAllPublicAddresses(["203.0.113.10", "::ffff:127.0.0.1"]), /public/i);
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
