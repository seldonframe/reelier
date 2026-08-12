import { createPublicKey, randomUUID, type KeyObject } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest, parseAuthorityWire } from "../wire.js";
import { signAuthorityDigest, verifyAuthoritySignature } from "../crypto.js";
import { normalizeSignedJobCard, signedJobCardDigest, verifySignedJobCard, type SignedJobCardV1 } from "../job.js";
import type { DelegationConstraints, DelegationGrant } from "../types.js";
import type { StoredSignedGrant } from "../delegation.js";
import { jobCardTrustMaterialFromPin, type JobCardTrustPinV1 } from "../host/deployment.js";
import type { DelegationAuthority } from "../host/delegation-service.js";
import type { PrincipalCredential, PrincipalRegistry } from "../host/principal-registry.js";
import { parseAuthorityKeyDescriptor, parseTrustEvents, type AuthorityKeyDescriptorV1 } from "./authority.js";
import { parseCertificationOperatorConfigV2 } from "./config.js";
import { certificationWorkspaceRoot, confinedExistingDirectory, publishPrivateContentAddressed, readConfinedFile, readUnlinkedFile } from "./filesystem.js";
import { deriveCertificationEndpointManifest, parseCertificationInitialization, validateCertificationInitialization, type CertificationIdentifiers } from "./initializer.js";
import { parseCertificationEndpointManifest, parseCertificationRunnerManifest, parseCertificationTestManifest } from "./manifests.js";
import { preflightCertification } from "./preflight.js";
import { CERTIFICATION_SCENARIO_IDS, type CertificationScenarioId } from "./scenarios.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface CertificationCellActivationV1 {
  readonly v: "reelier.certification-cell-activation/v1";
  readonly taskId: string;
  readonly jobId: string;
  readonly grantId: string;
  readonly allocationId: string;
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
  readonly effects: number;
  readonly signedRootGrant: StoredSignedGrant;
  readonly completeness: "unchecked";
  readonly dispatchable: false;
}

export function certificationTaskShapeDigest(input: Readonly<{ identifiers: CertificationIdentifiers; scenarios: readonly CertificationScenarioId[]; constraints: DelegationConstraints }>): string {
  return authorityDigest({ v: "reelier.certification-task-shape/v1", identifiers: input.identifiers, scenarios: input.scenarios, constraints: input.constraints });
}

export async function activateCertificationRootTask(input: Readonly<{
  workspace: string;
  jobCard: unknown;
  jobCardTrustPin: JobCardTrustPinV1;
  delegationKeyDescriptor: unknown;
  delegationPrivateKey: KeyObject;
  constraints: DelegationConstraints;
  effects: number;
  issuedAt: string;
  expiresAt: string;
  delegationAuthority: DelegationAuthority;
}>): Promise<CertificationCellActivationV1> {
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
  const principalId = deriveId("principal", identifiers);
  const runtimeSessionId = deriveId("session", identifiers);
  const grant = parseAuthorityWire("delegation-grant", { v: "reelier.delegation-grant/v1", tenant: identifiers.authorityCellId, grantId: identifiers.rootGrantId, parentDigest: null, sponsor: jobCard.signerId, grantor: delegation.keyId, grantee: principalId, issuedAt: canonicalTime(input.issuedAt), expiresAt: canonicalTime(input.expiresAt), constraints, delegationPolicy: { mayDelegate: false, maxDepth: 0, maxFanOut: 0, maxChildDurationSeconds: 1, maxDelegatedEffects: 0 } });
  if (Date.parse(grant.expiresAt) <= Date.parse(grant.issuedAt)) throw new TypeError("certification root validity is invalid");
  const grantDigest = authorityDigest(grant);
  const signature = signAuthorityDigest(input.delegationPrivateKey, "delegation-grant", grantDigest);
  const publicKey = publicKeyFor(delegation);
  if (!verifyAuthoritySignature(publicKey, "delegation-grant", grantDigest, signature)) throw new TypeError("certification delegation private key does not match its descriptor");
  const signedRootGrant: StoredSignedGrant = Object.freeze({ grant, digest: grantDigest, signerId: delegation.keyId, signature });
  const currentTrustEvents = parseTrustEvents(input.jobCardTrustPin.currentTrustEvents, input.jobCardTrustPin.keyDescriptors);
  const activation: CertificationCellActivationV1 = Object.freeze({ v: "reelier.certification-cell-activation/v1", taskId: identifiers.taskId, jobId: identifiers.jobCardId, grantId: identifiers.rootGrantId, allocationId: identifiers.rootGrantId, authorityCellId: identifiers.authorityCellId, principalId, runtimeSessionId, signerKeyId: delegation.keyId, signerKeyDescriptorDigest: descriptorDigest, signedReadinessDigest: authorityDigest(readiness), signedJobCardDigest: signedJobCardDigest(jobCard), constraintsDigest: authorityDigest(constraints), currentTrustEventCount: currentTrustEvents.length, currentTrustHistoryDigest: authorityDigest(currentTrustEvents), currentTrustHeadDigest: authorityDigest(currentTrustEvents[currentTrustEvents.length - 1]), effects: input.effects, signedRootGrant, completeness: "unchecked", dispatchable: false });
  await input.delegationAuthority.registerRoot({ taskId: activation.taskId, allocationId: activation.allocationId, rootGrant: signedRootGrant, effects: input.effects });
  const authorityRoot = await requireAuthorityRoot(state.root);
  await publishExact(authorityRoot, "deployment", "job-card.json", jobCard);
  await publishExact(authorityRoot, "trust", "job-card-trust-pin.json", input.jobCardTrustPin);
  await publishExact(authorityRoot, "delegation", "root-activation.json", activation);
  return activation;
}

export async function activateCertificationPrincipalSession(input: Readonly<{ workspace: string; delegationAuthority: DelegationAuthority; principalRegistry: PrincipalRegistry; now?: Date }>): Promise<PrincipalCredential> {
  const activation = await loadActivation(input.workspace);
  const now = input.now ?? new Date();
  const binding = await input.delegationAuthority.resolveSessionBinding({ tenant: activation.authorityCellId, taskId: activation.taskId, principalId: activation.principalId });
  assertBinding(activation, binding, now);
  return input.principalRegistry.issue({ principalId: activation.principalId, taskId: activation.taskId, grantId: activation.grantId, grantDigest: activation.signedRootGrant.digest, allocationId: activation.allocationId, runtimeSessionId: activation.runtimeSessionId, jobId: activation.jobId, authorityCellId: activation.authorityCellId, expiresAt: binding.expiresAt });
}

export interface CertificationDispatchPermit { readonly kind: "certification-dispatch-permit" }
type EndpointCapability = Readonly<{ endpointId: string; direction: "read" | "write"; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" }>;
export interface CertifiedRunnerRegistration<T = unknown> { readonly scenarioId: CertificationScenarioId; readonly runnerId: string; readonly implementationDigest: string; readonly endpointManifestDigest: string; readonly dispatchMode: "hermetic-certification"; readonly capabilities: readonly EndpointCapability[]; readonly run: (context: Readonly<{ scenarioId: CertificationScenarioId; dispatchMode: "hermetic-certification"; capabilities: readonly EndpointCapability[] }>) => Promise<T> }
export interface CertifiedRunnerRegistry { register(registration: CertifiedRunnerRegistration): void }
const runnerRegistries = new WeakMap<object, Map<string, CertifiedRunnerRegistration>>();
export function createCertifiedRunnerRegistry(): CertifiedRunnerRegistry {
  const registry = Object.freeze({ register(registration: CertifiedRunnerRegistration): void {
    if (!registration || registration.dispatchMode !== "hermetic-certification" || typeof registration.run !== "function" || !DIGEST.test(registration.implementationDigest) || !DIGEST.test(registration.endpointManifestDigest) || !(CERTIFICATION_SCENARIO_IDS as readonly string[]).includes(registration.scenarioId) || !Array.isArray(registration.capabilities)) throw new TypeError("certified runner registration requires hermetic dispatch mode and exact identities");
    const normalized = normalizeCapabilities(registration.capabilities);
    const key = runnerKey(registration.scenarioId, registration.runnerId, registration.implementationDigest, registration.endpointManifestDigest);
    const entries = runnerRegistries.get(registry)!;
    if (entries.has(key)) throw new TypeError("certified runner registration already exists");
    entries.set(key, Object.freeze({ ...registration, capabilities: normalized }));
  } });
  runnerRegistries.set(registry, new Map());
  return registry;
}
class OpaquePermit implements CertificationDispatchPermit {
  readonly kind = "certification-dispatch-permit" as const;
  toJSON(): never { throw new TypeError("certification dispatch permit is opaque and nonserializable"); }
}
interface DispatchSnapshot { readonly digest: string; readonly scenarioId: CertificationScenarioId; readonly runnerId: string; readonly implementationDigest: string; readonly endpointManifestDigest: string; readonly capabilities: readonly EndpointCapability[] }
const permitState = new WeakMap<object, Readonly<{ snapshot: DispatchSnapshot; revalidate: () => Promise<DispatchSnapshot>; consume: () => Promise<void> }>>();

export async function verifyCertificationDispatchReadiness(input: Readonly<{
  workspace: string;
  scenario: CertificationScenarioId;
  bearerToken: string;
  currentTrustPinPath: string;
  delegationAuthority: DelegationAuthority;
  principalRegistry: PrincipalRegistry;
  credentialAvailable: (slot: string) => Promise<boolean>;
  now?: () => Date;
}>): Promise<CertificationDispatchPermit> {
  const revalidate = async () => dispatchSnapshot(input);
  const snapshot = await revalidate();
  const activation = await loadActivation(input.workspace);
  const reservationId = `certification_${randomUUID()}`;
  const permit = Object.freeze(new OpaquePermit());
  permitState.set(permit, Object.freeze({ snapshot, revalidate, consume: async () => { await input.delegationAuthority.budget.consumeOnce({ allocationId: activation.allocationId, reservationId, effects: 1 }); } }));
  return permit;
}

export async function runCertificationWithPermit<T>(permit: CertificationDispatchPermit, registry: CertifiedRunnerRegistry): Promise<T> {
  const state = permitState.get(permit as object);
  if (!state) throw new TypeError("certification dispatch permit is invalid or already used");
  permitState.delete(permit as object);
  const current = await state.revalidate();
  if (current.digest !== state.snapshot.digest) throw new TypeError("certification dispatch state became stale");
  const registrations = runnerRegistries.get(registry as object);
  if (!registrations) throw new TypeError("certified runner registry is invalid");
  const runner = registrations.get(runnerKey(current.scenarioId, current.runnerId, current.implementationDigest, current.endpointManifestDigest));
  if (!runner || authorityDigest(runner.capabilities) !== authorityDigest(current.capabilities)) throw new TypeError("exact certified hermetic runner is unavailable or capability-substituted");
  await state.consume();
  return runner.run(Object.freeze({ scenarioId: current.scenarioId, dispatchMode: "hermetic-certification", capabilities: current.capabilities })) as Promise<T>;
}

async function dispatchSnapshot(input: Readonly<{ workspace: string; scenario: CertificationScenarioId; bearerToken: string; currentTrustPinPath: string; delegationAuthority: DelegationAuthority; principalRegistry: PrincipalRegistry; credentialAvailable: (slot: string) => Promise<boolean>; now?: () => Date }>): Promise<DispatchSnapshot> {
  if (!(CERTIFICATION_SCENARIO_IDS as readonly string[]).includes(input.scenario)) throw new TypeError("certification dispatch scenario is invalid");
  const state = await loadInitialization(input.workspace);
  if (!state.initialization.scenarios.includes(input.scenario)) throw new TypeError("certification dispatch scenario was not selected");
  const activation = await loadActivation(input.workspace);
  const authorityRoot = await requireAuthorityRoot(state.root);
  const deployment = await requireDirectory(authorityRoot, ["deployment"]);
  const trustDirectory = await requireDirectory(authorityRoot, ["trust"]);
  const jobCard = normalizeSignedJobCard(JSON.parse((await readConfinedFile(authorityRoot, deployment, "job-card.json")).toString("utf8")));
  const activationPin = JSON.parse((await readConfinedFile(authorityRoot, trustDirectory, "job-card-trust-pin.json")).toString("utf8")) as JobCardTrustPinV1;
  const currentTrustPinPath = path.resolve(input.currentTrustPinPath);
  const relativePin = path.relative(authorityRoot, currentTrustPinPath);
  if (!relativePin.startsWith("..") && !path.isAbsolute(relativePin)) throw new TypeError("operator current trust pin must remain outside Authority Cell output");
  const pin = JSON.parse((await readUnlinkedFile(currentTrustPinPath)).toString("utf8")) as JobCardTrustPinV1;
  if (authorityDigest(pin.signedReadiness) !== authorityDigest(activationPin.signedReadiness) || authorityDigest(pin.readinessCandidate) !== authorityDigest(activationPin.readinessCandidate) || authorityDigest(pin.preflight) !== authorityDigest(activationPin.preflight) || authorityDigest(pin.keyDescriptors) !== authorityDigest(activationPin.keyDescriptors)) throw new TypeError("operator current trust pin changed immutable readiness authority");
  const currentEvents = parseTrustEvents(pin.currentTrustEvents, pin.keyDescriptors);
  await observeCurrentTrust(authorityRoot, activation, currentEvents);
  const currentTrust = verifyCurrentJobCardTrust(jobCard, pin);
  if (activation.signedJobCardDigest !== signedJobCardDigest(jobCard) || activation.signedReadinessDigest !== authorityDigest(pin.signedReadiness) || activation.jobId !== jobCard.jobId || activation.authorityCellId !== state.initialization.identifiers.authorityCellId) throw new TypeError("certification activation Job Card or readiness state was substituted");
  const grant = activation.signedRootGrant.grant as DelegationGrant;
  const delegationDescriptor = pin.keyDescriptors.map(parseAuthorityKeyDescriptor).find(item => authorityDigest(item) === activation.signerKeyDescriptorDigest);
  if (!delegationDescriptor || delegationDescriptor.keyId !== activation.signerKeyId || delegationDescriptor.role !== "authority-cell" || delegationDescriptor.purpose !== "delegation-grant" || !currentTrust.activeDescriptorDigests.has(activation.signerKeyDescriptorDigest) || !pin.signedReadiness.activatedCellKeyDescriptorDigests.includes(activation.signerKeyDescriptorDigest) || !verifyAuthoritySignature(publicKeyFor(delegationDescriptor), "delegation-grant", activation.signedRootGrant.digest, activation.signedRootGrant.signature)) throw new TypeError("certification root grant signer is stale, revoked, or substituted");
  if (activation.constraintsDigest !== authorityDigest(grant.constraints) || jobCard.limitsDigest !== authorityDigest(grant.constraints.limits) || jobCard.taskShapeDigest !== certificationTaskShapeDigest({ identifiers: state.initialization.identifiers, scenarios: state.initialization.scenarios, constraints: grant.constraints })) throw new TypeError("certification active root constraints do not match Job Card commitments");
  const status = await input.delegationAuthority.taskStatus({ tenant: activation.authorityCellId, requester: grant.sponsor, taskId: activation.taskId });
  if (status.lifecycleState !== "active") throw new TypeError("certification task is revoked or inactive");
  const binding = await input.delegationAuthority.resolveSessionBinding({ tenant: activation.authorityCellId, taskId: activation.taskId, principalId: activation.principalId });
  const now = input.now?.() ?? new Date();
  assertBinding(activation, binding, now);
  const principal = await input.principalRegistry.resolve(input.bearerToken, now);
  if (authorityDigest(principal) !== authorityDigest({ tenant: activation.authorityCellId, principalId: activation.principalId, taskId: activation.taskId, grantId: activation.grantId, grantDigest: activation.signedRootGrant.digest, allocationId: activation.allocationId, runtimeSessionId: activation.runtimeSessionId, jobId: activation.jobId, authorityCellId: activation.authorityCellId, expiresAt: binding.expiresAt, sessionTokenDigest: principal.sessionTokenDigest })) throw new TypeError("certification principal context does not match active authority state");
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
  void inputRoot;
  const runnerArtifact = preflight.inputs.runners.artifacts.find(item => item.scenario === input.scenario)!;
  const testArtifact = preflight.inputs.tests.artifacts.find(item => item.scenario === input.scenario)!;
  const runnerBytes = await readConfinedFile(state.root, runnerDirectory, runnerArtifact.name);
  const runner = parseCertificationRunnerManifest(JSON.parse(runnerBytes.toString("utf8")), input.scenario);
  if (runner.endpointManifestDigest !== authorityDigest(endpoint)) throw new TypeError("certification runner endpoint manifest commitment mismatch");
  const tests = parseCertificationTestManifest(JSON.parse((await readConfinedFile(state.root, testDirectory, testArtifact.name)).toString("utf8")), input.scenario, runnerArtifact.digest);
  if (tests.runnerManifestDigest !== runnerArtifact.digest) throw new TypeError("certification tests do not bind the selected runner");
  for (const slot of endpoint.credentialSlots) { let available = false; try { available = await input.credentialAvailable(slot); } catch { throw new TypeError("certification named credential is unavailable"); } if (!available) throw new TypeError("certification named credential is unavailable"); }
  const capabilities = normalizeCapabilities(endpoint.endpoints);
  const digest = authorityDigest({ v: "reelier.certification-dispatch-snapshot/v1", activation: authorityDigest(activation), jobCard: signedJobCardDigest(jobCard), readiness: authorityDigest(pin.signedReadiness), trustHead: authorityDigest(currentEvents[currentEvents.length - 1]), task: status.lifecycleState, principal: authorityDigest(principal), allocation: { effects: allocation.effects, consumed: allocation.consumed, remaining: allocation.remaining, revoked: allocation.revoked }, preflight: preflight.digest, endpoint: authorityDigest(endpoint), runner: runnerArtifact.digest, tests: testArtifact.digest, dispatchMode: "hermetic-certification", completeness: "unchecked" });
  return Object.freeze({ digest, scenarioId: input.scenario, runnerId: runner.runnerId, implementationDigest: runner.implementationDigest, endpointManifestDigest: runner.endpointManifestDigest, capabilities });
}

async function loadInitialization(workspace: string) {
  const root = await certificationWorkspaceRoot(path.resolve(workspace));
  const config = parseCertificationOperatorConfigV2(JSON.parse((await readConfinedFile(root, root, "config.json")).toString("utf8")));
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
  const fields = ["v", "taskId", "jobId", "grantId", "allocationId", "authorityCellId", "principalId", "runtimeSessionId", "signerKeyId", "signerKeyDescriptorDigest", "signedReadinessDigest", "signedJobCardDigest", "constraintsDigest", "currentTrustEventCount", "currentTrustHistoryDigest", "currentTrustHeadDigest", "effects", "signedRootGrant", "completeness", "dispatchable"];
  if (Object.keys(raw).sort().join("\0") !== fields.sort().join("\0") || raw.v !== "reelier.certification-cell-activation/v1" || raw.taskId !== ids.taskId || raw.jobId !== ids.jobCardId || raw.grantId !== ids.rootGrantId || raw.allocationId !== ids.rootGrantId || raw.authorityCellId !== ids.authorityCellId || raw.completeness !== "unchecked" || raw.dispatchable !== false || !Number.isSafeInteger(raw.effects) || raw.effects < 1) throw new TypeError("certification Cell activation is closed and bound to generated identities");
  for (const field of ["signerKeyDescriptorDigest", "signedReadinessDigest", "signedJobCardDigest", "constraintsDigest", "currentTrustHistoryDigest", "currentTrustHeadDigest"] as const) if (!DIGEST.test(raw[field])) throw new TypeError("certification Cell activation digest is invalid");
  if (!Number.isSafeInteger(raw.currentTrustEventCount) || raw.currentTrustEventCount < 1) throw new TypeError("certification Cell activation trust count is invalid");
  const rootSignature = raw.signedRootGrant?.signature;
  const signatureBytes = rootSignature?.alg === "ed25519" && typeof rootSignature.sig === "string" ? Buffer.from(rootSignature.sig, "base64") : undefined;
  if (!raw.signedRootGrant || !signatureBytes || signatureBytes.length !== 64 || signatureBytes.toString("base64") !== rootSignature.sig || authorityDigest(raw.signedRootGrant.grant) !== raw.signedRootGrant.digest || raw.signedRootGrant.grant.grantId !== raw.grantId || raw.signedRootGrant.grant.grantee !== raw.principalId || raw.signedRootGrant.signerId !== raw.signerKeyId || authorityDigest(raw.signedRootGrant.grant.constraints) !== raw.constraintsDigest) throw new TypeError("certification Cell root grant link or canonical signature is invalid");
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
function runnerKey(scenarioId: CertificationScenarioId, runnerId: string, implementationDigest: string, endpointManifestDigest: string): string {
  if (typeof runnerId !== "string" || !/^[a-z][a-z0-9_]{2,127}$/.test(runnerId)) throw new TypeError("certified runner identity is invalid");
  return `${scenarioId}\0${runnerId}\0${implementationDigest}\0${endpointManifestDigest}`;
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
function assertBinding(activation: CertificationCellActivationV1, binding: Awaited<ReturnType<DelegationAuthority["resolveSessionBinding"]>>, now: Date): void { if (binding.lifecycleState !== "allocated" || binding.taskId !== activation.taskId || binding.grantId !== activation.grantId || binding.grantDigest !== activation.signedRootGrant.digest || binding.grantee !== activation.principalId || binding.allocationId !== activation.allocationId || binding.effects !== activation.effects || Date.parse(binding.expiresAt) <= now.getTime()) throw new TypeError("certification principal binding is stale, revoked, substituted, or exhausted"); }
async function requireAuthorityRoot(root: string): Promise<string> { return requireDirectory(root, ["authority"]); }
async function requireDirectory(root: string, segments: readonly string[]): Promise<string> { const directory = await confinedExistingDirectory(root, segments); if (!directory) throw new TypeError("certification Cell durable directory is absent"); return directory; }
async function publishExact(root: string, directory: string, filename: string, value: unknown): Promise<void> { const content = `${JSON.stringify(value)}\n`; await publishPrivateContentAddressed(root, directory, filename, content); const target = await requireDirectory(root, [directory]); const observed = await readConfinedFile(root, target, filename); if (observed.toString("utf8") !== content) throw new TypeError("certification Cell activation conflict"); }
