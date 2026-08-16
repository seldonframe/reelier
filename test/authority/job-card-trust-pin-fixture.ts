import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { authorityDigest } from "../../src/authority/wire.js";
import { createSignedCertificationReadiness, parseAuthorityKeyDescriptor } from "../../src/authority/certification/authority.js";
import { certificationRunnerRegistryDigest } from "../../src/authority/certification/runner-registry.js";

const sha = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;

export function jobCardTrustPinFixture(jobPublicKey: KeyObject, jobKeyId: string, cellKeyId: string) {
  const readinessSigner = generateKeyPairSync("ed25519");
  const cellSigner = generateKeyPairSync("ed25519");
  const jobDescriptor = parseAuthorityKeyDescriptor({ v: "reelier.authority-key-descriptor/v1", keyId: jobKeyId, role: "human-sponsor", purpose: "signed-job-card", algorithm: "ed25519", publicKeySpkiBase64: jobPublicKey.export({ type: "spki", format: "der" }).toString("base64") });
  const human = parseAuthorityKeyDescriptor({ v: "reelier.authority-key-descriptor/v1", keyId: `signer_${"e".repeat(24)}`, role: "human-sponsor", purpose: "certification-readiness", algorithm: "ed25519", publicKeySpkiBase64: readinessSigner.publicKey.export({ type: "spki", format: "der" }).toString("base64") });
  const cell = parseAuthorityKeyDescriptor({ v: "reelier.authority-key-descriptor/v1", keyId: cellKeyId, role: "authority-cell", purpose: "authority-receipt", algorithm: "ed25519", publicKeySpkiBase64: cellSigner.publicKey.export({ type: "spki", format: "der" }).toString("base64") });
  const event = (sequence: number, descriptor: typeof human, previousEventDigest: string | null) => ({ v: "reelier.authority-trust-event/v1" as const, eventId: `trust_${sequence}_${"f".repeat(12)}`, sequence, action: "activate" as const, keyDescriptorDigest: authorityDigest(descriptor), occurredAt: "2026-01-01T00:00:00.000Z", previousEventDigest });
  const first = event(0, human, null);
  const second = event(1, jobDescriptor, authorityDigest(first));
  const third = event(2, cell, authorityDigest(second));
  const emptyInput = Object.freeze({ status: "configured" as const, artifacts: Object.freeze([]) });
  const commitments = Object.freeze({ resources: Object.freeze([]), cleanup: Object.freeze([]), credentials: Object.freeze([]), runners: emptyInput, tests: emptyInput, plans: emptyInput, endpoints: emptyInput, runnerRegistryDigest: certificationRunnerRegistryDigest, topology: "absent" as const, signatureStatus: "absent" as const });
  const readiness: any = { v: "reelier.certification-readiness-candidate/v1", status: "awaiting-human-signature", preparationReady: true, signatureStatus: "absent", authorization: "absent", dispatchable: false, completeness: "unchecked", configDigest: sha("1"), selectionDigest: sha("2"), preflightDigest: "", scenarios: ["github-issue-labels"], identifiers: { taskId: `task_${"a".repeat(24)}`, jobCardId: `job_${"b".repeat(24)}`, rootGrantId: `grant_${"c".repeat(24)}`, authorityCellId: `cell_${"d".repeat(24)}`, signerId: human.keyId }, commitments };
  const preflightBody = { v: "reelier.certification-preflight/v2" as const, configDigest: readiness.configDigest, selectionDigest: readiness.selectionDigest, identifiers: readiness.identifiers, scenarios: readiness.scenarios, resources: commitments.resources, cleanup: commitments.cleanup, credentialReferences: commitments.credentials, inputs: { runners: commitments.runners, tests: commitments.tests, plans: commitments.plans, endpoints: commitments.endpoints }, runnerRegistryDigest: commitments.runnerRegistryDigest, topology: commitments.topology, trust: "unchecked" as const, signatureStatus: "absent" as const, authorization: "absent" as const, completeness: "unchecked" as const, missing: Object.freeze([]), ok: true, preparationReady: true, executionReady: false as const, dispatchable: false as const };
  const preflight = Object.freeze({ ...preflightBody, digest: authorityDigest(preflightBody) });
  readiness.preflightDigest = preflight.digest;
  const keyDescriptors = Object.freeze([human, jobDescriptor, cell]);
  const readinessTrustEvents = Object.freeze([first, second, third]);
  const signedReadiness = createSignedCertificationReadiness({ readinessCandidate: readiness, readinessCandidateDigest: authorityDigest(readiness), preflight, humanKeyDescriptor: human, jobCardKeyDescriptors: [jobDescriptor], cellKeyDescriptors: [cell], trustEvents: readinessTrustEvents, humanPrivateKey: readinessSigner.privateKey, authorizedAt: "2026-01-02T00:00:00.000Z" });
  return Object.freeze({ v: "reelier.job-card-trust-pin/v1" as const, signedReadiness, readinessCandidate: readiness, preflight, humanTrustRoot: human, keyDescriptors, readinessTrustEvents, currentTrustEvents: readinessTrustEvents });
}
