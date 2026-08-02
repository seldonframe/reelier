import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuthorityStatePort, digestAuthorityState, type AuthorityStateBackend } from "../../src/authority/state.js";
import { createTrustRoots } from "../../src/authority/trust.js";
import { createStaticPackRegistry, type StaticPackDefinition } from "../../src/authority/pack.js";
import { createSourceRegistry, type RegisteredSourceResolver } from "../../src/authority/source.js";
import { createConnectorRegistry } from "../../src/authority/connector.js";
import { generateKeyPairSync } from "node:crypto";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import { mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const sha=(c:string)=>`sha256:${c.repeat(64)}`;
const definition:StaticPackDefinition={alias:"definition_1",packDigest:sha("1"),definitionDigest:sha("2"),resolverId:"resolver_1",projectionSchemaId:"projection/v1",maxFreshnessSeconds:60,readEndpointIds:["read_1"],writeEndpointIds:["write_1"],riskClasses:["message"],policySchemaId:"policy/v1",requiredGroundedPointers:["/x"],validateChoices:x=>x,parsePolicy:x=>x,compile:()=>({})};
const resolver:RegisteredSourceResolver={tenant:"tenant_1",resolverId:"resolver_1",definitionDigest:sha("2"),projectionSchemaId:"projection/v1",readEndpointIds:["read_1"],maxFreshnessSeconds:60,plan:()=>[{endpointId:"read_1",opaqueHandle:"ref_1"}],project:()=>({sourceIdentity:"source",triggerIdentity:"trigger",projection:{x:1},claims:{grounded:[{claimId:"x",projectionPointer:"/x"}],authored:[],unresolved:[]}})};

function commitments(){const key=generateKeyPairSync("ed25519");return {trustRoots:createTrustRoots([{tenant:"tenant_1",signerId:"signer_1",principalId:"operator_1",publicKey:key.publicKey,purposes:["outcome-contract","delegation-grant"]}]),packs:createStaticPackRegistry([definition]),sources:createSourceRegistry([resolver]),connectors:createConnectorRegistry([{tenant:"tenant_1",connectorId:"connector_1",accountId:"account_1",providerAccountIdentity:"provider-account-1",allowedReadEndpointIds:["read_1"],allowedWriteEndpointIds:["write_1"],riskClasses:["message"],operatorConfigurationDigest:sha("3")}]),localGatePolicyDigest:sha("4")};}
function candidate(){const limits={maxEffectsPerWindow:2,windowSeconds:3600,maxEffectsPerSourceTrigger:1,maxBodyBytes:4096};const policy=Buffer.from("{}");const contract={v:"reelier.outcome-contract/v1",tenant:"tenant_1",alias:"definition_1",contractId:"contract_1",validFrom:"2026-01-01T00:00:00.000Z",validUntil:"2027-01-01T00:00:00.000Z",packDigest:sha("1"),definitionDigest:sha("2"),sponsor:"sponsor_1",audiences:["requester_1"],delegationGrantDigest:sha("8"),connectorId:"connector_1",accountId:"account_1",sourceAuthority:{resolverId:"resolver_1",projectionSchemaId:"projection/v1",allowedReadEndpointIds:["read_1"],authorizedProjectionPointers:["/x"],maxFreshnessSeconds:60},riskClasses:["message"],limits,policyCommitment:{schemaId:"policy/v1",jcsBase64:policy.toString("base64"),digest:authorityDigest({})}};const bytes=authorityCanonicalBytes(contract);return {contractEnvelope:{canonicalBase64:bytes.toString("base64"),advertisedDigest:authorityDigest(contract),signerId:"signer_1",signature:{alg:"ed25519" as const,sig:Buffer.alloc(64,1).toString("base64")}},delegationEnvelopes:[],stateEvents:[]};}

test("zero-candidate authority state commits the selected local registrations exactly",()=>{
  const result=digestAuthorityState({snapshot:{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:1,candidates:[]},...commitments()});
  assert.match(result.digest,/^sha256:(?!0{64}$)[0-9a-f]{64}$/);
  assert.equal(result.preimage.v,"reelier.gate-authority-state/internal-v1");
  assert.deepEqual(result.preimage.candidates,[]);
  assert.deepEqual(result.preimage.sourceResolverRegistrationDigests,[]);
  assert.deepEqual(result.preimage.connectorRegistrationDigests,[]);
  assert.equal(Object.isFrozen(result.preimage),true);
  assert.throws(()=>digestAuthorityState({snapshot:{tenant:"tenant_1",definitionAlias:"missing",stateVersion:1,candidates:[]},...commitments()}),/definition/i);
  assert.throws(()=>digestAuthorityState({snapshot:{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:0,candidates:[]},...commitments()}),/version/i);
});

test("strict and untrusted candidates remain committed while malformed or duplicate records refuse",()=>{
  const local=commitments();const one=digestAuthorityState({snapshot:{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:2,candidates:[candidate()]},...local});
  assert.equal((one.preimage.candidates as unknown[]).length,1);
  assert.equal((one.preimage.sourceResolverRegistrationDigests as unknown[]).length,1);
  assert.equal((one.preimage.connectorRegistrationDigests as unknown[]).length,1);
  const changed=candidate();changed.contractEnvelope.signature.sig=Buffer.alloc(64,2).toString("base64");
  assert.notEqual(digestAuthorityState({snapshot:{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:2,candidates:[changed]},...local}).digest,one.digest);
  assert.throws(()=>digestAuthorityState({snapshot:{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:2,candidates:[candidate(),candidate()]},...local}),/duplicate/i);
  const malformed=candidate();malformed.contractEnvelope.canonicalBase64=Buffer.from('{"v":"reelier.outcome-contract/v1", "tenant":"tenant_1"}').toString("base64");
  assert.throws(()=>digestAuthorityState({snapshot:{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:2,candidates:[malformed]},...local}),/canonical|invalid/i);
  assert.throws(()=>digestAuthorityState({snapshot:{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:2,candidates:[{...candidate(),extra:true} as never]},...local}),/candidate shape/i);
});

test("authority state port replaces mutable backend tokens and buffers with opaque detached values",async()=>{
  const backendToken={mutable:true};const observedBackendToken={observed:true};
  const backend:AuthorityStateBackend={
    async loadCompleteContractSet(){return {ok:true,snapshot:{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:1,candidates:[]},backendToken};},
    async advanceVersion(token){assert.equal(token,backendToken);return {ok:true,backendObservedToken:observedBackendToken};},
    async withCurrent(token,callback){assert.equal(token,observedBackendToken);return {ok:true,value:await callback()};},
    async executeSourceReads(){return {ok:true,observations:[{planDigest:sha("5"),rawBytes:Uint8Array.from([1,2,3])}]};},
  };
  const port=createAuthorityStatePort(backend);
  const loaded=await port.loadCompleteContractSet("tenant_1","definition_1");assert.equal(loaded.ok,true);if(!loaded.ok)return;
  assert.notEqual(loaded.token,backendToken);assert.equal(Object.isFrozen(loaded.snapshot),true);
  const advanced=await port.advanceVersion(loaded.token,{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:1,authorityStateDigest:sha("6")});assert.equal(advanced.ok,true);if(!advanced.ok)return;
  assert.notEqual(advanced.token,observedBackendToken);
  assert.deepEqual(await port.withCurrent(advanced.token,async()=>"held"),{ok:true,value:"held"});
  const reads=await port.executeSourceReads([{index:0,planDigest:sha("5"),endpointId:"read_1",opaqueHandle:"ref_1"}]);assert.equal(reads.ok,true);if(reads.ok){assert.deepEqual([...reads.observations[0].rawBytes],[1,2,3]);assert.equal(Object.isFrozen(reads.observations),true);}
  assert.deepEqual(await port.advanceVersion({} as never,{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:1,authorityStateDigest:sha("6")}),{ok:false,reason:"corruption"});
  assert.deepEqual(await port.withCurrent({} as never,async()=>"bad"),{ok:false,reason:"corruption"});
  const malformedPort=createAuthorityStatePort({...backend,async loadCompleteContractSet(){return {ok:false,reason:"invented"} as never;}});
  assert.deepEqual(await malformedPort.loadCompleteContractSet("tenant_1","definition_1"),{ok:false,reason:"corruption"});
});

test("persistent backend fixture proves restart rollback, digest corruption, changed tokens, and lease exclusion",async()=>{
  type Store={snapshot:{tenant:string;definitionAlias:string;stateVersion:number;candidates:never[]};revision:number;readers:number;waiters:Array<()=>void>};
  const store:Store={snapshot:{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:2,candidates:[]},revision:0,readers:0,waiters:[]};
  class PersistentFixture implements AuthorityStateBackend{
    constructor(readonly root:string){}
    async highWater(){try{return JSON.parse(await readFile(path.join(this.root,"high-water.json"),"utf8")) as {version:number;digest:string};}catch(error){if((error as {code?:string}).code==="ENOENT")return undefined;throw error;}}
    async persist(value:{version:number;digest:string}){const temporary=path.join(this.root,"high-water.tmp");const handle=await open(temporary,"w",0o600);try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}await rename(temporary,path.join(this.root,"high-water.json"));if(process.platform!=="win32"){const directory=await open(this.root,"r");try{await directory.sync();}finally{await directory.close();}}}
    async loadCompleteContractSet(){return {ok:true as const,snapshot:store.snapshot,backendToken:{revision:store.revision}};}
    async advanceVersion(token:unknown,input:{stateVersion:number;authorityStateDigest:string}){if((token as {revision:number}).revision!==store.revision)return {ok:false as const,reason:"changed" as const};const high=await this.highWater();if(high&&input.stateVersion<high.version)return {ok:false as const,reason:"rollback" as const};if(high&&input.stateVersion===high.version&&input.authorityStateDigest!==high.digest)return {ok:false as const,reason:"corruption" as const};const next={version:input.stateVersion,digest:input.authorityStateDigest};await this.persist(next);return {ok:true as const,backendObservedToken:{revision:store.revision,...next}};}
    async withCurrent<T>(token:unknown,callback:()=>Promise<T>){const observed=token as {revision:number;version:number;digest:string},high=await this.highWater();if(observed.revision!==store.revision||observed.version!==high?.version||observed.digest!==high.digest)return {ok:false as const,reason:"changed" as const};store.readers++;try{return {ok:true as const,value:await callback()};}finally{store.readers--;for(const release of store.waiters.splice(0))release();}}
    async executeSourceReads(){return {ok:false as const,reason:"refused" as const};}
    async mutate(){if(store.readers>0)await new Promise<void>(resolve=>store.waiters.push(resolve));store.revision++;}
  }
  const root=await mkdtemp(path.join(tmpdir(),"reelier-authority-state-conformance-"));try{
  const firstBackend=new PersistentFixture(root);const first=createAuthorityStatePort(firstBackend);const loaded=await first.loadCompleteContractSet("tenant_1","definition_1");assert.equal(loaded.ok,true);if(!loaded.ok)return;const advanced=await first.advanceVersion(loaded.token,{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:2,authorityStateDigest:sha("6")});assert.equal(advanced.ok,true);if(!advanced.ok)return;
  store.snapshot={...store.snapshot,stateVersion:1};const restarted=createAuthorityStatePort(new PersistentFixture(root));const replay=await restarted.loadCompleteContractSet("tenant_1","definition_1");assert.equal(replay.ok,true);if(replay.ok)assert.deepEqual(await restarted.advanceVersion(replay.token,{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:1,authorityStateDigest:sha("6")}),{ok:false,reason:"rollback"});
  store.snapshot={...store.snapshot,stateVersion:2};const same=await restarted.loadCompleteContractSet("tenant_1","definition_1");assert.equal(same.ok,true);if(same.ok)assert.deepEqual(await restarted.advanceVersion(same.token,{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:2,authorityStateDigest:sha("7")}),{ok:false,reason:"corruption"});
  const stale=await first.loadCompleteContractSet("tenant_1","definition_1");assert.equal(stale.ok,true);await firstBackend.mutate();if(stale.ok)assert.deepEqual(await first.advanceVersion(stale.token,{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:2,authorityStateDigest:sha("6")}),{ok:false,reason:"changed"});
  store.snapshot={...store.snapshot,stateVersion:3};const current=await first.loadCompleteContractSet("tenant_1","definition_1");assert.equal(current.ok,true);if(!current.ok)return;const observed=await first.advanceVersion(current.token,{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:3,authorityStateDigest:sha("8")});assert.equal(observed.ok,true);if(!observed.ok)return;let wrote=false;let write:Promise<void>|undefined;const leased=await first.withCurrent(observed.token,async()=>{write=firstBackend.mutate().then(()=>{wrote=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(wrote,false);return "held";});assert.deepEqual(leased,{ok:true,value:"held"});await write;assert.equal(wrote,true);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("state port maps malformed success records to corruption and backend throws to unavailable",async()=>{
  const snapshot={tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:1,candidates:[]};const plan={index:0,planDigest:sha("5"),endpointId:"read_1",opaqueHandle:"ref_1"};
  const make=(overrides:Partial<AuthorityStateBackend>={})=>createAuthorityStatePort({async loadCompleteContractSet(){return {ok:true,snapshot,backendToken:undefined};},async advanceVersion(){return {ok:true,backendObservedToken:undefined};},async withCurrent(_token,callback){return {ok:true,value:await callback()};},async executeSourceReads(){return {ok:true,observations:[{planDigest:sha("5"),rawBytes:Uint8Array.of(1)}]};},...overrides});
  assert.deepEqual(await make({async loadCompleteContractSet(){return {ok:true,snapshot,extra:true} as never;}}).loadCompleteContractSet("tenant_1","definition_1"),{ok:false,reason:"corruption"});
  assert.deepEqual(await make({async loadCompleteContractSet(){return {ok:true,snapshot} as never;}}).loadCompleteContractSet("tenant_1","definition_1"),{ok:false,reason:"corruption"});
  assert.deepEqual(await make({async loadCompleteContractSet(){throw new Error("down");}}).loadCompleteContractSet("tenant_1","definition_1"),{ok:false,reason:"unavailable"});
  for(const advanceResult of [{ok:true,extra:true},{ok:true}] as unknown[]){const port=make({async advanceVersion(){return advanceResult as never;}}),loaded=await port.loadCompleteContractSet("tenant_1","definition_1");assert.equal(loaded.ok,true);if(loaded.ok)assert.deepEqual(await port.advanceVersion(loaded.token,{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:1,authorityStateDigest:sha("6")}),{ok:false,reason:"corruption"});}
  const exactUndefined=make(),loaded=await exactUndefined.loadCompleteContractSet("tenant_1","definition_1");assert.equal(loaded.ok,true);if(!loaded.ok)return;const advanced=await exactUndefined.advanceVersion(loaded.token,{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:1,authorityStateDigest:sha("6")});assert.equal(advanced.ok,true);if(!advanced.ok)return;
  const badLease=make({async withCurrent(){return {ok:true,value:"x",extra:true} as never;}}),badLoaded=await badLease.loadCompleteContractSet("tenant_1","definition_1");if(badLoaded.ok){const observed=await badLease.advanceVersion(badLoaded.token,{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:1,authorityStateDigest:sha("6")});if(observed.ok)assert.deepEqual(await badLease.withCurrent(observed.token,async()=>"x"),{ok:false,reason:"corruption"});}
  assert.deepEqual(await make({async executeSourceReads(){return {ok:true,observations:[{planDigest:sha("5"),rawBytes:Uint8Array.of(1),extra:true}]} as never;}}).executeSourceReads([plan]),{ok:false,reason:"corruption"});
  assert.deepEqual(await make({async executeSourceReads(){throw new Error("down");}}).executeSourceReads([plan]),{ok:false,reason:"unavailable"});
});
