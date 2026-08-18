import { createHash } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { isProxy } from "node:util/types";
import { authorityDigest } from "../wire.js";
import { assertVerifiedReleaseAuthorizationV1, type ReleaseContractSignerV1, type ReleaseProviderEffectV1, type VerifiedReleaseAuthorizationV1 } from "../release-contracts.js";
import type { DispatchAdapter, DispatchOutcome, DispatchPublication, DispatchRequestState } from "./dispatch.js";
import { createSignedJournal, type SignedJournal, type SignedJournalEventV1 } from "./signed-journal.js";
import { createGitHubReleaseProviderEvidence } from "./github-release-evidence.js";

const ALIASES = Object.freeze({ github_release_candidate_publish_v1: "candidate-branch", github_release_pr_ensure_v1: "draft-pr", github_release_pr_merge_v1: "exact-sha-merge", github_release_tag_create_v1: "non-force-tag" } satisfies Record<string, ReleaseProviderEffectV1>);
const ENDPOINTS = Object.freeze(Object.fromEntries(Object.entries(ALIASES).map(([alias, effect]) => [`github.release.${effect}`, alias])) as Record<string, GitHubReleaseAliasV1>);
const LANES = Object.freeze({ "candidate-branch": "candidate-branch", "draft-pr": "candidate-pull-request", "exact-sha-merge": "merge-exact-sha", "non-force-tag": "tag-immutable-ref" } as const);
const PREDECESSOR = Object.freeze({ "candidate-branch": null, "draft-pr": "candidate-branch", "exact-sha-merge": "draft-pr", "non-force-tag": "exact-sha-merge" } as const);
const TERMINAL = new Set(["candidate-verified", "pr-verified", "merge-verified", "tag-verified"]);
const TRANSITIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  authorized: ["blob-intent", "pr-intent", "merge-intent", "tag-intent"], "blob-intent": ["blob-created"], "blob-created": ["blob-intent", "tree-intent"], "tree-intent": ["tree-created"], "tree-created": ["commit-intent"], "commit-intent": ["commit-created"], "commit-created": ["branch-intent"], "branch-intent": ["candidate-verified"],
  "pr-intent": ["pr-created", "pr-verified"], "pr-created": ["pr-verified"], "merge-intent": ["merge-verified"], "tag-intent": ["tag-verified"],
  "candidate-verified": ["receipt-published"], "pr-verified": ["receipt-published"], "merge-verified": ["receipt-published"], "tag-verified": ["receipt-published"],
});
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
class ProviderWriteAmbiguity extends Error {}
class ReleaseRunFailure extends Error { constructor(message: string, readonly effectPossible: boolean, readonly deterministic: boolean) { super(message); } }

export type GitHubReleaseAliasV1 = keyof typeof ALIASES;
export interface GitHubReleaseAuthorizationContextV1 { readonly authorization: VerifiedReleaseAuthorizationV1; readonly fileContents: readonly Readonly<{ path: string; bytesBase64: string }>[] }
export interface GitHubReleasePullRequestV1 { readonly number: number; readonly head: string; readonly base: string; readonly draft: boolean; readonly title: string; readonly body: string; readonly headSha: string; readonly merged: boolean; readonly mergeCommitSha: string | null }
export interface GitHubReleaseProviderV1 {
  createBlob(input: Readonly<{ repository: string; contentBase64: string }>): Promise<unknown>;
  createTree(input: Readonly<{ repository: string; baseCommit: string; files: readonly Readonly<{ path: string; mode: string; blobSha: string }>[] }>): Promise<unknown>;
  createCommit(input: Readonly<Record<string, unknown>>): Promise<unknown>;
  getRef(input: Readonly<{ repository: string; ref: string }>): Promise<unknown>;
  createRef(input: Readonly<{ repository: string; ref: string; sha: string; force: false }>): Promise<unknown>;
  getCommit(input: Readonly<{ repository: string; sha: string }>): Promise<unknown>;
  findPullRequests(input: Readonly<Record<string, unknown>>): Promise<unknown>;
  createPullRequest(input: Readonly<Record<string, unknown>>): Promise<unknown>;
  getPullRequest(input: Readonly<{ repository: string; number: number }>): Promise<unknown>;
  getChecks(input: Readonly<{ repository: string; sha: string }>): Promise<unknown>;
  mergePullRequest(input: Readonly<Record<string, unknown>>): Promise<unknown>;
  npmVersionExists(input: Readonly<{ packageName: string; version: string }>): Promise<unknown>;
  readPackageManifest(input: Readonly<{ repository: string; sha: string }>): Promise<unknown>;
}
export interface GitHubReleaseRunRequestV1 { readonly alias: GitHubReleaseAliasV1; readonly allocationId: string; readonly authorizationHandle: string; readonly requestId: string; readonly semanticsDigest: string }
export interface GitHubReleaseRunResultV1 { readonly status: "verified" | "pending-reconciliation" | "refused"; readonly phase: string; readonly evidenceDigest: string | null }
export interface GitHubReleasePublicationConfirmationV1 { readonly requestId: string; readonly providerEvidenceDigest: string; readonly receiptRef: string; readonly receiptEvidenceDigest: string }
export interface GitHubReleaseRunnerV1 { run(input: GitHubReleaseRunRequestV1): Promise<GitHubReleaseRunResultV1>; recover(): Promise<readonly string[]> }

const publicationConfirmers = new WeakMap<GitHubReleaseRunnerV1, (input: GitHubReleasePublicationConfirmationV1) => Promise<void>>();

export async function createGitHubReleaseRunner(input: Readonly<{ rootDir: string; journalSigner: Readonly<{ signerId: string; privateKey: KeyObject; publicKey: KeyObject }>; evidenceSigner: ReleaseContractSignerV1; authorizationResolver: (handle: string) => Promise<GitHubReleaseAuthorizationContextV1 | VerifiedReleaseAuthorizationV1>; provider: GitHubReleaseProviderV1; now: () => Date }>): Promise<GitHubReleaseRunnerV1> {
  if (!path.isAbsolute(input.rootDir)) throw new TypeError("GitHub release runner root must be absolute");
  await mkdir(input.rootDir, { recursive: true });
  const journal = await createSignedJournal({ rootDir: path.join(input.rootDir, "journal"), journalId: "github-release", ...input.journalSigner });
  const runOnce = async (request: GitHubReleaseRunRequestV1): Promise<GitHubReleaseRunResultV1> => {
    validateRequest(request);
    const resolved = await input.authorizationResolver(request.authorizationHandle);
    const context = normalizeContext(resolved);
    const authorization = context.authorization;
    assertVerifiedReleaseAuthorizationV1(authorization);
    const effect = ALIASES[request.alias];
    const allocation = authorization.authorization.value.effectAllocations.find(candidate => candidate.effect === effect);
    if (!allocation || allocation.maxEffects !== 1 || allocation.allocationId !== request.allocationId || !DIGEST.test(allocation.allocationDigest)) throw new TypeError("release alias does not have the authenticated exact one-effect allocation");
    return journal.withLease(`authorization-${authorization.authorization.digest.slice(7)}`, async () => {
      let events = await journal.load(request.requestId);
      if (events.length > 0) {
        if (events[0].semanticsDigest !== request.semanticsDigest) throw new TypeError("release requestId semantic reuse is forbidden before dispatch");
        const root = events[0].data;
        if (root.alias !== request.alias || root.authorizationHandle !== request.authorizationHandle || root.authorizationDigest !== authorization.authorization.digest || root.allocationId !== allocation.allocationId || root.allocationDigest !== allocation.allocationDigest || root.effect !== effect) throw new TypeError("release journal authority binding is inconsistent");
        const terminal = [...events].reverse().find(event => TERMINAL.has(event.phase));
        if (terminal) return Object.freeze({ status: "verified", phase: terminal.phase, evidenceDigest: String(terminal.data.evidenceDigest) });
      } else {
        assertLive(authorization, input.now());
        if (effect === "candidate-branch") validateCandidate(context);
        await requirePredecessor(journal, authorization.authorization.digest, effect);
        for (const priorRequestId of await journal.listRequestIds()) {
          if (priorRequestId === request.requestId) continue;
          const first = (await journal.load(priorRequestId))[0];
          if (first?.data.authorizationDigest === authorization.authorization.digest && first.data.allocationId === allocation.allocationId) throw new TypeError("release one-effect allocation was already used by another request");
        }
        await journal.append(request.requestId, request.semanticsDigest, "authorized", { alias: request.alias, allocationDigest: allocation.allocationDigest, allocationId: allocation.allocationId, authorizationDigest: authorization.authorization.digest, authorizationHandle: request.authorizationHandle, effect });
        events = await journal.load(request.requestId);
      }
      try {
        if (effect === "candidate-branch") return await candidate(request, context, events, journal, input.provider, input.evidenceSigner, input.now);
        if (effect === "draft-pr") return await pullRequest(request, authorization, events, journal, input.provider, input.evidenceSigner, input.now);
        if (effect === "exact-sha-merge") return await merge(request, authorization, events, journal, input.provider, input.evidenceSigner, input.now);
        return await tag(request, authorization, events, journal, input.provider, input.evidenceSigner, input.now);
      } catch (error) {
        const latest = await journal.load(request.requestId);
        const effectPossible = latest.some(event => event.phase.endsWith("-intent") && event.phase !== "authorized");
        throw new ReleaseRunFailure(error instanceof Error ? error.message : "release runner failed", effectPossible, error instanceof TypeError);
      }
    });
  };
  const active = new Map<string, Promise<GitHubReleaseRunResultV1>>();
  const run = (request: GitHubReleaseRunRequestV1): Promise<GitHubReleaseRunResultV1> => {
    const key = `${request.allocationId}\0${request.requestId}`;
    const prior = active.get(key) ?? Promise.resolve(undefined);
    const current = prior.catch(() => undefined).then(() => runOnce(request));
    active.set(key, current);
    return current.finally(() => { if (active.get(key) === current) active.delete(key); });
  };
  const recover = async (): Promise<readonly string[]> => {
    const recovered: string[] = [];
    for (const requestId of await journal.listRequestIds()) {
      const events = await journal.load(requestId), first = events[0];
      if (!first || events.some(event => TERMINAL.has(event.phase))) continue;
      const result = await run({ alias: first.data.alias as GitHubReleaseAliasV1, allocationId: String(first.data.allocationId), authorizationHandle: String(first.data.authorizationHandle), requestId, semanticsDigest: first.semanticsDigest });
      if (result.status === "verified") recovered.push(requestId);
    }
    return Object.freeze(recovered);
  };
  const confirmPublication = async (confirmation: GitHubReleasePublicationConfirmationV1): Promise<void> => {
    const value = exactRecord(confirmation, ["providerEvidenceDigest", "receiptEvidenceDigest", "receiptRef", "requestId"], "release publication confirmation");
    if (!DIGEST.test(String(value.providerEvidenceDigest)) || !DIGEST.test(String(value.receiptEvidenceDigest)) || !/^[A-Za-z0-9][A-Za-z0-9._:~-]{0,255}$/.test(String(value.receiptRef)) || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(String(value.requestId))) throw new TypeError("release publication confirmation is invalid");
    const initial = await journal.load(String(value.requestId)), authorizationDigest = String(initial[0]?.data.authorizationDigest ?? "");
    if (!DIGEST.test(authorizationDigest)) throw new TypeError("release publication request is absent");
    await journal.withLease(`authorization-${authorizationDigest.slice(7)}`, async () => {
      const events = await journal.load(String(value.requestId)), terminal = [...events].reverse().find(event => TERMINAL.has(event.phase));
      if (!terminal || terminal.data.evidenceDigest !== value.providerEvidenceDigest) throw new TypeError("release publication does not match terminal provider evidence");
      const existing = events.find(event => event.phase === "receipt-published");
      const data = Object.freeze({ providerEvidenceDigest: value.providerEvidenceDigest, receiptEvidenceDigest: value.receiptEvidenceDigest, receiptRef: value.receiptRef });
      if (existing) { if (authorityDigest(existing.data) !== authorityDigest(data)) throw new TypeError("release publication confirmation conflicts"); return; }
      await step(journal, { requestId: String(value.requestId), semanticsDigest: events[0]!.semanticsDigest } as GitHubReleaseRunRequestV1, "receipt-published", data);
    });
  };
  const runner = Object.freeze({ run, recover });
  publicationConfirmers.set(runner, confirmPublication);
  return runner;
}

/** Routes only the four reviewed release endpoints through the dedicated saga. The ordinary
 * coordinator still performs the actual allocation consumption and receipt publication. */
export function createGitHubReleaseDispatchAdapter(input: Readonly<{ runner: GitHubReleaseRunnerV1 | null; fallback: DispatchAdapter }>): DispatchAdapter {
  const invoke = async (state: DispatchRequestState): Promise<DispatchOutcome | null> => {
    const endpointId = inertEndpointId(state.effect);
    const alias = endpointId ? ENDPOINTS[endpointId] : undefined;
    if (!alias) return null;
    if (!input.runner) return failure("dedicated-release-runner-absent");
    const effect = exactRecord(state.effect, ["bodyBase64", "endpointId", "headers", "idempotency", "method", "path", "preconditions", "query", "reconciliation", "riskClass", "v"], "release transport effect");
    const execution = state.reservation.intent.executionContext;
    if (!execution) return failure("release-allocation-context-absent");
    let body: Record<string, unknown>;
    try { body = exactRecord(JSON.parse(Buffer.from(String(effect.bodyBase64), "base64").toString("utf8")), ["authorizationHandle"], "release dispatch body"); }
    catch { return failure("release-dispatch-body-invalid"); }
    try {
      const result = await input.runner.run({ alias, allocationId: execution.allocationId, authorizationHandle: String(body.authorizationHandle), requestId: state.reservation.reservationId, semanticsDigest: state.effectDigest });
      if (result.status === "verified") return Object.freeze({ kind: "acknowledged", resultDigest: result.evidenceDigest!, reconciliationStatus: "matched", normalizedProjectionDigest: result.evidenceDigest });
      if (result.status === "pending-reconciliation") return Object.freeze({ kind: "ambiguous", resultDigest: authorityDigest(result), reconciliationStatus: "unavailable", normalizedProjectionDigest: null });
      return failure(result.phase);
    } catch (error) {
      if (error instanceof ReleaseRunFailure) return error.deterministic ? failure(error.message, error.effectPossible ? "conflict" : "not-applied") : Object.freeze({ kind: "ambiguous", resultDigest: authorityDigest({ reason: error.message }), reconciliationStatus: "unavailable", normalizedProjectionDigest: null });
      if (error instanceof TypeError) return failure(error.message, "not-applied");
      return Object.freeze({ kind: "ambiguous", resultDigest: authorityDigest({ reason: error instanceof Error ? error.message : "release-runner-unavailable" }), reconciliationStatus: "unavailable", normalizedProjectionDigest: null });
    }
  };
  return Object.freeze({
    ...(input.fallback.prepare ? { async prepare(state: DispatchRequestState) {
      if (ENDPOINTS[inertEndpointId(state.effect) ?? ""]) throw new TypeError("release dispatch requires the dedicated prepared send boundary");
      return input.fallback.prepare!(state);
    } } : {}),
    async dispatch(state: DispatchRequestState) { return await invoke(state) ?? input.fallback.dispatch(state); },
    async reconcile(state: DispatchRequestState, outcome: DispatchOutcome) { return await invoke(state) ?? (input.fallback.reconcile ? input.fallback.reconcile(state, outcome) : outcome); },
  });
}

/** Confirms the ordinary coordinator's durable receipt only after its configured publication
 * succeeds. Later release effects require this confirmation, not provider evidence alone. */
export function createGitHubReleaseReceiptPublication(input: Readonly<{ runner: GitHubReleaseRunnerV1; publication: DispatchPublication }>): DispatchPublication {
  const confirmPublication = publicationConfirmers.get(input.runner);
  if (!confirmPublication) throw new TypeError("release runner publication capability is unavailable");
  return Object.freeze({
    async publish(value: Parameters<DispatchPublication["publish"]>[0]) {
      const published = await input.publication.publish(value);
      const effect = isPlain(value.state.effect) ? value.state.effect : null;
      if (value.phase === "dispatch" && value.outcome.kind === "acknowledged" && effect && typeof effect.endpointId === "string" && ENDPOINTS[effect.endpointId]) await confirmPublication({ requestId: value.state.reservation.reservationId, providerEvidenceDigest: value.outcome.resultDigest, receiptRef: published.receiptRef, receiptEvidenceDigest: published.evidenceDigest });
      return published;
    },
    ...(input.publication.publishReservation ? { publishReservation: input.publication.publishReservation.bind(input.publication) } : {}),
    ...(input.publication.loadDurableHead ? { loadDurableHead: input.publication.loadDurableHead.bind(input.publication) } : {}),
  });
}

async function candidate(request: GitHubReleaseRunRequestV1, context: GitHubReleaseAuthorizationContextV1, initial: readonly SignedJournalEventV1[], journal: SignedJournal, provider: GitHubReleaseProviderV1, signer: ReleaseContractSignerV1, now: () => Date): Promise<GitHubReleaseRunResultV1> {
  const auth = context.authorization, plan = auth.operationPlan.value, byPath = new Map(context.fileContents.map(file => [file.path, file.bytesBase64]));
  const refName = `heads/${plan.candidateBranch}`;
  const base = parseRef(await provider.getRef({ repository: plan.repository, ref: `heads/${plan.destinationBranch}` }));
  if (!base || base.sha !== plan.baseCommit) throw new TypeError("candidate publication base branch drifted");
  const before = parseRef(await provider.getRef({ repository: plan.repository, ref: refName }));
  if (before && before.sha !== plan.expectedCommitSha) throw new TypeError("candidate branch ref conflicts with authorization");
  if (before && !has(initial, "branch-intent")) throw new TypeError("candidate branch exists without this authorized write intent");
  for (let index = 0; index < plan.files.length; index += 1) {
    const file = plan.files[index], bytesBase64 = byPath.get(file.path)!;
    if (!has(initial, "blob-created", "index", index)) { assertWriteLive(auth, now); await step(journal, request, "blob-intent", { index, path: file.path }); const result = await providerWrite(() => provider.createBlob({ repository: plan.repository, contentBase64: bytesBase64 }), raw => parseSha(raw, "blob")); if (result.sha !== file.blobSha) throw new TypeError("provider blob readback does not match expected Git SHA"); await step(journal, request, "blob-created", { index, sha: result.sha }); }
  }
  let events = await journal.load(request.requestId);
  if (!has(events, "tree-created")) { assertWriteLive(auth, now); await step(journal, request, "tree-intent", {}); const tree = await providerWrite(() => provider.createTree({ repository: plan.repository, baseCommit: plan.baseCommit, files: plan.files.map(file => ({ path: file.path, mode: file.mode, blobSha: file.blobSha })) }), raw => parseSha(raw, "tree")); if (tree.sha !== plan.expectedTreeSha) throw new TypeError("provider tree SHA is not authorized"); await step(journal, request, "tree-created", { sha: tree.sha }); }
  events = await journal.load(request.requestId);
  if (!has(events, "commit-created")) { assertWriteLive(auth, now); await step(journal, request, "commit-intent", {}); const commit = await providerWrite(() => provider.createCommit({ repository: plan.repository, treeSha: plan.expectedTreeSha, ...plan.commit }), raw => parseSha(raw, "commit")); if (commit.sha !== plan.expectedCommitSha) throw new TypeError("provider commit SHA is not authorized"); await step(journal, request, "commit-created", { sha: commit.sha }); }
  events = await journal.load(request.requestId);
  let existing = parseRef(await provider.getRef({ repository: plan.repository, ref: refName }));
  if (!existing) {
    if (has(events, "branch-intent")) return pending("branch-intent");
    assertWriteLive(auth, now); await step(journal, request, "branch-intent", {});
    try { parseSha(await provider.createRef({ repository: plan.repository, ref: refName, sha: plan.expectedCommitSha, force: false }), "created ref"); } catch { /* authoritative readback below */ }
    existing = await safeRead(() => provider.getRef({ repository: plan.repository, ref: refName }), parseRef);
  }
  if (!existing || existing.sha !== plan.expectedCommitSha) return pending("branch-intent");
  const commit = parseCommit(await provider.getCommit({ repository: plan.repository, sha: plan.expectedCommitSha }));
  if (!commit || commit.parentSha !== plan.baseCommit || commit.treeSha !== plan.expectedTreeSha) throw new TypeError("candidate commit parent or tree readback is tampered");
  return finish(journal, request, auth, "candidate-branch", "candidate-verified", authorityDigest({ ref: existing, commit }), signer, now());
}

async function pullRequest(request: GitHubReleaseRunRequestV1, auth: VerifiedReleaseAuthorizationV1, events: readonly SignedJournalEventV1[], journal: SignedJournal, provider: GitHubReleaseProviderV1, signer: ReleaseContractSignerV1, now: () => Date): Promise<GitHubReleaseRunResultV1> {
  const plan = auth.operationPlan.value;
  const base = parseRef(await provider.getRef({ repository: plan.repository, ref: `heads/${plan.destinationBranch}` }));
  const branch = parseRef(await provider.getRef({ repository: plan.repository, ref: `heads/${plan.candidateBranch}` }));
  if (!base || base.sha !== plan.baseCommit || !branch || branch.sha !== plan.expectedCommitSha) throw new TypeError("pull request base or candidate ref drifted");
  let matches = parsePullRequests(await provider.findPullRequests({ repository: plan.repository, head: plan.pullRequest.head, base: plan.pullRequest.base }));
  if (matches.length > 1) throw new TypeError("multiple release pull requests conflict");
  if (matches.length === 0) {
    if (has(events, "pr-intent")) return pending("pr-intent");
    assertWriteLive(auth, now); await step(journal, request, "pr-intent", {});
    try { parsePullRequest(await provider.createPullRequest({ repository: plan.repository, ...plan.pullRequest })); } catch { /* exact lookup below */ }
    matches = await safeRead(() => provider.findPullRequests({ repository: plan.repository, head: plan.pullRequest.head, base: plan.pullRequest.base }), parsePullRequests) ?? [];
    if (matches.length === 0) return pending("pr-intent");
    if (matches.length > 1) throw new TypeError("multiple release pull requests conflict after ambiguous create");
    await step(journal, request, "pr-created", { number: matches[0]!.number });
  } else if (!has(events, "pr-intent")) throw new TypeError("pull request exists without this authorized write intent");
  const pr = matches[0]!; assertPullRequestPlan(pr, plan);
  return finish(journal, request, auth, "candidate-pull-request", "pr-verified", authorityDigest(pr), signer, now());
}

async function merge(request: GitHubReleaseRunRequestV1, auth: VerifiedReleaseAuthorizationV1, events: readonly SignedJournalEventV1[], journal: SignedJournal, provider: GitHubReleaseProviderV1, signer: ReleaseContractSignerV1, now: () => Date): Promise<GitHubReleaseRunResultV1> {
  const plan = auth.operationPlan.value;
  const matches = parsePullRequests(await provider.findPullRequests({ repository: plan.repository, head: plan.pullRequest.head, base: plan.pullRequest.base }));
  if (matches.length !== 1) throw new TypeError("release merge requires exactly one pull request");
  let pr = matches[0]!; assertPullRequestPlan(pr, plan);
  let mergeSha: string | null = null;
  if (!pr.merged) {
    const base = parseRef(await provider.getRef({ repository: plan.repository, ref: `heads/${plan.destinationBranch}` }));
    if (!base || base.sha !== plan.baseCommit) throw new TypeError("release base branch drifted");
    const checks = parseChecks(await provider.getChecks({ repository: plan.repository, sha: plan.expectedCommitSha }));
    const names = checks.map(check => check.name).sort();
    if (names.join("\0") !== [...plan.requiredChecks].sort().join("\0") || checks.some(check => check.status !== "success" || !plan.workflowCommitments.some(workflow => workflow.digest === check.workflowDigest))) throw new TypeError("required release checks or workflow commitment are missing or failed");
    if (has(events, "merge-intent")) return pending("merge-intent");
    assertWriteLive(auth, now); await step(journal, request, "merge-intent", {});
    try { const result = parseMerge(await provider.mergePullRequest({ repository: plan.repository, number: pr.number, expectedHeadSha: plan.expectedCommitSha, method: "squash", ...plan.squash })); if (result.merged) mergeSha = result.sha; } catch { /* no resend; authoritative readback below */ }
    pr = await safeRead(() => provider.getPullRequest({ repository: plan.repository, number: pr.number }), parsePullRequest) ?? pr;
  } else if (!has(events, "merge-intent")) throw new TypeError("pull request was merged without this authorized write intent");
  mergeSha ??= pr.mergeCommitSha;
  if (!mergeSha || !GIT_SHA.test(mergeSha) || !pr.merged || pr.mergeCommitSha !== mergeSha) return pending("merge-intent");
  const main = await safeRead(() => provider.getRef({ repository: plan.repository, ref: `heads/${plan.destinationBranch}` }), parseRef);
  if (!main || main.sha !== mergeSha) return pending("merge-intent");
  const commit = parseCommit(await provider.getCommit({ repository: plan.repository, sha: mergeSha }));
  if (!commit || commit.treeSha !== plan.expectedTreeSha) throw new TypeError("squash commit tree readback is tampered");
  return finish(journal, request, auth, "merge-exact-sha", "merge-verified", authorityDigest({ pr, main, commit }), signer, now(), { mergeSha });
}

async function tag(request: GitHubReleaseRunRequestV1, auth: VerifiedReleaseAuthorizationV1, events: readonly SignedJournalEventV1[], journal: SignedJournal, provider: GitHubReleaseProviderV1, signer: ReleaseContractSignerV1, now: () => Date): Promise<GitHubReleaseRunResultV1> {
  const plan = auth.operationPlan.value, predecessor = await requirePredecessor(journal, auth.authorization.digest, "non-force-tag"), mergeSha = String(predecessor.data.mergeSha ?? "");
  if (!GIT_SHA.test(mergeSha)) throw new TypeError("verified merge predecessor lacks an authoritative merge SHA");
  const manifest = parseManifest(await provider.readPackageManifest({ repository: plan.repository, sha: mergeSha }));
  if (manifest.name !== plan.npmPreflight.packageName || manifest.version !== plan.npmPreflight.version) throw new TypeError("release package name or version mismatch");
  if (parseBoolean(await provider.npmVersionExists({ packageName: manifest.name, version: manifest.version }), "npm version state")) throw new TypeError("release npm version already exists");
  const main = parseRef(await provider.getRef({ repository: plan.repository, ref: `heads/${plan.destinationBranch}` }));
  if (!main || main.sha !== mergeSha) throw new TypeError("release main ref does not match reconciled squash commit");
  const ref = `tags/${plan.tag}`;
  let existing = parseRef(await provider.getRef({ repository: plan.repository, ref }));
  if (existing && existing.sha !== mergeSha) throw new TypeError("release tag ref conflicts");
  if (existing && !has(events, "tag-intent")) throw new TypeError("release tag exists without this authorized write intent");
  if (!existing) {
    if (has(events, "tag-intent")) return pending("tag-intent");
    assertWriteLive(auth, now); await step(journal, request, "tag-intent", {});
    try { parseSha(await provider.createRef({ repository: plan.repository, ref, sha: mergeSha, force: false }), "created tag"); } catch { /* never resend; read below */ }
    existing = await safeRead(() => provider.getRef({ repository: plan.repository, ref }), parseRef);
  }
  if (!existing || existing.sha !== mergeSha) return pending("tag-intent");
  return finish(journal, request, auth, "tag-immutable-ref", "tag-verified", authorityDigest({ tagged: existing, manifest, npmVersionAbsent: true, mergeSha }), signer, now(), { mergeSha });
}

async function requirePredecessor(journal: SignedJournal, authorizationDigest: string, effect: ReleaseProviderEffectV1): Promise<SignedJournalEventV1> {
  const required = PREDECESSOR[effect];
  if (!required) return Object.freeze({ data: Object.freeze({}), phase: "root" } as SignedJournalEventV1);
  const matches: SignedJournalEventV1[] = [];
  for (const requestId of await journal.listRequestIds()) {
    const events = await journal.load(requestId), first = events[0], last = events.at(-1), terminal = [...events].reverse().find(event => TERMINAL.has(event.phase));
    if (first?.data.authorizationDigest === authorizationDigest && first.data.effect === required && last?.phase === "receipt-published" && terminal && last.data.providerEvidenceDigest === terminal.data.evidenceDigest && DIGEST.test(String(last.data.receiptEvidenceDigest ?? "")) && typeof last.data.receiptRef === "string" && last.data.receiptRef.length > 0) matches.push(terminal);
  }
  if (matches.length !== 1 || !DIGEST.test(String(matches[0]!.data.evidenceDigest ?? ""))) throw new TypeError(`verified ${required} predecessor evidence is absent or conflicting`);
  return matches[0]!;
}

function validateCandidate(context: GitHubReleaseAuthorizationContextV1): void {
  const plan = context.authorization.operationPlan.value;
  if (context.fileContents.length !== plan.files.length) throw new TypeError("authenticated candidate file set is incomplete");
  const byPath = new Map<string, string>();
  for (const raw of context.fileContents) { const file = exactRecord(raw, ["bytesBase64", "path"], "candidate file bytes"); if (typeof file.path !== "string" || typeof file.bytesBase64 !== "string" || byPath.has(file.path)) throw new TypeError("authenticated candidate file set is invalid"); byPath.set(file.path, file.bytesBase64); }
  for (const file of plan.files) { const bytesBase64 = byPath.get(file.path); if (!bytesBase64) throw new TypeError("authenticated candidate file bytes are missing"); const bytes = Buffer.from(bytesBase64, "base64"); if (bytes.toString("base64") !== bytesBase64 || sha256(bytes) !== file.contentDigest || gitBlobSha(bytes) !== file.blobSha) throw new TypeError("candidate bytes do not match signed content and Git blob commitments"); }
}
function normalizeContext(value: GitHubReleaseAuthorizationContextV1 | VerifiedReleaseAuthorizationV1): GitHubReleaseAuthorizationContextV1 { if (isPlain(value) && Object.keys(value).sort().join("\0") === ["authorization", "fileContents"].sort().join("\0")) return Object.freeze({ authorization: (value as GitHubReleaseAuthorizationContextV1).authorization, fileContents: Object.freeze([...(value as GitHubReleaseAuthorizationContextV1).fileContents]) }); return Object.freeze({ authorization: value as VerifiedReleaseAuthorizationV1, fileContents: Object.freeze([]) }); }
function assertLive(auth: VerifiedReleaseAuthorizationV1, now: Date): void { if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || now.getTime() < Date.parse(auth.authorization.value.issuedAt) || now.getTime() >= Date.parse(auth.authorization.value.expiresAt)) throw new TypeError("release authorization is stale or clock is invalid"); }
function assertWriteLive(auth: VerifiedReleaseAuthorizationV1, now: () => Date): void { assertLive(auth, now()); }
async function finish(journal: SignedJournal, request: GitHubReleaseRunRequestV1, auth: VerifiedReleaseAuthorizationV1, lane: keyof typeof LANES extends never ? never : any, phase: string, subjectDigest: string, signer: ReleaseContractSignerV1, now: Date, extra: Readonly<Record<string, unknown>> = {}): Promise<GitHubReleaseRunResultV1> { const evidence = createGitHubReleaseProviderEvidence({ authorization: auth, lane, observedAt: now.toISOString(), subjectDigest, signer }); await step(journal, request, phase, { ...extra, evidence, evidenceDigest: evidence.digest, subjectDigest }); return Object.freeze({ status: "verified", phase, evidenceDigest: evidence.digest }); }
async function step(journal: SignedJournal, request: GitHubReleaseRunRequestV1, phase: string, data: Readonly<Record<string, unknown>>): Promise<void> { const events = await journal.load(request.requestId), prior = events.at(-1)?.phase; if (!prior || !TRANSITIONS[prior]?.includes(phase)) { if (events.some(event => event.phase === phase && authorityDigest(event.data) === authorityDigest(data))) return; throw new TypeError(`invalid release saga transition ${prior ?? "absent"} -> ${phase}`); } await journal.append(request.requestId, request.semanticsDigest, phase, data); }
function has(events: readonly SignedJournalEventV1[], phase: string, key?: string, value?: unknown): boolean { return events.some(event => event.phase === phase && (key === undefined || event.data[key] === value)); }
function pending(phase: string): GitHubReleaseRunResultV1 { return Object.freeze({ status: "pending-reconciliation", phase, evidenceDigest: null }); }
function failure(reason: string, reconciliationStatus: "not-applied" | "conflict" = "not-applied"): DispatchOutcome { return Object.freeze({ kind: "definitive-failure", resultDigest: authorityDigest({ reason }), reconciliationStatus, normalizedProjectionDigest: null }); }
function sha256(bytes: Uint8Array): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function gitBlobSha(bytes: Uint8Array): string { return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex"); }
function validateRequest(request: unknown): asserts request is GitHubReleaseRunRequestV1 { const value = exactRecord(request, ["alias", "allocationId", "authorizationHandle", "requestId", "semanticsDigest"], "GitHub release request"); if (!(String(value.alias) in ALIASES) || !/^[a-z0-9][a-z0-9-]{7,127}$/.test(String(value.allocationId)) || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(String(value.authorizationHandle)) || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(String(value.requestId)) || !DIGEST.test(String(value.semanticsDigest))) throw new TypeError("GitHub release request is invalid"); }
function isPlain(value: unknown): value is Record<string, unknown> { if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some(key => typeof key !== "string")) return false; return Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor => "value" in descriptor && descriptor.enumerable); }
function inertEndpointId(value: unknown): string | null { if (!isPlain(value)) return null; const descriptor = Object.getOwnPropertyDescriptor(value, "endpointId"); return descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : null; }
function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> { if (!isPlain(value) || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) throw new TypeError(`${label} is not a closed inert record`); return Object.freeze(Object.fromEntries(keys.map(key => [key, value[key]]))); }
function parseSha(value: unknown, label: string): Readonly<{ sha: string }> { const item = exactRecord(value, ["sha"], label); if (!GIT_SHA.test(String(item.sha))) throw new TypeError(`${label} SHA is invalid`); return Object.freeze({ sha: String(item.sha) }); }
function parseRef(value: unknown): Readonly<{ sha: string }> | null { if (value === null) return null; return parseSha(value, "ref"); }
function parseCommit(value: unknown): Readonly<{ sha: string; parentSha: string; treeSha: string }> | null { if (value === null) return null; const item = exactRecord(value, ["parentSha", "sha", "treeSha"], "commit"); if (![item.sha, item.parentSha, item.treeSha].every(raw => GIT_SHA.test(String(raw)))) throw new TypeError("commit readback is invalid"); return Object.freeze({ sha: String(item.sha), parentSha: String(item.parentSha), treeSha: String(item.treeSha) }); }
function parsePullRequest(value: unknown): GitHubReleasePullRequestV1 { const item = exactRecord(value, ["base", "body", "draft", "head", "headSha", "mergeCommitSha", "merged", "number", "title"], "pull request"); if (!Number.isSafeInteger(item.number) || Number(item.number) <= 0 || typeof item.head !== "string" || typeof item.base !== "string" || typeof item.draft !== "boolean" || typeof item.title !== "string" || typeof item.body !== "string" || !GIT_SHA.test(String(item.headSha)) || typeof item.merged !== "boolean" || !(item.mergeCommitSha === null || GIT_SHA.test(String(item.mergeCommitSha)))) throw new TypeError("pull request readback is invalid"); return Object.freeze({ number: Number(item.number), head: item.head, base: item.base, draft: item.draft, title: item.title, body: item.body, headSha: String(item.headSha), merged: item.merged, mergeCommitSha: item.mergeCommitSha === null ? null : String(item.mergeCommitSha) }); }
function parsePullRequests(value: unknown): readonly GitHubReleasePullRequestV1[] { if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).some((key, index) => key !== String(index))) throw new TypeError("pull request list is not closed and dense"); return Object.freeze(value.map(parsePullRequest)); }
function assertPullRequestPlan(pr: GitHubReleasePullRequestV1, plan: VerifiedReleaseAuthorizationV1["operationPlan"]["value"]): void { if (pr.head !== plan.pullRequest.head || pr.base !== plan.pullRequest.base || pr.draft !== true || pr.title !== plan.pullRequest.title || pr.body !== plan.pullRequest.body || pr.headSha !== plan.expectedCommitSha) throw new TypeError("pull request readback does not match exact authorized metadata"); }
function parseChecks(value: unknown): readonly Readonly<{ name: string; status: string; workflowDigest: string }>[] { if (!Array.isArray(value) || Object.keys(value).some((key, index) => key !== String(index))) throw new TypeError("checks list is not closed and dense"); return Object.freeze(value.map(raw => { const item = exactRecord(raw, ["name", "status", "workflowDigest"], "check"); if (typeof item.name !== "string" || typeof item.status !== "string" || !DIGEST.test(String(item.workflowDigest))) throw new TypeError("check readback is invalid"); return Object.freeze({ name: item.name, status: item.status, workflowDigest: String(item.workflowDigest) }); })); }
function parseMerge(value: unknown): Readonly<{ merged: boolean; sha: string }> { const item = exactRecord(value, ["merged", "sha"], "merge result"); if (typeof item.merged !== "boolean" || !GIT_SHA.test(String(item.sha))) throw new TypeError("merge result is invalid"); return Object.freeze({ merged: item.merged, sha: String(item.sha) }); }
function parseManifest(value: unknown): Readonly<{ name: string; version: string }> { const item = exactRecord(value, ["name", "version"], "package manifest"); if (typeof item.name !== "string" || typeof item.version !== "string") throw new TypeError("package manifest is invalid"); return Object.freeze({ name: item.name, version: item.version }); }
function parseBoolean(value: unknown, label: string): boolean { if (typeof value !== "boolean") throw new TypeError(`${label} is invalid`); return value; }
async function safeRead<T>(read: () => Promise<unknown>, parse: (value: unknown) => T): Promise<T | null> { let raw: unknown; try { raw = await read(); } catch { return null; } return parse(raw); }
async function providerWrite<T>(write: () => Promise<unknown>, parse: (value: unknown) => T): Promise<T> { let raw: unknown; try { raw = await write(); } catch (error) { throw new ProviderWriteAmbiguity(error instanceof Error ? error.message : "provider write response is ambiguous"); } return parse(raw); }
