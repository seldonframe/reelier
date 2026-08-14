import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../wire.js";
import { signAuthorityDigest } from "../crypto.js";
import { createAuthorityGate } from "../gate.js";
import { createTrustRoots } from "../trust.js";
import { verifyTrustedAuthority } from "../trust.js";
import { createConnectorRegistry } from "../connector.js";
import { createAuthorityStatePort } from "../state.js";
import { createStaticPackRegistry } from "../pack.js";
import { createFileGateDecisionSink } from "../decision.js";
import { FsAuthorityLedger } from "./fs-ledger.js";
import { createDispatchCoordinator, type DispatchAdapter, type DispatchPublication } from "./dispatch.js";
import { createJsonHttpsDispatchAdapter } from "./json-https-connector.js";
import { createFileReceiptPublication } from "./receipts.js";
import { createPortableAuthorityReceiptPublication } from "./portable-receipts.js";
import { createAuthorityHostRuntime } from "./runtime.js";
import type { AuthorityHostConfig } from "./config.js";
import type { AuthorityHostRuntime } from "./server.js";
import { createSecretResolver, type SecretResolver, type SecretResolverOptions } from "./secret-resolver.js";
import { firstPartyPacks, firstPartyPackForAlias, createFirstPartySourceRegistry } from "../../packs/index.js";
import { loadAuthorityDeployment, type JobCardTrustPinV1 } from "./deployment.js";
import { loadOrCreateLocalGateSigner } from "./gate-signer.js";
import type { DelegationAuthority } from "./delegation-service.js";
import { assertFreshManagedTopologyEvidence, assertManagedTopologyEvidence, type SignedTopologyEvidenceV1, type TopologyEvidenceV1 } from "./topology.js";
import { verifyAuthorityLease } from "./lease.js";
import type { SignedAuthorityLeaseV1 } from "../types.js";
import type { SourceReadAdapter } from "./source-read-adapter.js";
import type { DownstreamConnection } from "../../mcp-client.js";
import type { OpaqueConnectionRouteRegistry } from "../../connections.js";
import { assertLinuxAuthorityCellHost } from "./platform.js";
import type { RouteAuthoritySnapshotV1 } from "../ledger.js";
import type { CertifiedDispatchOptions, CertifiedIdentityVerifier } from "./dispatch.js";
import type { AuthenticatedProviderIdentityV1 } from "./github-account-identity.js";
import type { AuthorityLatencyRecorder } from "./latency.js";
import type { AdmittedProfileGovernanceV1 } from "./profile-governance.js";
import { admittedProfileGovernanceState, assertAdmittedProfileGovernance, assertProfileRuntimeBinding } from "./profile-governance.js";
import { definitionRegistrationDigest } from "../pack.js";

/** Builds the local host from signed-artifact boundaries. An empty workspace is intentionally
 * usable for discovery and status, but every Outcome refuses until a signed contract is installed. */
export interface LocalAuthorityRuntimeOptions {
  readonly dispatchAdapter?: DispatchAdapter;
  readonly delegation?: DelegationAuthority;
  readonly topologyEvidence?: TopologyEvidenceV1;
  readonly signedTopologyEvidence?: SignedTopologyEvidenceV1;
  readonly topologySigner?: Readonly<{ signerId: string; publicKey: import("node:crypto").KeyObject }>;
  readonly signedLease?: SignedAuthorityLeaseV1;
  readonly leaseSigner?: Readonly<{ signerId: string; publicKey: import("node:crypto").KeyObject }>;
  /** Production hosts inject an account-bound live reader. Fixture-file reads remain the
   * explicit hermetic default for local conformance and offline tests. */
  readonly sourceReadAdapter?: SourceReadAdapter;
  readonly connectionRoutes?: OpaqueConnectionRouteRegistry;
  /** Host-pinned, currently authoritative trust state. It must not be loaded
   * from the deployment being verified. */
  readonly jobCardTrustPin?: JobCardTrustPinV1;
  /** Host-owned credential slots are injected out-of-band and never loaded from authority.yml. */
  readonly secretResolver?: SecretResolver;
  readonly secretResolverOptions?: SecretResolverOptions;
  readonly routeAuthority?: (input: Readonly<{ tenant:string; requester:string; definitionAlias:string; connectorId:string; accountId:string; endpointId:string; authorityGeneration:string; authorityExpiresAt:string }>) => RouteAuthoritySnapshotV1 | undefined;
  readonly authenticatedProviderIdentity?: () => Promise<AuthenticatedProviderIdentityV1>;
  readonly verifyAuthenticatedProviderIdentity?: CertifiedIdentityVerifier;
  readonly certifiedDispatch?: CertifiedDispatchOptions;
  /** Externally rooted portable publication. The local runtime never mints a
   * trust root for this evidence from its own deployment or receipt key. */
  readonly portableReceiptPublication?: DispatchPublication;
  /** In-memory aggregate-only critical-path recorder; never persisted by the runtime. */
  readonly latencyRecorder?: AuthorityLatencyRecorder;
}

export interface LocalAuthorityRuntime extends AuthorityHostRuntime {
  /** Explicitly opens an adopted host-owned route. Loading the deployment never calls this. */
  resolveAdoptedConnection(connectionId: string): Promise<DownstreamConnection>;
}

/** Local-host composition seam: durable file evidence is always committed first. */
export function createLocalAuthorityReceiptPublication(input: Readonly<{ localPublication: DispatchPublication; portablePublication?: DispatchPublication }>): DispatchPublication {
  if (!input?.localPublication || typeof input.localPublication.publish !== "function") throw new TypeError("local receipt publication is invalid");
  return input.portablePublication ? createPortableAuthorityReceiptPublication({ localPublication: input.localPublication, portablePublication: input.portablePublication }) : input.localPublication;
}

export async function createLocalAuthorityRuntime(config: AuthorityHostConfig, options: LocalAuthorityRuntimeOptions = {}): Promise<LocalAuthorityRuntime> {
  assertLinuxAuthorityCellHost();
  if (config.cloud && config.topology !== "isolated") throw new TypeError("managed authority requires isolated topology");
  if (config.cloud) {
    if (!options.signedTopologyEvidence || !options.topologySigner) throw new TypeError("managed authority requires signed topology evidence");
    assertFreshManagedTopologyEvidence(options.signedTopologyEvidence, { tenant: config.tenant, now: new Date(), signerId: options.topologySigner.signerId, publicKey: options.topologySigner.publicKey, maxAgeMs: 5 * 60 * 1000 });
    assertManagedTopologyEvidence(options.signedTopologyEvidence.evidence);
    if (!options.signedLease || !options.leaseSigner) throw new TypeError("managed authority requires a signed lease");
    verifyAuthorityLease(options.signedLease, { tenant: config.tenant, now: new Date(), signerId: options.leaseSigner.signerId, publicKey: options.leaseSigner.publicKey, topologyEvidenceDigest: options.signedTopologyEvidence.digest });
  }
  if (config.deploymentPath && config.jobCardTrustPinPath) {
    const trustPinPath = path.resolve(config.jobCardTrustPinPath);
    const pinStat = await lstat(trustPinPath);
    if (pinStat.isSymbolicLink()) throw new TypeError("host Job Card trust pin link indirection is prohibited");
    const [deploymentRoot, canonicalTrustPin] = await Promise.all([realpath(path.dirname(path.resolve(config.deploymentPath))), realpath(trustPinPath)]);
    const canonical = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
    const rootIdentity = canonical(deploymentRoot);
    const pinIdentity = canonical(canonicalTrustPin);
    if (pinIdentity === rootIdentity || pinIdentity.startsWith(`${rootIdentity}${path.sep}`)) throw new TypeError("host Job Card trust pin must remain outside deployment-controlled output");
  }
  await mkdir(config.ledgerDir, { recursive: true }); await mkdir(config.decisionDir, { recursive: true }); await mkdir(config.receiptDir, { recursive: true });
  const jobCardTrustPin = options.jobCardTrustPin ?? (config.jobCardTrustPinPath ? JSON.parse(await readFile(config.jobCardTrustPinPath, "utf8")) as JobCardTrustPinV1 : undefined);
  const deployment = config.deploymentPath ? await loadAuthorityDeployment(config.deploymentPath, { jobCardTrustPin }) : undefined;
  if (deployment && deployment.tenant !== config.tenant) throw new TypeError("authority deployment tenant does not match host config");
  if (deployment && !deployment.jobCard) throw new TypeError("production authority deployment requires a signed Job Card");
  if (deployment?.jobCard) {
    if (deployment.jobCard.definitionAliases.length !== 1) throw new TypeError("loaded signed Job Card must bind exactly one invokable definition");
    const configured = [...config.definitions].sort();
    if (authorityDigest(configured) !== authorityDigest(deployment.jobCard.definitionAliases)) throw new TypeError("host definitions do not match the signed Job Card");
    const selectedPacks = deployment.jobCard.definitionAliases.map(alias => firstPartyPackForAlias(alias));
    if (selectedPacks.some(pack => !pack)) throw new TypeError("signed Job Card definition has no installed reviewed pack");
    const expectedPackDigests = [...new Set(selectedPacks.map(pack => pack!.definition.packDigest))].sort();
    if (authorityDigest(expectedPackDigests) !== authorityDigest(deployment.jobCard.packDigests)) throw new TypeError("signed Job Card pack digest set does not match installed reviewed packs");
  }
  const ledger = new FsAuthorityLedger(config.ledgerDir);
  const decisions = createFileGateDecisionSink(config.decisionDir);
  const gateSigner = await loadOrCreateLocalGateSigner(config.gateKeyFile ?? path.join(config.receiptDir, "..", "keys", "local-gate.pem"));
  const { privateKey, publicKey } = gateSigner;
  const deploymentGate = deployment?.trustEntries.find(entry => entry.signerId === "local-gate");
  if (deploymentGate && !deploymentGate.publicKey.export({ type: "spki", format: "der" }).equals(publicKey.export({ type: "spki", format: "der" }))) throw new TypeError("deployment local gate key does not match host gate key");
  const trustRoots = createTrustRoots([...(deployment?.trustEntries.filter(entry => entry.signerId !== "local-gate") ?? []), { tenant: config.tenant, signerId: "local-gate", principalId: config.requester, publicKey, purposes: ["gate-event", "principal", "delegation-grant"] }]);
  const packs = createStaticPackRegistry(firstPartyPacks.map(pack => pack.definition));
  const sources = createFirstPartySourceRegistry(config.tenant);
  const snapshots = new Map(deployment?.states.map(state => [state.definitionAlias, state]) ?? []);
  const connectorRegistry = deployment?.connectorRegistry ?? createConnectorRegistry([]);
  const state = createAuthorityStatePort({
    async loadCompleteContractSet(tenant, definitionAlias) { const snapshot = snapshots.get(definitionAlias); return { ok: true as const, snapshot: snapshot && snapshot.tenant === tenant ? snapshot : { tenant, definitionAlias, stateVersion: 1, candidates: [] }, backendToken: Object.freeze({}) }; },
    async advanceVersion(backendToken) { void backendToken; return { ok: true as const, backendObservedToken: Object.freeze({}) }; },
    async withCurrent(_token, callback) { return { ok: true as const, value: await callback() }; },
    async executeSourceReads(plans) {
      if (options.sourceReadAdapter) return options.sourceReadAdapter.execute(plans);
      if (!deployment) return { ok: false as const, reason: "unavailable" as const };
      try {
        const observations = await Promise.all(plans.map(async plan => ({ planDigest: plan.planDigest, rawBytes: Uint8Array.from(await readFile(path.join(deployment.sourceDirectory, `${plan.opaqueHandle}.json`))) })));
        return { ok: true as const, observations };
      } catch { return { ok: false as const, reason: "unavailable" as const }; }
    },
  });
  const gate = createAuthorityGate({ trustRoots, packs, sources, connectors: connectorRegistry, state, ledger, ...(options.routeAuthority ? { routeAuthority: options.routeAuthority } : {}), ...(options.authenticatedProviderIdentity ? { authenticatedProviderIdentity: options.authenticatedProviderIdentity } : {}), ...(options.latencyRecorder ? { latencyRecorder: options.latencyRecorder } : {}), localGatePolicyDigest: authorityDigest({ v: "reelier.local-gate-policy/v1", tenant: config.tenant }), decisionSink: decisions, signer: { async sign(input) { return { signerId: "local-gate", signature: signAuthorityDigest(privateKey, input.purpose, input.digest) }; } }, eventId: () => `evt_${randomUUID()}`, capabilityId: () => `cap_${randomUUID()}` });
  const publication = createLocalAuthorityReceiptPublication({ localPublication: createFileReceiptPublication({ rootDir: config.receiptDir }), ...(options.portableReceiptPublication ? { portablePublication: options.portableReceiptPublication } : {}) });
  const secrets = options.secretResolver ?? createSecretResolver(options.secretResolverOptions);
  if (config.nativeHttpsRoutes && config.nativeHttpsRoutes.length > 0 && (!options.routeAuthority || !options.authenticatedProviderIdentity || !options.certifiedDispatch || !options.verifyAuthenticatedProviderIdentity)) throw new TypeError("native HTTPS routes require certified route, identity, verifier, and dispatch wiring");
  const certifiedDispatch = options.certifiedDispatch ? { ...options.certifiedDispatch, ...(options.latencyRecorder ? { latencyRecorder: options.latencyRecorder } : {}), verifyIdentity: options.verifyAuthenticatedProviderIdentity ?? options.certifiedDispatch.verifyIdentity } : undefined;
  if (config.nativeHttpsRoutes && config.nativeHttpsRoutes.length > 0 && !certifiedDispatch?.verifyIdentity) throw new TypeError("native HTTPS routes require an identity verifier");
  const adapter = options.dispatchAdapter ?? createJsonHttpsDispatchAdapter({ endpoints: config.endpoints, routes: config.nativeHttpsRoutes, secrets, ...(options.latencyRecorder ? { latencyRecorder: options.latencyRecorder } : {}) });
  const dispatch = createDispatchCoordinator(ledger, adapter, undefined, publication, options.delegation?.budget, certifiedDispatch);
  const runtime = createAuthorityHostRuntime({ gate, dispatch, ledger, decisions, delegation: options.delegation, ...(options.delegation ? { verifyRootGrant: (grant, tenant) => { verifyTrustedAuthority(trustRoots, { tenant, signerId: grant.signerId, purpose: "delegation-grant", advertisedDigest: grant.digest, value: grant.grant, signature: grant.signature }); } } : {}) });
  const jobs = deployment?.jobCard
    ? Object.freeze([Object.freeze({ jobId: deployment.jobCard.jobId, alias: deployment.jobCard.definitionAliases[0]! })])
    : Object.freeze(config.definitions.map(alias => Object.freeze({ jobId: alias, alias })));
  const authorizedRequester = (context: { readonly tenant: string; readonly requester: string }): boolean => context.tenant === config.tenant && (deployment?.jobCard?.audiences.includes(context.requester) ?? true);
  return Object.freeze({
    ...runtime,
    async outcome(alias: string, input: unknown, context: { readonly tenant: string; readonly requester: string }) {
      if ((deployment?.jobCard && !deployment.jobCard.definitionAliases.includes(alias)) || !authorizedRequester(context)) return Object.freeze({ requestId: input && typeof input === "object" && !Array.isArray(input) && typeof (input as Record<string, unknown>).requestId === "string" ? String((input as Record<string, unknown>).requestId) : "", verdict: "refused" as const, reasonCode: "job-authority-refused", lifecycleState: "refused" });
      return runtime.outcome(alias, input, context);
    },
    async resolveAdoptedConnection(connectionId: string) {
      if (!deployment || !options.connectionRoutes) throw new TypeError("adopted connection route is unavailable");
      const descriptor = deployment.connectionDescriptors.find(item => item.connectionId === connectionId);
      if (!descriptor) throw new TypeError("adopted connection descriptor is missing");
      const adoption = deployment.connectionAdoptions.find(item => item.descriptorDigest === authorityDigest(descriptor));
      if (!adoption) throw new TypeError("adopted connection binding is missing");
      return options.connectionRoutes.resolve(descriptor, adoption);
    },
    async jobsSearch(input: unknown) {
      const query = input && typeof input === "object" && !Array.isArray(input) && typeof (input as Record<string, unknown>).query === "string" ? String((input as Record<string, unknown>).query).toLowerCase() : "";
      return Object.freeze({ requestId: "", verdict: "accepted" as const, reasonCode: "jobs-found", lifecycleState: "catalog", jobs: Object.freeze(jobs.filter(job => !query || job.jobId.toLowerCase().includes(query) || job.alias.toLowerCase().includes(query))) });
    },
    async jobLoad(input: unknown) {
      const jobId = input && typeof input === "object" && !Array.isArray(input) && typeof (input as Record<string, unknown>).jobId === "string" ? String((input as Record<string, unknown>).jobId) : "";
      if (!jobs.some(job => job.jobId === jobId)) return Object.freeze({ requestId: "", verdict: "refused" as const, reasonCode: "job-not-found", lifecycleState: "unknown" });
      return Object.freeze({ requestId: "", verdict: "accepted" as const, reasonCode: "job-loaded", lifecycleState: "loaded", jobRef: jobId });
    },
    async invoke(input: unknown, context: { readonly tenant: string; readonly requester: string }) {
      if (!input || typeof input !== "object" || Array.isArray(input)) return Object.freeze({ requestId: "", verdict: "refused" as const, reasonCode: "invalid-request", lifecycleState: "refused" });
      const raw = input as Record<string, unknown>;
      const jobRef = typeof raw.jobRef === "string" ? raw.jobRef : "";
      const job = jobs.find(item => item.jobId === jobRef);
      if (!job) return Object.freeze({ requestId: typeof raw.requestId === "string" ? raw.requestId : "", verdict: "refused" as const, reasonCode: "job-not-found", lifecycleState: "unknown" });
      const request = { ...raw }; delete request.jobRef;
      if (!authorizedRequester(context)) return Object.freeze({ requestId: typeof raw.requestId === "string" ? raw.requestId : "", verdict: "refused" as const, reasonCode: "job-authority-refused", lifecycleState: "refused" });
      return runtime.outcome(job.alias, request, context);
    },
  });
}

/** Package-internal governed composition seam. Deliberately absent from the host barrel. */
export async function createAdmittedLocalAuthorityRuntime(config: AuthorityHostConfig, admitted: AdmittedProfileGovernanceV1, options: LocalAuthorityRuntimeOptions = {}): Promise<LocalAuthorityRuntime> {
  assertAdmittedProfileGovernance(admitted);
  const state = admittedProfileGovernanceState(admitted);
  const installedPack = firstPartyPackForAlias(state.draft.packAlias);
  if (!installedPack) throw new TypeError("profile governance installed pack binding mismatch");
  const installedRegistry = createStaticPackRegistry(firstPartyPacks.map(pack => pack.definition));
  assertProfileRuntimeBinding(
    { governance: admitted, expectedProfileDigest: state.manifest.profileDigest, expectedActivationDigest: state.manifest.activationDigest },
    { packDigest: installedPack.definition.packDigest, definitionDigest: installedPack.definition.definitionDigest, registrationDigest: definitionRegistrationDigest(installedRegistry, state.draft.packAlias) },
    { contractDigest: state.activation.contractDigest, jobCardDigest: state.activation.jobCardDigest, deploymentDigest: state.activation.deploymentDigest, routeAuthorityDigest: state.activation.routeAuthorityDigest, trustHeadDigest: state.activation.trustHeadDigest },
  );
  return createLocalAuthorityRuntime(config, options);
}
