import assert from "node:assert/strict";
import test from "node:test";
import { createPortableAuthorityReceiptPublication } from "../../src/authority/host/portable-receipts.js";
import * as localHost from "../../src/authority/host/local.js";

test("generic portable publication durably publishes local evidence before exposing the portable result", async () => {
  const calls: string[] = [];
  const publication = createPortableAuthorityReceiptPublication({
    localPublication: {
      async publish() {
        calls.push("local");
        return { receiptRef: "sha256:" + "1".repeat(64), evidenceDigest: "sha256:" + "2".repeat(64) };
      },
    },
    portablePublication: {
      async publish() {
        calls.push("portable");
        return { receiptRef: "sha256:" + "3".repeat(64), evidenceDigest: "sha256:" + "4".repeat(64) };
      },
    },
  });

  const result = await publication.publish({ phase: "cancelled", state: {} as never, outcome: {} as never, dispatchedRequestDigest: null });
  assert.deepEqual(calls, ["local", "portable"]);
  assert.deepEqual(result, { receiptRef: "sha256:" + "3".repeat(64), evidenceDigest: "sha256:" + "4".repeat(64) });
});

test("local runtime publication never exposes portable evidence before durable local publication", async () => {
  const createLocalAuthorityReceiptPublication = (localHost as Record<string, any>).createLocalAuthorityReceiptPublication as (input: any) => any;
  const calls: string[] = [];
  const failed = createLocalAuthorityReceiptPublication({
    localPublication: { async publish() { calls.push("local-failed"); throw new Error("disk full"); } },
    portablePublication: { async publish() { calls.push("portable"); return { receiptRef: "sha256:" + "3".repeat(64), evidenceDigest: "sha256:" + "4".repeat(64) }; } },
  });
  await assert.rejects(() => failed.publish({ phase: "cancelled", state: {} as never, outcome: {} as never, dispatchedRequestDigest: null }), /disk full/);
  assert.deepEqual(calls, ["local-failed"]);

  calls.length = 0;
  const successful = createLocalAuthorityReceiptPublication({
    localPublication: { async publish() { calls.push("local"); return { receiptRef: "sha256:" + "1".repeat(64), evidenceDigest: "sha256:" + "2".repeat(64) }; } },
    portablePublication: { async publish() { calls.push("portable"); return { receiptRef: "sha256:" + "3".repeat(64), evidenceDigest: "sha256:" + "4".repeat(64) }; } },
  });
  await successful.publish({ phase: "cancelled", state: {} as never, outcome: {} as never, dispatchedRequestDigest: null });
  assert.deepEqual(calls, ["local", "portable"]);
});
