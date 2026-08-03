import canonicalize from "canonicalize";
import { createHash } from "node:crypto";

export interface CoordinationOwner { readonly host:string;readonly nonce:string;readonly pid:number;readonly v:1 }
export interface CoordinationFileIdentity { readonly dev:bigint;readonly ino:bigint;readonly mode:bigint;readonly nlink:bigint }
export interface CoordinationIdentityWire { readonly dev:string;readonly ino:string;readonly mode:string;readonly nlink:string }

export const ADMISSION_SLOT_NAME=".authority-ledger-admission-0";
export const COORDINATION_ACK_VERSION="reelier.authority-ledger-coordination-cleanup-ack/v1";
const HEX64="[0-9a-f]{64}",PID="([1-9][0-9]*)",NONCE=`(${HEX64})`,HOST=`(${HEX64})`,TICKET="([0-9a-f]{16})";
const PREP=new RegExp(`^\\.authority-ledger-admission-prep-${HOST}-${PID}-${NONCE}\\.tmp$`);
const PREP_RETIRED=new RegExp(`^\\.authority-ledger-admission-prep-retired-${HOST}-${PID}-${NONCE}\\.(empty|zero|partial|complete)$`);
const SLOT_RETIRED=new RegExp(`^\\.authority-ledger-admission-retired-${HOST}-${PID}-${NONCE}\\.(published|withdrawn|abandoned)$`);
const WITHDRAWAL=new RegExp(`^\\.authority-ledger-creator-withdrawal-${HOST}-${TICKET}-${PID}-${NONCE}\\.(empty|zero|partial)$`);
const COORDINATION_ACK=new RegExp(`^\\.authority-ledger-coordination-cleanup-(${HEX64})\\.ack$`);
const COORDINATION_STAGE=new RegExp(`^\\.authority-ledger-coordination-cleanup-stage-(p|s|w)-(${HEX64})\\.tmp$`);
const PUBLICATION=new RegExp(`^\\.authority-ledger-lock-publication-${HOST}-${TICKET}-${PID}-${NONCE}\\.tmp$`);
const OWNER_NONCE=new RegExp(`^${HEX64}$`),DIGEST=new RegExp(`^sha256:${HEX64}$`),UNSIGNED=/^(?:0|[1-9][0-9]*)$/,SIGNED=/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/;
const MIN_SIGNED=-(1n<<63n),MAX_UNSIGNED=(1n<<64n)-1n;

export type PartialOwnerState="empty"|"zero"|"partial"|"complete";
export type ParsedK1Name=
  |Readonly<{kind:"admission-slot";name:string}>
  |Readonly<{kind:"admission-prep";name:string;hostDigest:string;pid:number;nonce:string}>
  |Readonly<{kind:"admission-prep-retired";name:string;hostDigest:string;pid:number;nonce:string;state:PartialOwnerState}>
  |Readonly<{kind:"admission-slot-retired";name:string;hostDigest:string;pid:number;nonce:string;disposition:"published"|"withdrawn"|"abandoned"}>
  |Readonly<{kind:"creator-withdrawal";name:string;hostDigest:string;ticket:bigint;pid:number;nonce:string;state:Exclude<PartialOwnerState,"complete">}>
  |Readonly<{kind:"coordination-ack";name:string;digest:string}>
  |Readonly<{kind:"coordination-stage";name:string;purpose:"prep-retired"|"slot-retired"|"creator-withdrawal";digest:string}>;
export interface ParsedPublicationName { readonly name:string;readonly hostDigest:string;readonly ticket:bigint;readonly pid:number;readonly nonce:string }

export type CoordinationAck=Readonly<Record<string,unknown>> & Readonly<{v:typeof COORDINATION_ACK_VERSION;purpose:"prep-retired"|"slot-retired"|"creator-withdrawal";owner:CoordinationOwner}>;

export function coordinationHostDigest(host:string):string{return createHash("sha256").update(host,"utf8").digest("hex");}
export function coordinationRawDigest(bytes:Uint8Array):string{return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;}
export function coordinationCanonicalBytes(value:unknown):Buffer{const encoded=canonicalize(value);if(encoded===undefined)throw new TypeError("coordination value is not canonicalizable");return Buffer.from(encoded,"utf8");}
export function coordinationCanonicalDigest(value:unknown):string{return coordinationRawDigest(coordinationCanonicalBytes(value));}
export function coordinationOwnerBytes(owner:CoordinationOwner):Buffer{assertCoordinationOwner(owner);return coordinationCanonicalBytes(owner);}
export function parseCoordinationOwnerBytes(bytes:Uint8Array):CoordinationOwner{let value:unknown;try{value=JSON.parse(Buffer.from(bytes).toString("utf8"));}catch{throw new TypeError("invalid coordination owner JSON");}assertCoordinationOwner(value);if(!coordinationOwnerBytes(value).equals(Buffer.from(bytes)))throw new TypeError("noncanonical coordination owner");return value;}

export function encodeCoordinationIdentityWire(raw:CoordinationFileIdentity):CoordinationIdentityWire{
  const wire={dev:raw.dev.toString(10),ino:raw.ino.toString(10),mode:raw.mode.toString(10),nlink:raw.nlink.toString(10)};
  parseCoordinationIdentityWire(wire);
  return wire;
}
export function parseCoordinationIdentityWire(value:unknown):CoordinationFileIdentity{
  if(!isRecord(value)||sortedKeys(value)!=="dev,ino,mode,nlink")throw new TypeError("invalid coordination identity shape");
  return {dev:parseIdentityPart(value.dev,true),ino:parseIdentityPart(value.ino,true),mode:parseIdentityPart(value.mode,false),nlink:parseIdentityPart(value.nlink,false)};
}
export function coordinationIdentityMatches(wire:CoordinationIdentityWire,raw:CoordinationFileIdentity):boolean{
  try{parseCoordinationIdentityWire(wire);}catch{return false;}
  return wire.dev===raw.dev.toString(10)&&wire.ino===raw.ino.toString(10)&&wire.mode===raw.mode.toString(10)&&wire.nlink===raw.nlink.toString(10);
}
function parseIdentityPart(value:unknown,signed:boolean):bigint{
  if(typeof value!=="string"||value.length>20||!(signed?SIGNED:UNSIGNED).test(value))throw new TypeError("invalid coordination identity decimal");
  const parsed=BigInt(value);if(parsed>MAX_UNSIGNED||signed&&parsed<MIN_SIGNED)throw new TypeError("coordination identity outside range");return parsed;
}

export function isK1ReservedName(name:string):boolean{return name===ADMISSION_SLOT_NAME||name.startsWith(".authority-ledger-admission-")||name.startsWith(".authority-ledger-creator-withdrawal-")||name.startsWith(".authority-ledger-coordination-cleanup-");}
export function parseK1Name(name:string):ParsedK1Name|null{
  if(name===ADMISSION_SLOT_NAME)return {kind:"admission-slot",name};
  let match=PREP_RETIRED.exec(name);if(match){const pid=parsePid(match[2]);if(pid!==null)return {kind:"admission-prep-retired",name,hostDigest:match[1],pid,nonce:match[3],state:match[4] as PartialOwnerState};return null;}
  match=PREP.exec(name);if(match){const pid=parsePid(match[2]);if(pid!==null)return {kind:"admission-prep",name,hostDigest:match[1],pid,nonce:match[3]};return null;}
  match=SLOT_RETIRED.exec(name);if(match){const pid=parsePid(match[2]);if(pid!==null)return {kind:"admission-slot-retired",name,hostDigest:match[1],pid,nonce:match[3],disposition:match[4] as "published"|"withdrawn"|"abandoned"};return null;}
  match=WITHDRAWAL.exec(name);if(match){const ticket=parseTicket(match[2]),pid=parsePid(match[3]);if(ticket!==null&&pid!==null)return {kind:"creator-withdrawal",name,hostDigest:match[1],ticket,pid,nonce:match[4],state:match[5] as Exclude<PartialOwnerState,"complete">};return null;}
  match=COORDINATION_STAGE.exec(name);if(match)return {kind:"coordination-stage",name,purpose:match[1]==="p"?"prep-retired":match[1]==="s"?"slot-retired":"creator-withdrawal",digest:match[2]};
  match=COORDINATION_ACK.exec(name);return match?{kind:"coordination-ack",name,digest:match[1]}:null;
}
export function parsePublicationName(name:string):ParsedPublicationName|null{const match=PUBLICATION.exec(name);if(!match)return null;const ticket=parseTicket(match[2]),pid=parsePid(match[3]);return ticket===null||pid===null?null:{name,hostDigest:match[1],ticket,pid,nonce:match[4]};}
export function buildPublicationName(owner:CoordinationOwner,ticket:bigint):string{assertCoordinationOwner(owner);if(ticket<=0n||ticket>MAX_UNSIGNED)throw new TypeError("invalid publication ticket");return `.authority-ledger-lock-publication-${coordinationHostDigest(owner.host)}-${ticket.toString(16).padStart(16,"0")}-${owner.pid}-${owner.nonce}.tmp`;}
export function classifyCoordinationOwnerBytes(bytes:Uint8Array,owner:CoordinationOwner):PartialOwnerState|"invalid"{const actual=Buffer.from(bytes),expected=coordinationOwnerBytes(owner);if(actual.length===0)return "zero";if(actual.length<expected.length&&expected.subarray(0,actual.length).equals(actual))return "partial";return actual.equals(expected)?"complete":"invalid";}

export function parseCoordinationAckBytes(bytes:Uint8Array):CoordinationAck{
  let value:unknown;try{value=JSON.parse(Buffer.from(bytes).toString("utf8"));}catch{throw new TypeError("invalid coordination ack JSON");}
  if(!coordinationCanonicalBytes(value).equals(Buffer.from(bytes))||!isRecord(value)||value.v!==COORDINATION_ACK_VERSION)throw new TypeError("noncanonical coordination ack");
  assertCoordinationAck(value);return value as CoordinationAck;
}
function assertCoordinationAck(value:Record<string,unknown>):void{
  const owner=value.owner;assertCoordinationOwner(owner);if(value.ownerDigest!==coordinationCanonicalDigest(owner)||!DIGEST.test(String(value.ownerBytesDigest)))throw new TypeError("coordination ack owner binding");
  if(typeof value.ownerBytesLength!=="string"||!UNSIGNED.test(value.ownerBytesLength)||value.ownerBytesLength.length>20)throw new TypeError("coordination ack owner length");
  if(value.ownerIdentity!==null)parseCoordinationIdentityWire(value.ownerIdentity);
  if(value.purpose==="prep-retired"){
    requireKeys(value,["directoryIdentity","kind","markerName","originalName","owner","ownerBytesDigest","ownerBytesLength","ownerDigest","ownerIdentity","purpose","recoveryAuthority","state","v"]);
    parseCoordinationIdentityWire(value.directoryIdentity);
    if(value.kind!=="admission-prep-retired"||value.recoveryAuthority!=="dead-owner-or-exact-creator"||!(["empty","zero","partial","complete"] as unknown[]).includes(value.state))throw new TypeError("invalid prep-retired ack");
  }else if(value.purpose==="slot-retired"){
    requireKeys(value,["disposition","kind","markerName","originalName","owner","ownerBytesDigest","ownerBytesLength","ownerDigest","ownerIdentity","purpose","recoveryAuthority","slotIdentity","terminalArtifactDigest","terminalArtifactName","v"]);
    parseCoordinationIdentityWire(value.slotIdentity);if(value.kind!=="admission-slot-retired"||value.originalName!==ADMISSION_SLOT_NAME||!DIGEST.test(String(value.terminalArtifactDigest))||typeof value.terminalArtifactName!=="string")throw new TypeError("invalid slot-retired ack");
    const expected=value.disposition==="abandoned"?"dead-owner-or-exact-creator":value.disposition==="withdrawn"?"exact-withdrawal-marker":value.disposition==="published"?"active-owner-or-exact-lock-successor":null;if(expected===null||value.recoveryAuthority!==expected)throw new TypeError("invalid slot-retired disposition");
  }else if(value.purpose==="creator-withdrawal"){
    requireKeys(value,["directoryIdentity","kind","markerName","originalName","owner","ownerBytesDigest","ownerBytesLength","ownerDigest","ownerIdentity","purpose","recoveryAuthority","slotRetirementAckDigest","slotRetirementAckName","state","v"]);
    parseCoordinationIdentityWire(value.directoryIdentity);
    if(value.kind!=="creator-withdrawal"||value.recoveryAuthority!=="exact-slot-retirement-ack"||!(["empty","zero","partial"] as unknown[]).includes(value.state)||!DIGEST.test(String(value.slotRetirementAckDigest))||typeof value.slotRetirementAckName!=="string")throw new TypeError("invalid creator-withdrawal ack");
  }else throw new TypeError("invalid coordination ack purpose");
  if(typeof value.markerName!=="string"||typeof value.originalName!=="string"||(value.state==="empty")!==(value.ownerIdentity===null))throw new TypeError("invalid coordination ack binding");
}
export function assertCoordinationOwner(value:unknown):asserts value is CoordinationOwner{if(!isRecord(value)||sortedKeys(value)!=="host,nonce,pid,v"||typeof value.host!=="string"||value.host.length===0||typeof value.nonce!=="string"||!OWNER_NONCE.test(value.nonce)||!Number.isSafeInteger(value.pid)||Number(value.pid)<=0||value.v!==1)throw new TypeError("invalid coordination owner");}
function parsePid(text:string):number|null{const pid=Number(text);return Number.isSafeInteger(pid)&&pid>0?pid:null;}
function parseTicket(text:string):bigint|null{const ticket=BigInt(`0x${text}`);return ticket>0n&&ticket<=MAX_UNSIGNED?ticket:null;}
function isRecord(value:unknown):value is Record<string,unknown>{return Boolean(value&&typeof value==="object"&&!Array.isArray(value));}
function sortedKeys(value:Record<string,unknown>):string{return Object.keys(value).sort().join(",");}
function requireKeys(value:Record<string,unknown>,keys:readonly string[]):void{if(sortedKeys(value)!==[...keys].sort().join(","))throw new TypeError("invalid coordination ack shape");}
