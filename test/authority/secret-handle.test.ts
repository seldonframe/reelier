import test from "node:test";
import assert from "node:assert/strict";
import { createSecretHandle, isSecretHandle, redactSecretValue } from "../../src/authority/host/secret-handle.js";

test("secret handle exposes a digest and one private read", () => {
  const source = new TextEncoder().encode("generated-token");
  const handle = createSecretHandle(source, { expiresAt: "2099-01-01T00:00:00.000Z" });
  assert.equal(isSecretHandle(handle), true);
  assert.equal(handle.digest, redactSecretValue("generated-token"));
  const materialized = handle.readOnce();
  assert.deepEqual(Array.from(materialized), Array.from(new TextEncoder().encode("generated-token")));
  assert.equal(source.every(byte => byte !== 0), true, "caller-owned input is not mutated");
  assert.throws(() => handle.readOnce(), /unavailable/);
});

test("secret handles reject expired values without exposing bytes", () => {
  assert.throws(() => createSecretHandle("token", { expiresAt: "2000-01-01T00:00:00.000Z" }), /expiry/);
});

test("destroy makes an unused secret handle permanently unavailable", () => {
  const handle = createSecretHandle("generated-token", { expiresAt: "2099-01-01T00:00:00.000Z" });
  handle.destroy();
  assert.throws(() => handle.readOnce(), /unavailable/);
});
