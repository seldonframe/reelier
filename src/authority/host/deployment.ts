import { createPublicKey, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { authorityKinds, type AuthorityKind } from "../types.js";
import { createTrustRoots, type TrustRoots } from "../trust.js";
import { createConnectorRegistry, type ConnectorRegistration, type ConnectorRegistry } from "../connector.js";
import type { AuthorityStateSnapshot } from "../state.js";

export interface AuthorityDeploymentTrustEntry {
  readonly signerId: string;
  readonly principalId: string;
  readonly publicKeyFile: string;
  readonly purposes: readonly AuthorityKind[];
}

export interface AuthorityDeploymentManifest {
  readonly v: "reelier.authority-deployment/v1";
  readonly tenant: string;
  readonly state: AuthorityStateSnapshot;
  readonly connectors: readonly ConnectorRegistration[];
  readonly trust: readonly AuthorityDeploymentTrustEntry[];
  readonly sourceDirectory: string;
}

export interface LoadedAuthorityDeployment extends AuthorityDeploymentManifest {
  readonly root: string;
  readonly trustRoots: TrustRoots;
  readonly trustEntries: readonly { readonly tenant: string; readonly signerId: string; readonly principalId: string; readonly publicKey: KeyObject; readonly purposes: readonly AuthorityKind[] }[];
  readonly connectorRegistry: ConnectorRegistry;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$/;
const TOP_LEVEL = new Set(["connectors", "sourceDirectory", "state", "tenant", "trust", "v"]);
const TRUST_FIELDS = new Set(["principalId", "publicKeyFile", "purposes", "signerId"]);

export async function loadAuthorityDeployment(file: string): Promise<LoadedAuthorityDeployment> {
  const resolved = path.resolve(file);
  const root = path.dirname(resolved);
  let raw: unknown;
  try { raw = JSON.parse(await readFile(resolved, "utf8")); } catch (error) { throw new TypeError(`authority deployment is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  const manifest = parseManifest(raw);
  if (manifest.tenant !== manifest.state.tenant) throw new TypeError("authority deployment tenant does not match state tenant");
  const trustEntries = [] as Array<{ tenant: string; signerId: string; principalId: string; publicKey: KeyObject; purposes: readonly AuthorityKind[] }>;
  for (const entry of manifest.trust) {
    const keyFile = resolveInside(root, entry.publicKeyFile, "trust key path");
    let publicKey: KeyObject;
    try { publicKey = createPublicKey(await readFile(keyFile)); } catch (error) { throw new TypeError(`trust key cannot be loaded: ${error instanceof Error ? error.message : String(error)}`); }
    trustEntries.push({ tenant: manifest.tenant, signerId: entry.signerId, principalId: entry.principalId, publicKey, purposes: entry.purposes });
  }
  return Object.freeze({ ...manifest, root, sourceDirectory: resolveInside(root, manifest.sourceDirectory, "source directory"), trustRoots: createTrustRoots(trustEntries), trustEntries: Object.freeze(trustEntries), connectorRegistry: createConnectorRegistry(manifest.connectors) });
}

function parseManifest(value: unknown): AuthorityDeploymentManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("authority deployment must be an object");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !TOP_LEVEL.has(key)) || ![...TOP_LEVEL].every(key => key in raw)) throw new TypeError("authority deployment has an unknown or missing field");
  if (raw.v !== "reelier.authority-deployment/v1" || typeof raw.tenant !== "string" || !ID.test(raw.tenant) || typeof raw.sourceDirectory !== "string" || !raw.sourceDirectory || path.isAbsolute(raw.sourceDirectory)) throw new TypeError("authority deployment identity or source directory is invalid");
  const state = parseState(raw.state, raw.tenant);
  if (!Array.isArray(raw.connectors)) throw new TypeError("authority deployment connectors must be an array");
  if (!Array.isArray(raw.trust) || raw.trust.length === 0) throw new TypeError("authority deployment trust roots are required");
  const trust = raw.trust.map(parseTrustEntry);
  return Object.freeze({ v: raw.v, tenant: raw.tenant, state, connectors: Object.freeze(raw.connectors.map(item => item as ConnectorRegistration)), trust: Object.freeze(trust), sourceDirectory: raw.sourceDirectory });
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
  if (Object.keys(raw).some(key => !TRUST_FIELDS.has(key)) || Object.keys(raw).length !== TRUST_FIELDS.size || typeof raw.signerId !== "string" || !ID.test(raw.signerId) || typeof raw.principalId !== "string" || !ID.test(raw.principalId) || typeof raw.publicKeyFile !== "string" || !raw.publicKeyFile || path.isAbsolute(raw.publicKeyFile) || !Array.isArray(raw.purposes) || raw.purposes.length === 0 || raw.purposes.some(item => !authorityKinds.includes(item as AuthorityKind)) || new Set(raw.purposes).size !== raw.purposes.length) throw new TypeError("authority deployment trust entry is invalid");
  return Object.freeze({ signerId: raw.signerId, principalId: raw.principalId, publicKeyFile: raw.publicKeyFile, purposes: Object.freeze([...(raw.purposes as AuthorityKind[])]) });
}

function resolveInside(root: string, relative: string, label: string): string {
  if (path.isAbsolute(relative) || relative.split(/[\\/]+/u).includes("..")) throw new TypeError(`${label} must be relative and remain inside the deployment directory`);
  const resolved = path.resolve(root, relative);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(prefix)) throw new TypeError(`${label} must remain inside the deployment directory`);
  return resolved;
}
