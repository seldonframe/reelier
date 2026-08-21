import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import type { AuthorityAgentToolsV1 } from "../../src/authority/host/agent-tools.js";
import { runEveGovernedOutcomeRehearsalV1 } from "../../conformance/continuity-adapter/v1/eve-fixture/agent/lib/governed-outcomes.js";

const refs = Object.freeze([
  `outcomeref_${"a".repeat(64)}`,
  `outcomeref_${"b".repeat(64)}`,
]);

test("hermetic Eve quartet reconciles composite and Linear-only missions across ambiguity and restart without resend", async () => {
  const durable = new Map<string, "ambiguous" | "reconciled">();
  const providerSends = new Map<string, number>();
  const callNames: string[] = [];
  let restarts = 0;
  let activations = 0;
  let reviews = 0;

  const tools = (): AuthorityAgentToolsV1 => ({
    async agentStatus() {
      callNames.push("reelier_agent_status");
      return { requestId: "", verdict: "accepted", reasonCode: "agent-ready", lifecycleState: "ready", outcomeRefs: refs, capability: { v: "reelier.harness-capability/v1", harnessId: "eve", harnessVersion: "0.39.0", abiDigest: `sha256:${"c".repeat(64)}`, protocolCompatibility: "compatible", transports: ["mcp", "http", "openapi"], fixtureStatus: "passed", liveTested: true, providerCertification: "not-claimed" } };
    },
    async outcomeProposal(input) {
      callNames.push("reelier_outcome_proposal");
      return { requestId: "", verdict: "accepted", reasonCode: "outcome-proposed", lifecycleState: "proposed", outcomeRef: String((input as Record<string, unknown>).outcomeRef) };
    },
    async outcomeRequest(input) {
      callNames.push("reelier_outcome_request");
      const requestId = String((input as Record<string, unknown>).requestId);
      if (!durable.has(requestId)) {
        providerSends.set(requestId, (providerSends.get(requestId) ?? 0) + 1);
        durable.set(requestId, requestId === "request_composite" ? "ambiguous" : "reconciled");
      }
      const state = durable.get(requestId)!;
      return { requestId, verdict: "accepted", reasonCode: state, lifecycleState: state };
    },
    async outcomeStatus(input) {
      callNames.push("reelier_outcome_status");
      const requestId = String((input as Record<string, unknown>).requestId);
      if (durable.get(requestId) === "ambiguous") durable.set(requestId, "reconciled");
      return { requestId, verdict: "accepted", reasonCode: "reconciled", lifecycleState: "reconciled", receiptRef: `receipt_${requestId}` };
    },
  });

  const report = await runEveGovernedOutcomeRehearsalV1({
    missions: [
      { kind: "github-linear-composite", missionId: "mission_composite", grantId: "grant_composite", allocationId: "allocation_composite", runtimeSessionId: "session_composite", authorityCellId: "cell_composite", outcomeRef: refs[0], requestId: "request_composite", promptDigest: `sha256:${"d".repeat(64)}` },
      { kind: "linear-only", missionId: "mission_linear", grantId: "grant_linear", allocationId: "allocation_linear", runtimeSessionId: "session_linear", authorityCellId: "cell_linear", outcomeRef: refs[1], requestId: "request_linear", promptDigest: `sha256:${"e".repeat(64)}` },
    ],
    tools: tools(),
    restart: async () => { restarts += 1; return tools(); },
    confirmStandingActivation: async () => { activations += 1; },
    reviewOutcomes: async outcomes => { reviews += 1; assert.equal(outcomes.length, 2); },
  });

  assert.deepEqual(report, {
    v: "reelier.eve-governed-outcomes-rehearsal/v1",
    harness: { id: "eve", version: "0.39.0", fixturePassed: true, providerCertification: "not-claimed" },
    activationConfirmations: 1,
    routineApprovals: 0,
    processRestarts: 1,
    reconciledOutcomes: 2,
    postRunReviews: 1,
    outcomesPerReview: 2,
    durableRecords: [
      { kind: "github-linear-composite", missionId: "mission_composite", grantId: "grant_composite", allocationId: "allocation_composite", runtimeSessionId: "session_composite", authorityCellId: "cell_composite", requestId: "request_composite", promptDigest: `sha256:${"d".repeat(64)}`, lifecycleState: "reconciled", receiptRef: "receipt_request_composite" },
      { kind: "linear-only", missionId: "mission_linear", grantId: "grant_linear", allocationId: "allocation_linear", runtimeSessionId: "session_linear", authorityCellId: "cell_linear", requestId: "request_linear", promptDigest: `sha256:${"e".repeat(64)}`, lifecycleState: "reconciled", receiptRef: "receipt_request_linear" },
    ],
    logs: ["mission_composite:reconciled", "mission_linear:reconciled"],
  });
  assert.equal(activations, 1);
  assert.equal(reviews, 1);
  assert.equal(restarts, 1);
  assert.deepEqual([...providerSends.values()], [1, 1]);
  assert.deepEqual(callNames, [
    "reelier_agent_status",
    "reelier_outcome_proposal", "reelier_outcome_request",
    "reelier_outcome_status",
    "reelier_outcome_proposal", "reelier_outcome_request", "reelier_outcome_status",
  ]);
  const retained = JSON.stringify(report);
  for (const forbidden of ["credential", "secret", "raw prompt", "model reasoning", "github.com", "api.linear.app", "providerStatusId"]) assert.equal(retained.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
});

const eveRoot = path.resolve("conformance/continuity-adapter/v1/eve-fixture");
const realProcessSkip = !existsSync(path.join(eveRoot, "node_modules", "eve"))
  ? "requires pinned Eve 0.39.0 dependency: npm --prefix conformance/continuity-adapter/v1/eve-fixture ci --ignore-scripts"
  : Number(process.versions.node.split(".")[0]) !== 24
    ? `requires Eve 0.39.0 native prerequisite Node 24; received ${process.version}`
    : false;

test("real Eve 0.39.0 process loads the governed-outcomes quartet fixture", { skip: realProcessSkip }, async () => {
  const module = await import("../../conformance/continuity-adapter/v1/eve-fixture/agent/lib/governed-outcomes.js");
  assert.equal(typeof module.runEveGovernedOutcomeRehearsalV1, "function");
});
