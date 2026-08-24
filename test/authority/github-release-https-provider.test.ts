import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  createGitHubReleaseHttpsProvider,
  parseGitHubReleaseHttpsProviderConfigV1,
  __testSetGitHubReleaseHttpsTransport,
  type GitHubReleaseHttpsProviderConfigV1,
  type GitHubReleaseHttpsTransport,
} from "../../src/authority/host/github-release-https-provider.js";
import { parseGitHubReleaseRunnerOperatorConfig } from "../../src/authority/host/github-release-runner-config.js";
import { createSecretResolver } from "../../src/authority/host/secret-resolver.js";

const REPOSITORY = "seldonframe-rehearsal/release-rehearsal";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;
const smokeScript = fileURLToPath(new URL("../../../scripts/github-release-provider-live-smoke.mjs", import.meta.url));
const providerUrl = new URL("../../src/authority/host/github-release-https-provider.js", import.meta.url).href;

const config: GitHubReleaseHttpsProviderConfigV1 = Object.freeze({
  v: "reelier.github-release-https-provider-config/v1" as const,
  githubAccountIdentity: "seldonframe-release-cell",
  githubBaseUrl: "https://api.github.com",
  githubTokenRef: "env:REELIER_TEST_GITHUB_TOKEN",
  npmRegistryBaseUrl: "https://registry.npmjs.org",
  repository: REPOSITORY,
  timeoutMs: 15_000,
});

/** Never consulted by the hermetic transport seam: the driver, not the provider, resolves it. */
const secrets = Object.freeze({ async resolve() { throw new Error("hermetic tests must never resolve a credential"); } });

type Call = Readonly<{ kind: "read" | "write"; method: string; path: string; query: string; endpointId: string; headers: Readonly<Record<string, string>>; body: unknown }>;

const json = (status: number, body: unknown) => ({ status, body: Buffer.from(JSON.stringify(body)) });

/** Records the EXACT request the provider handed the driver — path, method, query, headers, and the
 * decoded body — so every mapping assertion below is about a real request shape, not a stub name. */
function fakeTransport(responses: readonly { status: number; body: Buffer }[], calls: Call[]): GitHubReleaseHttpsTransport {
  const queue = [...responses];
  const next = (label: string) => { const response = queue.shift(); if (!response) throw new Error(`fixture exhausted at ${label}`); return response; };
  return {
    async read(read, endpoint) {
      calls.push(Object.freeze({ kind: "read", method: read.method ?? "GET", path: read.path, query: read.query ?? "", endpointId: endpoint.endpointId, headers: Object.freeze({ ...read.headers }), body: null }));
      return next(read.path);
    },
    async write(effect, endpoint) {
      calls.push(Object.freeze({ kind: "write", method: effect.method, path: effect.path, query: effect.query, endpointId: endpoint.endpointId, headers: Object.freeze({ ...effect.headers }), body: JSON.parse(Buffer.from(effect.bodyBase64, "base64").toString("utf8")) }));
      return next(effect.path);
    },
  };
}

async function withTransport<T>(responses: readonly { status: number; body: Buffer }[], run: (provider: ReturnType<typeof createGitHubReleaseHttpsProvider>, calls: readonly Call[]) => Promise<T>): Promise<T> {
  const calls: Call[] = [];
  const restore = __testSetGitHubReleaseHttpsTransport(fakeTransport(responses, calls));
  try { return await run(createGitHubReleaseHttpsProvider(config, secrets), calls); } finally { restore(); }
}

async function refusalOf(operation: Promise<unknown>): Promise<Record<string, unknown>> {
  return operation.then(
    value => { throw new Error(`expected a provider fault, received ${JSON.stringify(value)}`); },
    (fault: unknown) => {
      assert.equal(Object.getPrototypeOf(fault), Object.prototype, "a provider fault must be a PLAIN object, never an Error");
      return fault as Record<string, unknown>;
    },
  );
}

test("the provider config parser is closed, https-only, and refuses an inline credential", () => {
  assert.deepEqual(parseGitHubReleaseHttpsProviderConfigV1(config), config);
  assert.throws(() => parseGitHubReleaseHttpsProviderConfigV1({ ...config, githubBaseUrl: "http://api.github.com" }), /https origin/i);
  assert.throws(() => parseGitHubReleaseHttpsProviderConfigV1({ ...config, githubBaseUrl: "https://api.github.com/v3" }), /https origin/i);
  assert.throws(() => parseGitHubReleaseHttpsProviderConfigV1({ ...config, npmRegistryBaseUrl: "http://registry.npmjs.org" }), /https origin/i);
  assert.throws(() => parseGitHubReleaseHttpsProviderConfigV1({ ...config, githubTokenRef: "ghp_rawtokenvaluethatisnotareference" }), /secret reference/i);
  assert.throws(() => parseGitHubReleaseHttpsProviderConfigV1({ ...config, extra: 1 }), /exact closed key set/i);
  const { timeoutMs: _dropped, ...missing } = config;
  assert.throws(() => parseGitHubReleaseHttpsProviderConfigV1(missing), /exact closed key set/i);
  assert.throws(() => parseGitHubReleaseHttpsProviderConfigV1({ ...config, repository: "not-a-repository" }), /repository/i);
  assert.throws(() => parseGitHubReleaseHttpsProviderConfigV1({ ...config, timeoutMs: 1 }), /timeoutMs/i);
  assert.throws(() => parseGitHubReleaseHttpsProviderConfigV1({ ...config, v: "reelier.github-release-https-provider-config/v2" }), /version/i);
});

test("the runner operator config gains a github-https union arm closed on its OWN key set", () => {
  const operatorSpkiBase64 = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const base = {
    v: "reelier.github-release-runner-config/v1",
    rootDir: path.resolve("/data/runner"),
    journalSignerId: "release-journal-2026",
    journalKeyFile: path.resolve("/data/keys/journal.pem"),
    evidenceSignerId: "release-provider-verifier",
    evidenceKeyFile: path.resolve("/data/keys/evidence.pem"),
    releaseAuthority: { signerId: "release-authority-2026", publicKeySpkiBase64: operatorSpkiBase64 },
    authorizationDir: path.resolve("/data/authorizations"),
  };
  const minimal = { kind: "github-https", githubAccountIdentity: "seldonframe-release-cell", githubTokenRef: "env:REELIER_RELEASE_GITHUB_TOKEN", repository: REPOSITORY };
  // The API base URL, the registry base URL, and the timeout carry DEFAULTS; everything else is required.
  assert.deepEqual(parseGitHubReleaseRunnerOperatorConfig({ ...base, provider: minimal }).provider, {
    kind: "github-https",
    githubAccountIdentity: "seldonframe-release-cell",
    githubBaseUrl: "https://api.github.com",
    githubTokenRef: "env:REELIER_RELEASE_GITHUB_TOKEN",
    npmRegistryBaseUrl: "https://registry.npmjs.org",
    repository: REPOSITORY,
    timeoutMs: 15_000,
  });
  // Re-parsing the normalized record is idempotent — the runner factory parses a second time.
  const normalized = parseGitHubReleaseRunnerOperatorConfig({ ...base, provider: minimal });
  assert.deepEqual(parseGitHubReleaseRunnerOperatorConfig(normalized), normalized);
  // The arm is closed on its OWN keys: the loopback arm's field is refused here, and a raw token
  // value is refused as a credential, never accepted and never carried at the config top level.
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...base, provider: { ...minimal, fixtureDir: path.resolve("/data/fixtures") } }), /github-https provider is not a closed record/i);
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...base, provider: { ...minimal, githubTokenRef: "ghp_rawtokenvaluethatisnotareference" } }), /secret reference/i);
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...base, provider: { ...minimal, githubBaseUrl: "http://api.github.com" } }), /https origin/i);
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...base, provider: { ...minimal, repository: "only-one-part" } }), /repository/i);
  const { repository: _dropped, ...incomplete } = minimal;
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...base, provider: incomplete }), /github-https provider is not a closed record/i);
  // An unrecognized kind is still refused by the discriminant before any key set is applied.
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...base, provider: { kind: "github-rest", githubTokenRef: "env:X" } }), /provider kind must be one of: loopback-fixture, github-https/);
});

test("getRef maps 200 to the closed sha record and 404 to null", async () => {
  await withTransport([json(200, { ref: "refs/heads/main", object: { sha: SHA_A, type: "commit" } }), json(404, { message: "Not Found" })], async (provider, calls) => {
    assert.deepEqual(await provider.getRef({ repository: REPOSITORY, ref: "heads/main" }), { sha: SHA_A });
    assert.equal(await provider.getRef({ repository: REPOSITORY, ref: "tags/v0.33.0-beta.0" }), null);
    assert.deepEqual(calls.map(call => call.path), [`/repos/${REPOSITORY}/git/ref/heads/main`, `/repos/${REPOSITORY}/git/ref/tags/v0.33.0-beta.0`]);
    assert.ok(calls.every(call => call.kind === "read" && call.method === "GET" && call.endpointId === "github.release.provider"));
    assert.deepEqual(calls[0]!.headers, { accept: "application/vnd.github+json", "user-agent": "reelier-release-provider/1", "x-github-api-version": "2022-11-28" });
  });
});

test("every provider method refuses a repository other than the configured one", async () => {
  await withTransport([], async provider => {
    const fault = await refusalOf(provider.getRef({ repository: "seldonframe/reelier", ref: "heads/main" }));
    assert.deepEqual(fault, { v: "reelier.github-release-provider-fault/v1", kind: "definitive-refusal", reason: "repository is not the configured release repository" });
    await refusalOf(provider.createBlob({ repository: "seldonframe/reelier", contentBase64: Buffer.from("x").toString("base64") }));
    await refusalOf(provider.getChecks({ repository: "seldonframe/reelier", sha: SHA_A }));
    await refusalOf(provider.readPackageManifest({ repository: "seldonframe/reelier", sha: SHA_A }));
  });
});

test("createBlob, createTree, and createCommit send closed transport effects and return created shas", async () => {
  await withTransport([json(201, { sha: SHA_B, url: "ignored" }), json(201, { sha: SHA_C }), json(201, { sha: SHA_A })], async (provider, calls) => {
    const contentBase64 = Buffer.from("hello").toString("base64");
    assert.deepEqual(await provider.createBlob({ repository: REPOSITORY, contentBase64 }), { sha: SHA_B });
    assert.deepEqual(await provider.createTree({ repository: REPOSITORY, baseTreeSha: SHA_A, files: [{ path: "package.json", mode: "100644", blobSha: SHA_B }] }), { sha: SHA_C });
    assert.deepEqual(await provider.createCommit({ repository: REPOSITORY, treeSha: SHA_C, parentSha: SHA_A, message: "Release v0.33.0-beta.0", author: { name: "Release Cell", email: "cell@example.test", date: "2026-08-19T00:00:00Z" }, committer: { name: "Release Cell", email: "cell@example.test", date: "2026-08-19T00:00:00Z" } }), { sha: SHA_A });
    assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), [
      `POST /repos/${REPOSITORY}/git/blobs`,
      `POST /repos/${REPOSITORY}/git/trees`,
      `POST /repos/${REPOSITORY}/git/commits`,
    ]);
    assert.deepEqual(calls[0]!.body, { content: contentBase64, encoding: "base64" });
    assert.deepEqual(calls[1]!.body, { base_tree: SHA_A, tree: [{ path: "package.json", mode: "100644", type: "blob", sha: SHA_B }] });
    assert.deepEqual(calls[2]!.body, { message: "Release v0.33.0-beta.0", tree: SHA_C, parents: [SHA_A], author: { name: "Release Cell", email: "cell@example.test", date: "2026-08-19T00:00:00Z" }, committer: { name: "Release Cell", email: "cell@example.test", date: "2026-08-19T00:00:00Z" } });
    assert.ok(calls.every(call => call.query === ""));
  });
});

test("createRef never forces, and getCommit refuses a multi-parent commit", async () => {
  await withTransport([json(201, { ref: "refs/tags/v0.33.0-beta.0", object: { sha: SHA_A } }), json(200, { sha: SHA_A, parents: [{ sha: SHA_B }, { sha: SHA_C }], tree: { sha: SHA_C } }), json(404, {}), json(200, { sha: SHA_A, parents: [{ sha: SHA_B }], tree: { sha: SHA_C } })], async (provider, calls) => {
    assert.deepEqual(await provider.createRef({ repository: REPOSITORY, ref: "tags/v0.33.0-beta.0", sha: SHA_A, force: false }), { sha: SHA_A });
    assert.deepEqual(calls[0]!.body, { ref: "refs/tags/v0.33.0-beta.0", sha: SHA_A });
    const multiParent = await refusalOf(provider.getCommit({ repository: REPOSITORY, sha: SHA_A }));
    assert.equal(multiParent.kind, "definitive-refusal");
    assert.match(String(multiParent.reason), /2 parents/);
    assert.equal(await provider.getCommit({ repository: REPOSITORY, sha: SHA_A }), null);
    assert.deepEqual(await provider.getCommit({ repository: REPOSITORY, sha: SHA_A }), { sha: SHA_A, parentSha: SHA_B, treeSha: SHA_C });
    const forced = await refusalOf(provider.createRef({ repository: REPOSITORY, ref: "tags/v0.33.0-beta.0", sha: SHA_A, force: true } as never));
    assert.deepEqual(forced, { v: "reelier.github-release-provider-fault/v1", kind: "definitive-refusal", reason: "force ref creation is never authorized" });
  });
});

test("getPullRequest never reports a test-merge SHA on an unmerged pull request", async () => {
  const detail = { number: 7, node_id: "PR_x", head: { ref: "reelier/release/0.33.0-beta.0", sha: SHA_A }, base: { ref: "main" }, draft: false, title: "Release v0.33.0-beta.0", body: "Governed release v0.33.0-beta.0", merged: false, merged_at: null, merge_commit_sha: SHA_C };
  await withTransport([json(200, detail), json(200, { ...detail, merged: true, merged_at: "2026-08-19T00:00:00Z" })], async (provider, calls) => {
    assert.deepEqual(await provider.getPullRequest({ repository: REPOSITORY, number: 7 }), { number: 7, head: "reelier/release/0.33.0-beta.0", base: "main", draft: false, title: "Release v0.33.0-beta.0", body: "Governed release v0.33.0-beta.0", headSha: SHA_A, merged: false, mergeCommitSha: null });
    assert.deepEqual(await provider.getPullRequest({ repository: REPOSITORY, number: 7 }), { number: 7, head: "reelier/release/0.33.0-beta.0", base: "main", draft: false, title: "Release v0.33.0-beta.0", body: "Governed release v0.33.0-beta.0", headSha: SHA_A, merged: true, mergeCommitSha: SHA_C });
    assert.deepEqual(calls.map(call => call.path), [`/repos/${REPOSITORY}/pulls/7`, `/repos/${REPOSITORY}/pulls/7`]);
  });
});

test("findPullRequests percent-encodes a slashed head branch the driver would otherwise refuse", async () => {
  const listed = { number: 7, head: { ref: "reelier/release/0.33.0-beta.0", sha: SHA_A }, base: { ref: "main" }, draft: true, title: "Release v0.33.0-beta.0", body: "Governed release v0.33.0-beta.0", merged_at: "2026-08-19T00:00:00Z", merge_commit_sha: SHA_C };
  await withTransport([json(200, [listed])], async (provider, calls) => {
    // The list payload carries NO `merged` field: presence of `merged_at` is the only evidence.
    assert.deepEqual(await provider.findPullRequests({ repository: REPOSITORY, head: "reelier/release/0.33.0-beta.0", base: "main" }), [
      { number: 7, head: "reelier/release/0.33.0-beta.0", base: "main", draft: true, title: "Release v0.33.0-beta.0", body: "Governed release v0.33.0-beta.0", headSha: SHA_A, merged: true, mergeCommitSha: SHA_C },
    ]);
    assert.equal(calls[0]!.path, `/repos/${REPOSITORY}/pulls`);
    assert.equal(calls[0]!.query, "head=seldonframe-rehearsal%3Areelier%2Frelease%2F0.33.0-beta.0&base=main&state=all&per_page=100");
    assert.ok(!calls[0]!.query.includes("/"), "the driver refuses any query containing a slash");
  });
});

test("createPullRequest opens a draft and markPullRequestReady uses the GraphQL mutation with a readback", async () => {
  const draft = { number: 7, node_id: "PR_x", head: { ref: "reelier/release/0.33.0-beta.0", sha: SHA_A }, base: { ref: "main" }, draft: true, title: "Release v0.33.0-beta.0", body: "Governed release v0.33.0-beta.0", merged: false, merged_at: null, merge_commit_sha: null };
  await withTransport([json(201, draft), json(200, draft), json(200, { data: { markPullRequestReadyForReview: { pullRequest: { number: 7 } } } }), json(200, { ...draft, draft: false })], async (provider, calls) => {
    const created = await provider.createPullRequest({ repository: REPOSITORY, title: "Release v0.33.0-beta.0", body: "Governed release v0.33.0-beta.0", head: "reelier/release/0.33.0-beta.0", base: "main", draft: true }) as { draft: boolean };
    assert.equal(created.draft, true);
    assert.deepEqual(calls[0]!.body, { title: "Release v0.33.0-beta.0", body: "Governed release v0.33.0-beta.0", head: "reelier/release/0.33.0-beta.0", base: "main", draft: true });
    const ready = await provider.markPullRequestReady({ repository: REPOSITORY, number: 7 }) as { draft: boolean };
    assert.equal(ready.draft, false, "ready-for-review is confirmed by an authoritative readback, never by the mutation echo");
    assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), [
      `POST /repos/${REPOSITORY}/pulls`,
      `GET /repos/${REPOSITORY}/pulls/7`,
      "POST /graphql",
      `GET /repos/${REPOSITORY}/pulls/7`,
    ]);
    assert.equal((calls[2]!.body as { variables: { id: string } }).variables.id, "PR_x");
    assert.match(String((calls[2]!.body as { query: string }).query), /markPullRequestReadyForReview/);
  });
});

test("a GraphQL errors payload on ready-for-review is a definitive refusal, never a pass", async () => {
  const draft = { number: 7, node_id: "PR_x", head: { ref: "reelier/release/0.33.0-beta.0", sha: SHA_A }, base: { ref: "main" }, draft: true, title: "t", body: "b", merged: false, merged_at: null, merge_commit_sha: null };
  await withTransport([json(200, draft), json(200, { data: null, errors: [{ message: "Resource not accessible by integration" }] })], async provider => {
    const fault = await refusalOf(provider.markPullRequestReady({ repository: REPOSITORY, number: 7 }));
    assert.equal(fault.kind, "definitive-refusal");
    assert.match(String(fault.reason), /ready-for-review mutation refused: Resource not accessible by integration/);
  });
});

/** The checks source is the Actions JOBS API, never the check-runs API: a fine-grained PAT has no
 * Checks permission to grant, so the check-runs route is unreadable by the release credential.
 * An Actions job's `name` is byte-identical to the check name GitHub renders for that job. */
test("getChecks reads Actions jobs per workflow run and digests the workflow bytes at the head sha", async () => {
  const workflowBytes = Buffer.from("name: CI\n");
  const workflowDigest = `sha256:${createHash("sha256").update(workflowBytes).digest("hex")}`;
  await withTransport([
    json(200, { workflow_runs: [{ id: 4242, path: ".github/workflows/ci.yml", head_sha: SHA_A, check_suite_id: 11 }] }),
    json(200, { jobs: [
      { id: 2, name: "test (ubuntu-latest)", status: "completed", conclusion: "success" },
      { id: 3, name: "coverage", status: "completed", conclusion: "success" },
    ] }),
    json(200, { content: workflowBytes.toString("base64"), encoding: "base64" }),
  ], async (provider, calls) => {
    // The job NAME is the check name, verbatim — including the matrix suffix GitHub renders.
    assert.deepEqual(await provider.getChecks({ repository: REPOSITORY, sha: SHA_A }), [
      { name: "coverage", status: "success", workflowDigest, workflowPath: ".github/workflows/ci.yml" },
      { name: "test (ubuntu-latest)", status: "success", workflowDigest, workflowPath: ".github/workflows/ci.yml" },
    ]);
    assert.deepEqual(calls.map(call => `${call.path}?${call.query}`), [
      `/repos/${REPOSITORY}/actions/runs?head_sha=${SHA_A}&per_page=100`,
      `/repos/${REPOSITORY}/actions/runs/4242/jobs?per_page=100`,
      `/repos/${REPOSITORY}/contents/.github/workflows/ci.yml?ref=${SHA_A}`,
    ]);
    // Single-page posture on BOTH listings, unchanged from the check-runs sourcing: overflow can
    // only REMOVE a name from the set the merge gate compares, so it degrades closed.
    assert.ok(calls.every(call => call.query.includes("per_page=100") || call.query.startsWith("ref=")));
  });
});

test("getChecks keeps only the latest job per name and never reports a pending job as success", async () => {
  const workflowBytes = Buffer.from("name: CI\n");
  await withTransport([
    json(200, { workflow_runs: [{ id: 4242, path: ".github/workflows/ci.yml", head_sha: SHA_A }] }),
    json(200, { jobs: [
      { id: 2, name: "full-tests", status: "completed", conclusion: "failure" },
      { id: 9, name: "full-tests", status: "in_progress", conclusion: null },
    ] }),
    json(200, { content: workflowBytes.toString("base64"), encoding: "base64" }),
  ], async provider => {
    assert.deepEqual(await provider.getChecks({ repository: REPOSITORY, sha: SHA_A }), [
      { name: "full-tests", status: "in_progress", workflowDigest: `sha256:${createHash("sha256").update(workflowBytes).digest("hex")}`, workflowPath: ".github/workflows/ci.yml" },
    ]);
  });
});

/** A workflow run whose `path` this provider cannot read still contributes its job names, at the
 * ZERO digest — which can never equal a signed workflow commitment, so `assertChecks` refuses. */
test("getChecks maps a job whose run names no readable workflow file to the zero digest", async () => {
  await withTransport([
    json(200, { workflow_runs: [{ id: 4242, path: "not-a-workflow-path", head_sha: SHA_A }] }),
    json(200, { jobs: [{ id: 2, name: "full-tests", status: "completed", conclusion: "success" }] }),
  ], async (provider, calls) => {
    assert.deepEqual(await provider.getChecks({ repository: REPOSITORY, sha: SHA_A }), [
      { name: "full-tests", status: "success", workflowDigest: ZERO_DIGEST, workflowPath: "(unresolved-workflow-path)" },
    ]);
    // No workflow-file read is dispatched at all when there is no path to address.
    assert.equal(calls.length, 2);
  });
});

/** Non-Actions checks are out of scope BY DESIGN, and the design is enforced by construction: the
 * provider never asks for a check run at all, so a third-party App's check can never enter the name
 * set. The fail-closed consequence — a `requiredChecks` naming one refuses the merge — is pinned
 * against the REAL `assertChecks` by the `external-required-check` scenario in
 * `github-release-runner.test.ts`, never by a reimplemented gate here. */
test("getChecks never dispatches a check-runs read, so an external app's check cannot enter the name set", async () => {
  const workflowBytes = Buffer.from("name: CI\n");
  await withTransport([
    json(200, { workflow_runs: [{ id: 4242, path: ".github/workflows/ci.yml", head_sha: SHA_A, check_suite_id: 11 }] }),
    json(200, { jobs: [{ id: 2, name: "full-tests", status: "completed", conclusion: "success" }] }),
    json(200, { content: workflowBytes.toString("base64"), encoding: "base64" }),
  ], async (provider, calls) => {
    const checks = await provider.getChecks({ repository: REPOSITORY, sha: SHA_A }) as readonly { name: string }[];
    assert.deepEqual(checks.map(check => check.name), ["full-tests"]);
    assert.equal(calls.some(call => call.path.includes("/check-runs")), false, "the check-runs route is unreadable by a fine-grained PAT and must never be dispatched");
    assert.equal(calls.some(call => call.path.includes("/check-suites")), false);
  });
});

test("mergePullRequest binds the exact expected head sha and refuses any non-squash method", async () => {
  await withTransport([json(200, { merged: true, sha: SHA_C })], async (provider, calls) => {
    assert.deepEqual(await provider.mergePullRequest({ repository: REPOSITORY, number: 7, expectedHeadSha: SHA_A, method: "squash", commitTitle: "Release v0.33.0-beta.0 (#7)", commitMessage: "Governed release" }), { merged: true, sha: SHA_C });
    assert.equal(`${calls[0]!.method} ${calls[0]!.path}`, `PUT /repos/${REPOSITORY}/pulls/7/merge`);
    assert.deepEqual(calls[0]!.body, { sha: SHA_A, merge_method: "squash", commit_title: "Release v0.33.0-beta.0 (#7)", commit_message: "Governed release" });
    const fault = await refusalOf(provider.mergePullRequest({ repository: REPOSITORY, number: 7, expectedHeadSha: SHA_A, method: "merge", commitTitle: "t", commitMessage: "m" }));
    assert.equal(fault.kind, "definitive-refusal");
  });
});

test("npmVersionExists reads the registry endpoint and maps absence, presence, and uncertainty", async () => {
  await withTransport([json(404, {}), json(200, { versions: { "0.33.0-beta.0": { dist: {} } } }), json(500, {})], async (provider, calls) => {
    assert.equal(await provider.npmVersionExists({ packageName: "reelier", version: "0.33.0-beta.0" }), false);
    assert.equal(await provider.npmVersionExists({ packageName: "reelier", version: "0.33.0-beta.0" }), true);
    const fault = await refusalOf(provider.npmVersionExists({ packageName: "reelier", version: "0.33.0-beta.0" }));
    assert.equal(fault.kind, "transport-uncertain");
    assert.ok(calls.every(call => call.endpointId === "npm.registry.read" && call.path === "/reelier" && call.query === ""));
    // The registry endpoint carries no credential reference at all, so no bearer can be attached.
    assert.deepEqual(calls[0]!.headers, { accept: "application/json", "user-agent": "reelier-release-provider/1" });
  });
});

test("readPackageManifest decodes the base64 manifest at the exact commit", async () => {
  const manifest = Buffer.from(JSON.stringify({ name: "reelier", version: "0.33.0-beta.0", scripts: {} }));
  await withTransport([json(200, { content: manifest.toString("base64"), encoding: "base64" }), json(200, { content: Buffer.from("not json").toString("base64") })], async (provider, calls) => {
    assert.deepEqual(await provider.readPackageManifest({ repository: REPOSITORY, sha: SHA_A }), { name: "reelier", version: "0.33.0-beta.0" });
    assert.equal(`${calls[0]!.path}?${calls[0]!.query}`, `/repos/${REPOSITORY}/contents/package.json?ref=${SHA_A}`);
    const fault = await refusalOf(provider.readPackageManifest({ repository: REPOSITORY, sha: SHA_A }));
    assert.equal(fault.kind, "transport-uncertain");
  });
});

test("faults are plain closed DTOs: 422 is definitive-refusal, a transport throw is transport-uncertain", async () => {
  const restore = __testSetGitHubReleaseHttpsTransport({
    async read() { throw new Error("socket hang up"); },
    async write() { return json(422, { message: "Validation Failed" }); },
  });
  try {
    const provider = createGitHubReleaseHttpsProvider(config, secrets);
    const refused = await refusalOf(provider.createRef({ repository: REPOSITORY, ref: "tags/v0.33.0-beta.0", sha: SHA_A, force: false }));
    assert.deepEqual(refused, { v: "reelier.github-release-provider-fault/v1", kind: "definitive-refusal", reason: "ref creation refused with HTTP 422" });
    const uncertain = await refusalOf(provider.getRef({ repository: REPOSITORY, ref: "heads/main" }));
    assert.deepEqual(uncertain, { v: "reelier.github-release-provider-fault/v1", kind: "transport-uncertain", reason: "socket hang up" });
    assert.deepEqual(Object.keys(refused).sort(), ["kind", "reason", "v"]);
  } finally { restore(); }
});

/** The driver resolves the credential BEFORE any DNS or socket work (`materializeSecret` in
 * `json-https.ts`), so a real, unmocked `SecretResolver` reaches its failure mode entirely
 * hermetically here — no `__testSetGitHubReleaseHttpsTransport` override needed, and no network
 * touched. A `file:` reference that is really a mistyped token (an operator meant `env:...` and
 * pasted a token after `file:` instead) must never let the resulting ENOENT text — path tail
 * included — ride into the persisted `transport-uncertain` fault reason. */
test("a mistyped file: token reference never leaks its ENOENT path tail into a persisted provider fault reason", async () => {
  const mistypedTail = "ghp_deadbeef1234567890abcdef1234567890abcd";
  const provider = createGitHubReleaseHttpsProvider({ ...config, githubTokenRef: `file:${mistypedTail}` }, createSecretResolver());
  const fault = await refusalOf(provider.getRef({ repository: REPOSITORY, ref: "heads/main" }));
  assert.equal(fault.kind, "transport-uncertain");
  assert.equal(fault.reason, "secret is unavailable");
  assert.equal(String(fault.reason).includes("ENOENT"), false);
  assert.equal(String(fault.reason).includes(mistypedTail), false);
});

/** Runs the REAL provider through the REAL json-https driver with `node:https` and
 * `node:dns/promises` mocked at the module boundary — the json-https-driver.test.ts harness shape.
 * A real loopback socket is impossible by construction: the driver's `assertAllPublicAddresses`
 * SSRF guard refuses 127.0.0.1, so the fixture server lives at the transport boundary instead.
 *
 * Every secret-canary assertion runs INSIDE the child, where the token legitimately exists. The
 * child prints only a REDACTED request log, so the token never crosses the process boundary and can
 * never reach a test snapshot. */
const fixtureServerHarness = String.raw`
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mock } from "node:test";

const TOKEN = process.env.REELIER_CANARY_TOKEN;
const REPOSITORY = process.env.REELIER_CANARY_REPOSITORY;
const script = new Map(JSON.parse(process.env.REELIER_CANARY_SCRIPT));
const observed = [];

class FakeRequest extends EventEmitter {
  constructor() { super(); this.chunks = []; }
  write(value) { this.chunks.push(Buffer.from(value)); return true; }
  end() {}
  destroy(error) { if (error) queueMicrotask(() => this.emit("error", error)); return this; }
}
class FakeResponse extends EventEmitter {
  constructor(statusCode, headers) { super(); this.statusCode = statusCode; this.headers = headers; }
  destroy() { return this; }
}

mock.module("node:dns/promises", { namedExports: { lookup: async () => [{ address: "140.82.121.5", family: 4 }] } });
mock.module("node:https", { namedExports: { request: (options, onResponse) => {
  const request = new FakeRequest();
  const entry = { method: options.method, path: options.path, hostname: options.hostname, headers: { ...options.headers }, bodyUtf8: "" };
  observed.push(entry);
  const scripted = script.get(options.method + " " + String(options.path).split("?")[0]) ?? { status: 599, body: "{}" };
  queueMicrotask(() => {
    entry.bodyUtf8 = Buffer.concat(request.chunks).toString("utf8");
    const response = new FakeResponse(scripted.status, { "content-type": "application/json" });
    onResponse(response);
    queueMicrotask(() => { response.emit("data", Buffer.from(scripted.body)); response.emit("end"); });
  });
  return request;
} } });

const { createGitHubReleaseHttpsProvider } = await import(process.env.REELIER_PROVIDER_URL);
const config = { v: "reelier.github-release-https-provider-config/v1", githubAccountIdentity: "canary-release-cell", githubBaseUrl: "https://api.github.com", githubTokenRef: "env:REELIER_CANARY_TOKEN", npmRegistryBaseUrl: "https://registry.npmjs.org", repository: REPOSITORY, timeoutMs: 10000 };
let resolvedReferences = [];
const provider = createGitHubReleaseHttpsProvider(config, { async resolve(reference) { resolvedReferences.push(reference); return TOKEN; } });

const ref = await provider.getRef({ repository: REPOSITORY, ref: "heads/main" });
const blob = await provider.createBlob({ repository: REPOSITORY, contentBase64: Buffer.from("hello").toString("base64") });
// The release head branch contains slashes ("reelier/release/0.33.0-beta.0"). This is the ONE place the
// percent-encoding regression is exercised against the REAL json-https driver (every other
// findPullRequests coverage runs through the fakeTransport seam, which never touches the driver's
// own query validation) — the driver refuses ANY unencoded query slash (validateQuery), so this
// call only succeeds if the provider percent-encoded it first.
const pulls = await provider.findPullRequests({ repository: REPOSITORY, head: "reelier/release/0.33.0-beta.0", base: "main" });
// The checks source: the Actions runs listing for the head SHA, then that run's JOBS — never the
// check-runs API, which a fine-grained PAT cannot read at all. Exercised through the REAL driver so
// the two request shapes (and their single-page queries) are pinned at the transport boundary.
const checks = await provider.getChecks({ repository: REPOSITORY, sha: "a".repeat(40) });
const registry = await provider.npmVersionExists({ packageName: "reelier", version: "0.33.0-beta.0" });
let refusal; try { await provider.createRef({ repository: REPOSITORY, ref: "tags/v0.33.0-beta.0", sha: "a".repeat(40), force: false }); } catch (error) { refusal = error; }
let uncertain; try { await provider.getCommit({ repository: REPOSITORY, sha: "b".repeat(40) }); } catch (error) { uncertain = error; }

assert.deepEqual(ref, { sha: "a".repeat(40) });
assert.deepEqual(blob, { sha: "b".repeat(40) });
assert.deepEqual(pulls, [{ number: 7, head: "reelier/release/0.33.0-beta.0", base: "main", draft: true, title: "Release v0.33.0-beta.0", body: "Governed release v0.33.0-beta.0", headSha: "a".repeat(40), merged: true, mergeCommitSha: "c".repeat(40) }]);
assert.equal(registry, true);
// The Actions JOB name is the check name, verbatim — matrix suffix included.
assert.deepEqual(checks, [{ name: "test (ubuntu-latest)", status: "success", workflowDigest: "sha256:" + createHash("sha256").update(Buffer.from("name: CI\n")).digest("hex"), workflowPath: ".github/workflows/ci.yml" }]);
assert.equal(refusal.kind, "definitive-refusal");
assert.equal(uncertain.kind, "transport-uncertain");
assert.deepEqual(resolvedReferences, new Array(8).fill("env:REELIER_CANARY_TOKEN"));

// The ONE place the token legitimately appears: the Authorization header the fixture received.
const github = observed.filter(entry => entry.hostname === "api.github.com");
const npm = observed.filter(entry => entry.hostname === "registry.npmjs.org");
assert.equal(github.length, 8);
// Nothing on this path may ask for a check run: the fine-grained PAT has no Checks permission.
assert.equal(observed.some(entry => String(entry.path).includes("/check-runs")), false);
assert.equal(npm.length, 1);
for (const entry of github) assert.equal(entry.headers.authorization, "Bearer " + TOKEN, entry.path);
// The unauthenticated registry endpoint declares no credential reference, so no bearer exists to attach.
for (const entry of npm) assert.equal(Object.hasOwn(entry.headers, "authorization"), false);
// GitHub 403s a UA-less REST request (live-verified 2026-08-19); npm expects one too. EVERY request
// the real driver actually dispatches — both endpoints — must carry the exact fixed literal, never a
// version-interpolated one.
for (const entry of observed) assert.equal(entry.headers["user-agent"], "reelier-release-provider/1", entry.path);

// ...and NOWHERE else. Config, returned values, both fault DTOs, every fault reason string, every
// request path/query/body, and every non-authorization header value.
const surfaces = [
  JSON.stringify(config), JSON.stringify(ref), JSON.stringify(blob), JSON.stringify(pulls), JSON.stringify(checks), String(registry),
  JSON.stringify(refusal), String(refusal && refusal.reason), JSON.stringify(uncertain), String(uncertain && uncertain.reason),
  ...observed.map(entry => entry.method + " " + entry.path + " " + entry.bodyUtf8),
  ...observed.flatMap(entry => Object.entries(entry.headers).filter(([name]) => name.toLowerCase() !== "authorization").map(([name, value]) => name + "=" + value)),
];
for (const surface of surfaces) assert.equal(surface.includes(TOKEN), false, "secret canary leaked outside the Authorization header");

process.stdout.write(JSON.stringify(observed.map(entry => ({ method: entry.method, path: entry.path, hostname: entry.hostname, headerNames: Object.keys(entry.headers).map(name => name.toLowerCase()).sort(), userAgent: entry.headers["user-agent"] ?? null, bodyUtf8: entry.bodyUtf8 }))));
`;

test("the real driver receives the exact request shape and the token appears ONLY in the Authorization header", async () => {
  const token = `ghp_canary_${"9".repeat(24)}`;
  const script: [string, { status: number; body: string }][] = [
    [`GET /repos/${REPOSITORY}/git/ref/heads/main`, { status: 200, body: JSON.stringify({ ref: "refs/heads/main", object: { sha: SHA_A } }) }],
    [`POST /repos/${REPOSITORY}/git/blobs`, { status: 201, body: JSON.stringify({ sha: SHA_B }) }],
    [`GET /repos/${REPOSITORY}/pulls`, { status: 200, body: JSON.stringify([{ number: 7, head: { ref: "reelier/release/0.33.0-beta.0", sha: SHA_A }, base: { ref: "main" }, draft: true, title: "Release v0.33.0-beta.0", body: "Governed release v0.33.0-beta.0", merged_at: "2026-08-19T00:00:00Z", merge_commit_sha: SHA_C }]) }],
    [`GET /repos/${REPOSITORY}/actions/runs`, { status: 200, body: JSON.stringify({ workflow_runs: [{ id: 4242, path: ".github/workflows/ci.yml", head_sha: SHA_A }] }) }],
    [`GET /repos/${REPOSITORY}/actions/runs/4242/jobs`, { status: 200, body: JSON.stringify({ jobs: [{ id: 2, name: "test (ubuntu-latest)", status: "completed", conclusion: "success" }] }) }],
    [`GET /repos/${REPOSITORY}/contents/.github/workflows/ci.yml`, { status: 200, body: JSON.stringify({ content: Buffer.from("name: CI\n").toString("base64"), encoding: "base64" }) }],
    ["GET /reelier", { status: 200, body: JSON.stringify({ versions: { "0.33.0-beta.0": {} } }) }],
    [`POST /repos/${REPOSITORY}/git/refs`, { status: 422, body: JSON.stringify({ message: "Validation Failed" }) }],
    [`GET /repos/${REPOSITORY}/git/commits/${SHA_B}`, { status: 500, body: "{}" }],
  ];
  const child = spawn(process.execPath, ["--experimental-test-module-mocks", "--input-type=module", "--eval", fixtureServerHarness], {
    env: { ...process.env, REELIER_PROVIDER_URL: providerUrl, REELIER_CANARY_TOKEN: token, REELIER_CANARY_REPOSITORY: REPOSITORY, REELIER_CANARY_SCRIPT: JSON.stringify(script) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = ""; let stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  // The token-scan assertions run BEFORE the code===0 assertion on purpose: if a child-side
  // assertion fails (e.g. a harness `assert.deepEqual` on a value that embeds TOKEN), Node's
  // AssertionError diff can print the actual/expected values to the child's stderr — and the
  // code===0 assertion below embeds that entire stderr into ITS OWN failure message. Scanning first
  // means a leaked token fails on the boolean-comparison message ("must never print the token")
  // instead of being echoed verbatim through the parent assertion's diff.
  assert.equal(stdout.includes(token), false, "the redacted request log must never carry the token across the process boundary");
  assert.equal(stderr.includes(token), false, "a harness failure must never print the token");
  assert.equal(code, 0, `fixture-server harness failed\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  const requests = JSON.parse(stdout) as { method: string; path: string; hostname: string; headerNames: string[]; userAgent: string | null; bodyUtf8: string }[];
  assert.deepEqual(requests.map(entry => `${entry.method} https://${entry.hostname}${entry.path}`), [
    `GET https://api.github.com/repos/${REPOSITORY}/git/ref/heads/main`,
    `POST https://api.github.com/repos/${REPOSITORY}/git/blobs`,
    `GET https://api.github.com/repos/${REPOSITORY}/pulls?head=${encodeURIComponent(`${REPOSITORY.slice(0, REPOSITORY.indexOf("/"))}:reelier/release/0.33.0-beta.0`)}&base=main&state=all&per_page=100`,
    `GET https://api.github.com/repos/${REPOSITORY}/actions/runs?head_sha=${SHA_A}&per_page=100`,
    `GET https://api.github.com/repos/${REPOSITORY}/actions/runs/4242/jobs?per_page=100`,
    `GET https://api.github.com/repos/${REPOSITORY}/contents/.github/workflows/ci.yml?ref=${SHA_A}`,
    "GET https://registry.npmjs.org/reelier",
    `POST https://api.github.com/repos/${REPOSITORY}/git/refs`,
    `GET https://api.github.com/repos/${REPOSITORY}/git/commits/${SHA_B}`,
  ]);
  // The regression this covers: the driver's own query validation (not the fakeTransport seam
  // exercised elsewhere in this file) refuses ANY query containing a raw slash, so the slashed head
  // branch is only dispatchable at all because the provider percent-encoded it first.
  assert.ok(requests[2]!.path.includes("%2F"), "the real request line must carry the percent-encoded slash");
  assert.equal(requests[2]!.path.includes("/release/0.33.0-beta.0"), false, "the head branch's slashes must never appear unencoded in the request line");
  assert.deepEqual(requests[0]!.headerNames, ["accept", "authorization", "user-agent", "x-github-api-version"]);
  assert.deepEqual(requests[1]!.headerNames, ["accept", "authorization", "content-length", "user-agent", "x-github-api-version"]);
  assert.deepEqual(requests[2]!.headerNames, ["accept", "authorization", "user-agent", "x-github-api-version"]);
  // The two Actions-jobs reads carry the same closed header set as every other GitHub read.
  assert.deepEqual(requests[3]!.headerNames, ["accept", "authorization", "user-agent", "x-github-api-version"]);
  assert.deepEqual(requests[4]!.headerNames, ["accept", "authorization", "user-agent", "x-github-api-version"]);
  assert.deepEqual(requests[6]!.headerNames, ["accept", "user-agent"]);
  assert.deepEqual(JSON.parse(requests[1]!.bodyUtf8), { content: Buffer.from("hello").toString("base64"), encoding: "base64" });
  // GitHub 403s a UA-less REST request (live-verified 2026-08-19: identical token+endpoint ->
  // HTTP 200 with this header, HTTP 403/HTML without it); npm expects one too. Every request the
  // REAL driver dispatched — both endpoints, read and write — must carry the exact fixed literal.
  for (const entry of requests) assert.equal(entry.userAgent, "reelier-release-provider/1", `${entry.method} https://${entry.hostname}${entry.path}`);
});

test("the live smoke script default-skips without its explicit env flag and never targets the production repository", () => {
  const result = spawnSync(process.execPath, [smokeScript], { encoding: "utf8", env: { ...process.env, REELIER_RELEASE_PROVIDER_LIVE_SMOKE: "" } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /skipped/);
  const guarded = spawnSync(process.execPath, [smokeScript], { encoding: "utf8", env: { ...process.env, REELIER_RELEASE_PROVIDER_LIVE_SMOKE: "1", REELIER_SMOKE_REPOSITORY: "seldonframe/reelier", REELIER_SMOKE_TOKEN_REF: "env:NOT_SET" } });
  assert.equal(guarded.status, 1);
  assert.match(guarded.stderr, /rehearsal repository/i);
});
