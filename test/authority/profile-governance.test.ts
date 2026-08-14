import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../../src/authority/wire.js";
import { signAuthorityDigest } from "../../src/authority/crypto.js";
import { definitionRegistrationDigest } from "../../src/authority/pack.js";
import { createFirstPartyPackRegistry } from "../../src/packs/index.js";
import { githubIssueLabelsAlias, githubIssueLabelsDefinitionDigest, githubIssueLabelsPackDigest } from "../../src/packs/github/manifest.js";
import { OUTCOME_PROFILE_CONTRACT_V1_DIGEST, createProfileVerificationRoots, verifyProfileGovernanceOffline, type OutcomeProfileDraftV1, type ProfileConformanceReportV1, type ProfileTrustPinV1, type SignedOutcomeProfileConformanceV1, type SignedTenantProfileActivationV1 } from "../../src/authority/outcome-profile.js";
import { assertAdmittedProfileGovernance, assertProfileRuntimeBinding, profileGovernanceAdmissionSnapshot } from "../../src/authority/host/profile-governance.js";
import { loadProfileGovernanceFromOperatorTrust } from "../../src/authority/host/profile-governance-loader.js";

const certifier = generateKeyPairSync("ed25519");
const operator = generateKeyPairSync("ed25519");
const packs = createFirstPartyPackRegistry();
export const governanceRef = "github_labels_governance_1";
export const tenant = "tenant_1";
export const verificationTime = new Date("2026-08-14T12:00:00.000Z");
const sha = (character: string) => `sha256:${character.repeat(64)}`;
const spki = (key: KeyObject) => key.export({ type: "spki", format: "der" }).toString("base64");

function signArtifact<T extends Readonly<Record<string, unknown>>>(artifact: T, purpose: "profile-conformance" | "profile-activation", key: KeyObject) {
  return signAuthorityDigest(key, "authority-evidence", authorityDigest({ v: "reelier.outcome-profile-signature-preimage/v1", purpose, artifactDigest: authorityDigest(artifact) }));
}

function trustKeyDigest(signerId: string, purpose: "profile-conformance" | "profile-activation", publicKeySpkiBase64: string): string {
  return authorityDigest({ v: "reelier.outcome-profile-trust-key/v1", tenant, governanceRef, signerId, purpose, publicKeySpkiBase64 });
}

function eventHead(events: readonly ProfileTrustPinV1["currentTrustEvents"][number][]): string {
  let head = "";
  for (const event of events) {
    const eventDigest = authorityDigest({ v: "reelier.outcome-profile-trust-event/v1", tenant, governanceRef, index: event.index, action: event.action, keyPurpose: event.keyPurpose, keyDigest: event.keyDigest, at: event.at, previousHeadDigest: event.previousHeadDigest });
    head = authorityDigest({ v: "reelier.outcome-profile-trust-head/v1", tenant, governanceRef, index: event.index, previousHeadDigest: event.previousHeadDigest, eventDigest });
  }
  return head;
}

export function profileGovernanceFixture() {
  const first = { index: 0, action: "activate" as const, keyPurpose: "profile-conformance" as const, keyDigest: trustKeyDigest("certifier_1", "profile-conformance", spki(certifier.publicKey)), at: "2026-08-14T10:00:00.000Z", previousHeadDigest: null };
  const events = [first, { index: 1, action: "activate" as const, keyPurpose: "profile-activation" as const, keyDigest: trustKeyDigest("operator_1", "profile-activation", spki(operator.publicKey)), at: "2026-08-14T10:01:00.000Z", previousHeadDigest: eventHead([first]) }];
  const trustHeadDigest = eventHead(events);
  const trustPin: ProfileTrustPinV1 = { v: "reelier.outcome-profile-trust-pin/v1", tenant, governanceRef, certifier: { signerId: "certifier_1", purpose: "profile-conformance", publicKeySpkiBase64: spki(certifier.publicKey) }, operator: { signerId: "operator_1", purpose: "profile-activation", publicKeySpkiBase64: spki(operator.publicKey) }, currentTrustEvents: events, currentTrustEventsDigest: authorityDigest({ v: "reelier.outcome-profile-trust-events/v1", tenant, governanceRef, events }), trustHeadDigest };
  const draft: OutcomeProfileDraftV1 = { v: "reelier.outcome-profile-draft/v1", profileId: "github_labels_profile_1", profileVersion: "1.0.0", status: "draft", authorization: "absent", conformance: "unchecked", dispatchable: false, provider: "github", packAlias: githubIssueLabelsAlias, packDigest: githubIssueLabelsPackDigest, definitionDigest: githubIssueLabelsDefinitionDigest, definitionRegistrationDigest: definitionRegistrationDigest(packs, githubIssueLabelsAlias), accountProbeDigest: sha("1"), sourceAuthorityDigest: sha("2"), argumentAuthorityDigest: sha("3"), semanticIdentityDigest: sha("4"), responseSemanticsProfileDigest: sha("5"), reconciliationRecipeDigest: sha("6"), topologyRequirementsDigest: sha("7"), conformanceVectorSetDigest: sha("8"), nonClaims: { contentCorrectness: "not-proved", providerCertification: "not-proved", safety: "not-proved", trafficCompleteness: "not-proved" } };
  const report: ProfileConformanceReportV1 = { v: "reelier.outcome-profile-conformance-report/v1", profileDigest: authorityDigest(draft), packDigest: draft.packDigest, definitionDigest: draft.definitionDigest, definitionRegistrationDigest: draft.definitionRegistrationDigest, harnessId: "github_labels_harness_1", harnessDigest: sha("9"), vectorSetDigest: draft.conformanceVectorSetDigest, sourceRevision: "315b896e4a4c8aa38e4b4eb70fbd9ea9624e20b1", checks: [{ checkId: "account_binding", vectorDigest: sha("a"), status: "passed", evidenceDigest: sha("b") }, { checkId: "reconciliation", vectorDigest: sha("c"), status: "passed", evidenceDigest: sha("d") }], claims: { closure: "verified", determinism: "verified", accountBinding: "verified", noSecrets: "verified", reconciliation: "verified" } };
  const unsignedConformance = { v: "reelier.outcome-profile-conformance/v1" as const, tenant, profileDigest: authorityDigest(draft), packDigest: draft.packDigest, definitionDigest: draft.definitionDigest, definitionRegistrationDigest: draft.definitionRegistrationDigest, harnessId: report.harnessId, harnessDigest: report.harnessDigest, vectorSetDigest: draft.conformanceVectorSetDigest, reportDigest: authorityDigest(report), sourceRevision: report.sourceRevision, claims: report.claims, signerId: "certifier_1" };
  const conformance: SignedOutcomeProfileConformanceV1 = { ...unsignedConformance, signature: signArtifact(unsignedConformance, "profile-conformance", certifier.privateKey) };
  const unsignedActivation = { v: "reelier.outcome-profile-activation/v1" as const, tenant, activationId: "activation_1", profileDigest: authorityDigest(draft), conformanceDigest: authorityDigest(conformance), jobCardDigest: sha("e"), contractDigest: OUTCOME_PROFILE_CONTRACT_V1_DIGEST, deploymentDigest: sha("f"), routeAuthorityDigest: sha("7"), trustHeadDigest, validFrom: "2026-08-14T11:00:00.000Z", validUntil: "2026-08-14T13:00:00.000Z", state: "activated" as const, signerId: "operator_1" };
  const activation: SignedTenantProfileActivationV1 = { ...unsignedActivation, signature: signArtifact(unsignedActivation, "profile-activation", operator.privateKey) };
  const manifest = { v: "reelier.outcome-profile-governance-manifest/v1" as const, tenant, governanceRef, profileDigest: authorityDigest(draft), conformanceDigest: authorityDigest(conformance), activationDigest: authorityDigest(activation), conformanceReportDigest: authorityDigest(report), trustPinDigest: authorityDigest(trustPin), trustHeadDigest };
  return { draft, report, conformance, activation, trustPin, manifest, manifestDigest: authorityDigest(manifest), packs };
}

export async function writeProfileGovernanceFixture(homedir: string) {
  const fixture = profileGovernanceFixture();
  const root = path.join(homedir, ".reelier", "trust", "outcome-profiles", tenant, governanceRef);
  await mkdir(root, { recursive: true });
  await Promise.all([["trust-pin.json", fixture.trustPin], ["manifest.json", fixture.manifest], ["profile.json", fixture.draft], ["conformance-report.json", fixture.report], ["conformance.json", fixture.conformance], ["activation.json", fixture.activation]].map(([name, value]) => writeFile(path.join(root, String(name)), `${JSON.stringify(value)}\n`, { flag: "wx" })));
  return { ...fixture, root };
}

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
  const authority = { contractDigest: fixture.activation.contractDigest, jobCardDigest: fixture.activation.jobCardDigest, deploymentDigest: fixture.activation.deploymentDigest, routeAuthorityDigest: fixture.activation.routeAuthorityDigest, trustHeadDigest: fixture.activation.trustHeadDigest };
  assert.doesNotThrow(() => assertProfileRuntimeBinding({ governance: admitted, expectedProfileDigest: fixture.manifest.profileDigest, expectedActivationDigest: fixture.manifest.activationDigest }, installed, authority));
  for (const key of Object.keys(authority) as Array<keyof typeof authority>) assert.throws(() => assertProfileRuntimeBinding({ governance: admitted, expectedProfileDigest: fixture.manifest.profileDigest, expectedActivationDigest: fixture.manifest.activationDigest }, installed, { ...authority, [key]: sha("0") }), /profile governance.*binding/i, key);
});
