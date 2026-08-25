import { test } from "node:test";
import assert from "node:assert/strict";
import { createOperatorManagedHandoffConsumerV1, createOperatorManagedHandoffV1, parseOperatorManagedHandoffV1 } from "../../src/operator/managed-handoff.js";

test("managed handoff is signed, provider-neutral, and one-shot", () => {
  const signed = new Map<string, string>();
  const handoff = createOperatorManagedHandoffV1({ mode: "customer-hosted-cell", providerAccountRef: "account-ref", authorityDigest: "sha256:" + "a".repeat(64), contractDigest: "sha256:" + "b".repeat(64), expiresAt: "2099-01-01T00:00:00.000Z", sign(payload) { signed.set(payload, "signature"); return "signature"; }, handoffId: "handoff-1" });
  assert.equal(Object.hasOwn(handoff, "token"), false);
  const consumer = createOperatorManagedHandoffConsumerV1({ handoff, now: () => "2026-08-21T00:00:00.000Z", verify(payload, signature) { return signed.get(payload) === signature; } });
  assert.equal(consumer.consume().providerAccountRef, "account-ref");
  assert.throws(() => consumer.consume(), /already consumed/);
});

test("expired, forged, and extra-field handoffs fail closed", () => {
  assert.throws(() => parseOperatorManagedHandoffV1({ v: "reelier.operator-handoff/v1", handoffId: "x", mode: "managed-cell", providerAccountRef: "a", authorityDigest: "a", contractDigest: "b", expiresAt: "2099-01-01T00:00:00.000Z", signature: "s", secret: "do-not-accept" }));
  const handoff = createOperatorManagedHandoffV1({ mode: "managed-cell", providerAccountRef: "a", authorityDigest: "a", contractDigest: "b", expiresAt: "2020-01-01T00:00:00.000Z", sign: () => "s" });
  const consumer = createOperatorManagedHandoffConsumerV1({ handoff, now: () => "2026-08-21T00:00:00.000Z", verify: () => true });
  assert.throws(() => consumer.consume(), /expired/);
});
