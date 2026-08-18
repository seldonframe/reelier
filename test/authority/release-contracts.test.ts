import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  createSignedReleaseAuthorizationBundleV1,
  createSignedReleasePolicyV1,
  createSignedReleaseReceiptGraphV1,
  createSignedStagedCandidateManifestV1,
  evaluateReleaseReceiptGraphV1,
  parseCanonicalSignedReleaseAuthorizationBundleV1,
  parseSignedReleaseAuthorizationBundleV1,
  parseSignedReleaseReceiptGraphV1,
  verifyReleaseAuthorizationBundleV1,
  verifyReleaseReceiptGraphV1,
  type ReleaseEvidenceStatus,
} from "../../src/authority/release-contracts.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const sha = (character: string): string => character.repeat(40);
const keyPair = generateKeyPairSync("ed25519");
const signer = { signerId: "release-authority-2026", privateKey: keyPair.privateKey };
const verifier = { signerId: signer.signerId, publicKey: keyPair.publicKey };

function releaseInputs() {
  const candidateManifest = createSignedStagedCandidateManifestV1({
    v: "reelier.staged-candidate-manifest/v1",
    baseCommit: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b",
    branch: "reelier/release/0.32.1",
    candidateCommit: sha("a"),
    candidateTreeDigest: digest("1"),
    changedBytes: 4096,
    changedPaths: ["CHANGELOG.md", "src/cli.ts", "test/cli-subcommand-help.test.ts"],
    destinationBranch: "main",
    qualityEvidence: {
      coverageStatus: "non-regressed",
      coverageEvidenceDigest: digest("6"),
      fullTestEvidenceDigest: digest("7"),
      fullTestsStatus: "verified",
      headCommit: sha("a"),
      mutationEvidenceDigest: digest("8"),
      mutationScoreBasisPoints: 9_137,
    },
    packageName: "reelier",
    packageVersion: "0.32.1",
    packedTarballDigest: digest("2"),
    repository: "seldonframe/reelier",
    tag: "v0.32.1",
    workflowCommitments: [
      { digest: digest("3"), path: ".github/workflows/ci.yml" },
      { digest: digest("4"), path: ".github/workflows/publish-ghcr.yml" },
      { digest: digest("5"), path: ".github/workflows/publish-mcp.yml" },
      { digest: digest("a"), path: ".github/workflows/publish-npm.yml" },
    ],
  }, signer);
  const policy = createSignedReleasePolicyV1({
    v: "reelier.release-policy/v1",
    allowedPaths: ["CHANGELOG.md", "src/cli.ts", "test/cli-subcommand-help.test.ts"],
    destinations: ["ghcr", "mcp-registry", "npm"],
    effectAllocations: ["candidate-branch", "draft-pr", "exact-sha-merge", "non-force-tag"],
    expirySeconds: 43_200,
    forbiddenChangeClasses: ["authority-contract", "credential", "dependency", "generated-contract", "lockfile", "policy", "release-script", "workflow"],
    maxChangedBytes: 65_536,
    maxChangedFiles: 3,
  }, signer);
  const authorization = createSignedReleaseAuthorizationBundleV1({
    v: "reelier.release-authorization-bundle/v1",
    authorityCellDigest: digest("9"),
    effectAllocations: [
      { allocationDigest: digest("a"), allocationId: "release-candidate-branch-01", effect: "candidate-branch", maxEffects: 1 },
      { allocationDigest: digest("b"), allocationId: "release-draft-pr-01", effect: "draft-pr", maxEffects: 1 },
      { allocationDigest: digest("c"), allocationId: "release-exact-sha-merge-01", effect: "exact-sha-merge", maxEffects: 1 },
      { allocationDigest: digest("d"), allocationId: "release-non-force-tag-01", effect: "non-force-tag", maxEffects: 1 },
    ],
    expiresAt: "2026-08-18T17:00:00.000Z",
    issuedAt: "2026-08-18T05:00:00.000Z",
    jobCardDigest: digest("e"),
    missionDigest: digest("f"),
    packDigest: digest("0"),
    policyDigest: policy.digest,
    rootGrantDigest: digest("1"),
    stagedCandidateManifestDigest: candidateManifest.digest,
    taskDigest: digest("2"),
  }, signer);
  return { authorization, candidateManifest, policy };
}

function releaseReceiptGraph(status: ReleaseEvidenceStatus = "verified") {
  const lane = (label: string) => ({ evidenceDigest: digest(label), status });
  return {
    v: "reelier.release-receipt-graph/v1" as const,
    authorizationBundleDigest: releaseInputs().authorization.digest,
    candidate: { branch: lane("c"), pullRequest: lane("d") },
    completeness: "unchecked" as const,
    ghcr: { immutableManifest: lane("e"), tags: lane("f") },
    human: {
      authorization: { count: 1, ...lane("1") },
      exceptions: { count: 0, evidenceDigests: [] as string[], status },
      interruptions: { count: 0, evidenceDigests: [] as string[], status },
      postReleaseReview: lane("2"),
    },
    installedChecks: { linux: lane("3"), windows: lane("4") },
    mcpRegistry: { version: lane("5") },
    merge: { exactSha: lane("6") },
    npm: { integrity: lane("7"), provenance: lane("8") },
    tag: { immutableRef: lane("9") },
  };
}

test("release authorization binds the exact reviewed release and is deterministic", () => {
  const first = releaseInputs();
  const second = releaseInputs();
  assert.equal(first.candidateManifest.digest, second.candidateManifest.digest);
  assert.equal(first.policy.digest, second.policy.digest);
  assert.equal(first.authorization.digest, second.authorization.digest);
  assert.deepEqual(first.authorization.signature, second.authorization.signature);

  const verified = verifyReleaseAuthorizationBundleV1(first, verifier, new Date("2026-08-18T06:00:00.000Z"));
  assert.equal(verified.authorization.value.policyDigest, verified.policy.digest);
  assert.equal(verified.authorization.value.stagedCandidateManifestDigest, verified.candidateManifest.digest);
  assert.equal(verified.candidateManifest.value.repository, "seldonframe/reelier");
  assert.equal(verified.candidateManifest.value.baseCommit, "e600ad5c2dc5e1bde0714915e7a84980c8d5602b");
  assert.equal(verified.candidateManifest.value.qualityEvidence.headCommit, verified.candidateManifest.value.candidateCommit);
  assert.ok(verified.candidateManifest.value.qualityEvidence.mutationScoreBasisPoints >= 9_000);
  assert.deepEqual(verified.authorization.value.effectAllocations.map(item => item.maxEffects), [1, 1, 1, 1]);
  assert.deepEqual(verified.policy.value.allowedPaths, ["CHANGELOG.md", "src/cli.ts", "test/cli-subcommand-help.test.ts"]);
  assert.ok(Object.isFrozen(verified.authorization.value));
  assert.ok(Object.isFrozen(verified.policy.value.allowedPaths));
});

test("release authorization rejects tampering, wrong links, and a non-12-hour or expired grant", () => {
  const release = releaseInputs();
  const tampered = structuredClone(release);
  tampered.authorization.value.taskDigest = digest("c");
  assert.throws(() => verifyReleaseAuthorizationBundleV1(tampered, verifier, new Date("2026-08-18T06:00:00.000Z")), /digest|signature|tamper/i);

  const wrongLink = structuredClone(release);
  wrongLink.authorization.value.policyDigest = digest("d");
  assert.throws(() => verifyReleaseAuthorizationBundleV1(wrongLink, verifier, new Date("2026-08-18T06:00:00.000Z")), /digest|policy/i);

  const wrongDuration = structuredClone(release.authorization);
  wrongDuration.value.expiresAt = "2026-08-18T18:00:00.000Z";
  assert.throws(() => parseSignedReleaseAuthorizationBundleV1(wrongDuration), /12-hour|expiry/i);
  assert.throws(() => verifyReleaseAuthorizationBundleV1(release, verifier, new Date("2026-08-18T17:00:00.000Z")), /expired/i);
});

test("closed release parsing rejects unknown fields, accessors, prototypes, invalid sets, digests, and refs", () => {
  const release = releaseInputs();
  assert.throws(() => parseSignedReleaseAuthorizationBundleV1({ ...release.authorization, surprise: true }), /exact|unknown|canonical/i);

  const accessor = structuredClone(release.authorization);
  Object.defineProperty(accessor.value, "missionDigest", { enumerable: true, get: () => digest("8") });
  assert.throws(() => parseSignedReleaseAuthorizationBundleV1(accessor), /accessor|exact|canonical/i);

  const prototype = structuredClone(release.authorization);
  Object.setPrototypeOf(prototype.value, { missionDigest: digest("8") });
  assert.throws(() => parseSignedReleaseAuthorizationBundleV1(prototype), /prototype|exact|canonical/i);

  const duplicateSet = structuredClone(release.policy);
  duplicateSet.value.allowedPaths = ["CHANGELOG.md", "CHANGELOG.md", "src/cli.ts"];
  assert.throws(() => verifyReleaseAuthorizationBundleV1({ ...release, policy: duplicateSet }, verifier, new Date("2026-08-18T06:00:00.000Z")), /sorted|unique|allowed/i);

  const invalidDigest = structuredClone(release.authorization);
  invalidDigest.value.missionDigest = "sha256:ABC";
  assert.throws(() => parseSignedReleaseAuthorizationBundleV1(invalidDigest), /digest/i);

  const invalidRef = structuredClone(release.candidateManifest);
  invalidRef.value.branch = "refs/heads/main";
  assert.throws(() => verifyReleaseAuthorizationBundleV1({ ...release, candidateManifest: invalidRef }, verifier, new Date("2026-08-18T06:00:00.000Z")), /branch|candidate/i);
});

test("canonical JSON parsing rejects duplicate keys and every noncanonical byte representation", () => {
  const release = releaseInputs();
  const canonical = JSON.stringify(release.authorization);
  assert.deepEqual(parseCanonicalSignedReleaseAuthorizationBundleV1(canonical), release.authorization);
  assert.throws(() => parseCanonicalSignedReleaseAuthorizationBundleV1(` ${canonical}`), /canonical/i);
  assert.throws(() => parseCanonicalSignedReleaseAuthorizationBundleV1(canonical.replace('{"digest"', '{"digest":"sha256:${"0".repeat(64)}","digest"')), /duplicate/i);
  const reordered = `{"v":"${release.authorization.v}","digest":"${release.authorization.digest}","signature":${JSON.stringify(release.authorization.signature)},"signerId":"${release.authorization.signerId}","value":${JSON.stringify(release.authorization.value)}}`;
  assert.throws(() => parseCanonicalSignedReleaseAuthorizationBundleV1(reordered), /canonical/i);
});

test("receipt graph keeps every evidence lane distinct and succeeds only when all are verified", () => {
  const release = releaseInputs();
  const signed = createSignedReleaseReceiptGraphV1(releaseReceiptGraph(), signer);
  const verified = verifyReleaseReceiptGraphV1(signed, verifier, release.authorization.digest);
  assert.deepEqual(evaluateReleaseReceiptGraphV1(verified.value), { completeness: "unchecked", status: "verified", success: true });

  for (const nonSuccess of ["failed", "pending", "absent", "unchecked", "ambiguity"] as const) {
    const graph = createSignedReleaseReceiptGraphV1(releaseReceiptGraph(nonSuccess), signer);
    const parsed = verifyReleaseReceiptGraphV1(graph, verifier, release.authorization.digest);
    assert.deepEqual(evaluateReleaseReceiptGraphV1(parsed.value), { completeness: "unchecked", status: "incomplete", success: false });
  }
});

test("receipt graph rejects upgraded completeness, lane aliasing, duplicates, and tampering", () => {
  const release = releaseInputs();
  const signed = createSignedReleaseReceiptGraphV1(releaseReceiptGraph(), signer);
  const completeness = structuredClone(signed);
  completeness.value.completeness = "verified" as "unchecked";
  assert.throws(() => parseSignedReleaseReceiptGraphV1(completeness), /completeness/i);

  const aliased = releaseReceiptGraph();
  aliased.candidate.pullRequest.evidenceDigest = aliased.candidate.branch.evidenceDigest;
  assert.throws(() => createSignedReleaseReceiptGraphV1(aliased, signer), /duplicate|distinct/i);

  const duplicateException = releaseReceiptGraph();
  duplicateException.human.exceptions = { count: 2, evidenceDigests: [digest("a"), digest("a")], status: "verified" };
  assert.throws(() => createSignedReleaseReceiptGraphV1(duplicateException, signer), /sorted|unique|duplicate/i);

  const tampered = structuredClone(signed);
  tampered.value.npm.integrity.status = "failed";
  assert.throws(() => verifyReleaseReceiptGraphV1(tampered, verifier, release.authorization.digest), /digest|signature|tamper/i);
});
