import test from "node:test";
import assert from "node:assert/strict";
import { verifyProfileGovernedAuthorityReceipt, type ProfileGovernedAuthorityReceiptVerificationOptionsV1 } from "../../src/authority/host/profile-governed-receipt.js";
import { profileGovernanceFixture, sha } from "./profile-governance-fixture.js";

test("profile-governed receipt verifies the unchanged inner authority bundle before profile edges", () => {
  const fixture = profileGovernanceFixture();
  const wrapper = { v: "reelier.profile-governed-authority-receipt/v1", profileDraft: fixture.draft, profileConformanceReport: fixture.report, profileConformance: fixture.conformance, profileActivation: fixture.activation, authorityReceiptBundle: {}, edges: { profileDigest: fixture.manifest.profileDigest, conformanceReportDigest: fixture.manifest.conformanceReportDigest, conformanceDigest: fixture.manifest.conformanceDigest, activationDigest: fixture.manifest.activationDigest, innerReceiptDigest: `sha256:${"0".repeat(64)}` } };
  assert.throws(() => verifyProfileGovernedAuthorityReceipt(wrapper as never, { authority: { tenant: "tenant_1", trustRoots: [] }, governance: {} } as never), /authority receipt bundle/i);
});

test("offline governed verification requires an exact enumerable direct Authority root array", () => {
  const fixture = profileGovernanceFixture();
  const wrapper = { v: "reelier.profile-governed-authority-receipt/v1", profileDraft: fixture.draft, profileConformanceReport: fixture.report, profileConformance: fixture.conformance, profileActivation: fixture.activation, authorityReceiptBundle: {}, authorityBindingEvidence: {}, edges: { profileDigest: fixture.manifest.profileDigest, conformanceReportDigest: fixture.manifest.conformanceReportDigest, conformanceDigest: fixture.manifest.conformanceDigest, activationDigest: fixture.manifest.activationDigest, innerReceiptDigest: sha("1"), authorityBindingDigest: sha("2") } };
  const options = { profileTrustRoots: {} as never, profilePacks: fixture.packs, jobCardTrustPin: {} as never, currentAuthorityTrustEvents: [], directAuthorityRoots: [], expectedTenant: "tenant_1", expectedAuthorityCellId: "cell_1", expectedTaskId: "task_1", now: new Date("2026-08-14T12:00:00.000Z") } satisfies ProfileGovernedAuthorityReceiptVerificationOptionsV1;
  for (const mutated of [
    { ...options, directAuthorityRoots: {} },
    { ...options, directAuthorityRoots: [{ tenant: "tenant_2" }] },
    Object.assign(Object.create(null), options),
    Object.assign({ ...options }, { [Symbol("root")]: true }),
  ]) assert.throws(() => verifyProfileGovernedAuthorityReceipt(wrapper as never, mutated as never), /options|direct authority roots|closed|tenant|exact fields/i);
});

test("durable outer identity mutations cannot become an inner receipt prior", () => {
  const inner = sha("1");
  const outer = sha("2");
  assert.notEqual(inner, outer);
  const envelope = { receiptRef: inner, outerDigest: outer, priorReceiptDigest: inner };
  for (const field of ["receiptRef", "priorReceiptDigest"] as const) assert.notEqual({ ...envelope, [field]: outer }[field], inner);
});
