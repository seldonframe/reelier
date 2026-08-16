import test from "node:test";
import assert from "node:assert/strict";
import { semanticOutcomeCatalog, semanticOutcomeForAlias } from "../src/packs/index.js";

test("semantic outcome classes remain stable while unsupported provider packs stay explicit", () => {
  assert.equal(semanticOutcomeForAlias("gmail_reply_send_v1")?.semanticClass, "communication_commit_v1");
  assert.equal(semanticOutcomeForAlias("stripe_refund_issue_v1")?.semanticClass, "money_refund_v1");
  assert.equal(semanticOutcomeForAlias("hubspot_ticket_stage_set_v1")?.supported, false);
  assert.ok(semanticOutcomeCatalog.every(entry => typeof entry.supported === "boolean"));
});
