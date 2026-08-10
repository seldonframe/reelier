import type { KeyObject } from "node:crypto";
import { signAuthorityDigest, verifyAuthoritySignature } from "../crypto.js";
import { authorityDigest } from "../wire.js";
import { createReleaseEvidenceManifest, type ReleaseEvidenceManifest } from "./certification.js";

export type { ReleaseEvidenceManifest } from "./certification.js";

export interface SignedReleaseEvidenceManifest {
  readonly v: "reelier.signed-release-evidence/v1";
  readonly manifest: ReleaseEvidenceManifest;
  readonly signerId: string;
  readonly digest: string;
  readonly signature: { readonly alg: "ed25519"; readonly sig: string };
}

export function signReleaseEvidenceManifest(manifest: ReleaseEvidenceManifest, input: Readonly<{ signerId: string; privateKey: KeyObject }>): SignedReleaseEvidenceManifest {
  const normalized = createReleaseEvidenceManifest(manifest);
  if (!input || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(input.signerId) || !input.privateKey) throw new TypeError("release evidence signer is invalid");
  const digest = authorityDigest(normalized);
  return Object.freeze({ v: "reelier.signed-release-evidence/v1", manifest: normalized, signerId: input.signerId, digest, signature: signAuthorityDigest(input.privateKey, "release-evidence", digest) });
}

export function verifyReleaseEvidenceManifest(value: unknown, input: Readonly<{ signerId: string; publicKey: KeyObject; purpose?: "release-evidence" | "authority-receipt" }>): SignedReleaseEvidenceManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("release evidence manifest is required");
  const raw = value as Record<string, unknown>;
  if (raw.v !== "reelier.signed-release-evidence/v1" || !raw.manifest || typeof raw.signerId !== "string" || typeof raw.digest !== "string" || !raw.signature) throw new TypeError("release evidence manifest is closed");
  if (input.purpose !== undefined && input.purpose !== "release-evidence") throw new TypeError("release evidence signature purpose is invalid");
  const manifest = createReleaseEvidenceManifest(raw.manifest as ReleaseEvidenceManifest);
  const digest = authorityDigest(manifest);
  if (raw.digest !== digest) throw new TypeError("release evidence digest mismatch");
  const signature = raw.signature as Record<string, unknown>;
  if (signature.alg !== "ed25519" || typeof signature.sig !== "string" || !verifyAuthoritySignature(input.publicKey, "release-evidence", digest, signature as { alg: "ed25519"; sig: string })) throw new TypeError("release evidence signature is invalid");
  if (raw.signerId !== input.signerId) throw new TypeError("release evidence signer mismatch");
  return Object.freeze({ v: "reelier.signed-release-evidence/v1", manifest, signerId: raw.signerId, digest, signature: Object.freeze({ alg: "ed25519" as const, sig: signature.sig }) });
}
