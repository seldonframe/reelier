import type { AuthorityReceiptBundle } from "../types.js";
import type { OutcomeProfileDraftV1, ProfileConformanceReportV1, ProfileGovernanceVerificationInputV1, SignedOutcomeProfileConformanceV1, SignedTenantProfileActivationV1 } from "../outcome-profile.js";
import { verifyProfileGovernanceOffline } from "../outcome-profile.js";
import { authorityDigest } from "../wire.js";
import { verifyAuthorityReceiptBundle, type AuthorityReceiptVerificationOptions, type VerifiedAuthorityReceiptBundle } from "../verify.js";
import { assertExactDataRecord } from "./profile-governance.js";

export interface ProfileGovernedAuthorityReceiptV1 {
  readonly v: "reelier.profile-governed-authority-receipt/v1";
  readonly profileDraft: OutcomeProfileDraftV1;
  readonly profileConformanceReport: ProfileConformanceReportV1;
  readonly profileConformance: SignedOutcomeProfileConformanceV1;
  readonly profileActivation: SignedTenantProfileActivationV1;
  readonly authorityReceiptBundle: AuthorityReceiptBundle;
  readonly edges: Readonly<{ profileDigest: string; conformanceReportDigest: string; conformanceDigest: string; activationDigest: string; innerReceiptDigest: string }>;
}

export interface ProfileGovernedAuthorityReceiptVerificationOptionsV1 {
  readonly authority: AuthorityReceiptVerificationOptions;
  readonly governance: Pick<ProfileGovernanceVerificationInputV1, "tenant" | "trustRoots" | "packs" | "now">;
}

export function verifyProfileGovernedAuthorityReceipt(value: unknown, options: ProfileGovernedAuthorityReceiptVerificationOptionsV1): Readonly<{ receipt: ProfileGovernedAuthorityReceiptV1; inner: VerifiedAuthorityReceiptBundle; digest: string }> {
  assertExactDataRecord(value, ["v", "profileDraft", "profileConformanceReport", "profileConformance", "profileActivation", "authorityReceiptBundle", "edges"], "profile-governed authority receipt");
  const receipt = value as unknown as ProfileGovernedAuthorityReceiptV1;
  if (receipt.v !== "reelier.profile-governed-authority-receipt/v1") throw new TypeError("invalid profile-governed authority receipt version");
  const inner = verifyAuthorityReceiptBundle(receipt.authorityReceiptBundle, options.authority);
  const governance = verifyProfileGovernanceOffline({ tenant: options.governance.tenant, draft: receipt.profileDraft, report: receipt.profileConformanceReport, conformance: receipt.profileConformance, activation: receipt.profileActivation, trustRoots: options.governance.trustRoots, packs: options.governance.packs, now: options.governance.now });
  assertExactDataRecord(receipt.edges, ["profileDigest", "conformanceReportDigest", "conformanceDigest", "activationDigest", "innerReceiptDigest"], "profile-governed receipt edges");
  if (receipt.edges.profileDigest !== governance.profileDigest || receipt.edges.conformanceReportDigest !== governance.conformanceReportDigest || receipt.edges.conformanceDigest !== governance.conformanceDigest || receipt.edges.activationDigest !== governance.activationDigest || receipt.edges.innerReceiptDigest !== inner.digest) throw new TypeError("profile-governed authority receipt edge mismatch");
  return Object.freeze({ receipt, inner, digest: authorityDigest(receipt) });
}
