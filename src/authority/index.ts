/** Portable Path C ABI: closed wire schemas, JCS digests, signatures, and offline bundle verification. */
export * from "./types.js";
export { authorityCanonicalBytes, authorityDigest, parseAuthorityWire, parseCanonicalAuthorityJson, parsePortableAuthorityEvidence, assertAcceptedDecisionContext, decisionContextPresence } from "./wire.js";
export { signAuthorityDigest, verifyAuthoritySignature } from "./crypto.js";
export { createAuthorityEvidence, createAuthorityReceipt, createAuthorityReceiptBundle, parseAuthorityReceiptBundle, digestAuthorityReceiptBundle, authorityEvidenceCanonicalBytes } from "./evidence.js";
export { verifyAuthorityReceiptBundle, verifyAuthorityReceipt, type AuthorityReceiptVerificationOptions, type VerifiedAuthorityReceiptBundle } from "./verify.js";
export { normalizeSignedJobCard, signJobCard, signedJobCardDigest, verifySignedJobCard, type SignedJobCardV1, type UnsignedJobCardV1, type OutcomeSemanticClass } from "./job.js";
export {
  parseAuthorityKeyDescriptor,
  parseTrustEvents,
  parseSignedCertificationReadiness,
  verifySignedCertificationReadiness,
  type AuthorityKeyDescriptorV1,
  type TrustEventV1,
  type SignedCertificationReadinessV1,
} from "./certification/authority.js";
