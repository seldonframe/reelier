import test from "node:test";
import assert from "node:assert/strict";
import { authorityDigest } from "../../src/authority/wire.js";
import {
  assertLinearStatusPredecessorV1,
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
  const exactComment = { workspace: "workspace_01", team: "team_01", project: "project_01", issue: "REEL-TEST-1", commentMarker: "reelier:evidence:mission_01", commentId: "comment_01" };
  const first = assertGitHubLinearProviderReadbackV1(pack, "linearEvidenceComment", exactComment);
  const duplicate = assertGitHubLinearProviderReadbackV1(pack, "linearEvidenceComment", structuredClone(exactComment));
  assert.deepEqual(duplicate, first, "an exact duplicate comment converges to the same projection");
  for (const changed of [
    { ...exactComment, project: "other_project" },
    { ...exactComment, issue: "REEL-OTHER" },
    { ...exactComment, commentMarker: "conflicting-marker" },
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
  let traps = 0;
  assert.throws(() => createGitHubLinearOutcomePackV1(new Proxy(base, { ownKeys() { traps += 1; return []; } }) as any), /inert|proxy/i);
  assert.equal(traps, 0);
});

test("Linear status requires the exact verified comment receipt predecessor", () => {
  const pack = createGitHubLinearOutcomePackV1(reviewedInput());
  const comment = pack.operations.linearEvidenceComment.contract;
  const reservation = { v: "reelier.effect-reservation/v1", reservationId: "reservation_comment", contractDigest: authorityDigest(comment), semanticIdentity: comment.semanticIdentity, reservedAt: "2026-08-21T12:00:00.000Z" } as const;
  const outcome = { v: "reelier.governed-outcome/v1", outcomeId: "outcome_comment", contractDigest: authorityDigest(comment), semanticIdentity: comment.semanticIdentity, reservation, attempts: [{ v: "reelier.attempt/v1", attemptId: "attempt_comment", reservationId: reservation.reservationId, semanticIdentity: reservation.semanticIdentity, dispatchedAt: "2026-08-21T12:00:01.000Z", crossedProviderBoundary: true, result: "acknowledged" }], observation: { v: "reelier.observation/v1", observationId: "observation_comment", reservationId: reservation.reservationId, semanticIdentity: reservation.semanticIdentity, observedAt: "2026-08-21T12:00:02.000Z", authoritative: true, verdict: "matched", projectionDigest: sha("9") }, status: "verified", completedAt: "2026-08-21T12:00:03.000Z" } as const;
  const receipt = { v: "reelier.governed-receipt/v1", receiptId: "receipt_comment", missionDigest: sha("1"), outcomeDigest: authorityDigest(outcome), status: "verified", issuedAt: outcome.completedAt } as const;
  assert.doesNotThrow(() => assertLinearStatusPredecessorV1(pack, { receipt, outcome }));
  assert.throws(() => assertLinearStatusPredecessorV1(pack, { receipt: { ...receipt, status: "pending" }, outcome: { ...outcome, status: "pending" } } as any), /verified/i);
  assert.throws(() => assertLinearStatusPredecessorV1(createGitHubLinearOutcomePackV1({ ...reviewedInput(), linear: { ...reviewedInput().linear, issue: "REEL-TEST-2" } }), { receipt, outcome }), /exact.*comment|predecessor/i);
});
