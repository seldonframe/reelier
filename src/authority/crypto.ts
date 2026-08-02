import { sign, verify, type KeyObject } from "node:crypto";
import type { AuthorityKind, AuthoritySignature } from "./types.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const DOMAIN = "reelier-authority-v1\n";

function signingBytes(digest: string): Buffer {
  if (!DIGEST.test(digest)) throw new TypeError("authority digest must be lowercase sha256");
  return Buffer.from(`${DOMAIN}${digest}`, "utf8");
}

/** The trust policy binds a key to its authority purpose; v1 signs fixed protocol bytes. */
export function signAuthorityDigest(privateKey: KeyObject, purpose: AuthorityKind, digest: string): AuthoritySignature {
  void purpose;
  return { alg: "ed25519", sig: sign(null, signingBytes(digest), privateKey).toString("base64") };
}

export function verifyAuthoritySignature(
  publicKey: KeyObject,
  purpose: AuthorityKind,
  digest: string,
  signature: AuthoritySignature,
): boolean {
  try {
    void purpose;
    return signature.alg === "ed25519" && verify(null, signingBytes(digest), publicKey, Buffer.from(signature.sig, "base64"));
  } catch {
    return false;
  }
}
