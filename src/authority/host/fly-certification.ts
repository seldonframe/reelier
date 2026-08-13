import type { KeyObject } from "node:crypto";
import { createFlyTopologyProbe, runFlyTopologyProbe, type FlyDeclaredTopologySurface, type FlyTopologyProbeOperations } from "./fly-topology.js";
import { signTopologyEvidence, type SignedTopologyEvidenceV1, type TopologyEvidenceV1 } from "./topology.js";

export interface FlyCertificationInput {
  readonly declaredSurface: FlyDeclaredTopologySurface;
  readonly operations: FlyTopologyProbeOperations;
  readonly tenant: string;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly signer?: { readonly signerId: string; readonly privateKey: KeyObject };
}

export interface FlyCertificationResult {
  readonly evidence: TopologyEvidenceV1;
  readonly evidenceDigest: string;
  readonly signed: SignedTopologyEvidenceV1 | null;
}

export async function runFlyCertification(input: FlyCertificationInput): Promise<FlyCertificationResult> {
  const probe = createFlyTopologyProbe({ allowLive: true, declaredSurface: input.declaredSurface, operations: input.operations, nonce: input.nonce, probeId: "fly-authority-cell" });
  const result = await runFlyTopologyProbe(probe, { tenant: input.tenant, observedAt: input.observedAt, expiresAt: input.expiresAt });
  const fields: readonly (keyof TopologyEvidenceV1)[] = ["credentialIsolation", "providerEgress", "rawWriteReachability", "readCoverage", "runtimeIdentity", "declaredSurfaceEnforcement"];
  if (fields.some(field => result.evidence[field] !== "verified")) throw new TypeError("topology claim is not verified");
  return Object.freeze({ evidence: result.evidence, evidenceDigest: result.digest, signed: input.signer ? signTopologyEvidence(result, input.signer) : null });
}
