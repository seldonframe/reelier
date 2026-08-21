import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AGENT_TOOL_ABI_DIGEST_V1 } from "../../src/authority/ingress/agent-tool-contracts.js";
import { readCellAgentStatus, readCellOutcomeProposal } from "../../conformance/continuity-adapter/v1/eve-fixture/agent/lib/cell.js";
import { createGitHubLinearMissionRuntimeV1 } from "../../src/authority/host/github-linear-mission-runtime.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import { handleAuthorityHttp } from "../../src/authority/ingress/http.js";

const sha=(c:string)=>`sha256:${c.repeat(64)}`,git=(c:string)=>c.repeat(40),ref=`outcomeref_${"a".repeat(64)}`;

test("Eve Cell projections consume the canonical closed quartet",()=>{const capability={v:"reelier.harness-capability/v1",harnessId:null,harnessVersion:null,abiDigest:AGENT_TOOL_ABI_DIGEST_V1,protocolCompatibility:"compatible",transports:["mcp","http","openapi"],fixtureStatus:"not-passed",liveTested:false,providerCertification:"not-claimed"};assert.equal(readCellAgentStatus({requestId:"",verdict:"accepted",reasonCode:"ready",lifecycleState:"ready",outcomeRefs:[ref],capability}).capability.liveTested,false);assert.equal(readCellOutcomeProposal({requestId:"",verdict:"accepted",reasonCode:"proposed",lifecycleState:"proposed",outcomeRef:ref}).outcomeRef,ref);assert.throws(()=>readCellAgentStatus({requestId:"",verdict:"accepted",reasonCode:"ready",lifecycleState:"ready",outcomeRefs:[ref],capability,credential:"no"}),/closed|canonical/i);});

const eveRoot=path.resolve("conformance/continuity-adapter/v1/eve-fixture");
const skip=!existsSync(path.join(eveRoot,"node_modules","eve"))?"requires pinned Eve 0.39.0 dependency":Number(process.versions.node.split(".")[0])!==24?`requires Eve 0.39.0 Node 24; received ${process.version}`:false;

test("real Eve 0.39 drives both reviewed missions through the remote quartet and durable recovery",{skip},async()=>{
  const rootDir=await mkdtemp(path.join(os.tmpdir(),"reelier-eve-reviewed-")),eveToken=randomBytes(32).toString("base64url"),compositeToken=randomBytes(32).toString("base64url"),linearToken=randomBytes(32).toString("base64url");
  const sends:Record<string,number>={},reads:Record<string,number>={};
  const authority={v:"reelier.github-linear-reviewed-authority/v1" as const,github:{repository:"owner/repo",baseBranch:"main",baseSha:git("a"),headBranch:"release",headSha:git("b"),candidateDigest:sha("c"),workflowPath:".github/workflows/ci.yml",workflowDigest:sha("d"),requiredChecks:["coverage","full-tests","mutation"],mergeMethod:"squash" as const,postMergeTreeSha:git("e"),accountRef:"github_account_ref",destinationRef:"github_repository_ref",credentialRef:"github_credential_ref",limitRef:"github_policy_ref"},linear:{workspace:"workspace",team:"team",project:"project",issue:"REEL-1",preStatus:"In Progress",targetStatus:"Done",commentMarker:"reelier:evidence:mission",evidenceUrl:"https://evidence.invalid/r/1",evidenceContentDigest:sha("f"),accountRef:"linear_account_ref",destinationRef:"linear_issue_ref",credentialRef:"linear_credential_ref",limitRef:"linear_policy_ref"}};
  const provider={async dispatch(operation:string){sends[operation]=(sends[operation]??0)+1;return operation==="github.exact-head-squash-merge.v1"?{outcome:"uncertain",data:{}}:{outcome:"applied",data:readback(operation)};},async readback(operation:string){reads[operation]=(reads[operation]??0)+1;return {outcome:"applied",data:readback(operation.replace(/\.readback$/u,""))};}};
  const restore=__testSetAuthorityCellHostPlatform("linux");let server:ReturnType<typeof createServer>|undefined,runtimeReopens=0;
  try{
    const openRuntime=()=>createGitHubLinearMissionRuntimeV1({rootDir,authority,provider,resolveHostBindings:async refs=>({credential:"fixture-only",account:refs.accountRef,destination:refs.destinationRef,limit:refs.limitRef}),now:()=>Date.parse("2026-08-21T12:00:00Z")});
    let runtime=await openRuntime();
    const contexts=new Map([[compositeToken,context("one")],[linearToken,context("two")]]);
    server=createServer((request,response)=>void handleAuthorityHttp(request,response,{agentTools:runtime.agentTools,async outcome(){throw new Error("legacy disabled");},async status(){throw new Error("legacy disabled");}}, {tenant:"tenant",requester:"eve",resolvePrincipal:async header=>contexts.get(header?.replace(/^Bearer /u,"")??"")}));
    await new Promise<void>((resolve,reject)=>{server!.once("error",reject);server!.listen(0,"127.0.0.1",resolve);});
    const driver=await import(pathToFileURL(path.join(eveRoot,"scripts","eve-governed-outcomes.mjs")).href) as {runEveGovernedOutcomesV1(input:unknown):Promise<{processRestarts:number;toolCalls:string[];messages:string[]}>};
    const inherited=Object.fromEntries(["PATH","Path","PATHEXT","SystemRoot","COMSPEC","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA"].flatMap(key=>process.env[key]===undefined?[]:[[key,process.env[key]!]]));
    const report=await driver.runEveGovernedOutcomesV1({cellUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,compositeCellToken:compositeToken,linearCellToken:linearToken,eveToken,afterCompositeCrash:async()=>{runtime=await openRuntime();runtimeReopens++;},env:{...inherited,EVE_EVAL_AUTH_TOKEN:eveToken,REELIER_EVE_AUTH_REGISTRY_JSON:JSON.stringify({[createHash("sha256").update(eveToken).digest("hex")]:{principalId:"principal_eve",taskId:"task_eve",taskOwnerPrincipalId:"principal_eve",workloadId:"workload_eve"}}),REELIER_CONTINUITY_ROOT:path.join(rootDir,"eve"),REELIER_CONTINUITY_PROTOCOL_V:"reelier.continuity-checkpoint/v1",REELIER_JOB_CARD_DIGEST:sha("a"),REELIER_AUTHORITY_SNAPSHOT_DIGEST:sha("b"),REELIER_PATH_C_PORT_URL:"http://127.0.0.1:1",REELIER_PATH_C_PORT_TOKEN:randomBytes(32).toString("base64url")}});
    assert.equal(report.processRestarts,2);assert.equal(runtimeReopens,1);for(const name of ["reelier_agent_status","reelier_outcome_proposal","reelier_outcome_request","reelier_outcome_status"])assert.equal(report.toolCalls.filter(item=>item===name).length,2,name);
    assert.equal(sends["github.exact-head-squash-merge.v1"],1);assert.equal(reads["github.exact-head-squash-merge.v1.readback"],1);
    await runtime.reviewOutcomes(["request_composite","request_linear"]);const evidence=await runtime.inspectEvidence();assert.equal(evidence.activationConfirmations,1);assert.equal(evidence.routineApprovals,0);assert.equal(evidence.requests.length,2);assert.deepEqual(evidence.reviews.map(item=>item.requestIds.length),[2]);assert.equal(new Set(evidence.requests.map(item=>item.executionContext.runtimeSessionId)).size,2);
    const retained=JSON.stringify({report,evidence});for(const forbidden of ["fixture-only","raw prompt","model reasoning","providerStatusId"])assert.equal(retained.includes(forbidden),false);
  }finally{restore();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await rm(rootDir,{recursive:true,force:true});}
  function context(s:string){return {tenant:"tenant",requester:"eve",executionContext:{v:"reelier.authority-execution-context/v1" as const,taskId:`task_${s}`,principalId:"eve",grantId:`grant_${s}`,grantDigest:sha(s==="one"?"1":"2"),allocationId:`allocation_${s}`,runtimeSessionId:`session_${s}`,jobId:`job_${s}`,authorityCellId:`cell_${s}`}};}
  function readback(operation:string):Record<string,unknown>{if(operation.includes("candidate-publish"))return{repository:"owner/repo",baseSha:git("a"),headSha:git("b"),candidateDigest:sha("c")};if(operation.includes("pull-request-ensure"))return{repository:"owner/repo",baseBranch:"main",headSha:git("b"),pullRequest:1,ready:true};if(operation.includes("exact-head"))return{repository:"owner/repo",baseSha:git("a"),headSha:git("b"),mergeCommitSha:git("f"),treeSha:git("e")};if(operation.includes("evidence-comment"))return{workspace:"workspace",team:"team",project:"project",issue:"REEL-1",commentMarker:"reelier:evidence:mission",evidenceUrl:"https://evidence.invalid/r/1",evidenceContentDigest:sha("f"),commentId:"comment_1"};return{workspace:"workspace",team:"team",project:"project",issue:"REEL-1",preStatus:"In Progress",targetStatus:"Done",status:"Done"};}
});
