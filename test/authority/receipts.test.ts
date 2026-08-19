import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFileReceiptPublication } from "../../src/authority/host/receipts.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";

const state = { reservation: { reservationId: "r1", state: "reserved", intent: { effectDigest: "sha256:" + "1".repeat(64) } }, effect: { x: 1 }, effectCanonicalBase64: "e30=", effectDigest: "sha256:" + "1".repeat(64) } as any;

test("file receipt publication is immutable and idempotent across a restart", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const root = await mkdtemp(path.join(tmpdir(), "reelier-receipts-"));
  try {
    const input = { phase: "dispatch" as const, state, outcome: { kind: "acknowledged" as const, resultDigest: "sha256:" + "2".repeat(64) }, dispatchedRequestDigest: "sha256:" + "3".repeat(64) };
    const first = await createFileReceiptPublication({ rootDir: root }).publish(input);
    const second = await createFileReceiptPublication({ rootDir: root }).publish(input);
    assert.deepEqual(second, first);
    const files = (await import("node:fs/promises")).readdir(root);
    assert.equal((await files).length, 1);
    const body = JSON.parse(await readFile(path.join(root, (await files)[0]!), "utf8"));
    assert.equal(body.receiptRef, first.receiptRef);
  } finally { restore(); }
});

test("file receipt publication persists an authoritative durable chain across restart", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const root = await mkdtemp(path.join(tmpdir(), "reelier-durable-receipts-"));
  const identity = { v: "reelier.durable-dispatch-publication-identity/v1", reservationId: "r1", tenant: "tenant_1", requestDigest: "sha256:" + "2".repeat(64), capabilityDigest: "sha256:" + "3".repeat(64), effectDigest: state.effectDigest, routeAuthorityDigest: "sha256:" + "4".repeat(64), expectedDispatchedRequestDigest: "sha256:" + "5".repeat(64), reservationIntentDigest: "sha256:" + "6".repeat(64) } as const;
  const reservation = { phase: "reservation" as const, identity, state, outcome: { kind: "ambiguous" as const, resultDigest: "sha256:" + "7".repeat(64) }, dispatchedRequestDigest: null, priorReceiptDigest: null };
  try {
    const first = createFileReceiptPublication({ rootDir: root });
    assert.equal(typeof first.publishReservation, "function");
    assert.equal(typeof first.loadDurableHead, "function");
    const rootReceipt = await first.publishReservation!(reservation);
    const terminal = await first.publish({ phase: "dispatch", state, outcome: { kind: "acknowledged", resultDigest: "sha256:" + "8".repeat(64) }, dispatchedRequestDigest: identity.expectedDispatchedRequestDigest, priorReceiptDigest: rootReceipt.receiptRef });

    const restarted = createFileReceiptPublication({ rootDir: root });
    const head = await restarted.loadDurableHead!({ v: "reelier.durable-dispatch-publication-query/v1", identity, ledgerState: "dispatched", sendStarted: true });
    assert.deepEqual(head, { v: "reelier.durable-dispatch-publication-head/v1", identity, receiptRef: terminal.receiptRef, evidenceDigest: terminal.evidenceDigest, reservationReceiptRef: rootReceipt.receiptRef, priorReceiptRef: rootReceipt.receiptRef, phase: "dispatch", terminalKind: "acknowledged" });
    assert.deepEqual(await restarted.loadDurableHead!({ v: "reelier.durable-dispatch-publication-query/v1", identity, ledgerState: "dispatched", sendStarted: true }), head, "exact readback converges");
  } finally { restore(); }
});
