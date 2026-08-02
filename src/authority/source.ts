import { createHash } from "node:crypto";
import type { SourceBundle, SourceClaim, SourceObservationEvidence } from "./types.js";
import { authorityDigest, parseAuthorityWire } from "./wire.js";

export interface UnboundSourceRead { readonly endpointId:string; readonly opaqueHandle:string }
export interface PlannedSourceRead extends UnboundSourceRead { readonly index:number; readonly planDigest:string }
export type SourceReadPlan = PlannedSourceRead;
export interface RawSourceObservation { readonly planDigest:string; readonly rawBytes:Uint8Array }
export interface ResolverSourceObservation extends SourceObservationEvidence { readonly bodyBase64:string }
export interface SourceProjection { readonly sourceIdentity:string;readonly triggerIdentity:string;readonly projection:Record<string,unknown>;readonly claims:{grounded:readonly SourceClaim[];authored:readonly SourceClaim[];unresolved:readonly SourceClaim[]} }
export interface RegisteredSourceResolver {
  readonly tenant:string;readonly resolverId:string;readonly definitionDigest:string;readonly projectionSchemaId:string;
  readonly readEndpointIds:readonly string[];readonly maxFreshnessSeconds:number;
  readonly plan:(sourceRefs:Readonly<Record<string,string>>)=>readonly UnboundSourceRead[];
  readonly project:(input:Readonly<{plans:readonly PlannedSourceRead[];observations:readonly ResolverSourceObservation[];observedAt:string}>)=>SourceProjection;
}
declare const sourceRegistryBrand:unique symbol;
export interface SourceRegistry { readonly [sourceRegistryBrand]:true }
export interface SourceValidationAuthority { readonly tenant:string;readonly definitionDigest:string;readonly resolverId:string;readonly projectionSchemaId:string;readonly allowedReadEndpointIds:readonly string[];readonly authorizedProjectionPointers:readonly string[];readonly requiredGroundedPointers:readonly string[];readonly maxFreshnessSeconds:number }
declare const validatedSourceBrand:unique symbol;
export interface ValidatedSourceBundle { readonly [validatedSourceBrand]:true;readonly bundle:SourceBundle;readonly digest:string;readonly validationInstant:string;readonly sourceSnapshotDigest:string }

const resolverKey=(tenant:string,resolverId:string)=>`${tenant}\0${resolverId}`;
const OPAQUE=/^(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*[\\/])[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const registryStates=new WeakMap<object,ReadonlyMap<string,RegisteredSourceResolver>>();
const validated=new WeakSet<object>();
const RESOLVER_FIELDS=new Set(["tenant","resolverId","definitionDigest","projectionSchemaId","readEndpointIds","maxFreshnessSeconds","plan","project"]);
const SHA=/^sha256:[0-9a-f]{64}$/;const ZERO_SHA=`sha256:${"0".repeat(64)}`;

export function createSourceRegistry(resolvers:readonly RegisteredSourceResolver[]):SourceRegistry {
  const indexed=new Map<string,RegisteredSourceResolver>();
  for(const item of resolvers){
    if(!item||typeof item!=="object"||Object.keys(item).length!==RESOLVER_FIELDS.size||Object.keys(item).some(field=>!RESOLVER_FIELDS.has(field)))throw new TypeError("source resolver must be a closed registration");
    if(!SHA.test(item.definitionDigest)||item.definitionDigest===ZERO_SHA)throw new TypeError("source resolver definition digest must be non-zero lowercase sha256");
    if(!Number.isSafeInteger(item.maxFreshnessSeconds)||item.maxFreshnessSeconds<1||item.maxFreshnessSeconds>300) throw new TypeError("invalid resolver max freshness");
    const key=resolverKey(item.tenant,item.resolverId);if(indexed.has(key)) throw new TypeError("duplicate tenant-qualified source resolver");
    if(!Array.isArray(item.readEndpointIds)||item.readEndpointIds.length===0||item.readEndpointIds.some(value=>typeof value!=="string"||value.length===0)||new Set(item.readEndpointIds).size!==item.readEndpointIds.length)throw new TypeError("resolver read endpoints must be nonempty and unique");
    indexed.set(key,Object.freeze({...item,readEndpointIds:Object.freeze([...item.readEndpointIds].sort(compareText))}));
  }
  const registry=Object.freeze(Object.create(null)) as SourceRegistry;registryStates.set(registry,indexed);return registry;
}

export function sourceResolverRegistrationDigest(registry:SourceRegistry,tenant:string,resolverId:string):string {
  const states=registryStates.get(registry as object);if(!states)throw new TypeError("unrecognized source registry");const resolver=states.get(resolverKey(tenant,resolverId));if(!resolver)throw new TypeError("missing source resolver registration");
  return authorityDigest({v:"reelier.source-resolver-registration/internal-v1",tenant,resolverId,definitionDigest:resolver.definitionDigest,projectionSchemaId:resolver.projectionSchemaId,readEndpointIds:resolver.readEndpointIds,maxFreshnessSeconds:resolver.maxFreshnessSeconds});
}

export function planSourceReads(registry:SourceRegistry,input:Readonly<{tenant:string;resolverId:string;definitionDigest:string;sourceRefs:Readonly<Record<string,string>>;allowedReadEndpointIds:readonly string[]}>):readonly PlannedSourceRead[]{
  for(const handle of Object.values(input.sourceRefs)) if(!OPAQUE.test(handle)) throw new TypeError("source reference must be an opaque handle");
  const resolver=requireResolver(registry,input.tenant,input.resolverId,input.definitionDigest);
  const registered=new Set(resolver.readEndpointIds),authorized=new Set(input.allowedReadEndpointIds);
  const sourceRefs=deepFreeze({...input.sourceRefs});
  const sourceRefsDigest=authorityDigest({v:"reelier.source-refs/internal-v1",sourceRefs});
  const unbound=resolver.plan(sourceRefs);
  if(!Array.isArray(unbound)||unbound.length<1||unbound.length>64) throw new TypeError("source read plan must be nonempty and bounded");
  const plans=unbound.map((read,index)=>{
    if(!registered.has(read.endpointId)) throw new TypeError("unknown source read endpoint");if(!authorized.has(read.endpointId)) throw new TypeError("unauthorized source read endpoint");if(!OPAQUE.test(read.opaqueHandle)) throw new TypeError("source plan must retain an opaque handle");
    const planDigest=authorityDigest({v:"reelier.source-read-plan/internal-v1",tenant:input.tenant,resolverId:input.resolverId,definitionDigest:input.definitionDigest,sourceRefsDigest,index,endpointId:read.endpointId,opaqueHandle:read.opaqueHandle});
    return Object.freeze({index,planDigest,endpointId:read.endpointId,opaqueHandle:read.opaqueHandle});
  });
  if(new Set(plans.map(p=>p.planDigest)).size!==plans.length) throw new TypeError("duplicate source read plan");return Object.freeze(plans);
}

export function materializeSourceBundle(registry:SourceRegistry,input:Readonly<SourceValidationAuthority&{sourceRefs:Readonly<Record<string,string>>;observedAt:Date;plans:readonly PlannedSourceRead[];observations:readonly RawSourceObservation[]}>):ValidatedSourceBundle{
  const resolver=requireResolver(registry,input.tenant,input.resolverId,input.definitionDigest);
  if(input.projectionSchemaId!==resolver.projectionSchemaId) throw new TypeError("source projection schema mismatch");
  if(!Number.isSafeInteger(input.maxFreshnessSeconds)||input.maxFreshnessSeconds<1||input.maxFreshnessSeconds>resolver.maxFreshnessSeconds) throw new TypeError("contract freshness exceeds resolver maximum");
  const planned=planSourceReads(registry,input);
  if(authorityDigest(planned)!==authorityDigest(input.plans)) throw new TypeError("source plans do not match registered plan");
  const byDigest=new Map<string,Uint8Array>();
  for(const observation of input.observations){if(byDigest.has(observation.planDigest)) throw new TypeError("duplicate source observation");if(!planned.some(p=>p.planDigest===observation.planDigest)) throw new TypeError("unknown or extra source observation");byDigest.set(observation.planDigest,Uint8Array.from(observation.rawBytes));}
  if(byDigest.size!==planned.length) throw new TypeError("missing source observation");
  const resolverObservations=Object.freeze(planned.map(plan=>{const raw=byDigest.get(plan.planDigest)!;return Object.freeze({index:plan.index,planDigest:plan.planDigest,endpointId:plan.endpointId,rawDigest:sha(raw),bodyBase64:Buffer.from(raw).toString("base64")});}));
  const observedAt=input.observedAt.toISOString();if(!Number.isFinite(input.observedAt.getTime())) throw new TypeError("invalid observed time");
  const projected=resolver.project(Object.freeze({plans:planned,observations:resolverObservations,observedAt}));
  const claims=canonicalClaims(projected.claims,projected.projection,input.authorizedProjectionPointers,input.requiredGroundedPointers);
  const sourceRefs=deepFreeze({...input.sourceRefs});const sourceRefsDigest=authorityDigest({v:"reelier.source-refs/internal-v1",sourceRefs});
  const evidence=resolverObservations.map(({index,planDigest,endpointId,rawDigest})=>({index,planDigest,endpointId,rawDigest}));
  const readSetDigest=authorityDigest({v:"reelier.source-read-set/internal-v1",sourceRefsDigest,observations:evidence});
  const freshness=Math.min(input.maxFreshnessSeconds,resolver.maxFreshnessSeconds);const until=input.observedAt.getTime()+freshness*1000;if(!Number.isSafeInteger(until)) throw new TypeError("source freshness overflow");
  const bundle=deepFreeze(parseAuthorityWire("source-bundle",{v:"reelier.source-bundle/v1",tenant:input.tenant,definitionDigest:input.definitionDigest,projectionSchemaId:input.projectionSchemaId,sourceRefsDigest,readSetDigest,sourceIdentity:projected.sourceIdentity,triggerIdentity:projected.triggerIdentity,observedAt,freshUntil:new Date(until).toISOString(),provenance:{resolverId:input.resolverId,observations:evidence},claims,projection:projected.projection}));
  const digest=authorityDigest(bundle);const sourceSnapshotDigest=authorityDigest({v:"reelier.source-snapshot/internal-v1",bundleDigest:digest,sourceRefsDigest,readSetDigest,resolverId:input.resolverId,observations:evidence});
  const result=Object.freeze({bundle,digest,validationInstant:observedAt,sourceSnapshotDigest}) as ValidatedSourceBundle;validated.add(result);return result;
}

/** Legacy candidate validation is deliberately disabled: kernel materialization is required. */
export function validateSourceBundle():never { throw new TypeError("candidate source bundles are unsupported; use materializeSourceBundle"); }
export function isValidatedSourceBundle(value:unknown):value is ValidatedSourceBundle{return Boolean(value&&typeof value==="object"&&validated.has(value));}
export function assertValidatedSourceBundle(value:unknown):asserts value is ValidatedSourceBundle{if(!isValidatedSourceBundle(value)) throw new TypeError("compile requires a validated source bundle");}
function requireResolver(registry:SourceRegistry,tenant:string,resolverId:string,definitionDigest:string):RegisteredSourceResolver{const states=registryStates.get(registry);if(!states) throw new TypeError("unrecognized source registry");const resolver=states.get(resolverKey(tenant,resolverId));if(!resolver) throw new TypeError("unknown resolver for tenant");if(resolver.definitionDigest!==definitionDigest) throw new TypeError("source resolver definition mismatch");return resolver;}
function canonicalClaims(claims:SourceProjection["claims"],projection:Record<string,unknown>,authorizedPointers:readonly string[],required:readonly string[]){const all=[...claims.grounded,...claims.authored,...claims.unresolved];if(new Set(all.map(c=>c.claimId)).size!==all.length||new Set(all.map(c=>c.projectionPointer)).size!==all.length) throw new TypeError("source claims must have unique ownership");const leaves=projectionLeafPointers(projection).sort(compareText);const pointers=all.map(c=>c.projectionPointer).sort(compareText);if(leaves.join("\0")!==pointers.join("\0")) throw new TypeError("source claims must cover every projection leaf exactly once");const allowed=new Set(authorizedPointers);if(pointers.some(p=>!allowed.has(p))) throw new TypeError("source projection contains unauthorized pointer");const grounded=new Set(claims.grounded.map(c=>c.projectionPointer));if(required.some(p=>!grounded.has(p)||!leaves.includes(p))) throw new TypeError("required source field is not grounded leaf");const sort=(items:readonly SourceClaim[])=>Object.freeze(items.map(x=>Object.freeze({...x})).sort((a,b)=>compareText(a.projectionPointer,b.projectionPointer)||compareText(a.claimId,b.claimId)));return Object.freeze({grounded:sort(claims.grounded),authored:sort(claims.authored),unresolved:sort(claims.unresolved)});}
function compareText(left:string,right:string):number{return left<right?-1:left>right?1:0;}
function projectionLeafPointers(value:unknown,prefix=""):string[]{if(value!==null&&typeof value==="object"&&!Array.isArray(value)){const entries=Object.entries(value as Record<string,unknown>);if(entries.length)return entries.flatMap(([k,v])=>projectionLeafPointers(v,`${prefix}/${k.replace(/~/g,"~0").replace(/\//g,"~1")}`));}return[prefix];}
function sha(bytes:Uint8Array){return`sha256:${createHash("sha256").update(bytes).digest("hex")}`;}
function deepFreeze<T>(value:T):T{if(value&&typeof value==="object"&&!Object.isFrozen(value)){for(const child of Object.values(value as Record<string,unknown>))deepFreeze(child);Object.freeze(value);}return value;}
