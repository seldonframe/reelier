import test from "node:test";
import assert from "node:assert/strict";
import { authorityDigest } from "../../src/authority/wire.js";
import { compileEffectTransportV1, mintTrustedEffectTransportExecutorV1 } from "../../src/authority/host/effect-transports.js";
import { createOutcomeKernel, createTrustedObservationVerifier, type StoredEffectLifecycleV1 } from "../../src/authority/host/outcome-kernel.js";
import {
  assertGitHubLinearProviderReadbackV1,
  createGitHubLinearOutcomePackV1,
  orderedGitHubLinearOperationsV1,
} from "../../src/authority/packs/github-linear-outcomes.js";

const sha = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;
const git = (seed: string) => seed.repeat(40);

function reviewedInput() {
  return {
    v: "reelier.github-linear-reviewed-authority/v1" as const,
    github: {
      repository: "seldonframe/reelier",
      baseBranch: "main",
      baseSha: git("a"),
      headBranch: "reelier/release/0.33.0",
      headSha: git("b"),
      candidateDigest: sha("c"),
      workflowPath: ".github/workflows/ci.yml",
      workflowDigest: sha("d"),
      requiredChecks: ["coverage", "full-tests", "mutation"],
      mergeMethod: "squash" as const,
      postMergeTreeSha: git("e"),
      accountRef: "github_account_ref",
      destinationRef: "github_repository_ref",
      credentialRef: "github_credential_ref",
      limitRef: "github_release_policy_ref",
    },
    linear: {
      workspace: "workspace_01",
      team: "team_01",
      project: "project_01",
      issue: "REEL-TEST-1",
      preStatus: "In Progress",
      targetStatus: "Done",
      commentMarker: "reelier:evidence:mission_01",
      evidenceUrl: "https://www.reelier.com/r/receipt_01",
      evidenceContentDigest: sha("f"),
      accountRef: "linear_account_ref",
      destinationRef: "linear_issue_ref",
      credentialRef: "linear_credential_ref",
      limitRef: "linear_transition_policy_ref",
    },
  };
}

test("reviewed pack binds exact GitHub and Linear authority while model fields contain no provider identity", () => {
  const pack = createGitHubLinearOutcomePackV1(reviewedInput());
  assert.deepEqual(Object.keys(pack.operations), ["candidatePublish", "pullRequestEnsure", "exactHeadMerge", "linearEvidenceComment", "linearStatusTransition"]);
  for (const operation of Object.values(pack.operations)) {
    assert.equal(operation.contract.operationDigest, authorityDigest(operation.binding));
    assert.equal(operation.metadata.contractDigest, authorityDigest(operation.contract));
    assert.equal(JSON.stringify(operation.contract.model).match(/workspace|team|project|issue|repository|status|credential|token|oauth/gi), null);
  }
  assert.deepEqual(pack.operations.exactHeadMerge.contract.model.fields, ["authorizationHandle", "requestId", "semanticsDigest"]);
  assert.deepEqual(pack.operations.linearEvidenceComment.contract.model.fields, ["evidenceUrl"]);
  assert.deepEqual(pack.operations.linearStatusTransition.contract.model.fields, ["requestId"]);
  assert.equal(pack.operations.exactHeadMerge.contract.policyDigest, pack.githubPolicyDigest);
  assert.equal(pack.operations.linearStatusTransition.contract.policyDigest, pack.linearPolicyDigest);
});

test("Linear readback binds exact project, issue, marker, and status without accepting credentials", () => {
  const pack = createGitHubLinearOutcomePackV1(reviewedInput());
  const exactComment = { workspace: "workspace_01", team: "team_01", project: "project_01", issue: "REEL-TEST-1", commentMarker: "reelier:evidence:mission_01", evidenceUrl: "https://www.reelier.com/r/receipt_01", evidenceContentDigest: sha("f"), commentId: "comment_01" };
  const first = assertGitHubLinearProviderReadbackV1(pack, "linearEvidenceComment", exactComment);
  const duplicate = assertGitHubLinearProviderReadbackV1(pack, "linearEvidenceComment", structuredClone(exactComment));
  assert.deepEqual(duplicate, first, "an exact duplicate comment converges to the same projection");
  for (const changed of [
    { ...exactComment, project: "other_project" },
    { ...exactComment, issue: "REEL-OTHER" },
    { ...exactComment, commentMarker: "conflicting-marker" },
    { ...exactComment, evidenceUrl: "https://www.reelier.com/r/other" },
    { ...exactComment, evidenceContentDigest: sha("0") },
  ]) assert.throws(() => assertGitHubLinearProviderReadbackV1(pack, "linearEvidenceComment", changed), /conflict|exact/i);
  const status = assertGitHubLinearProviderReadbackV1(pack, "linearStatusTransition", { workspace: "workspace_01", team: "team_01", project: "project_01", issue: "REEL-TEST-1", preStatus: "In Progress", targetStatus: "Done", status: "Done" });
  assert.equal(status.status, "Done");
  assert.throws(() => assertGitHubLinearProviderReadbackV1(pack, "linearStatusTransition", { ...status, preStatus: "Todo" }), /conflict|exact/i);
  assert.throws(() => assertGitHubLinearProviderReadbackV1(pack, "linearStatusTransition", { ...status, targetStatus: "Cancelled" }), /conflict|exact/i);
  assert.throws(() => assertGitHubLinearProviderReadbackV1(pack, "linearStatusTransition", { ...status, credential: "secret" } as any), /closed|unknown/i);
});

test("GitHub merge readback closes exact base, head, merge commit, and post-merge tree", () => {
  const pack = createGitHubLinearOutcomePackV1(reviewedInput());
  const exact = { repository: "seldonframe/reelier", baseSha: git("a"), headSha: git("b"), mergeCommitSha: git("f"), treeSha: git("e") };
  assert.deepEqual({ ...assertGitHubLinearProviderReadbackV1(pack, "exactHeadMerge", exact) }, exact);
  for (const changed of [{ ...exact, baseSha: git("0") }, { ...exact, headSha: git("1") }, { ...exact, treeSha: git("2") }, { ...exact, repository: "other/repo" }]) assert.throws(() => assertGitHubLinearProviderReadbackV1(pack, "exactHeadMerge", changed), /conflict|exact/i);
});

test("ambiguous Linear comment and status writes reconcile by readback without resend", async () => {
  const pack = createGitHubLinearOutcomePackV1(reviewedInput());
  for (const [name, model, readback] of [
    ["linearEvidenceComment", { evidenceUrl: "https://www.reelier.com/r/receipt_01" }, { workspace: "workspace_01", team: "team_01", project: "project_01", issue: "REEL-TEST-1", commentMarker: "reelier:evidence:mission_01", evidenceUrl: "https://www.reelier.com/r/receipt_01", evidenceContentDigest: sha("f"), commentId: "comment_01" }],
    ["linearStatusTransition", { requestId: "status_request_01" }, { workspace: "workspace_01", team: "team_01", project: "project_01", issue: "REEL-TEST-1", preStatus: "In Progress", targetStatus: "Done", status: "Done" }],
  ] as const) {
    const operation = pack.operations[name];
    let writes = 0, reads = 0;
    const executor = mintTrustedEffectTransportExecutorV1({ mcp: {
      inspectSchemas(_request, sink): void { sink.success(JSON.stringify({ serverSchemaDigest: (operation.binding as any).serverSchemaDigest, toolSchemaDigest: _request.tool === (operation.binding as any).tool ? (operation.binding as any).toolSchemaDigest : (operation.binding as any).readback.toolSchemaDigest })); },
      call(request, sink): void {
        if (request.tool === (operation.binding as any).tool) { writes += 1; sink.success(JSON.stringify({ outcome: "uncertain", data: {} })); return; }
        reads += 1;
        sink.success(JSON.stringify({ outcome: "applied", data: readback }));
      },
    } });
    const compiled = compileEffectTransportV1({ contract: operation.contract, binding: operation.binding, modelInput: model, observationAuthKey: "b".repeat(64), resolveHostBindings: async () => ({ credential: "linear-secret", account: "workspace_01", destination: "REEL-TEST-1", limit: "linear_policy_01" }), executor });
    const state = { reservation: { reservationId: `${name}_reservation`, state: "dispatched", intent: { effectDigest: authorityDigest(operation.contract) } }, effect: compiled.effect, effectDigest: authorityDigest(operation.contract), effectCanonicalBase64: Buffer.from(JSON.stringify(compiled.effect)).toString("base64") } as any;
    const ambiguous = await compiled.adapter.dispatch(state);
    assert.equal(ambiguous.kind, "ambiguous");
    const reconciled = await compiled.adapter.reconcile!(state, ambiguous);
    assert.equal(reconciled.reconciliationStatus, "matched");
    assert.equal(writes, 1);
    assert.equal(reads, 1);
    assert.equal(JSON.stringify({ evidence: compiled.evidence, reconciled }).includes("linear-secret"), false);
  }
});

test("a verified merge plus unresolved Linear effect remains honestly pending", async () => {
  const pack = createGitHubLinearOutcomePackV1(reviewedInput()), contracts = [pack.operations.exactHeadMerge.contract, pack.operations.linearEvidenceComment.contract];
  const mission = { v: "reelier.mission-claim/v1" as const, missionId: "mission_partial_linear", mandateDigest: sha("1"), promptDigest: sha("2"), contractDigests: contracts.map(authorityDigest), claimedAt: "2026-08-21T12:00:00.000Z" };
  const lifecycle = new Map<string, StoredEffectLifecycleV1>();
  for (const [index, contract] of contracts.entries()) {
    const contractDigest = authorityDigest(contract), reservationId = `reservation_${index}`, semanticIdentity = contract.semanticIdentity;
    const reservation = { v: "reelier.effect-reservation/v1" as const, reservationId, semanticIdentity, contractDigest, reservedAt: "2026-08-21T12:00:00.000Z" };
    const verified = index === 0;
    const attempt = { v: "reelier.attempt/v1" as const, attemptId: `attempt_${index}`, reservationId, semanticIdentity, dispatchedAt: "2026-08-21T12:00:01.000Z", crossedProviderBoundary: true, result: verified ? "acknowledged" as const : "ambiguous" as const };
    const observation = verified ? { v: "reelier.observation/v1" as const, observationId: `observation_${index}`, reservationId, semanticIdentity, observedAt: "2026-08-21T12:00:02.000Z", authoritative: true, verdict: "matched" as const, projectionDigest: sha("8") } : { v: "reelier.observation/v1" as const, observationId: `observation_${index}`, reservationId, semanticIdentity, observedAt: "2026-08-21T12:00:02.000Z", authoritative: false, verdict: "unavailable" as const, projectionDigest: null };
    const outcome = { v: "reelier.governed-outcome/v1" as const, outcomeId: `outcome_${index}`, contractDigest, semanticIdentity, reservation, attempts: [attempt], observation, status: verified ? "verified" as const : "pending" as const, completedAt: "2026-08-21T12:00:03.000Z" };
    lifecycle.set(reservationId, { v: "reelier.stored-effect-lifecycle/v1", missionId: mission.missionId, missionDigest: authorityDigest(mission), contractDigest, reservation, attempt, observation, outcome, revision: 1 });
  }
  const receipts = new Map<string, { receiptId: string; receiptDigest: string; receiptRef: string }>();
  const storage: any = { durable: true, async claimMission() { return { status: "claimed", claim: mission }; }, async loadMission() { return mission; }, async loadEffect(_missionId: string, reservationId: string) { return lifecycle.get(reservationId)!; }, async storeEffect() { throw new Error("stored terminal outcomes must be adopted"); }, async compareAndPublishReceipt(receipt: any, receiptDigest: string) { const head = { receiptId: receipt.receiptId, receiptDigest, receiptRef: authorityDigest({ receiptId: receipt.receiptId }) }; receipts.set(receipt.receiptId, head); return { status: "published", receiptDigest, receiptRef: head.receiptRef }; }, async loadReceipt(receiptId: string) { return receipts.get(receiptId) ?? null; } };
  let providerCalls = 0;
  const ledger: any = { async getReservation(reservationId: string) { const stored = lifecycle.get(reservationId)!; return { reservationId, state: "acknowledged", intent: { effectDigest: stored.contractDigest, issuedAt: stored.reservation.reservedAt } }; } };
  const coordinator: any = { async dispatch() { providerCalls += 1; throw new Error("must not dispatch"); }, async reconcile() { providerCalls += 1; throw new Error("must not reconcile terminal projections"); }, async recover() { providerCalls += 1; } };
  const kernel = createOutcomeKernel({ ledger, coordinator, storage, now: () => Date.parse("2026-08-21T12:00:04.000Z"), authorization: async () => "active" });
  await kernel.claimMission(mission);
  const outcome = await kernel.execute({ missionId: mission.missionId, effects: contracts.map((contract, index) => ({ contract, reservationId: `reservation_${index}`, verifier: createTrustedObservationVerifier({ contractDigest: authorityDigest(contract), verify: () => true }) })) });
  assert.equal(outcome.status, "pending");
  assert.deepEqual(outcome.effects.map(effect => effect.status), ["verified", "pending"]);
  assert.equal(providerCalls, 0);
});

test("composite and Linear-only plans have exact ordering and Linear-only carries no git operation", () => {
  const pack = createGitHubLinearOutcomePackV1(reviewedInput());
  assert.deepEqual(orderedGitHubLinearOperationsV1(pack, "github-linear"), [
    pack.operations.candidatePublish,
    pack.operations.pullRequestEnsure,
    pack.operations.exactHeadMerge,
    pack.operations.linearEvidenceComment,
    pack.operations.linearStatusTransition,
  ]);
  const linearOnly = orderedGitHubLinearOperationsV1(pack, "linear-only");
  assert.deepEqual(linearOnly, [pack.operations.linearEvidenceComment, pack.operations.linearStatusTransition]);
  assert.equal(JSON.stringify(linearOnly).match(/baseSha|headSha|repository|workflow|candidate|merge/gi), null);
});

test("closed reviewed authority refuses wrong identities and hostile DTO roots inertly", () => {
  const base = reviewedInput();
  for (const mutate of [
    (value: any) => { value.github.headSha = git("f"); },
    (value: any) => { value.linear.project = "other_project"; },
    (value: any) => { value.linear.issue = "REEL-OTHER"; },
    (value: any) => { value.linear.preStatus = "Todo"; },
    (value: any) => { value.linear.targetStatus = "Cancelled"; },
  ]) {
    const changed = structuredClone(base) as any;
    mutate(changed);
    assert.notEqual(createGitHubLinearOutcomePackV1(changed).authorityDigest, createGitHubLinearOutcomePackV1(base).authorityDigest);
  }
  assert.throws(() => createGitHubLinearOutcomePackV1({ ...base, github: { ...base.github, workflowPath: ".github/workflows/other.yml" } }), /workflow/i);
  assert.throws(() => createGitHubLinearOutcomePackV1({ ...base, github: { ...base.github, baseBranch: "develop" } }), /main/i);
  assert.throws(() => createGitHubLinearOutcomePackV1({ ...base, extra: true } as any), /closed|unknown/i);
  const hidden = structuredClone(base) as any;
  Object.defineProperty(hidden, "hidden", { value: true });
  assert.throws(() => createGitHubLinearOutcomePackV1(hidden), /closed|unknown/i);
  const symbol = structuredClone(base) as any;
  Object.defineProperty(symbol, Symbol("unknown"), { value: true, enumerable: true });
  assert.throws(() => createGitHubLinearOutcomePackV1(symbol), /closed|unknown/i);
  let getterCalls = 0;
  const accessor = structuredClone(base) as any;
  Object.defineProperty(accessor.linear, "project", { enumerable: true, get() { getterCalls += 1; return "project_01"; } });
  assert.throws(() => createGitHubLinearOutcomePackV1(accessor), /inert|data|property/i);
  assert.equal(getterCalls, 0);
  let traps = 0;
  assert.throws(() => createGitHubLinearOutcomePackV1(new Proxy(base, { ownKeys() { traps += 1; return []; } }) as any), /inert|proxy/i);
  assert.equal(traps, 0);
  const pack = createGitHubLinearOutcomePackV1(reviewedInput());
  const fake = Object.create(null);
  Object.defineProperty(fake, "v", { enumerable: true, get() { getterCalls += 1; return pack.v; } });
  assert.throws(() => orderedGitHubLinearOperationsV1(fake, "linear-only"), /pack|brand|invalid/i);
  assert.equal(getterCalls, 0, "pack brand is checked before reading caller properties");
});
