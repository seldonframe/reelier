import test from "node:test";
import assert from "node:assert/strict";
import { createArtifactStore } from "reelier/authority/host";

test("staged artifacts return only an opaque commitment and can be read by the host", async () => {
  const store = createArtifactStore({ tenant: "tenant_1", key: Buffer.alloc(32, 7), now: () => new Date("2026-08-09T00:00:00.000Z") });
  const staged = await store.stage({ mediaType: "text/plain", bytes: Buffer.from("hello") });
  assert.equal(staged.commitment.v, "reelier.staged-artifact-commitment/v1");
  assert.equal(staged.commitment.byteCount, 5);
  assert.match(staged.commitment.digest, /^sha256:/);
  assert.equal("bytes" in staged.commitment, false);
  assert.deepEqual(await store.read(staged.commitment.reference), Buffer.from("hello"));
  await store.deleteAfterTerminal(staged.commitment.reference);
  await assert.rejects(() => store.read(staged.commitment.reference));
});

test("staged artifact TTL is bounded to seven days by default and thirty days by contract", async () => {
  const store = createArtifactStore({ tenant: "tenant_1", key: Buffer.alloc(32, 8), now: () => new Date("2026-08-09T00:00:00.000Z") });
  const staged = await store.stage({ mediaType: "text/plain", bytes: Buffer.from("x"), expiresAt: new Date("2026-08-10T00:00:00.000Z") });
  assert.equal(staged.commitment.expiresAt, "2026-08-10T00:00:00.000Z");
  await assert.rejects(() => store.stage({ mediaType: "text/plain", bytes: Buffer.from("x"), expiresAt: new Date("2026-09-10T00:00:00.000Z") }));
});
