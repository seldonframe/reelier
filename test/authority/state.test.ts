import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuthorityStatePort, digestAuthorityState, type AuthorityStateBackend } from "../../src/authority/state.js";
import { createTrustRoots } from "../../src/authority/trust.js";
import { createStaticPackRegistry, type StaticPackDefinition } from "../../src/authority/pack.js";
import { createSourceRegistry, type RegisteredSourceResolver } from "../../src/authority/source.js";
import { createConnectorRegistry } from "../../src/authority/connector.js";
import { generateKeyPairSync } from "node:crypto";

const sha=(c:string)=>`sha256:${c.repeat(64)}`;
const definition:StaticPackDefinition={alias:"definition_1",packDigest:sha("1"),definitionDigest:sha("2"),resolverId:"resolver_1",projectionSchemaId:"projection/v1",maxFreshnessSeconds:60,readEndpointIds:["read_1"],writeEndpointIds:["write_1"],riskClasses:["message"],policySchemaId:"policy/v1",requiredGroundedPointers:["/x"],validateChoices:x=>x,parsePolicy:x=>x,compile:()=>({})};
const resolver:RegisteredSourceResolver={tenant:"tenant_1",resolverId:"resolver_1",definitionDigest:sha("2"),projectionSchemaId:"projection/v1",readEndpointIds:["read_1"],maxFreshnessSeconds:60,plan:()=>[{endpointId:"read_1",opaqueHandle:"ref_1"}],project:()=>({sourceIdentity:"source",triggerIdentity:"trigger",projection:{x:1},claims:{grounded:[{claimId:"x",projectionPointer:"/x"}],authored:[],unresolved:[]}})};

function commitments(){const key=generateKeyPairSync("ed25519");return {trustRoots:createTrustRoots([{tenant:"tenant_1",signerId:"signer_1",principalId:"operator_1",publicKey:key.publicKey,purposes:["outcome-contract","delegation-grant"]}]),packs:createStaticPackRegistry([definition]),sources:createSourceRegistry([resolver]),connectors:createConnectorRegistry([{tenant:"tenant_1",connectorId:"connector_1",accountId:"account_1",providerAccountIdentity:"provider-account-1",allowedReadEndpointIds:["read_1"],allowedWriteEndpointIds:["write_1"],riskClasses:["message"],operatorConfigurationDigest:sha("3")}]),localGatePolicyDigest:sha("4")};}

test("zero-candidate authority state commits the selected local registrations exactly",()=>{
  const result=digestAuthorityState({snapshot:{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:1,candidates:[]},...commitments()});
  assert.match(result.digest,/^sha256:[1-9a-f][0-9a-f]{63}$/);
  assert.equal(result.preimage.v,"reelier.gate-authority-state/internal-v1");
  assert.deepEqual(result.preimage.candidates,[]);
  assert.deepEqual(result.preimage.sourceResolverRegistrationDigests,[]);
  assert.deepEqual(result.preimage.connectorRegistrationDigests,[]);
  assert.equal(Object.isFrozen(result.preimage),true);
  assert.throws(()=>digestAuthorityState({snapshot:{tenant:"tenant_1",definitionAlias:"missing",stateVersion:1,candidates:[]},...commitments()}),/definition/i);
  assert.throws(()=>digestAuthorityState({snapshot:{tenant:"tenant_1",definitionAlias:"definition_1",stateVersion:0,candidates:[]},...commitments()}),/version/i);
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
});
