import { authorityDigest } from "../wire.js";
import type { CertificationOperatorConfigV2 } from "./config.js";
import { CERTIFICATION_SCENARIOS, type CertificationScenarioId } from "./scenarios.js";

export interface SanitizedCertificationProjection {
  readonly v: "reelier.certification-sanitized-config/v1";
  readonly scenarios: readonly CertificationScenarioId[];
  readonly resources: Readonly<Record<string, unknown>>;
  readonly cleanup: Readonly<Record<string, readonly string[]>>;
  readonly metadata: readonly { readonly section: string; readonly digest: string; readonly status: "configured" }[];
  readonly credentialReferences: readonly { readonly slot: string; readonly status: "configured" }[];
}

export interface CertificationConfigCommitment {
  readonly privateConfigDigest: string;
  readonly sanitizedProjectionDigest: string;
  readonly configCommitmentDigest: string;
  readonly projection: SanitizedCertificationProjection;
}

export function createCertificationConfigCommitment(config: CertificationOperatorConfigV2, scenarios: readonly CertificationScenarioId[]): CertificationConfigCommitment {
  const definitions = scenarios.map(scenario => CERTIFICATION_SCENARIOS[scenario]);
  const resourceSections = unique(definitions.flatMap(definition => definition.resourceSections));
  const cleanupSections = unique(definitions.flatMap(definition => definition.cleanupCommitments));
  const metadataSections = unique(definitions.flatMap(definition => definition.metadataSections));
  const secretSlots = unique(definitions.flatMap(definition => definition.secretSlots));
  const projection: SanitizedCertificationProjection = Object.freeze({
    v: "reelier.certification-sanitized-config/v1",
    scenarios: Object.freeze([...scenarios]),
    resources: Object.freeze(Object.fromEntries(resourceSections.map(section => [section, config.resources[section]]))),
    cleanup: Object.freeze(Object.fromEntries(cleanupSections.map(section => [section, config.cleanup[section]]))),
    metadata: Object.freeze(metadataSections.map(section => Object.freeze({ section, digest: authorityDigest(config.metadata[section]), status: "configured" as const }))),
    credentialReferences: Object.freeze(secretSlots.map(slot => Object.freeze({ slot, status: "configured" as const }))),
  });
  const privateConfigDigest = authorityDigest(config);
  const sanitizedProjectionDigest = authorityDigest(projection);
  const configCommitmentDigest = authorityDigest({ v: "reelier.certification-config-commitment/v1", privateConfigDigest, sanitizedProjectionDigest });
  return Object.freeze({ privateConfigDigest, sanitizedProjectionDigest, configCommitmentDigest, projection });
}

export function recomputeCertificationConfigCommitment(privateConfigDigest: string, sanitizedProjectionDigest: string): string {
  return authorityDigest({ v: "reelier.certification-config-commitment/v1", privateConfigDigest, sanitizedProjectionDigest });
}

function unique<T extends string>(values: readonly T[]): readonly T[] { return Object.freeze([...new Set(values)].sort() as T[]); }
