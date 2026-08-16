import test from "node:test";
import assert from "node:assert/strict";
import { clusterObservedActions, createShadowReport, normalizeObservedAction } from "reelier/observation";

test("observation is shape-only and honestly reports incomplete coverage", () => {
  const action = normalizeObservedAction({ v: "reelier.observed-action/v1", adapterId: "mcp", sessionId: "s1", actionId: "a1", tool: "gmail.send", fieldNames: ["threadId", "text"], sourceKinds: ["gmail.thread"], destinationKinds: ["gmail.message"], effect: "idempotent-write", coverage: "observed", readBackTools: ["gmail.get"], observedAt: "2026-08-09T00:00:00.000Z" });
  const candidate = clusterObservedActions([action], "candidate_1", 3, ["gmail_reply_send_v1"]);
  assert.equal(candidate.occurrences, 3); assert.deepEqual(candidate.compatiblePacks, ["gmail_reply_send_v1"]);
  const report = createShadowReport(candidate); assert.equal(report.status, "ready"); assert.match(report.reportDigest, /^sha256:/);
  const partial = clusterObservedActions([{ ...action, coverage: "partially_observed" }], "candidate_2", 1, ["gmail_reply_send_v1"]);
  assert.equal(createShadowReport(partial).status, "needs_human_definition");
});
