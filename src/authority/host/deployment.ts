import { createPublicKey, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { authorityKinds, type AuthorityKind, type AuthoritySignaturePurpose } from "../types.js";
import { createTrustRoots, type TrustRoots } from "../trust.js";
import { createConnectorRegistry, type ConnectorRegistration, type ConnectorRegistry } from "../connector.js";
import type { AuthorityStateSnapshot } from "../state.js";
import { normalizeSignedJobCard, type SignedJobCardV1 } from "../job.js";
import { signedJobCardDigest, verifySignedJobCard } from "../job.js";
import { connectionDescriptorDigest } from "../../connections.js";
import { normalizeConnectionAdoption, normalizeConnectionDescriptor, type ConnectionAdoptionV1, type ConnectionDescriptorV1 } from "../../observation/index.js";

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
const TOP_LEVEL = new Set(["connectionAdoptions", "connectionDescriptors", "connectors", "enforcement", "jobCard", "sourceDirectory", "state", "states", "tenant", "trust", "v"]);
const REQUIRED_TOP_LEVEL = new Set(["connectors", "sourceDirectory", "tenant", "trust", "v"]);
const TRUST_FIELDS = new Set(["principalId", "publicKeyFile", "purposes", "signerId", "status"]);

export async function loadAuthorityDeployment(file: string): Promise<LoadedAuthorityDeployment> {
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
    const signer = manifest.trust.findIndex(entry => entry.signerId === manifest.jobCard!.signerId && entry.purposes.includes("signed-job-card"));
    if (signer < 0 || manifest.trust[signer]!.status === "inactive" || manifest.trust[signer]!.status === "revoked" || !manifest.jobCard.audiences.includes(manifest.trust[signer]!.principalId) || !verifySignedJobCard(manifest.jobCard, trustEntries[signer]!.publicKey)) throw new TypeError("signed job card trust verification failed");
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
  const connectionDescriptors = raw.connectionDescriptors === undefined ? [] : parseUnique(raw.connectionDescriptors, normalizeConnectionDescriptor, item => item.connectionId, "connection descriptor");
  const connectionAdoptions = raw.connectionAdoptions === undefined ? [] : parseUnique(raw.connectionAdoptions, normalizeConnectionAdoption, item => item.adoptionId, "connection adoption");
  const enforcement = parseEnforcement(raw.enforcement, connectionAdoptions);
  return Object.freeze({ v: raw.v, tenant: raw.tenant, states, connectors: Object.freeze(raw.connectors.map(item => item as ConnectorRegistration)), trust: Object.freeze(trust), sourceDirectory: raw.sourceDirectory, connectionDescriptors, connectionAdoptions, enforcement, ...(jobCard ? { jobCard } : {}) });
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
  if (descriptors.size !== manifest.connectionDescriptors.length || card.connectionDescriptorDigests.length !== descriptors.size || card.connectionDescriptorDigests.some(digest => !descriptors.has(digest))) throw new TypeError("signed job card descriptor commitment mismatch");
  if (manifest.connectionAdoptions.length !== descriptors.size) throw new TypeError("connection adoption set mismatch");
  for (const adoption of manifest.connectionAdoptions) {
    const descriptor = descriptors.get(adoption.descriptorDigest);
    if (!descriptor || adoption.activationState !== "active" || adoption.signedDeploymentBinding !== expectedBinding || adoption.selectedAccountIdentity !== descriptor.account.identity || adoption.sidecarRouteId !== descriptor.callableRoute.routeId || !card.connectorIds.includes(descriptor.connectionId) || !card.accountIdentities.includes(descriptor.account.identity)) throw new TypeError("connection adoption binding mismatch");
    const registrations = manifest.connectors.filter(item => item.connectorId === descriptor.connectionId);
    const endpoints = registrations.length === 1 ? [...registrations[0]!.allowedReadEndpointIds, ...registrations[0]!.allowedWriteEndpointIds].sort() : [];
    if (registrations.length !== 1 || registrations[0]!.providerAccountIdentity !== descriptor.account.identity || endpoints.length !== descriptor.callableRoute.endpointIds.length || endpoints.some((endpoint, index) => endpoint !== descriptor.callableRoute.endpointIds[index])) throw new TypeError("connector account or endpoint binding mismatch");
    if (adoption.mode === "managed") throw new TypeError("managed connection adoption requires measured topology evidence");
  }
  if (manifest.enforcement.completeness !== "unchecked" || manifest.enforcement.declaredSurfaceExclusiveEnforcement !== "unchecked") throw new TypeError("local adopted deployment must report unchecked enforcement");
}

function resolveInside(root: string, relative: string, label: string): string {
  if (path.isAbsolute(relative) || relative.split(/[\\/]+/u).includes("..")) throw new TypeError(`${label} must be relative and remain inside the deployment directory`);
  const resolved = path.resolve(root, relative);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(prefix)) throw new TypeError(`${label} must remain inside the deployment directory`);
  return resolved;
}
