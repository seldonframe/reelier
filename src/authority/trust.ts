import { createHash, type KeyObject } from "node:crypto";
import type { AuthorityKind, AuthoritySignature, AuthorityWireByKind } from "./types.js";
import { verifyAuthoritySignature } from "./crypto.js";
import { authorityDigest, parseAuthorityWire } from "./wire.js";

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
