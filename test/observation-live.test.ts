import test from "node:test";
import assert from "node:assert/strict";
import { createObservationAdapter, createObservationService, matchInstalledPacks } from "../src/observation/live.js";

test("live adapters normalize host events without raw values and preserve coverage", () => {
  const adapter = createObservationAdapter("herdr");
  const actions = adapter.observe({
    sessionId: "session-1",
    actions: [{ actionId: "a1", tool: "send_email", fieldNames: ["to", "body"], sourceKinds: ["email"], destinationKinds: ["email"], effect: "destructive", coverage: "observed", readBackTools: ["get_message"], observedAt: "2026-08-09T00:00:00.000Z", secret: "must-not-escape" }],
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].adapterId, "observation-herdr-v1");
  assert.equal((actions[0] as unknown as Record<string, unknown>).secret, undefined);
  assert.equal(actions[0].coverage, "observed");
});

test("installed pack matching is deterministic and unknown work remains unsupported", () => {
  const candidate = { actions: [{ tool: "gmail.send", effect: "destructive" }, { tool: "gmail.get", effect: "read" }] } as const;
  const matched = matchInstalledPacks(candidate, [
    { alias: "z_pack", toolPatterns: ["never"] },
    { alias: "gmail_reply_send_v1", toolPatterns: ["gmail.send", "gmail.get"] },
  ]);
  assert.deepEqual(matched, ["gmail_reply_send_v1"]);
  assert.deepEqual(matchInstalledPacks({ actions: [{ tool: "browser.click", effect: "destructive" }] }, []), []);
});

test("observation service accepts closed envelopes and appends normalized actions", async () => {
  const seen: string[] = [];
  const service = createObservationService({ adapter: createObservationAdapter("codex"), onAction: action => { seen.push(action.actionId); } });
  await service.ingest({ v: "reelier.observation-envelope/v1", sequence: 0, sessionId: "s", event: "action", payload: { actionId: "a", tool: "stripe.refund", fieldNames: [], sourceKinds: ["charge"], destinationKinds: ["refund"], effect: "destructive", coverage: "partially_observed", readBackTools: [], observedAt: "2026-08-09T00:00:00.000Z" } });
  assert.deepEqual(seen, ["a"]);
  await assert.rejects(() => service.ingest({ v: "reelier.observation-envelope/v1", sequence: 2, sessionId: "s", event: "unknown", payload: {} }));
});
