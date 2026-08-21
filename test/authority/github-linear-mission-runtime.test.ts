import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGitHubLinearMissionRuntimeV1 } from "../../src/authority/host/index.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";

const sha = (c: string) => `sha256:${c.repeat(64)}`;
const git = (c: string) => c.repeat(40);
const authority = { v:"reelier.github-linear-reviewed-authority/v1" as const, github:{ repository:"owner/repo",baseBranch:"main",baseSha:git("a"),headBranch:"release",headSha:git("b"),candidateDigest:sha("c"),workflowPath:".github/workflows/ci.yml",workflowDigest:sha("d"),requiredChecks:["coverage","full-tests","mutation"],mergeMethod:"squash" as const,postMergeTreeSha:git("e"),accountRef:"github_account_ref",destinationRef:"github_repository_ref",credentialRef:"github_credential_ref",limitRef:"github_release_policy_ref" }, linear:{ workspace:"workspace",team:"team",project:"project",issue:"REEL-1",preStatus:"In Progress",targetStatus:"Done",commentMarker:"reelier:evidence:mission",evidenceUrl:"https://evidence.invalid/r/1",evidenceContentDigest:sha("f"),accountRef:"linear_account_ref",destinationRef:"linear_issue_ref",credentialRef:"linear_credential_ref",limitRef:"linear_policy_ref" } };
const context = (suffix: string) => ({ tenant:"tenant",requester:"eve",executionContext:{v:"reelier.authority-execution-context/v1" as const,taskId:`task_${suffix}`,principalId:"eve",grantId:`grant_${suffix}`,grantDigest:sha(suffix === "one" ? "1":"2"),allocationId:`allocation_${suffix}`,runtimeSessionId:`session_${suffix}`,jobId:`job_${suffix}`,authorityCellId:`cell_${suffix}`} });

test("production mission runtime uses reviewed pack, transport compiler, durable kernel receipts, and no-resend recovery", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "reelier-reviewed-runtime-"));
  const sends: Record<string, number> = {}, reads: Record<string, number> = {};
  const provider = { async dispatch(operation: string) { sends[operation]=(sends[operation]??0)+1; return operation === "github.exact-head-squash-merge.v1" ? { outcome:"uncertain",data:{} } : { outcome:"applied",data:readback(operation) }; }, async readback(operation: string) { reads[operation]=(reads[operation]??0)+1; return { outcome:"applied",data:readback(operation.replace(/\.readback$/,"")) }; } };
  try {
    const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
    const resolveHostBindings = async (refs: {accountRef:string;destinationRef:string;limitRef:string}) => ({credential:"fixture-only",account:refs.accountRef,destination:refs.destinationRef,limit:refs.limitRef});
    const first = await createGitHubLinearMissionRuntimeV1({ rootDir, authority, provider, resolveHostBindings, now: () => Date.parse("2026-08-21T12:00:00Z") });
    const status = await first.agentTools.agentStatus({}, context("one"));
    assert.equal(status.capability.liveTested, false);
    assert.equal(status.outcomeRefs.length, 2);
    const composite = status.outcomeRefs[0]!;
    assert.equal((await first.agentTools.outcomeProposal({outcomeRef:composite},context("one"))).outcomeRef, composite);
    const pending = await first.agentTools.outcomeRequest({outcomeRef:composite,requestId:"request_one",sourceRefs:{},choices:{}},context("one"));
    assert.equal(pending.lifecycleState, "pending");

    const reopened = await createGitHubLinearMissionRuntimeV1({ rootDir, authority, provider, resolveHostBindings, now: () => Date.parse("2026-08-21T12:00:01Z") });
    const reconciled = await reopened.agentTools.outcomeStatus({requestId:"request_one"},context("one"));
    assert.equal(reconciled.lifecycleState, "reconciled");
    assert.match(reconciled.receiptRef!, /^sha256:/);
    assert.equal(sends["github.exact-head-squash-merge.v1"], 1);
    assert.equal(reads["github.exact-head-squash-merge.v1.readback"], 1);

    const linearRef = (await reopened.agentTools.agentStatus({},context("two"))).outcomeRefs[1]!;
    const second = await reopened.agentTools.outcomeRequest({outcomeRef:linearRef,requestId:"request_two",sourceRefs:{},choices:{}},context("two"));
    assert.equal(second.lifecycleState, "reconciled");
    const evidence = await reopened.inspectEvidence();
    assert.equal(evidence.activationConfirmations, 1);
    assert.equal(evidence.routineApprovals, 0);
    assert.equal(evidence.requests.length, 2);
    assert.equal(new Set(evidence.requests.map(item=>item.executionContext.runtimeSessionId)).size,2);
    assert.equal(JSON.stringify(evidence).includes("credential"),false);
    restorePlatform();
  } finally { await rm(rootDir,{recursive:true,force:true}); }

  function readback(operation:string): Record<string,unknown> {
    if(operation.includes("candidate-publish")) return {repository:"owner/repo",baseSha:git("a"),headSha:git("b"),candidateDigest:sha("c")};
    if(operation.includes("pull-request-ensure")) return {repository:"owner/repo",baseBranch:"main",headSha:git("b"),pullRequest:1,ready:true};
    if(operation.includes("exact-head-squash-merge")) return {repository:"owner/repo",baseSha:git("a"),headSha:git("b"),mergeCommitSha:git("f"),treeSha:git("e")};
    if(operation.includes("evidence-comment")) return {workspace:"workspace",team:"team",project:"project",issue:"REEL-1",commentMarker:"reelier:evidence:mission",evidenceUrl:"https://evidence.invalid/r/1",evidenceContentDigest:sha("f"),commentId:"comment_1"};
    return {workspace:"workspace",team:"team",project:"project",issue:"REEL-1",preStatus:"In Progress",targetStatus:"Done",status:"Done"};
  }
});
