import type { AuthoritySignature, OutcomeContract } from "./types.js";
import type { RawSourceObservation, SourceReadPlan, SourceRegistry } from "./source.js";
import { sourceResolverRegistrationDigest } from "./source.js";
import type { TrustRoots } from "./trust.js";
import { authoritySignatureDigest, trustRootSetDigest } from "./trust.js";
import type { StaticPackRegistry } from "./pack.js";
import { definitionRegistrationDigest } from "./pack.js";
import type { ConnectorRegistry } from "./connector.js";
import { connectorRegistrationDigest } from "./connector.js";
import { authorityDigest, parseCanonicalAuthorityJson } from "./wire.js";

const SHA=/^sha256:[0-9a-f]{64}$/;const ZERO_SHA=`sha256:${"0".repeat(64)}`;
export interface AuthorityEnvelope {readonly canonicalBase64:string;readonly advertisedDigest:string;readonly signerId:string;readonly signature:AuthoritySignature}
export interface AuthorityStateCandidate {readonly contractEnvelope:AuthorityEnvelope;readonly delegationEnvelopes:readonly (AuthorityEnvelope&{readonly index:number})[];readonly stateEvents:readonly {readonly index:number;readonly kind:"activated"|"revoked";readonly contractDigest:string;readonly at:string}[]}
export interface AuthorityStateSnapshot {readonly tenant:string;readonly definitionAlias:string;readonly stateVersion:number;readonly candidates:readonly AuthorityStateCandidate[]}
export interface AuthorityStateCommitmentInput {readonly snapshot:AuthorityStateSnapshot;readonly trustRoots:TrustRoots;readonly packs:StaticPackRegistry;readonly sources:SourceRegistry;readonly connectors:ConnectorRegistry;readonly localGatePolicyDigest:string}

export type AuthorityStateLoadBackendResult={ok:true;snapshot:AuthorityStateSnapshot;backendToken:unknown}|{ok:false;reason:"unavailable"|"corruption"};
export type AuthorityStateAdvanceBackendResult={ok:true;backendObservedToken:unknown}|{ok:false;reason:"changed"|"rollback"|"corruption"|"unavailable"};
export type AuthorityStateLeaseBackendResult<T>={ok:true;value:T}|{ok:false;reason:"changed"|"corruption"|"unavailable"};
export type AuthorityStateReadBackendResult={ok:true;observations:readonly RawSourceObservation[]}|{ok:false;reason:"refused"|"corruption"|"unavailable"};
export interface AuthorityStateBackend {
  loadCompleteContractSet(tenant:string,definitionAlias:string):Promise<AuthorityStateLoadBackendResult>;
  advanceVersion(backendToken:unknown,input:Readonly<{tenant:string;definitionAlias:string;stateVersion:number;authorityStateDigest:string}>):Promise<AuthorityStateAdvanceBackendResult>;
  withCurrent<T>(backendObservedToken:unknown,callback:()=>Promise<T>):Promise<AuthorityStateLeaseBackendResult<T>>;
  executeSourceReads(plans:readonly SourceReadPlan[]):Promise<AuthorityStateReadBackendResult>;
}
const portBrand=Symbol("AuthorityStatePort"),unobservedBrand=Symbol("UnobservedAuthorityStateToken"),observedBrand=Symbol("ObservedAuthorityStateToken");
export interface UnobservedAuthorityStateToken{readonly [unobservedBrand]:true}
export interface ObservedAuthorityStateToken{readonly [observedBrand]:true}
export interface AuthorityStatePort {
  readonly [portBrand]:true;
  loadCompleteContractSet(tenant:string,definitionAlias:string):Promise<{ok:true;snapshot:AuthorityStateSnapshot;token:UnobservedAuthorityStateToken}|{ok:false;reason:"unavailable"|"corruption"}>;
  advanceVersion(token:UnobservedAuthorityStateToken,input:Readonly<{tenant:string;definitionAlias:string;stateVersion:number;authorityStateDigest:string}>):Promise<{ok:true;token:ObservedAuthorityStateToken}|{ok:false;reason:"changed"|"rollback"|"corruption"|"unavailable"}>;
  withCurrent<T>(token:ObservedAuthorityStateToken,callback:()=>Promise<T>):Promise<AuthorityStateLeaseBackendResult<T>>;
  executeSourceReads(plans:readonly SourceReadPlan[]):Promise<AuthorityStateReadBackendResult>;
}
const unobservedStates=new WeakMap<object,{backend:AuthorityStateBackend;backendToken:unknown;snapshot:AuthorityStateSnapshot}>();
const observedStates=new WeakMap<object,{backend:AuthorityStateBackend;backendToken:unknown}>();

export function digestAuthorityState(input:AuthorityStateCommitmentInput):Readonly<{digest:string;preimage:Readonly<Record<string,unknown>>}> {
  const snapshot=normalizeSnapshot(input.snapshot);
  if(!SHA.test(input.localGatePolicyDigest)||input.localGatePolicyDigest===ZERO_SHA)throw new TypeError("local gate policy digest must be non-zero lowercase sha256");
  const trustRootSet=trustRootSetDigest(input.trustRoots,snapshot.tenant);
  const selectedDefinitionDigest=definitionRegistrationDigest(input.packs,snapshot.definitionAlias);
  const resolverDigests=new Set<string>(),connectorDigests=new Set<string>();
  const candidates=snapshot.candidates.map(candidate=>candidateCommitment(candidate,snapshot.tenant,input.sources,input.connectors,resolverDigests,connectorDigests));
  candidates.sort((a,b)=>compareText(a.recordDigest,b.recordDigest));
  if(new Set(candidates.map(item=>item.recordDigest)).size!==candidates.length)throw new TypeError("duplicate authority-state candidate commitment");
  const preimage=deepFreeze({v:"reelier.gate-authority-state/internal-v1",tenant:snapshot.tenant,definitionAlias:snapshot.definitionAlias,stateVersion:snapshot.stateVersion,candidates,trustRootSetDigest:trustRootSet,definitionRegistrationDigest:selectedDefinitionDigest,sourceResolverRegistrationDigests:[...resolverDigests].sort(compareText),connectorRegistrationDigests:[...connectorDigests].sort(compareText),localGatePolicyDigest:input.localGatePolicyDigest});
  return Object.freeze({digest:authorityDigest(preimage),preimage});
}

export function createAuthorityStatePort(backend:AuthorityStateBackend):AuthorityStatePort {
  if(!backend||typeof backend!=="object")throw new TypeError("authority state backend is required");
  const port={
    async loadCompleteContractSet(tenant:string,definitionAlias:string){try{const result=await backend.loadCompleteContractSet(tenant,definitionAlias);if(!result.ok)return validFailure(result,["unavailable","corruption"])?Object.freeze({...result}):Object.freeze({ok:false as const,reason:"corruption" as const});const snapshot=normalizeSnapshot(result.snapshot);if(snapshot.tenant!==tenant||snapshot.definitionAlias!==definitionAlias)return Object.freeze({ok:false as const,reason:"corruption" as const});const token=Object.freeze(Object.create(null)) as UnobservedAuthorityStateToken;unobservedStates.set(token,{backend,backendToken:result.backendToken,snapshot});return Object.freeze({ok:true as const,snapshot,token});}catch{return Object.freeze({ok:false as const,reason:"unavailable" as const});}},
    async advanceVersion(token:UnobservedAuthorityStateToken,value:Readonly<{tenant:string;definitionAlias:string;stateVersion:number;authorityStateDigest:string}>){const state=unobservedStates.get(token as object);if(!state||state.backend!==backend)return Object.freeze({ok:false as const,reason:"corruption" as const});if(value.tenant!==state.snapshot.tenant||value.definitionAlias!==state.snapshot.definitionAlias||value.stateVersion!==state.snapshot.stateVersion||!SHA.test(value.authorityStateDigest)||value.authorityStateDigest===ZERO_SHA)return Object.freeze({ok:false as const,reason:"corruption" as const});try{const result=await backend.advanceVersion(state.backendToken,Object.freeze({...value}));if(!result.ok)return validFailure(result,["changed","rollback","corruption","unavailable"])?Object.freeze({...result}):Object.freeze({ok:false as const,reason:"corruption" as const});const observed=Object.freeze(Object.create(null)) as ObservedAuthorityStateToken;observedStates.set(observed,{backend,backendToken:result.backendObservedToken});return Object.freeze({ok:true as const,token:observed});}catch{return Object.freeze({ok:false as const,reason:"unavailable" as const});}},
    async withCurrent<T>(token:ObservedAuthorityStateToken,callback:()=>Promise<T>){const state=observedStates.get(token as object);if(!state||state.backend!==backend)return Object.freeze({ok:false as const,reason:"corruption" as const});if(typeof callback!=="function")return Object.freeze({ok:false as const,reason:"corruption" as const});try{const result=await backend.withCurrent(state.backendToken,callback);return result.ok?Object.freeze({ok:true as const,value:result.value}):validFailure(result,["changed","corruption","unavailable"])?Object.freeze({...result}):Object.freeze({ok:false as const,reason:"corruption" as const});}catch{return Object.freeze({ok:false as const,reason:"unavailable" as const});}},
    async executeSourceReads(plans:readonly SourceReadPlan[]){if(!validPlans(plans))return Object.freeze({ok:false as const,reason:"corruption" as const});try{const result=await backend.executeSourceReads(deepFreeze(plans.map(plan=>({...plan}))));if(!result.ok)return validFailure(result,["refused","corruption","unavailable"])?Object.freeze({...result}):Object.freeze({ok:false as const,reason:"corruption" as const});const wanted=new Set(plans.map(plan=>plan.planDigest));if(result.observations.length!==plans.length||new Set(result.observations.map((item:RawSourceObservation)=>item.planDigest)).size!==result.observations.length||result.observations.some((item:RawSourceObservation)=>!wanted.has(item.planDigest)||!(item.rawBytes instanceof Uint8Array)))return Object.freeze({ok:false as const,reason:"corruption" as const});return Object.freeze({ok:true as const,observations:Object.freeze(result.observations.map((item:RawSourceObservation)=>Object.freeze({planDigest:item.planDigest,rawBytes:Uint8Array.from(item.rawBytes)})))});}catch{return Object.freeze({ok:false as const,reason:"unavailable" as const});}},
  } as AuthorityStatePort;Object.defineProperty(port,portBrand,{value:true});return Object.freeze(port);
}

function candidateCommitment(candidate:AuthorityStateCandidate,tenant:string,sources:SourceRegistry,connectors:ConnectorRegistry,resolverDigests:Set<string>,connectorDigests:Set<string>){
  if(!candidate||typeof candidate!=="object"||Object.keys(candidate).sort().join("\0")!==["contractEnvelope","delegationEnvelopes","stateEvents"].sort().join("\0")||!Array.isArray(candidate.delegationEnvelopes)||!Array.isArray(candidate.stateEvents))throw new TypeError("invalid authority state candidate shape");
  const contract=parsedEnvelope("outcome-contract",candidate.contractEnvelope);
  const delegation=candidate.delegationEnvelopes.map((envelope,index)=>{if(envelope.index!==index)throw new TypeError("delegation indexes must be contiguous zero-based");const parsed=parsedEnvelope("delegation-grant",envelope);return {index,...parsed};});
  let previous=-1;const stateEvents=candidate.stateEvents.map((event,index)=>{if(!event||typeof event!=="object"||Object.keys(event).length!==4||event.index!==index||!(["activated","revoked"] as unknown[]).includes(event.kind)||!SHA.test(event.contractDigest)||event.contractDigest===ZERO_SHA)throw new TypeError("invalid authority state event");const instant=Date.parse(event.at);if(!Number.isFinite(instant)||new Date(instant).toISOString()!==event.at||instant<previous)throw new TypeError("authority state events must be chronological exact instants");previous=instant;return {...event};});
  const contractValue=contract.value as OutcomeContract;if(contractValue.tenant!==tenant)throw new TypeError("candidate contract tenant mismatch");
  resolverDigests.add(sourceResolverRegistrationDigest(sources,tenant,contractValue.sourceAuthority.resolverId));
  connectorDigests.add(connectorRegistrationDigest(connectors,tenant,contractValue.connectorId,contractValue.accountId));
  const recordPreimage={v:"reelier.authority-state-candidate/internal-v1",contract:{canonicalBase64:contract.canonicalBase64,valueDigest:contract.valueDigest,advertisedDigest:contract.advertisedDigest,signerId:contract.signerId,signatureDigest:contract.signatureDigest},delegation:delegation.map(({value:_,...item})=>item),stateEvents};
  const recordDigest=authorityDigest(recordPreimage);
  return {recordDigest,advertisedContractDigest:contract.advertisedDigest,contractValueDigest:contract.valueDigest,contractSignerId:contract.signerId,contractSignatureDigest:contract.signatureDigest,delegation:delegation.map(item=>({index:item.index,advertisedDigest:item.advertisedDigest,valueDigest:item.valueDigest,signerId:item.signerId,signatureDigest:item.signatureDigest})),stateEvents};
}
function parsedEnvelope(kind:"outcome-contract"|"delegation-grant",envelope:AuthorityEnvelope){const expected=kind==="outcome-contract"?["advertisedDigest","canonicalBase64","signature","signerId"]:["advertisedDigest","canonicalBase64","index","signature","signerId"];if(!envelope||typeof envelope!=="object"||Object.keys(envelope).sort().join("\0")!==expected.sort().join("\0"))throw new TypeError("invalid authority envelope shape");if(typeof envelope.canonicalBase64!=="string"||Buffer.from(envelope.canonicalBase64,"base64").toString("base64")!==envelope.canonicalBase64||!SHA.test(envelope.advertisedDigest)||envelope.advertisedDigest===ZERO_SHA||typeof envelope.signerId!=="string"||!envelope.signerId)throw new TypeError("invalid authority envelope");const bytes=Buffer.from(envelope.canonicalBase64,"base64");if(bytes.length===0)throw new TypeError("authority envelope bytes must be nonempty");const value=parseCanonicalAuthorityJson(kind,bytes.toString("utf8"));return {canonicalBase64:envelope.canonicalBase64,valueDigest:authorityDigest(value),advertisedDigest:envelope.advertisedDigest,signerId:envelope.signerId,signatureDigest:authoritySignatureDigest(envelope.signature),value};}
function normalizeSnapshot(input:AuthorityStateSnapshot):AuthorityStateSnapshot{if(!input||typeof input!=="object"||Object.keys(input).length!==4||typeof input.tenant!=="string"||!input.tenant||typeof input.definitionAlias!=="string"||!input.definitionAlias||!Number.isSafeInteger(input.stateVersion)||input.stateVersion<1||!Array.isArray(input.candidates))throw new TypeError("invalid authority state snapshot or version");return deepFreeze({tenant:input.tenant,definitionAlias:input.definitionAlias,stateVersion:input.stateVersion,candidates:input.candidates.map((candidate:AuthorityStateCandidate)=>{if(!candidate||typeof candidate!=="object"||Object.keys(candidate).sort().join("\0")!==["contractEnvelope","delegationEnvelopes","stateEvents"].sort().join("\0"))throw new TypeError("invalid authority state candidate shape");return {contractEnvelope:{...candidate.contractEnvelope,signature:{...candidate.contractEnvelope.signature}},delegationEnvelopes:candidate.delegationEnvelopes.map((item:AuthorityEnvelope&{readonly index:number})=>({...item,signature:{...item.signature}})),stateEvents:candidate.stateEvents.map((item:AuthorityStateCandidate["stateEvents"][number])=>({...item}))};})});}
function validPlans(plans:readonly SourceReadPlan[]):boolean{return Array.isArray(plans)&&plans.length>0&&plans.every((plan,index)=>plan&&typeof plan==="object"&&plan.index===index&&SHA.test(plan.planDigest)&&plan.planDigest!==ZERO_SHA&&typeof plan.endpointId==="string"&&typeof plan.opaqueHandle==="string")&&new Set(plans.map(plan=>plan.planDigest)).size===plans.length;}
function compareText(a:string,b:string){return a<b?-1:a>b?1:0;}
function validFailure(value:unknown,reasons:readonly string[]):value is {ok:false;reason:string}{return Boolean(value&&typeof value==="object"&&Object.keys(value).sort().join("\0")==="ok\0reason"&&(value as {ok?:unknown}).ok===false&&typeof(value as {reason?:unknown}).reason==="string"&&reasons.includes((value as {reason:string}).reason));}
function deepFreeze<T>(value:T):T{if(value&&typeof value==="object"&&!Object.isFrozen(value)){for(const child of Object.values(value as Record<string,unknown>))deepFreeze(child);Object.freeze(value);}return value;}
