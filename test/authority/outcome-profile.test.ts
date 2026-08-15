import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import { signAuthorityDigest } from "../../src/authority/crypto.js";
import { definitionRegistrationDigest } from "../../src/authority/pack.js";
import {
  createFirstPartyPackRegistry,
} from "../../src/packs/index.js";
import { githubIssueLabelsAlias, githubIssueLabelsDefinitionDigest, githubIssueLabelsPackDigest } from "../../src/packs/github/manifest.js";
import {
  OUTCOME_PROFILE_CONTRACT_V1_DIGEST,
  createProfileVerificationRoots,
  parseOutcomeProfileDraft,
  parseProfileConformanceReport,
  parseProfileGovernanceManifest,
  parseProfileTrustPin,
  parseAuthorityDeploymentSnapshot,
  parseAuthorityRouteScope,
  parseSignedProfileAuthorityBinding,
  parseSignedOutcomeProfileConformance,
  parseSignedTenantProfileActivation,
  verifyProfileGovernanceOffline,
  type OutcomeProfileDraftV1,
  type ProfileConformanceReportV1,
  type ProfileGovernanceManifestV1,
  type ProfileTrustPinV1,
  type ProfileVerificationAnchorV1,
  type SignedOutcomeProfileConformanceV1,
  type SignedTenantProfileActivationV1,
  type AuthorityDeploymentSnapshotV1,
  type AuthorityRouteScopeV1,
  type SignedProfileAuthorityBindingV1,
} from "../../src/authority/outcome-profile.js";
import { profileGovernanceFixture } from "./profile-governance-fixture.js";

const certifier = generateKeyPairSync("ed25519");
const operator = generateKeyPairSync("ed25519");
const init = generateKeyPairSync("ed25519");
const packs = createFirstPartyPackRegistry();
const at = "2026-08-14T10:00:00.000Z";
const now = new Date("2026-08-14T12:00:00.000Z");
const governanceRef = "github_labels_governance_1";
const sha = (character: string) => `sha256:${character.repeat(64)}`;
const spki = (key: KeyObject) => key.export({ type: "spki", format: "der" }).toString("base64");

function fixtureDraft(): OutcomeProfileDraftV1 {
  return {
    v: "reelier.outcome-profile-draft/v1",
    profileId: "github_labels_profile_1",
    profileVersion: "1.0.0",
    status: "draft",
    authorization: "absent",
    conformance: "unchecked",
    dispatchable: false,
    provider: "github",
    packAlias: githubIssueLabelsAlias,
    packDigest: githubIssueLabelsPackDigest,
    definitionDigest: githubIssueLabelsDefinitionDigest,
    definitionRegistrationDigest: definitionRegistrationDigest(packs, githubIssueLabelsAlias),
    accountProbeDigest: sha("1"),
    sourceAuthorityDigest: sha("2"),
    argumentAuthorityDigest: sha("3"),
    semanticIdentityDigest: sha("4"),
    responseSemanticsProfileDigest: sha("5"),
    reconciliationRecipeDigest: sha("6"),
    topologyRequirementsDigest: sha("7"),
    conformanceVectorSetDigest: sha("8"),
    nonClaims: {
      contentCorrectness: "not-proved",
      providerCertification: "not-proved",
      safety: "not-proved",
      trafficCompleteness: "not-proved",
    },
  };
}

function fixtureConformanceReport(draft: OutcomeProfileDraftV1): ProfileConformanceReportV1 {
  return {
    v: "reelier.outcome-profile-conformance-report/v1",
    profileDigest: authorityDigest(draft),
    packDigest: draft.packDigest,
    definitionDigest: draft.definitionDigest,
    definitionRegistrationDigest: draft.definitionRegistrationDigest,
    harnessId: "github_labels_harness_1",
    harnessDigest: sha("9"),
    vectorSetDigest: draft.conformanceVectorSetDigest,
    sourceRevision: "315b896e4a4c8aa38e4b4eb70fbd9ea9624e20b1",
    checks: [
      { checkId: "account_binding", vectorDigest: sha("a"), status: "passed", evidenceDigest: sha("b") },
      { checkId: "reconciliation", vectorDigest: sha("c"), status: "passed", evidenceDigest: sha("d") },
    ],
    claims: { closure: "verified", determinism: "verified", accountBinding: "verified", noSecrets: "verified", reconciliation: "verified" },
  };
}

function signProfileArtifact<T extends Readonly<Record<string, unknown>>>(artifact: T, purpose: "profile-conformance" | "profile-activation", key: KeyObject) {
  const preimageDigest = authorityDigest({
    v: "reelier.outcome-profile-signature-preimage/v1",
    purpose,
    artifactDigest: authorityDigest(artifact),
  });
  return signAuthorityDigest(key, "authority-evidence", preimageDigest);
}

function signConformance(draft: OutcomeProfileDraftV1, report: ProfileConformanceReportV1, privateKey: KeyObject, overrides: Partial<Omit<SignedOutcomeProfileConformanceV1, "signature">> = {}): SignedOutcomeProfileConformanceV1 {
  const unsigned = {
    v: "reelier.outcome-profile-conformance/v1" as const,
    tenant: "tenant_1",
    profileDigest: authorityDigest(draft),
    packDigest: draft.packDigest,
    definitionDigest: draft.definitionDigest,
    definitionRegistrationDigest: draft.definitionRegistrationDigest,
    harnessId: report.harnessId,
    harnessDigest: report.harnessDigest,
    vectorSetDigest: draft.conformanceVectorSetDigest,
    reportDigest: authorityDigest(report),
    sourceRevision: report.sourceRevision,
    claims: report.claims,
    signerId: "certifier_1",
    ...overrides,
  };
  return { ...unsigned, signature: signProfileArtifact(unsigned, "profile-conformance", privateKey) };
}

function signActivation(draft: OutcomeProfileDraftV1, conformance: SignedOutcomeProfileConformanceV1, privateKey: KeyObject, overrides: Partial<Omit<SignedTenantProfileActivationV1, "signature">> = {}): SignedTenantProfileActivationV1 {
  const unsigned = {
    v: "reelier.outcome-profile-activation/v1" as const,
    tenant: "tenant_1",
    activationId: "activation_1",
    profileDigest: authorityDigest(draft),
    conformanceDigest: authorityDigest(conformance),
    jobCardDigest: sha("e"),
    contractDigest: OUTCOME_PROFILE_CONTRACT_V1_DIGEST,
    deploymentDigest: sha("f"),
    routeAuthorityDigest: sha("7"),
    trustHeadDigest: fixtureTrustState().trustHeadDigest,
    validFrom: "2026-08-14T11:00:00.000Z",
    validUntil: "2026-08-14T13:00:00.000Z",
    state: "activated" as const,
    signerId: "operator_1",
    ...overrides,
  };
  return { ...unsigned, signature: signProfileArtifact(unsigned, "profile-activation", privateKey) };
}

type TrustEvent = ProfileTrustPinV1["currentTrustEvents"][number];

function trustKeyDigest(signerId: string, purpose: "profile-conformance" | "profile-activation", publicKeySpkiBase64: string): string {
  return authorityDigest({ v: "reelier.outcome-profile-trust-key/v1", tenant: "tenant_1", governanceRef, signerId, purpose, publicKeySpkiBase64 });
}

function eventHead(events: readonly TrustEvent[]): string {
  let head = "";
  for (const event of events) {
    const eventDigest = authorityDigest({ v: "reelier.outcome-profile-trust-event/v1", tenant: "tenant_1", governanceRef, index: event.index, action: event.action, keyPurpose: event.keyPurpose, keyDigest: event.keyDigest, at: event.at, previousHeadDigest: event.previousHeadDigest });
    head = authorityDigest({ v: "reelier.outcome-profile-trust-head/v1", tenant: "tenant_1", governanceRef, index: event.index, previousHeadDigest: event.previousHeadDigest, eventDigest });
  }
  return head;
}

function fixtureTrustEvents(): readonly TrustEvent[] {
  const first: TrustEvent = {
    index: 0,
    action: "activate",
    keyPurpose: "profile-conformance",
    keyDigest: trustKeyDigest("certifier_1", "profile-conformance", spki(certifier.publicKey)),
    at,
    previousHeadDigest: null,
  };
  const firstHead = eventHead([first]);
  return [first, {
    index: 1,
    action: "activate",
    keyPurpose: "profile-activation",
    keyDigest: trustKeyDigest("operator_1", "profile-activation", spki(operator.publicKey)),
    at: "2026-08-14T10:01:00.000Z",
    previousHeadDigest: firstHead,
  }];
}

function fixtureTrustState(events: readonly TrustEvent[] = fixtureTrustEvents()) {
  return {
    currentTrustEvents: events,
    currentTrustEventsDigest: authorityDigest({ v: "reelier.outcome-profile-trust-events/v1", tenant: "tenant_1", governanceRef, events }),
    trustHeadDigest: eventHead(events),
  };
}

function fixtureProfileTrust(tenant: string, signerId: string, purpose: "profile-conformance" | "profile-activation", publicKey: KeyObject, events: readonly TrustEvent[] = fixtureTrustEvents()): ProfileVerificationAnchorV1 {
  return {
    tenant,
    governanceRef,
    signerId,
    purpose,
    publicKeySpkiBase64: spki(publicKey),
    ...fixtureTrustState(events),
  };
}

function fixtureTrustPin(events: readonly TrustEvent[] = fixtureTrustEvents()): ProfileTrustPinV1 {
  return {
    v: "reelier.outcome-profile-trust-pin/v1",
    tenant: "tenant_1",
    governanceRef,
    certifier: { signerId: "certifier_1", purpose: "profile-conformance", publicKeySpkiBase64: spki(certifier.publicKey) },
    operator: { signerId: "operator_1", purpose: "profile-activation", publicKeySpkiBase64: spki(operator.publicKey) },
    ...fixtureTrustState(events),
  };
}

function fixtureRoots(events: readonly TrustEvent[] = fixtureTrustEvents()) {
  return createProfileVerificationRoots([
    fixtureProfileTrust("tenant_1", "certifier_1", "profile-conformance", certifier.publicKey, events),
    fixtureProfileTrust("tenant_1", "operator_1", "profile-activation", operator.publicKey, events),
  ]);
}

function fixtureBundle() {
  const draft = fixtureDraft();
  const report = fixtureConformanceReport(draft);
  const conformance = signConformance(draft, report, certifier.privateKey);
  const activation = signActivation(draft, conformance, operator.privateKey);
  return { tenant: "tenant_1", draft, report, conformance, activation, trustRoots: fixtureRoots(), packs, now };
}

test("profile governance requires independent conformance and tenant activation", () => {
  const draft = fixtureDraft();
  const report = fixtureConformanceReport(draft);
  const conformance = signConformance(draft, report, certifier.privateKey);
  const activation = signActivation(draft, conformance, operator.privateKey);
  const roots = createProfileVerificationRoots([
    fixtureProfileTrust("tenant_1", "certifier_1", "profile-conformance", certifier.publicKey),
    fixtureProfileTrust("tenant_1", "operator_1", "profile-activation", operator.publicKey),
  ]);

  const verified = verifyProfileGovernanceOffline({
    tenant: "tenant_1",
    draft,
    report,
    conformance,
    activation,
    trustRoots: roots,
    packs: createFirstPartyPackRegistry(),
    now: new Date("2026-08-14T12:00:00.000Z"),
  });

  assert.equal(verified.profileDigest, authorityDigest(draft));
  assert.equal(verified.conformanceStatus, "verified");
  assert.equal(verified.activationStatus, "verified");
  assert.equal(verified.authorization, "not-conferred");
  assert.equal(verified.dispatchable, false);
  assert.equal(Object.isFrozen(verified), true);
  assert.deepEqual(Reflect.ownKeys(verified), ["v", "profileDigest", "conformanceReportDigest", "conformanceDigest", "activationDigest", "trustPinDigest", "trustHeadDigest", "verifiedAt", "verificationScope", "conformanceStatus", "activationStatus", "authorization", "dispatchable"]);
});

test("closed profile parsers reject extra, accessor, symbol, and prototype-bearing input", () => {
  const draft = fixtureDraft();
  const report = fixtureConformanceReport(draft);
  const cases: readonly [string, () => unknown][] = [
    ["draft extra", () => parseOutcomeProfileDraft({ ...draft, extra: true })],
    ["report extra", () => parseProfileConformanceReport({ ...report, extra: true })],
    ["draft accessor", () => parseOutcomeProfileDraft(Object.defineProperty({ ...draft }, "provider", { enumerable: true, get() { throw new Error("getter ran"); } }))],
    ["report accessor", () => parseProfileConformanceReport(Object.defineProperty({ ...report }, "checks", { enumerable: true, get() { throw new Error("getter ran"); } }))],
    ["draft symbol", () => parseOutcomeProfileDraft(Object.assign({ ...draft }, { [Symbol("extra")]: true }))],
    ["report symbol", () => parseProfileConformanceReport(Object.assign({ ...report }, { [Symbol("extra")]: true }))],
    ["draft prototype", () => parseOutcomeProfileDraft(Object.assign(Object.create({ inherited: true }), draft))],
  ];
  for (const [name, run] of cases) assert.throws(run, TypeError, name);
});

test("all governance artifact parsers return detached frozen records", () => {
  const bundle = fixtureBundle();
  const trustPin = fixtureTrustPin();
  const manifest: ProfileGovernanceManifestV1 = {
    v: "reelier.outcome-profile-governance-manifest/v1",
    tenant: "tenant_1",
    governanceRef,
    profileDigest: authorityDigest(bundle.draft),
    conformanceDigest: authorityDigest(bundle.conformance),
    activationDigest: authorityDigest(bundle.activation),
    conformanceReportDigest: authorityDigest(bundle.report),
    trustPinDigest: authorityDigest(trustPin),
    trustHeadDigest: trustPin.trustHeadDigest,
  };
  const cases = [
    parseOutcomeProfileDraft(bundle.draft),
    parseProfileConformanceReport(bundle.report),
    parseSignedOutcomeProfileConformance(bundle.conformance),
    parseSignedTenantProfileActivation(bundle.activation),
    parseProfileTrustPin(trustPin),
    parseProfileGovernanceManifest(manifest),
  ];
  for (const parsed of cases) {
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
    assert.notEqual(parsed, [bundle.draft, bundle.report, bundle.conformance, bundle.activation, trustPin, manifest][cases.indexOf(parsed)]);
  }
});

test("governance refuses missing artifacts and reordered report evidence", () => {
  const bundle = fixtureBundle();
  const reorderedReport = { ...bundle.report, checks: [...bundle.report.checks].reverse() };
  for (const [name, mutation] of [
    ["absent report", { report: undefined }],
    ["reordered report", { report: reorderedReport }],
    ["absent certification", { conformance: undefined }],
    ["absent activation", { activation: undefined }],
  ] as const) assert.throws(() => verifyProfileGovernanceOffline({ ...bundle, ...mutation } as never), TypeError, name);
});

test("governance refuses role confusion, SPKI reuse, and self-signed init authority", () => {
  const bundle = fixtureBundle();
  const conformanceByOperator = signConformance(bundle.draft, bundle.report, operator.privateKey);
  const activationByCertifier = signActivation(bundle.draft, bundle.conformance, certifier.privateKey);
  const conformanceByInit = signConformance(bundle.draft, bundle.report, init.privateKey);
  assert.throws(() => verifyProfileGovernanceOffline({ ...bundle, conformance: conformanceByOperator }), TypeError);
  assert.throws(() => verifyProfileGovernanceOffline({ ...bundle, activation: activationByCertifier }), TypeError);
  assert.throws(() => verifyProfileGovernanceOffline({ ...bundle, conformance: conformanceByInit }), TypeError);
  assert.throws(() => createProfileVerificationRoots([
    fixtureProfileTrust("tenant_1", "certifier_1", "profile-conformance", certifier.publicKey),
    fixtureProfileTrust("tenant_1", "operator_1", "profile-activation", certifier.publicKey),
  ]), TypeError);
  assert.throws(() => createProfileVerificationRoots([
    fixtureProfileTrust("tenant_1", "operator_1", "profile-conformance", operator.publicKey),
    fixtureProfileTrust("tenant_1", "certifier_1", "profile-activation", certifier.publicKey),
  ]), TypeError);
});

test("every profile, registration, vector, report, evidence, and trust join is substitution-resistant", () => {
  const base = fixtureBundle();
  const mutations: readonly [string, () => Parameters<typeof verifyProfileGovernanceOffline>[0]][] = [
    ["profile", () => ({ ...base, draft: { ...base.draft, accountProbeDigest: sha("a") } })],
    ["pack", () => ({ ...base, draft: { ...base.draft, packDigest: sha("a") } })],
    ["definition", () => ({ ...base, draft: { ...base.draft, definitionDigest: sha("a") } })],
    ["registration", () => ({ ...base, draft: { ...base.draft, definitionRegistrationDigest: sha("a") } })],
    ["vector", () => ({ ...base, report: { ...base.report, vectorSetDigest: sha("a") } })],
    ["report", () => ({ ...base, report: { ...base.report, sourceRevision: "substituted" } })],
    ["evidence", () => ({ ...base, report: { ...base.report, checks: base.report.checks.map((check: ProfileConformanceReportV1["checks"][number], index: number) => index === 0 ? { ...check, evidenceDigest: sha("a") } : check) } })],
    ["trust head", () => ({ ...base, activation: signActivation(base.draft, base.conformance, operator.privateKey, { trustHeadDigest: sha("a") }) })],
  ];
  for (const [name, mutation] of mutations) assert.throws(() => verifyProfileGovernanceOffline(mutation()), TypeError, name);
});

test("failed or unchecked conformance claims cannot be upgraded by the tenant operator", () => {
  for (const status of ["failed", "unchecked"] as const) {
    const draft = fixtureDraft();
    const report = { ...fixtureConformanceReport(draft), claims: { ...fixtureConformanceReport(draft).claims, closure: status } };
    const conformance = signConformance(draft, report, certifier.privateKey);
    const activation = signActivation(draft, conformance, operator.privateKey);
    assert.throws(() => verifyProfileGovernanceOffline({ tenant: "tenant_1", draft, report, conformance, activation, trustRoots: fixtureRoots(), packs, now }), TypeError);

    const verifiedReport = fixtureConformanceReport(draft);
    const downgraded = signConformance(draft, verifiedReport, certifier.privateKey, { claims: { ...verifiedReport.claims, determinism: status } });
    const operatorAttempt = signActivation(draft, downgraded, operator.privateKey);
    assert.throws(() => verifyProfileGovernanceOffline({ tenant: "tenant_1", draft, report: verifiedReport, conformance: downgraded, activation: operatorAttempt, trustRoots: fixtureRoots(), packs, now }), TypeError);
  }
});

test("activation must be current, active, and bound to the verification tenant", () => {
  const base = fixtureBundle();
  const variants = [
    signActivation(base.draft, base.conformance, operator.privateKey, { state: "revoked" }),
    signActivation(base.draft, base.conformance, operator.privateKey, { validUntil: "2026-08-14T11:59:59.999Z" }),
    signActivation(base.draft, base.conformance, operator.privateKey, { validFrom: "2026-08-14T12:00:00.001Z" }),
    signActivation(base.draft, base.conformance, operator.privateKey, { tenant: "tenant_2" }),
  ];
  for (const activation of variants) assert.throws(() => verifyProfileGovernanceOffline({ ...base, activation }), TypeError);
});

test("trust replay refuses every invalid transition and linkage mutation", () => {
  const valid = fixtureTrustEvents();
  const certifierDigest = valid[0].keyDigest;
  const operatorDigest = valid[1].keyDigest;
  const linked = (events: readonly Omit<TrustEvent, "previousHeadDigest">[]): readonly TrustEvent[] => {
    const result: TrustEvent[] = [];
    for (const event of events) result.push({ ...event, previousHeadDigest: result.length === 0 ? null : eventHead(result) });
    return result;
  };
  const cases: readonly [string, readonly TrustEvent[]][] = [
    ["empty", []],
    ["duplicate activation", linked([valid[0], { ...valid[1], index: 1 }, { ...valid[0], index: 2, at: "2026-08-14T10:02:00.000Z" }])],
    ["revoke before activate", linked([{ index: 0, action: "revoke", keyPurpose: "profile-conformance", keyDigest: certifierDigest, at }])],
    ["reactivation after revoke", linked([valid[0], valid[1], { index: 2, action: "revoke", keyPurpose: "profile-activation", keyDigest: operatorDigest, at: "2026-08-14T10:02:00.000Z" }, { index: 3, action: "activate", keyPurpose: "profile-activation", keyDigest: operatorDigest, at: "2026-08-14T10:03:00.000Z" }])],
    ["unknown key", linked([{ ...valid[0], keyDigest: sha("a") }, { ...valid[1], index: 1 }])],
    ["unknown purpose", linked([{ ...valid[0], keyPurpose: "profile-other" as never }, { ...valid[1], index: 1 }])],
    ["missing index", linked([{ ...valid[0], index: 0 }, { ...valid[1], index: 2 }])],
    ["reordered", [valid[1], valid[0]]],
    ["time regression", linked([{ ...valid[0], at: "2026-08-14T10:01:00.000Z" }, { ...valid[1], index: 1, at }])],
    ["future event", linked([valid[0], { ...valid[1], index: 1, at: "2026-08-14T12:00:00.001Z" }])],
    ["alternate previous head", [valid[0], { ...valid[1], previousHeadDigest: sha("a") }]],
    ["declared events digest", valid],
    ["declared head digest", valid],
    ["inactive final key", linked([valid[0], valid[1], { index: 2, action: "revoke", keyPurpose: "profile-activation", keyDigest: operatorDigest, at: "2026-08-14T10:02:00.000Z" }])],
  ];
  for (const [name, events] of cases) {
    const anchors = [
      fixtureProfileTrust("tenant_1", "certifier_1", "profile-conformance", certifier.publicKey, events),
      fixtureProfileTrust("tenant_1", "operator_1", "profile-activation", operator.publicKey, events),
    ];
    if (name === "declared events digest") for (let index = 0; index < anchors.length; index++) anchors[index] = { ...anchors[index], currentTrustEventsDigest: sha("a") };
    if (name === "declared head digest") for (let index = 0; index < anchors.length; index++) anchors[index] = { ...anchors[index], trustHeadDigest: sha("a") };
    assert.throws(() => {
      const trustRoots = createProfileVerificationRoots(anchors);
      verifyProfileGovernanceOffline({ ...fixtureBundle(), trustRoots });
    }, name === "declared events digest" ? /profile trust events digest mismatch/ : name === "declared head digest" ? /profile trust final head is not admissible/ : TypeError, name);
  }
});

test("a caller-self-authored verification is inert and cannot become host admission", async () => {
  const verified = verifyProfileGovernanceOffline(fixtureBundle());
  assert.deepEqual({ authorization: verified.authorization, dispatchable: verified.dispatchable, verificationScope: verified.verificationScope }, { authorization: "not-conferred", dispatchable: false, verificationScope: "caller-supplied-roots" });
  assert.equal(Object.getOwnPropertySymbols(verified).length, 0);
  assert.equal("governance" in verified, false);
  assert.equal("admitted" in verified, false);
  for (const candidate of [verified, { ...verified }, Object.freeze({ ...verified })]) {
    assert.equal(Object.getOwnPropertySymbols(candidate).length, 0);
    assert.equal(candidate.authorization, "not-conferred");
    assert.equal(candidate.dispatchable, false);
  }
  const publicAuthority = await import("../../src/authority/index.js");
  for (const forbidden of ["assertAdmittedProfileGovernance", "createAdmittedProfileGovernance", "loadProfileGovernanceFromOperatorTrust"]) assert.equal(forbidden in publicAuthority, false);
});

test("offline verification captures one intrinsic epoch without invoking caller Date methods", () => {
  let subclassCalls = 0;
  class AdversarialDate extends Date {
    override getTime(): number { subclassCalls++; throw new Error("subclass getTime invoked"); }
    override toISOString(): string { subclassCalls++; throw new Error("subclass toISOString invoked"); }
  }
  const subclassDate = new AdversarialDate("2026-08-14T12:00:00.000Z");
  const subclassVerified = verifyProfileGovernanceOffline({ ...fixtureBundle(), now: subclassDate });
  assert.equal(subclassVerified.verifiedAt, "2026-08-14T12:00:00.000Z");
  assert.equal(subclassCalls, 0);

  let ownCalls = 0;
  const ownMethodDate = new Date("2026-08-14T12:00:00.000Z");
  Object.defineProperties(ownMethodDate, {
    getTime: { value: () => { ownCalls++; throw new Error("own getTime invoked"); } },
    toISOString: { value: () => { ownCalls++; throw new Error("own toISOString invoked"); } },
  });
  const ownVerified = verifyProfileGovernanceOffline({ ...fixtureBundle(), now: ownMethodDate });
  assert.equal(ownVerified.verifiedAt, "2026-08-14T12:00:00.000Z");
  assert.equal(ownCalls, 0);
});

test("canonical profile artifacts contain no hidden data after parsing", () => {
  const parsed = parseOutcomeProfileDraft(fixtureDraft());
  assert.deepEqual(JSON.parse(authorityCanonicalBytes(parsed).toString("utf8")), parsed);
  assert.equal(Object.isFrozen(parsed.nonClaims), true);
});

test("inert parsers reject impossible canonical times and reused trust keys", () => {
  const bundle = fixtureBundle();
  assert.throws(() => parseSignedTenantProfileActivation({ ...bundle.activation, validFrom: "2026-02-31T11:00:00.000Z" }), TypeError);
  assert.throws(() => parseSignedTenantProfileActivation({ ...bundle.activation, validFrom: bundle.activation.validUntil }), TypeError);
  const pin = fixtureTrustPin();
  assert.throws(() => parseProfileTrustPin({ ...pin, currentTrustEvents: pin.currentTrustEvents.map((event, index) => index === 0 ? { ...event, at: "2026-02-31T10:00:00.000Z" } : event) }), TypeError);
  assert.throws(() => parseProfileTrustPin({ ...pin, operator: { ...pin.operator, publicKeySpkiBase64: pin.certifier.publicKeySpkiBase64 } }), TypeError);
});

test("deployment, stable route scope, and signed Authority binding are closed independent artifacts", () => {
  profileGovernanceFixture();
  const scope: AuthorityRouteScopeV1 = { v: "reelier.authority-route-scope/v1", tenant: "tenant_1", definitionAlias: "github_issue_labels", connectorRegistrationDigest: sha("1"), operatorConfigurationDigest: sha("2"), routeDigest: sha("3"), providerId: "github", connectorId: "github", accountId: "acct", providerAccountIdentity: "github:acct", endpointId: "github.write", credentialSlotId: "slot", sourceReadRouteDigest: sha("4"), projectionSchemaDigest: sha("5") };
  const deployment: AuthorityDeploymentSnapshotV1 = { v: "reelier.authority-deployment-snapshot/v1", tenant: "tenant_1", jobCardDigest: sha("6"), jobCardAuthorityDigest: sha("7"), authorityStateDigest: sha("8"), connectorRegistryDigest: sha("9"), trustRootSetDigest: sha("a"), connectionDescriptorsDigest: sha("b"), connectionAdoptionsDigest: sha("c"), enforcementDigest: sha("d"), routeScopeDigest: authorityDigest(scope) };
  const binding: SignedProfileAuthorityBindingV1 = { v: "reelier.profile-authority-binding/v1", purpose: "profile-authority-binding", tenant: "tenant_1", profileDigest: sha("1"), activationDigest: sha("2"), innerReceiptDigest: sha("3"), jobCardDigest: sha("4"), artifactKeyBindingDigest: sha("5"), artifactKeyBindingCommitmentDigest: sha("6"), contractDigest: sha("7"), deploymentDigest: authorityDigest(deployment), routeScopeDigest: authorityDigest(scope), routeAuthoritySnapshotDigest: sha("8"), authorityTrustHeadDigest: sha("9"), observedAt: "2026-08-14T12:00:00.000Z", signerId: "evidence_1", signature: { alg: "ed25519", sig: Buffer.alloc(64).toString("base64") } };
  assert.deepEqual(parseAuthorityRouteScope(scope), scope);
  assert.deepEqual(parseAuthorityDeploymentSnapshot(deployment), deployment);
  assert.deepEqual(parseSignedProfileAuthorityBinding(binding), binding);
  for (const parse of [parseAuthorityRouteScope, parseAuthorityDeploymentSnapshot, parseSignedProfileAuthorityBinding] as const) assert.throws(() => parse({ extra: true } as never), /closed|unknown|missing/i);
});
