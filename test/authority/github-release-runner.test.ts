import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authorityDigest } from "../../src/authority/wire.js";
import { createSignedJournal } from "../../src/authority/host/signed-journal.js";
import { createGitHubReleaseDispatchAdapter, createGitHubReleaseReceiptPublication, createGitHubReleaseRunner } from "../../src/authority/host/github-release-runner.js";
import { createDispatchCommitLease, createPreparedDispatch, consumePreparedDispatch } from "../../src/authority/host/prepared-dispatch.js";
import { materializedHttpRequestDigest } from "../../src/authority/host/http-response-semantics.js";
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
  const operationPlan = createSignedReleaseOperationPlanV1({ v: "reelier.release-operation-plan/v1", repository: "seldonframe/reelier", baseCommit: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b", baseTreeSha: gitSha("b"), candidateBranch: "reelier/release/0.32.1", destinationBranch: "main", tag: "v0.32.1", candidateTreeDigest, expectedTreeSha: gitSha("e"), expectedCommitSha: gitSha("a"), files, commit: { author: { name: "SeldonFrame Release", email: "release@seldonframe.com", date: "2026-08-18T05:00:00.000Z" }, committer: { name: "SeldonFrame Release", email: "release@seldonframe.com", date: "2026-08-18T05:00:00.000Z" }, message: "release: v0.32.1", parentSha: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b" }, pullRequest: { base: "main", head: "reelier/release/0.32.1", draft: true, title: "Release v0.32.1", body: "Governed release v0.32.1" }, squash: { commitTitle: "Release v0.32.1", commitMessage: "release: v0.32.1" }, requiredChecks: ["coverage", "full-tests", "mutation"], workflowCommitments: workflows, npmPreflight: { packageName: "reelier", version: "0.32.1", versionMustBeAbsent: true } } as any, authoritySigner);
  const candidateManifest = createSignedStagedCandidateManifestV1({ v: "reelier.staged-candidate-manifest/v1", repository: "seldonframe/reelier", baseCommit: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b", destinationBranch: "main", branch: "reelier/release/0.32.1", tag: "v0.32.1", packageName: "reelier", packageVersion: "0.32.1", candidateCommit: gitSha("a"), candidateTreeDigest, changedBytes: contents.reduce((sum, value) => sum + value.length, 0), changedPaths: files.map(file => file.path), packedTarballDigest: digest("2"), workflowCommitments: workflows, qualityEvidence: { coverageEvidenceDigest: digest("7"), coverageStatus: "non-regressed", fullTestEvidenceDigest: digest("8"), fullTestsStatus: "verified", headCommit: gitSha("a"), mutationEvidenceDigest: digest("9"), mutationScoreBasisPoints: 9_500 } }, authoritySigner);
  const policy = createSignedReleasePolicyV1({ v: "reelier.release-policy/v1", allowedPaths: files.map(file => file.path), destinations: ["ghcr", "mcp-registry", "npm"], effectAllocations: ["candidate-branch", "draft-pr", "exact-sha-merge", "non-force-tag"], expirySeconds: 43_200, forbiddenChangeClasses: ["authority-contract", "credential", "dependency", "generated-contract", "lockfile", "policy", "release-script", "workflow"], maxChangedBytes: 65_536, maxChangedFiles: 3 }, authoritySigner);
  const effects = ["candidate-branch", "draft-pr", "exact-sha-merge", "non-force-tag"] as const;
  const authorization = createSignedReleaseAuthorizationBundleV1({ v: "reelier.release-authorization-bundle/v1", authorityCellDigest: digest("a"), effectAllocations: effects.map((effect, index) => ({ allocationDigest: digest(String(index + 1)), allocationId: `release-${effect}-01`, effect, maxEffects: 1 as const })), evidenceVerifierBindings: allLanes.map(lane => ({ lane, signerId: evidenceSigner.signerId, publicKeySpkiDigest: spkiDigest(evidenceKeys.publicKey) })), expiresAt: "2026-08-18T17:00:00.000Z", issuedAt: "2026-08-18T05:00:00.000Z", jobCardDigest: digest("b"), missionDigest: digest("c"), operationPlanDigest: operationPlan.digest, packDigest: digest("d"), policyDigest: policy.digest, receiptGraphMakerBinding: { signerId: "release-graph-maker-2026", publicKeySpkiDigest: spkiDigest(graphKeys.publicKey) }, rootGrantDigest: digest("e"), stagedCandidateManifestDigest: candidateManifest.digest, taskDigest: digest("f") }, authoritySigner);
  const evidence = [["ci-coverage", digest("7"), 1], ["ci-full-tests", digest("8"), 1], ["ci-mutation", digest("9"), 9_500]].map(([lane, subjectDigest, resultValue]) => ({ evidence: createSignedReleaseVerifierEvidenceV1({ v: "reelier.release-verifier-evidence/v1", authorizationBundleDigest: null, candidateCommit: gitSha("a"), count: null, freshUntil: null, lane: lane as ReleaseEvidenceLaneV1, observation: "workflow-run", observedAt: "2026-08-18T05:30:00.000Z", resultValue: resultValue as number, status: "verified", subjectDigest: subjectDigest as string, workflowDigest: digest("3"), workflowPath: ".github/workflows/ci.yml" }, evidenceSigner), verifier: { signerId: evidenceSigner.signerId, publicKeySpkiBase64: spki(evidenceKeys.publicKey) } }));
  const verified = verifyReleaseAuthorizationBundleV1({ authorization, candidateManifest, operationPlan, policy }, { signerId: authoritySigner.signerId, publicKeySpkiBase64: spki(authorityKeys.publicKey) }, new Date("2026-08-18T06:00:00.000Z"), evidence);
  return { context: { authorization: verified, fileContents: files.map((file, index) => ({ path: file.path, bytesBase64: contents[index]!.toString("base64") })) }, evidenceSigner };
}

function candidateProvider(overrides: Record<string, unknown> = {}) {
  const refs = new Map<string, string>([["heads/main", "e600ad5c2dc5e1bde0714915e7a84980c8d5602b"]]);
  return {
    createBlob: async ({ contentBase64 }: any) => ({ sha: blobSha(Buffer.from(contentBase64, "base64")) }),
    createTree: async () => ({ sha: gitSha("e") }), createCommit: async () => ({ sha: gitSha("a") }),
    getRef: async ({ ref }: any) => refs.has(ref) ? { sha: refs.get(ref)! } : null,
    createRef: async ({ ref, sha }: any) => { refs.set(ref, sha); return { sha }; },
    getCommit: async ({ sha }: any) => ({ sha, parentSha: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b", treeSha: sha === "e600ad5c2dc5e1bde0714915e7a84980c8d5602b" ? gitSha("b") : gitSha("e") }),
    ...overrides,
  } as any;
}

async function confirmTestPublication(runner: Awaited<ReturnType<typeof createGitHubReleaseRunner>>, requestId: string, result: { status: string; evidenceDigest: string | null }): Promise<void> {
  if (result.status === "verified" && result.evidenceDigest) {
    const publication = createGitHubReleaseReceiptPublication({ runner, publication: { async publish() { return { receiptRef: `receipt_${requestId}`, evidenceDigest: authorityDigest({ published: requestId }) }; } } });
    await publication.publish({ phase: "dispatch", state: { reservation: { reservationId: requestId }, effect: { endpointId: "github.release.candidate-branch" } } as any, outcome: { kind: "acknowledged", resultDigest: result.evidenceDigest }, dispatchedRequestDigest: digest("f") });
  }
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
    const originalHead = await readFile(path.join(directory, "head.json"), "utf8");
    const eventPath = path.join(directory, events[0]!);
    const event = JSON.parse(await readFile(eventPath, "utf8"));
    await writeFile(eventPath, JSON.stringify({ ...event, data: { alias: "attacker" } }));
    await assert.rejects(() => journal.load("request_1"), /signature|digest|tamper/i);
    await writeFile(eventPath, JSON.stringify(event));
    await writeFile(path.join(directory, "head.json"), JSON.stringify({ digest: event.digest, sequence: 0 }));
    await assert.rejects(() => journal.load("request_1"), /rollback|head|fork/i);
    await writeFile(path.join(directory, "head.json"), originalHead);
    await unlink(path.join(directory, events[1]!));
    await assert.rejects(() => journal.load("request_1"), /rollback|head|fork/i);
    const scope = `authorization-${"a".repeat(64)}`, leasePath = path.join(root, `${authorityDigest({ journalId: "release", scope }).slice(7)}.lease`);
    await writeFile(leasePath, JSON.stringify({ acquiredAt: "2026-08-18T00:00:00.000Z", pid: 999999, scope }));
    assert.equal(await journal.withLease(scope, async () => "recovered"), "recovered");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("signed journal serializes concurrent writers and recovers an abandoned request lock", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-release-journal-lock-"));
  const keys = generateKeyPairSync("ed25519"), semantics = authorityDigest({ request: "race" });
  try {
    const first = await createSignedJournal({ rootDir: root, journalId: "release", signerId: "release-journal-2026", privateKey: keys.privateKey, publicKey: keys.publicKey });
    const second = await createSignedJournal({ rootDir: root, journalId: "release", signerId: "release-journal-2026", privateKey: keys.privateKey, publicKey: keys.publicKey });
    await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? first : second).append("request_race", semantics, `phase-${index}`, { index })));
    assert.equal((await first.load("request_race")).length, 12);
    const requestDir = path.join(root, authorityDigest({ journalId: "release", requestId: "request_race" }).slice(7));
    await writeFile(path.join(requestDir, "request.lock"), "");
    await first.append("request_race", semantics, "after-crash", { recovered: true });
    assert.equal((await first.load("request_race")).at(-1)?.phase, "after-crash");
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
    await assert.rejects(() => runner.run({ alias: "github_release_candidate_publish_v1", allocationId: "release-candidate-branch-01", authorizationHandle: "release_auth_1", requestId: "request_1", semanticsDigest: authorityDigest({ request: 1 }) }), /verified authorization|allocation|brand/i);
    assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("release dispatch composition preserves fallback prepare and fails closed without a release runner", async () => {
  const prepared = Object.freeze({ description: Object.freeze({}) }) as never;
  let fallbackDispatches = 0, fallbackReconciles = 0, fallbackPrepares = 0;
  const fallback = {
    async prepare() { fallbackPrepares += 1; return prepared; },
    async dispatch() { fallbackDispatches += 1; return { kind: "acknowledged" as const, resultDigest: digest("a") }; },
    async reconcile(_state: any, outcome: any) { fallbackReconciles += 1; return outcome; },
  };
  const adapter = createGitHubReleaseDispatchAdapter({ runner: null, fallback } as any);
  const ordinaryState = { effect: { endpointId: "ordinary.write" } } as any;
  assert.equal(await adapter.prepare!(ordinaryState), prepared);
  await adapter.dispatch(ordinaryState);
  await adapter.reconcile!(ordinaryState, { kind: "ambiguous", resultDigest: digest("b") });
  assert.deepEqual([fallbackPrepares, fallbackDispatches, fallbackReconciles], [1, 1, 1]);

  const releaseState = {
    reservation: { reservationId: "reservation_1", intent: { executionContext: { allocationId: "release-candidate-branch-01" } } },
    effect: { v: "reelier.transport-effect/v1", endpointId: "github.release.candidate-branch", method: "POST", path: "/internal/github-release", query: "", headers: {}, bodyBase64: Buffer.from('{"authorizationHandle":"release_auth_1"}').toString("base64"), riskClass: "github_release", idempotency: "reconcile-only", preconditions: [], reconciliation: { recipeId: "github_release_authoritative_readback_v1" } },
    effectDigest: digest("c"), effectCanonicalBase64: "",
  } as any;
  const refused = await adapter.dispatch(releaseState);
  assert.equal(refused.kind, "definitive-failure");
  assert.equal(fallbackDispatches, 1, "reviewed release endpoints must never reach generic HTTPS fallback");
});

test("release provider execution stays behind the prepared commit boundary", async () => {
  let releaseWrites = 0, fallbackWrites = 0;
  const projection = { v: "reelier.materialized-http-request/v1" as const, method: "POST" as const, origin: "https://api.github.test", normalizedPath: "/internal/github-release", normalizedQuery: "", reviewedHeaders: {}, bodyDigest: digest("a") };
  const materializedRequestDigest = materializedHttpRequestDigest(projection);
  const fallback = {
    async prepare() { return createPreparedDispatch({ description: { v: "reelier.prepared-dispatch-description/v1", routeDigest: digest("b"), materializedRequestDigest, projection, authorityGeneration: "generation_1", authorityExpiresAt: "2099-08-18T17:00:00.000Z", absoluteDeadlineMs: performance.now() + 60_000, reservationId: "reservation_1", allocationId: "release-candidate-branch-01" }, send: async () => { fallbackWrites += 1; return { kind: "acknowledged", resultDigest: digest("c") }; } }); },
    async dispatch() { fallbackWrites += 1; return { kind: "acknowledged" as const, resultDigest: digest("d") }; },
  };
  const runner = { recover: async () => [], run: async () => { releaseWrites += 1; return { status: "verified" as const, phase: "candidate-verified", evidenceDigest: digest("e") }; } };
  const adapter = createGitHubReleaseDispatchAdapter({ runner, fallback });
  const effect = { v: "reelier.transport-effect/v1", endpointId: "github.release.candidate-branch", method: "POST", path: "/internal/github-release", query: "", headers: {}, bodyBase64: Buffer.from('{"authorizationHandle":"release_auth_1"}').toString("base64"), riskClass: "github_release", idempotency: "reconcile-only", preconditions: [], reconciliation: { recipeId: "github_release_authoritative_readback_v1" } };
  const state = { reservation: { reservationId: "reservation_1", state: "reserved", intent: { executionContext: { allocationId: "release-candidate-branch-01" } } }, effect, effectDigest: digest("f"), effectCanonicalBase64: "" } as any;
  const prepared = await adapter.prepare!(state);
  assert.equal(releaseWrites, 0);
  const lease = createDispatchCommitLease({ reservationId: "reservation_1", allocationId: "release-candidate-branch-01", preparedDigest: materializedRequestDigest, authorityGeneration: "generation_1", authorityExpiresAt: "2099-08-18T17:00:00.000Z", absoluteDeadlineMs: prepared.description.absoluteDeadlineMs, commitGeneration: "commit_1" });
  assert.equal((await consumePreparedDispatch(prepared, lease)).kind, "acknowledged");
  assert.deepEqual([releaseWrites, fallbackWrites], [1, 0]);
});

test("runner does not expose a forgeable receipt-publication confirmation method", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-release-confirmation-capability-"));
  const fixture = releaseAuthorityFixture(), keys = generateKeyPairSync("ed25519");
  try {
    const runner = await createGitHubReleaseRunner({ rootDir: root, journalSigner: { signerId: "release-journal-2026", privateKey: keys.privateKey, publicKey: keys.publicKey }, evidenceSigner: fixture.evidenceSigner, authorizationResolver: async () => fixture.context, provider: candidateProvider(), now: () => new Date("2026-08-18T06:00:00.000Z") });
    assert.equal("confirmPublication" in runner, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("four-operation release saga converges after ambiguous merge and tag without resend", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-release-saga-"));
  const fixture = releaseAuthorityFixture(), journalKeys = generateKeyPairSync("ed25519");
  const refs = new Map<string, string>([["heads/main", "e600ad5c2dc5e1bde0714915e7a84980c8d5602b"]]);
  let pullRequest: any = null, mergeCalls = 0, tagCalls = 0, readyCalls = 0, treeBase: string | null = null;
  const provider = {
    createBlob: async ({ contentBase64 }: any) => ({ sha: blobSha(Buffer.from(contentBase64, "base64")) }),
    createTree: async ({ baseTreeSha }: any) => { treeBase = baseTreeSha; return { sha: gitSha("e") }; },
    createCommit: async () => ({ sha: gitSha("a") }),
    getRef: async ({ ref }: any) => refs.has(ref) ? { sha: refs.get(ref)! } : null,
    createRef: async ({ ref, sha }: any) => { if (refs.has(ref)) throw new Error("exists"); refs.set(ref, sha); if (ref === "tags/v0.32.1") { tagCalls += 1; throw new Error("socket lost after tag"); } return { sha }; },
    getCommit: async ({ sha }: any) => ({ sha, parentSha: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b", treeSha: sha === "e600ad5c2dc5e1bde0714915e7a84980c8d5602b" ? gitSha("b") : gitSha("e") }),
    findPullRequests: async () => pullRequest ? [pullRequest] : [],
    createPullRequest: async (metadata: any) => (pullRequest = { base: metadata.base, body: metadata.body, draft: metadata.draft, head: metadata.head, headSha: gitSha("a"), mergeCommitSha: null, merged: false, number: 1, title: metadata.title }),
    markPullRequestReady: async () => { readyCalls += 1; pullRequest = { ...pullRequest, draft: false }; return pullRequest; },
    getPullRequest: async () => pullRequest,
    getChecks: async () => ["coverage", "full-tests", "mutation"].map(name => ({ name, status: "success", workflowDigest: digest("3") })),
    mergePullRequest: async () => { mergeCalls += 1; pullRequest = { ...pullRequest, merged: true, mergeCommitSha: gitSha("9") }; refs.set("heads/main", gitSha("9")); throw new Error("socket lost after merge"); },
    npmVersionExists: async () => false,
    readPackageManifest: async () => ({ name: "reelier", version: "0.32.1" }),
  };
  try {
    const runner = await createGitHubReleaseRunner({ rootDir: root, journalSigner: { signerId: "release-journal-2026", privateKey: journalKeys.privateKey, publicKey: journalKeys.publicKey }, evidenceSigner: fixture.evidenceSigner, authorizationResolver: async () => fixture.context, provider, now: () => new Date("2026-08-18T06:00:00.000Z") });
    const allocations: Record<string, string> = { github_release_candidate_publish_v1: "release-candidate-branch-01", github_release_pr_ensure_v1: "release-draft-pr-01", github_release_pr_merge_v1: "release-exact-sha-merge-01", github_release_tag_create_v1: "release-non-force-tag-01" };
    const invoke = (alias: any, requestId: string) => runner.run({ alias, allocationId: allocations[alias], authorizationHandle: "release_auth_1", requestId, semanticsDigest: authorityDigest({ alias, requestId }) });
    const candidateResult = await invoke("github_release_candidate_publish_v1", "candidate_1");
    assert.equal(candidateResult.status, "verified");
    await assert.rejects(() => invoke("github_release_pr_ensure_v1", "pr_1"), /receipt.*publish|predecessor/i);
    await confirmTestPublication(runner, "candidate_1", candidateResult);
    const prResult = await invoke("github_release_pr_ensure_v1", "pr_1");
    assert.equal(prResult.status, "verified");
    await confirmTestPublication(runner, "pr_1", prResult);
    const mergeResult = await invoke("github_release_pr_merge_v1", "merge_1");
    assert.equal(mergeResult.status, "verified");
    await confirmTestPublication(runner, "merge_1", mergeResult);
    assert.equal((await invoke("github_release_tag_create_v1", "tag_1")).status, "verified");
    assert.equal(mergeCalls, 1);
    assert.equal(tagCalls, 1);
    assert.equal(readyCalls, 1);
    assert.equal(treeBase, gitSha("b"));
    assert.equal((await invoke("github_release_pr_merge_v1", "merge_1")).status, "verified");
    assert.equal((await invoke("github_release_tag_create_v1", "tag_1")).status, "verified");
    assert.equal(mergeCalls, 1, "merge must never be resent after ambiguous response");
    assert.equal(tagCalls, 1, "tag must never be resent after ambiguous response");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concurrent duplicate candidate requests serialize and converge to one provider execution", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-release-concurrent-"));
  const fixture = releaseAuthorityFixture(), journalKeys = generateKeyPairSync("ed25519"), refs = new Map<string, string>([["heads/main", "e600ad5c2dc5e1bde0714915e7a84980c8d5602b"]]);
  let blobCalls = 0;
  const provider: any = {
    createBlob: async ({ contentBase64 }: any) => { blobCalls += 1; await new Promise(resolve => setImmediate(resolve)); return { sha: blobSha(Buffer.from(contentBase64, "base64")) }; },
    createTree: async () => ({ sha: gitSha("e") }), createCommit: async () => ({ sha: gitSha("a") }),
    getRef: async ({ ref }: any) => refs.has(ref) ? { sha: refs.get(ref)! } : null,
    createRef: async ({ ref, sha }: any) => { refs.set(ref, sha); return { sha }; },
    getCommit: async ({ sha }: any) => ({ sha, parentSha: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b", treeSha: sha === "e600ad5c2dc5e1bde0714915e7a84980c8d5602b" ? gitSha("b") : gitSha("e") }),
  };
  try {
    const runner = await createGitHubReleaseRunner({ rootDir: root, journalSigner: { signerId: "release-journal-2026", privateKey: journalKeys.privateKey, publicKey: journalKeys.publicKey }, evidenceSigner: fixture.evidenceSigner, authorizationResolver: async () => fixture.context, provider, now: () => new Date("2026-08-18T06:00:00.000Z") });
    const request = { alias: "github_release_candidate_publish_v1" as const, allocationId: "release-candidate-branch-01", authorizationHandle: "release_auth_1", requestId: "candidate_concurrent", semanticsDigest: authorityDigest({ candidate: "concurrent" }) };
    const results = await Promise.all([runner.run(request), runner.run(request)]);
    assert.deepEqual(results.map(result => result.status), ["verified", "verified"]);
    assert.equal(blobCalls, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("independent runner instances serialize the same durable request and allocation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-release-cross-process-"));
  const fixture = releaseAuthorityFixture(), keys = generateKeyPairSync("ed25519");
  let blobCalls = 0;
  const provider = candidateProvider({ createBlob: async ({ contentBase64 }: any) => { blobCalls++; await new Promise(resolve => setImmediate(resolve)); return { sha: blobSha(Buffer.from(contentBase64, "base64")) }; } });
  try {
    const make = () => createGitHubReleaseRunner({ rootDir: root, journalSigner: { signerId: "release-journal-2026", privateKey: keys.privateKey, publicKey: keys.publicKey }, evidenceSigner: fixture.evidenceSigner, authorizationResolver: async () => fixture.context, provider, now: () => new Date("2026-08-18T06:00:00.000Z") });
    const [left, right] = await Promise.all([make(), make()]);
    const request = { alias: "github_release_candidate_publish_v1" as const, allocationId: "release-candidate-branch-01", authorizationHandle: "release_auth_1", requestId: "cross_process_request", semanticsDigest: authorityDigest({ cross: true }) };
    const results = await Promise.all([left.run(request), right.run(request)]);
    assert.deepEqual(results.map(result => result.status), ["verified", "verified"]);
    assert.equal(blobCalls, 3);
    await assert.rejects(() => right.run({ ...request, requestId: "allocation_replay", semanticsDigest: authorityDigest({ cross: "replay" }) }), /allocation.*already|one-effect|replay/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("candidate validates the complete authenticated file set before any provider write", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-release-predispatch-"));
  const fixture = releaseAuthorityFixture(), keys = generateKeyPairSync("ed25519");
  let writes = 0;
  const provider = candidateProvider({ createBlob: async () => { writes++; return { sha: gitSha("1") }; }, createTree: async () => { writes++; return { sha: gitSha("e") }; }, createCommit: async () => { writes++; return { sha: gitSha("a") }; }, createRef: async () => { writes++; return { sha: gitSha("a") }; } });
  try {
    const runner = await createGitHubReleaseRunner({ rootDir: root, journalSigner: { signerId: "release-journal-2026", privateKey: keys.privateKey, publicKey: keys.publicKey }, evidenceSigner: fixture.evidenceSigner, authorizationResolver: async () => ({ ...fixture.context, fileContents: [...fixture.context.fileContents, { path: "unexpected.txt", bytesBase64: "eA==" }] }), provider, now: () => new Date("2026-08-18T06:00:00.000Z") });
    await assert.rejects(() => runner.run({ alias: "github_release_candidate_publish_v1", allocationId: "release-candidate-branch-01", authorizationHandle: "release_auth_1", requestId: "invalid_candidate", semanticsDigest: authorityDigest({ invalid: true }) }), /file set|candidate/i);
    assert.equal(writes, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("later outcomes refuse without exactly one verified predecessor before provider calls", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-release-predecessor-"));
  const fixture = releaseAuthorityFixture(), keys = generateKeyPairSync("ed25519");
  let calls = 0;
  const provider = new Proxy({}, { get: () => async () => { calls++; return null; } });
  try {
    const runner = await createGitHubReleaseRunner({ rootDir: root, journalSigner: { signerId: "release-journal-2026", privateKey: keys.privateKey, publicKey: keys.publicKey }, evidenceSigner: fixture.evidenceSigner, authorizationResolver: async () => fixture.context, provider: provider as never, now: () => new Date("2026-08-18T06:00:00.000Z") });
    await assert.rejects(() => runner.run({ alias: "github_release_pr_ensure_v1", allocationId: "release-draft-pr-01", authorizationHandle: "release_auth_1", requestId: "pr_without_candidate", semanticsDigest: authorityDigest({ missing: true }) }), /predecessor/i);
    assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("authorization expiry is checked again immediately before every provider write", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-release-expiry-boundary-"));
  const fixture = releaseAuthorityFixture(), keys = generateKeyPairSync("ed25519");
  let clockReads = 0, blobWrites = 0;
  const provider = candidateProvider({ createBlob: async ({ contentBase64 }: any) => { blobWrites++; return { sha: blobSha(Buffer.from(contentBase64, "base64")) }; } });
  try {
    const runner = await createGitHubReleaseRunner({ rootDir: root, journalSigner: { signerId: "release-journal-2026", privateKey: keys.privateKey, publicKey: keys.publicKey }, evidenceSigner: fixture.evidenceSigner, authorizationResolver: async () => fixture.context, provider, now: () => ++clockReads <= 2 ? new Date("2026-08-18T06:00:00.000Z") : new Date("2026-08-18T17:00:00.000Z") });
    await assert.rejects(() => runner.run({ alias: "github_release_candidate_publish_v1", allocationId: "release-candidate-branch-01", authorizationHandle: "release_auth_1", requestId: "expires_mid_write", semanticsDigest: authorityDigest({ expiry: true }) }), /stale|clock/i);
    assert.equal(blobWrites, 0, "expiry after durable intent must refuse before provider dispatch");
    await assert.rejects(() => runner.recover(), /stale|expired|refus/i);
    assert.equal(blobWrites, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("dedicated dispatch adapter passes only host-owned allocation and durable semantics", async () => {
  let observed: any = null, fallbackCalls = 0;
  const adapter = createGitHubReleaseDispatchAdapter({ runner: { recover: async () => [], run: async request => { observed = request; return { status: "verified", phase: "candidate-verified", evidenceDigest: digest("a") }; } }, fallback: { dispatch: async () => { fallbackCalls++; return { kind: "acknowledged", resultDigest: digest("f") }; } } });
  const effect = { v: "reelier.transport-effect/v1", endpointId: "github.release.candidate-branch", method: "POST", path: "/internal/github-release", query: "", headers: { "Content-Type": "application/json" }, bodyBase64: Buffer.from(JSON.stringify({ authorizationHandle: "release_auth_1" })).toString("base64"), riskClass: "github_release", idempotency: "reconcile-only", preconditions: [], reconciliation: { recipeId: "github_release_authoritative_readback_v1" } };
  const outcome = await adapter.dispatch({ reservation: { reservationId: "reservation_1", state: "reserved" as any, intent: { effectDigest: authorityDigest(effect), effectCanonicalBase64: "", executionContext: { allocationId: "release-candidate-branch-01" } as any } }, effect, effectCanonicalBase64: "", effectDigest: authorityDigest(effect) });
  assert.equal(outcome.kind, "acknowledged");
  assert.equal(fallbackCalls, 0);
  assert.deepEqual(observed, { alias: "github_release_candidate_publish_v1", allocationId: "release-candidate-branch-01", authorizationHandle: "release_auth_1", requestId: "reservation_1", semanticsDigest: authorityDigest(effect) });
  assert.throws(() => createGitHubReleaseReceiptPublication({ runner: { recover: async () => [], run: async () => ({ status: "verified", phase: "candidate-verified", evidenceDigest: digest("a") }) }, publication: { publish: async () => ({ receiptRef: "receipt_reservation_1", evidenceDigest: digest("b") }) } }), /capability/i);
});

for (const faultMethod of ["createBlob", "createTree", "createCommit"] as const) {
  test(`content-addressed ${faultMethod} crash resumes idempotently without widening authority`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `reelier-release-${faultMethod}-`));
    const fixture = releaseAuthorityFixture(), keys = generateKeyPairSync("ed25519");
    const base = candidateProvider(), original = base[faultMethod] as (...args: any[]) => Promise<any>;
    let faulted = false, calls = 0;
    base[faultMethod] = async (...args: any[]) => { calls++; const result = await original(...args); if (!faulted) { faulted = true; throw new Error(`crash after ${faultMethod}`); } return result; };
    try {
      const runner = await createGitHubReleaseRunner({ rootDir: root, journalSigner: { signerId: "release-journal-2026", privateKey: keys.privateKey, publicKey: keys.publicKey }, evidenceSigner: fixture.evidenceSigner, authorizationResolver: async () => fixture.context, provider: base, now: () => new Date("2026-08-18T06:00:00.000Z") });
      const request = { alias: "github_release_candidate_publish_v1" as const, allocationId: "release-candidate-branch-01", authorizationHandle: "release_auth_1", requestId: `resume_${faultMethod}`, semanticsDigest: authorityDigest({ faultMethod }) };
      await assert.rejects(() => runner.run(request), new RegExp(faultMethod));
      assert.equal((await runner.run(request)).status, "verified");
      assert.equal(calls, faultMethod === "createBlob" ? 4 : 2);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("ambiguous merge reconciles read-only after expiry and never resends", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-release-expired-reconcile-"));
  const fixture = releaseAuthorityFixture(), keys = generateKeyPairSync("ed25519"), refs = new Map<string, string>([["heads/main", "e600ad5c2dc5e1bde0714915e7a84980c8d5602b"]]);
  let pr: any = null, mergeCalls = 0, loseReadback = false, expired = false;
  const provider: any = {
    ...candidateProvider(),
    getRef: async ({ ref }: any) => refs.has(ref) ? { sha: refs.get(ref)! } : null,
    createRef: async ({ ref, sha }: any) => { refs.set(ref, sha); return { sha }; },
    findPullRequests: async () => pr ? [pr] : [],
    createPullRequest: async (metadata: any) => (pr = { base: metadata.base, body: metadata.body, draft: metadata.draft, head: metadata.head, headSha: gitSha("a"), mergeCommitSha: null, merged: false, number: 1, title: metadata.title }),
    markPullRequestReady: async () => (pr = { ...pr, draft: false }),
    getPullRequest: async () => { if (loseReadback) { loseReadback = false; throw new TypeError("network socket unavailable"); } return pr; },
    getChecks: async () => ["coverage", "full-tests", "mutation"].map(name => ({ name, status: "success", workflowDigest: digest("3") })),
    mergePullRequest: async () => { mergeCalls++; pr = { ...pr, merged: true, mergeCommitSha: gitSha("9") }; refs.set("heads/main", gitSha("9")); throw new Error("response lost after merge"); },
    getCommit: async ({ sha }: any) => ({ sha, parentSha: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b", treeSha: sha === "e600ad5c2dc5e1bde0714915e7a84980c8d5602b" ? gitSha("b") : gitSha("e") }),
  };
  try {
    const runner = await createGitHubReleaseRunner({ rootDir: root, journalSigner: { signerId: "release-journal-2026", privateKey: keys.privateKey, publicKey: keys.publicKey }, evidenceSigner: fixture.evidenceSigner, authorizationResolver: async () => fixture.context, provider, now: () => expired ? new Date("2026-08-18T17:00:00.000Z") : new Date("2026-08-18T06:00:00.000Z") });
    const run = async (alias: any, allocationId: string, requestId: string) => { const result = await runner.run({ alias, allocationId, authorizationHandle: "release_auth_1", requestId, semanticsDigest: authorityDigest({ alias, requestId }) }); await confirmTestPublication(runner, requestId, result); return result; };
    assert.equal((await run("github_release_candidate_publish_v1", "release-candidate-branch-01", "expired_candidate")).status, "verified");
    assert.equal((await run("github_release_pr_ensure_v1", "release-draft-pr-01", "expired_pr")).status, "verified");
    loseReadback = true;
    assert.equal((await run("github_release_pr_merge_v1", "release-exact-sha-merge-01", "expired_merge")).status, "pending-reconciliation");
    expired = true;
    assert.equal((await run("github_release_pr_merge_v1", "release-exact-sha-merge-01", "expired_merge")).status, "verified");
    assert.equal(mergeCalls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const boundary of ["createBlob", "createTree", "createCommit", "createBranchRef", "getCommit", "findPullRequests", "createPullRequest", "markPullRequestReady", "getPullRequest", "getChecks", "mergePullRequest", "readPackageManifest", "npmVersionExists", "createTagRef"] as const) {
  test(`lost response after ${boundary} converges without duplicate merge or tag`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `reelier-release-boundary-${boundary}-`));
    const fixture = releaseAuthorityFixture(), keys = generateKeyPairSync("ed25519"), refs = new Map<string, string>([["heads/main", "e600ad5c2dc5e1bde0714915e7a84980c8d5602b"]]);
    let pr: any = null, faulted = false, mergeCalls = 0, tagCalls = 0;
    const base: any = {
      createBlob: async ({ contentBase64 }: any) => ({ sha: blobSha(Buffer.from(contentBase64, "base64")) }), createTree: async () => ({ sha: gitSha("e") }), createCommit: async () => ({ sha: gitSha("a") }),
      getRef: async ({ ref }: any) => refs.has(ref) ? { sha: refs.get(ref)! } : null,
      createRef: async ({ ref, sha }: any) => { refs.set(ref, sha); if (ref.startsWith("tags/")) tagCalls++; return { sha }; },
      getCommit: async ({ sha }: any) => ({ sha, parentSha: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b", treeSha: sha === "e600ad5c2dc5e1bde0714915e7a84980c8d5602b" ? gitSha("b") : gitSha("e") }),
      findPullRequests: async () => pr ? [pr] : [], createPullRequest: async (metadata: any) => (pr = { base: metadata.base, body: metadata.body, draft: metadata.draft, head: metadata.head, headSha: gitSha("a"), mergeCommitSha: null, merged: false, number: 1, title: metadata.title }), markPullRequestReady: async () => (pr = { ...pr, draft: false }), getPullRequest: async () => pr,
      getChecks: async () => ["coverage", "full-tests", "mutation"].map(name => ({ name, status: "success", workflowDigest: digest("3") })),
      mergePullRequest: async () => { mergeCalls++; pr = { ...pr, merged: true, mergeCommitSha: gitSha("9") }; refs.set("heads/main", gitSha("9")); return { merged: true, sha: gitSha("9") }; },
      readPackageManifest: async () => ({ name: "reelier", version: "0.32.1" }), npmVersionExists: async () => false,
    };
    const method = boundary === "createBranchRef" || boundary === "createTagRef" ? "createRef" : boundary;
    const original = base[method];
    base[method] = async (...args: any[]) => { const result = await original(...args); const ref = args[0]?.ref; const matches = boundary === "createBranchRef" ? String(ref).startsWith("heads/") : boundary === "createTagRef" ? String(ref).startsWith("tags/") : true; if (!faulted && matches) { faulted = true; throw new Error(`lost after ${boundary}`); } return result; };
    try {
      const runner = await createGitHubReleaseRunner({ rootDir: root, journalSigner: { signerId: "release-journal-2026", privateKey: keys.privateKey, publicKey: keys.publicKey }, evidenceSigner: fixture.evidenceSigner, authorizationResolver: async () => fixture.context, provider: base, now: () => new Date("2026-08-18T06:00:00.000Z") });
      const allocations: Record<string, string> = { github_release_candidate_publish_v1: "release-candidate-branch-01", github_release_pr_ensure_v1: "release-draft-pr-01", github_release_pr_merge_v1: "release-exact-sha-merge-01", github_release_tag_create_v1: "release-non-force-tag-01" };
      for (const alias of Object.keys(allocations)) {
        const requestId = `${boundary}_${alias}`;
        const request = { alias: alias as any, allocationId: allocations[alias]!, authorizationHandle: "release_auth_1", requestId, semanticsDigest: authorityDigest({ boundary, alias }) };
        let result: any = null;
        for (let attempt = 0; attempt < 3 && result?.status !== "verified"; attempt++) { try { result = await runner.run(request); } catch { /* safe read/content-addressed retry */ } }
        assert.equal(result?.status, "verified", `${alias} did not reconcile at ${boundary}`);
        await confirmTestPublication(runner, requestId, result);
      }
      assert.equal(faulted, true);
      assert.equal(mergeCalls, 1);
      assert.equal(tagCalls, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

for (const scenario of ["base-drift", "branch-conflict", "duplicate-pr", "failed-check", "tampered-merge-tree", "tag-conflict"] as const) {
  test(`deterministic ${scenario} refuses without semantic widening`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `reelier-release-refusal-${scenario}-`));
    const fixture = releaseAuthorityFixture(), keys = generateKeyPairSync("ed25519"), refs = new Map<string, string>([["heads/main", scenario === "base-drift" ? gitSha("7") : "e600ad5c2dc5e1bde0714915e7a84980c8d5602b"]]);
    if (scenario === "branch-conflict") refs.set("heads/reelier/release/0.32.1", gitSha("8"));
    let pr: any = null, mergeCalls = 0, tagCalls = 0;
    const provider: any = {
      createBlob: async ({ contentBase64 }: any) => ({ sha: blobSha(Buffer.from(contentBase64, "base64")) }), createTree: async () => ({ sha: gitSha("e") }), createCommit: async () => ({ sha: gitSha("a") }),
      getRef: async ({ ref }: any) => refs.has(ref) ? { sha: refs.get(ref)! } : null, createRef: async ({ ref, sha }: any) => { refs.set(ref, sha); if (ref.startsWith("tags/")) tagCalls++; return { sha }; },
      getCommit: async ({ sha }: any) => ({ sha, parentSha: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b", treeSha: sha === "e600ad5c2dc5e1bde0714915e7a84980c8d5602b" ? gitSha("b") : scenario === "tampered-merge-tree" && sha === gitSha("9") ? gitSha("0") : gitSha("e") }),
      findPullRequests: async () => scenario === "duplicate-pr" && pr ? [pr, { ...pr, number: 2 }] : pr ? [pr] : [], createPullRequest: async (metadata: any) => (pr = { base: metadata.base, body: metadata.body, draft: metadata.draft, head: metadata.head, headSha: gitSha("a"), mergeCommitSha: null, merged: false, number: 1, title: metadata.title }), markPullRequestReady: async () => (pr = { ...pr, draft: false }), getPullRequest: async () => pr,
      getChecks: async () => ["coverage", "full-tests", "mutation"].map(name => ({ name, status: scenario === "failed-check" ? "failure" : "success", workflowDigest: digest("3") })),
      mergePullRequest: async () => { mergeCalls++; pr = { ...pr, merged: true, mergeCommitSha: gitSha("9") }; refs.set("heads/main", gitSha("9")); return { merged: true, sha: gitSha("9") }; }, readPackageManifest: async () => ({ name: "reelier", version: "0.32.1" }), npmVersionExists: async () => false,
    };
    try {
      const runner = await createGitHubReleaseRunner({ rootDir: root, journalSigner: { signerId: "release-journal-2026", privateKey: keys.privateKey, publicKey: keys.publicKey }, evidenceSigner: fixture.evidenceSigner, authorizationResolver: async () => fixture.context, provider, now: () => new Date("2026-08-18T06:00:00.000Z") });
      const run = async (alias: any, allocationId: string, requestId: string) => { const result = await runner.run({ alias, allocationId, authorizationHandle: "release_auth_1", requestId, semanticsDigest: authorityDigest({ scenario, alias }) }); await confirmTestPublication(runner, requestId, result); return result; };
      if (scenario === "base-drift" || scenario === "branch-conflict") {
        await assert.rejects(() => run("github_release_candidate_publish_v1", "release-candidate-branch-01", `${scenario}_candidate`), /drift|conflict/i);
      } else {
        assert.equal((await run("github_release_candidate_publish_v1", "release-candidate-branch-01", `${scenario}_candidate`)).status, "verified");
        if (scenario === "duplicate-pr") { pr = { base: "main", body: "Governed release v0.32.1", draft: true, head: "reelier/release/0.32.1", headSha: gitSha("a"), mergeCommitSha: null, merged: false, number: 1, title: "Release v0.32.1" }; await assert.rejects(() => run("github_release_pr_ensure_v1", "release-draft-pr-01", `${scenario}_pr`), /multiple|conflict/i); }
        else {
          assert.equal((await run("github_release_pr_ensure_v1", "release-draft-pr-01", `${scenario}_pr`)).status, "verified");
          if (scenario === "failed-check") await assert.rejects(() => run("github_release_pr_merge_v1", "release-exact-sha-merge-01", `${scenario}_merge`), /checks|failed/i);
          else {
            if (scenario === "tampered-merge-tree") await assert.rejects(() => run("github_release_pr_merge_v1", "release-exact-sha-merge-01", `${scenario}_merge`), /tree|tamper/i);
            else { assert.equal((await run("github_release_pr_merge_v1", "release-exact-sha-merge-01", `${scenario}_merge`)).status, "verified"); refs.set("tags/v0.32.1", gitSha("8")); await assert.rejects(() => run("github_release_tag_create_v1", "release-non-force-tag-01", `${scenario}_tag`), /tag.*conflict/i); }
          }
        }
      }
      if (scenario === "failed-check") assert.equal(mergeCalls, 0);
      if (scenario === "tag-conflict") assert.equal(tagCalls, 0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
