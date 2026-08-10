import test from "node:test";
import assert from "node:assert/strict";
import { createSecretHandle, isSecretHandle, redactSecretValue } from "../../src/authority/host/secret-handle.js";

test("secret handle exposes a digest and one private read", () => {
  const handle = createSecretHandle("generated-token", { expiresAt: "2099-01-01T00:00:00.000Z" });
  assert.equal(isSecretHandle(handle), true);
  assert.equal(handle.digest, redactSecretValue("generated-token"));
  assert.deepEqual(Array.from(handle.readOnce()), Array.from(new TextEncoder().encode("generated-token")));
  assert.throws(() => handle.readOnce(), /unavailable/);
});

test("secret handles reject expired values without exposing bytes", () => {
  assert.throws(() => createSecretHandle("token", { expiresAt: "2000-01-01T00:00:00.000Z" }), /expiry/);
});
