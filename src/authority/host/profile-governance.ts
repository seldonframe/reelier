import type { OutcomeProfileDraftV1, ProfileConformanceReportV1, ProfileGovernanceManifestV1, SignedOutcomeProfileConformanceV1, SignedTenantProfileActivationV1 } from "../outcome-profile.js";

declare const admittedProfileGovernanceBrand: unique symbol;
export interface AdmittedProfileGovernanceV1 { readonly [admittedProfileGovernanceBrand]: true }

export interface ProfileGovernedRuntimeInputV1 {
  readonly governance: AdmittedProfileGovernanceV1;
  readonly expectedProfileDigest: string;
  readonly expectedActivationDigest: string;
}

export interface ProfileGovernanceAdmissionStateV1 {
  readonly draft: OutcomeProfileDraftV1;
  readonly report: ProfileConformanceReportV1;
  readonly conformance: SignedOutcomeProfileConformanceV1;
  readonly activation: SignedTenantProfileActivationV1;
  readonly manifest: ProfileGovernanceManifestV1;
  readonly manifestDigest: string;
  readonly operatorRootDigest: string;
}

const admissions = new WeakMap<object, ProfileGovernanceAdmissionStateV1>();

/** Loader-only minting seam. This module is deliberately absent from every public barrel. */
export function createAdmittedProfileGovernance(state: ProfileGovernanceAdmissionStateV1): AdmittedProfileGovernanceV1 {
  const admitted = Object.freeze(Object.create(null)) as AdmittedProfileGovernanceV1;
  admissions.set(admitted, Object.freeze({ ...state }));
  return admitted;
}

export function assertAdmittedProfileGovernance(value: unknown): asserts value is AdmittedProfileGovernanceV1 {
  if (!value || typeof value !== "object" || !admissions.has(value)) throw new TypeError("unrecognized admitted profile governance");
}

export function admittedProfileGovernanceState(value: AdmittedProfileGovernanceV1): ProfileGovernanceAdmissionStateV1 {
  assertAdmittedProfileGovernance(value);
  return admissions.get(value as object)!;
}

export function profileGovernanceAdmissionSnapshot(admitted: AdmittedProfileGovernanceV1): Readonly<{ profileDigest: string; activationDigest: string; trustHeadDigest: string }> {
  const state = admittedProfileGovernanceState(admitted);
  return Object.freeze({ profileDigest: state.manifest.profileDigest, activationDigest: state.manifest.activationDigest, trustHeadDigest: state.manifest.trustHeadDigest });
}

export function assertProfileRuntimeBinding(
  input: ProfileGovernedRuntimeInputV1,
  installed: Readonly<{ packDigest: string; definitionDigest: string; registrationDigest: string }>,
  authority: Readonly<{ contractDigest: string; jobCardDigest: string; deploymentDigest: string; routeAuthorityDigest: string; trustHeadDigest: string }>,
): void {
  assertExactDataRecord(input, ["governance", "expectedProfileDigest", "expectedActivationDigest"], "profile runtime input");
  assertExactDataRecord(installed, ["packDigest", "definitionDigest", "registrationDigest"], "installed profile binding");
  assertExactDataRecord(authority, ["contractDigest", "jobCardDigest", "deploymentDigest", "routeAuthorityDigest", "trustHeadDigest"], "authority profile binding");
  assertAdmittedProfileGovernance(input.governance);
  const state = admittedProfileGovernanceState(input.governance);
  const matches = input.expectedProfileDigest === state.manifest.profileDigest
    && input.expectedActivationDigest === state.manifest.activationDigest
    && installed.packDigest === state.draft.packDigest
    && installed.definitionDigest === state.draft.definitionDigest
    && installed.registrationDigest === state.draft.definitionRegistrationDigest
    && authority.contractDigest === state.activation.contractDigest
    && authority.jobCardDigest === state.activation.jobCardDigest
    && authority.deploymentDigest === state.activation.deploymentDigest
    && authority.routeAuthorityDigest === state.activation.routeAuthorityDigest
    && authority.trustHeadDigest === state.activation.trustHeadDigest;
  if (!matches) throw new TypeError("profile governance runtime binding mismatch");
}

export function assertExactDataRecord(value: unknown, expected: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain record`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some(key => typeof key !== "string" || !expected.includes(key))) throw new TypeError(`${label} must contain exact fields`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError(`${label} fields must be enumerable own data properties`);
  }
}
