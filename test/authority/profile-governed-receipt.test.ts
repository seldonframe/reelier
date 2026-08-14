import test from "node:test";
import assert from "node:assert/strict";
import { verifyProfileGovernedAuthorityReceipt } from "../../src/authority/host/profile-governed-receipt.js";
import { profileGovernanceFixture } from "./profile-governance.test.js";

test("profile-governed receipt verifies the unchanged inner authority bundle before profile edges", () => {
  const fixture = profileGovernanceFixture();
  const wrapper = { v: "reelier.profile-governed-authority-receipt/v1", profileDraft: fixture.draft, profileConformanceReport: fixture.report, profileConformance: fixture.conformance, profileActivation: fixture.activation, authorityReceiptBundle: {}, edges: { profileDigest: fixture.manifest.profileDigest, conformanceReportDigest: fixture.manifest.conformanceReportDigest, conformanceDigest: fixture.manifest.conformanceDigest, activationDigest: fixture.manifest.activationDigest, innerReceiptDigest: `sha256:${"0".repeat(64)}` } };
  assert.throws(() => verifyProfileGovernedAuthorityReceipt(wrapper as never, {} as never), /authority receipt bundle/i);
});
