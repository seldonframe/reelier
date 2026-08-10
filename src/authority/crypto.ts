import { createHash, sign, verify, type KeyObject } from "node:crypto";
import canonicalize from "canonicalize";
import type { AuthoritySignature, AuthoritySignaturePurpose } from "./types.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const DOMAIN = "reelier-authority-v1\n";
function purposeDigest(purpose: AuthoritySignaturePurpose, digest: string): string {
  if (!DIGEST.test(digest)) throw new TypeError("authority digest must be lowercase sha256");
  const material = canonicalize({ digest, purpose });
  if (!material) throw new TypeError("authority signing material is not canonicalizable");
  return `sha256:${createHash("sha256").update(material, "utf8").digest("hex")}`;
}
function signingBytes(purpose: AuthoritySignaturePurpose, digest: string): Buffer { return Buffer.from(`${DOMAIN}${purposeDigest(purpose, digest)}`, "utf8"); }
export function signAuthorityDigest(privateKey: KeyObject, purpose: AuthoritySignaturePurpose, digest: string): AuthoritySignature { return { alg: "ed25519", sig: sign(null, signingBytes(purpose, digest), privateKey).toString("base64") }; }
export function verifyAuthoritySignature(publicKey: KeyObject, purpose: AuthoritySignaturePurpose, digest: string, signature: AuthoritySignature): boolean { try { return signature.alg === "ed25519" && verify(null, signingBytes(purpose, digest), publicKey, Buffer.from(signature.sig, "base64")); } catch { return false; } }
