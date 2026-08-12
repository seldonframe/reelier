import { createPublicKey, randomUUID, KeyObject } from "node:crypto";
import { realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest, parseAuthorityWire } from "../wire.js";
import { signAuthorityDigest, verifyAuthoritySignature } from "../crypto.js";
import { normalizeSignedJobCard, signedJobCardDigest, verifySignedJobCard, type SignedJobCardV1 } from "../job.js";
import type { AuthoritySignature, DelegationConstraints, DelegationGrant } from "../types.js";
import type { StoredSignedGrant } from "../delegation.js";
import { jobCardTrustMaterialFromPin, type JobCardTrustPinV1 } from "../host/deployment.js";
import { registerAuthoritySignedChild, type DelegationAuthority } from "../host/delegation-service.js";
import type { PrincipalCredential, PrincipalRegistry } from "../host/principal-registry.js";
import { parseAuthorityKeyDescriptor, parseTrustEvents, verifySignedCertificationReadiness, type AuthorityKeyDescriptorV1 } from "./authority.js";
import { parseCertificationOperatorConfigV3 } from "./config.js";
import { certificationWorkspaceRoot, confinedExistingDirectory, publishPrivateContentAddressed, readConfinedFile, readUnlinkedFile } from "./filesystem.js";
import { deriveCertificationEndpointManifest, parseCertificationInitialization, validateCertificationInitialization, type CertificationIdentifiers } from "./initializer.js";
import { parseCertificationEndpointManifest, parseCertificationRunnerManifest, parseCertificationScenarioPlan, parseCertificationTestManifest } from "./manifests.js";
import { certificationRunnerRegistryDigest, getCertificationRunnerRegistryEntry } from "./runner-registry.js";
import { preflightCertification } from "./preflight.js";
import { CERTIFICATION_SCENARIO_IDS, type CertificationScenarioId } from "./scenarios.js";
import { assertLinuxAuthorityCellHost } from "../host/platform.js";
import { consumeCertificationLifecycleAuthority, type CertificationArtifactKeyBindingCommitmentV1, type CertificationArtifactKeyBindingV1, type CertificationLifecycleAuthorityHandle, type CertificationLifecycleAuthorityMaterial } from "./lifecycle-authority.js";
import { AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST } from "../adapter-contract.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface CertificationCellActivationV1 {
  readonly v: "reelier.certification-cell-activation/v1";
  readonly taskId: string;
  readonly jobId: string;
  readonly grantId: string;
  readonly allocationId: string;
  readonly rootAllocationId: string;
  readonly authorityCellId: string;
  readonly principalId: string;
  readonly runtimeSessionId: string;
  readonly signerKeyId: string;
  readonly signerKeyDescriptorDigest: string;
  readonly signedReadinessDigest: string;
  readonly signedJobCardDigest: string;
  readonly constraintsDigest: string;
  readonly currentTrustEventCount: number;
  readonly currentTrustHistoryDigest: string;
  readonly currentTrustHeadDigest: string;
  readonly currentTrustPinPathDigest: string;
  readonly effects: number;
  readonly signedRootGrant: StoredSignedGrant;
  readonly signedChildGrant: StoredSignedGrant;
  readonly completeness: "unchecked";
  readonly dispatchable: false;
}

export function certificationTaskShapeDigest(input: Readonly<{ identifiers: CertificationIdentifiers; scenarios: readonly CertificationScenarioId[]; constraints: DelegationConstraints }>): string {
  return authorityDigest({ v: "reelier.certification-task-shape/v1", identifiers: input.identifiers, scenarios: input.scenarios, constraints: input.constraints });
}

async function activateCertificationRootTask(input: Readonly<{
  workspace: string;
  jobCard: unknown;
  jobCardTrustPin: JobCardTrustPinV1;
  currentTrustPinPath: string;
  currentTrustPinPathDigest: string;
  delegationKeyDescriptor: unknown;
  delegationPrivateKey: KeyObject;
  constraints: DelegationConstraints;
  effects: number;
  issuedAt: string;
  expiresAt: string;
  delegationAuthority: DelegationAuthority;
}>): Promise<CertificationCellActivationV1> {
  assertLinuxAuthorityCellHost();
  const state = await loadInitialization(input.workspace);
  const jobCard = normalizeSignedJobCard(input.jobCard);
  const trust = verifyCurrentJobCardTrust(jobCard, input.jobCardTrustPin);
  const delegation = parseAuthorityKeyDescriptor(input.delegationKeyDescriptor);
  if (delegation.role !== "authority-cell" || delegation.purpose !== "delegation-grant") throw new TypeError("certification root requires a purpose-separated delegation signer");
  const descriptorDigest = authorityDigest(delegation);
  const readiness = input.jobCardTrustPin.signedReadiness;
  if (!readiness.activatedCellKeyDescriptorDigests.includes(descriptorDigest) || !trust.activeDescriptorDigests.has(descriptorDigest)) throw new TypeError("certification delegation signer is not currently activated by readiness");
  if (jobCard.jobId !== state.initialization.identifiers.jobCardId || authorityDigest(readiness.identifiers) !== authorityDigest(state.initialization.identifiers) || authorityDigest(readiness.scenarios) !== authorityDigest(state.initialization.scenarios)) throw new TypeError("certification generated task, Job Card, grant, or Cell identity mismatch");
  const constraints = structuredClone(input.constraints);
  if (jobCard.limitsDigest !== authorityDigest(constraints.limits) || jobCard.taskShapeDigest !== certificationTaskShapeDigest({ identifiers: state.initialization.identifiers, scenarios: state.initialization.scenarios, constraints })) throw new TypeError("certification Job Card concrete limits or constraints commitment mismatch");
  if (!Number.isSafeInteger(input.effects) || input.effects < 1 || input.effects > constraints.limits.maxEffectsPerWindow) throw new TypeError("certification root effects exceed the committed limits");
  const identifiers = state.initialization.identifiers;
  const principalId = deriveId("principal", identifiers), rootPrincipalId = delegation.keyId;
  const runtimeSessionId = deriveId("session", identifiers);
  const issuedAt = canonicalTime(input.issuedAt), expiresAt = canonicalTime(input.expiresAt), childDuration = Math.ceil((Date.parse(expiresAt) - Date.parse(issuedAt)) / 1000);
  const grant = parseAuthorityWire("delegation-grant", { v: "reelier.delegation-grant/v1", tenant: identifiers.authorityCellId, grantId: identifiers.rootGrantId, parentDigest: null, sponsor: jobCard.signerId, grantor: delegation.keyId, grantee: rootPrincipalId, issuedAt, expiresAt, constraints, delegationPolicy: { mayDelegate: true, maxDepth: 1, maxFanOut: 1, maxChildDurationSeconds: childDuration, maxDelegatedEffects: input.effects } });
  if (Date.parse(grant.expiresAt) <= Date.parse(grant.issuedAt)) throw new TypeError("certification root validity is invalid");
  const grantDigest = authorityDigest(grant);
  const signature = signAuthorityDigest(input.delegationPrivateKey, "delegation-grant", grantDigest);
  const publicKey = publicKeyFor(delegation);
  if (!verifyAuthoritySignature(publicKey, "delegation-grant", grantDigest, signature)) throw new TypeError("certification delegation private key does not match its descriptor");
  const signedRootGrant: StoredSignedGrant = Object.freeze({ grant, digest: grantDigest, signerId: delegation.keyId, signature });
  const child = parseAuthorityWire("delegation-grant", { v: "reelier.delegation-grant/v1", tenant: identifiers.authorityCellId, grantId: `${identifiers.rootGrantId}_child`, parentDigest: grantDigest, sponsor: jobCard.signerId, grantor: rootPrincipalId, grantee: principalId, issuedAt, expiresAt, constraints, delegationPolicy: { mayDelegate: false, maxDepth: 0, maxFanOut: 0, maxChildDurationSeconds: 1, maxDelegatedEffects: 0 } });
  const childDigest = authorityDigest(child), signedChildGrant: StoredSignedGrant = Object.freeze({ grant: child, digest: childDigest, signerId: delegation.keyId, signature: signAuthorityDigest(input.delegationPrivateKey, "delegation-grant", childDigest) });
  const currentTrustPinPath = await canonicalExternalTrustPin(state.root, input.currentTrustPinPath);
  if (trustPinPathDigest(currentTrustPinPath) !== input.currentTrustPinPathDigest) throw new TypeError("operator current trust pin path changed after host configuration");
  const authoritativePin = JSON.parse((await readUnlinkedFile(currentTrustPinPath)).toString("utf8")) as JobCardTrustPinV1;
  if (authorityDigest(authoritativePin) !== authorityDigest(input.jobCardTrustPin)) throw new TypeError("operator current trust pin does not match activation trust material");
  const currentTrustEvents = parseTrustEvents(authoritativePin.currentTrustEvents, authoritativePin.keyDescriptors);
  const activation: CertificationCellActivationV1 = Object.freeze({ v: "reelier.certification-cell-activation/v1", taskId: identifiers.taskId, jobId: identifiers.jobCardId, grantId: child.grantId, allocationId: child.grantId, rootAllocationId: identifiers.rootGrantId, authorityCellId: identifiers.authorityCellId, principalId, runtimeSessionId, signerKeyId: delegation.keyId, signerKeyDescriptorDigest: descriptorDigest, signedReadinessDigest: authorityDigest(readiness), signedJobCardDigest: signedJobCardDigest(jobCard), constraintsDigest: authorityDigest(constraints), currentTrustEventCount: currentTrustEvents.length, currentTrustHistoryDigest: authorityDigest(currentTrustEvents), currentTrustHeadDigest: authorityDigest(currentTrustEvents[currentTrustEvents.length - 1]), currentTrustPinPathDigest: input.currentTrustPinPathDigest, effects: input.effects, signedRootGrant, signedChildGrant, completeness: "unchecked", dispatchable: false });
  await input.delegationAuthority.registerRoot({ taskId: activation.taskId, allocationId: activation.rootAllocationId, rootGrant: signedRootGrant, effects: input.effects });
  await registerAuthoritySignedChild(input.delegationAuthority, { tenant: identifiers.authorityCellId, parentPrincipal: rootPrincipalId, taskId: activation.taskId, parentAllocationId: activation.rootAllocationId, signedChild: signedChildGrant, signerDescriptor: delegation, activeSignerDescriptorDigests: [...trust.activeDescriptorDigests], effects: input.effects });
  const authorityRoot = await requireAuthorityRoot(state.root);
  await publishExact(authorityRoot, "deployment", "job-card.json", jobCard);
  await publishExact(authorityRoot, "trust", "job-card-trust-pin.json", input.jobCardTrustPin);
  await publishExact(authorityRoot, "delegation", "root-activation.json", activation);
  return activation;
}

async function activateCertificationPrincipalSession(input: Readonly<{ workspace: string; delegationAuthority: DelegationAuthority; principalRegistry: PrincipalRegistry; now?: Date }>): Promise<PrincipalCredential> {
  const activation = await loadActivation(input.workspace);
  const now = input.now ?? new Date();
  const binding = await input.delegationAuthority.resolveSessionBinding({ tenant: activation.authorityCellId, taskId: activation.taskId, principalId: activation.principalId });
  assertBinding(activation, binding, now);
  return input.principalRegistry.issue({ principalId: activation.principalId, taskId: activation.taskId, grantId: activation.grantId, grantDigest: activation.signedChildGrant.digest, allocationId: activation.allocationId, runtimeSessionId: activation.runtimeSessionId, jobId: activation.jobId, authorityCellId: activation.authorityCellId, expiresAt: binding.expiresAt });
}

export interface CertificationDispatchPermit { readonly kind: "certification-dispatch-permit" }
export interface CertificationCellHost {
  activateRootTask(input: Readonly<{ jobCard: unknown; jobCardTrustPin: JobCardTrustPinV1; constraints: DelegationConstraints; effects: number; issuedAt: string; expiresAt: string }>): Promise<CertificationCellActivationV1>;
  activatePrincipalSession(): Promise<PrincipalCredential>;
  verifyDispatchReadiness(input: Readonly<{ scenario: CertificationScenarioId; bearerToken: string }>): Promise<CertificationDispatchPermit>;
  revalidateDispatchPermit(permit: CertificationDispatchPermit): Promise<void>;
}
export interface CertificationCellHostInternalState {
  readonly workspace: string;
  readonly currentTrustPinPath: string;
  readonly delegationAuthority: DelegationAuthority;
  readonly principalRegistry: PrincipalRegistry;
  readonly now?: () => Date;
  issueHermeticGitHubPermit(bearerToken: string): Promise<object>;
  revalidateHermeticGitHubPermit(permit: object): Promise<void>;
  hermeticGitHubPermitSnapshot(permit: object): Readonly<{ digest: string; adapterContractDigest: string }>;
  hermeticGitHubAuthority(): CertificationHermeticGitHubAuthorityState;
}
interface CertificationHermeticGitHubAuthorityState {
  readonly contractDescriptor: AuthorityKeyDescriptorV1;
  readonly gateDescriptor: AuthorityKeyDescriptorV1;
  readonly journalDescriptor: AuthorityKeyDescriptorV1;
  signContract(digest: string): AuthoritySignature;
  signGate(digest: string): AuthoritySignature;
  signJournal(digest: string): AuthoritySignature;
  readonly lifecycle: CertificationLifecycleAuthorityMaterial;
  readonly binding: CertificationArtifactKeyBindingV1;
  readonly commitment: CertificationArtifactKeyBindingCommitmentV1;
  readonly keyDescriptors: readonly AuthorityKeyDescriptorV1[];
  readonly signedReadiness: unknown;
}
interface CertificationLifecycleAuthorityInput { readonly handle: CertificationLifecycleAuthorityHandle; readonly binding: CertificationArtifactKeyBindingV1; readonly commitment: CertificationArtifactKeyBindingCommitmentV1 }
const certificationCellHosts = new WeakMap<object, CertificationCellHostInternalState>();
export async function createCertificationCellHost(input: Readonly<{ workspace: string; currentTrustPinPath: string; delegationAuthority: DelegationAuthority; principalRegistry: PrincipalRegistry; now?: () => Date; lifecycleAuthority?: CertificationLifecycleAuthorityInput }>): Promise<CertificationCellHost> {
  assertLinuxAuthorityCellHost();
  const hostKeys = ["workspace", "currentTrustPinPath", "delegationAuthority", "principalRegistry", ...(input.now === undefined ? [] : ["now"]), ...(input.lifecycleAuthority === undefined ? [] : ["lifecycleAuthority"])];
  closedOwnKeys(input, hostKeys, "certification Cell host input");
  const loaded = await loadInitialization(input.workspace);
  const workspace = loaded.root;
  const configuredTrustPinPath = await canonicalExternalTrustPin(workspace, input.currentTrustPinPath);
  const currentTrustPinPathDigest = trustPinPathDigest(configuredTrustPinPath);
  if (!input.lifecycleAuthority) throw new TypeError("opaque certification lifecycle authority is required");
  const hermeticAuthority = await bindHermeticGitHubAuthority(configuredTrustPinPath, input.lifecycleAuthority, loaded.initialization.identifiers, input.now?.() ?? new Date());
  const host: CertificationCellHost = {
    activateRootTask: async (values: Parameters<CertificationCellHost["activateRootTask"]>[0]) => {
      assertLinuxAuthorityCellHost();
      const lifecycleDelegation = hermeticAuthority.lifecycle.direct.get("delegation-grant")!;
      const expected = ["jobCard", "jobCardTrustPin", "constraints", "effects", "issuedAt", "expiresAt"];
      closedOwnKeys(values, expected, "certification root activation input");
      return activateCertificationRootTask({ jobCard: values.jobCard, jobCardTrustPin: values.jobCardTrustPin, delegationKeyDescriptor: lifecycleDelegation.descriptor, delegationPrivateKey: lifecycleDelegation.privateKey, constraints: values.constraints, effects: values.effects, issuedAt: values.issuedAt, expiresAt: values.expiresAt, workspace, currentTrustPinPath: configuredTrustPinPath, currentTrustPinPathDigest, delegationAuthority: input.delegationAuthority });
    },
    activatePrincipalSession: (...args: []) => {
      if (args.length !== 0) return Promise.reject(new TypeError("certification principal activation accepts no arguments"));
      return activateCertificationPrincipalSession({ workspace, delegationAuthority: input.delegationAuthority, principalRegistry: input.principalRegistry, now: input.now?.() });
    },
    verifyDispatchReadiness: (values: Parameters<CertificationCellHost["verifyDispatchReadiness"]>[0]) => {
      try { closedOwnKeys(values, ["scenario", "bearerToken"], "certification readiness request"); } catch (error) { return Promise.reject(error); }
      return verifyCertificationDispatchReadiness({ scenario: values.scenario, bearerToken: values.bearerToken, workspace, currentTrustPinPath: configuredTrustPinPath, currentTrustPinPathDigest, delegationAuthority: input.delegationAuthority, principalRegistry: input.principalRegistry, now: input.now });
    },
    revalidateDispatchPermit: (permit: CertificationDispatchPermit, ...args: []) => args.length === 0 ? revalidateCertificationDispatchPermit(permit) : Promise.reject(new TypeError("certification permit revalidation accepts one argument")),
  };
  const frozen = Object.freeze(host);
  const hermeticInput = { scenario: "github-issue-labels" as const, workspace, currentTrustPinPath: configuredTrustPinPath, currentTrustPinPathDigest, delegationAuthority: input.delegationAuthority, principalRegistry: input.principalRegistry, now: input.now };
  certificationCellHosts.set(frozen, Object.freeze({ workspace, currentTrustPinPath: configuredTrustPinPath, delegationAuthority: input.delegationAuthority, principalRegistry: input.principalRegistry, ...(input.now ? { now: input.now } : {}), issueHermeticGitHubPermit: (bearerToken: string) => issueHermeticGitHubPermit({ ...hermeticInput, bearerToken }), revalidateHermeticGitHubPermit, hermeticGitHubPermitSnapshot, hermeticGitHubAuthority: () => hermeticAuthority }));
  return frozen;
}

/** Compatibility-only activation host. It cannot compose runners, permits, receipts, or graphs. */
export interface LegacyCertificationActivationHost {
  activateRootTask(input: Readonly<{ jobCard: unknown; jobCardTrustPin: JobCardTrustPinV1; delegationKeyDescriptor: unknown; delegationPrivateKey: KeyObject; constraints: DelegationConstraints; effects: number; issuedAt: string; expiresAt: string }>): Promise<CertificationCellActivationV1>;
  activatePrincipalSession(): Promise<PrincipalCredential>;
}

export async function createLegacyCertificationActivationHost(input: Readonly<{ workspace: string; currentTrustPinPath: string; delegationAuthority: DelegationAuthority; principalRegistry: PrincipalRegistry; now?: () => Date }>): Promise<LegacyCertificationActivationHost> {
  assertLinuxAuthorityCellHost();
  closedOwnKeys(input, ["workspace", "currentTrustPinPath", "delegationAuthority", "principalRegistry", ...(input.now === undefined ? [] : ["now"])], "legacy certification activation host input");
  const loaded = await loadInitialization(input.workspace), workspace = loaded.root;
  const configuredTrustPinPath = await canonicalExternalTrustPin(workspace, input.currentTrustPinPath), currentTrustPinPathDigest = trustPinPathDigest(configuredTrustPinPath);
  return Object.freeze({
    activateRootTask: async (values: Parameters<LegacyCertificationActivationHost["activateRootTask"]>[0]) => { closedOwnKeys(values, ["jobCard", "jobCardTrustPin", "delegationKeyDescriptor", "delegationPrivateKey", "constraints", "effects", "issuedAt", "expiresAt"], "legacy certification root activation input"); return activateCertificationRootTask({ jobCard: values.jobCard, jobCardTrustPin: values.jobCardTrustPin, delegationKeyDescriptor: values.delegationKeyDescriptor, delegationPrivateKey: values.delegationPrivateKey, constraints: values.constraints, effects: values.effects, issuedAt: values.issuedAt, expiresAt: values.expiresAt, workspace, currentTrustPinPath: configuredTrustPinPath, currentTrustPinPathDigest, delegationAuthority: input.delegationAuthority }); },
    activatePrincipalSession: (...args: []) => args.length === 0 ? activateCertificationPrincipalSession({ workspace, delegationAuthority: input.delegationAuthority, principalRegistry: input.principalRegistry, now: input.now?.() }) : Promise.reject(new TypeError("legacy certification principal activation accepts no arguments")),
  });
}
/** Non-barrel host composition bridge. It authenticates the real Cell instance by object identity. */
export function certificationCellHostInternalState(host: CertificationCellHost): CertificationCellHostInternalState {
  const state = certificationCellHosts.get(host as object);
  if (!state) throw new TypeError("genuine branded CertificationCellHost required");
  return state;
}
type EndpointCapability = Readonly<{ endpointId: string; direction: "read" | "write"; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" }>;
class OpaquePermit implements CertificationDispatchPermit {
  readonly kind = "certification-dispatch-permit" as const;
  toJSON(): never { throw new TypeError("certification dispatch permit is opaque and nonserializable"); }
}
interface DispatchSnapshot { readonly digest: string; readonly adapterContractDigest: string; readonly scenarioId: CertificationScenarioId; readonly runnerId: string; readonly metadataDigest: string; readonly endpointManifestDigest: string; readonly capabilities: readonly EndpointCapability[] }
const permitState = new WeakMap<object, Readonly<{ snapshot: DispatchSnapshot; revalidate: () => Promise<DispatchSnapshot> }>>();
const hermeticPermitState = new WeakMap<object, Readonly<{ snapshot: DispatchSnapshot; revalidate: () => Promise<DispatchSnapshot> }>>();

async function verifyCertificationDispatchReadiness(input: Readonly<{
  workspace: string;
  scenario: CertificationScenarioId;
  bearerToken: string;
  currentTrustPinPath: string;
  currentTrustPinPathDigest: string;
  delegationAuthority: DelegationAuthority;
  principalRegistry: PrincipalRegistry;
  now?: () => Date;
}>): Promise<CertificationDispatchPermit> {
  const revalidate = async () => dispatchSnapshot(input, "ordinary");
  const snapshot = await revalidate();
  const permit = Object.freeze(new OpaquePermit());
  permitState.set(permit, Object.freeze({ snapshot, revalidate }));
  return permit;
}

async function issueHermeticGitHubPermit(input: Readonly<{ workspace: string; scenario: "github-issue-labels"; bearerToken: string; currentTrustPinPath: string; currentTrustPinPathDigest: string; delegationAuthority: DelegationAuthority; principalRegistry: PrincipalRegistry; now?: () => Date }>): Promise<object> {
  const revalidate = async () => dispatchSnapshot(input, "hermetic-github");
  const snapshot = await revalidate();
  const permit = Object.freeze(Object.create(null));
  hermeticPermitState.set(permit, Object.freeze({ snapshot, revalidate }));
  return permit;
}

async function revalidateHermeticGitHubPermit(permit: object): Promise<void> {
  const state = hermeticPermitState.get(permit);
  if (!state) throw new TypeError("hermetic GitHub dispatch permit is invalid or already used");
  hermeticPermitState.delete(permit);
  const current = await state.revalidate();
  if (current.digest !== state.snapshot.digest) throw new TypeError("hermetic GitHub dispatch state became stale");
}

function hermeticGitHubPermitSnapshot(permit: object): Readonly<{ digest: string; adapterContractDigest: string }> {
  const state = hermeticPermitState.get(permit);
  if (!state) throw new TypeError("hermetic GitHub dispatch permit is invalid or already used");
  return Object.freeze({ digest: state.snapshot.digest, adapterContractDigest: state.snapshot.adapterContractDigest });
}

async function bindHermeticGitHubAuthority(pinPath: string, input: CertificationLifecycleAuthorityInput, identifiers: CertificationIdentifiers, now: Date): Promise<CertificationHermeticGitHubAuthorityState> {
  closedOwnKeys(input, ["handle", "binding", "commitment"], "hermetic GitHub lifecycle authority input");
  const pin = JSON.parse((await readUnlinkedFile(pinPath)).toString("utf8")) as JobCardTrustPinV1;
  verifySignedCertificationReadiness({ signed: pin.signedReadiness, readinessCandidate: pin.readinessCandidate, preflight: pin.preflight, humanTrustRoot: pin.humanTrustRoot, keyDescriptors: pin.keyDescriptors, trustEvents: pin.readinessTrustEvents });
  const descriptors = pin.keyDescriptors.map(parseAuthorityKeyDescriptor);
  const events = parseTrustEvents(pin.currentTrustEvents, descriptors);
  const active = new Set<string>();
  for (const event of events) event.action === "activate" ? active.add(event.keyDescriptorDigest) : active.delete(event.keyDescriptorDigest);
  const required = ["outcome-contract", "gate-event", "authority-journal", "authority-evidence", "authority-receipt", "delegation-grant"];
  const selected = required.map(purpose => descriptors.find(item => item.role === "authority-cell" && item.purpose === purpose));
  if (selected.some(item => !item) || new Set(selected.map(item => item!.keyId)).size !== required.length) throw new TypeError("hermetic GitHub lifecycle authority descriptors are absent or not purpose-separated");
  for (const descriptor of selected as AuthorityKeyDescriptorV1[]) {
    const digest = authorityDigest(descriptor);
    const pinned = descriptors.find(candidate => authorityDigest(candidate) === digest);
    if (!pinned || !active.has(digest) || !pin.signedReadiness.activatedCellKeyDescriptorDigests.includes(digest)) throw new TypeError("hermetic GitHub signer descriptor is not activated by signed readiness and current trust");
  }
  const human = descriptors.find(item => item.keyId === pin.signedReadiness.signerKeyId)!;
  const lifecycle = consumeCertificationLifecycleAuthority(input.handle, input.binding, input.commitment, { authorityCellId: identifiers.authorityCellId, taskId: identifiers.taskId, readinessDigest: authorityDigest(pin.signedReadiness), descriptors: selected as AuthorityKeyDescriptorV1[], humanDescriptor: human, now });
  const get = <P extends "outcome-contract" | "gate-event" | "authority-journal">(purpose: P) => lifecycle.direct.get(purpose)!;
  const contract = get("outcome-contract"), gate = get("gate-event"), journal = get("authority-journal");
  return Object.freeze({ contractDescriptor: contract.descriptor, gateDescriptor: gate.descriptor, journalDescriptor: journal.descriptor, signContract: (digest: string) => signAuthorityDigest(contract.privateKey, "outcome-contract", digest), signGate: (digest: string) => signAuthorityDigest(gate.privateKey, "gate-event", digest), signJournal: (digest: string) => signAuthorityDigest(journal.privateKey, "authority-journal", digest), lifecycle, binding: input.binding, commitment: input.commitment, keyDescriptors: descriptors, signedReadiness: pin.signedReadiness });
}

async function revalidateCertificationDispatchPermit(permit: CertificationDispatchPermit): Promise<void> {
  const state = permitState.get(permit as object);
  if (!state) throw new TypeError("certification dispatch permit is invalid or already used");
  permitState.delete(permit as object);
  const current = await state.revalidate();
  if (current.digest !== state.snapshot.digest) throw new TypeError("certification dispatch state became stale");
}

async function dispatchSnapshot(input: Readonly<{ workspace: string; scenario: CertificationScenarioId; bearerToken: string; currentTrustPinPath: string; currentTrustPinPathDigest: string; delegationAuthority: DelegationAuthority; principalRegistry: PrincipalRegistry; now?: () => Date }>, mode: "ordinary" | "hermetic-github"): Promise<DispatchSnapshot> {
  if (!(CERTIFICATION_SCENARIO_IDS as readonly string[]).includes(input.scenario)) throw new TypeError("certification dispatch scenario is invalid");
  const state = await loadInitialization(input.workspace);
  if (!state.initialization.scenarios.includes(input.scenario)) throw new TypeError("certification dispatch scenario was not selected");
  const activation = await loadActivation(input.workspace);
  const authorityRoot = await requireAuthorityRoot(state.root);
  const deployment = await requireDirectory(authorityRoot, ["deployment"]);
  const trustDirectory = await requireDirectory(authorityRoot, ["trust"]);
  const jobCard = normalizeSignedJobCard(JSON.parse((await readConfinedFile(authorityRoot, deployment, "job-card.json")).toString("utf8")));
  const activationPin = JSON.parse((await readConfinedFile(authorityRoot, trustDirectory, "job-card-trust-pin.json")).toString("utf8")) as JobCardTrustPinV1;
  const currentTrustPinPath = await canonicalExternalTrustPin(state.root, input.currentTrustPinPath);
  const configuredDigest = trustPinPathDigest(currentTrustPinPath);
  if (configuredDigest !== input.currentTrustPinPathDigest || configuredDigest !== activation.currentTrustPinPathDigest) throw new TypeError("operator current trust pin path commitment was substituted");
  const pin = JSON.parse((await readUnlinkedFile(currentTrustPinPath)).toString("utf8")) as JobCardTrustPinV1;
  if (authorityDigest(pin.signedReadiness) !== authorityDigest(activationPin.signedReadiness) || authorityDigest(pin.readinessCandidate) !== authorityDigest(activationPin.readinessCandidate) || authorityDigest(pin.preflight) !== authorityDigest(activationPin.preflight) || authorityDigest(pin.keyDescriptors) !== authorityDigest(activationPin.keyDescriptors)) throw new TypeError("operator current trust pin changed immutable readiness authority");
  const currentEvents = parseTrustEvents(pin.currentTrustEvents, pin.keyDescriptors);
  await observeCurrentTrust(authorityRoot, activation, currentEvents);
  const currentTrust = verifyCurrentJobCardTrust(jobCard, pin);
  if (activation.signedJobCardDigest !== signedJobCardDigest(jobCard) || activation.signedReadinessDigest !== authorityDigest(pin.signedReadiness) || activation.jobId !== jobCard.jobId || activation.authorityCellId !== state.initialization.identifiers.authorityCellId) throw new TypeError("certification activation Job Card or readiness state was substituted");
  const grant = activation.signedRootGrant.grant as DelegationGrant;
  const delegationDescriptor = pin.keyDescriptors.map(parseAuthorityKeyDescriptor).find(item => authorityDigest(item) === activation.signerKeyDescriptorDigest);
  if (!delegationDescriptor || delegationDescriptor.keyId !== activation.signerKeyId || delegationDescriptor.role !== "authority-cell" || delegationDescriptor.purpose !== "delegation-grant" || !currentTrust.activeDescriptorDigests.has(activation.signerKeyDescriptorDigest) || !pin.signedReadiness.activatedCellKeyDescriptorDigests.includes(activation.signerKeyDescriptorDigest) || !verifyAuthoritySignature(publicKeyFor(delegationDescriptor), "delegation-grant", activation.signedRootGrant.digest, activation.signedRootGrant.signature) || !verifyAuthoritySignature(publicKeyFor(delegationDescriptor), "delegation-grant", activation.signedChildGrant.digest, activation.signedChildGrant.signature)) throw new TypeError("certification root/child grant signer is stale, revoked, or substituted");
  if (activation.constraintsDigest !== authorityDigest(grant.constraints) || jobCard.limitsDigest !== authorityDigest(grant.constraints.limits) || jobCard.taskShapeDigest !== certificationTaskShapeDigest({ identifiers: state.initialization.identifiers, scenarios: state.initialization.scenarios, constraints: grant.constraints })) throw new TypeError("certification active root constraints do not match Job Card commitments");
  const registeredRunner = getCertificationRunnerRegistryEntry(input.scenario);
  if (mode === "ordinary" && (!registeredRunner.executionReady || !registeredRunner.dispatchable)) throw new TypeError("Task 4A certification runner metadata is configured but provider execution is unavailable and non-dispatchable");
  if (mode === "hermetic-github" && input.scenario !== "github-issue-labels") throw new TypeError("hermetic permit is restricted to GitHub issue labels");
  const status = await input.delegationAuthority.taskStatus({ tenant: activation.authorityCellId, requester: grant.sponsor, taskId: activation.taskId });
  if (status.lifecycleState !== "active") throw new TypeError("certification task is revoked or inactive");
  const binding = await input.delegationAuthority.resolveSessionBinding({ tenant: activation.authorityCellId, taskId: activation.taskId, principalId: activation.principalId });
  const now = input.now?.() ?? new Date();
  assertBinding(activation, binding, now);
  const principal = await input.principalRegistry.resolve(input.bearerToken, now);
  if (authorityDigest(principal) !== authorityDigest({ tenant: activation.authorityCellId, principalId: activation.principalId, taskId: activation.taskId, grantId: activation.grantId, grantDigest: activation.signedChildGrant.digest, allocationId: activation.allocationId, runtimeSessionId: activation.runtimeSessionId, jobId: activation.jobId, authorityCellId: activation.authorityCellId, expiresAt: binding.expiresAt, sessionTokenDigest: principal.sessionTokenDigest })) throw new TypeError("certification principal context does not match active authority state");
  const allocation = await input.delegationAuthority.budget.get(activation.allocationId);
  if (!allocation || allocation.revoked || allocation.taskId !== activation.taskId || allocation.remaining < 1) throw new TypeError("certification effect allocation is exhausted or inactive");
  const preflight = await preflightCertification({ workspace: state.root, all: true });
  if (!preflight.preparationReady || preflight.completeness !== "unchecked") throw new TypeError("certification semantic runner or test readiness is incomplete");
  const readinessPreflightDigest = (pin.readinessCandidate as { readonly preflightDigest?: unknown }).preflightDigest;
  const pinnedPreflightDigest = (pin.preflight as { readonly digest?: unknown }).digest;
  if (preflight.digest !== readinessPreflightDigest || preflight.digest !== pinnedPreflightDigest) throw new TypeError("certification semantic manifests drifted from signed readiness preflight commitment");
  const endpointDirectory = await requireDirectory(authorityRoot, ["endpoints"]);
  const endpoint = parseCertificationEndpointManifest(JSON.parse((await readConfinedFile(authorityRoot, endpointDirectory, `${input.scenario}.json`)).toString("utf8")), input.scenario);
  const derivedEndpoint = deriveCertificationEndpointManifest(state.config, input.scenario);
  if (authorityDigest(endpoint) !== authorityDigest(derivedEndpoint)) throw new TypeError("certification endpoint manifest does not match sanitized signed configuration");
  const inputRoot = await requireDirectory(state.root, ["inputs"]);
  const runnerDirectory = await requireDirectory(state.root, ["inputs", "runners"]);
  const testDirectory = await requireDirectory(state.root, ["inputs", "tests"]);
  const planDirectory = await requireDirectory(state.root, ["inputs", "plans"]);
  void inputRoot;
  const runnerArtifact = preflight.inputs.runners.artifacts.find(item => item.scenario === input.scenario)!;
  const testArtifact = preflight.inputs.tests.artifacts.find(item => item.scenario === input.scenario)!;
  const planArtifact = preflight.inputs.plans.artifacts.find(item => item.scenario === input.scenario)!;
  const runnerBytes = await readConfinedFile(state.root, runnerDirectory, runnerArtifact.name);
  const runner = parseCertificationRunnerManifest(JSON.parse(runnerBytes.toString("utf8")), input.scenario);
  if (runner.v !== "reelier.certification-runner-manifest/v2" || (mode === "ordinary" && !runner.dispatchable) || (mode === "hermetic-github" && runner.dispatchable) || runner.registryDigest !== certificationRunnerRegistryDigest || runner.endpointManifestDigest !== authorityDigest(endpoint)) throw new TypeError("certification runner endpoint or registry commitment mismatch");
  const tests = parseCertificationTestManifest(JSON.parse((await readConfinedFile(state.root, testDirectory, testArtifact.name)).toString("utf8")), input.scenario, runnerArtifact.digest);
  if (tests.runnerManifestDigest !== runnerArtifact.digest) throw new TypeError("certification tests do not bind the selected runner");
  const plan = parseCertificationScenarioPlan(JSON.parse((await readConfinedFile(state.root, planDirectory, planArtifact.name)).toString("utf8")), state.config, preflight.scenarios);
  if (plan.runnerManifestDigest !== runnerArtifact.digest || plan.testManifestDigest !== testArtifact.digest || plan.endpointManifestDigest !== authorityDigest(endpoint) || plan.runnerRegistryDigest !== certificationRunnerRegistryDigest) throw new TypeError("certification scenario plan drifted from signed runner, test, endpoint, or registry authority");
  const capabilities = normalizeCapabilities(endpoint.endpoints);
  const digest = authorityDigest({ v: "reelier.certification-dispatch-snapshot/v1", adapterContractDigest: AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST, activation: authorityDigest(activation), jobCard: signedJobCardDigest(jobCard), readiness: authorityDigest(pin.signedReadiness), trustHead: authorityDigest(currentEvents[currentEvents.length - 1]), task: status.lifecycleState, principal: authorityDigest(principal), allocation: { effects: allocation.effects, consumed: allocation.consumed, remaining: allocation.remaining, revoked: allocation.revoked }, preflight: preflight.digest, endpoint: authorityDigest(endpoint), runner: runnerArtifact.digest, tests: testArtifact.digest, plan: planArtifact.digest, runnerRegistry: certificationRunnerRegistryDigest, dispatchMode: mode, completeness: "unchecked" });
  return Object.freeze({ digest, adapterContractDigest: AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST, scenarioId: input.scenario, runnerId: runner.runnerId, metadataDigest: runner.metadataDigest, endpointManifestDigest: runner.endpointManifestDigest, capabilities });
}

async function loadInitialization(workspace: string) {
  const root = await certificationWorkspaceRoot(path.resolve(workspace));
  const config = parseCertificationOperatorConfigV3(JSON.parse((await readConfinedFile(root, root, "config.json")).toString("utf8")));
  const initialization = parseCertificationInitialization(JSON.parse((await readConfinedFile(root, root, "initialization.json")).toString("utf8")));
  validateCertificationInitialization(config, initialization);
  return { root, config, initialization };
}
async function loadActivation(workspace: string): Promise<CertificationCellActivationV1> {
  const state = await loadInitialization(workspace);
  const authorityRoot = await requireAuthorityRoot(state.root);
  const delegation = await requireDirectory(authorityRoot, ["delegation"]);
  return parseActivation(JSON.parse((await readConfinedFile(authorityRoot, delegation, "root-activation.json")).toString("utf8")), state.initialization.identifiers);
}
function parseActivation(value: unknown, ids: CertificationIdentifiers): CertificationCellActivationV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("certification Cell activation must be an object");
  const raw = value as Record<string, any>;
  const fields = ["v", "taskId", "jobId", "grantId", "allocationId", "rootAllocationId", "authorityCellId", "principalId", "runtimeSessionId", "signerKeyId", "signerKeyDescriptorDigest", "signedReadinessDigest", "signedJobCardDigest", "constraintsDigest", "currentTrustEventCount", "currentTrustHistoryDigest", "currentTrustHeadDigest", "currentTrustPinPathDigest", "effects", "signedRootGrant", "signedChildGrant", "completeness", "dispatchable"];
  if (Object.keys(raw).sort().join("\0") !== fields.sort().join("\0") || raw.v !== "reelier.certification-cell-activation/v1" || raw.taskId !== ids.taskId || raw.jobId !== ids.jobCardId || raw.rootAllocationId !== ids.rootGrantId || raw.grantId !== `${ids.rootGrantId}_child` || raw.allocationId !== raw.grantId || raw.authorityCellId !== ids.authorityCellId || raw.completeness !== "unchecked" || raw.dispatchable !== false || !Number.isSafeInteger(raw.effects) || raw.effects < 1) throw new TypeError("certification Cell activation is closed and bound to generated identities");
  for (const field of ["signerKeyDescriptorDigest", "signedReadinessDigest", "signedJobCardDigest", "constraintsDigest", "currentTrustHistoryDigest", "currentTrustHeadDigest", "currentTrustPinPathDigest"] as const) if (!DIGEST.test(raw[field])) throw new TypeError("certification Cell activation digest is invalid");
  if (!Number.isSafeInteger(raw.currentTrustEventCount) || raw.currentTrustEventCount < 1) throw new TypeError("certification Cell activation trust count is invalid");
  const rootSignature = raw.signedRootGrant?.signature, childSignature = raw.signedChildGrant?.signature;
  const signatureBytes = rootSignature?.alg === "ed25519" && typeof rootSignature.sig === "string" ? Buffer.from(rootSignature.sig, "base64") : undefined;
  const childSignatureBytes = childSignature?.alg === "ed25519" && typeof childSignature.sig === "string" ? Buffer.from(childSignature.sig, "base64") : null;
  if (!raw.signedRootGrant || !signatureBytes || signatureBytes.length !== 64 || signatureBytes.toString("base64") !== rootSignature.sig || authorityDigest(raw.signedRootGrant.grant) !== raw.signedRootGrant.digest || raw.signedRootGrant.grant.grantId !== raw.rootAllocationId || raw.signedRootGrant.signerId !== raw.signerKeyId || authorityDigest(raw.signedRootGrant.grant.constraints) !== raw.constraintsDigest || !raw.signedChildGrant || !childSignatureBytes || childSignatureBytes.length !== 64 || authorityDigest(raw.signedChildGrant.grant) !== raw.signedChildGrant.digest || raw.signedChildGrant.grant.parentDigest !== raw.signedRootGrant.digest || raw.signedChildGrant.grant.grantId !== raw.grantId || raw.signedChildGrant.grant.grantee !== raw.principalId || raw.signedChildGrant.signerId !== raw.signerKeyId || raw.allocationId !== raw.grantId) throw new TypeError("certification Cell root/child grant link or canonical signature is invalid");
  return Object.freeze(raw as CertificationCellActivationV1);
}
function verifyCurrentJobCardTrust(jobCard: SignedJobCardV1, pin: JobCardTrustPinV1) {
  const verified = jobCardTrustMaterialFromPin(jobCard, pin);
  if (!verifySignedJobCard(jobCard, publicKeyFor(verified.signer))) throw new TypeError("certification signed Job Card trust verification failed");
  const events = parseTrustEvents(pin.currentTrustEvents, pin.keyDescriptors);
  return { activeDescriptorDigests: activeDescriptors(events) };
}
function activeDescriptors(events: ReturnType<typeof parseTrustEvents>): Set<string> { const states = new Map<string, string>(); for (const event of events) states.set(event.keyDescriptorDigest, event.action); return new Set([...states].filter(([, action]) => action === "activate").map(([digest]) => digest)); }
function normalizeCapabilities(values: readonly EndpointCapability[]): readonly EndpointCapability[] {
  const parsed = values.map(value => {
    if (!value || typeof value.endpointId !== "string" || (value.direction !== "read" && value.direction !== "write") || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(value.method)) throw new TypeError("certified runner capability is invalid");
    return Object.freeze({ endpointId: value.endpointId, direction: value.direction, method: value.method });
  }).sort((left, right) => left.endpointId.localeCompare(right.endpointId));
  if (parsed.length === 0 || new Set(parsed.map(item => item.endpointId)).size !== parsed.length) throw new TypeError("certified runner capabilities must be nonempty and unique");
  return Object.freeze(parsed);
}
async function canonicalExternalTrustPin(workspaceRoot: string, requested: string): Promise<string> {
  const resolved = path.resolve(requested);
  await readUnlinkedFile(resolved);
  const canonical = await realpath(resolved);
  const relative = path.relative(workspaceRoot, canonical);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw new TypeError("operator current trust pin must remain outside certification workspace output");
  return canonical;
}
function trustPinPathDigest(canonicalPath: string): string { return authorityDigest({ v: "reelier.certification-trust-pin-path/v1", canonicalPath }); }
function closedOwnKeys(value: unknown, expected: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a closed plain object`);
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== "string") || keys.length !== expected.length || keys.some(key => !expected.includes(key as string))) throw new TypeError(`${label} is closed`);
}
async function observeCurrentTrust(authorityRoot: string, activation: CertificationCellActivationV1, events: ReturnType<typeof parseTrustEvents>): Promise<void> {
  if (events.length < activation.currentTrustEventCount || authorityDigest(events.slice(0, activation.currentTrustEventCount)) !== activation.currentTrustHistoryDigest || authorityDigest(events[activation.currentTrustEventCount - 1]) !== activation.currentTrustHeadDigest) throw new TypeError("operator current trust history rolled back or does not extend activation");
  const directory = await requireDirectory(authorityRoot, ["trust"]);
  const filename = "current-trust-observation.json";
  let prior: { count: number; historyDigest: string } | undefined;
  try { prior = JSON.parse((await readConfinedFile(authorityRoot, directory, filename)).toString("utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (prior && (!Number.isSafeInteger(prior.count) || prior.count < activation.currentTrustEventCount || prior.count > events.length || authorityDigest(events.slice(0, prior.count)) !== prior.historyDigest)) throw new TypeError("operator current trust history rollback detected");
  if (prior?.count === events.length) return;
  const observation = { v: "reelier.certification-current-trust-observation/v1", count: events.length, historyDigest: authorityDigest(events), headDigest: authorityDigest(events[events.length - 1]) };
  const temporary = path.join(directory, `.${filename}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(observation)}\n`, { flag: "wx", mode: 0o600 });
  await rename(temporary, path.join(directory, filename));
}
function publicKeyFor(descriptor: AuthorityKeyDescriptorV1): KeyObject { return createPublicKey({ key: Buffer.from(descriptor.publicKeySpkiBase64, "base64"), format: "der", type: "spki" }); }
function deriveId(kind: "principal" | "session", ids: CertificationIdentifiers): string { return `${kind}_${authorityDigest({ v: `reelier.certification-${kind}-id/v1`, taskId: ids.taskId, authorityCellId: ids.authorityCellId }).slice(7, 31)}`; }
function canonicalTime(value: string): string { const time = Date.parse(value); if (!Number.isFinite(time)) throw new TypeError("certification activation time is invalid"); const canonical = new Date(time).toISOString(); if (canonical !== value) throw new TypeError("certification activation time must be canonical"); return canonical; }
function assertBinding(activation: CertificationCellActivationV1, binding: Awaited<ReturnType<DelegationAuthority["resolveSessionBinding"]>>, now: Date): void { if (binding.lifecycleState !== "allocated" || binding.taskId !== activation.taskId || binding.grantId !== activation.grantId || binding.grantDigest !== activation.signedChildGrant.digest || binding.grantee !== activation.principalId || binding.allocationId !== activation.allocationId || binding.effects !== activation.effects || Date.parse(binding.expiresAt) <= now.getTime()) throw new TypeError("certification principal binding is stale, revoked, substituted, or exhausted"); }
async function requireAuthorityRoot(root: string): Promise<string> { return requireDirectory(root, ["authority"]); }
async function requireDirectory(root: string, segments: readonly string[]): Promise<string> { const directory = await confinedExistingDirectory(root, segments); if (!directory) throw new TypeError("certification Cell durable directory is absent"); return directory; }
async function publishExact(root: string, directory: string, filename: string, value: unknown): Promise<void> { const content = `${JSON.stringify(value)}\n`; await publishPrivateContentAddressed(root, directory, filename, content); const target = await requireDirectory(root, [directory]); const observed = await readConfinedFile(root, target, filename); if (observed.toString("utf8") !== content) throw new TypeError("certification Cell activation conflict"); }
