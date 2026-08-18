import { createHash, createPublicKey } from "node:crypto";
import { createSignedReleaseVerifierEvidenceV1, type ReleaseContractSignerV1, type ReleaseEvidenceLaneV1, type SignedReleaseVerifierEvidenceV1, type VerifiedReleaseAuthorizationV1 } from "../release-contracts.js";

export function createGitHubReleaseProviderEvidence(input: Readonly<{ authorization: VerifiedReleaseAuthorizationV1; lane: Extract<ReleaseEvidenceLaneV1, "candidate-branch" | "candidate-pull-request" | "merge-exact-sha" | "tag-immutable-ref">; observedAt: string; subjectDigest: string; signer: ReleaseContractSignerV1 }>): SignedReleaseVerifierEvidenceV1 {
  const binding = input.authorization.authorization.value.evidenceVerifierBindings.find(candidate => candidate.lane === input.lane);
  const publicDer = createPublicKey(input.signer.privateKey).export({ type: "spki", format: "der" });
  const publicKeySpkiDigest = `sha256:${createHash("sha256").update(publicDer).digest("hex")}`;
  if (!binding || binding.signerId !== input.signer.signerId || binding.publicKeySpkiDigest !== publicKeySpkiDigest) throw new TypeError("release provider evidence signer is not authorization-bound for this lane");
  return createSignedReleaseVerifierEvidenceV1({
    v: "reelier.release-verifier-evidence/v1", authorizationBundleDigest: input.authorization.authorization.digest, candidateCommit: input.authorization.operationPlan.value.expectedCommitSha,
    count: null, freshUntil: null, lane: input.lane, observation: "provider-readback", observedAt: input.observedAt, resultValue: null, status: "verified", subjectDigest: input.subjectDigest,
    workflowDigest: null, workflowPath: null,
  }, input.signer);
}
