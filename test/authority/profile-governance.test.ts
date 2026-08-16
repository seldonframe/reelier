import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createProfileVerificationRoots, verifyProfileGovernanceOffline } from "../../src/authority/outcome-profile.js";
import { assertAdmittedProfileGovernance, assertProfileRuntimeBinding, profileGovernanceAdmissionSnapshot } from "../../src/authority/host/profile-governance.js";
import { loadProfileGovernanceFromOperatorTrust } from "../../src/authority/host/profile-governance-loader.js";
import { governanceRef, packs, profileGovernanceFixture, sha, tenant, verificationTime, writeProfileGovernanceFixture } from "./profile-governance-fixture.js";

test("only cold operator trust loading mints profile admission", async () => {
  const fixture = profileGovernanceFixture();
  const roots = createProfileVerificationRoots([
    { tenant, governanceRef, signerId: fixture.trustPin.certifier.signerId, purpose: fixture.trustPin.certifier.purpose, publicKeySpkiBase64: fixture.trustPin.certifier.publicKeySpkiBase64, currentTrustEvents: fixture.trustPin.currentTrustEvents, currentTrustEventsDigest: fixture.trustPin.currentTrustEventsDigest, trustHeadDigest: fixture.trustPin.trustHeadDigest },
    { tenant, governanceRef, signerId: fixture.trustPin.operator.signerId, purpose: fixture.trustPin.operator.purpose, publicKeySpkiBase64: fixture.trustPin.operator.publicKeySpkiBase64, currentTrustEvents: fixture.trustPin.currentTrustEvents, currentTrustEventsDigest: fixture.trustPin.currentTrustEventsDigest, trustHeadDigest: fixture.trustPin.trustHeadDigest },
  ]);
  const publicVerification = verifyProfileGovernanceOffline({ tenant, draft: fixture.draft, report: fixture.report, conformance: fixture.conformance, activation: fixture.activation, trustRoots: roots, packs, now: verificationTime });
  for (const forged of [publicVerification, { ...publicVerification }, Object.freeze({ ...publicVerification })]) assert.throws(() => assertAdmittedProfileGovernance(forged as never), /admitted profile governance/i);
});

test("admitted profile binding compares every installed and authority digest", async t => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const home = await mkdtemp(path.join(tmpdir(), "reelier-profile-binding-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const fixture = await writeProfileGovernanceFixture(home);
  const admitted = await loadProfileGovernanceFromOperatorTrust({ tenant, governanceRef, expectedManifestDigest: fixture.manifestDigest, expectedTrustHeadDigest: fixture.trustPin.trustHeadDigest, homedir: home, verificationTime });
  assert.deepEqual(profileGovernanceAdmissionSnapshot(admitted), { profileDigest: fixture.manifest.profileDigest, activationDigest: fixture.manifest.activationDigest, trustHeadDigest: fixture.manifest.trustHeadDigest });
  const installed = { packDigest: fixture.draft.packDigest, definitionDigest: fixture.draft.definitionDigest, registrationDigest: fixture.draft.definitionRegistrationDigest };
  const authority = { contractDigest: fixture.activation.contractDigest, jobCardDigest: fixture.activation.jobCardDigest, deploymentDigest: fixture.activation.deploymentDigest, routeScopeDigest: fixture.activation.routeScopeDigest, trustHeadDigest: fixture.activation.trustHeadDigest, authorityTrustHeadDigest: fixture.activation.authorityTrustHeadDigest };
  assert.doesNotThrow(() => assertProfileRuntimeBinding({ governance: admitted, expectedProfileDigest: fixture.manifest.profileDigest, expectedActivationDigest: fixture.manifest.activationDigest }, installed, authority));
  for (const key of Object.keys(authority) as Array<keyof typeof authority>) assert.throws(() => assertProfileRuntimeBinding({ governance: admitted, expectedProfileDigest: fixture.manifest.profileDigest, expectedActivationDigest: fixture.manifest.activationDigest }, installed, { ...authority, [key]: sha("0") }), /profile governance.*binding/i, key);
});
