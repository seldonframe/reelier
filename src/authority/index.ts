/** Portable Path C ABI: closed wire schemas, JCS digests, signatures, and offline bundle verification. */
export * from "./types.js";
export { authorityCanonicalBytes, authorityDigest, parseAuthorityWire, parseCanonicalAuthorityJson, parsePortableAuthorityEvidence, assertAcceptedDecisionContext, decisionContextPresence } from "./wire.js";
export { AUTHORITY_ADAPTER_CONTRACT_V1, AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST, verifyAuthorityAdapterContractV1, type AuthorityAdapterContractV1 } from "./adapter-contract.js";
export { signAuthorityDigest, verifyAuthoritySignature } from "./crypto.js";
export { createAuthorityEvidence, createAuthorityReceipt, createAuthorityReceiptBundle, parseAuthorityReceiptBundle, digestAuthorityReceiptBundle, authorityEvidenceCanonicalBytes } from "./evidence.js";
export { verifyAuthorityReceiptBundle, verifyAuthorityReceipt, type AuthorityReceiptVerificationOptions, type VerifiedAuthorityReceiptBundle } from "./verify.js";
export {
  verifyCertificationTaskReceiptGraph,
  type VerifiedCertificationTaskReceiptGraphV1,
} from "./certification/task-receipt-graph.js";
export { verifyNativeCandidate, type NativeCandidateV1, type NativeCandidateVerificationInputs } from "./certification/native-candidate.js";
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
export { OUTCOME_PROFILE_CONTRACT_V1_DIGEST } from "./outcome-profile-contract.js";
export {
  createProfileVerificationRoots,
  parseOutcomeProfileDraft,
  parseProfileConformanceReport,
  parseSignedOutcomeProfileConformance,
  parseSignedTenantProfileActivation,
  parseProfileTrustPin,
  parseProfileGovernanceManifest,
  verifyProfileGovernanceOffline,
  type OutcomeProfileDraftV1,
  type ProfileConformanceReportV1,
  type SignedOutcomeProfileConformanceV1,
  type SignedTenantProfileActivationV1,
  type ProfileTrustPinV1,
  type ProfileGovernanceManifestV1,
  type ProfileVerificationAnchorV1,
  type ProfileVerificationRootsV1,
  type ProfileGovernanceVerificationV1,
  type ProfileGovernanceVerificationInputV1,
} from "./outcome-profile.js";
