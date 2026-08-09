import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAuthorityWire } from "../../src/authority/wire.js";
import { compileGmailReply, parseGmailReplyPolicy, compileGmailLabels, parseGmailLabelsPolicy } from "../../src/packs/gmail/index.js";
import { compileStripeRefund, parseStripeRefundPolicy } from "../../src/packs/stripe/index.js";

const exactEffectFields = ["v", "endpointId", "method", "path", "query", "headers", "bodyBase64", "riskClass", "idempotency", "preconditions", "reconciliation"];

test("Gmail reply and label effects are closed transport-effect wires", () => {
  const source = { threadId: "thread_1", messageId: "<old@example.com>", recipient: "customer@example.com", subject: "Question", labelIds: [] };
  const reply = compileGmailReply({ source, policy: parseGmailReplyPolicy({ text: "Thanks" }), outcomeKey: "outcome_1" });
  const labels = compileGmailLabels({ source, policy: parseGmailLabelsPolicy({ addLabelIds: ["IMPORTANT"], removeLabelIds: [] }) });
  for (const effect of [reply, labels] as unknown[]) {
    assert.deepEqual(Object.keys(effect as object).sort(), exactEffectFields.slice().sort());
    assert.deepEqual(parseAuthorityWire("transport-effect", effect), effect);
  }
});

test("Stripe refund effects are closed transport-effect wires", () => {
  const effect = compileStripeRefund({ source: { chargeId: "ch_1", customerEmail: "customer@example.com", currency: "usd", amount: 5000, amountRefunded: 0, paid: true }, policy: parseStripeRefundPolicy({ currency: "usd", maxRefund: 5000, maxChargeAgeSeconds: 86400 }), gmailSender: "customer@example.com", now: new Date("2026-08-09T00:00:00Z"), tenant: "tenant_1", definition: "stripe_refund_issue_v1" });
  assert.deepEqual(Object.keys(effect).sort(), exactEffectFields.slice().sort());
  assert.deepEqual(parseAuthorityWire("transport-effect", effect), effect);
});
