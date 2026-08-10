import type { ClaimStatus } from "../types.js";

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
