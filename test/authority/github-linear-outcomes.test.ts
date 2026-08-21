import test from "node:test";
import assert from "node:assert/strict";
import { authorityDigest } from "../../src/authority/wire.js";
import { compileEffectTransportV1 } from "../../src/authority/host/effect-transports.js";
import { createOutcomeKernel, createTrustedObservationVerifier, createTrustedOutcomePredecessorPolicyV1, type StoredEffectLifecycleV1 } from "../../src/authority/host/outcome-kernel.js";
import { createLinearOutcomeExecutorV1 } from "../../src/authority/host/linear-outcome-runner.js";
import { createReservedDispatchHandle } from "../../src/authority/gate.js";
import { createDispatchCoordinator } from "../../src/authority/host/dispatch.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import {
  assertGitHubLinearProviderReadbackV1,
  createGovernedOutcomeCompositionProfileV1,
  createGitHubLinearOutcomePackV1,
  describeGovernedOutcomeCompositionProfileV1,
  governedOutcomeCompositionAliasesV1,
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

function predecessorPolicyFor(pack: ReturnType<typeof createGitHubLinearOutcomePackV1>) {
  return createTrustedOutcomePredecessorPolicyV1({ predecessorContractDigest: authorityDigest(pack.operations.linearEvidenceComment.contract), successorContractDigest: authorityDigest(pack.operations.linearStatusTransition.contract) });
}

test("reviewed pack binds exact GitHub and Linear authority while model fields contain no provider identity", () => {
  const pack = createGitHubLinearOutcomePackV1(reviewedInput());
  assert.deepEqual(Object.keys(pack.operations), ["candidatePublish", "pullRequestEnsure", "exactHeadMerge", "linearEvidenceComment", "linearStatusTransition"]);
  for (const operation of Object.values(pack.operations)) {
    assert.equal(operation.contract.operationDigest, authorityDigest(operation.binding));
    assert.equal(operation.metadata.contractDigest, authorityDigest(operation.contract));
    assert.equal(JSON.stringify(operation.contract.model).match(/workspace|team|project|issue|repository|status|credential|token|oauth/gi), null);
  }
  assert.deepEqual(pack.operations.exactHeadMerge.contract.model.fields, ["authorizationHandle", "requestId"]);
  assert.deepEqual(pack.operations.linearEvidenceComment.contract.model.fields, ["evidenceUrl"]);
  assert.deepEqual(pack.operations.linearStatusTransition.contract.model.fields, ["requestId"]);
  assert.equal(pack.operations.exactHeadMerge.contract.policyDigest, pack.githubPolicyDigest);
  assert.equal(pack.operations.linearStatusTransition.contract.policyDigest, pack.linearPolicyDigest);
});

test("the governed composition profile admits only one exact ordered five-operation scope", () => {
  const pack = createGitHubLinearOutcomePackV1(reviewedInput());
  const operations = orderedGitHubLinearOperationsV1(pack, "github-linear");
  const profile = createGovernedOutcomeCompositionProfileV1({ aliases: governedOutcomeCompositionAliasesV1, pack, operations });
  assert.deepEqual(Reflect.ownKeys(profile), []);
  assert.deepEqual(describeGovernedOutcomeCompositionProfileV1(profile), {
    aliases: governedOutcomeCompositionAliasesV1,
    repository: "seldonframe/reelier",
    workspace: "workspace_01",
    project: "project_01",
    issue: "REEL-TEST-1",
    contractDigests: operations.map(item => authorityDigest(item.contract)),
  });

  const other = createGitHubLinearOutcomePackV1({ ...reviewedInput(), linear: { ...reviewedInput().linear, project: "other_project" } });
  for (const changed of [
    { aliases: governedOutcomeCompositionAliasesV1.slice(0, -1), pack, operations },
    { aliases: [...governedOutcomeCompositionAliasesV1, "github_release_tag_create_v1"], pack, operations },
    { aliases: [governedOutcomeCompositionAliasesV1[1], governedOutcomeCompositionAliasesV1[0], ...governedOutcomeCompositionAliasesV1.slice(2)], pack, operations },
    { aliases: governedOutcomeCompositionAliasesV1, pack, operations: [operations[0], operations[1], operations[2], operations[4], operations[3]] },
    { aliases: governedOutcomeCompositionAliasesV1, pack, operations: [...operations.slice(0, 4), other.operations.linearStatusTransition] },
  ]) assert.throws(() => createGovernedOutcomeCompositionProfileV1(changed as never), /exact|profile|scope|operation/i);
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

test("real Linear comment executor validates exact duplicate, conflict, and ambiguous readback without resend", async () => {
  const pack = createGitHubLinearOutcomePackV1(reviewedInput());
  for (const [name, model, exactReadback] of [
    ["linearEvidenceComment", { evidenceUrl: "https://www.reelier.com/r/receipt_01" }, { workspace: "workspace_01", team: "team_01", project: "project_01", issue: "REEL-TEST-1", commentMarker: "reelier:evidence:mission_01", evidenceUrl: "https://www.reelier.com/r/receipt_01", evidenceContentDigest: sha("f"), commentId: "comment_01" }],
  ] as const) {
    const operation = pack.operations[name];
    let writes = 0, reads = 0;
    const provider = {
      comment(_input: unknown, sink: any): void { writes += 1; sink.success(JSON.stringify({ outcome: "uncertain", data: {} })); },
      readComment(_input: unknown, sink: any): void { reads += 1; sink.success(JSON.stringify(exactReadback)); },
      transitionStatus(_input: unknown, sink: any): void { writes += 1; sink.success(JSON.stringify({ outcome: "uncertain", data: {} })); },
      readStatus(_input: unknown, sink: any): void { reads += 1; sink.success(JSON.stringify(exactReadback)); },
    };
    const predecessorPolicy = predecessorPolicyFor(pack);
    const executor = createLinearOutcomeExecutorV1({ pack, provider, predecessorPolicy });
    const compiled = compileEffectTransportV1({ contract: operation.contract, binding: operation.binding, modelInput: model, observationAuthKey: "b".repeat(64), resolveHostBindings: async () => ({ credential: "linear-secret", account: "workspace_01", destination: "REEL-TEST-1", limit: pack.linearPolicyDigest }), executor });
    const state = { reservation: { reservationId: `${name}_reservation`, state: "dispatched", intent: { effectDigest: authorityDigest(operation.contract) } }, effect: compiled.effect, effectDigest: authorityDigest(operation.contract), effectCanonicalBase64: Buffer.from(JSON.stringify(compiled.effect)).toString("base64") } as any;
    const ambiguous = await compiled.adapter.dispatch(state);
    assert.equal(ambiguous.kind, "ambiguous");
    const reconciled = await compiled.adapter.reconcile!(state, ambiguous);
    assert.equal(reconciled.reconciliationStatus, "matched");
    assert.equal(writes, 1);
    assert.equal(reads, 1);
    assert.equal(JSON.stringify({ evidence: compiled.evidence, reconciled }).includes("linear-secret"), false);

    const wrongProvider = { ...provider, [name === "linearEvidenceComment" ? "readComment" : "readStatus"](_input: unknown, sink: any): void { sink.success(JSON.stringify({ ...exactReadback, issue: "REEL-WRONG" })); } } as any;
    const wrong = compileEffectTransportV1({ contract: operation.contract, binding: operation.binding, modelInput: model, observationAuthKey: "b".repeat(64), resolveHostBindings: async () => ({ credential: "linear-secret", account: "workspace_01", destination: "REEL-TEST-1", limit: pack.linearPolicyDigest }), executor: createLinearOutcomeExecutorV1({ pack, provider: wrongProvider, predecessorPolicy }) });
    const wrongState = { ...state, effect: wrong.effect } as any;
    const wrongPrior = await wrong.adapter.dispatch(wrongState);
    const wrongReadback = await wrong.adapter.reconcile!(wrongState, wrongPrior);
    assert.notEqual(wrongReadback.reconciliationStatus, "matched");
  }

  const comment = pack.operations.linearEvidenceComment, exact = { workspace: "workspace_01", team: "team_01", project: "project_01", issue: "REEL-TEST-1", commentMarker: "reelier:evidence:mission_01", evidenceUrl: "https://www.reelier.com/r/receipt_01", evidenceContentDigest: sha("f"), commentId: "comment_01" };
  for (const outcome of ["exact-existing", "conflict"] as const) {
    let writes = 0;
    const executor = createLinearOutcomeExecutorV1({ pack, provider: { comment(_input: unknown, sink: any): void { writes += 1; sink.success(JSON.stringify({ outcome, data: exact })); }, readComment(): void {}, transitionStatus(): void {}, readStatus(): void {} }, predecessorPolicy: predecessorPolicyFor(pack) });
    const compiled = compileEffectTransportV1({ contract: comment.contract, binding: comment.binding, modelInput: { evidenceUrl: reviewedInput().linear.evidenceUrl }, observationAuthKey: "c".repeat(64), resolveHostBindings: async () => ({ credential: "secret", account: "workspace_01", destination: "REEL-TEST-1", limit: pack.linearPolicyDigest }), executor });
    const state = { reservation: { reservationId: `comment_${outcome}`, state: "dispatched", intent: { effectDigest: authorityDigest(comment.contract) } }, effect: compiled.effect, effectDigest: authorityDigest(comment.contract), effectCanonicalBase64: Buffer.from(JSON.stringify(compiled.effect)).toString("base64") } as any;
    assert.equal((await compiled.adapter.dispatch(state)).kind, outcome === "exact-existing" ? "acknowledged" : "definitive-failure");
    assert.equal(writes, 1);
  }
});

test("direct status adapter invocation is unarmed and reaches no Linear write", async () => {
  const pack = createGitHubLinearOutcomePackV1(reviewedInput()), operation = pack.operations.linearStatusTransition;
  let writes = 0;
  const executor = createLinearOutcomeExecutorV1({ pack, predecessorPolicy: predecessorPolicyFor(pack), provider: {
    comment(): void {}, readComment(): void {},
    transitionStatus(_input, sink): void { writes += 1; sink.success(JSON.stringify({ outcome: "applied", data: {} })); },
    readStatus(): void {},
  } });
  const compiled = compileEffectTransportV1({ contract: operation.contract, binding: operation.binding, modelInput: { requestId: "direct_status" }, observationAuthKey: "9".repeat(64), resolveHostBindings: async () => ({ credential: "secret", account: "workspace_01", destination: "REEL-TEST-1", limit: pack.linearPolicyDigest }), executor });
  const state = { reservation: { reservationId: "direct_status", state: "dispatched", intent: { effectDigest: authorityDigest(operation.contract) } }, effect: compiled.effect, effectDigest: authorityDigest(operation.contract), effectCanonicalBase64: Buffer.from(JSON.stringify(compiled.effect)).toString("base64") } as any;
  assert.equal((await compiled.adapter.dispatch(state)).kind, "definitive-failure");
  assert.equal(writes, 0);
});

test("direct Linear comment invocation without the exact coordinator call reaches no write", async () => {
  const pack = createGitHubLinearOutcomePackV1(reviewedInput()), operation = pack.operations.linearEvidenceComment;
  let writes = 0;
  const executor = createLinearOutcomeExecutorV1({ pack, predecessorPolicy: predecessorPolicyFor(pack), provider: {
    comment(_input, sink): void { writes += 1; sink.success(JSON.stringify({ outcome: "applied", data: {} })); },
    readComment(): void {}, transitionStatus(): void {}, readStatus(): void {},
  } });
  const compiled = compileEffectTransportV1({ contract: operation.contract, binding: operation.binding, modelInput: { evidenceUrl: reviewedInput().linear.evidenceUrl }, observationAuthKey: "7".repeat(64), resolveHostBindings: async () => ({ credential: "secret", account: "workspace_01", destination: "REEL-TEST-1", limit: pack.linearPolicyDigest }), executor });
  const state = { reservation: { reservationId: "direct_comment", state: "dispatched", intent: { effectDigest: authorityDigest(operation.contract) } }, effect: compiled.effect, effectDigest: authorityDigest(operation.contract), effectCanonicalBase64: Buffer.from(JSON.stringify(compiled.effect)).toString("base64") } as any;
  assert.equal((await compiled.adapter.dispatch(state)).kind, "definitive-failure");
  assert.equal(writes, 0);
});

test("a verified merge plus unresolved Linear effect stays pending before Linear-only completion with zero GitHub calls", async () => {
  const pack = createGitHubLinearOutcomePackV1(reviewedInput()), contracts = [pack.operations.exactHeadMerge.contract, pack.operations.linearEvidenceComment.contract, pack.operations.linearStatusTransition.contract];
  const mission = { v: "reelier.mission-claim/v1" as const, missionId: "mission_partial_linear", mandateDigest: sha("1"), promptDigest: sha("2"), contractDigests: contracts.map(authorityDigest), claimedAt: "2026-08-21T12:00:00.000Z" };
  const lifecycle = new Map<string, StoredEffectLifecycleV1>();
  const mergeContract = contracts[0]!, mergeDigest = authorityDigest(mergeContract), mergeReservation = { v: "reelier.effect-reservation/v1" as const, reservationId: "reservation_0", semanticIdentity: mergeContract.semanticIdentity, contractDigest: mergeDigest, reservedAt: "2026-08-21T12:00:00.000Z" };
  const mergeAttempt = { v: "reelier.attempt/v1" as const, attemptId: "attempt_0", reservationId: "reservation_0", semanticIdentity: mergeContract.semanticIdentity, dispatchedAt: "2026-08-21T12:00:01.000Z", crossedProviderBoundary: true, result: "acknowledged" as const };
  const mergeObservation = { v: "reelier.observation/v1" as const, observationId: "observation_0", reservationId: "reservation_0", semanticIdentity: mergeContract.semanticIdentity, observedAt: "2026-08-21T12:00:02.000Z", authoritative: true, verdict: "matched" as const, projectionDigest: sha("8") };
  const mergeOutcome = { v: "reelier.governed-outcome/v1" as const, outcomeId: "outcome_0", contractDigest: mergeDigest, semanticIdentity: mergeContract.semanticIdentity, reservation: mergeReservation, attempts: [mergeAttempt], observation: mergeObservation, status: "verified" as const, completedAt: "2026-08-21T12:00:03.000Z" };
  lifecycle.set("reservation_0", { v: "reelier.stored-effect-lifecycle/v1", missionId: mission.missionId, missionDigest: authorityDigest(mission), contractDigest: mergeDigest, reservation: mergeReservation, attempt: mergeAttempt, observation: mergeObservation, outcome: mergeOutcome, revision: 1 });
  const receipts = new Map<string, { receiptId: string; receiptDigest: string; receiptRef: string }>();
  const storage: any = { durable: true, async claimMission() { return { status: "claimed", claim: mission }; }, async loadMission() { return mission; }, async loadEffect(_missionId: string, reservationId: string) { return lifecycle.get(reservationId) ?? null; }, async storeEffect(value: StoredEffectLifecycleV1, expectedRevision: number) { const stored = Object.freeze({ ...value, revision: expectedRevision + 1 }); lifecycle.set(value.reservation.reservationId, stored); return { status: "stored", value: stored }; }, async compareAndPublishReceipt(receipt: any, receiptDigest: string) { const head = { receiptId: receipt.receiptId, receiptDigest, receiptRef: authorityDigest({ receiptId: receipt.receiptId }) }; receipts.set(receipt.receiptId, head); return { status: "published", receiptDigest, receiptRef: head.receiptRef }; }, async loadReceipt(receiptId: string) { return receipts.get(receiptId) ?? null; } };
  let linearWrites = 0, linearReads = 0, gitProviderCalls = 0;
  const exactComment = { workspace: "workspace_01", team: "team_01", project: "project_01", issue: "REEL-TEST-1", commentMarker: "reelier:evidence:mission_01", evidenceUrl: reviewedInput().linear.evidenceUrl, evidenceContentDigest: sha("f"), commentId: "comment_01" };
  const exactStatus = { workspace: "workspace_01", team: "team_01", project: "project_01", issue: "REEL-TEST-1", preStatus: "In Progress", targetStatus: "Done", status: "Done" };
  const predecessorPolicy = predecessorPolicyFor(pack);
  const executor = createLinearOutcomeExecutorV1({ pack, predecessorPolicy, provider: { comment(_input, sink): void { linearWrites += 1; sink.success(JSON.stringify({ outcome: "uncertain", data: {} })); }, readComment(_input, sink): void { linearReads += 1; sink.success(JSON.stringify(exactComment)); }, transitionStatus(_input, sink): void { linearWrites += 1; sink.success(JSON.stringify({ outcome: "uncertain", data: {} })); }, readStatus(_input, sink): void { linearReads += 1; sink.success(JSON.stringify(exactStatus)); } } });
  const commentOperation = pack.operations.linearEvidenceComment;
  const compiled = compileEffectTransportV1({ contract: commentOperation.contract, binding: commentOperation.binding, modelInput: { evidenceUrl: reviewedInput().linear.evidenceUrl }, observationAuthKey: "d".repeat(64), resolveHostBindings: async () => ({ credential: "secret", account: "workspace_01", destination: "REEL-TEST-1", limit: pack.linearPolicyDigest }), executor });
  const statusOperation = pack.operations.linearStatusTransition;
  const compiledStatus = compileEffectTransportV1({ contract: statusOperation.contract, binding: statusOperation.binding, modelInput: { requestId: "status_request_01" }, observationAuthKey: "e".repeat(64), resolveHostBindings: async () => ({ credential: "secret", account: "workspace_01", destination: "REEL-TEST-1", limit: pack.linearPolicyDigest }), executor });
  const commentState: any = { reservationId: "reservation_1", state: "reserved", intent: { effectDigest: authorityDigest(commentOperation.contract), effectCanonicalBase64: Buffer.from(JSON.stringify(compiled.effect)).toString("base64"), executionContext: { allocationId: "linear-comment-allocation" } } };
  const statusState: any = { reservationId: "reservation_2", state: "reserved", intent: { effectDigest: authorityDigest(statusOperation.contract), effectCanonicalBase64: Buffer.from(JSON.stringify(compiledStatus.effect)).toString("base64"), executionContext: { allocationId: "linear-status-allocation" } } };
  const states = new Map([["reservation_0", { reservationId: "reservation_0", state: "acknowledged", intent: { effectDigest: mergeDigest } } as any], ["reservation_1", commentState], ["reservation_2", statusState]]);
  const transportState = { reservation: commentState, effect: compiled.effect, effectDigest: authorityDigest(commentOperation.contract), effectCanonicalBase64: commentState.intent.effectCanonicalBase64 } as any;
  const statusTransportState = { reservation: statusState, effect: compiledStatus.effect, effectDigest: authorityDigest(statusOperation.contract), effectCanonicalBase64: statusState.intent.effectCanonicalBase64 } as any;
  const opaque = createReservedDispatchHandle({ reservation: commentState, effect: compiled.effect, effectDigest: transportState.effectDigest, effectCanonicalBase64: transportState.effectCanonicalBase64 });
  const statusOpaque = createReservedDispatchHandle({ reservation: statusState, effect: compiledStatus.effect, effectDigest: statusTransportState.effectDigest, effectCanonicalBase64: statusTransportState.effectCanonicalBase64 });
  const handleIds = new WeakMap<object, string>([[opaque as object, "reservation_1"], [statusOpaque as object, "reservation_2"]]);
  const compiledById: any = { reservation_1: { compiled, state: transportState }, reservation_2: { compiled: compiledStatus, state: statusTransportState } }, priors = new Map<string, any>();
  let releaseStatus!: () => void, statusAdapterEntered!: () => void;
  const statusRelease = new Promise<void>(resolve => { releaseStatus = resolve; }), statusEntered = new Promise<void>(resolve => { statusAdapterEntered = resolve; });
  const ledger: any = {
    async getReservation(reservationId: string) { return states.get(reservationId); },
    async transition(reservationId: string, expected: string, event: { to: string; resultDigest?: string }) { const state = states.get(reservationId); if (!state || state.state !== expected) return { ok: false, reason: "state-conflict" }; state.state = event.to; if (event.resultDigest) state.resultDigest = event.resultDigest; return { ok: true, status: "transitioned", reservation: state }; },
    async recover() { return { ok: true, reservations: [...states.values()], highWaterMark: null, topology: { directorySync: "verified" } }; },
  };
  const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
  const statusCoordinator = createDispatchCoordinator(ledger, {
    async dispatch(state: any, call: any) { statusAdapterEntered(); await statusRelease; return (compiledStatus.adapter.dispatch as any)(state, call); },
  } as any);
  restorePlatform();
  const coordinator: any = { describe(handle: object) { const id = handleIds.get(handle)!; const state = states.get(id)!; return { reservationId: id, state: state.state, effectDigest: state.intent.effectDigest, allocationId: state.intent.executionContext.allocationId }; }, async dispatch(handle: object) { const id = handleIds.get(handle)!; if (id === "reservation_2") return statusCoordinator.dispatch(handle as any); const item = compiledById[id], result = await item.compiled.adapter.dispatch(item.state); states.get(id)!.state = result.kind === "ambiguous" ? "ambiguous" : "acknowledged"; priors.set(id, result); return result; }, async reconcile(id: string) { const item = compiledById[id], result = await item.compiled.adapter.reconcile(item.state, priors.get(id)); states.get(id)!.state = "reconciled"; return result; }, async recover() {} };
  const kernel = createOutcomeKernel({ ledger, coordinator, storage, predecessorPolicy, now: () => Date.parse("2026-08-21T12:00:04.000Z"), authorization: async () => "active" });
  await kernel.claimMission(mission);
  const outcome = await kernel.execute({ missionId: mission.missionId, effects: [{ contract: mergeContract, reservationId: "reservation_0", verifier: createTrustedObservationVerifier({ contractDigest: mergeDigest, verify: () => true }) }, { contract: commentOperation.contract, handle: opaque, verifier: compiled.verifier }] });
  assert.equal(outcome.status, "pending");
  assert.deepEqual(outcome.effects.map(effect => effect.status), ["verified", "pending"]);
  assert.deepEqual({ linearWrites, linearReads, gitProviderCalls }, { linearWrites: 1, linearReads: 0, gitProviderCalls: 0 });
  const commentVerified = await kernel.execute({ missionId: mission.missionId, effects: [{ contract: mergeContract, reservationId: "reservation_0", verifier: createTrustedObservationVerifier({ contractDigest: mergeDigest, verify: () => true }) }, { contract: commentOperation.contract, reservationId: "reservation_1", verifier: compiled.verifier }] });
  assert.deepEqual(commentVerified.effects.map(effect => effect.status), ["verified", "verified"]);
  const pendingStatus = kernel.execute({ missionId: mission.missionId, effects: [{ contract: commentOperation.contract, reservationId: "reservation_1", verifier: compiled.verifier }, { contract: statusOperation.contract, handle: statusOpaque, verifier: compiledStatus.verifier }] });
  await statusEntered;
  const directDuringAuthorizedWindow = await compiledStatus.adapter.dispatch(statusTransportState);
  releaseStatus();
  const statusPending = await pendingStatus;
  assert.equal(directDuringAuthorizedWindow.kind, "definitive-failure");
  assert.deepEqual(statusPending.effects.map(effect => effect.status), ["verified", "pending"]);
  const linearOnly = await kernel.execute({ missionId: mission.missionId, effects: [{ contract: commentOperation.contract, reservationId: "reservation_1", verifier: compiled.verifier }, { contract: statusOperation.contract, reservationId: "reservation_2", verifier: compiledStatus.verifier }] });
  assert.equal(linearOnly.status, "verified");
  assert.deepEqual(linearOnly.effects.map(effect => effect.status), ["verified", "verified"]);
  assert.deepEqual({ linearWrites, linearReads, gitProviderCalls }, { linearWrites: 2, linearReads: 2, gitProviderCalls: 0 });
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
  for (const unknown of ["hidden", Symbol("unknown-check")]) {
    const arrayRoot = structuredClone(base) as any;
    Object.defineProperty(arrayRoot.github.requiredChecks, unknown, { value: true });
    assert.throws(() => createGitHubLinearOutcomePackV1(arrayRoot), /closed|unknown|array/i);
  }
  const accessorArray = structuredClone(base) as any;
  Object.defineProperty(accessorArray.github.requiredChecks, "0", { enumerable: true, get() { getterCalls += 1; return "coverage"; } });
  assert.throws(() => createGitHubLinearOutcomePackV1(accessorArray), /inert|data|array/i);
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
