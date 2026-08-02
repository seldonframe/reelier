import { test } from "node:test";
import assert from "node:assert/strict";
import { createReservedDispatchHandle, unwrapReservedDispatchHandle } from "../../src/authority/gate.js";

test("reserved dispatch handle is empty, frozen, non-serializing, and rejects structural and symbol forgeries", () => {
  const privateState = Object.freeze({ reservationId: "reservation_1", capabilityDigest: "sha256:" + "1".repeat(64) });
  const handle = createReservedDispatchHandle(privateState);
  assert.equal(Object.isFrozen(handle), true);
  assert.deepEqual(Object.keys(handle), []);
  assert.equal(JSON.stringify(handle), "{}");
  assert.deepEqual(unwrapReservedDispatchHandle(handle), privateState);
  assert.throws(() => unwrapReservedDispatchHandle({} as never), /reserved dispatch handle/i);
  assert.throws(() => unwrapReservedDispatchHandle(structuredClone(handle) as never), /reserved dispatch handle/i);
  for (const symbol of Object.getOwnPropertySymbols(handle)) assert.throws(() => unwrapReservedDispatchHandle({ [symbol]: true } as never), /reserved dispatch handle/i);
});
