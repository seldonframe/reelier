import { createPublicKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { ValidateFunction } from "ajv";
import type { AuthoritySignature, ClaimStatus } from "./types.js";
import type { StaticPackRegistry } from "./pack.js";
import { definitionRegistrationDigest, lookupStaticPackDefinition } from "./pack.js";
import { verifyAuthoritySignature } from "./crypto.js";
import { authorityCanonicalBytes, authorityDigest } from "./wire.js";
import { OUTCOME_PROFILE_CONTRACT_V1_DIGEST } from "./outcome-profile-contract.js";
export { OUTCOME_PROFILE_CONTRACT_V1_DIGEST } from "./outcome-profile-contract.js";

export interface OutcomeProfileDraftV1 {
  readonly v: "reelier.outcome-profile-draft/v1";
  readonly profileId: string;
  readonly profileVersion: string;
  readonly status: "draft";
  readonly authorization: "absent";
  readonly conformance: "unchecked";
  readonly dispatchable: false;
  readonly provider: string;
  readonly packAlias: string;
  readonly packDigest: string;
  readonly definitionDigest: string;
  readonly definitionRegistrationDigest: string;
  readonly accountProbeDigest: string;
  readonly sourceAuthorityDigest: string;
  readonly argumentAuthorityDigest: string;
  readonly semanticIdentityDigest: string;
  readonly responseSemanticsProfileDigest: string;
  readonly reconciliationRecipeDigest: string;
  readonly topologyRequirementsDigest: string;
  readonly conformanceVectorSetDigest: string;
  readonly nonClaims: Readonly<{
    contentCorrectness: "not-proved";
    providerCertification: "not-proved";
    safety: "not-proved";
    trafficCompleteness: "not-proved";
  }>;
}

interface ProfileClaimsV1 {
  readonly closure: ClaimStatus;
  readonly determinism: ClaimStatus;
  readonly accountBinding: ClaimStatus;
  readonly noSecrets: ClaimStatus;
  readonly reconciliation: ClaimStatus;
}

export interface SignedOutcomeProfileConformanceV1 {
  readonly v: "reelier.outcome-profile-conformance/v1";
  readonly tenant: string;
  readonly profileDigest: string;
  readonly packDigest: string;
  readonly definitionDigest: string;
  readonly definitionRegistrationDigest: string;
  readonly harnessId: string;
  readonly harnessDigest: string;
  readonly vectorSetDigest: string;
  readonly reportDigest: string;
  readonly sourceRevision: string;
  readonly claims: Readonly<ProfileClaimsV1>;
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}

export interface ProfileConformanceReportV1 {
  readonly v: "reelier.outcome-profile-conformance-report/v1";
  readonly profileDigest: string;
  readonly packDigest: string;
  readonly definitionDigest: string;
  readonly definitionRegistrationDigest: string;
  readonly harnessId: string;
  readonly harnessDigest: string;
  readonly vectorSetDigest: string;
  readonly sourceRevision: string;
  readonly checks: readonly Readonly<{ checkId: string; vectorDigest: string; status: "passed" | "failed"; evidenceDigest: string }>[];
  readonly claims: Readonly<ProfileClaimsV1>;
}

export interface SignedTenantProfileActivationV1 {
  readonly v: "reelier.outcome-profile-activation/v1";
  readonly tenant: string;
  readonly activationId: string;
  readonly profileDigest: string;
  readonly conformanceDigest: string;
  readonly jobCardDigest: string;
  readonly contractDigest: string;
  readonly deploymentDigest: string;
  readonly routeScopeDigest: string;
  readonly trustHeadDigest: string;
  readonly authorityTrustHeadDigest: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly state: "activated" | "revoked";
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}

export interface AuthorityRouteScopeV1 {
  readonly v: "reelier.authority-route-scope/v1";
  readonly tenant: string;
  readonly definitionAlias: string;
  readonly connectorRegistrationDigest: string;
  readonly operatorConfigurationDigest: string;
  readonly routeDigest: string;
  readonly providerId: string;
  readonly connectorId: string;
  readonly accountId: string;
  readonly providerAccountIdentity: string;
  readonly endpointId: string;
  readonly credentialSlotId: string;
  readonly sourceReadRouteDigest: string;
  readonly projectionSchemaDigest: string;
}

export interface AuthorityDeploymentSnapshotV1 {
  readonly v: "reelier.authority-deployment-snapshot/v1";
  readonly tenant: string;
  readonly jobCardDigest: string;
  readonly jobCardAuthorityDigest: string;
  readonly authorityStateDigest: string;
  readonly connectorRegistryDigest: string;
  readonly trustRootSetDigest: string;
  readonly connectionDescriptorsDigest: string;
  readonly connectionAdoptionsDigest: string;
  readonly enforcementDigest: string;
  readonly routeScopeDigest: string;
}

export interface SignedProfileAuthorityBindingV1 {
  readonly v: "reelier.profile-authority-binding/v1";
  readonly purpose: "profile-authority-binding";
  readonly tenant: string;
  readonly profileDigest: string;
  readonly activationDigest: string;
  readonly innerReceiptDigest: string;
  readonly jobCardDigest: string;
  readonly artifactKeyBindingDigest: string;
  readonly artifactKeyBindingCommitmentDigest: string;
  readonly contractDigest: string;
  readonly deploymentDigest: string;
  readonly routeScopeDigest: string;
  readonly routeAuthoritySnapshotDigest: string;
  readonly authorityTrustHeadDigest: string;
  readonly observedAt: string;
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}

export type ProfileTrustPurposeV1 = "profile-conformance" | "profile-activation";
export interface ProfileTrustEventV1 {
  readonly index: number;
  readonly action: "activate" | "revoke";
  readonly keyPurpose: ProfileTrustPurposeV1;
  readonly keyDigest: string;
  readonly at: string;
  readonly previousHeadDigest: string | null;
}

export interface ProfileTrustPinV1 {
  readonly v: "reelier.outcome-profile-trust-pin/v1";
  readonly tenant: string;
  readonly governanceRef: string;
  readonly certifier: Readonly<{ signerId: string; purpose: "profile-conformance"; publicKeySpkiBase64: string }>;
  readonly operator: Readonly<{ signerId: string; purpose: "profile-activation"; publicKeySpkiBase64: string }>;
  readonly currentTrustEvents: readonly Readonly<ProfileTrustEventV1>[];
  readonly currentTrustEventsDigest: string;
  readonly trustHeadDigest: string;
}

export interface ProfileGovernanceManifestV1 {
  readonly v: "reelier.outcome-profile-governance-manifest/v1";
  readonly tenant: string;
  readonly governanceRef: string;
  readonly profileDigest: string;
  readonly conformanceDigest: string;
  readonly activationDigest: string;
  readonly conformanceReportDigest: string;
  readonly trustPinDigest: string;
  readonly trustHeadDigest: string;
}

export interface ProfileGovernanceVerificationV1 {
  readonly v: "reelier.outcome-profile-verification/v1";
  readonly profileDigest: string;
  readonly conformanceReportDigest: string;
  readonly conformanceDigest: string;
  readonly activationDigest: string;
  readonly trustPinDigest: string;
  readonly trustHeadDigest: string;
  readonly verifiedAt: string;
  readonly verificationScope: "caller-supplied-roots";
  readonly conformanceStatus: "verified";
  readonly activationStatus: "verified";
  readonly authorization: "not-conferred";
  readonly dispatchable: false;
}

export interface ProfileVerificationAnchorV1 {
  readonly tenant: string;
  readonly governanceRef: string;
  readonly signerId: string;
  readonly purpose: ProfileTrustPurposeV1;
  readonly publicKeySpkiBase64: string;
  readonly currentTrustEvents: readonly Readonly<ProfileTrustEventV1>[];
  readonly currentTrustEventsDigest: string;
  readonly trustHeadDigest: string;
}

declare const profileVerificationRootsBrand: unique symbol;
export interface ProfileVerificationRootsV1 { readonly [profileVerificationRootsBrand]: true }

interface ProfileVerificationRootState {
  readonly pin: ProfileTrustPinV1;
  readonly certifierKey: KeyObject;
  readonly operatorKey: KeyObject;
}

export interface ProfileGovernanceVerificationInputV1 {
  readonly tenant: string;
  readonly draft: OutcomeProfileDraftV1;
  readonly report: ProfileConformanceReportV1;
  readonly conformance: SignedOutcomeProfileConformanceV1;
  readonly activation: SignedTenantProfileActivationV1;
  readonly trustRoots: ProfileVerificationRootsV1;
  readonly packs: StaticPackRegistry;
  readonly now: Date;
}

type ProfileSchemaName = "profile-draft" | "profile-conformance-report" | "profile-conformance" | "profile-activation" | "profile-authority-evidence" | "profile-trust-pin" | "profile-governance-manifest";
const profileVerificationRootStates = new WeakMap<object, ProfileVerificationRootState>();
const validators = new Map<ProfileSchemaName, ValidateFunction>();
const authorityDirectory = dirname(fileURLToPath(import.meta.url));
const schemaDirectories = [
  join(authorityDirectory, "../../contract/outcome-profile/v1"),
  join(authorityDirectory, "../../../contract/outcome-profile/v1"),
];
const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020").default as new (options: object) => { compile(schema: object): ValidateFunction; errorsText(errors: unknown, options: { separator: string }): string };
const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });

export function parseOutcomeProfileDraft(value: unknown): OutcomeProfileDraftV1 { return parseProfileSchema("profile-draft", value); }
export function parseProfileConformanceReport(value: unknown): ProfileConformanceReportV1 { return parseProfileSchema("profile-conformance-report", value); }
export function parseSignedOutcomeProfileConformance(value: unknown): SignedOutcomeProfileConformanceV1 { return parseProfileSchema("profile-conformance", value); }
export function parseSignedTenantProfileActivation(value: unknown): SignedTenantProfileActivationV1 {
  const parsed = parseProfileSchema<SignedTenantProfileActivationV1>("profile-activation", value);
  if (parseCanonicalTime(parsed.validUntil) <= parseCanonicalTime(parsed.validFrom)) throw new TypeError("profile activation validity interval is invalid");
  return parsed;
}
export function parseAuthorityRouteScope(value: unknown): AuthorityRouteScopeV1 {
  return parseClosedDigestRecord(value, "authority route scope", ["v", "tenant", "definitionAlias", "connectorRegistrationDigest", "operatorConfigurationDigest", "routeDigest", "providerId", "connectorId", "accountId", "providerAccountIdentity", "endpointId", "credentialSlotId", "sourceReadRouteDigest", "projectionSchemaDigest"], "reelier.authority-route-scope/v1") as unknown as AuthorityRouteScopeV1;
}
export function parseAuthorityDeploymentSnapshot(value: unknown): AuthorityDeploymentSnapshotV1 {
  return parseClosedDigestRecord(value, "authority deployment snapshot", ["v", "tenant", "jobCardDigest", "jobCardAuthorityDigest", "authorityStateDigest", "connectorRegistryDigest", "trustRootSetDigest", "connectionDescriptorsDigest", "connectionAdoptionsDigest", "enforcementDigest", "routeScopeDigest"], "reelier.authority-deployment-snapshot/v1") as unknown as AuthorityDeploymentSnapshotV1;
}
export function parseSignedProfileAuthorityBinding(value: unknown): SignedProfileAuthorityBindingV1 {
  const parsed = parseProfileSchema<SignedProfileAuthorityBindingV1>("profile-authority-evidence", value);
  parseCanonicalTime(parsed.observedAt);
  return parsed;
}
export function parseProfileTrustPin(value: unknown): ProfileTrustPinV1 {
  const parsed = parseProfileSchema<ProfileTrustPinV1>("profile-trust-pin", value);
  for (const event of parsed.currentTrustEvents) parseCanonicalTime(event.at);
  parseEd25519PublicKey(parsed.certifier.publicKeySpkiBase64);
  parseEd25519PublicKey(parsed.operator.publicKeySpkiBase64);
  if (parsed.certifier.publicKeySpkiBase64 === parsed.operator.publicKeySpkiBase64) throw new TypeError("profile certifier and operator SPKI commitments must be distinct");
  return parsed;
}
export function parseProfileGovernanceManifest(value: unknown): ProfileGovernanceManifestV1 { return parseProfileSchema("profile-governance-manifest", value); }

export function createProfileVerificationRoots(input: readonly ProfileVerificationAnchorV1[]): ProfileVerificationRootsV1 {
  assertOwnDataTree(input, "profile verification anchors");
  if (!Array.isArray(input) || input.length !== 2) throw new TypeError("profile verification roots require exactly one certifier and one operator anchor");
  const anchors = input.map(parseAnchor);
  const certifier = anchors.find(anchor => anchor.purpose === "profile-conformance");
  const operator = anchors.find(anchor => anchor.purpose === "profile-activation");
  if (!certifier || !operator) throw new TypeError("profile verification roots require distinct purposes");
  if (certifier.tenant !== operator.tenant || certifier.governanceRef !== operator.governanceRef) throw new TypeError("profile verification roots disagree on governance identity");
  if (!authorityCanonicalBytes(certifier.currentTrustEvents).equals(authorityCanonicalBytes(operator.currentTrustEvents)) || certifier.currentTrustEventsDigest !== operator.currentTrustEventsDigest || certifier.trustHeadDigest !== operator.trustHeadDigest) throw new TypeError("profile verification roots disagree on trust replay");
  if (certifier.publicKeySpkiBase64 === operator.publicKeySpkiBase64) throw new TypeError("profile certifier and operator SPKI commitments must be distinct");
  const pin = parseProfileTrustPin({
    v: "reelier.outcome-profile-trust-pin/v1",
    tenant: certifier.tenant,
    governanceRef: certifier.governanceRef,
    certifier: { signerId: certifier.signerId, purpose: certifier.purpose, publicKeySpkiBase64: certifier.publicKeySpkiBase64 },
    operator: { signerId: operator.signerId, purpose: operator.purpose, publicKeySpkiBase64: operator.publicKeySpkiBase64 },
    currentTrustEvents: certifier.currentTrustEvents,
    currentTrustEventsDigest: certifier.currentTrustEventsDigest,
    trustHeadDigest: certifier.trustHeadDigest,
  });
  replayProfileTrust(pin);
  const certifierKey = parseEd25519PublicKey(pin.certifier.publicKeySpkiBase64);
  const operatorKey = parseEd25519PublicKey(pin.operator.publicKeySpkiBase64);
  const roots = Object.freeze(Object.create(null)) as ProfileVerificationRootsV1;
  profileVerificationRootStates.set(roots, Object.freeze({ pin, certifierKey, operatorKey }));
  return roots;
}

export function verifyProfileGovernanceOffline(input: ProfileGovernanceVerificationInputV1): ProfileGovernanceVerificationV1 {
  const values = exactInput(input);
  const state = profileVerificationRootStates.get(values.trustRoots as object);
  if (!state) throw new TypeError("unrecognized caller-supplied profile verification roots");
  let verificationEpoch: number;
  try { verificationEpoch = Date.prototype.getTime.call(values.now); }
  catch { throw new TypeError("profile verification time is invalid"); }
  if (!Number.isFinite(verificationEpoch)) throw new TypeError("profile verification time is invalid");
  const verifiedAt = new Date(verificationEpoch).toISOString();
  const draft = parseOutcomeProfileDraft(values.draft);
  const report = parseProfileConformanceReport(values.report);
  const conformance = parseSignedOutcomeProfileConformance(values.conformance);
  const activation = parseSignedTenantProfileActivation(values.activation);
  if (values.tenant !== state.pin.tenant || conformance.tenant !== values.tenant || activation.tenant !== values.tenant) throw new TypeError("profile governance tenant mismatch");
  replayProfileTrust(state.pin, verificationEpoch);

  const definition = lookupStaticPackDefinition(values.packs, draft.packAlias);
  if (!definition || definition.packDigest !== draft.packDigest || definition.definitionDigest !== draft.definitionDigest || definitionRegistrationDigest(values.packs, draft.packAlias) !== draft.definitionRegistrationDigest) throw new TypeError("profile does not join the installed first-party pack registration");
  const profileDigest = authorityDigest(draft);
  const reportDigest = authorityDigest(report);
  if (report.profileDigest !== profileDigest || report.packDigest !== draft.packDigest || report.definitionDigest !== draft.definitionDigest || report.definitionRegistrationDigest !== draft.definitionRegistrationDigest || report.vectorSetDigest !== draft.conformanceVectorSetDigest) throw new TypeError("profile conformance report linkage mismatch");
  assertConformanceReport(report);
  if (conformance.profileDigest !== profileDigest || conformance.packDigest !== draft.packDigest || conformance.definitionDigest !== draft.definitionDigest || conformance.definitionRegistrationDigest !== draft.definitionRegistrationDigest || conformance.harnessId !== report.harnessId || conformance.harnessDigest !== report.harnessDigest || conformance.vectorSetDigest !== report.vectorSetDigest || conformance.reportDigest !== reportDigest || conformance.sourceRevision !== report.sourceRevision || !authorityCanonicalBytes(conformance.claims).equals(authorityCanonicalBytes(report.claims))) throw new TypeError("signed profile conformance linkage mismatch");
  assertVerifiedClaims(conformance.claims);
  if (conformance.signerId !== state.pin.certifier.signerId || !verifyProfileSignature(state.certifierKey, "profile-conformance", conformance)) throw new TypeError("profile conformance signature is invalid");

  const conformanceDigest = authorityDigest(conformance);
  if (activation.profileDigest !== profileDigest || activation.conformanceDigest !== conformanceDigest || activation.trustHeadDigest !== state.pin.trustHeadDigest) throw new TypeError("profile activation linkage mismatch");
  if (activation.state !== "activated" || parseCanonicalTime(activation.validFrom) > verificationEpoch || parseCanonicalTime(activation.validUntil) < verificationEpoch || parseCanonicalTime(activation.validUntil) <= parseCanonicalTime(activation.validFrom)) throw new TypeError("profile activation is not current and active");
  if (activation.signerId !== state.pin.operator.signerId || !verifyProfileSignature(state.operatorKey, "profile-activation", activation)) throw new TypeError("profile activation signature is invalid");

  return deepFreeze({
    v: "reelier.outcome-profile-verification/v1",
    profileDigest,
    conformanceReportDigest: reportDigest,
    conformanceDigest,
    activationDigest: authorityDigest(activation),
    trustPinDigest: authorityDigest(state.pin),
    trustHeadDigest: state.pin.trustHeadDigest,
    verifiedAt,
    verificationScope: "caller-supplied-roots",
    conformanceStatus: "verified",
    activationStatus: "verified",
    authorization: "not-conferred",
    dispatchable: false,
  });
}

function parseProfileSchema<T>(name: ProfileSchemaName, value: unknown): T {
  assertOwnDataTree(value, name);
  let validate = validators.get(name);
  if (!validate) {
    let schemaText: string | undefined;
    for (const directory of schemaDirectories) {
      try { schemaText = readFileSync(join(directory, `${name}.schema.json`), "utf8"); break; }
      catch {}
    }
    if (schemaText === undefined) throw new TypeError(`missing ${name} schema from Outcome Profile Contract ${OUTCOME_PROFILE_CONTRACT_V1_DIGEST}`);
    validate = ajv.compile(JSON.parse(schemaText) as object);
    validators.set(name, validate);
  }
  if (!validate(value)) throw new TypeError(`invalid closed ${name}: ${ajv.errorsText(validate.errors, { separator: "; " })}`);
  return deepFreeze(JSON.parse(authorityCanonicalBytes(value).toString("utf8")) as T);
}

function parseAnchor(value: ProfileVerificationAnchorV1): ProfileVerificationAnchorV1 {
  const keys = ["tenant", "governanceRef", "signerId", "purpose", "publicKeySpkiBase64", "currentTrustEvents", "currentTrustEventsDigest", "trustHeadDigest"];
  assertExactKeys(value, keys, "profile verification anchor");
  if (typeof value.tenant !== "string" || typeof value.governanceRef !== "string" || typeof value.signerId !== "string" || (value.purpose !== "profile-conformance" && value.purpose !== "profile-activation") || typeof value.publicKeySpkiBase64 !== "string" || !Array.isArray(value.currentTrustEvents) || typeof value.currentTrustEventsDigest !== "string" || typeof value.trustHeadDigest !== "string") throw new TypeError("profile verification anchor is invalid");
  return deepFreeze(JSON.parse(authorityCanonicalBytes(value).toString("utf8")) as ProfileVerificationAnchorV1);
}

function parseClosedDigestRecord(value: unknown, label: string, keys: readonly string[], version: string): Readonly<Record<string, string>> {
  assertOwnDataTree(value, label);
  assertExactKeys(value, keys, label);
  if (value.v !== version) throw new TypeError(`${label} version is invalid`);
  for (const key of keys) {
    const member = value[key];
    if (typeof member !== "string" || member.length === 0) throw new TypeError(`${label} ${key} is invalid`);
    if (key.endsWith("Digest") && !/^sha256:(?!0{64}$)[0-9a-f]{64}$/.test(member)) throw new TypeError(`${label} ${key} is invalid`);
  }
  return deepFreeze(JSON.parse(authorityCanonicalBytes(value).toString("utf8")) as Record<string, string>);
}

function replayProfileTrust(pin: ProfileTrustPinV1, verificationEpoch?: number): void {
  const expectedKeys = new Map<ProfileTrustPurposeV1, string>([
    ["profile-conformance", profileTrustKeyDigest(pin, pin.certifier)],
    ["profile-activation", profileTrustKeyDigest(pin, pin.operator)],
  ]);
  const expectedEventsDigest = authorityDigest({ v: "reelier.outcome-profile-trust-events/v1", tenant: pin.tenant, governanceRef: pin.governanceRef, events: pin.currentTrustEvents });
  if (pin.currentTrustEventsDigest !== expectedEventsDigest || pin.currentTrustEvents.length === 0) throw new TypeError("profile trust events digest mismatch");
  const active = new Set<ProfileTrustPurposeV1>();
  const revoked = new Set<ProfileTrustPurposeV1>();
  let priorHead: string | null = null;
  let priorTime = -Infinity;
  for (let index = 0; index < pin.currentTrustEvents.length; index++) {
    const event = pin.currentTrustEvents[index];
    if (event.index !== index || event.previousHeadDigest !== priorHead) throw new TypeError("profile trust event chain is not contiguous");
    const eventTime = parseCanonicalTime(event.at);
    if (eventTime <= priorTime || (verificationEpoch !== undefined && eventTime > verificationEpoch)) throw new TypeError("profile trust event time is invalid");
    priorTime = eventTime;
    if (event.keyDigest !== expectedKeys.get(event.keyPurpose)) throw new TypeError("profile trust event key is not declared");
    if (event.action === "activate") {
      if (active.has(event.keyPurpose) || revoked.has(event.keyPurpose)) throw new TypeError("profile trust key cannot be activated twice or reactivated");
      active.add(event.keyPurpose);
    } else {
      if (!active.delete(event.keyPurpose)) throw new TypeError("profile trust key cannot be revoked before activation");
      revoked.add(event.keyPurpose);
    }
    const eventDigest = authorityDigest({ v: "reelier.outcome-profile-trust-event/v1", tenant: pin.tenant, governanceRef: pin.governanceRef, index: event.index, action: event.action, keyPurpose: event.keyPurpose, keyDigest: event.keyDigest, at: event.at, previousHeadDigest: event.previousHeadDigest });
    priorHead = authorityDigest({ v: "reelier.outcome-profile-trust-head/v1", tenant: pin.tenant, governanceRef: pin.governanceRef, index: event.index, previousHeadDigest: event.previousHeadDigest, eventDigest });
  }
  if (active.size !== 2 || !active.has("profile-conformance") || !active.has("profile-activation") || priorHead !== pin.trustHeadDigest) throw new TypeError("profile trust final head is not admissible");
}

function profileTrustKeyDigest(pin: ProfileTrustPinV1, root: ProfileTrustPinV1["certifier"] | ProfileTrustPinV1["operator"]): string {
  return authorityDigest({ v: "reelier.outcome-profile-trust-key/v1", tenant: pin.tenant, governanceRef: pin.governanceRef, signerId: root.signerId, purpose: root.purpose, publicKeySpkiBase64: root.publicKeySpkiBase64 });
}

function verifyProfileSignature(publicKey: KeyObject, purpose: ProfileTrustPurposeV1, artifact: SignedOutcomeProfileConformanceV1 | SignedTenantProfileActivationV1): boolean {
  const { signature, ...unsignedArtifact } = artifact;
  const preimageDigest = authorityDigest({ v: "reelier.outcome-profile-signature-preimage/v1", purpose, artifactDigest: authorityDigest(unsignedArtifact) });
  return verifyAuthoritySignature(publicKey, "authority-evidence", preimageDigest, signature);
}

function assertConformanceReport(report: ProfileConformanceReportV1): void {
  assertVerifiedClaims(report.claims);
  let previous = "";
  const vectors = new Set<string>();
  const evidence = new Set<string>();
  for (const check of report.checks) {
    if (check.status !== "passed" || check.checkId <= previous || vectors.has(check.vectorDigest) || evidence.has(check.evidenceDigest)) throw new TypeError("profile conformance checks must be ordered, unique, and passed");
    previous = check.checkId;
    vectors.add(check.vectorDigest);
    evidence.add(check.evidenceDigest);
  }
}

function assertVerifiedClaims(claims: Readonly<ProfileClaimsV1>): void {
  if (claims.closure !== "verified" || claims.determinism !== "verified" || claims.accountBinding !== "verified" || claims.noSecrets !== "verified" || claims.reconciliation !== "verified") throw new TypeError("all profile conformance claims must be verified");
}

function parseEd25519PublicKey(encoded: string): KeyObject {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== encoded) throw new TypeError("profile public key SPKI is not canonical base64");
  let key: KeyObject;
  try { key = createPublicKey({ key: bytes, format: "der", type: "spki" }); }
  catch { throw new TypeError("profile public key SPKI is invalid"); }
  if (key.asymmetricKeyType !== "ed25519") throw new TypeError("profile public key must be Ed25519");
  return key;
}

function exactInput(input: ProfileGovernanceVerificationInputV1): ProfileGovernanceVerificationInputV1 {
  assertExactKeys(input, ["tenant", "draft", "report", "conformance", "activation", "trustRoots", "packs", "now"], "profile verification input");
  return input;
}

function assertExactKeys(value: unknown, expected: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain record`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some(key => typeof key !== "string" || !expected.includes(key))) throw new TypeError(`${label} is closed and must contain exact fields`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError(`${label} fields must be enumerable own data properties`);
  }
}

function assertOwnDataTree(value: unknown, label: string, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new TypeError(`${label} must not be cyclic`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`${label} arrays must use the intrinsic prototype`);
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key))) || keys.length !== value.length + 1) throw new TypeError(`${label} arrays must be dense own-data arrays`);
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError(`${label} array entries must be own data properties`);
      assertOwnDataTree(descriptor.value, label, seen);
    }
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must use the plain object prototype`);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError(`${label} must not contain symbol keys`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError(`${label} fields must be enumerable own data properties`);
      assertOwnDataTree(descriptor.value, label, seen);
    }
  }
  seen.delete(value);
}

function parseCanonicalTime(value: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new TypeError("profile time must be canonical RFC 3339 milliseconds");
  return time;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}
