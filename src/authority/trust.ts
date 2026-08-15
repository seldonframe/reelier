import { createHash, type KeyObject } from "node:crypto";
import type { AuthorityKind, AuthoritySignature, AuthorityWireByKind } from "./types.js";
import { verifyAuthoritySignature } from "./crypto.js";
import { authorityDigest, parseAuthorityWire } from "./wire.js";
import type { JobCardTrustPinV1 } from "./host/deployment.js";
import { parseAuthorityKeyDescriptor, parseTrustEvents, verifySignedCertificationReadiness, type AuthorityKeyDescriptorV1, type TrustEventV1 } from "./certification/authority.js";

export interface TrustRootEntry {
  readonly tenant: string;
  readonly signerId: string;
  readonly principalId: string;
  readonly publicKey: KeyObject;
  readonly purposes: readonly AuthorityKind[];
}

declare const trustRootsBrand: unique symbol;
export interface TrustRoots { readonly [trustRootsBrand]: true }

export interface VerifiedAuthority<K extends AuthorityKind> {
  readonly value: AuthorityWireByKind[K];
  readonly digest: string;
  readonly signerId: string;
  readonly principalId: string;
}

const keyFor = (tenant: string, signerId: string) => `${tenant}\0${signerId}`;
const trustRootStates = new WeakMap<object, ReadonlyMap<string, TrustRootEntry>>();
declare const currentAuthorityTrustViewBrand:unique symbol;
export type CurrentAuthorityTrustViewV1=Readonly<{readonly[currentAuthorityTrustViewBrand]:true}>;
export interface CurrentAuthorityTrustViewStateV1{readonly tenant:string;readonly authorityCellId:string;readonly taskId:string;readonly observedAt:string;readonly pin:JobCardTrustPinV1;readonly descriptors:readonly AuthorityKeyDescriptorV1[];readonly events:readonly TrustEventV1[];readonly activeDescriptorDigests:ReadonlySet<string>;readonly trustHeadDigest:string}
const currentAuthorityTrustViewStates=new WeakMap<object,CurrentAuthorityTrustViewStateV1>();

export function createCurrentAuthorityTrustView(input:Readonly<{tenant:string;authorityCellId:string;taskId:string;observedAt:Date;jobCardTrustPin:JobCardTrustPinV1}>):CurrentAuthorityTrustViewV1{
  return createAuthorityTrustView(input,false);
}
/** Historical verification accepts a valid committed prefix while current verification does not. */
export function createAuthorityTrustViewAsOf(input:Readonly<{tenant:string;authorityCellId:string;taskId:string;observedAt:Date;jobCardTrustPin:JobCardTrustPinV1}>):CurrentAuthorityTrustViewV1{return createAuthorityTrustView(input,true);}
function createAuthorityTrustView(input:Readonly<{tenant:string;authorityCellId:string;taskId:string;observedAt:Date;jobCardTrustPin:JobCardTrustPinV1}>,allowLaterEvents:boolean):CurrentAuthorityTrustViewV1{
  exactRecord(input,["tenant","authorityCellId","taskId","observedAt","jobCardTrustPin"],"current Authority trust view input");
  let epoch:number;try{epoch=Date.prototype.getTime.call(input.observedAt);}catch{throw new TypeError("current Authority trust observation time is invalid");}if(!Number.isFinite(epoch))throw new TypeError("current Authority trust observation time is invalid");
  const pin=input.jobCardTrustPin;exactRecord(pin,["v","signedReadiness","readinessCandidate","preflight","humanTrustRoot","keyDescriptors","readinessTrustEvents","currentTrustEvents"],"Job Card trust pin");if(pin.v!=="reelier.job-card-trust-pin/v1")throw new TypeError("Job Card trust pin version is invalid");
  verifySignedCertificationReadiness({signed:pin.signedReadiness,readinessCandidate:pin.readinessCandidate,preflight:pin.preflight,humanTrustRoot:pin.humanTrustRoot,keyDescriptors:pin.keyDescriptors,trustEvents:pin.readinessTrustEvents});
  const descriptors=Object.freeze(pin.keyDescriptors.map(parseAuthorityKeyDescriptor)),readiness=parseTrustEvents(pin.readinessTrustEvents,descriptors),events=parseTrustEvents(pin.currentTrustEvents,descriptors);
  if(readiness.length>events.length||readiness.some((event,index)=>authorityDigest(event)!==authorityDigest(events[index])))throw new TypeError("current Authority trust history is not a readiness prefix");
  const ids=pin.signedReadiness.identifiers;if(ids.authorityCellId!==input.authorityCellId||ids.taskId!==input.taskId)throw new TypeError("current Authority trust Cell or task mismatch");
  const active=new Set<string>(),asOf:TrustEventV1[]=[];for(const event of events){if(Date.parse(event.occurredAt)>epoch){if(!allowLaterEvents)throw new TypeError("future Authority trust event is invalid");continue;}asOf.push(event);if(event.action==="activate")active.add(event.keyDescriptorDigest);else active.delete(event.keyDescriptorDigest);}
  if(asOf.length===0)throw new TypeError("Authority trust history has no as-of head");
  const copy=structuredClone(pin) as JobCardTrustPinV1,view=Object.freeze(Object.create(null)) as CurrentAuthorityTrustViewV1;
  currentAuthorityTrustViewStates.set(view,Object.freeze({tenant:input.tenant,authorityCellId:input.authorityCellId,taskId:input.taskId,observedAt:new Date(epoch).toISOString(),pin:deepFreeze(copy),descriptors,events:Object.freeze(asOf),activeDescriptorDigests:active,trustHeadDigest:authorityDigest(asOf.at(-1))}));return view;
}
export function currentAuthorityTrustViewState(view:CurrentAuthorityTrustViewV1):CurrentAuthorityTrustViewStateV1{const state=currentAuthorityTrustViewStates.get(view as object);if(!state)throw new TypeError("unrecognized current Authority trust view");return state;}

export function createTrustRoots(entries: readonly TrustRootEntry[]): TrustRoots {
  const indexed = new Map<string, TrustRootEntry>();
  for (const entry of entries) {
    if (entry.publicKey.type !== "public" || entry.publicKey.asymmetricKeyType !== "ed25519") throw new TypeError("trusted authority key must be an Ed25519 public key");
    if (!Array.isArray(entry.purposes) || entry.purposes.length === 0 || new Set(entry.purposes).size !== entry.purposes.length) throw new TypeError("trusted authority purposes must be nonempty and unique");
    const key = keyFor(entry.tenant, entry.signerId);
    if (indexed.has(key)) throw new TypeError("duplicate tenant-qualified trusted signer");
    indexed.set(key, Object.freeze({ ...entry, purposes: Object.freeze([...entry.purposes].sort(compareText)) }));
  }
  const roots = Object.freeze(Object.create(null)) as TrustRoots;
  trustRootStates.set(roots, indexed);
  return roots;
}

export function authoritySignatureDigest(signature: AuthoritySignature): string {
  if (!signature || typeof signature !== "object" || Object.keys(signature).length !== 2 || signature.alg !== "ed25519" || typeof signature.sig !== "string") throw new TypeError("authority signature must be a closed Ed25519 signature");
  const bytes=Buffer.from(signature.sig,"base64");
  if(bytes.length!==64||bytes.toString("base64")!==signature.sig)throw new TypeError("authority signature must contain exactly 64 canonical Base64 bytes");
  return authorityDigest({v:"reelier.authority-signature/internal-v1",alg:"ed25519",sig:signature.sig});
}

export function trustRootSetDigest(roots:TrustRoots,tenant:string):string {
  const states=trustRootStates.get(roots as object);if(!states)throw new TypeError("unrecognized trust roots");
  const selected=[...states.values()].filter(entry=>entry.tenant===tenant).sort((a,b)=>compareText(a.signerId,b.signerId));
  if(selected.length===0)throw new TypeError("tenant trust-root set must contain at least one entry");
  const entries=selected.map(entry=>{
    const der=entry.publicKey.export({type:"spki",format:"der"});
    const spkiDigest=`sha256:${createHash("sha256").update(der).digest("hex")}`;
    const entryDigest=authorityDigest({v:"reelier.trust-root-entry/internal-v1",tenant,signerId:entry.signerId,principalId:entry.principalId,purposes:entry.purposes,spkiDigest});
    return {signerId:entry.signerId,entryDigest};
  });
  return authorityDigest({v:"reelier.trust-root-set/internal-v1",tenant,entries});
}

export function verifyTrustedAuthority<K extends AuthorityKind>(
  roots: TrustRoots,
  input: Readonly<{ tenant: string; signerId: string; purpose: K; advertisedDigest: string; value: unknown; signature: AuthoritySignature }>,
): VerifiedAuthority<K> {
  const entries = trustRootStates.get(roots);
  if (!entries) throw new TypeError("unrecognized trust roots");
  const trusted = entries.get(keyFor(input.tenant, input.signerId));
  if (!trusted) {
    const signerExistsElsewhere = [...entries.values()].some(entry => entry.signerId === input.signerId);
    throw new TypeError(signerExistsElsewhere ? "untrusted signer for tenant" : "untrusted signer");
  }
  if (!trusted.purposes.includes(input.purpose)) throw new TypeError("trusted signer does not allow authority purpose");
  const value = parseAuthorityWire(input.purpose, input.value);
  const digest = authorityDigest(value);
  if (digest !== input.advertisedDigest) throw new TypeError("authority advertised digest mismatch");
  if (!verifyAuthoritySignature(trusted.publicKey, input.purpose, digest, input.signature)) throw new TypeError("authority signature verification failed");
  return Object.freeze({ value: deepFreeze(value), digest, signerId: input.signerId, principalId: trusted.principalId });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function compareText(left:string,right:string):number{return left<right?-1:left>right?1:0;}
function exactRecord(value:unknown,keys:readonly string[],label:string):asserts value is Record<string,any>{if(!value||typeof value!=="object"||Object.getPrototypeOf(value)!==Object.prototype)throw new TypeError(`${label} must be a plain record`);const descriptors=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(value).length!==keys.length||keys.some(key=>!descriptors[key]||!("value" in descriptors[key]!)||!descriptors[key]!.enumerable))throw new TypeError(`${label} must contain exact own data fields`);}
