import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AGENT_TOOL_ABI_DIGEST_V1 } from "../../src/authority/ingress/agent-tool-contracts.js";
import { readCellAgentStatus, readCellOutcomeProposal } from "../../conformance/continuity-adapter/v1/eve-fixture/agent/lib/cell.js";
import { handleAuthorityHttp } from "../../src/authority/ingress/http.js";
import { createGenuineGovernedEveFixture } from "./support/genuine-governed-eve.js";

const sha=(c:string)=>`sha256:${c.repeat(64)}`,ref=`outcomeref_${"a".repeat(64)}`;

test("Eve Cell projections consume the canonical closed quartet",()=>{const capability={v:"reelier.harness-capability/v1",harnessId:null,harnessVersion:null,abiDigest:AGENT_TOOL_ABI_DIGEST_V1,protocolCompatibility:"compatible",transports:["mcp","http","openapi"],fixtureStatus:"not-passed",liveTested:false,providerCertification:"not-claimed"};assert.equal(readCellAgentStatus({requestId:"",verdict:"accepted",reasonCode:"ready",lifecycleState:"ready",outcomeRefs:[ref],capability}).capability.liveTested,false);assert.equal(readCellOutcomeProposal({requestId:"",verdict:"accepted",reasonCode:"proposed",lifecycleState:"proposed",outcomeRef:ref}).outcomeRef,ref);assert.throws(()=>readCellAgentStatus({requestId:"",verdict:"accepted",reasonCode:"ready",lifecycleState:"ready",outcomeRefs:[ref],capability,credential:"no"}),/closed|canonical/i);});

const eveRoot=path.resolve("conformance/continuity-adapter/v1/eve-fixture");
const skip=!existsSync(path.join(eveRoot,"node_modules","eve"))?"requires pinned Eve 0.39.0 dependency":Number(process.versions.node.split(".")[0])!==24?`requires Eve 0.39.0 Node 24; received ${process.version}`:false;

test("real Eve 0.39 drives both reviewed missions through the remote quartet and durable recovery",{skip},async()=>{
  const rootDir=await mkdtemp(path.join(os.tmpdir(),"reelier-eve-reviewed-")),eveToken=randomBytes(32).toString("base64url"),compositeToken=randomBytes(32).toString("base64url"),linearToken=randomBytes(32).toString("base64url"),fixture=await createGenuineGovernedEveFixture(rootDir);
  let server:ReturnType<typeof createServer>|undefined,runtime=await fixture.openRuntime(),runtimeReopens=0;
  try{
    const compositeContext=fixture.context("composite"),linearContext=fixture.context("linear"),contexts=new Map([[compositeToken,compositeContext],[linearToken,linearContext]]);
    server=createServer((request,response)=>void handleAuthorityHttp(request,response,{agentTools:runtime.agentTools,async outcome(){throw new Error("legacy disabled");},async status(){throw new Error("legacy disabled");}}, {tenant:compositeContext.tenant,requester:compositeContext.requester,resolvePrincipal:async header=>contexts.get(header?.replace(/^Bearer /u,"")??"")}));
    await new Promise<void>((resolve,reject)=>{server!.once("error",reject);server!.listen(0,"127.0.0.1",resolve);});
    const driver=await import(pathToFileURL(path.join(eveRoot,"scripts","eve-governed-outcomes.mjs")).href) as {runEveGovernedOutcomesV1(input:unknown):Promise<{processRestarts:number;sessionIds:string[];toolCalls:string[];toolEvents:unknown[];messages:string[]}>};
    const inherited=Object.fromEntries(["PATH","Path","PATHEXT","SystemRoot","COMSPEC","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA"].flatMap(key=>process.env[key]===undefined?[]:[[key,process.env[key]!]]));
    const report=await driver.runEveGovernedOutcomesV1({cellUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,compositeCellToken:compositeToken,linearCellToken:linearToken,eveToken,afterCompositeCrash:async()=>{runtime=await fixture.openRuntime();runtimeReopens++;},env:{...inherited,EVE_EVAL_AUTH_TOKEN:eveToken,REELIER_EVE_AUTH_REGISTRY_JSON:JSON.stringify({[createHash("sha256").update(eveToken).digest("hex")]:{principalId:"principal_eve",taskId:"task_eve",taskOwnerPrincipalId:"principal_eve",workloadId:"workload_eve"}}),REELIER_AUTHORIZATION_HANDLE:fixture.authorizationHandle,REELIER_CONTINUITY_ROOT:path.join(rootDir,"eve"),REELIER_CONTINUITY_PROTOCOL_V:"reelier.continuity-checkpoint/v1",REELIER_JOB_CARD_DIGEST:sha("a"),REELIER_AUTHORITY_SNAPSHOT_DIGEST:sha("b"),REELIER_PATH_C_PORT_URL:"http://127.0.0.1:1",REELIER_PATH_C_PORT_TOKEN:randomBytes(32).toString("base64url")}});
    assert.equal(report.processRestarts,2);assert.equal(runtimeReopens,1);assert.equal(new Set(report.sessionIds).size,4);for(const name of ["reelier_agent_status","reelier_outcome_proposal","reelier_outcome_request","reelier_outcome_status"])assert.equal(report.toolCalls.filter(item=>item===name).length,2,name);
    const counters=fixture.counters();assert.equal(counters.mergeWrites,1);assert.deepEqual({linearWrites:counters.linearWrites,linearReads:counters.linearReads},{linearWrites:4,linearReads:4});
    await runtime.reviewOutcomes(["request_composite","request_linear"]);const evidence=await runtime.inspectEvidence(),ledger=await (await fixture.ledger()).recover();assert.equal(evidence.activationConfirmations,1);assert.equal(evidence.routineApprovals,0);assert.equal(evidence.requests.length,2);assert.deepEqual(evidence.reviews.map(item=>item.requestIds.length),[2]);assert.equal(new Set(evidence.requests.map(item=>item.executionContext.runtimeSessionId)).size,2);assert.equal(ledger.ok&&ledger.reservations.length,7);assert.equal(ledger.ok&&new Set(ledger.reservations.map(item=>item.reservationId)).size,7);
    const modelSurface=JSON.stringify({toolEvents:report.toolEvents,messages:report.messages});for(const forbidden of [eveToken,compositeToken,linearToken,...fixture.secretSentinels,"github_credential_ref","linear_credential_","REEL-TEST-1","REEL-TEST-2","workspace_01"])assert.equal(modelSurface.includes(forbidden),false,forbidden);
    const durable=await readDurableRoots(rootDir);for(const forbidden of [eveToken,compositeToken,linearToken,...fixture.secretSentinels,"governed run composite request_composite","governed resume composite request_composite","governed run linear-only request_linear","governed resume linear-only request_linear","model reasoning"])assert.equal(durable.includes(forbidden),false,forbidden);
  }finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await fixture.close();await rm(rootDir,{recursive:true,force:true});}
});

async function readDurableRoots(root:string):Promise<string>{const files:string[]=[];async function walk(current:string):Promise<void>{for(const entry of await readdir(current,{withFileTypes:true})){const target=path.join(current,entry.name);if(entry.isDirectory())await walk(target);else files.push(await readFile(target,"utf8"));}}for(const relative of ["authority/ledger","authority/decisions","authority/receipts","mission-journal","outcome-publication"]){const target=path.join(root,relative);if(existsSync(target))await walk(target);}return files.join("\n");}
