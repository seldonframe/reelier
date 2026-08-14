import test from "node:test";
import assert from "node:assert/strict";
import type { VerifiedAuthorityReceiptBundle } from "../../src/authority/verify.js";
import { authorityDigest } from "../../src/authority/wire.js";
import { continuityEventsFromVerifiedAuthorityReceipt } from "../../src/continuity/authority-bridge.js";
import { digest } from "./fixtures.js";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function verifiedReceipt(): VerifiedAuthorityReceiptBundle {
  const decisionContext = { tenant: "tenant_1", requestKey: digest("4") };
  const decisionContextDigest = authorityDigest(decisionContext);
  const gateEventDigest = digest("5");
  const evidenceValue = {
    receiptId: "receipt_1",
    decisionContextDigest,
    gateEventDigest,
    reservationId: "reservation_1",
    timeline: [
      { state: "reserved", eventDigest: digest("1") },
      { state: "dispatched", eventDigest: digest("2") },
      { state: "ambiguous", eventDigest: digest("3") },
    ],
  };
  const evidenceDigest = authorityDigest(evidenceValue);
  const receiptValue = {
    receiptId: "receipt_1",
    decisionContextDigest,
    gateEventDigest,
    evidenceDigest,
    decisionContext,
  };
  const receiptDigest = authorityDigest(receiptValue);
  const bundle = deepFreeze({
    evidence: {
      digest: evidenceDigest,
      value: evidenceValue,
    },
    receipt: {
      digest: receiptDigest,
      value: receiptValue,
    },
  });
  return Object.freeze({
    bundle,
    digest: authorityDigest(bundle),
    tenant: "tenant_1",
    claims: Object.freeze({}),
    priorReceiptDigest: null,
  }) as unknown as VerifiedAuthorityReceiptBundle;
}

test("verified Path C evidence becomes a deterministic continuity consequence timeline", () => {
  const verified = verifiedReceipt();
  const evidenceDigest = verified.bundle.evidence.digest;
  const receiptDigest = verified.bundle.receipt.digest;
  assert.deepEqual(continuityEventsFromVerifiedAuthorityReceipt(verified), [
    {
      type: "consequence.observed",
      eventId: digest("1"),
      semanticOperationId: digest("4"),
      reservationId: "reservation_1",
      state: "reserved",
      authorityEvidenceDigest: evidenceDigest,
      receiptDigest,
    },
    {
      type: "consequence.observed",
      eventId: digest("2"),
      semanticOperationId: digest("4"),
      reservationId: "reservation_1",
      state: "dispatched",
      authorityEvidenceDigest: evidenceDigest,
      receiptDigest,
    },
    {
      type: "consequence.observed",
      eventId: digest("3"),
      semanticOperationId: digest("4"),
      reservationId: "reservation_1",
      state: "ambiguous",
      authorityEvidenceDigest: evidenceDigest,
      receiptDigest,
    },
  ]);
});

test("the continuity bridge refuses a substituted verified-bundle digest", () => {
  const verified = verifiedReceipt();
  const substituted = Object.freeze({ ...verified, digest: digest("0") });
  assert.throws(
    () => continuityEventsFromVerifiedAuthorityReceipt(substituted),
    /verified authority receipt bundle digest mismatch/i,
  );
});

test("the continuity bridge refuses a broken receipt-to-evidence edge", () => {
  const verified = verifiedReceipt();
  const receiptValue = { ...verified.bundle.receipt.value, evidenceDigest: digest("0") };
  const bundle = deepFreeze({
    ...verified.bundle,
    receipt: {
      ...verified.bundle.receipt,
      digest: authorityDigest(receiptValue),
      value: receiptValue,
    },
  });
  const substituted = Object.freeze({ ...verified, bundle, digest: authorityDigest(bundle) });
  assert.throws(
    () => continuityEventsFromVerifiedAuthorityReceipt(substituted),
    /receipt evidence digest mismatch/i,
  );
});

test("the continuity bridge refuses a substituted decision context", () => {
  const verified = verifiedReceipt();
  const decisionContext = { ...verified.bundle.receipt.value.decisionContext, requestKey: digest("6") };
  const receiptValue = {
    ...verified.bundle.receipt.value,
    decisionContext,
    decisionContextDigest: authorityDigest(decisionContext),
  };
  const bundle = deepFreeze({
    ...verified.bundle,
    receipt: {
      ...verified.bundle.receipt,
      digest: authorityDigest(receiptValue),
      value: receiptValue,
    },
  });
  const substituted = Object.freeze({ ...verified, bundle, digest: authorityDigest(bundle) });
  assert.throws(
    () => continuityEventsFromVerifiedAuthorityReceipt(substituted),
    /decision context edge mismatch/i,
  );
});
