import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createAuthorityAgentTools, type AuthorityAgentToolsV1 } from "../../src/authority/host/agent-tools.js";
import { createHarnessCapabilityDescriptorV1 } from "../../src/authority/ingress/agent-tool-contracts.js";
import { runEveGovernedOutcomeRehearsalV1 } from "../../conformance/continuity-adapter/v1/eve-fixture/agent/lib/governed-outcomes.js";
import { readCellAgentStatus, readCellOutcomeProposal } from "../../conformance/continuity-adapter/v1/eve-fixture/agent/lib/cell.js";

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

  const tools = (): AuthorityAgentToolsV1 => createAuthorityAgentTools({
    async jobsSearch() {
      callNames.push("reelier_agent_status");
      return { requestId: "", verdict: "accepted", reasonCode: "agent-ready", lifecycleState: "ready", jobs: refs.map(jobRef => ({ jobRef })) };
    },
    async jobLoad(input) {
      callNames.push("reelier_outcome_proposal");
      return { requestId: "", verdict: "accepted", reasonCode: "outcome-proposed", lifecycleState: "proposed", jobRef: String((input as Record<string, unknown>).jobId) };
    },
    async invoke(input) {
      callNames.push("reelier_outcome_request");
      const requestId = String((input as Record<string, unknown>).requestId);
      if (!durable.has(requestId)) {
        providerSends.set(requestId, (providerSends.get(requestId) ?? 0) + 1);
        durable.set(requestId, requestId === "request_composite" ? "ambiguous" : "reconciled");
      }
      const state = durable.get(requestId)!;
      return { requestId, verdict: "accepted", reasonCode: state, lifecycleState: state };
    },
    async status(input) {
      callNames.push("reelier_outcome_status");
      const requestId = String((input as Record<string, unknown>).requestId);
      if (durable.get(requestId) === "ambiguous") durable.set(requestId, "reconciled");
      return { requestId, verdict: "accepted", reasonCode: "reconciled", lifecycleState: "reconciled", receiptRef: `receipt_${requestId}` };
    },
  }, createHarnessCapabilityDescriptorV1({ harnessId: "eve", harnessVersion: "0.39.0", fixturePassed: true }));

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

test("Eve Cell projections accept only the canonical quartet's closed redacted responses", () => {
  const capability = { v: "reelier.harness-capability/v1", harnessId: null, harnessVersion: null, abiDigest: `sha256:${"c".repeat(64)}`, protocolCompatibility: "compatible", transports: ["mcp", "http", "openapi"], fixtureStatus: "not-passed", liveTested: false, providerCertification: "not-claimed" };
  assert.deepEqual(readCellAgentStatus({ requestId: "", verdict: "accepted", reasonCode: "agent-ready", lifecycleState: "ready", outcomeRefs: refs, capability }), { requestId: "", verdict: "accepted", reasonCode: "agent-ready", lifecycleState: "ready", outcomeRefs: refs, capability });
  assert.deepEqual(readCellOutcomeProposal({ requestId: "", verdict: "accepted", reasonCode: "outcome-proposed", lifecycleState: "proposed", outcomeRef: refs[0] }), { requestId: "", verdict: "accepted", reasonCode: "outcome-proposed", lifecycleState: "proposed", outcomeRef: refs[0] });
  assert.throws(() => readCellAgentStatus({ requestId: "", verdict: "accepted", reasonCode: "agent-ready", lifecycleState: "ready", outcomeRefs: refs, capability, credential: "must-not-cross" }), /closed|unexpected/i);
  assert.throws(() => readCellOutcomeProposal({ requestId: "", verdict: "accepted", reasonCode: "outcome-proposed", lifecycleState: "proposed", outcomeRef: "github_merge" }), /opaque|reference/i);
});

const eveRoot = path.resolve("conformance/continuity-adapter/v1/eve-fixture");
const realProcessSkip = !existsSync(path.join(eveRoot, "node_modules", "eve"))
  ? "requires pinned Eve 0.39.0 dependency: npm --prefix conformance/continuity-adapter/v1/eve-fixture ci --ignore-scripts"
  : Number(process.versions.node.split(".")[0]) !== 24
    ? `requires Eve 0.39.0 native prerequisite Node 24; received ${process.version}`
    : false;

test("real Eve 0.39.0 process loads the governed-outcomes quartet fixture", { skip: realProcessSkip }, async () => {
  const processModule = await import(pathToFileURL(path.join(eveRoot, "scripts", "eve-process.mjs")).href) as Readonly<{
    startEveProcess(input: Readonly<{ cwd: string; env: Record<string, string> }>): Promise<Readonly<{ child: unknown; url: string; diagnostics(): string }>>;
    stopEveProcess(child: unknown): Promise<void>;
  }>;
  const continuityRoot = await mkdtemp(path.join(os.tmpdir(), "reelier-eve-governed-outcomes-"));
  const token = randomBytes(32).toString("base64url");
  const tokenDigest = createHash("sha256").update(token).digest("hex");
  const inherited = Object.fromEntries(["PATH", "Path", "PATHEXT", "SystemRoot", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
  let running: Awaited<ReturnType<typeof processModule.startEveProcess>> | undefined;
  try {
    running = await processModule.startEveProcess({
      cwd: eveRoot,
      env: {
        ...inherited,
        EVE_EVAL_AUTH_TOKEN: token,
        REELIER_EVE_AUTH_REGISTRY_JSON: JSON.stringify({ [tokenDigest]: { principalId: "principal_eve_governed", taskId: "task_eve_governed", taskOwnerPrincipalId: "principal_eve_governed", workloadId: "workload_eve_governed" } }),
        REELIER_CONTINUITY_ROOT: continuityRoot,
        REELIER_CONTINUITY_PROTOCOL_V: "reelier.continuity-checkpoint/v1",
        REELIER_JOB_CARD_DIGEST: `sha256:${"a".repeat(64)}`,
        REELIER_AUTHORITY_SNAPSHOT_DIGEST: `sha256:${"b".repeat(64)}`,
        REELIER_PATH_C_PORT_URL: "http://127.0.0.1:1",
        REELIER_PATH_C_PORT_TOKEN: randomBytes(32).toString("base64url"),
        REELIER_CELL_URL: "http://127.0.0.1:1",
        REELIER_CELL_TOKEN: randomBytes(32).toString("base64url"),
      },
    });
    assert.match(running.url, /^http:\/\/127\.0\.0\.1:[0-9]+$/);
    assert.equal(running.diagnostics().toLowerCase().includes("failed"), false, running.diagnostics());
  } finally {
    await processModule.stopEveProcess(running?.child);
    await rm(continuityRoot, { recursive: true, force: true });
  }
});
