import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authorityDigest } from "../../src/authority/wire.js";
import { createSignedJournal } from "../../src/authority/host/signed-journal.js";
import { createGitHubReleaseRunner } from "../../src/authority/host/github-release-runner.js";
import { createSignedReleaseAuthorizationBundleV1, createSignedReleaseOperationPlanV1, createSignedReleasePolicyV1, createSignedReleaseVerifierEvidenceV1, createSignedStagedCandidateManifestV1, verifyReleaseAuthorizationBundleV1, type ReleaseEvidenceLaneV1 } from "../../src/authority/release-contracts.js";

const digest = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;
const gitSha = (seed: string) => seed.repeat(40);
const spki = (key: ReturnType<typeof generateKeyPairSync>["publicKey"]) => key.export({ type: "spki", format: "der" }).toString("base64");
const spkiDigest = (key: ReturnType<typeof generateKeyPairSync>["publicKey"]) => `sha256:${createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex")}`;
const blobSha = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const allLanes: ReleaseEvidenceLaneV1[] = ["ci-coverage", "ci-full-tests", "ci-mutation", "candidate-branch", "candidate-pull-request", "ghcr-immutable-manifest", "ghcr-tags", "human-authorization", "human-exceptions", "human-interruptions", "human-post-release-review", "installed-linux", "installed-windows", "mcp-registry-version", "merge-exact-sha", "npm-integrity", "npm-provenance", "tag-immutable-ref"];

function releaseAuthorityFixture() {
  const authorityKeys = generateKeyPairSync("ed25519"), evidenceKeys = generateKeyPairSync("ed25519"), graphKeys = generateKeyPairSync("ed25519");
  const authoritySigner = { signerId: "release-authority-2026", privateKey: authorityKeys.privateKey };
  const evidenceSigner = { signerId: "release-provider-verifier", privateKey: evidenceKeys.privateKey };
  const contents = [Buffer.from("changelog\n"), Buffer.from("cli\n"), Buffer.from("test\n")];
  const files = ["CHANGELOG.md", "src/cli.ts", "test/cli-subcommand-help.test.ts"].map((filePath, index) => ({ blobSha: blobSha(contents[index]!), contentDigest: `sha256:${createHash("sha256").update(contents[index]!).digest("hex")}`, mode: "100644" as const, path: filePath }));
  const candidateTreeDigest = authorityDigest({ v: "reelier.release-candidate-tree/v1", files });
  const workflows = [{ digest: digest("3"), path: ".github/workflows/ci.yml" }, { digest: digest("4"), path: ".github/workflows/docker-publish.yml" }, { digest: digest("5"), path: ".github/workflows/mcp-publish.yml" }, { digest: digest("6"), path: ".github/workflows/npm-publish.yml" }];
  const operationPlan = createSignedReleaseOperationPlanV1({ v: "reelier.release-operation-plan/v1", repository: "seldonframe/reelier", baseCommit: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b", candidateBranch: "reelier/release/0.32.1", destinationBranch: "main", tag: "v0.32.1", candidateTreeDigest, expectedTreeSha: gitSha("e"), expectedCommitSha: gitSha("a"), expectedSquashCommitSha: gitSha("f"), files, commit: { author: { name: "SeldonFrame Release", email: "release@seldonframe.com", date: "2026-08-18T05:00:00.000Z" }, committer: { name: "SeldonFrame Release", email: "release@seldonframe.com", date: "2026-08-18T05:00:00.000Z" }, message: "release: v0.32.1", parentSha: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b" }, pullRequest: { base: "main", head: "reelier/release/0.32.1", draft: true, title: "Release v0.32.1", body: "Governed release v0.32.1" }, squash: { commitTitle: "Release v0.32.1", commitMessage: "release: v0.32.1" }, requiredChecks: ["coverage", "full-tests", "mutation"], workflowCommitments: workflows, npmPreflight: { packageName: "reelier", version: "0.32.1", versionMustBeAbsent: true } }, authoritySigner);
  const candidateManifest = createSignedStagedCandidateManifestV1({ v: "reelier.staged-candidate-manifest/v1", repository: "seldonframe/reelier", baseCommit: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b", destinationBranch: "main", branch: "reelier/release/0.32.1", tag: "v0.32.1", packageName: "reelier", packageVersion: "0.32.1", candidateCommit: gitSha("a"), candidateTreeDigest, changedBytes: contents.reduce((sum, value) => sum + value.length, 0), changedPaths: files.map(file => file.path), packedTarballDigest: digest("2"), workflowCommitments: workflows, qualityEvidence: { coverageEvidenceDigest: digest("7"), coverageStatus: "non-regressed", fullTestEvidenceDigest: digest("8"), fullTestsStatus: "verified", headCommit: gitSha("a"), mutationEvidenceDigest: digest("9"), mutationScoreBasisPoints: 9_500 } }, authoritySigner);
  const policy = createSignedReleasePolicyV1({ v: "reelier.release-policy/v1", allowedPaths: files.map(file => file.path), destinations: ["ghcr", "mcp-registry", "npm"], effectAllocations: ["candidate-branch", "draft-pr", "exact-sha-merge", "non-force-tag"], expirySeconds: 43_200, forbiddenChangeClasses: ["authority-contract", "credential", "dependency", "generated-contract", "lockfile", "policy", "release-script", "workflow"], maxChangedBytes: 65_536, maxChangedFiles: 3 }, authoritySigner);
  const effects = ["candidate-branch", "draft-pr", "exact-sha-merge", "non-force-tag"] as const;
  const authorization = createSignedReleaseAuthorizationBundleV1({ v: "reelier.release-authorization-bundle/v1", authorityCellDigest: digest("a"), effectAllocations: effects.map((effect, index) => ({ allocationDigest: digest(String(index + 1)), allocationId: `release-${effect}-01`, effect, maxEffects: 1 as const })), evidenceVerifierBindings: allLanes.map(lane => ({ lane, signerId: evidenceSigner.signerId, publicKeySpkiDigest: spkiDigest(evidenceKeys.publicKey) })), expiresAt: "2026-08-18T17:00:00.000Z", issuedAt: "2026-08-18T05:00:00.000Z", jobCardDigest: digest("b"), missionDigest: digest("c"), operationPlanDigest: operationPlan.digest, packDigest: digest("d"), policyDigest: policy.digest, receiptGraphMakerBinding: { signerId: "release-graph-maker-2026", publicKeySpkiDigest: spkiDigest(graphKeys.publicKey) }, rootGrantDigest: digest("e"), stagedCandidateManifestDigest: candidateManifest.digest, taskDigest: digest("f") }, authoritySigner);
  const evidence = [["ci-coverage", digest("7"), 1], ["ci-full-tests", digest("8"), 1], ["ci-mutation", digest("9"), 9_500]].map(([lane, subjectDigest, resultValue]) => ({ evidence: createSignedReleaseVerifierEvidenceV1({ v: "reelier.release-verifier-evidence/v1", authorizationBundleDigest: null, candidateCommit: gitSha("a"), count: null, freshUntil: null, lane: lane as ReleaseEvidenceLaneV1, observation: "workflow-run", observedAt: "2026-08-18T05:30:00.000Z", resultValue: resultValue as number, status: "verified", subjectDigest: subjectDigest as string, workflowDigest: digest("3"), workflowPath: ".github/workflows/ci.yml" }, evidenceSigner), verifier: { signerId: evidenceSigner.signerId, publicKeySpkiBase64: spki(evidenceKeys.publicKey) } }));
  const verified = verifyReleaseAuthorizationBundleV1({ authorization, candidateManifest, operationPlan, policy }, { signerId: authoritySigner.signerId, publicKeySpkiBase64: spki(authorityKeys.publicKey) }, new Date("2026-08-18T06:00:00.000Z"), evidence);
  return { context: { authorization: verified, fileContents: files.map((file, index) => ({ path: file.path, bytesBase64: contents[index]!.toString("base64") })) }, evidenceSigner };
}

test("signed journal detects tamper and atomic-head rollback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-release-journal-"));
  const keys = generateKeyPairSync("ed25519");
  try {
    const journal = await createSignedJournal({ rootDir: root, journalId: "release", signerId: "release-journal-2026", privateKey: keys.privateKey, publicKey: keys.publicKey });
    await journal.append("request_1", authorityDigest({ request: 1 }), "authorized", { alias: "github_release_candidate_publish_v1" });
    await journal.append("request_1", authorityDigest({ request: 1 }), "blob-created", { sha: "a".repeat(40) });
    assert.equal((await journal.load("request_1")).at(-1)?.phase, "blob-created");
    const directory = path.join(root, authorityDigest({ journalId: "release", requestId: "request_1" }).slice(7));
    const events = (await readdir(directory)).filter(name => name.startsWith("event-")).sort();
    const eventPath = path.join(directory, events[0]!);
    const event = JSON.parse(await readFile(eventPath, "utf8"));
    await writeFile(eventPath, JSON.stringify({ ...event, data: { alias: "attacker" } }));
    await assert.rejects(() => journal.load("request_1"), /signature|digest|tamper/i);
    await writeFile(eventPath, JSON.stringify(event));
    await writeFile(path.join(directory, "head.json"), JSON.stringify({ digest: event.digest, sequence: 0 }));
    await assert.rejects(() => journal.load("request_1"), /rollback|head|fork/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("release runner refuses raw or wrong allocation authority before provider dispatch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-release-runner-"));
  const keys = generateKeyPairSync("ed25519");
  let calls = 0;
  const provider = new Proxy({}, { get: () => async () => { calls += 1; throw new Error("provider must not be called"); } });
  try {
    const runner = await createGitHubReleaseRunner({
      rootDir: root,
      journalSigner: { signerId: "release-journal-2026", privateKey: keys.privateKey, publicKey: keys.publicKey },
      evidenceSigner: { signerId: "receipt-candidate-branch", privateKey: keys.privateKey },
      authorizationResolver: async () => ({ authorization: { value: { effectAllocations: [{ allocationId: "wrong", allocationDigest: authorityDigest({ wrong: true }), effect: "candidate-branch", maxEffects: 1 }] } } }) as never,
      provider: provider as never,
      now: () => new Date("2026-08-18T06:00:00.000Z"),
    });
    await assert.rejects(() => runner.run({ alias: "github_release_candidate_publish_v1", authorizationHandle: "release_auth_1", requestId: "request_1", semanticsDigest: authorityDigest({ request: 1 }) }), /verified authorization|allocation|brand/i);
    assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("four-operation release saga converges after ambiguous merge and tag without resend", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-release-saga-"));
  const fixture = releaseAuthorityFixture(), journalKeys = generateKeyPairSync("ed25519");
  const refs = new Map<string, string>([["heads/main", "e600ad5c2dc5e1bde0714915e7a84980c8d5602b"]]);
  let pullRequest: any = null, mergeCalls = 0, tagCalls = 0;
  const provider = {
    createBlob: async ({ contentBase64 }: any) => ({ sha: blobSha(Buffer.from(contentBase64, "base64")) }),
    createTree: async () => ({ sha: gitSha("e") }),
    createCommit: async () => ({ sha: gitSha("a") }),
    getRef: async ({ ref }: any) => refs.has(ref) ? { sha: refs.get(ref)! } : null,
    createRef: async ({ ref, sha }: any) => { if (refs.has(ref)) throw new Error("exists"); refs.set(ref, sha); if (ref === "tags/v0.32.1") { tagCalls += 1; throw new Error("socket lost after tag"); } return { sha }; },
    getCommit: async ({ sha }: any) => sha === gitSha("a") ? { sha, parentSha: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b", treeSha: gitSha("e") } : { sha, parentSha: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b", treeSha: gitSha("e") },
    findPullRequests: async () => pullRequest ? [pullRequest] : [],
    createPullRequest: async (metadata: any) => (pullRequest = { ...metadata, number: 1, merged: false, headSha: gitSha("a") }),
    getPullRequest: async () => pullRequest,
    getChecks: async () => ["coverage", "full-tests", "mutation"].map(name => ({ name, status: "success", workflowDigest: digest("3") })),
    mergePullRequest: async () => { mergeCalls += 1; pullRequest = { ...pullRequest, merged: true, mergeCommitSha: gitSha("f") }; refs.set("heads/main", gitSha("f")); throw new Error("socket lost after merge"); },
    npmVersionExists: async () => false,
    readPackageManifest: async () => ({ name: "reelier", version: "0.32.1" }),
  };
  try {
    const runner = await createGitHubReleaseRunner({ rootDir: root, journalSigner: { signerId: "release-journal-2026", privateKey: journalKeys.privateKey, publicKey: journalKeys.publicKey }, evidenceSigner: fixture.evidenceSigner, authorizationResolver: async () => fixture.context, provider, now: () => new Date("2026-08-18T06:00:00.000Z") });
    const invoke = (alias: any, requestId: string) => runner.run({ alias, authorizationHandle: "release_auth_1", requestId, semanticsDigest: authorityDigest({ alias, requestId }) });
    assert.equal((await invoke("github_release_candidate_publish_v1", "candidate_1")).status, "verified");
    assert.equal((await invoke("github_release_pr_ensure_v1", "pr_1")).status, "verified");
    assert.equal((await invoke("github_release_pr_merge_v1", "merge_1")).status, "verified");
    assert.equal((await invoke("github_release_tag_create_v1", "tag_1")).status, "verified");
    assert.equal(mergeCalls, 1);
    assert.equal(tagCalls, 1);
    assert.equal((await invoke("github_release_pr_merge_v1", "merge_1")).status, "verified");
    assert.equal((await invoke("github_release_tag_create_v1", "tag_1")).status, "verified");
    assert.equal(mergeCalls, 1, "merge must never be resent after ambiguous response");
    assert.equal(tagCalls, 1, "tag must never be resent after ambiguous response");
  } finally { await rm(root, { recursive: true, force: true }); }
});
