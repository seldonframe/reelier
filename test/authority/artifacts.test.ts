import test from "node:test";
import assert from "node:assert/strict";
import { createArtifactStore } from "reelier/authority/host";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

test("durable artifact store survives a new host instance with a wrapped tenant key", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-artifacts-"));
  try {
    const options = { tenant: "tenant_1", key: Buffer.alloc(32, 9), masterKey: Buffer.alloc(32, 3), rootDir: root, now: () => new Date("2026-08-09T00:00:00.000Z") };
    const first = createArtifactStore(options);
    const staged = await first.stage({ mediaType: "text/plain", bytes: Buffer.from("durable") });
    const second = createArtifactStore(options);
    assert.deepEqual(await second.read(staged.commitment.reference), Buffer.from("durable"));
    await second.deleteAfterTerminal(staged.commitment.reference);
    await assert.rejects(() => first.read(staged.commitment.reference));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("artifact metadata is authenticated, bounded, and references cannot escape the store", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-artifacts-tamper-"));
  try {
    const store = createArtifactStore({ tenant: "tenant_1", key: Buffer.alloc(32, 4), masterKey: Buffer.alloc(32, 5), rootDir: root, now: () => new Date("2026-08-09T00:00:00.000Z") });
    const staged = await store.stage({ mediaType: "text/plain", bytes: Buffer.from("safe") });
    const metadataPath = path.join(root, `${staged.commitment.reference}.json`);
    const metadata = JSON.parse(await (await import("node:fs/promises")).readFile(metadataPath, "utf8")) as { commitment: Record<string, unknown> };
    metadata.commitment.byteCount = 999;
    await (await import("node:fs/promises")).writeFile(metadataPath, JSON.stringify(metadata), "utf8");
    await assert.rejects(() => store.read(staged.commitment.reference));
    await assert.rejects(() => store.read("../../outside"));
    await assert.rejects(() => store.stage({ mediaType: "text/plain", bytes: Buffer.alloc(262145) }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("artifact deletion tombstone remains authoritative after restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-artifact-tombstone-"));
  const store = createArtifactStore({ tenant: "tenant", key: Buffer.alloc(32, 4), rootDir: root });
  const staged = await store.stage({ mediaType: "text/plain", bytes: Buffer.from("secret") });
  await writeFile(path.join(root, `${staged.commitment.reference}.deleted`), JSON.stringify({ reference: staged.commitment.reference, digest: staged.commitment.digest, deletedAt: new Date().toISOString(), reason: "terminal" }));
  const restarted = createArtifactStore({ tenant: "tenant", key: Buffer.alloc(32, 4), rootDir: root });
  await assert.rejects(() => restarted.read(staged.commitment.reference), /unavailable/);
});
