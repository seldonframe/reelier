import { createPublicKey, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { authorityKinds, type AuthorityKind, type AuthoritySignaturePurpose } from "../types.js";
import { createTrustRoots, type TrustRoots } from "../trust.js";
import { createConnectorRegistry, type ConnectorRegistration, type ConnectorRegistry } from "../connector.js";
import type { AuthorityStateSnapshot } from "../state.js";
import { normalizeSignedJobCard, type SignedJobCardV1 } from "../job.js";
import { signedJobCardDigest, verifySignedJobCard } from "../job.js";
import { authorityDigest } from "../wire.js";
import { connectionDescriptorDigest } from "../../connections.js";
import { connectionAdoptionCommitmentDigest } from "../../connections.js";
import { normalizeConnectionAdoption, normalizeConnectionDescriptor, type ConnectionAdoptionV1, type ConnectionDescriptorV1 } from "../../observation/index.js";
import { parseAuthorityKeyDescriptor, parseTrustEvents, verifySignedCertificationReadiness, type AuthorityKeyDescriptorV1, type SignedCertificationReadinessV1, type TrustEventV1 } from "../certification/authority.js";

export interface JobCardTrustMaterialV1 {
  readonly signedReadinessDigest: string;
  readonly signerKeyDescriptorDigest: string;
  readonly keyDescriptors: readonly AuthorityKeyDescriptorV1[];
  readonly trustEvents: readonly TrustEventV1[];
  readonly trustHistoryDigest: string;
  readonly trustHeadDigest: string;
}

export interface JobCardTrustPinV1 {
  readonly v: "reelier.job-card-trust-pin/v1";
  readonly signedReadiness: SignedCertificationReadinessV1;
  readonly readinessCandidate: unknown;
  readonly preflight: unknown;
  readonly humanTrustRoot: AuthorityKeyDescriptorV1;
  readonly keyDescriptors: readonly AuthorityKeyDescriptorV1[];
  readonly readinessTrustEvents: readonly TrustEventV1[];
  readonly currentTrustEvents: readonly TrustEventV1[];
}

export interface AuthorityDeploymentTrustEntry {
  readonly signerId: string;
  readonly principalId: string;
  readonly publicKeyFile: string;
  readonly purposes: readonly AuthoritySignaturePurpose[];
  readonly status?: "active" | "inactive" | "revoked";
}

export interface AuthorityDeploymentManifest {
  readonly v: "reelier.authority-deployment/v1";
  readonly tenant: string;
  readonly states: readonly AuthorityStateSnapshot[];
  readonly connectors: readonly ConnectorRegistration[];
  readonly trust: readonly AuthorityDeploymentTrustEntry[];
  readonly sourceDirectory: string;
  readonly jobCard?: SignedJobCardV1;
  readonly jobCardAuthority?: JobCardTrustMaterialV1;
  readonly connectionDescriptors: readonly ConnectionDescriptorV1[];
  readonly connectionAdoptions: readonly ConnectionAdoptionV1[];
  readonly enforcement: Readonly<{ completeness: "unchecked"; declaredSurfaceExclusiveEnforcement: "unchecked" | "verified"; bypasses: readonly string[] }>;
}

export interface LoadedAuthorityDeployment extends AuthorityDeploymentManifest {
  readonly root: string;
  readonly trustRoots: TrustRoots;
  readonly trustEntries: readonly { readonly tenant: string; readonly signerId: string; readonly principalId: string; readonly publicKey: KeyObject; readonly purposes: readonly AuthorityKind[] }[];
  readonly connectorRegistry: ConnectorRegistry;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$/;
const TOP_LEVEL = new Set(["connectionAdoptions", "connectionDescriptors", "connectors", "enforcement", "jobCard", "jobCardAuthority", "sourceDirectory", "state", "states", "tenant", "trust", "v"]);
const REQUIRED_TOP_LEVEL = new Set(["connectors", "sourceDirectory", "tenant", "trust", "v"]);
const TRUST_FIELDS = new Set(["principalId", "publicKeyFile", "purposes", "signerId", "status"]);

export async function loadAuthorityDeployment(file: string, options: Readonly<{ jobCardTrustPin?: JobCardTrustPinV1 }> = {}): Promise<LoadedAuthorityDeployment> {
  const resolved = path.resolve(file);
  const root = path.dirname(resolved);
  let raw: unknown;
  try { raw = JSON.parse(await readFile(resolved, "utf8")); } catch (error) { throw new TypeError(`authority deployment is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  const manifest = parseManifest(raw);
  if (manifest.states.some(state => manifest.tenant !== state.tenant)) throw new TypeError("authority deployment tenant does not match state tenant");
  const trustEntries = [] as Array<{ tenant: string; signerId: string; principalId: string; publicKey: KeyObject; purposes: readonly AuthorityKind[] }>;
  for (const entry of manifest.trust) {
    const keyFile = resolveInside(root, entry.publicKeyFile, "trust key path");
    let publicKey: KeyObject;
    try { publicKey = createPublicKey(await readFile(keyFile)); } catch (error) { throw new TypeError(`trust key cannot be loaded: ${error instanceof Error ? error.message : String(error)}`); }
    if (entry.status !== undefined && entry.status !== "active") throw new TypeError("deployment trust entry is not active");
    trustEntries.push({ tenant: manifest.tenant, signerId: entry.signerId, principalId: entry.principalId, publicKey, purposes: entry.purposes.filter((purpose): purpose is AuthorityKind => authorityKinds.includes(purpose as AuthorityKind)) });
  }
  if (manifest.jobCard) {
    if (!manifest.jobCardAuthority || !options.jobCardTrustPin) throw new TypeError("signed Job Card requires host-pinned authoritative trust");
    verifyJobCardTrust(manifest.jobCard, manifest.jobCardAuthority, options.jobCardTrustPin);
    verifyAdoptions(manifest);
  } else if (manifest.connectionDescriptors.length || manifest.connectionAdoptions.length) throw new TypeError("connection adoption requires a signed job card");
  const authorityRoots = trustEntries.filter(entry => entry.purposes.length > 0);
  return Object.freeze({ ...manifest, root, sourceDirectory: resolveInside(root, manifest.sourceDirectory, "source directory"), trustRoots: createTrustRoots(authorityRoots), trustEntries: Object.freeze(trustEntries), connectorRegistry: createConnectorRegistry(manifest.connectors) });
}

function parseManifest(value: unknown): AuthorityDeploymentManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("authority deployment must be an object");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !TOP_LEVEL.has(key)) || ![...REQUIRED_TOP_LEVEL].every(key => key in raw) || ("state" in raw) === ("states" in raw)) throw new TypeError("authority deployment has an unknown or missing field");
  if (raw.v !== "reelier.authority-deployment/v1" || typeof raw.tenant !== "string" || !ID.test(raw.tenant) || typeof raw.sourceDirectory !== "string" || !raw.sourceDirectory || path.isAbsolute(raw.sourceDirectory)) throw new TypeError("authority deployment identity or source directory is invalid");
  const states = "states" in raw
    ? parseStates(raw.states, raw.tenant)
    : Object.freeze([parseState(raw.state, raw.tenant)]);
  if (!Array.isArray(raw.connectors)) throw new TypeError("authority deployment connectors must be an array");
  if (!Array.isArray(raw.trust) || raw.trust.length === 0) throw new TypeError("authority deployment trust roots are required");
  const trust = raw.trust.map(parseTrustEntry);
  const jobCard = raw.jobCard === undefined ? undefined : normalizeSignedJobCard(raw.jobCard);
  const jobCardAuthority = raw.jobCardAuthority === undefined ? undefined : parseJobCardTrustMaterial(raw.jobCardAuthority, "deployment Job Card authority");
  if ((jobCard === undefined) !== (jobCardAuthority === undefined)) throw new TypeError("signed Job Card and its authority snapshot must appear together");
  const connectionDescriptors = raw.connectionDescriptors === undefined ? [] : parseUnique(raw.connectionDescriptors, normalizeConnectionDescriptor, item => item.connectionId, "connection descriptor");
  const connectionAdoptions = raw.connectionAdoptions === undefined ? [] : parseUnique(raw.connectionAdoptions, normalizeConnectionAdoption, item => item.adoptionId, "connection adoption");
  const enforcement = parseEnforcement(raw.enforcement, connectionAdoptions);
  return Object.freeze({ v: raw.v, tenant: raw.tenant, states, connectors: Object.freeze(raw.connectors.map(item => item as ConnectorRegistration)), trust: Object.freeze(trust), sourceDirectory: raw.sourceDirectory, connectionDescriptors, connectionAdoptions, enforcement, ...(jobCard && jobCardAuthority ? { jobCard, jobCardAuthority } : {}) });
}

function parseJobCardTrustMaterial(value: unknown, label: string): JobCardTrustMaterialV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const raw = value as Record<string, unknown>;
  const fields = ["keyDescriptors", "signedReadinessDigest", "signerKeyDescriptorDigest", "trustEvents", "trustHeadDigest", "trustHistoryDigest"];
  if (Object.keys(raw).sort().join("\0") !== fields.sort().join("\0") || !Array.isArray(raw.keyDescriptors)) throw new TypeError(`${label} is closed and complete`);
  const keyDescriptors = Object.freeze(raw.keyDescriptors.map(parseAuthorityKeyDescriptor));
  if (keyDescriptors.length === 0 || new Set(keyDescriptors.map(item => item.keyId)).size !== keyDescriptors.length || new Set(keyDescriptors.map(authorityDigest)).size !== keyDescriptors.length) throw new TypeError(`${label} descriptors must be nonempty and unique`);
  const trustEvents = parseTrustEvents(raw.trustEvents, keyDescriptors);
  const trustHistoryDigest = requireDigest(raw.trustHistoryDigest, `${label} history digest`);
  const trustHeadDigest = requireDigest(raw.trustHeadDigest, `${label} head digest`);
  if (trustHistoryDigest !== authorityDigest(trustEvents) || trustHeadDigest !== authorityDigest(trustEvents[trustEvents.length - 1]!)) throw new TypeError(`${label} history or head digest mismatch`);
  const signerKeyDescriptorDigest = requireDigest(raw.signerKeyDescriptorDigest, `${label} signer descriptor digest`);
  const signer = keyDescriptors.find(item => authorityDigest(item) === signerKeyDescriptorDigest);
  if (!signer || signer.role !== "human-sponsor" || signer.purpose !== "signed-job-card") throw new TypeError(`${label} signer descriptor purpose is invalid`);
  return Object.freeze({ signedReadinessDigest: requireDigest(raw.signedReadinessDigest, `${label} signed readiness digest`), signerKeyDescriptorDigest, keyDescriptors, trustEvents, trustHistoryDigest, trustHeadDigest });
}

function verifyJobCardTrust(card: SignedJobCardV1, snapshot: JobCardTrustMaterialV1, pinInput: JobCardTrustPinV1): void {
  const { material: pin, currentTrustEvents, signer } = jobCardTrustMaterialFromPin(card, pinInput);
  if (authorityDigest(snapshot) !== authorityDigest(pin)) throw new TypeError("host-pinned Job Card trust root mismatch");
  if (card.audiences.includes(card.signerId)) throw new TypeError("human Job Card signer must be distinct from agent audiences");
  if (!isActiveAtHead(snapshot.trustEvents, pin.signerKeyDescriptorDigest)) throw new TypeError("signed Job Card signer was not active at authorization");
  if (!isActiveAtHead(currentTrustEvents, pin.signerKeyDescriptorDigest)) throw new TypeError("signed Job Card signer is revoked or not currently active");
  const publicKey = createPublicKey({ key: Buffer.from(signer.publicKeySpkiBase64, "base64"), format: "der", type: "spki" });
  if (!verifySignedJobCard(card, publicKey)) throw new TypeError("signed Job Card trust verification failed");
}

export function jobCardTrustMaterialFromPin(card: SignedJobCardV1, value: JobCardTrustPinV1): Readonly<{ material: JobCardTrustMaterialV1; currentTrustEvents: readonly TrustEventV1[]; signer: AuthorityKeyDescriptorV1 }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("host-pinned Job Card trust must be an object");
  const raw = value as unknown as Record<string, unknown>;
  const fields = ["currentTrustEvents", "humanTrustRoot", "keyDescriptors", "preflight", "readinessCandidate", "readinessTrustEvents", "signedReadiness", "v"];
  if (raw.v !== "reelier.job-card-trust-pin/v1" || Object.keys(raw).sort().join("\0") !== fields.sort().join("\0") || !Array.isArray(raw.keyDescriptors)) throw new TypeError("host-pinned Job Card trust is closed and complete");
  const keyDescriptors = Object.freeze(raw.keyDescriptors.map(parseAuthorityKeyDescriptor));
  const readinessTrustEvents = parseTrustEvents(raw.readinessTrustEvents, keyDescriptors);
  const currentTrustEvents = parseTrustEvents(raw.currentTrustEvents, keyDescriptors);
  verifySignedCertificationReadiness({ signed: raw.signedReadiness, readinessCandidate: raw.readinessCandidate, preflight: raw.preflight, humanTrustRoot: raw.humanTrustRoot, keyDescriptors, trustEvents: readinessTrustEvents });
  if (readinessTrustEvents.length > currentTrustEvents.length || readinessTrustEvents.some((event, index) => authorityDigest(event) !== authorityDigest(currentTrustEvents[index]))) throw new TypeError("current Job Card trust history does not extend signed readiness");
  const signer = keyDescriptors.find(item => item.keyId === card.signerId && item.role === "human-sponsor" && item.purpose === "signed-job-card");
  if (!signer) throw new TypeError("signed Job Card signer is not in host-pinned trust");
  const signerKeyDescriptorDigest = authorityDigest(signer);
  const signedReadiness = raw.signedReadiness as SignedCertificationReadinessV1;
  if (!signedReadiness.activatedJobCardKeyDescriptorDigests.includes(signerKeyDescriptorDigest)) throw new TypeError("signed Job Card signer was not activated by readiness");
  if (!isActiveAtHead(currentTrustEvents, signerKeyDescriptorDigest)) throw new TypeError("signed Job Card signer is revoked or not currently active");
  const material = Object.freeze({ signedReadinessDigest: authorityDigest(signedReadiness), signerKeyDescriptorDigest, keyDescriptors, trustEvents: readinessTrustEvents, trustHistoryDigest: authorityDigest(readinessTrustEvents), trustHeadDigest: authorityDigest(readinessTrustEvents[readinessTrustEvents.length - 1]!) });
  return Object.freeze({ material, currentTrustEvents, signer });
}

function isActiveAtHead(events: readonly TrustEventV1[], descriptorDigest: string): boolean {
  const lifecycle = events.filter(event => event.keyDescriptorDigest === descriptorDigest);
  return lifecycle.length > 0 && lifecycle[lifecycle.length - 1]!.action === "activate";
}

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function parseStates(value: unknown, tenant: string): readonly AuthorityStateSnapshot[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) throw new TypeError("authority deployment states must be a bounded nonempty array");
  const states = value.map(item => parseState(item, tenant));
  if (new Set(states.map(state => state.definitionAlias)).size !== states.length) throw new TypeError("authority deployment has duplicate definition state");
  return Object.freeze(states.sort((left, right) => left.definitionAlias.localeCompare(right.definitionAlias)));
}

function parseState(value: unknown, tenant: string): AuthorityStateSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("authority deployment state must be an object");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join("\0") !== ["candidates", "definitionAlias", "stateVersion", "tenant"].sort().join("\0") || raw.tenant !== tenant || typeof raw.definitionAlias !== "string" || !ID.test(raw.definitionAlias) || !Number.isSafeInteger(raw.stateVersion) || Number(raw.stateVersion) < 1 || !Array.isArray(raw.candidates)) throw new TypeError("authority deployment state is invalid");
  return Object.freeze({ tenant, definitionAlias: raw.definitionAlias, stateVersion: raw.stateVersion as number, candidates: Object.freeze(raw.candidates as AuthorityStateSnapshot["candidates"]) });
}

function parseTrustEntry(value: unknown): AuthorityDeploymentTrustEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("authority deployment trust entry must be an object");
  const raw = value as Record<string, unknown>;
  const purposes = [...authorityKinds, "signed-job-card"];
  if (Object.keys(raw).some(key => !TRUST_FIELDS.has(key)) || !["signerId", "principalId", "publicKeyFile", "purposes"].every(key => key in raw) || typeof raw.signerId !== "string" || !ID.test(raw.signerId) || typeof raw.principalId !== "string" || !ID.test(raw.principalId) || typeof raw.publicKeyFile !== "string" || !raw.publicKeyFile || path.isAbsolute(raw.publicKeyFile) || !Array.isArray(raw.purposes) || raw.purposes.length === 0 || raw.purposes.some(item => !purposes.includes(item as AuthorityKind | "signed-job-card")) || new Set(raw.purposes).size !== raw.purposes.length || (raw.status !== undefined && !["active", "inactive", "revoked"].includes(String(raw.status)))) throw new TypeError("authority deployment trust entry is invalid");
  return Object.freeze({ signerId: raw.signerId, principalId: raw.principalId, publicKeyFile: raw.publicKeyFile, purposes: Object.freeze([...(raw.purposes as AuthoritySignaturePurpose[])]), ...(raw.status === undefined ? {} : { status: raw.status as "active" | "inactive" | "revoked" }) });
}

function parseUnique<T>(value: unknown, parse: (item: unknown) => T, identity: (item: T) => string, label: string): readonly T[] {
  if (!Array.isArray(value)) throw new TypeError(`${label}s must be an array`);
  const parsed = value.map(parse).sort((a, b) => identity(a).localeCompare(identity(b)));
  if (new Set(parsed.map(identity)).size !== parsed.length) throw new TypeError(`duplicate ${label}`);
  return Object.freeze(parsed);
}

function parseEnforcement(value: unknown, adoptions: readonly ConnectionAdoptionV1[]): AuthorityDeploymentManifest["enforcement"] {
  if (value === undefined && adoptions.length === 0) return Object.freeze({ completeness: "unchecked", declaredSurfaceExclusiveEnforcement: "unchecked", bypasses: Object.freeze([]) });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("deployment enforcement is required");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join("\0") !== ["bypasses", "completeness", "declaredSurfaceExclusiveEnforcement"].sort().join("\0") || raw.completeness !== "unchecked" || !["unchecked", "verified"].includes(String(raw.declaredSurfaceExclusiveEnforcement)) || !Array.isArray(raw.bypasses) || raw.bypasses.some(item => typeof item !== "string")) throw new TypeError("deployment enforcement is invalid");
  return Object.freeze({ completeness: "unchecked", declaredSurfaceExclusiveEnforcement: raw.declaredSurfaceExclusiveEnforcement as "unchecked" | "verified", bypasses: Object.freeze([...new Set(raw.bypasses as string[])].sort()) });
}

function verifyAdoptions(manifest: AuthorityDeploymentManifest): void {
  const card = manifest.jobCard!;
  const expectedBinding = signedJobCardDigest(card);
  const descriptors = new Map(manifest.connectionDescriptors.map(descriptor => [connectionDescriptorDigest(descriptor), descriptor]));
  const adoptionCommitments = manifest.connectionAdoptions.map(({ signedDeploymentBinding: _binding, ...body }) => connectionAdoptionCommitmentDigest(body));
  if (descriptors.size !== manifest.connectionDescriptors.length || new Set(card.connectionDescriptorDigests).size !== card.connectionDescriptorDigests.length || card.connectionDescriptorDigests.length !== descriptors.size || card.connectionDescriptorDigests.some(digest => !descriptors.has(digest))) throw new TypeError("signed job card descriptor commitment mismatch");
  if (manifest.connectionAdoptions.length !== descriptors.size || new Set(adoptionCommitments).size !== adoptionCommitments.length || card.adoptionCommitmentDigests.length !== adoptionCommitments.length || card.adoptionCommitmentDigests.some(digest => !adoptionCommitments.includes(digest))) throw new TypeError("connection adoption set mismatch");
  const adoptedDescriptorDigests = manifest.connectionAdoptions.map(item => item.descriptorDigest);
  if (new Set(adoptedDescriptorDigests).size !== adoptedDescriptorDigests.length || adoptedDescriptorDigests.some(digest => !descriptors.has(digest))) throw new TypeError("connection adoption descriptor set mismatch");
  for (const adoption of manifest.connectionAdoptions) {
    const descriptor = descriptors.get(adoption.descriptorDigest);
    if (!descriptor || adoption.activationState !== "active" || adoption.signedDeploymentBinding !== expectedBinding || adoption.selectedAccountIdentity !== descriptor.account.identity || adoption.sidecarRouteId !== descriptor.callableRoute.routeId || !card.connectorIds.includes(descriptor.connectionId) || !card.accountIdentities.includes(descriptor.account.identity)) throw new TypeError("connection adoption binding mismatch");
    const registrations = manifest.connectors.filter(item => item.connectorId === descriptor.connectionId);
    const endpoints = registrations.length === 1 ? [...registrations[0]!.allowedReadEndpointIds, ...registrations[0]!.allowedWriteEndpointIds].sort() : [];
    if (registrations.length !== 1 || registrations[0]!.providerAccountIdentity !== descriptor.account.identity || endpoints.length !== descriptor.callableRoute.endpointIds.length || endpoints.some((endpoint, index) => endpoint !== descriptor.callableRoute.endpointIds[index])) throw new TypeError("connector account or endpoint binding mismatch");
    if (adoption.mode === "managed") throw new TypeError("managed connection adoption requires measured topology evidence");
  }
  if (manifest.enforcement.completeness !== "unchecked" || manifest.enforcement.declaredSurfaceExclusiveEnforcement !== "unchecked") throw new TypeError("local adopted deployment must report unchecked enforcement");
  const expectedBypasses = expectedBypassReasons(manifest.connectionAdoptions);
  if (authorityDigest(manifest.enforcement.bypasses) !== authorityDigest(expectedBypasses)) throw new TypeError("deployment enforcement bypass reasons do not match raw-write reachability");
}

export function expectedBypassReasons(adoptions: readonly ConnectionAdoptionV1[]): readonly string[] {
  return Object.freeze([...new Set(adoptions.flatMap(adoption => adoption.rawWriteReachability === "reachable" ? ["equivalent-raw-write-route-reachable"] : adoption.rawWriteReachability === "unknown" ? ["equivalent-raw-write-route-unmeasured"] : []))].sort());
}

function resolveInside(root: string, relative: string, label: string): string {
  if (path.isAbsolute(relative) || relative.split(/[\\/]+/u).includes("..")) throw new TypeError(`${label} must be relative and remain inside the deployment directory`);
  const resolved = path.resolve(root, relative);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(prefix)) throw new TypeError(`${label} must remain inside the deployment directory`);
  return resolved;
}
