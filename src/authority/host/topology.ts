import type { KeyObject } from "node:crypto";
import type { AuthoritySignature, ClaimStatus } from "../types.js";
import { authorityDigest } from "../wire.js";
import { signAuthorityDigest, verifyAuthoritySignature } from "../crypto.js";

/** Host-owned evidence about the boundary around an Authority Cell.
 * A config declaration is never evidence; managed mode accepts only an object
 * produced by the host adapter after its isolation checks have run. */
export interface TopologyEvidenceV1 {
  readonly v: "reelier.topology-evidence/v1";
  readonly credentialIsolation: ClaimStatus;
  readonly providerEgress: ClaimStatus;
  readonly rawWriteReachability: ClaimStatus;
  readonly readCoverage: ClaimStatus;
  readonly runtimeIdentity: ClaimStatus;
  readonly declaredSurfaceEnforcement: ClaimStatus;
}

const fields = ["v", "credentialIsolation", "providerEgress", "rawWriteReachability", "readCoverage", "runtimeIdentity", "declaredSurfaceEnforcement"] as const;
const statuses = new Set<ClaimStatus>(["verified", "failed", "unchecked", "absent"]);

export type TopologyEvidenceField = Exclude<keyof TopologyEvidenceV1, "v">;
const evidenceFields: readonly TopologyEvidenceField[] = fields.slice(1) as readonly TopologyEvidenceField[];
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const ISO = (value: string): boolean => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const MAX_PROBE_WINDOW_MS = 5 * 60 * 1000;

export interface TopologyProbeRunInput {
  readonly tenant: string;
  readonly observedAt: string;
  readonly expiresAt: string;
}

export type TopologyProbeCheck = (input: Readonly<TopologyProbeRunInput>) => ClaimStatus | Promise<ClaimStatus>;

export interface TopologyProbeDefinition {
  readonly probeId: string;
  readonly checks: Readonly<Record<TopologyEvidenceField, TopologyProbeCheck>>;
}

export interface TopologyProbe {
  readonly probeId: string;
  readonly run: (input: Readonly<TopologyProbeRunInput>) => Promise<TopologyProbeResult>;
}

export interface TopologyProbeResult {
  readonly v: "reelier.topology-evidence-payload/v1";
  readonly tenant: string;
  readonly probeId: string;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly evidence: TopologyEvidenceV1;
  readonly digest: string;
}

export interface SignedTopologyEvidenceV1 {
  readonly v: "reelier.signed-topology-evidence/v1";
  readonly tenant: string;
  readonly probeId: string;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly evidence: TopologyEvidenceV1;
  readonly signerId: string;
  readonly digest: string;
  readonly signature: AuthoritySignature;
}

export interface TopologyEvidenceVerificationOptions {
  readonly tenant: string;
  readonly now: string | Date;
  readonly signerId: string;
  readonly publicKey: KeyObject;
  readonly maxAgeMs?: number;
}

export function parseTopologyEvidence(value: unknown): TopologyEvidenceV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("topology evidence must be an object");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== fields.length || fields.some(field => !Object.prototype.hasOwnProperty.call(raw, field)) || raw.v !== "reelier.topology-evidence/v1") throw new TypeError("topology evidence is closed");
  for (const field of fields.slice(1)) if (!statuses.has(raw[field] as ClaimStatus)) throw new TypeError(`topology evidence ${field} is invalid`);
  return Object.freeze({ v: raw.v, credentialIsolation: raw.credentialIsolation, providerEgress: raw.providerEgress, rawWriteReachability: raw.rawWriteReachability, readCoverage: raw.readCoverage, runtimeIdentity: raw.runtimeIdentity, declaredSurfaceEnforcement: raw.declaredSurfaceEnforcement }) as TopologyEvidenceV1;
}

export function assertManagedTopologyEvidence(value: unknown): asserts value is TopologyEvidenceV1 {
  const evidence = parseTopologyEvidence(value);
  if (fields.slice(1).some(field => evidence[field] !== "verified")) throw new TypeError("managed authority requires verified topology evidence");
}

/** Build a closed, fixed-order topology probe. Checks are evaluated in the ABI order,
 * never in object insertion order, so a host cannot create digest differences by reordering them. */
export function createTopologyProbe(definition: TopologyProbeDefinition): TopologyProbe {
  validateProbeDefinition(definition);
  const checks = definition.checks;
  return Object.freeze({
    probeId: definition.probeId,
    async run(input: Readonly<TopologyProbeRunInput>): Promise<TopologyProbeResult> {
      validateRunInput(input, definition.probeId);
      const values = await Promise.all(evidenceFields.map(field => checks[field](input)));
      const evidence = parseTopologyEvidence(Object.fromEntries([["v", "reelier.topology-evidence/v1"], ...evidenceFields.map((field, index) => [field, values[index]] as const)]));
      return makeProbeResult(input, definition.probeId, evidence);
    },
  });
}

export async function runTopologyProbe(probe: TopologyProbe, input: Readonly<TopologyProbeRunInput>): Promise<TopologyProbeResult> {
  if (!probe || typeof probe !== "object" || typeof probe.run !== "function") throw new TypeError("topology probe is required");
  const result = await probe.run(input);
  return parseTopologyProbeResult(result);
}

export function signTopologyEvidence(result: TopologyProbeResult, input: Readonly<{ signerId: string; privateKey: KeyObject }>): SignedTopologyEvidenceV1 {
  const parsed = parseTopologyProbeResult(result);
  if (!input || typeof input.signerId !== "string" || !ID.test(input.signerId) || !input.privateKey) throw new TypeError("topology evidence signer is invalid");
  return Object.freeze({
    v: "reelier.signed-topology-evidence/v1" as const,
    tenant: parsed.tenant,
    probeId: parsed.probeId,
    observedAt: parsed.observedAt,
    expiresAt: parsed.expiresAt,
    evidence: parsed.evidence,
    signerId: input.signerId,
    digest: parsed.digest,
    signature: signAuthorityDigest(input.privateKey, "authority-evidence", parsed.digest),
  });
}

export function verifyTopologyEvidence(value: unknown, options: TopologyEvidenceVerificationOptions): SignedTopologyEvidenceV1 {
  const signed = parseSignedTopologyEvidence(value);
  if (!options || signed.tenant !== options.tenant || signed.signerId !== options.signerId) throw new TypeError("topology evidence tenant or signer mismatch");
  const now = parseInstant(options.now, "topology evidence validation instant");
  const observed = parseInstant(signed.observedAt, "topology evidence observation instant");
  const expires = parseInstant(signed.expiresAt, "topology evidence expiry instant");
  const maxAge = options.maxAgeMs ?? 60_000;
  if (!Number.isSafeInteger(maxAge) || maxAge < 1 || maxAge > MAX_PROBE_WINDOW_MS) throw new TypeError("topology evidence max age is invalid");
  if (observed > now) throw new TypeError("topology evidence is from the future");
  if (now >= expires || now - observed > maxAge) throw new TypeError("topology evidence is stale or expired");
  if (expires <= observed || expires - observed > MAX_PROBE_WINDOW_MS) throw new TypeError("topology evidence validity window is invalid");
  if (!verifyAuthoritySignature(options.publicKey, "authority-evidence", signed.digest, signed.signature)) throw new TypeError("topology evidence signature is invalid");
  return signed;
}

export function assertFreshManagedTopologyEvidence(value: unknown, options: TopologyEvidenceVerificationOptions): asserts value is SignedTopologyEvidenceV1 {
  const verified = verifyTopologyEvidence(value, options);
  assertManagedTopologyEvidence(verified.evidence);
}

export function topologyEvidenceDigest(value: Readonly<{ tenant: string; probeId: string; observedAt: string; expiresAt: string; evidence: TopologyEvidenceV1 }>): string {
  return authorityDigest(topologyEvidencePayload(value));
}

function makeProbeResult(input: TopologyProbeRunInput, probeId: string, evidence: TopologyEvidenceV1): TopologyProbeResult {
  const payload = topologyEvidencePayload({ ...input, probeId, evidence });
  return Object.freeze({ ...payload, digest: authorityDigest(payload) });
}

function topologyEvidencePayload(value: Readonly<{ tenant: string; probeId: string; observedAt: string; expiresAt: string; evidence: TopologyEvidenceV1 }>) {
  validateIdentity(value.tenant, "topology evidence tenant");
  validateIdentity(value.probeId, "topology probe id");
  validateRunTimes(value.observedAt, value.expiresAt);
  return Object.freeze({ v: "reelier.topology-evidence-payload/v1" as const, tenant: value.tenant, probeId: value.probeId, observedAt: value.observedAt, expiresAt: value.expiresAt, evidence: parseTopologyEvidence(value.evidence) });
}

function parseTopologyProbeResult(value: unknown): TopologyProbeResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("topology probe result must be an object");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join("\0") !== ["digest", "evidence", "expiresAt", "observedAt", "probeId", "tenant", "v"].sort().join("\0") || raw.v !== "reelier.topology-evidence-payload/v1") throw new TypeError("topology probe result is closed");
  const payload = topologyEvidencePayload({ tenant: raw.tenant as string, probeId: raw.probeId as string, observedAt: raw.observedAt as string, expiresAt: raw.expiresAt as string, evidence: raw.evidence as TopologyEvidenceV1 });
  if (raw.digest !== authorityDigest(payload)) throw new TypeError("topology probe result digest mismatch");
  return Object.freeze({ ...payload, digest: raw.digest as string });
}

function parseSignedTopologyEvidence(value: unknown): SignedTopologyEvidenceV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("signed topology evidence must be an object");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join("\0") !== ["digest", "evidence", "expiresAt", "observedAt", "probeId", "signature", "signerId", "tenant", "v"].sort().join("\0") || raw.v !== "reelier.signed-topology-evidence/v1") throw new TypeError("signed topology evidence is closed");
  if (typeof raw.signerId !== "string" || !ID.test(raw.signerId) || !raw.signature || typeof raw.signature !== "object") throw new TypeError("signed topology evidence signer is invalid");
  const signature = raw.signature as Record<string, unknown>;
  if (Object.keys(signature).sort().join("\0") !== "alg\0sig" || signature.alg !== "ed25519" || typeof signature.sig !== "string") throw new TypeError("signed topology evidence signature is invalid");
  const payload = topologyEvidencePayload({ tenant: raw.tenant as string, probeId: raw.probeId as string, observedAt: raw.observedAt as string, expiresAt: raw.expiresAt as string, evidence: raw.evidence as TopologyEvidenceV1 });
  if (raw.digest !== authorityDigest(payload)) throw new TypeError("signed topology evidence digest mismatch");
  return Object.freeze({ v: "reelier.signed-topology-evidence/v1" as const, tenant: payload.tenant, probeId: payload.probeId, observedAt: payload.observedAt, expiresAt: payload.expiresAt, evidence: payload.evidence, digest: raw.digest as string, signerId: raw.signerId, signature: Object.freeze({ alg: "ed25519" as const, sig: signature.sig as string }) });
}

function validateProbeDefinition(definition: TopologyProbeDefinition): void {
  if (!definition || typeof definition !== "object") throw new TypeError("topology probe definition is required");
  validateIdentity(definition.probeId, "topology probe id");
  if (!definition.checks || typeof definition.checks !== "object" || Array.isArray(definition.checks) || Object.keys(definition.checks).sort().join("\0") !== [...evidenceFields].sort().join("\0")) throw new TypeError("topology probe checks must exactly cover the evidence fields");
  for (const field of evidenceFields) if (typeof definition.checks[field] !== "function") throw new TypeError(`topology probe check ${field} is invalid`);
}

function validateRunInput(input: TopologyProbeRunInput, probeId: string): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("topology probe input is required");
  validateIdentity(input.tenant, "topology probe tenant");
  validateIdentity(probeId, "topology probe id");
  validateRunTimes(input.observedAt, input.expiresAt);
}

function validateRunTimes(observedAt: string, expiresAt: string): void {
  const observed = parseInstant(observedAt, "topology evidence observation instant");
  const expires = parseInstant(expiresAt, "topology evidence expiry instant");
  if (expires <= observed || expires - observed > MAX_PROBE_WINDOW_MS) throw new TypeError("topology evidence validity window is invalid");
}

function parseInstant(value: string | Date, label: string): number {
  const text = value instanceof Date ? value.toISOString() : value;
  if (!ISO(text)) throw new TypeError(`${label} is invalid`);
  return Date.parse(text);
}

function validateIdentity(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${label} is invalid`);
}
