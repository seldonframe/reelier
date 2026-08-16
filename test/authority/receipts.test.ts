import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFileReceiptPublication } from "reelier/authority/host";

const state = { reservation: { reservationId: "r1", state: "reserved", intent: { effectDigest: "sha256:" + "1".repeat(64) } }, effect: { x: 1 }, effectCanonicalBase64: "e30=", effectDigest: "sha256:" + "1".repeat(64) } as any;

test("file receipt publication is immutable and idempotent across a restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-receipts-"));
  const input = { phase: "dispatch" as const, state, outcome: { kind: "acknowledged" as const, resultDigest: "sha256:" + "2".repeat(64) }, dispatchedRequestDigest: "sha256:" + "3".repeat(64) };
  const first = await createFileReceiptPublication({ rootDir: root }).publish(input);
  const second = await createFileReceiptPublication({ rootDir: root }).publish(input);
  assert.deepEqual(second, first);
  const files = (await import("node:fs/promises")).readdir(root);
  assert.equal((await files).length, 1);
  const body = JSON.parse(await readFile(path.join(root, (await files)[0]!), "utf8"));
  assert.equal(body.receiptRef, first.receiptRef);
});
