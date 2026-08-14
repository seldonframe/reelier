import os from "node:os";
import type { KeyObject } from "node:crypto";
import type { AuthorityHostConfig } from "./config.js";
import type { AuthorityHostServer } from "./server.js";
import { createAuthorityHostServer } from "./server.js";
import { createAdmittedLocalAuthorityRuntime } from "./local.js";
import { loadProfileGovernanceFromOperatorTrust } from "./profile-governance-loader.js";
import { assertExactDataRecord } from "./profile-governance.js";
import { assertLinuxAuthorityCellHost } from "./platform.js";
import type { PrincipalRegistry } from "./principal-registry.js";
import type { DispatchAdapter, CertifiedDispatchOptions, CertifiedIdentityVerifier, DispatchPublication } from "./dispatch.js";
import type { DelegationAuthority } from "./delegation-service.js";
import type { SignedTopologyEvidenceV1 } from "./topology.js";
import type { SignedAuthorityLeaseV1 } from "../types.js";
import type { SourceReadAdapter } from "./source-read-adapter.js";
import type { OpaqueConnectionRouteRegistry } from "../../connections.js";
import type { SecretResolver } from "./secret-resolver.js";
import type { RouteAuthoritySnapshotV1 } from "../ledger.js";
import type { AuthenticatedProviderIdentityV1 } from "./github-account-identity.js";
import type { AuthorityLatencyRecorder } from "./latency.js";

export interface GovernedAuthorityCellReferenceV1 { readonly v: "reelier.governed-authority-cell-reference/v1"; readonly tenant: string; readonly governanceRef: string; readonly expectedManifestDigest: string; readonly expectedTrustHeadDigest: string }
export interface GovernedAuthorityCellOptionsV1 {
  readonly principalRegistry?: PrincipalRegistry; readonly dispatchAdapter?: DispatchAdapter; readonly delegation?: DelegationAuthority;
  readonly signedTopologyEvidence?: SignedTopologyEvidenceV1; readonly topologySigner?: Readonly<{ signerId: string; publicKey: KeyObject }>;
  readonly signedLease?: SignedAuthorityLeaseV1; readonly leaseSigner?: Readonly<{ signerId: string; publicKey: KeyObject }>;
  readonly sourceReadAdapter?: SourceReadAdapter; readonly connectionRoutes?: OpaqueConnectionRouteRegistry; readonly secretResolver?: SecretResolver;
  readonly routeAuthority?: (input: Readonly<{ tenant: string; requester: string; definitionAlias: string; connectorId: string; accountId: string; endpointId: string; authorityGeneration: string; authorityExpiresAt: string }>) => RouteAuthoritySnapshotV1 | undefined;
  readonly authenticatedProviderIdentity?: () => Promise<AuthenticatedProviderIdentityV1>; readonly verifyAuthenticatedProviderIdentity?: CertifiedIdentityVerifier;
  readonly certifiedDispatch?: CertifiedDispatchOptions; readonly portableReceiptPublication?: DispatchPublication; readonly latencyRecorder?: AuthorityLatencyRecorder;
}

const REFERENCE_FIELDS = ["v", "tenant", "governanceRef", "expectedManifestDigest", "expectedTrustHeadDigest"] as const;
const OPTION_FIELDS = ["principalRegistry", "dispatchAdapter", "delegation", "signedTopologyEvidence", "topologySigner", "signedLease", "leaseSigner", "sourceReadAdapter", "connectionRoutes", "secretResolver", "routeAuthority", "authenticatedProviderIdentity", "verifyAuthenticatedProviderIdentity", "certifiedDispatch", "portableReceiptPublication", "latencyRecorder"] as const;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export async function createGovernedAuthorityCell(config: AuthorityHostConfig, reference: GovernedAuthorityCellReferenceV1, options: GovernedAuthorityCellOptionsV1): Promise<AuthorityHostServer> {
  assertLinuxAuthorityCellHost();
  assertExactDataRecord(reference, REFERENCE_FIELDS, "governed Authority Cell reference");
  assertExactDataRecord(options, Reflect.ownKeys(options).filter((key): key is string => typeof key === "string"), "governed Authority Cell options");
  const optionKeys = Reflect.ownKeys(options);
  if (optionKeys.some(key => typeof key !== "string" || !OPTION_FIELDS.includes(key as typeof OPTION_FIELDS[number]))) throw new TypeError("governed Authority Cell options contain an unknown field");
  const read = <T>(record: object, key: PropertyKey): T => Object.getOwnPropertyDescriptor(record, key)!.value as T;
  const ref = Object.fromEntries(REFERENCE_FIELDS.map(key => [key, read(reference, key)])) as unknown as GovernedAuthorityCellReferenceV1;
  if (ref.v !== "reelier.governed-authority-cell-reference/v1" || typeof ref.tenant !== "string" || !ID.test(ref.tenant) || typeof ref.governanceRef !== "string" || !ID.test(ref.governanceRef) || typeof ref.expectedManifestDigest !== "string" || !DIGEST.test(ref.expectedManifestDigest) || typeof ref.expectedTrustHeadDigest !== "string" || !DIGEST.test(ref.expectedTrustHeadDigest)) throw new TypeError("governed Authority Cell reference is invalid");
  if (ref.tenant !== config.tenant) throw new TypeError("governed Authority Cell tenant mismatch");
  const values = Object.fromEntries(optionKeys.map(key => [key, read(options, key)])) as GovernedAuthorityCellOptionsV1;
  if (!!values.signedTopologyEvidence !== !!values.topologySigner) throw new TypeError("signed topology evidence and topology signer must be paired");
  if (!!values.signedLease !== !!values.leaseSigner) throw new TypeError("signed lease and lease signer must be paired");
  if (config.nativeHttpsRoutes?.length && (!values.routeAuthority || !values.authenticatedProviderIdentity || !values.verifyAuthenticatedProviderIdentity || !values.certifiedDispatch)) throw new TypeError("native route authority, provider identity, identity verifier, and certified dispatch must be paired");
  const governance = await loadProfileGovernanceFromOperatorTrust({ tenant: ref.tenant, governanceRef: ref.governanceRef, expectedManifestDigest: ref.expectedManifestDigest, expectedTrustHeadDigest: ref.expectedTrustHeadDigest, homedir: os.homedir(), verificationTime: new Date() });
  const runtime = await createAdmittedLocalAuthorityRuntime(config, governance, values);
  return createAuthorityHostServer(config, runtime, values.principalRegistry ? { principalRegistry: values.principalRegistry } : {});
}
