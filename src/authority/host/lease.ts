import type { KeyObject } from "node:crypto";
import type { SignedAuthorityLeaseV1 } from "../types.js";
import { authorityDigest } from "../wire.js";
import { signAuthorityDigest, verifyAuthoritySignature } from "../crypto.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const DIGEST = /^sha256:(?!0{64}$)[0-9a-f]{64}$/;
const MAX_VALIDITY_MS = 60_000;

export function signAuthorityLease(input: Omit<SignedAuthorityLeaseV1, "v" | "signature"> & Readonly<{ privateKey: KeyObject }>): SignedAuthorityLeaseV1 {
  const payload = leasePayload(input);
  return Object.freeze({ ...payload, signature: signAuthorityDigest(input.privateKey, "authority-lease", authorityDigest(payload)) });
}

export function verifyAuthorityLease(value: unknown, options: Readonly<{ tenant: string; now: string | Date; signerId: string; publicKey: KeyObject; topologyEvidenceDigest: string; maxAgeMs?: number }>): SignedAuthorityLeaseV1 {
  const lease = parseAuthorityLease(value);
  if (lease.tenant !== options.tenant || lease.signerId !== options.signerId) throw new TypeError("authority lease identity mismatch");
  if (lease.topologyEvidenceDigest !== options.topologyEvidenceDigest) throw new TypeError("authority lease topology evidence mismatch");
  const now = Date.parse(options.now instanceof Date ? options.now.toISOString() : options.now);
  const issued = Date.parse(lease.issuedAt), expires = Date.parse(lease.expiresAt);
  const maxAge = options.maxAgeMs ?? MAX_VALIDITY_MS;
  if (!Number.isFinite(now) || !Number.isFinite(issued) || !Number.isFinite(expires) || issued > now || now >= expires || now - issued > maxAge || expires - issued > MAX_VALIDITY_MS) throw new TypeError("authority lease is stale or outside its validity window");
  if (!verifyAuthoritySignature(options.publicKey, "authority-lease", authorityDigest(leasePayload(lease)), lease.signature)) throw new TypeError("authority lease signature is invalid");
  return lease;
}

function parseAuthorityLease(value: unknown): SignedAuthorityLeaseV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("authority lease must be an object");
  const raw = value as Record<string, unknown>;
  const keys = ["definitionAlias", "expiresAt", "issuedAt", "jobCardDigest", "kernel", "nonce", "rootGrantDigest", "signature", "signerId", "stateDigest", "stateVersion", "taskId", "tenant", "topologyEvidenceDigest", "v"];
  if (Object.keys(raw).sort().join("\0") !== keys.sort().join("\0") || raw.v !== "reelier.authority-lease/v1") throw new TypeError("authority lease is closed");
  for (const field of ["tenant", "kernel", "taskId", "definitionAlias", "nonce", "signerId"] as const) if (typeof raw[field] !== "string" || !ID.test(raw[field] as string)) throw new TypeError(`authority lease ${field} is invalid`);
  for (const field of ["stateDigest", "jobCardDigest", "rootGrantDigest", "topologyEvidenceDigest"] as const) if (typeof raw[field] !== "string" || !DIGEST.test(raw[field] as string)) throw new TypeError(`authority lease ${field} is invalid`);
  if (!Number.isSafeInteger(raw.stateVersion) || Number(raw.stateVersion) < 0) throw new TypeError("authority lease state version is invalid");
  for (const field of ["issuedAt", "expiresAt"] as const) if (typeof raw[field] !== "string" || !Number.isFinite(Date.parse(raw[field] as string))) throw new TypeError(`authority lease ${field} is invalid`);
  const signature = raw.signature as Record<string, unknown>;
  if (!signature || Object.keys(signature).sort().join("\0") !== "alg\0sig" || signature.alg !== "ed25519" || typeof signature.sig !== "string") throw new TypeError("authority lease signature is invalid");
  return Object.freeze({ v: raw.v as "reelier.authority-lease/v1", tenant: raw.tenant as string, kernel: raw.kernel as string, taskId: raw.taskId as string, definitionAlias: raw.definitionAlias as string, stateVersion: Number(raw.stateVersion), stateDigest: raw.stateDigest as string, jobCardDigest: raw.jobCardDigest as string, rootGrantDigest: raw.rootGrantDigest as string, topologyEvidenceDigest: raw.topologyEvidenceDigest as string, issuedAt: raw.issuedAt as string, expiresAt: raw.expiresAt as string, nonce: raw.nonce as string, signerId: raw.signerId as string, signature: Object.freeze({ alg: "ed25519" as const, sig: signature.sig as string }) });
}

function leasePayload(value: Partial<SignedAuthorityLeaseV1> & { privateKey?: KeyObject }): Omit<SignedAuthorityLeaseV1, "signature"> {
  const { privateKey: _privateKey, signature: _signature, ...payload } = value;
  return Object.freeze({ ...payload, v: "reelier.authority-lease/v1" as const }) as Omit<SignedAuthorityLeaseV1, "signature">;
}
