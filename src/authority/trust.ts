import type { KeyObject } from "node:crypto";
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
    const key = keyFor(entry.tenant, entry.signerId);
    if (indexed.has(key)) throw new TypeError("duplicate tenant-qualified trusted signer");
    indexed.set(key, Object.freeze({ ...entry, purposes: Object.freeze([...entry.purposes]) }));
  }
  const roots = Object.freeze(Object.create(null)) as TrustRoots;
  trustRootStates.set(roots, indexed);
  return roots;
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
