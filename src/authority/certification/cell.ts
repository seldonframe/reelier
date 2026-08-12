import { createPublicKey, randomUUID, type KeyObject } from "node:crypto";
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
import { certificationWorkspaceRoot, confinedExistingDirectory, publishPrivateContentAddressed, readConfinedFile } from "./filesystem.js";
import { parseCertificationInitialization, validateCertificationInitialization, type CertificationIdentifiers } from "./initializer.js";
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
  const activation: CertificationCellActivationV1 = Object.freeze({ v: "reelier.certification-cell-activation/v1", taskId: identifiers.taskId, jobId: identifiers.jobCardId, grantId: identifiers.rootGrantId, allocationId: identifiers.rootGrantId, authorityCellId: identifiers.authorityCellId, principalId, runtimeSessionId, signerKeyId: delegation.keyId, signerKeyDescriptorDigest: descriptorDigest, signedReadinessDigest: authorityDigest(readiness), signedJobCardDigest: signedJobCardDigest(jobCard), constraintsDigest: authorityDigest(constraints), effects: input.effects, signedRootGrant, completeness: "unchecked", dispatchable: false });
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
class OpaquePermit implements CertificationDispatchPermit {
  readonly kind = "certification-dispatch-permit" as const;
  toJSON(): never { throw new TypeError("certification dispatch permit is opaque and nonserializable"); }
}
const permitState = new WeakMap<object, Readonly<{ digest: string; revalidate: () => Promise<string>; consume: () => Promise<void> }>>();

export async function verifyCertificationDispatchReadiness(input: Readonly<{
  workspace: string;
  scenario: CertificationScenarioId;
  bearerToken: string;
  delegationAuthority: DelegationAuthority;
  principalRegistry: PrincipalRegistry;
  credentialAvailable: (slot: string) => Promise<boolean>;
  now?: () => Date;
}>): Promise<CertificationDispatchPermit> {
  const revalidate = async () => dispatchSnapshot(input);
  const digest = await revalidate();
  const activation = await loadActivation(input.workspace);
  const reservationId = `certification_${randomUUID()}`;
  const permit = Object.freeze(new OpaquePermit());
  permitState.set(permit, Object.freeze({ digest, revalidate, consume: async () => { await input.delegationAuthority.budget.consumeOnce({ allocationId: activation.allocationId, reservationId, effects: 1 }); } }));
  return permit;
}

export async function runCertificationWithPermit<T>(permit: CertificationDispatchPermit, runner: () => Promise<T>): Promise<T> {
  const state = permitState.get(permit as object);
  if (!state) throw new TypeError("certification dispatch permit is invalid or already used");
  permitState.delete(permit as object);
  const current = await state.revalidate();
  if (current !== state.digest) throw new TypeError("certification dispatch state became stale");
  await state.consume();
  return runner();
}

async function dispatchSnapshot(input: Readonly<{ workspace: string; scenario: CertificationScenarioId; bearerToken: string; delegationAuthority: DelegationAuthority; principalRegistry: PrincipalRegistry; credentialAvailable: (slot: string) => Promise<boolean>; now?: () => Date }>): Promise<string> {
  if (!(CERTIFICATION_SCENARIO_IDS as readonly string[]).includes(input.scenario)) throw new TypeError("certification dispatch scenario is invalid");
  const state = await loadInitialization(input.workspace);
  if (!state.initialization.scenarios.includes(input.scenario)) throw new TypeError("certification dispatch scenario was not selected");
  const activation = await loadActivation(input.workspace);
  const authorityRoot = await requireAuthorityRoot(state.root);
  const deployment = await requireDirectory(authorityRoot, ["deployment"]);
  const trustDirectory = await requireDirectory(authorityRoot, ["trust"]);
  const jobCard = normalizeSignedJobCard(JSON.parse((await readConfinedFile(authorityRoot, deployment, "job-card.json")).toString("utf8")));
  const pin = JSON.parse((await readConfinedFile(authorityRoot, trustDirectory, "job-card-trust-pin.json")).toString("utf8")) as JobCardTrustPinV1;
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
  const preflight = await preflightCertification({ workspace: state.root, scenario: input.scenario });
  if (!preflight.preparationReady || preflight.completeness !== "unchecked") throw new TypeError("certification semantic runner or test readiness is incomplete");
  const readinessPreflightDigest = (pin.readinessCandidate as { readonly preflightDigest?: unknown }).preflightDigest;
  const pinnedPreflightDigest = (pin.preflight as { readonly digest?: unknown }).digest;
  if (preflight.digest !== readinessPreflightDigest || preflight.digest !== pinnedPreflightDigest) throw new TypeError("certification semantic manifests drifted from signed readiness preflight commitment");
  const endpointDirectory = await requireDirectory(authorityRoot, ["endpoints"]);
  const endpoint = parseCertificationEndpointManifest(JSON.parse((await readConfinedFile(authorityRoot, endpointDirectory, `${input.scenario}.json`)).toString("utf8")), input.scenario);
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
  for (const slot of endpoint.credentialSlots) if (!await input.credentialAvailable(slot)) throw new TypeError("certification named credential is unavailable");
  return authorityDigest({ v: "reelier.certification-dispatch-snapshot/v1", activation: authorityDigest(activation), jobCard: signedJobCardDigest(jobCard), readiness: authorityDigest(pin.signedReadiness), trustHead: authorityDigest(pin.currentTrustEvents[pin.currentTrustEvents.length - 1]), task: status.lifecycleState, principal: authorityDigest(principal), allocation: { effects: allocation.effects, consumed: allocation.consumed, remaining: allocation.remaining, revoked: allocation.revoked }, preflight: preflight.digest, endpoint: authorityDigest(endpoint), runner: runnerArtifact.digest, tests: testArtifact.digest, completeness: "unchecked" });
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
  const fields = ["v", "taskId", "jobId", "grantId", "allocationId", "authorityCellId", "principalId", "runtimeSessionId", "signerKeyId", "signerKeyDescriptorDigest", "signedReadinessDigest", "signedJobCardDigest", "constraintsDigest", "effects", "signedRootGrant", "completeness", "dispatchable"];
  if (Object.keys(raw).sort().join("\0") !== fields.sort().join("\0") || raw.v !== "reelier.certification-cell-activation/v1" || raw.taskId !== ids.taskId || raw.jobId !== ids.jobCardId || raw.grantId !== ids.rootGrantId || raw.allocationId !== ids.rootGrantId || raw.authorityCellId !== ids.authorityCellId || raw.completeness !== "unchecked" || raw.dispatchable !== false || !Number.isSafeInteger(raw.effects) || raw.effects < 1) throw new TypeError("certification Cell activation is closed and bound to generated identities");
  for (const field of ["signerKeyDescriptorDigest", "signedReadinessDigest", "signedJobCardDigest", "constraintsDigest"] as const) if (!DIGEST.test(raw[field])) throw new TypeError("certification Cell activation digest is invalid");
  if (!raw.signedRootGrant || authorityDigest(raw.signedRootGrant.grant) !== raw.signedRootGrant.digest || raw.signedRootGrant.grant.grantId !== raw.grantId || raw.signedRootGrant.grant.grantee !== raw.principalId || raw.signedRootGrant.signerId !== raw.signerKeyId || authorityDigest(raw.signedRootGrant.grant.constraints) !== raw.constraintsDigest) throw new TypeError("certification Cell root grant link is invalid");
  return Object.freeze(raw as CertificationCellActivationV1);
}
function verifyCurrentJobCardTrust(jobCard: SignedJobCardV1, pin: JobCardTrustPinV1) {
  const verified = jobCardTrustMaterialFromPin(jobCard, pin);
  if (!verifySignedJobCard(jobCard, publicKeyFor(verified.signer))) throw new TypeError("certification signed Job Card trust verification failed");
  const events = parseTrustEvents(pin.currentTrustEvents, pin.keyDescriptors);
  return { activeDescriptorDigests: activeDescriptors(events) };
}
function activeDescriptors(events: ReturnType<typeof parseTrustEvents>): Set<string> { const states = new Map<string, string>(); for (const event of events) states.set(event.keyDescriptorDigest, event.action); return new Set([...states].filter(([, action]) => action === "activate").map(([digest]) => digest)); }
function publicKeyFor(descriptor: AuthorityKeyDescriptorV1): KeyObject { return createPublicKey({ key: Buffer.from(descriptor.publicKeySpkiBase64, "base64"), format: "der", type: "spki" }); }
function deriveId(kind: "principal" | "session", ids: CertificationIdentifiers): string { return `${kind}_${authorityDigest({ v: `reelier.certification-${kind}-id/v1`, taskId: ids.taskId, authorityCellId: ids.authorityCellId }).slice(7, 31)}`; }
function canonicalTime(value: string): string { const time = Date.parse(value); if (!Number.isFinite(time)) throw new TypeError("certification activation time is invalid"); const canonical = new Date(time).toISOString(); if (canonical !== value) throw new TypeError("certification activation time must be canonical"); return canonical; }
function assertBinding(activation: CertificationCellActivationV1, binding: Awaited<ReturnType<DelegationAuthority["resolveSessionBinding"]>>, now: Date): void { if (binding.lifecycleState !== "allocated" || binding.taskId !== activation.taskId || binding.grantId !== activation.grantId || binding.grantDigest !== activation.signedRootGrant.digest || binding.grantee !== activation.principalId || binding.allocationId !== activation.allocationId || binding.effects !== activation.effects || Date.parse(binding.expiresAt) <= now.getTime()) throw new TypeError("certification principal binding is stale, revoked, substituted, or exhausted"); }
async function requireAuthorityRoot(root: string): Promise<string> { return requireDirectory(root, ["authority"]); }
async function requireDirectory(root: string, segments: readonly string[]): Promise<string> { const directory = await confinedExistingDirectory(root, segments); if (!directory) throw new TypeError("certification Cell durable directory is absent"); return directory; }
async function publishExact(root: string, directory: string, filename: string, value: unknown): Promise<void> { const content = `${JSON.stringify(value)}\n`; await publishPrivateContentAddressed(root, directory, filename, content); const target = await requireDirectory(root, [directory]); const observed = await readConfinedFile(root, target, filename); if (observed.toString("utf8") !== content) throw new TypeError("certification Cell activation conflict"); }
