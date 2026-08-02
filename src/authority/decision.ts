import { mkdir,open,readFile,rename,rm } from "node:fs/promises";
import path from "node:path";
import type { AuthoritySignature,DecisionContext,GateEvent } from "./types.js";
import { authorityCanonicalBytes,authorityDigest,parseAuthorityWire } from "./wire.js";

export interface GateDecisionRecord {
  readonly v:"reelier.gate-decision-record/internal-v1";readonly role:"primary"|"conflict";readonly ingressClaimDigest:string;readonly reservationId:string|null;
  readonly decisionContext:DecisionContext;readonly decisionContextDigest:string;readonly gateEvent:GateEvent;readonly gateEventDigest:string;readonly signerId:string;readonly signature:AuthoritySignature;
}
export type GateDecisionAppendResult={ok:true;status:"appended"|"idempotent";recordDigest:string}|{ok:false;reason:"event-id-conflict"|"primary-ingress-conflict"|"reservation-conflict"|"corruption"|"unavailable"};
export type GateDecisionLookupResult={ok:true;status:"found";record:GateDecisionRecord}|{ok:true;status:"absent"}|{ok:false;reason:"corruption"|"unavailable"};
export interface GateDecisionSink {append(record:GateDecisionRecord):Promise<GateDecisionAppendResult>;lookupByEvent(eventId:string):Promise<GateDecisionLookupResult>;lookupPrimaryByIngress(ingressClaimDigest:string):Promise<GateDecisionLookupResult>;lookupAcceptedByReservation(reservationId:string):Promise<GateDecisionLookupResult>}
export const gateDecisionFaultPoints=Object.freeze(["before-write","after-write","before-file-sync","after-file-sync","before-rename","after-rename","before-directory-sync","after-directory-sync"] as const);
export type GateDecisionFaultPoint=typeof gateDecisionFaultPoints[number];
export interface FileGateDecisionSinkOptions {readonly faultInjector?:(point:GateDecisionFaultPoint)=>void;readonly lockTimeoutMs?:number}

const SHA=/^sha256:[0-9a-f]{64}$/;const ZERO_SHA=`sha256:${"0".repeat(64)}`;const ID=/^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$/;
const RECORD_FIELDS=["decisionContext","decisionContextDigest","gateEvent","gateEventDigest","ingressClaimDigest","reservationId","role","signature","signerId","v"];
let tempSequence=0;

export function parseGateDecisionRecord(value:unknown):GateDecisionRecord {
  try{
    if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();const input=value as Record<string,unknown>;assertKeys(input,RECORD_FIELDS);
    if(input.v!=="reelier.gate-decision-record/internal-v1"||!(input.role==="primary"||input.role==="conflict")||typeof input.ingressClaimDigest!=="string"||!SHA.test(input.ingressClaimDigest)||input.ingressClaimDigest===ZERO_SHA||typeof input.signerId!=="string"||!ID.test(input.signerId))throw new Error();
    if(input.reservationId!==null&&(typeof input.reservationId!=="string"||!ID.test(input.reservationId)))throw new Error();
    const decisionContext=parseAuthorityWire("decision-context",input.decisionContext) as DecisionContext,gateEvent=parseAuthorityWire("gate-event",input.gateEvent) as GateEvent;
    if(input.decisionContextDigest!==authorityDigest(decisionContext)||input.gateEventDigest!==authorityDigest(gateEvent)||gateEvent.decisionContextDigest!==input.decisionContextDigest)throw new Error();
    const signature=input.signature as Record<string,unknown>;if(!signature||typeof signature!=="object"||Array.isArray(signature)||Object.keys(signature).sort().join("\0")!=="alg\0sig"||signature.alg!=="ed25519"||typeof signature.sig!=="string")throw new Error();const bytes=Buffer.from(signature.sig,"base64");if(bytes.length!==64||bytes.toString("base64")!==signature.sig)throw new Error();
    const accepted=gateEvent.verdict==="accepted"&&gateEvent.reasonCode==="accepted",conflict=gateEvent.verdict==="refused"&&gateEvent.reasonCode==="request-id-conflict";
    if(input.role==="conflict"&&(!conflict||input.reservationId!==null)||conflict&&input.role!=="conflict"||accepted&&(input.role!=="primary"||input.reservationId===null)||!accepted&&input.role==="primary"&&input.reservationId!==null)throw new Error();
    return deepFreeze({v:input.v,role:input.role,ingressClaimDigest:input.ingressClaimDigest,reservationId:input.reservationId,decisionContext,decisionContextDigest:input.decisionContextDigest as string,gateEvent,gateEventDigest:input.gateEventDigest as string,signerId:input.signerId,signature:{alg:"ed25519",sig:signature.sig}} as GateDecisionRecord);
  }catch{throw new TypeError("invalid gate decision record");}
}
export function gateDecisionRecordDigest(record:GateDecisionRecord):string{return authorityDigest(parseGateDecisionRecord(record));}

export function createFileGateDecisionSink(root:string,options:FileGateDecisionSinkOptions={}):GateDecisionSink {
  const file=path.join(root,"gate-decisions.json"),lock=path.join(root,".gate-decisions.lock"),timeout=options.lockTimeoutMs??10_000;
  let appendTail:Promise<void>=Promise.resolve();
  async function load():Promise<GateDecisionRecord[]>{let bytes:Buffer;try{bytes=await readFile(file);}catch(error){if(hasCode(error,"ENOENT"))return[];throw error;}const parsed=JSON.parse(bytes.toString("utf8")) as Record<string,unknown>;assertKeys(parsed,["records","v"]);if(parsed.v!=="reelier.gate-decision-store/internal-v1"||!Array.isArray(parsed.records))throw new Error("corrupt store");const records=parsed.records.map(parseGateDecisionRecord);if(new Set(records.map(item=>item.gateEvent.eventId)).size!==records.length)throw new Error("duplicate event index");if(new Set(records.filter(item=>item.role==="primary").map(item=>item.ingressClaimDigest)).size!==records.filter(item=>item.role==="primary").length)throw new Error("duplicate primary index");if(new Set(records.filter(item=>item.reservationId!==null).map(item=>item.reservationId)).size!==records.filter(item=>item.reservationId!==null).length)throw new Error("duplicate reservation index");return records;}
  async function withLock<T>(callback:()=>Promise<T>):Promise<T>{await mkdir(root,{recursive:true});const started=Date.now();for(;;){try{await mkdir(lock);break;}catch(error){if(!hasCode(error,"EEXIST")&&!hasCode(error,"EPERM"))throw error;if(Date.now()-started>=timeout)throw error;await new Promise(resolve=>setTimeout(resolve,2));}}try{return await callback();}finally{await rm(lock,{recursive:true,force:true});}}
  async function persist(records:GateDecisionRecord[]):Promise<void>{const temp=path.join(root,`.gate-decisions-${process.pid}-${Date.now()}-${++tempSequence}.tmp`),fault=(point:GateDecisionFaultPoint)=>options.faultInjector?.(point);const bytes=authorityCanonicalBytes({v:"reelier.gate-decision-store/internal-v1",records:[...records].sort((a,b)=>compare(a.gateEvent.eventId,b.gateEvent.eventId))});try{fault("before-write");const handle=await open(temp,"wx");try{await handle.writeFile(bytes);fault("after-write");fault("before-file-sync");await handle.sync();fault("after-file-sync");}finally{await handle.close();}fault("before-rename");await rename(temp,file);fault("after-rename");fault("before-directory-sync");if(process.platform!=="win32"){const directory=await open(root,"r");try{await directory.sync();}finally{await directory.close();}}fault("after-directory-sync");}finally{await rm(temp,{force:true});}}
  const lookup=async(predicate:(record:GateDecisionRecord)=>boolean):Promise<GateDecisionLookupResult>=>{try{const found=(await load()).find(predicate);return found?Object.freeze({ok:true as const,status:"found" as const,record:deepFreeze(structuredClone(found))}):Object.freeze({ok:true as const,status:"absent" as const});}catch(error){return Object.freeze({ok:false as const,reason:hasCode(error,"EACCES")||hasCode(error,"EBUSY")||hasCode(error,"EMFILE")?"unavailable" as const:"corruption" as const});}};
  return Object.freeze({
    async append(candidate:GateDecisionRecord):Promise<GateDecisionAppendResult>{let record:GateDecisionRecord;try{record=parseGateDecisionRecord(candidate);}catch{return Object.freeze({ok:false,reason:"corruption"});}const preceding=appendTail;let release!:()=>void;appendTail=new Promise<void>(resolve=>{release=resolve;});await preceding;try{try{return await withLock(async()=>{const records=await load(),canonical=authorityCanonicalBytes(record),event=records.find(item=>item.gateEvent.eventId===record.gateEvent.eventId);if(event)return canonical.equals(authorityCanonicalBytes(event))?Object.freeze({ok:true as const,status:"idempotent" as const,recordDigest:authorityDigest(record)}):Object.freeze({ok:false as const,reason:"event-id-conflict" as const});if(record.role==="primary"&&records.some(item=>item.role==="primary"&&item.ingressClaimDigest===record.ingressClaimDigest))return Object.freeze({ok:false as const,reason:"primary-ingress-conflict" as const});if(record.reservationId!==null&&records.some(item=>item.reservationId===record.reservationId))return Object.freeze({ok:false as const,reason:"reservation-conflict" as const});await persist([...records,record]);return Object.freeze({ok:true as const,status:"appended" as const,recordDigest:authorityDigest(record)});});}catch(error){return Object.freeze({ok:false,reason:hasCode(error,"EACCES")||hasCode(error,"EBUSY")||hasCode(error,"EMFILE")?"unavailable":"unavailable"});}}finally{release();}},
    lookupByEvent:(eventId:string)=>lookup(record=>record.gateEvent.eventId===eventId),
    lookupPrimaryByIngress:(digest:string)=>lookup(record=>record.role==="primary"&&record.ingressClaimDigest===digest),
    lookupAcceptedByReservation:(reservationId:string)=>lookup(record=>record.reservationId===reservationId),
  });
}

function assertKeys(value:Record<string,unknown>,keys:readonly string[]){if(Object.keys(value).sort().join("\0")!==[...keys].sort().join("\0"))throw new Error("unexpected keys");}
function deepFreeze<T>(value:T):T{if(value&&typeof value==="object"&&!Object.isFrozen(value)){for(const child of Object.values(value as Record<string,unknown>))deepFreeze(child);Object.freeze(value);}return value;}
function compare(left:string,right:string){return left<right?-1:left>right?1:0;}
function hasCode(error:unknown,code:string){return Boolean(error&&typeof error==="object"&&"code" in error&&(error as {code?:unknown}).code===code);}
