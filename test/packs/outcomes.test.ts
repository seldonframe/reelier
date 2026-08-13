import test from "node:test";
import assert from "node:assert/strict";
import { compileGmailReply, parseGmailReplyPolicy, reconcileGmailReply } from "reelier/packs";
import { compileStripeRefund, parseStripeRefundPolicy, reconcileStripeRefund } from "reelier/packs";

test("Gmail reply compiles deterministic RFC bytes and reconciles by message identity", () => {
  const effect = compileGmailReply({ source: { threadId: "thread_1", messageId: "<old@example.com>", recipient: "customer@example.com", subject: "Question", labelIds: [] }, policy: parseGmailReplyPolicy({ text: "Thanks" }), outcomeKey: "outcome_1" });
  assert.equal(effect.method, "POST"); assert.equal(effect.endpointId, "gmail.users.messages.send"); assert.match(effect.messageId, /^<reelier-/);
  assert.equal(reconcileGmailReply({ expectedMessageId: effect.messageId, response: { body: { messageId: effect.messageId } } }).status, "matched");
  assert.equal(reconcileGmailReply({ expectedMessageId: effect.messageId, response: { body: {} } }).status, "not-applied");
});

test("Stripe refund is full-only and binds idempotency to tenant/definition/charge", () => {
  const effect = compileStripeRefund({ source: { chargeId: "ch_1", customerEmail: "customer@example.com", currency: "usd", amount: 5000, amountRefunded: 0, paid: true }, policy: parseStripeRefundPolicy({ currency: "usd", maxRefund: 5000, maxChargeAgeSeconds: 86400 }), gmailSender: "customer@example.com", now: new Date("2026-08-09T00:00:00Z"), tenant: "tenant_1", definition: "stripe_refund_issue_v1" });
  assert.match(effect.headers["Idempotency-Key"], /^reelier-/); assert.equal(Buffer.from(effect.bodyBase64, "base64").toString(), "charge=ch_1");
  assert.equal(reconcileStripeRefund({ chargeId: "ch_1", expectedAmount: 5000, response: { body: { charge: "ch_1", amount: 5000 } } }).status, "matched");
  assert.throws(() => compileStripeRefund({ source: { chargeId: "ch_1", customerEmail: "other@example.com", currency: "usd", amount: 5000, amountRefunded: 0, paid: true }, policy: parseStripeRefundPolicy({ currency: "usd", maxRefund: 5000, maxChargeAgeSeconds: 86400 }), gmailSender: "customer@example.com", now: new Date(), tenant: "tenant_1", definition: "stripe_refund_issue_v1" }));
});
