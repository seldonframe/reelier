import { createHash } from "node:crypto";
import { executeJsonHttpsEffect, executeJsonHttpsRead, JsonHttpsSecurityError, type JsonHttpsEndpoint, type JsonHttpsRead, type JsonHttpsSecretResolver } from "../drivers/json-https.js";
import type { TransportEffect } from "../types.js";
import type { GitHubReleasePullRequestV1, GitHubReleaseProviderV1 } from "./github-release-runner.js";

const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const REF = /^(heads|tags)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,190}$/;
/** Unscoped only: the driver refuses `%2F` in a path, and `@scope/name` has no other registry form. */
const PACKAGE_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SECRET_REF = /^(?:env:[A-Za-z_][A-Za-z0-9_]{0,127}|file:.+)$/;
const WORKFLOW_PATH = /^\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.ya?ml$/;
const CONFIG_KEYS = ["githubAccountIdentity", "githubBaseUrl", "githubTokenRef", "npmRegistryBaseUrl", "repository", "timeoutMs", "v"] as const;
const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;
/** A job whose own workflow run does not name a readable workflow file. It keeps the ZERO digest,
 * which can never equal a signed workflow commitment, so it fails closed in `assertChecks`. */
const UNRESOLVED_WORKFLOW_PATH = "(unresolved-workflow-path)";
const GITHUB_ENDPOINT_ID = "github.release.provider";
const NPM_ENDPOINT_ID = "npm.registry.read";
/** GitHub administratively 403s any UA-less REST request (confirmed live 2026-08-19: the identical
 * token+endpoint returns HTTP 200 with this header present, HTTP 403 with an HTML body — not JSON —
 * without it), and npm's registry documents the same expectation. The json-https DRIVER does not own
 * `user-agent` the way it owns `authorization` (no secret is involved, and it is not in the driver's
 * `FORBIDDEN` header denylist — `src/authority/drivers/json-https.ts`); ownership here follows the
 * codebase's existing pattern of a caller-declared per-endpoint header, same as `founder-source-adapter.ts`'s
 * own `"User-Agent"` entry. A fixed literal, never version-interpolated, so it never becomes a fingerprint. */
const USER_AGENT = "reelier-release-provider/1";
/** Every status GitHub uses to say "this will never succeed as asked". Anything else — 5xx, 429,
 * an unreadable body — stays `transport-uncertain`, because the runner must be free to reconcile. */
const DEFINITIVE_STATUSES = new Set([400, 401, 403, 404, 405, 409, 410, 422]);

export const GITHUB_RELEASE_HTTPS_DEFAULT_API_BASE_URL = "https://api.github.com";
export const GITHUB_RELEASE_HTTPS_DEFAULT_NPM_REGISTRY_BASE_URL = "https://registry.npmjs.org";
export const GITHUB_RELEASE_HTTPS_DEFAULT_TIMEOUT_MS = 15_000;

/** Closed operator config for the live provider. `githubTokenRef` is a `SecretResolver` REFERENCE —
 * the credential value never appears here, and the provider never reads it: the json-https driver
 * resolves `endpoint.secretRef` and injects `authorization: Bearer <secret>` itself
 * (`json-https.ts` — `materializeSecret` / `requestPinned`). */
export interface GitHubReleaseHttpsProviderConfigV1 {
  readonly v: "reelier.github-release-https-provider-config/v1";
  readonly githubAccountIdentity: string;
  readonly githubBaseUrl: string;
  readonly githubTokenRef: string;
  readonly npmRegistryBaseUrl: string;
  readonly repository: string;
  readonly timeoutMs: number;
}
export interface GitHubReleaseHttpsResponse { readonly status: number; readonly body: Buffer }
export interface GitHubReleaseHttpsTransport {
  read(read: JsonHttpsRead, endpoint: JsonHttpsEndpoint): Promise<GitHubReleaseHttpsResponse>;
  write(effect: TransportEffect, endpoint: JsonHttpsEndpoint): Promise<GitHubReleaseHttpsResponse>;
}

let transportOverride: GitHubReleaseHttpsTransport | null = null;

/** @internal Test seam (the `__testSetAuthorityCellHostPlatform` restore-function precedent).
 * The driver's `assertAllPublicAddresses` SSRF guard refuses 127.0.0.1, so a hermetic suite cannot
 * point the real transport at a loopback fixture server; it swaps the transport whole instead. The
 * real-driver request shape and the credential-injection boundary are covered separately, by a
 * child process that mocks `node:https` at the module boundary. */
export function __testSetGitHubReleaseHttpsTransport(transport: GitHubReleaseHttpsTransport | null): () => void {
  const prior = transportOverride;
  transportOverride = transport;
  return () => { transportOverride = prior; };
}

export function parseGitHubReleaseHttpsProviderConfigV1(value: unknown): GitHubReleaseHttpsProviderConfigV1 {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("GitHub release HTTPS provider config is not a plain object");
  if (Object.keys(value).sort().join("\0") !== [...CONFIG_KEYS].sort().join("\0")) throw new TypeError("GitHub release HTTPS provider config is not the exact closed key set");
  const item = value as Record<string, unknown>;
  if (item.v !== "reelier.github-release-https-provider-config/v1") throw new TypeError("GitHub release HTTPS provider config version is invalid");
  return Object.freeze({
    v: item.v,
    githubAccountIdentity: assertAccountIdentity(item.githubAccountIdentity),
    githubBaseUrl: assertHttpsOrigin(item.githubBaseUrl, "githubBaseUrl"),
    githubTokenRef: assertSecretReference(item.githubTokenRef, "githubTokenRef"),
    npmRegistryBaseUrl: assertHttpsOrigin(item.npmRegistryBaseUrl, "npmRegistryBaseUrl"),
    repository: assertRepositoryIdentity(item.repository),
    timeoutMs: assertTimeoutMs(item.timeoutMs),
  });
}

/** Shared with the `github-https` arm of `reelier.github-release-runner-config/v1`, so an operator
 * config and a directly constructed provider config are refused by the SAME rules. */
export function assertHttpsOrigin(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError(`${label} must be an https origin with no path, query, or credentials`); }
  if (url.protocol !== "https:" || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || url.username || url.password || `${url.origin}/` !== `${url.origin}${url.pathname}`) throw new TypeError(`${label} must be an https origin with no path, query, or credentials`);
  return url.origin;
}

export function assertSecretReference(value: unknown, label: string): string {
  if (typeof value !== "string" || !SECRET_REF.test(value) || value.length > 512) throw new TypeError(`${label} must be an env: or file: secret reference — never a credential value`);
  return value;
}

export function assertRepositoryIdentity(value: unknown): string {
  if (typeof value !== "string" || !REPOSITORY.test(value)) throw new TypeError("repository must be an owner/name identity");
  return value;
}

export function assertAccountIdentity(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) throw new TypeError("githubAccountIdentity is invalid");
  return value;
}

export function assertTimeoutMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1_000 || value > 120_000) throw new TypeError("timeoutMs must be an integer between 1000 and 120000");
  return value;
}

/** Every refusal leaves this provider as a PLAIN `{v, kind, reason}` record — the exact shape
 * `normalizeProviderFault` (`github-release-runner.ts`) closes on. An `Error` would normalize to
 * "provider transport state is uncertain" and silently erase a definitive refusal. */
function fault(kind: "transport-uncertain" | "definitive-refusal", reason: string): never {
  throw Object.freeze({ v: "reelier.github-release-provider-fault/v1" as const, kind, reason: reason.slice(0, 512) });
}

function requireGitSha(value: unknown, label: string): string { if (typeof value !== "string" || !GIT_SHA.test(value)) fault("definitive-refusal", `${label} is not a 40-hex Git SHA`); return value as string; }
function requireRef(value: unknown): string { if (typeof value !== "string" || !REF.test(value)) fault("definitive-refusal", "ref name is invalid"); return value as string; }
function requireNumber(value: unknown, label: string): number { if (!Number.isSafeInteger(value) || (value as number) <= 0) fault("definitive-refusal", `${label} is invalid`); return value as number; }
function requireText(value: unknown, label: string): string { if (typeof value !== "string") fault("definitive-refusal", `${label} is invalid`); return value as string; }
function asRecord(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) fault("transport-uncertain", `${label} payload is not an object`); return value as Record<string, unknown>; }
function readGitSha(value: unknown, label: string): string { if (typeof value !== "string" || !GIT_SHA.test(value)) fault("transport-uncertain", `${label} is not a 40-hex Git SHA`); return value as string; }

export function createGitHubReleaseHttpsProvider(config: GitHubReleaseHttpsProviderConfigV1, secrets: JsonHttpsSecretResolver): GitHubReleaseProviderV1 {
  const parsed = parseGitHubReleaseHttpsProviderConfigV1(config);
  if (!secrets || typeof secrets.resolve !== "function") throw new TypeError("GitHub release HTTPS provider requires a secret resolver");
  const repository = parsed.repository;
  const owner = repository.slice(0, repository.indexOf("/"));
  /** `allowedPathPrefixes` is the driver's closed path surface (`validatePath`, json-https.ts). It
   * is pinned by PREFIX, not per-path, and the configured repository is baked into that prefix, so
   * re-sourcing checks from `/commits/{sha}/check-runs` to `/actions/runs/{id}/jobs` moves within
   * one already-allowed prefix and neither widens nor narrows what this endpoint can address. */
  const github: JsonHttpsEndpoint = Object.freeze({
    endpointId: GITHUB_ENDPOINT_ID,
    baseUrl: parsed.githubBaseUrl,
    allowedMethods: Object.freeze(["GET", "POST", "PUT", "PATCH"] as const),
    allowedPathPrefixes: Object.freeze([`/repos/${repository}/`, "/graphql"]),
    secretRef: parsed.githubTokenRef,
    accountIdentity: parsed.githubAccountIdentity,
  });
  /** No `secretRef` at all: the packument is public, so no bearer can be attached to this route. */
  const npmRegistry: JsonHttpsEndpoint = Object.freeze({
    endpointId: NPM_ENDPOINT_ID,
    baseUrl: parsed.npmRegistryBaseUrl,
    allowedMethods: Object.freeze(["GET"] as const),
    allowedPathPrefixes: Object.freeze(["/"]),
    accountIdentity: "npm-registry-anonymous",
  });
  const githubHeaders = Object.freeze({ accept: "application/vnd.github+json", "user-agent": USER_AGENT, "x-github-api-version": "2022-11-28" });
  const npmHeaders = Object.freeze({ accept: "application/json", "user-agent": USER_AGENT });
  const realTransport: GitHubReleaseHttpsTransport = {
    async read(read, endpoint) { const response = await executeJsonHttpsRead(read, endpoint, secrets, { timeoutMs: parsed.timeoutMs }); return { status: response.status, body: response.body }; },
    async write(effect, endpoint) { const response = await executeJsonHttpsEffect(effect, endpoint, secrets, { timeoutMs: parsed.timeoutMs }); return { status: response.status, body: response.body }; },
  };
  const transport = (): GitHubReleaseHttpsTransport => transportOverride ?? realTransport;

  /** The configured repository is the ONLY repository this provider can name. A caller asking for
   * another one is a definitive refusal before any credential, DNS, or socket work. */
  const requireConfiguredRepository = (value: unknown): string => {
    if (typeof value !== "string" || value !== repository) fault("definitive-refusal", "repository is not the configured release repository");
    return repository;
  };

  const decode = (response: GitHubReleaseHttpsResponse, label: string): { status: number; body: unknown } => {
    if (response.body.length === 0) return { status: response.status, body: null };
    try { return { status: response.status, body: JSON.parse(response.body.toString("utf8")) as unknown }; }
    catch { fault("transport-uncertain", `${label} answered with unreadable JSON (HTTP ${response.status})`); }
  };
  const get = async (endpoint: JsonHttpsEndpoint, pathName: string, query = ""): Promise<{ status: number; body: unknown }> => {
    let response: GitHubReleaseHttpsResponse;
    try {
      response = await transport().read({ endpointId: endpoint.endpointId, method: "GET", path: pathName, query, headers: endpoint.endpointId === GITHUB_ENDPOINT_ID ? githubHeaders : npmHeaders }, endpoint);
    } catch (error) {
      if (error instanceof JsonHttpsSecurityError) fault("definitive-refusal", `HTTPS read refused: ${error.message}`);
      fault("transport-uncertain", error instanceof Error ? error.message : "HTTPS read transport failure");
    }
    return decode(response, `GET ${pathName}`);
  };
  const send = async (method: "POST" | "PUT" | "PATCH", pathName: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> => {
    const effect: TransportEffect = {
      v: "reelier.transport-effect/v1", endpointId: GITHUB_ENDPOINT_ID, method, path: pathName, query: "",
      headers: { ...githubHeaders }, bodyBase64: Buffer.from(JSON.stringify(body)).toString("base64"),
      riskClass: "github_release", idempotency: "reconcile-only", preconditions: [],
      reconciliation: { recipeId: "github_release_authoritative_readback_v1" },
    };
    let response: GitHubReleaseHttpsResponse;
    try { response = await transport().write(effect, github); }
    catch (error) {
      if (error instanceof JsonHttpsSecurityError) fault("definitive-refusal", `HTTPS write refused: ${error.message}`);
      fault("transport-uncertain", error instanceof Error ? error.message : "HTTPS write transport failure");
    }
    return decode(response, `${method} ${pathName}`);
  };
  const requireStatus = (result: { status: number; body: unknown }, expected: readonly number[], label: string): unknown => {
    if (expected.includes(result.status)) return result.body;
    if (DEFINITIVE_STATUSES.has(result.status)) fault("definitive-refusal", `${label} refused with HTTP ${result.status}`);
    fault("transport-uncertain", `${label} answered HTTP ${result.status}`);
  };

  /** A list payload carries no `merged` field, so `merged_at` presence is the only evidence there
   * is. `merge_commit_sha` on an UNMERGED pull request is GitHub's ephemeral test-merge SHA, never
   * a commit on any branch — reporting it would let the runner bind a merge that never happened. */
  const mapPullRequest = (raw: unknown): GitHubReleasePullRequestV1 => {
    const item = asRecord(raw, "pull request");
    const head = asRecord(item.head, "pull request head");
    const base = asRecord(item.base, "pull request base");
    const merged = item.merged === true || (typeof item.merged_at === "string" && item.merged_at.length > 0);
    const mergeCommitSha = merged && typeof item.merge_commit_sha === "string" && GIT_SHA.test(item.merge_commit_sha) ? item.merge_commit_sha : null;
    if (!Number.isSafeInteger(item.number) || Number(item.number) <= 0 || typeof head.ref !== "string" || typeof base.ref !== "string") fault("transport-uncertain", "pull request payload is malformed");
    return Object.freeze({
      number: Number(item.number), head: head.ref, base: base.ref, draft: item.draft === true,
      title: typeof item.title === "string" ? item.title : "", body: typeof item.body === "string" ? item.body : "",
      headSha: readGitSha(head.sha, "pull request head SHA"), merged, mergeCommitSha,
    });
  };

  const readWorkflowFileDigest = async (workflowPath: string, sha: string): Promise<string> => {
    const contents = asRecord(requireStatus(await get(github, `/repos/${repository}/contents/${workflowPath}`, `ref=${sha}`), [200], "workflow file read"), "workflow file");
    if (typeof contents.content !== "string") fault("transport-uncertain", "workflow file content is absent");
    return `sha256:${createHash("sha256").update(Buffer.from(contents.content as string, "base64")).digest("hex")}`;
  };

  const readPullRequest = async (number: number, label: string): Promise<GitHubReleasePullRequestV1> =>
    mapPullRequest(requireStatus(await get(github, `/repos/${repository}/pulls/${number}`), [200], label));

  return Object.freeze({
    async createBlob({ repository: target, contentBase64 }) {
      requireConfiguredRepository(target);
      if (typeof contentBase64 !== "string" || Buffer.from(contentBase64, "base64").toString("base64") !== contentBase64) fault("definitive-refusal", "blob content is not canonical base64");
      const body = asRecord(requireStatus(await send("POST", `/repos/${repository}/git/blobs`, { content: contentBase64, encoding: "base64" }), [200, 201], "blob creation"), "blob");
      return Object.freeze({ sha: readGitSha(body.sha, "created blob SHA") });
    },
    async createTree({ repository: target, baseTreeSha, files }) {
      requireConfiguredRepository(target);
      requireGitSha(baseTreeSha, "base tree SHA");
      if (!Array.isArray(files) || files.length === 0 || files.length > 64) fault("definitive-refusal", "tree file list is invalid");
      const tree = files.map(file => ({ path: requireText(file.path, "tree entry path"), mode: requireText(file.mode, "tree entry mode"), type: "blob", sha: requireGitSha(file.blobSha, "tree blob SHA") }));
      const body = asRecord(requireStatus(await send("POST", `/repos/${repository}/git/trees`, { base_tree: baseTreeSha, tree }), [200, 201], "tree creation"), "tree");
      return Object.freeze({ sha: readGitSha(body.sha, "created tree SHA") });
    },
    async createCommit(input) {
      const item = asRecord(input, "commit input");
      requireConfiguredRepository(item.repository);
      const treeSha = requireGitSha(item.treeSha, "commit tree SHA");
      const parentSha = requireGitSha(item.parentSha, "commit parent SHA");
      if (typeof item.message !== "string" || item.message.length === 0) fault("definitive-refusal", "commit message is invalid");
      const identity = (value: unknown, label: string) => {
        const id = asRecord(value, label);
        if (typeof id.name !== "string" || typeof id.email !== "string" || typeof id.date !== "string") fault("definitive-refusal", `${label} is invalid`);
        return { name: id.name as string, email: id.email as string, date: id.date as string };
      };
      const body = asRecord(requireStatus(await send("POST", `/repos/${repository}/git/commits`, { message: item.message, tree: treeSha, parents: [parentSha], author: identity(item.author, "commit author"), committer: identity(item.committer, "commit committer") }), [200, 201], "commit creation"), "commit");
      return Object.freeze({ sha: readGitSha(body.sha, "created commit SHA") });
    },
    async getRef({ repository: target, ref }) {
      requireConfiguredRepository(target);
      requireRef(ref);
      const result = await get(github, `/repos/${repository}/git/ref/${ref}`);
      if (result.status === 404) return null;
      const body = asRecord(requireStatus(result, [200], "ref read"), "ref");
      return Object.freeze({ sha: readGitSha(asRecord(body.object, "ref object").sha, "ref SHA") });
    },
    async createRef({ repository: target, ref, sha, force }) {
      requireConfiguredRepository(target);
      requireRef(ref);
      requireGitSha(sha, "ref target SHA");
      if (force !== false) fault("definitive-refusal", "force ref creation is never authorized");
      const body = asRecord(requireStatus(await send("POST", `/repos/${repository}/git/refs`, { ref: `refs/${ref}`, sha }), [200, 201], "ref creation"), "created ref");
      return Object.freeze({ sha: readGitSha(asRecord(body.object, "created ref object").sha, "created ref SHA") });
    },
    async getCommit({ repository: target, sha }) {
      requireConfiguredRepository(target);
      requireGitSha(sha, "commit SHA");
      const result = await get(github, `/repos/${repository}/git/commits/${sha}`);
      if (result.status === 404) return null;
      const commit = asRecord(requireStatus(result, [200], "commit read"), "commit");
      const parents = Array.isArray(commit.parents) ? commit.parents : [];
      // A merge commit has no single parent, so the saga's parent binding would be a guess.
      if (parents.length !== 1) fault("definitive-refusal", `commit ${sha} has ${parents.length} parents; the release saga binds single-parent commits only`);
      return Object.freeze({
        sha: readGitSha(commit.sha, "commit SHA"),
        parentSha: readGitSha(asRecord(parents[0], "commit parent").sha, "commit parent SHA"),
        treeSha: readGitSha(asRecord(commit.tree, "commit tree").sha, "commit tree SHA"),
      });
    },
    async findPullRequests(input) {
      const item = asRecord(input, "pull request query");
      requireConfiguredRepository(item.repository);
      const head = requireText(item.head, "pull request query head");
      const base = requireText(item.base, "pull request query base");
      // A release head branch contains slashes, and the driver refuses ANY query carrying one
      // (`validateQuery`, json-https.ts). Percent-encoding is what makes the read dispatchable.
      const query = `head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}&state=all&per_page=100`;
      const body = requireStatus(await get(github, `/repos/${repository}/pulls`, query), [200], "pull request listing");
      if (!Array.isArray(body)) fault("transport-uncertain", "pull request listing is not an array");
      return Object.freeze(body.map(mapPullRequest));
    },
    async createPullRequest(input) {
      const item = asRecord(input, "pull request creation");
      requireConfiguredRepository(item.repository);
      const title = requireText(item.title, "pull request title");
      const body = requireText(item.body, "pull request body");
      const head = requireText(item.head, "pull request head");
      const base = requireText(item.base, "pull request base");
      if (item.draft !== true) fault("definitive-refusal", "a release pull request is opened as a draft only");
      return mapPullRequest(requireStatus(await send("POST", `/repos/${repository}/pulls`, { title, body, head, base, draft: true }), [200, 201], "pull request creation"));
    },
    async markPullRequestReady({ repository: target, number }) {
      requireConfiguredRepository(target);
      requireNumber(number, "pull request number");
      const detail = asRecord(requireStatus(await get(github, `/repos/${repository}/pulls/${number}`), [200], "pull request read"), "pull request");
      if (typeof detail.node_id !== "string" || detail.node_id.length === 0) fault("transport-uncertain", "pull request node id is absent");
      // Ready-for-review has NO REST mutation; GraphQL is the only provider-documented path.
      const result = asRecord(requireStatus(await send("POST", "/graphql", { query: "mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{number}}}", variables: { id: detail.node_id } }), [200], "ready-for-review mutation"), "GraphQL response");
      // A GraphQL failure is HTTP 200 with an `errors` array. Reading only the status would grade a
      // refusal as a pass.
      if (Array.isArray(result.errors) && result.errors.length > 0) fault("definitive-refusal", `ready-for-review mutation refused: ${String(asRecord(result.errors[0], "GraphQL error").message ?? "unknown")}`);
      return readPullRequest(Number(number), "pull request readback");
    },
    async getPullRequest({ repository: target, number }) {
      requireConfiguredRepository(target);
      requireNumber(number, "pull request number");
      return readPullRequest(Number(number), "pull request read");
    },
    /** The checks source is the Actions JOBS API, never the check-runs API. A fine-grained PAT has
     * no Checks permission to grant — GitHub's fine-grained-PAT permission list contains no such
     * entry at all — so `GET /repos/{owner}/{repo}/commits/{sha}/check-runs` is unreadable by this
     * credential. `Actions: Read-only` covers BOTH requests below, and an Actions job's `name` is
     * byte-identical to the check name GitHub renders for that job ("test (ubuntu-latest)"), so the
     * name set the merge gate compares is unchanged for every Actions-created check.
     *
     * Non-Actions checks — a third-party App's check runs, an external scanner — are STRUCTURALLY
     * invisible to this source, out of scope by design, and that is fail-closed rather than a gap:
     * `assertChecks` (`github-release-runner.ts`) demands exact name-set equality against the
     * signed `requiredChecks`, so a required check no Actions job provides leaves the name sets
     * unequal and the merge refuses. Nothing on this path can manufacture a passing external check.
     *
     * Pagination posture is unchanged and deliberately single-page (`per_page=100`) on BOTH
     * requests: a head SHA carrying more than 100 workflow runs, or a run carrying more than 100
     * jobs, drops the overflow from this listing. That can only ever REMOVE a name from the set,
     * never add one, so the exact-equality gate above degrades CLOSED. */
    async getChecks({ repository: target, sha }) {
      requireConfiguredRepository(target);
      requireGitSha(sha, "checks commit SHA");
      const runsPayload = asRecord(requireStatus(await get(github, `/repos/${repository}/actions/runs`, `head_sha=${sha}&per_page=100`), [200], "workflow-run listing"), "workflow-run listing");
      const digestByPath = new Map<string, string>();
      const entries: { id: number; name: string; status: string; workflowDigest: string; workflowPath: string }[] = [];
      for (const raw of Array.isArray(runsPayload.workflow_runs) ? runsPayload.workflow_runs : []) {
        const run = asRecord(raw, "workflow run");
        // A run this listing cannot address contributes no job name at all — a subtraction from the
        // compared name set, which the exact-equality gate reads as a refusal.
        if (!Number.isSafeInteger(run.id) || Number(run.id) <= 0) continue;
        // A job names no workflow file; only its workflow RUN does, and the job inherits it.
        const workflowPath = typeof run.path === "string" && WORKFLOW_PATH.test(run.path) ? run.path : UNRESOLVED_WORKFLOW_PATH;
        const jobsPayload = asRecord(requireStatus(await get(github, `/repos/${repository}/actions/runs/${Number(run.id)}/jobs`, "per_page=100"), [200], "workflow-run job listing"), "workflow-run job listing");
        const jobs = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [];
        if (jobs.length > 0 && workflowPath !== UNRESOLVED_WORKFLOW_PATH && !digestByPath.has(workflowPath)) digestByPath.set(workflowPath, await readWorkflowFileDigest(workflowPath, sha));
        const workflowDigest = digestByPath.get(workflowPath) ?? ZERO_DIGEST;
        for (const rawJob of jobs) {
          const job = asRecord(rawJob, "workflow job");
          entries.push({
            id: Number.isSafeInteger(job.id) ? Number(job.id) : 0,
            name: typeof job.name === "string" ? job.name : "",
            status: job.status === "completed" && job.conclusion === "success" ? "success" : String(job.conclusion ?? job.status ?? "unknown"),
            workflowDigest, workflowPath,
          });
        }
      }
      // GitHub keeps every re-run; only the newest job of a name describes the commit's state now.
      const latestByName = new Map<string, (typeof entries)[number]>();
      for (const entry of entries) { const prior = latestByName.get(entry.name); if (!prior || entry.id > prior.id) latestByName.set(entry.name, entry); }
      return Object.freeze([...latestByName.values()]
        .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
        .map(({ name, status, workflowDigest, workflowPath }) => Object.freeze({ name, status, workflowDigest, workflowPath })));
    },
    async mergePullRequest(input) {
      const item = asRecord(input, "merge input");
      requireConfiguredRepository(item.repository);
      const number = requireNumber(item.number, "pull request number");
      const expectedHeadSha = requireGitSha(item.expectedHeadSha, "expected head SHA");
      if (item.method !== "squash") fault("definitive-refusal", "only the squash merge method is authorized");
      const commitTitle = requireText(item.commitTitle, "merge commit title");
      const commitMessage = requireText(item.commitMessage, "merge commit message");
      const body = asRecord(requireStatus(await send("PUT", `/repos/${repository}/pulls/${number}/merge`, { sha: expectedHeadSha, merge_method: "squash", commit_title: commitTitle, commit_message: commitMessage }), [200], "squash merge"), "merge result");
      return Object.freeze({ merged: body.merged === true, sha: readGitSha(body.sha, "merge commit SHA") });
    },
    async npmVersionExists({ packageName, version }) {
      if (typeof packageName !== "string" || !PACKAGE_NAME.test(packageName)) fault("definitive-refusal", "npm package name is invalid or scoped; this provider reads unscoped packuments only");
      if (typeof version !== "string" || version.length === 0 || version.length > 64) fault("definitive-refusal", "npm version is invalid");
      const result = await get(npmRegistry, `/${packageName}`);
      if (result.status === 404) return false;
      const body = asRecord(requireStatus(result, [200], "npm packument read"), "npm packument");
      const versions = body.versions;
      return !!versions && typeof versions === "object" && !Array.isArray(versions) && Object.prototype.hasOwnProperty.call(versions, version);
    },
    async readPackageManifest({ repository: target, sha }) {
      requireConfiguredRepository(target);
      requireGitSha(sha, "manifest commit SHA");
      const contents = asRecord(requireStatus(await get(github, `/repos/${repository}/contents/package.json`, `ref=${sha}`), [200], "package manifest read"), "package manifest file");
      if (typeof contents.content !== "string") fault("transport-uncertain", "package manifest content is absent");
      let manifest: unknown;
      try { manifest = JSON.parse(Buffer.from(contents.content as string, "base64").toString("utf8")) as unknown; }
      catch { fault("transport-uncertain", "package manifest is not valid JSON"); }
      const item = asRecord(manifest, "package manifest");
      if (typeof item.name !== "string" || typeof item.version !== "string") fault("transport-uncertain", "package manifest name or version is absent");
      return Object.freeze({ name: item.name as string, version: item.version as string });
    },
  } satisfies GitHubReleaseProviderV1);
}
