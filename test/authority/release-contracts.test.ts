import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  createSignedReleaseAuthorizationBundleV1,
  createSignedReleasePolicyV1,
  createSignedReleaseReceiptGraphV1,
  createSignedReleaseVerifierEvidenceV1,
  createSignedStagedCandidateManifestV1,
  parseCanonicalSignedReleaseAuthorizationBundleV1,
  parseSignedReleaseAuthorizationBundleV1,
  parseSignedReleasePolicyV1,
  parseSignedReleaseReceiptGraphV1,
  parseSignedReleaseVerifierEvidenceV1,
  parseSignedStagedCandidateManifestV1,
  verifyReleaseAuthorizationBundleV1,
  verifyReleaseReceiptGraphV1,
  type ReleaseEvidenceStatus,
  type ReleaseEvidenceLaneV1,
  type ReleaseEvidenceVerificationV1,
  type ReleaseVerifierEvidenceV1,
} from "../../src/authority/release-contracts.js";
import { authorityDigest } from "../../src/authority/wire.js";
import * as authorityPublic from "../../src/authority/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const sha = (character: string): string => character.repeat(40);
const keyPair = generateKeyPairSync("ed25519");
const signer = { signerId: "release-authority-2026", privateKey: keyPair.privateKey };
const graphKeyPair = generateKeyPairSync("ed25519");
const graphSigner = { signerId: "release-graph-maker-2026", privateKey: graphKeyPair.privateKey };
const graphVerificationNow = new Date("2026-08-18T16:55:00.000Z");
const trustedLaneSigners: ReadonlyArray<readonly [ReleaseEvidenceLaneV1, string]> = [
  ["ci-coverage", "quality-coverage-verifier"], ["ci-full-tests", "quality-full-tests-verifier"], ["ci-mutation", "quality-mutation-verifier"],
  ["candidate-branch", "receipt-candidate-branch"], ["candidate-pull-request", "receipt-candidate-pr"], ["ghcr-immutable-manifest", "receipt-ghcr-manifest"], ["ghcr-tags", "receipt-ghcr-tags"],
  ["human-authorization", "receipt-human-authorization"], ["human-exceptions", "receipt-human-exceptions"], ["human-interruptions", "receipt-human-interruptions"], ["human-post-release-review", "receipt-human-review"],
  ["installed-linux", "receipt-installed-linux"], ["installed-windows", "receipt-installed-windows"], ["mcp-registry-version", "receipt-mcp-version"], ["merge-exact-sha", "receipt-merge-sha"],
  ["npm-integrity", "receipt-npm-integrity"], ["npm-provenance", "receipt-npm-provenance"], ["tag-immutable-ref", "receipt-tag-ref"],
];
const trustedEvidenceKeys = new Map(trustedLaneSigners.map(([lane, signerId]) => [lane, { signerId, pair: generateKeyPairSync("ed25519") }]));
function keySpkiBase64(key: typeof keyPair.publicKey): string { return key.export({ format: "der", type: "spki" }).toString("base64"); }
function keySpkiDigest(key: typeof keyPair.publicKey): string { return `sha256:${createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex")}`; }
function evidenceVerifier(signerId: string, publicKey: typeof keyPair.publicKey) { return { signerId, publicKeySpkiBase64: keySpkiBase64(publicKey) }; }
const verifier = evidenceVerifier(signer.signerId, keyPair.publicKey);
const graphVerifier = evidenceVerifier(graphSigner.signerId, graphKeyPair.publicKey);
const spkiDigest = (lane: ReleaseEvidenceLaneV1): string => {
  return keySpkiDigest(trustedEvidenceKeys.get(lane)!.pair.publicKey);
};

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
      { digest: digest("4"), path: ".github/workflows/docker-publish.yml" },
      { digest: digest("5"), path: ".github/workflows/mcp-publish.yml" },
      { digest: digest("a"), path: ".github/workflows/npm-publish.yml" },
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
    evidenceVerifierBindings: trustedLaneSigners.map(([lane, signerId]) => ({ lane, publicKeySpkiDigest: spkiDigest(lane), signerId })),
    expiresAt: "2026-08-18T17:00:00.000Z",
    issuedAt: "2026-08-18T05:00:00.000Z",
    jobCardDigest: digest("e"),
    missionDigest: digest("f"),
    packDigest: digest("0"),
    policyDigest: policy.digest,
    receiptGraphMakerBinding: { publicKeySpkiDigest: keySpkiDigest(graphKeyPair.publicKey), signerId: graphSigner.signerId },
    rootGrantDigest: digest("1"),
    stagedCandidateManifestDigest: candidateManifest.digest,
    taskDigest: digest("2"),
  }, signer);
  const qualityEvidence = [
    signedEvidence("ci-coverage", "quality-coverage-verifier", {
      candidateCommit: sha("a"), resultValue: 1, subjectDigest: digest("6"), workflowDigest: digest("3"), workflowPath: ".github/workflows/ci.yml",
    }),
    signedEvidence("ci-full-tests", "quality-full-tests-verifier", {
      candidateCommit: sha("a"), resultValue: 1, subjectDigest: digest("7"), workflowDigest: digest("3"), workflowPath: ".github/workflows/ci.yml",
    }),
    signedEvidence("ci-mutation", "quality-mutation-verifier", {
      candidateCommit: sha("a"), resultValue: 9_137, subjectDigest: digest("8"), workflowDigest: digest("3"), workflowPath: ".github/workflows/ci.yml",
    }),
  ];
  return { authorization, candidateManifest, policy, qualityEvidence };
}

function signedEvidence(
  lane: ReleaseEvidenceLaneV1,
  signerId: string,
  overrides: Partial<ReleaseVerifierEvidenceV1> = {},
): ReleaseEvidenceVerificationV1 {
  const trusted = trustedEvidenceKeys.get(lane)!;
  assert.equal(signerId, trusted.signerId);
  const pair = trusted.pair;
  const evidence = createSignedReleaseVerifierEvidenceV1({
    v: "reelier.release-verifier-evidence/v1",
    authorizationBundleDigest: null,
    candidateCommit: null,
    count: null,
    freshUntil: null,
    lane,
    observation: "workflow-run",
    observedAt: "2026-08-18T05:30:00.000Z",
    resultValue: null,
    status: "verified",
    subjectDigest: digest("f"),
    workflowDigest: null,
    workflowPath: null,
    ...overrides,
  }, { signerId, privateKey: pair.privateKey });
  return { evidence, verifier: evidenceVerifier(signerId, pair.publicKey) };
}

function resignEvidence(input: ReleaseEvidenceVerificationV1, changes: Partial<ReleaseVerifierEvidenceV1>, signingLane?: ReleaseEvidenceLaneV1): ReleaseEvidenceVerificationV1 {
  const current = input.evidence as ReturnType<typeof createSignedReleaseVerifierEvidenceV1>;
  const lane = signingLane ?? current.value.lane;
  const trusted = trustedEvidenceKeys.get(lane)!;
  return {
    evidence: createSignedReleaseVerifierEvidenceV1({ ...current.value, ...changes }, { signerId: trusted.signerId, privateKey: trusted.pair.privateKey }),
    verifier: evidenceVerifier(trusted.signerId, trusted.pair.publicKey),
  };
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
    installedChecks: {
      linux: { ...lane("3"), freshUntil: "2026-08-18T17:15:00.000Z", observedAt: "2026-08-18T16:45:00.000Z" },
      windows: { ...lane("4"), freshUntil: "2026-08-18T17:15:00.000Z", observedAt: "2026-08-18T16:40:00.000Z" },
    },
    mcpRegistry: { version: lane("5") },
    merge: { exactSha: lane("6") },
    npm: { integrity: lane("7"), provenance: lane("8") },
    tag: { immutableRef: lane("9") },
    verifiedAt: "2026-08-18T16:55:00.000Z",
  };
}

function receiptEvidence(graph: ReturnType<typeof releaseReceiptGraph>, authorizationBundleDigest = graph.authorizationBundleDigest): ReleaseEvidenceVerificationV1[] {
  const lane = (name: ReleaseEvidenceLaneV1, subjectDigest: string, signerId: string, overrides: Partial<ReleaseVerifierEvidenceV1> = {}) => signedEvidence(name, signerId, {
    authorizationBundleDigest,
    observation: "provider-readback",
    observedAt: graph.verifiedAt,
    status: "verified",
    subjectDigest,
    ...overrides,
  });
  return [
    lane("candidate-branch", graph.candidate.branch.evidenceDigest, "receipt-candidate-branch", { status: graph.candidate.branch.status }),
    lane("candidate-pull-request", graph.candidate.pullRequest.evidenceDigest, "receipt-candidate-pr", { status: graph.candidate.pullRequest.status }),
    lane("ghcr-immutable-manifest", graph.ghcr.immutableManifest.evidenceDigest, "receipt-ghcr-manifest", { status: graph.ghcr.immutableManifest.status }),
    lane("ghcr-tags", graph.ghcr.tags.evidenceDigest, "receipt-ghcr-tags", { status: graph.ghcr.tags.status }),
    lane("human-authorization", graph.human.authorization.evidenceDigest, "receipt-human-authorization", { count: graph.human.authorization.count, observation: "authority-decision", status: graph.human.authorization.status }),
    lane("human-exceptions", authorityDigest({ count: graph.human.exceptions.count, evidenceDigests: graph.human.exceptions.evidenceDigests, lane: "human-exceptions" }), "receipt-human-exceptions", { count: graph.human.exceptions.count, observation: "human-attestation", status: graph.human.exceptions.status }),
    lane("human-interruptions", authorityDigest({ count: graph.human.interruptions.count, evidenceDigests: graph.human.interruptions.evidenceDigests, lane: "human-interruptions" }), "receipt-human-interruptions", { count: graph.human.interruptions.count, observation: "human-attestation", status: graph.human.interruptions.status }),
    lane("human-post-release-review", graph.human.postReleaseReview.evidenceDigest, "receipt-human-review", { observation: "human-attestation", status: graph.human.postReleaseReview.status }),
    lane("installed-linux", graph.installedChecks.linux.evidenceDigest, "receipt-installed-linux", { freshUntil: graph.installedChecks.linux.freshUntil, observedAt: graph.installedChecks.linux.observedAt, observation: "installed-package", status: graph.installedChecks.linux.status }),
    lane("installed-windows", graph.installedChecks.windows.evidenceDigest, "receipt-installed-windows", { freshUntil: graph.installedChecks.windows.freshUntil, observedAt: graph.installedChecks.windows.observedAt, observation: "installed-package", status: graph.installedChecks.windows.status }),
    lane("mcp-registry-version", graph.mcpRegistry.version.evidenceDigest, "receipt-mcp-version", { status: graph.mcpRegistry.version.status }),
    lane("merge-exact-sha", graph.merge.exactSha.evidenceDigest, "receipt-merge-sha", { status: graph.merge.exactSha.status }),
    lane("npm-integrity", graph.npm.integrity.evidenceDigest, "receipt-npm-integrity", { status: graph.npm.integrity.status }),
    lane("npm-provenance", graph.npm.provenance.evidenceDigest, "receipt-npm-provenance", { status: graph.npm.provenance.status }),
    lane("tag-immutable-ref", graph.tag.immutableRef.evidenceDigest, "receipt-tag-ref", { status: graph.tag.immutableRef.status }),
  ];
}

function verifyAuthorization(release = releaseInputs(), now = new Date("2026-08-18T06:00:00.000Z")) {
  return verifyReleaseAuthorizationBundleV1(authorizationInput(release), verifier, now, release.qualityEvidence);
}

function authorizationInput(release: ReturnType<typeof releaseInputs>) { return { authorization: release.authorization, candidateManifest: release.candidateManifest, policy: release.policy }; }

function trappedProxy<T extends object>(target: T) {
  let traps = 0;
  return {
    proxy: new Proxy(target, {
      get: (value, property, receiver) => { traps += 1; return Reflect.get(value, property, receiver); },
      getOwnPropertyDescriptor: (value, property) => { traps += 1; return Reflect.getOwnPropertyDescriptor(value, property); },
      ownKeys: value => { traps += 1; return Reflect.ownKeys(value); },
    }),
    traps: () => traps,
  };
}

test("release authorization binds the exact reviewed release and is deterministic", () => {
  const first = releaseInputs();
  const second = releaseInputs();
  assert.equal(first.candidateManifest.digest, second.candidateManifest.digest);
  assert.equal(first.policy.digest, second.policy.digest);
  assert.equal(first.authorization.digest, second.authorization.digest);
  assert.deepEqual(first.authorization.signature, second.authorization.signature);

  const verified = verifyAuthorization(first);
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
  (tampered.authorization.value as any).taskDigest = digest("c");
  assert.throws(() => verifyReleaseAuthorizationBundleV1(authorizationInput(tampered), verifier, new Date("2026-08-18T06:00:00.000Z"), release.qualityEvidence), /digest|signature|tamper/i);

  const wrongLink = structuredClone(release);
  (wrongLink.authorization.value as any).policyDigest = digest("d");
  assert.throws(() => verifyReleaseAuthorizationBundleV1(authorizationInput(wrongLink), verifier, new Date("2026-08-18T06:00:00.000Z"), release.qualityEvidence), /digest|policy/i);

  const wrongDuration = structuredClone(release.authorization);
  (wrongDuration.value as any).expiresAt = "2026-08-18T18:00:00.000Z";
  assert.throws(() => parseSignedReleaseAuthorizationBundleV1(wrongDuration), /12-hour|expiry/i);
  assert.throws(() => verifyReleaseAuthorizationBundleV1(authorizationInput(release), verifier, new Date("2026-08-18T17:00:00.000Z"), release.qualityEvidence), /expired/i);
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
  (duplicateSet.value as any).allowedPaths = ["CHANGELOG.md", "CHANGELOG.md", "src/cli.ts"];
  assert.throws(() => verifyReleaseAuthorizationBundleV1({ ...authorizationInput(release), policy: duplicateSet }, verifier, new Date("2026-08-18T06:00:00.000Z"), release.qualityEvidence), /sorted|unique|allowed/i);

  const invalidDigest = structuredClone(release.authorization);
  (invalidDigest.value as any).missionDigest = "sha256:ABC";
  assert.throws(() => parseSignedReleaseAuthorizationBundleV1(invalidDigest), /digest/i);

  const invalidRef = structuredClone(release.candidateManifest);
  (invalidRef.value as any).branch = "refs/heads/main";
  assert.throws(() => verifyReleaseAuthorizationBundleV1({ ...authorizationInput(release), candidateManifest: invalidRef }, verifier, new Date("2026-08-18T06:00:00.000Z"), release.qualityEvidence), /branch|candidate/i);

  const reorderedAllocations = structuredClone(release.authorization);
  (reorderedAllocations.value.effectAllocations as any).reverse();
  assert.throws(() => parseSignedReleaseAuthorizationBundleV1(reorderedAllocations), /ordering|allocations/i);

  const arrayPrototype = structuredClone(release.policy);
  Object.setPrototypeOf(arrayPrototype.value.allowedPaths, null);
  assert.throws(() => verifyReleaseAuthorizationBundleV1({ ...authorizationInput(release), policy: arrayPrototype }, verifier, new Date("2026-08-18T06:00:00.000Z"), release.qualityEvidence), /prototype|plain/i);
});

test("deep parsing refuses every non-inert array shape without invoking custom methods", () => {
  const attacks: Array<(paths: any[]) => void> = [
    paths => Object.defineProperty(paths, Symbol("hidden"), { value: "secret" }),
    paths => Object.defineProperty(paths, "hidden", { value: "secret", enumerable: false }),
    paths => { delete paths[1]; },
    paths => Object.defineProperty(paths, "map", { value: () => { throw new Error("invoked attacker map"); }, enumerable: false }),
  ];
  for (const attack of attacks) {
    const release = releaseInputs();
    const poisoned = structuredClone(release.policy);
    attack(poisoned.value.allowedPaths as any[]);
    assert.throws(
      () => verifyReleaseAuthorizationBundleV1({ ...authorizationInput(release), policy: poisoned }, verifier, new Date("2026-08-18T06:00:00.000Z"), release.qualityEvidence),
      error => error instanceof TypeError && !/invoked attacker/.test(error.message),
    );
  }
});

test("canonical JSON parsing rejects duplicate keys and every noncanonical byte representation", () => {
  const release = releaseInputs();
  const canonical = JSON.stringify(release.authorization);
  assert.deepEqual(parseCanonicalSignedReleaseAuthorizationBundleV1(canonical), release.authorization);
  assert.throws(() => parseCanonicalSignedReleaseAuthorizationBundleV1(` ${canonical}`), /canonical/i);
  assert.throws(() => parseCanonicalSignedReleaseAuthorizationBundleV1(canonical.replace('{"digest"', `{"digest":"sha256:${"0".repeat(64)}","digest"`)), /duplicate/i);
  const reordered = `{"v":"${release.authorization.v}","digest":"${release.authorization.digest}","signature":${JSON.stringify(release.authorization.signature)},"signerId":"${release.authorization.signerId}","value":${JSON.stringify(release.authorization.value)}}`;
  assert.throws(() => parseCanonicalSignedReleaseAuthorizationBundleV1(reordered), /canonical/i);
});

test("receipt graph keeps every evidence lane distinct and succeeds only when all are verified", () => {
  const release = releaseInputs();
  const authorization = verifyAuthorization(release);
  const value = releaseReceiptGraph();
  const signed = createSignedReleaseReceiptGraphV1(value, graphSigner);
  const verified = verifyReleaseReceiptGraphV1(signed, graphVerifier, authorization, receiptEvidence(value), graphVerificationNow);
  assert.deepEqual(verified.evaluation, { completeness: "unchecked", status: "verified", success: true });

  for (const nonSuccess of ["failed", "pending", "absent", "unchecked", "ambiguity"] as const) {
    const value = releaseReceiptGraph(nonSuccess);
    const graph = createSignedReleaseReceiptGraphV1(value, graphSigner);
    const parsed = verifyReleaseReceiptGraphV1(graph, graphVerifier, authorization, receiptEvidence(value), graphVerificationNow);
    assert.deepEqual(parsed.evaluation, { completeness: "unchecked", status: "incomplete", success: false });
  }
});

test("each required receipt lane independently prevents success when it is not verified", () => {
  const release = releaseInputs();
  const authorization = verifyAuthorization(release);
  const selectors: Array<(graph: ReturnType<typeof releaseReceiptGraph>) => { status: ReleaseEvidenceStatus }> = [
    graph => graph.candidate.branch,
    graph => graph.candidate.pullRequest,
    graph => graph.merge.exactSha,
    graph => graph.tag.immutableRef,
    graph => graph.npm.integrity,
    graph => graph.npm.provenance,
    graph => graph.mcpRegistry.version,
    graph => graph.ghcr.immutableManifest,
    graph => graph.ghcr.tags,
    graph => graph.installedChecks.windows,
    graph => graph.installedChecks.linux,
    graph => graph.human.authorization,
    graph => graph.human.interruptions,
    graph => graph.human.exceptions,
    graph => graph.human.postReleaseReview,
  ];
  for (const select of selectors) {
    const value = releaseReceiptGraph();
    select(value).status = "failed";
    const graph = createSignedReleaseReceiptGraphV1(value, graphSigner);
    const parsed = verifyReleaseReceiptGraphV1(graph, graphVerifier, authorization, receiptEvidence(value), graphVerificationNow);
    assert.equal(parsed.evaluation.success, false);
  }
});

test("digest-shaped maker assertions and empty zero-event lists are not verifier evidence", () => {
  const release = releaseInputs();
  const signed = createSignedReleaseReceiptGraphV1(releaseReceiptGraph(), graphSigner);
  assert.throws(
    () => verifyReleaseReceiptGraphV1(signed, graphVerifier, verifyAuthorization(release), [], graphVerificationNow),
    /evidence|verifier|signed|missing/i,
  );
});

test("candidate quality verdicts require distinct signed CI verifier evidence", () => {
  const release = releaseInputs();
  assert.throws(
    () => verifyReleaseAuthorizationBundleV1(authorizationInput(release), verifier, new Date("2026-08-18T06:00:00.000Z"), []),
    /quality|evidence|verifier|signed|missing/i,
  );
});

test("quality evidence refuses wrong head, workflow, signature, alias, and attacker-minted keys", () => {
  const release = releaseInputs();
  const verify = (qualityEvidence: ReleaseEvidenceVerificationV1[]) => verifyReleaseAuthorizationBundleV1(authorizationInput(release), verifier, new Date("2026-08-18T06:00:00.000Z"), qualityEvidence);
  const wrongHead = [...release.qualityEvidence];
  wrongHead[0] = resignEvidence(wrongHead[0], { candidateCommit: sha("b") });
  assert.throws(() => verify(wrongHead), /head|quality/i);

  const wrongWorkflow = [...release.qualityEvidence];
  wrongWorkflow[1] = resignEvidence(wrongWorkflow[1], { workflowDigest: digest("b") });
  assert.throws(() => verify(wrongWorkflow), /workflow|quality/i);

  const tampered = structuredClone(release.qualityEvidence);
  (tampered[2].evidence as any).signature.sig = Buffer.alloc(64).toString("base64");
  assert.throws(() => verify(tampered), /signature/i);

  const aliased = [release.qualityEvidence[0], release.qualityEvidence[0], release.qualityEvidence[2]];
  assert.throws(() => verify(aliased), /duplicate|alias|missing|lane/i);

  const attacker = generateKeyPairSync("ed25519");
  const original = release.qualityEvidence[0].evidence as ReturnType<typeof createSignedReleaseVerifierEvidenceV1>;
  const attackerEvidence = createSignedReleaseVerifierEvidenceV1(original.value, { signerId: "attacker-quality-verifier", privateKey: attacker.privateKey });
  const attackerSet = [...release.qualityEvidence];
  attackerSet[0] = { evidence: attackerEvidence, verifier: evidenceVerifier("attacker-quality-verifier", attacker.publicKey) };
  assert.throws(() => verify(attackerSet), /trusted|signer|binding/i);

  const accessor = [...release.qualityEvidence];
  Object.defineProperty(accessor, "0", { enumerable: true, get: () => { throw new Error("invoked evidence accessor"); } });
  assert.throws(() => verify(accessor), error => error instanceof TypeError && !/invoked evidence accessor/.test(error.message));
});

test("evidence verification rejects nested key accessors without invoking them", () => {
  const release = releaseInputs();
  const poisoned = [...release.qualityEvidence];
  let keyReads = 0;
  const original = poisoned[0];
  const verifierWithKeyAccessor = { signerId: "quality-coverage-verifier" } as Record<string, unknown>;
  Object.defineProperty(verifierWithKeyAccessor, "publicKeySpkiBase64", {
    enumerable: true,
    get: () => {
      keyReads += 1;
      const selected = keyReads % 2 === 1 ? trustedEvidenceKeys.get("ci-coverage")!.pair.publicKey : keyPair.publicKey;
      return keySpkiBase64(selected);
    },
  });
  poisoned[0] = { evidence: original.evidence, verifier: verifierWithKeyAccessor } as any;

  assert.throws(
    () => verifyReleaseAuthorizationBundleV1(authorizationInput(release), verifier, new Date("2026-08-18T06:00:00.000Z"), poisoned),
    error => error instanceof TypeError,
  );
  assert.equal(keyReads, 0);

  let proxyReads = 0;
  const proxied = [...release.qualityEvidence];
  proxied[0] = {
    evidence: original.evidence,
    verifier: new Proxy(evidenceVerifier("quality-coverage-verifier", trustedEvidenceKeys.get("ci-coverage")!.pair.publicKey), {
      get: (target, property, receiver) => {
        proxyReads += 1;
        return Reflect.get(target, property, receiver);
      },
    }),
  };
  assert.doesNotThrow(() => verifyReleaseAuthorizationBundleV1(authorizationInput(release), verifier, new Date("2026-08-18T06:00:00.000Z"), proxied));
  assert.equal(proxyReads, 0);

  let arrayProxyReads = 0;
  const proxiedArray = new Proxy(release.qualityEvidence, {
    get: (target, property, receiver) => {
      arrayProxyReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  assert.doesNotThrow(() => verifyReleaseAuthorizationBundleV1(authorizationInput(release), verifier, new Date("2026-08-18T06:00:00.000Z"), proxiedArray));
  assert.equal(arrayProxyReads, 0);

  let customExportCalls = 0;
  const customExport = [...release.qualityEvidence];
  customExport[0] = {
    evidence: original.evidence,
    verifier: {
      ...evidenceVerifier("quality-coverage-verifier", trustedEvidenceKeys.get("ci-coverage")!.pair.publicKey),
      export: () => { customExportCalls += 1; return keySpkiBase64(keyPair.publicKey); },
    },
  } as any;
  assert.throws(
    () => verifyReleaseAuthorizationBundleV1(authorizationInput(release), verifier, new Date("2026-08-18T06:00:00.000Z"), customExport),
    /exact|verifier|descriptor/i,
  );
  assert.equal(customExportCalls, 0);

  const noncanonical = [...release.qualityEvidence];
  noncanonical[0] = {
    evidence: original.evidence,
    verifier: { signerId: "quality-coverage-verifier", publicKeySpkiBase64: `${keySpkiBase64(trustedEvidenceKeys.get("ci-coverage")!.pair.publicKey)}=` },
  };
  assert.throws(
    () => verifyReleaseAuthorizationBundleV1(authorizationInput(release), verifier, new Date("2026-08-18T06:00:00.000Z"), noncanonical),
    /base64|canonical|spki/i,
  );
});

test("authorization and graph verifiers reject key-switch accessors without invoking them", () => {
  const release = releaseInputs();
  const switchingVerifier = (signerId: string, first: typeof keyPair.publicKey, second: typeof keyPair.publicKey) => {
    let reads = 0;
    const value = { signerId } as Record<string, unknown>;
    Object.defineProperty(value, "publicKeySpkiBase64", {
      enumerable: true,
      get: () => {
        reads += 1;
        return keySpkiBase64(reads % 2 === 1 ? first : second);
      },
    });
    return { reads: () => reads, value };
  };

  const authorizationSwitch = switchingVerifier(signer.signerId, keyPair.publicKey, graphKeyPair.publicKey);
  assert.throws(
    () => verifyReleaseAuthorizationBundleV1(authorizationInput(release), authorizationSwitch.value as any, new Date("2026-08-18T06:00:00.000Z"), release.qualityEvidence),
    /accessor|exact|descriptor|verifier/i,
  );
  assert.equal(authorizationSwitch.reads(), 0);

  const authorization = verifyAuthorization(release);
  const value = releaseReceiptGraph();
  const graph = createSignedReleaseReceiptGraphV1(value, graphSigner);
  const graphSwitch = switchingVerifier(graphSigner.signerId, graphKeyPair.publicKey, keyPair.publicKey);
  assert.throws(
    () => verifyReleaseReceiptGraphV1(graph, graphSwitch.value as any, authorization, receiptEvidence(value), graphVerificationNow),
    /accessor|exact|descriptor|verifier/i,
  );
  assert.equal(graphSwitch.reads(), 0);
});

test("receipt evidence resolves complete signed lanes and refuses missing, duplicate, wrong lane, authorization, subject, signer, and tampering", () => {
  const release = releaseInputs();
  const authorization = verifyAuthorization(release);
  const value = releaseReceiptGraph();
  const graph = createSignedReleaseReceiptGraphV1(value, graphSigner);
  const evidence = receiptEvidence(value);
  assert.equal(verifyReleaseReceiptGraphV1(graph, graphVerifier, authorization, evidence, graphVerificationNow).evaluation.success, true);
  assert.equal((evidence.find(item => (item.evidence as any).value.lane === "human-exceptions")!.evidence as any).value.count, 0);
  assert.equal((evidence.find(item => (item.evidence as any).value.lane === "human-interruptions")!.evidence as any).value.count, 0);
  assert.throws(() => verifyReleaseReceiptGraphV1(graph, graphVerifier, structuredClone(authorization), evidence, graphVerificationNow), /verified authorization|trusted evidence/i);

  assert.throws(() => verifyReleaseReceiptGraphV1(graph, graphVerifier, authorization, evidence.slice(1), graphVerificationNow), /missing|incomplete/i);
  assert.throws(() => verifyReleaseReceiptGraphV1(graph, graphVerifier, authorization, [evidence[0], evidence[0], ...evidence.slice(2)], graphVerificationNow), /duplicate|alias|missing/i);

  const wrongLane = [...evidence];
  wrongLane[0] = resignEvidence(wrongLane[0], { lane: "candidate-pull-request" });
  assert.throws(() => verifyReleaseReceiptGraphV1(graph, graphVerifier, authorization, wrongLane, graphVerificationNow), /lane|trusted|binding|duplicate/i);

  const wrongAuthorization = [...evidence];
  wrongAuthorization[1] = resignEvidence(wrongAuthorization[1], { authorizationBundleDigest: digest("0") });
  assert.throws(() => verifyReleaseReceiptGraphV1(graph, graphVerifier, authorization, wrongAuthorization, graphVerificationNow), /authorization/i);

  const wrongSubject = [...evidence];
  wrongSubject[2] = resignEvidence(wrongSubject[2], { subjectDigest: digest("0") });
  assert.throws(() => verifyReleaseReceiptGraphV1(graph, graphVerifier, authorization, wrongSubject, graphVerificationNow), /subject/i);

  const wrongTrustedLane = [...evidence];
  wrongTrustedLane[3] = resignEvidence(wrongTrustedLane[3], {}, "ghcr-immutable-manifest");
  assert.throws(() => verifyReleaseReceiptGraphV1(graph, graphVerifier, authorization, wrongTrustedLane, graphVerificationNow), /signer|trusted|binding/i);

  const attacker = generateKeyPairSync("ed25519");
  const original = evidence[4].evidence as ReturnType<typeof createSignedReleaseVerifierEvidenceV1>;
  const attackerEvidence = createSignedReleaseVerifierEvidenceV1(original.value, { signerId: "attacker-receipt-verifier", privateKey: attacker.privateKey });
  const attackerSet = [...evidence];
  attackerSet[4] = { evidence: attackerEvidence, verifier: evidenceVerifier("attacker-receipt-verifier", attacker.publicKey) };
  assert.throws(() => verifyReleaseReceiptGraphV1(graph, graphVerifier, authorization, attackerSet, graphVerificationNow), /signer|trusted|binding/i);

  const tampered = structuredClone(evidence);
  (tampered[5].evidence as any).value.count = 1;
  assert.throws(() => verifyReleaseReceiptGraphV1(graph, graphVerifier, authorization, tampered, graphVerificationNow), /digest|tamper/i);

  const makerKey = trustedEvidenceKeys.get("candidate-branch")!;
  const makerGraph = createSignedReleaseReceiptGraphV1(value, { signerId: makerKey.signerId, privateKey: makerKey.pair.privateKey });
  assert.throws(
    () => verifyReleaseReceiptGraphV1(makerGraph, evidenceVerifier(makerKey.signerId, makerKey.pair.publicKey), authorization, evidence, graphVerificationNow),
    /independent|maker|signer|trusted/i,
  );
});

test("the installed authority public barrel exposes release evidence creation and offline verification", () => {
  assert.equal(authorityPublic.createSignedReleaseVerifierEvidenceV1, createSignedReleaseVerifierEvidenceV1);
  assert.equal(authorityPublic.verifyReleaseAuthorizationBundleV1, verifyReleaseAuthorizationBundleV1);
  assert.equal(authorityPublic.verifyReleaseReceiptGraphV1, verifyReleaseReceiptGraphV1);
});

test("authorization verification refuses before issuedAt", () => {
  const release = releaseInputs();
  assert.throws(
    () => verifyReleaseAuthorizationBundleV1(authorizationInput(release), verifier, new Date("2026-08-18T04:59:59.999Z"), release.qualityEvidence),
    /issued|not yet valid/i,
  );
});

test("candidate manifest freezes the complete production workflow path set and permits equal byte digests", () => {
  const release = releaseInputs();
  const expected = [
    ".github/workflows/ci.yml",
    ".github/workflows/docker-publish.yml",
    ".github/workflows/mcp-publish.yml",
    ".github/workflows/npm-publish.yml",
  ];
  const paths = release.candidateManifest.value.workflowCommitments.map(item => item.path);
  assert.deepEqual(paths, expected);

  const equalBytes = structuredClone(release.candidateManifest.value);
  (equalBytes as any).workflowCommitments = equalBytes.workflowCommitments.map(item => ({ ...item, digest: digest("b") }));
  assert.doesNotThrow(() => createSignedStagedCandidateManifestV1(equalBytes, signer));

  for (let index = 0; index < expected.length; index += 1) {
    const omitted = structuredClone(release.candidateManifest.value);
    (omitted.workflowCommitments as any[]).splice(index, 1);
    assert.throws(() => createSignedStagedCandidateManifestV1(omitted, signer), /workflow|path|exact/i);
  }
});

test("receipt graph rejects upgraded completeness, lane aliasing, duplicates, and tampering", () => {
  const release = releaseInputs();
  const signed = createSignedReleaseReceiptGraphV1(releaseReceiptGraph(), graphSigner);
  const completeness = structuredClone(signed);
  (completeness.value as any).completeness = "verified";
  assert.throws(() => parseSignedReleaseReceiptGraphV1(completeness), /completeness/i);

  const aliased = releaseReceiptGraph();
  aliased.candidate.pullRequest.evidenceDigest = aliased.candidate.branch.evidenceDigest;
  assert.throws(() => createSignedReleaseReceiptGraphV1(aliased, graphSigner), /duplicate|distinct/i);

  const duplicateException = releaseReceiptGraph();
  duplicateException.human.exceptions = { count: 2, evidenceDigests: [digest("a"), digest("a")], status: "verified" };
  assert.throws(() => createSignedReleaseReceiptGraphV1(duplicateException, graphSigner), /sorted|unique|duplicate/i);

  const missingAuthorization = releaseReceiptGraph();
  missingAuthorization.human.authorization.count = 0;
  assert.throws(() => createSignedReleaseReceiptGraphV1(missingAuthorization, graphSigner), /authorization count/i);

  const aliasedHumanEvidence = releaseReceiptGraph();
  aliasedHumanEvidence.human.exceptions = { count: 1, evidenceDigests: [digest("a")], status: "verified" };
  aliasedHumanEvidence.human.interruptions = { count: 1, evidenceDigests: [digest("a")], status: "verified" };
  assert.throws(() => createSignedReleaseReceiptGraphV1(aliasedHumanEvidence, graphSigner), /duplicate|distinct/i);

  const tampered = structuredClone(signed);
  (tampered.value.npm.integrity as any).status = "failed";
  const authorization = verifyAuthorization(release);
  assert.throws(() => verifyReleaseReceiptGraphV1(tampered, graphVerifier, authorization, receiptEvidence(releaseReceiptGraph()), graphVerificationNow), /digest|signature|tamper/i);

  const invalidSignature = structuredClone(signed);
  (invalidSignature.signature as any).sig = Buffer.alloc(64).toString("base64");
  assert.throws(() => verifyReleaseReceiptGraphV1(invalidSignature, graphVerifier, authorization, receiptEvidence(releaseReceiptGraph()), graphVerificationNow), /signature/i);

  const staleInstalledCheck = releaseReceiptGraph();
  staleInstalledCheck.installedChecks.windows.freshUntil = "2026-08-18T16:54:59.999Z";
  assert.throws(() => createSignedReleaseReceiptGraphV1(staleInstalledCheck, graphSigner), /fresh|Windows|installed/i);

  const reversedInstalledCheck = releaseReceiptGraph();
  reversedInstalledCheck.installedChecks.windows.freshUntil = "2026-08-18T16:39:59.999Z";
  assert.throws(() => createSignedReleaseReceiptGraphV1(reversedInstalledCheck, graphSigner), /fresh|Windows|installed/i);
});

test("authorization rejects the authorization key reused by an evidence signer alias", () => {
  const release = releaseInputs();
  const authorizationValue = structuredClone(release.authorization.value);
  const authorizationSpki = `sha256:${createHash("sha256").update(keyPair.publicKey.export({ format: "der", type: "spki" })).digest("hex")}`;
  (authorizationValue.evidenceVerifierBindings as any)[0] = {
    lane: "ci-coverage",
    publicKeySpkiDigest: authorizationSpki,
    signerId: "authorization-key-alias",
  };
  const authorization = createSignedReleaseAuthorizationBundleV1(authorizationValue, signer);
  const original = release.qualityEvidence[0].evidence as ReturnType<typeof createSignedReleaseVerifierEvidenceV1>;
  const aliasedEvidence = createSignedReleaseVerifierEvidenceV1(original.value, {
    signerId: "authorization-key-alias",
    privateKey: keyPair.privateKey,
  });
  const qualityEvidence = [...release.qualityEvidence];
  qualityEvidence[0] = {
    evidence: aliasedEvidence,
    verifier: evidenceVerifier("authorization-key-alias", keyPair.publicKey),
  };

  assert.throws(
    () => verifyReleaseAuthorizationBundleV1({ ...authorizationInput(release), authorization }, verifier, new Date("2026-08-18T06:00:00.000Z"), qualityEvidence),
    /key|independent|maker|separat|spki/i,
  );
});

test("authorization permits one evidence-checker key explicitly bound to multiple lanes", () => {
  const release = releaseInputs();
  const authorizationValue = structuredClone(release.authorization.value);
  const shared = trustedEvidenceKeys.get("ci-coverage")!;
  (authorizationValue.evidenceVerifierBindings as any)[1] = {
    lane: "ci-full-tests",
    publicKeySpkiDigest: keySpkiDigest(shared.pair.publicKey),
    signerId: "quality-full-tests-shared-key",
  };
  const authorization = createSignedReleaseAuthorizationBundleV1(authorizationValue, signer);
  const original = release.qualityEvidence[1].evidence as ReturnType<typeof createSignedReleaseVerifierEvidenceV1>;
  const evidence = [...release.qualityEvidence];
  evidence[1] = {
    evidence: createSignedReleaseVerifierEvidenceV1(original.value, { signerId: "quality-full-tests-shared-key", privateKey: shared.pair.privateKey }),
    verifier: evidenceVerifier("quality-full-tests-shared-key", shared.pair.publicKey),
  };
  assert.doesNotThrow(() => verifyReleaseAuthorizationBundleV1({ ...authorizationInput(release), authorization }, verifier, new Date("2026-08-18T06:00:00.000Z"), evidence));
});

test("authorization refuses a graph-maker key reused by an evidence-checker alias", () => {
  const release = releaseInputs();
  const authorizationValue = structuredClone(release.authorization.value);
  const checker = trustedEvidenceKeys.get("candidate-branch")!;
  (authorizationValue as any).receiptGraphMakerBinding = {
    publicKeySpkiDigest: keySpkiDigest(checker.pair.publicKey),
    signerId: "graph-maker-checker-key-alias",
  };
  assert.throws(
    () => createSignedReleaseAuthorizationBundleV1(authorizationValue, signer),
    /graph|maker|checker|separate|spki/i,
  );
});

test("receipt verification rejects arbitrary graph keys and graph-maker key aliases", () => {
  const release = releaseInputs();
  const authorization = verifyAuthorization(release);
  const value = releaseReceiptGraph();
  const evidence = receiptEvidence(value);
  const arbitrary = generateKeyPairSync("ed25519");
  const arbitraryGraph = createSignedReleaseReceiptGraphV1(value, { signerId: "arbitrary-graph-maker", privateKey: arbitrary.privateKey });
  assert.throws(
    () => verifyReleaseReceiptGraphV1(arbitraryGraph, evidenceVerifier("arbitrary-graph-maker", arbitrary.publicKey), authorization, evidence, graphVerificationNow),
    /bound|graph|maker|trusted/i,
  );

  const authorizationAliasGraph = createSignedReleaseReceiptGraphV1(value, { signerId: "authorization-graph-alias", privateKey: keyPair.privateKey });
  assert.throws(
    () => verifyReleaseReceiptGraphV1(authorizationAliasGraph, evidenceVerifier("authorization-graph-alias", keyPair.publicKey), authorization, evidence, graphVerificationNow),
    /key|independent|maker|separat|spki/i,
  );

  const checker = trustedEvidenceKeys.get("candidate-branch")!;
  const aliasGraph = createSignedReleaseReceiptGraphV1(value, { signerId: "graph-maker-key-alias", privateKey: checker.pair.privateKey });
  assert.throws(
    () => verifyReleaseReceiptGraphV1(aliasGraph, evidenceVerifier("graph-maker-key-alias", checker.pair.publicKey), authorization, evidence, graphVerificationNow),
    /key|independent|maker|separat|spki/i,
  );
});

test("quality evidence chronology is closed at issue, verification-now, and expiry boundaries", () => {
  const release = releaseInputs();
  const verifyAt = (observedAt: string, now: string) => {
    const evidence = release.qualityEvidence.map(item => resignEvidence(item, { observedAt }));
    return verifyReleaseAuthorizationBundleV1(authorizationInput(release), verifier, new Date(now), evidence);
  };
  assert.doesNotThrow(() => verifyAt("2026-08-18T05:00:00.000Z", "2026-08-18T06:00:00.000Z"));
  assert.doesNotThrow(() => verifyAt("2026-08-18T06:00:00.000Z", "2026-08-18T06:00:00.000Z"));
  assert.throws(() => verifyAt("2026-08-18T04:59:59.999Z", "2026-08-18T06:00:00.000Z"), /observed|issue|chronolog|time/i);
  assert.throws(() => verifyAt("2026-08-18T06:00:00.001Z", "2026-08-18T06:00:00.000Z"), /future|observed|verification|time/i);
  assert.throws(() => verifyAt("2026-08-18T17:00:00.000Z", "2026-08-18T16:59:59.999Z"), /expiry|observed|future|time/i);
});

test("receipt graph chronology uses explicit current time and permits historical verification after expiry", () => {
  const release = releaseInputs();
  const authorization = verifyAuthorization(release);
  const verifyGraphAt = (verifiedAt: string, now: string) => {
    const value = releaseReceiptGraph();
    value.verifiedAt = verifiedAt;
    value.installedChecks.linux.observedAt = verifiedAt;
    value.installedChecks.windows.observedAt = verifiedAt;
    const signed = createSignedReleaseReceiptGraphV1(value, graphSigner);
    return verifyReleaseReceiptGraphV1(signed, graphVerifier, authorization, receiptEvidence(value), new Date(now));
  };
  assert.doesNotThrow(() => verifyGraphAt("2026-08-18T05:00:00.000Z", "2026-08-18T05:00:00.000Z"));
  assert.doesNotThrow(() => verifyGraphAt("2026-08-18T16:59:59.999Z", "2026-08-19T05:00:00.000Z"));
  assert.throws(() => verifyGraphAt("2026-08-18T04:59:59.999Z", "2026-08-18T06:00:00.000Z"), /graph|issue|chronolog|time/i);
  assert.throws(() => verifyGraphAt("2026-08-18T17:00:00.000Z", "2026-08-18T18:00:00.000Z"), /graph|expiry|chronolog|time/i);
  assert.throws(() => verifyGraphAt("2026-08-18T06:00:00.001Z", "2026-08-18T06:00:00.000Z"), /future|graph|verification|time/i);
});

test("every receipt evidence observation is between authorization issue and graph verification", () => {
  const release = releaseInputs();
  const authorization = verifyAuthorization(release);
  const value = releaseReceiptGraph();
  value.verifiedAt = "2026-08-18T16:55:00.000Z";
  const graph = createSignedReleaseReceiptGraphV1(value, graphSigner);
  const evidence = receiptEvidence(value);
  const verify = (observedAt: string) => {
    const changed = [...evidence];
    changed[0] = resignEvidence(changed[0], { observedAt });
    return verifyReleaseReceiptGraphV1(graph, graphVerifier, authorization, changed, new Date("2026-08-18T16:55:00.000Z"));
  };
  assert.doesNotThrow(() => verify("2026-08-18T05:00:00.000Z"));
  assert.doesNotThrow(() => verify("2026-08-18T16:55:00.000Z"));
  assert.throws(() => verify("2026-08-18T04:59:59.999Z"), /evidence|issue|chronolog|observed/i);
  assert.throws(() => verify("2026-08-18T16:55:00.001Z"), /evidence|graph|chronolog|observed/i);
});

test("signed release wire rejects top-level and nested proxies without executing any trap", () => {
  const release = releaseInputs();
  const graph = createSignedReleaseReceiptGraphV1(releaseReceiptGraph(), graphSigner);
  const evidence = release.qualityEvidence[0].evidence;
  const cases: ReadonlyArray<readonly [string, object, (value: unknown) => unknown, (copy: any, proxy: object) => void]> = [
    ["authorization", release.authorization, parseSignedReleaseAuthorizationBundleV1, (copy, proxy) => { copy.value.receiptGraphMakerBinding = proxy; }],
    ["candidate", release.candidateManifest, parseSignedStagedCandidateManifestV1, (copy, proxy) => { copy.value.qualityEvidence = proxy; }],
    ["policy", release.policy, parseSignedReleasePolicyV1, (copy, proxy) => { copy.value.allowedPaths = proxy; }],
    ["graph", graph, parseSignedReleaseReceiptGraphV1, (copy, proxy) => { copy.value.installedChecks = proxy; }],
    ["evidence", evidence as object, parseSignedReleaseVerifierEvidenceV1, (copy, proxy) => { copy.signature = proxy; }],
  ];

  for (const [label, artifact, parse, installNested] of cases) {
    const top = trappedProxy(artifact);
    assert.throws(() => parse(top.proxy), /proxy/i, `${label} top-level proxy must refuse`);
    assert.equal(top.traps(), 0, `${label} top-level proxy traps`);

    const copy = structuredClone(artifact);
    const nested = trappedProxy({ inert: true });
    installNested(copy, nested.proxy);
    assert.throws(() => parse(copy), /proxy/i, `${label} nested proxy must refuse`);
    assert.equal(nested.traps(), 0, `${label} nested proxy traps`);
  }
});

test("verification snapshots accepted release wire instead of retaining caller objects", () => {
  const release = releaseInputs();
  const input = authorizationInput(release);
  const verified = verifyReleaseAuthorizationBundleV1(input, verifier, new Date("2026-08-18T06:00:00.000Z"), release.qualityEvidence);
  assert.notEqual(verified.authorization, input.authorization);
  assert.notEqual(verified.authorization.value, input.authorization.value);
  assert.notEqual(verified.candidateManifest, input.candidateManifest);
  assert.notEqual(verified.policy, input.policy);
});

test("authorization verification rejects hostile clocks without invoking overrides and accepts issue-time now", () => {
  const release = releaseInputs();
  const issueEvidence = release.qualityEvidence.map(item => resignEvidence(item, { observedAt: "2026-08-18T05:00:00.000Z" }));
  assert.doesNotThrow(() => verifyReleaseAuthorizationBundleV1(authorizationInput(release), verifier, new Date("2026-08-18T05:00:00.000Z"), issueEvidence));

  let calls = 0;
  const ownMethod = new Date("2026-08-18T06:00:00.000Z") as Date & { getTime: () => number };
  ownMethod.getTime = () => { calls += 1; return Date.parse("2026-08-18T06:00:00.000Z"); };
  assert.throws(() => verifyReleaseAuthorizationBundleV1(authorizationInput(release), verifier, ownMethod, release.qualityEvidence), /clock|date|own|property/i);
  assert.equal(calls, 0);

  const ownGetter = new Date("2026-08-18T06:00:00.000Z");
  Object.defineProperty(ownGetter, "getTime", { get: () => { calls += 1; return Date.prototype.getTime; } });
  assert.throws(() => verifyReleaseAuthorizationBundleV1(authorizationInput(release), verifier, ownGetter, release.qualityEvidence), /clock|date|own|property/i);
  assert.equal(calls, 0);

  class SwitchingDate extends Date {
    override getTime(): number { calls += 1; return calls % 2 === 1 ? Date.parse("2026-08-18T06:00:00.000Z") : Date.parse("2026-08-18T18:00:00.000Z"); }
  }
  assert.throws(() => verifyReleaseAuthorizationBundleV1(authorizationInput(release), verifier, new SwitchingDate("2026-08-18T06:00:00.000Z"), release.qualityEvidence), /clock|date|prototype/i);
  assert.equal(calls, 0);

  const proxied = trappedProxy(new Date("2026-08-18T06:00:00.000Z"));
  assert.throws(() => verifyReleaseAuthorizationBundleV1(authorizationInput(release), verifier, proxied.proxy as Date, release.qualityEvidence), /proxy/i);
  assert.equal(proxied.traps(), 0);
});

test("receipt verification rejects hostile clocks without invoking overrides", () => {
  const release = releaseInputs();
  const authorization = verifyAuthorization(release);
  const value = releaseReceiptGraph();
  const graph = createSignedReleaseReceiptGraphV1(value, graphSigner);
  const evidence = receiptEvidence(value);
  let calls = 0;
  const switching = new Date("2026-08-18T16:55:00.000Z") as Date & { getTime: () => number };
  switching.getTime = () => { calls += 1; return calls % 2 === 1 ? Date.parse("2026-08-18T16:55:00.000Z") : Date.parse("2026-08-18T16:54:00.000Z"); };
  assert.throws(() => verifyReleaseReceiptGraphV1(graph, graphVerifier, authorization, evidence, switching), /clock|date|own|property/i);
  assert.equal(calls, 0);

  const proxied = trappedProxy(new Date("2026-08-18T16:55:00.000Z"));
  assert.throws(() => verifyReleaseReceiptGraphV1(graph, graphVerifier, authorization, evidence, proxied.proxy as Date), /proxy/i);
  assert.equal(proxied.traps(), 0);
});

test("authorization refuses its signing key as the authorization-bound graph-maker key", () => {
  const release = releaseInputs();
  const value = structuredClone(release.authorization.value);
  (value as any).receiptGraphMakerBinding = { publicKeySpkiDigest: keySpkiDigest(keyPair.publicKey), signerId: signer.signerId };
  const authorization = createSignedReleaseAuthorizationBundleV1(value, signer);
  assert.throws(
    () => verifyReleaseAuthorizationBundleV1({ ...authorizationInput(release), authorization }, verifier, new Date("2026-08-18T06:00:00.000Z"), release.qualityEvidence),
    /key|graph|maker|separate|spki/i,
  );
});

test("installed freshness boundaries reject equality", () => {
  const verifiedAtEqualsFreshUntil = releaseReceiptGraph();
  verifiedAtEqualsFreshUntil.installedChecks.windows.freshUntil = verifiedAtEqualsFreshUntil.verifiedAt;
  assert.throws(() => createSignedReleaseReceiptGraphV1(verifiedAtEqualsFreshUntil, graphSigner), /fresh|Windows|installed/i);

  const freshUntilEqualsObservedAt = releaseReceiptGraph();
  freshUntilEqualsObservedAt.installedChecks.windows.freshUntil = freshUntilEqualsObservedAt.installedChecks.windows.observedAt;
  assert.throws(() => createSignedReleaseReceiptGraphV1(freshUntilEqualsObservedAt, graphSigner), /fresh|Windows|installed/i);
});
