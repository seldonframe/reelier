import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { createProfileGovernedAuthorityReceiptPublication, verifyProfileGovernedAuthorityReceipt, type ProfileGovernedAuthorityReceiptVerificationOptionsV1 } from "../../src/authority/host/profile-governed-receipt.js";
import { loadProfileGovernanceFromOperatorTrust } from "../../src/authority/host/profile-governance-loader.js";
import { validateLifecycleAuthorityReceiptSigningAuthority } from "../../src/authority/host/receipt-authority.js";
import { signJobCard } from "../../src/authority/job.js";
import { authorityDigest } from "../../src/authority/wire.js";
import { governanceRef, governedReceiptSigningFixture, profileGovernanceFixture, sha, tenant, verificationTime, writeProfileGovernanceFixture } from "./profile-governance-fixture.js";

function lifecycleSigningAuthority() {
  return validateLifecycleAuthorityReceiptSigningAuthority(governedReceiptSigningFixture(verificationTime).material);
}

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

test("durable governed store refuses a reservation directory redirected outside its physical root", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-governed-store-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "reelier-governed-outside-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  await mkdir(path.join(root, "governed"), { recursive: true });
  await symlink(outside, path.join(root, "governed", "r1"), process.platform === "win32" ? "junction" : "dir");
  const profile = await writeProfileGovernanceFixture(root);
  const governance = await loadProfileGovernanceFromOperatorTrust({ tenant, governanceRef, expectedManifestDigest: profile.manifestDigest, expectedTrustHeadDigest: profile.manifest.trustHeadDigest, homedir: root, verificationTime });
  const jobKey = generateKeyPairSync("ed25519");
  const signedJobCard = signJobCard({ v: "reelier.signed-job-card/v1", jobId: "job_1", title: "Governed", taskShapeDigest: sha("1"), semanticClasses: ["record_state_set_v1"], definitionAliases: ["github_issue_labels_v1"], connectorIds: ["github"], accountIdentities: ["github:acct"], connectionDescriptorDigests: [sha("2")], adoptionCommitmentDigests: [sha("3")], sourceRefs: ["source"], audiences: ["operator"], limitsDigest: sha("4"), instructionsDigest: sha("5"), packDigests: [sha("6")], exceptionPolicy: ["ambiguous-reconcile"], coverage: "declared-surface" }, "human_job", jobKey.privateKey);
  const deploymentSnapshot = { v: "reelier.authority-deployment-snapshot/v1" as const, tenant, jobCardDigest: authorityDigest(signedJobCard), jobCardAuthorityDigest: sha("7"), authorityStateDigest: sha("8"), connectorRegistryDigest: sha("9"), trustRootSetDigest: sha("a"), connectionDescriptorsDigest: sha("b"), connectionAdoptionsDigest: sha("c"), enforcementDigest: sha("d"), routeScopeDigest: sha("e") };
  const publication = createProfileGovernedAuthorityReceiptPublication({ rootDir: root, governance, signedJobCard, deploymentSnapshot, expectedRouteScopeDigest: sha("e"), foundations: {} as never, signingAuthority: lifecycleSigningAuthority(), verification: {} as never });
  const identity = { v: "reelier.durable-dispatch-publication-identity/v1" as const, reservationId: "r1", tenant: "tenant_1", requestDigest: sha("1"), capabilityDigest: sha("2"), effectDigest: sha("3"), routeAuthorityDigest: sha("4"), expectedDispatchedRequestDigest: sha("5"), reservationIntentDigest: sha("6") };
  await assert.rejects(() => publication.loadDurableHead!({ v: "reelier.durable-dispatch-publication-query/v1", identity, ledgerState: "dispatched", sendStarted: true }), /physical|confined|link|junction|symlink|escape/i);
});
