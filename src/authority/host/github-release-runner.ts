import { createHash } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { isProxy } from "node:util/types";
import { authorityDigest } from "../wire.js";
import { assertVerifiedReleaseAuthorizationV1, type ReleaseContractSignerV1, type ReleaseProviderEffectV1, type VerifiedReleaseAuthorizationV1 } from "../release-contracts.js";
import { consumeCoordinatorDispatchCallDelegateV1, consumeCoordinatorPublicationCall, type DispatchAdapter, type DispatchOutcome, type DispatchPublication, type DispatchRequestState, type DurableDispatchPublicationHeadV1, type DurableDispatchPublicationQueryV1 } from "./dispatch.js";
import { consumeCoordinatorReconciliation, createPreparedDispatch } from "./prepared-dispatch.js";
import { materializedHttpRequestDigest } from "./http-response-semantics.js";
import { normalizeReservationPublicationId } from "./reservation-identity.js";
import { createSignedJournal, type SignedJournal, type SignedJournalEventV1 } from "./signed-journal.js";
import { createGitHubReleaseProviderEvidence } from "./github-release-evidence.js";
import { assertGitHubReleaseHostedAuthorityBindingV1, type GitHubReleaseHostedAuthorityBindingV1 } from "./github-release-hosted-authority.js";
import { mintTrustedEffectTransportExecutorV1, type TrustedEffectTransportExecutorV1 } from "./effect-transports.js";
import { GITHUB_RELEASE_OUTCOME_SERVER_SCHEMA_DIGEST_V1, githubReleaseOutcomeBindingDigestV1, githubReleaseOutcomeToolSchemaDigestV1, githubReviewedOutcomePolicyDigestV1 } from "../packs/github-linear-outcomes.js";

const ALIASES = Object.freeze({ github_release_candidate_publish_v1: "candidate-branch", github_release_pr_ensure_v1: "draft-pr", github_release_pr_merge_v1: "exact-sha-merge", github_release_tag_create_v1: "non-force-tag" } satisfies Record<string, ReleaseProviderEffectV1>);
const ENDPOINTS = Object.freeze(Object.fromEntries(Object.entries(ALIASES).map(([alias, effect]) => [`github.release.${effect}`, alias])) as Record<string, GitHubReleaseAliasV1>);
const LANES = Object.freeze({ "candidate-branch": "candidate-branch", "draft-pr": "candidate-pull-request", "exact-sha-merge": "merge-exact-sha", "non-force-tag": "tag-immutable-ref" } as const);
const PREDECESSOR = Object.freeze({ "candidate-branch": null, "draft-pr": "candidate-branch", "exact-sha-merge": "draft-pr", "non-force-tag": "exact-sha-merge" } as const);
const TERMINAL = new Set(["candidate-verified", "pr-verified", "merge-verified", "tag-verified"]);
const CONFIRMED_PROVIDER_EFFECT_PHASES = new Set(["blob-created", "tree-created", "commit-created", "pr-created", "pr-ready-confirmed"]);
const POSSIBLE_PROVIDER_EFFECT_PHASES = new Set(["blob-intent", "tree-intent", "commit-intent", "branch-dispatching", "pr-dispatching", "pr-ready-dispatching", "merge-dispatching", "tag-dispatching"]);
const TRANSITIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  authorized: ["base-tree-observed", "pr-intent", "merge-intent", "tag-intent"], "base-tree-observed": ["blob-intent"], "blob-intent": ["blob-created", "expired-refused"], "blob-created": ["blob-intent", "tree-intent"], "tree-intent": ["tree-created", "expired-refused"], "tree-created": ["commit-intent"], "commit-intent": ["commit-created", "expired-refused"], "commit-created": ["branch-intent"], "branch-intent": ["branch-dispatching", "expired-refused"], "branch-dispatching": ["candidate-verified", "expired-refused"],
  "pr-intent": ["pr-dispatching", "expired-refused"], "pr-dispatching": ["pr-created", "expired-refused"], "pr-created": ["pr-ready-intent"], "pr-ready-intent": ["pr-ready-dispatching", "expired-refused"], "pr-ready-dispatching": ["pr-ready-confirmed", "expired-refused"], "pr-ready-confirmed": ["pr-verified"], "merge-intent": ["merge-dispatching", "expired-refused"], "merge-dispatching": ["merge-verified", "expired-refused"], "tag-intent": ["tag-dispatching", "expired-refused"], "tag-dispatching": ["tag-verified", "expired-refused"],
  "candidate-verified": ["receipt-published"], "pr-verified": ["receipt-published"], "merge-verified": ["receipt-published"], "tag-verified": ["receipt-published"],
});
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
class ProviderWriteAmbiguity extends Error {}
class ProviderTransportUncertainty extends Error {}
class ProviderDefinitiveRefusal extends TypeError {}
class ReleaseRunFailure extends Error { constructor(message: string, readonly effectPossible: boolean, readonly deterministic: boolean) { super(message); } }

export type GitHubReleaseAliasV1 = keyof typeof ALIASES;
export interface GitHubReleaseAuthorizationContextV1 { readonly authorization: VerifiedReleaseAuthorizationV1; readonly fileContents: readonly Readonly<{ path: string; bytesBase64: string }>[]; readonly hostedAuthority?: GitHubReleaseHostedAuthorityBindingV1 }
export interface GitHubReleasePullRequestV1 { readonly number: number; readonly head: string; readonly base: string; readonly draft: boolean; readonly title: string; readonly body: string; readonly headSha: string; readonly merged: boolean; readonly mergeCommitSha: string | null }
export interface GitHubReleaseProviderV1 {
  createBlob(input: Readonly<{ repository: string; contentBase64: string }>): Promise<unknown>;
  createTree(input: Readonly<{ repository: string; baseTreeSha: string; files: readonly Readonly<{ path: string; mode: string; blobSha: string }>[] }>): Promise<unknown>;
  createCommit(input: Readonly<Record<string, unknown>>): Promise<unknown>;
  getRef(input: Readonly<{ repository: string; ref: string }>): Promise<unknown>;
  createRef(input: Readonly<{ repository: string; ref: string; sha: string; force: false }>): Promise<unknown>;
  getCommit(input: Readonly<{ repository: string; sha: string }>): Promise<unknown>;
  findPullRequests(input: Readonly<Record<string, unknown>>): Promise<unknown>;
  createPullRequest(input: Readonly<Record<string, unknown>>): Promise<unknown>;
  markPullRequestReady(input: Readonly<{ repository: string; number: number }>): Promise<unknown>;
  getPullRequest(input: Readonly<{ repository: string; number: number }>): Promise<unknown>;
  getChecks(input: Readonly<{ repository: string; sha: string }>): Promise<unknown>;
  mergePullRequest(input: Readonly<Record<string, unknown>>): Promise<unknown>;
  npmVersionExists(input: Readonly<{ packageName: string; version: string }>): Promise<unknown>;
  readPackageManifest(input: Readonly<{ repository: string; sha: string }>): Promise<unknown>;
}
export interface GitHubReleaseProviderFaultV1 { readonly v: "reelier.github-release-provider-fault/v1"; readonly kind: "transport-uncertain" | "definitive-refusal"; readonly reason: string }
export interface GitHubReleaseRunRequestV1 { readonly alias: GitHubReleaseAliasV1; readonly allocationId: string; readonly authorizationHandle: string; readonly requestId: string; readonly semanticsDigest: string }
interface GitHubReleaseInvocationV1 { readonly alias: GitHubReleaseAliasV1; readonly authorizationHandle: string; readonly requestId: string; readonly semanticsDigest: string; readonly reviewedHost?: Readonly<{ account: string; destination: string; limit: string }> }
export interface GitHubReleaseRunResultV1 { readonly status: "verified" | "pending-reconciliation" | "refused"; readonly phase: string; readonly evidenceDigest: string | null }
export interface GitHubReleasePublicationConfirmationV1 { readonly requestId: string; readonly providerEvidenceDigest: string; readonly receiptRef: string; readonly receiptEvidenceDigest: string }
export interface GitHubReleaseRunnerV1 { run(input: GitHubReleaseRunRequestV1): Promise<GitHubReleaseRunResultV1>; recover(): Promise<readonly string[]> }

const publicationConfirmers = new WeakMap<GitHubReleaseRunnerV1, (input: GitHubReleasePublicationConfirmationV1) => Promise<void>>();
const authoritativeHeadConfirmers = new WeakMap<GitHubReleaseRunnerV1, (query: DurableDispatchPublicationQueryV1, head: DurableDispatchPublicationHeadV1) => Promise<boolean>>();
const runnerControllers = new WeakMap<GitHubReleaseRunnerV1, Readonly<{ execute(input: GitHubReleaseInvocationV1): Promise<GitHubReleaseRunResultV1>; reconcile(input: GitHubReleaseInvocationV1): Promise<GitHubReleaseRunResultV1>; recover(): Promise<readonly string[]> }>>();
const outcomeExecutors = new WeakMap<GitHubReleaseRunnerV1, TrustedEffectTransportExecutorV1>();

/** @internal Host composition brand check. Deliberately absent from the public package barrel. */
export function assertGitHubReleaseRunnerCapability(value: GitHubReleaseRunnerV1): void {
  if (!value || !runnerControllers.has(value) || !publicationConfirmers.has(value) || !authoritativeHeadConfirmers.has(value)) throw new TypeError("GitHub release runner capability is absent or unrecognized");
}

/** Adapts the reviewed candidate/PR/merge pack tools to the existing branded release saga.
 * The executor remains callback-only and carries no provider credential or release authority. */
export function createGitHubReleaseOutcomeExecutorV1(runner: GitHubReleaseRunnerV1): TrustedEffectTransportExecutorV1 {
  assertGitHubReleaseRunnerCapability(runner);
  const executor = outcomeExecutors.get(runner);
  if (!executor) throw new TypeError("GitHub release outcome executor capability is unavailable");
  return executor;
}

export async function createGitHubReleaseRunner(input: Readonly<{ rootDir: string; journalSigner: Readonly<{ signerId: string; privateKey: KeyObject; publicKey: KeyObject }>; evidenceSigner: ReleaseContractSignerV1; authorizationResolver: (handle: string) => Promise<GitHubReleaseAuthorizationContextV1 | VerifiedReleaseAuthorizationV1>; provider: GitHubReleaseProviderV1; now: () => Date }>): Promise<GitHubReleaseRunnerV1> {
  if (!path.isAbsolute(input.rootDir)) throw new TypeError("GitHub release runner root must be absolute");
  await mkdir(input.rootDir, { recursive: true });
  const journal = await createSignedJournal({ rootDir: path.join(input.rootDir, "journal"), journalId: "github-release", ...input.journalSigner });
  const provider = normalizeProvider(input.provider);
  const runOnce = async (invocation: GitHubReleaseInvocationV1, reconcileOnly = false): Promise<GitHubReleaseRunResultV1> => {
    validateInvocation(invocation);
    const resolved = await input.authorizationResolver(invocation.authorizationHandle);
    const context = normalizeContext(resolved);
    const authorization = context.authorization;
    assertVerifiedReleaseAuthorizationV1(authorization);
    if (invocation.reviewedHost) {
      try { assertReviewedHost(invocation.reviewedHost, authorization.operationPlan.value, invocation.semanticsDigest, authorization.authorization.value.packDigest); }
      catch (error) { if (error instanceof TypeError) return Object.freeze({ status: "refused", phase: "reviewed-policy-refused", evidenceDigest: null }); throw error; }
    }
    const hostedAuthorityBindingDigest = context.hostedAuthority ? assertGitHubReleaseHostedAuthorityBindingV1(context.hostedAuthority, authorization, input.now()) : null;
    const effect = ALIASES[invocation.alias];
    const allocation = authorization.authorization.value.effectAllocations.find(candidate => candidate.effect === effect);
    if (!allocation || allocation.maxEffects !== 1 || !DIGEST.test(allocation.allocationDigest)) throw new TypeError("release alias does not have the authenticated exact one-effect allocation");
    const request: GitHubReleaseRunRequestV1 = Object.freeze({ alias: invocation.alias, authorizationHandle: invocation.authorizationHandle, requestId: invocation.requestId, semanticsDigest: invocation.semanticsDigest, allocationId: allocation.allocationId });
    validateRequest(request);
    return journal.withLease(`authorization-${authorization.authorization.digest.slice(7)}`, async () => {
      let events = await journal.load(request.requestId);
      if (reconcileOnly && events.length === 0) throw new TypeError("release reconciliation requires a coordinator-dispatched journal intent");
      if (events.length > 0) {
        if (events[0].semanticsDigest !== request.semanticsDigest) throw new TypeError("release requestId semantic reuse is forbidden before dispatch");
        const root = events[0].data;
        if (root.alias !== request.alias || root.authorizationHandle !== request.authorizationHandle || root.authorizationDigest !== authorization.authorization.digest || root.allocationId !== allocation.allocationId || root.allocationDigest !== allocation.allocationDigest || root.effect !== effect || (root.hostedAuthorityBindingDigest ?? null) !== hostedAuthorityBindingDigest) throw new TypeError("release journal authority binding is inconsistent");
        const terminal = [...events].reverse().find(event => TERMINAL.has(event.phase));
        if (terminal) return Object.freeze({ status: "verified", phase: terminal.phase, evidenceDigest: String(terminal.data.evidenceDigest) });
        if (events.at(-1)?.phase === "expired-refused") throw new TypeError("release authorization expired after durable intent; provider dispatch is refused");
        if (events.at(-1)?.phase === "provider-refused") throw new TypeError("release provider definitive refusal is terminal for this request");
      } else {
        assertLive(authorization, input.now());
        if (effect === "candidate-branch") validateCandidate(context);
        await requirePredecessor(journal, authorization.authorization.digest, effect);
        for (const priorRequestId of await journal.listRequestIds()) {
          if (priorRequestId === request.requestId) continue;
          const first = (await journal.load(priorRequestId))[0];
          if (first?.data.authorizationDigest === authorization.authorization.digest && first.data.allocationId === allocation.allocationId) throw new TypeError("release one-effect allocation was already used by another request");
        }
        await journal.append(request.requestId, request.semanticsDigest, "authorized", { alias: request.alias, allocationDigest: allocation.allocationDigest, allocationId: allocation.allocationId, authorizationDigest: authorization.authorization.digest, authorizationHandle: request.authorizationHandle, effect, hostedAuthorityBindingDigest });
        events = await journal.load(request.requestId);
      }
      try {
        if (effect === "candidate-branch") return await candidate(request, context, events, journal, provider, input.evidenceSigner, input.now, hostedAuthorityBindingDigest);
        if (effect === "draft-pr") return await pullRequest(request, authorization, events, journal, provider, input.evidenceSigner, input.now, hostedAuthorityBindingDigest);
        if (effect === "exact-sha-merge") return await merge(request, authorization, events, journal, provider, input.evidenceSigner, input.now, hostedAuthorityBindingDigest);
        return await tag(request, authorization, events, journal, provider, input.evidenceSigner, input.now, hostedAuthorityBindingDigest);
      } catch (error) {
        const latest = await journal.load(request.requestId);
        if (error instanceof ProviderDefinitiveRefusal) {
          if (latest.at(-1)?.phase !== "provider-refused") await journal.append(request.requestId, request.semanticsDigest, "provider-refused", { reasonDigest: authorityDigest({ reason: error.message }) });
          throw new ReleaseRunFailure(`provider definitively refused release write: ${error.message}`, latest.some(event => CONFIRMED_PROVIDER_EFFECT_PHASES.has(event.phase)), true);
        }
        const effectPossible = latest.some(event => CONFIRMED_PROVIDER_EFFECT_PHASES.has(event.phase) || POSSIBLE_PROVIDER_EFFECT_PHASES.has(event.phase));
        throw new ReleaseRunFailure(error instanceof Error ? error.message : "release runner failed", effectPossible, error instanceof TypeError);
      }
    });
  };
  const active = new Map<string, Promise<GitHubReleaseRunResultV1>>();
  const run = (request: GitHubReleaseInvocationV1): Promise<GitHubReleaseRunResultV1> => {
    const key = `${request.alias}\0${request.authorizationHandle}\0${request.requestId}`;
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
      if (!events.some(event => event.phase.endsWith("-dispatching"))) continue;
      const result = await runOnce({ alias: first.data.alias as GitHubReleaseAliasV1, authorizationHandle: String(first.data.authorizationHandle), requestId, semanticsDigest: first.semanticsDigest }, true);
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
  const confirmAuthoritativeHead = async (query: DurableDispatchPublicationQueryV1, head: DurableDispatchPublicationHeadV1): Promise<boolean> => {
    if (!((head.phase === "dispatch" && head.terminalKind === "acknowledged") || (head.phase === "reconcile" && head.terminalKind === "reconciled"))) return false;
    const events = await journal.load(query.identity.reservationId);
    if (events.length === 0) return false;
    const first = events[0]!, alias = first.data.alias as GitHubReleaseAliasV1, effect = ALIASES[alias];
    if (!effect || first.semanticsDigest !== query.identity.effectDigest || first.data.allocationId === undefined || first.data.authorizationHandle === undefined || first.data.authorizationDigest === undefined || first.data.effect !== effect) throw new TypeError("release durable head request, semantics, or alias binding conflicts");
    const context = normalizeContext(await input.authorizationResolver(String(first.data.authorizationHandle))), authorization = context.authorization;
    assertVerifiedReleaseAuthorizationV1(authorization);
    if (authorization.authorization.digest !== first.data.authorizationDigest) throw new TypeError("release durable head authorization binding conflicts");
    const hostedAuthorityBindingDigest = context.hostedAuthority ? assertGitHubReleaseHostedAuthorityBindingV1(context.hostedAuthority, authorization, input.now()) : null;
    if ((first.data.hostedAuthorityBindingDigest ?? null) !== hostedAuthorityBindingDigest) throw new TypeError("release durable head hosted authority binding conflicts");
    const allocation = authorization.authorization.value.effectAllocations.find(candidate => candidate.effect === effect);
    if (!allocation || allocation.maxEffects !== 1 || allocation.allocationId !== first.data.allocationId || allocation.allocationDigest !== first.data.allocationDigest) throw new TypeError("release durable head allocation binding conflicts");
    const terminal = [...events].reverse().find(event => TERMINAL.has(event.phase));
    if (!terminal || !DIGEST.test(String(terminal.data.evidenceDigest ?? ""))) throw new TypeError("release durable head terminal evidence is absent");
    await confirmPublication({ requestId: normalizeReservationPublicationId(query.identity.reservationId), providerEvidenceDigest: String(terminal.data.evidenceDigest), receiptRef: head.receiptRef, receiptEvidenceDigest: head.evidenceDigest });
    return true;
  };
  const runner = Object.freeze({
    async run(_request: GitHubReleaseRunRequestV1): Promise<GitHubReleaseRunResultV1> { throw new TypeError("release provider execution requires the coordinator prepared-dispatch capability"); },
    async recover(): Promise<readonly string[]> { throw new TypeError("release recovery requires the coordinator reconciliation capability"); },
  });
  publicationConfirmers.set(runner, confirmPublication);
  authoritativeHeadConfirmers.set(runner, confirmAuthoritativeHead);
  runnerControllers.set(runner, Object.freeze({ execute: run, reconcile: request => runOnce(request, true), recover }));
  const tools = Object.freeze({
    github_release_candidate_publish_v1: Object.freeze({ alias: "github_release_candidate_publish_v1" as const, reconcile: false }),
    github_release_candidate_publish_readback_v1: Object.freeze({ alias: "github_release_candidate_publish_v1" as const, reconcile: true }),
    github_release_pr_ensure_v1: Object.freeze({ alias: "github_release_pr_ensure_v1" as const, reconcile: false }),
    github_release_pr_ensure_readback_v1: Object.freeze({ alias: "github_release_pr_ensure_v1" as const, reconcile: true }),
    github_release_pr_merge_v1: Object.freeze({ alias: "github_release_pr_merge_v1" as const, reconcile: false }),
    github_release_pr_merge_readback_v1: Object.freeze({ alias: "github_release_pr_merge_v1" as const, reconcile: true }),
  });
  const executor = mintTrustedEffectTransportExecutorV1({ mcp: {
    inspectSchemas(request, sink): void {
      try {
        if (request.server !== "reelier.github.outcomes") throw new TypeError("GitHub release pack server is invalid");
        sink.success(JSON.stringify({ serverSchemaDigest: GITHUB_RELEASE_OUTCOME_SERVER_SCHEMA_DIGEST_V1, toolSchemaDigest: githubReleaseOutcomeToolSchemaDigestV1(request.tool) }));
      } catch { sink.failure(); }
    },
    call(request, sink): void {
      let selected: (typeof tools)[keyof typeof tools], invocation: GitHubReleaseInvocationV1;
      try {
        if (request.server !== "reelier.github.outcomes" || request.serverSchemaDigest !== GITHUB_RELEASE_OUTCOME_SERVER_SCHEMA_DIGEST_V1 || request.toolSchemaDigest !== githubReleaseOutcomeToolSchemaDigestV1(request.tool)) throw new TypeError("GitHub release pack transport binding is invalid");
        selected = tools[request.tool as keyof typeof tools];
        if (!selected) throw new TypeError("GitHub release pack tool is not reviewed");
        if (request.authority.bindingDigest !== githubReleaseOutcomeBindingDigestV1(request.tool)) throw new TypeError("GitHub release pack compiler binding is invalid");
        if (!selected.reconcile && !consumeCoordinatorDispatchCallDelegateV1(request.authority, { reservationId: request.authority.reservationId, effectDigest: request.authority.governedEffectDigest })) throw new TypeError("GitHub release write requires the exact coordinator call capability");
        const model = exactRecord(request.arguments.model, ["authorizationHandle", "requestId"], "GitHub release pack model input");
        if (model.requestId !== request.authority.requestId) throw new TypeError("GitHub release pack authenticated request binding is invalid");
        invocation = Object.freeze({ alias: selected.alias, authorizationHandle: String(model.authorizationHandle), requestId: String(model.requestId), semanticsDigest: request.authority.contractDigest, reviewedHost: request.arguments.host });
        validateInvocation(invocation);
      } catch { sink.failure(); return; }
      const controller = runnerControllers.get(runner)!;
      const execute = selected.reconcile ? controller.reconcile(invocation) : controller.execute(invocation);
      void execute.then(async result => {
        try {
          if (result.status === "refused") { sink.success(JSON.stringify({ outcome: "refused", data: {} })); return; }
          const context = normalizeContext(await input.authorizationResolver(invocation.authorizationHandle)), plan = context.authorization.operationPlan.value;
          const events = await journal.load(invocation.requestId), mergeSha = String([...events].reverse().find(event => event.phase === "merge-verified")?.data.mergeSha ?? "");
          const number = Number([...events].reverse().find(event => event.phase === "pr-ready-confirmed")?.data.number ?? 0);
          const data = selected.alias === "github_release_candidate_publish_v1"
            ? { repository: plan.repository, baseSha: plan.baseCommit, headSha: plan.expectedCommitSha, candidateDigest: plan.candidateTreeDigest }
            : selected.alias === "github_release_pr_ensure_v1"
              ? { repository: plan.repository, baseBranch: plan.destinationBranch, headSha: plan.expectedCommitSha, pullRequest: number, ready: result.status === "verified" }
              : { repository: plan.repository, baseSha: plan.baseCommit, headSha: plan.expectedCommitSha, mergeCommitSha: mergeSha, treeSha: plan.expectedTreeSha };
          sink.success(JSON.stringify({ outcome: result.status === "verified" ? "applied" : result.status === "pending-reconciliation" ? "uncertain" : "refused", data }));
        } catch { sink.failure(); }
      }, error => {
        if (error instanceof TypeError || (error instanceof ReleaseRunFailure && error.deterministic)) sink.success(JSON.stringify({ outcome: "refused", data: {} }));
        else sink.failure();
      });
    },
  } });
  outcomeExecutors.set(runner, executor);
  return runner;
}

/** Routes only the four reviewed release endpoints through the dedicated saga. The ordinary
 * coordinator still performs the actual allocation consumption and receipt publication. */
function createGitHubReleaseDispatchAdapter(input: Readonly<{ runner: GitHubReleaseRunnerV1 | null; fallback: DispatchAdapter }>): DispatchAdapter {
  const invoke = async (state: DispatchRequestState, reconcileOnly = false): Promise<DispatchOutcome | null> => {
    const endpointId = inertEndpointId(state.effect);
    const alias = endpointId ? ENDPOINTS[endpointId] : undefined;
    if (!alias) return null;
    if (!input.runner) return failure("dedicated-release-runner-absent");
    const controller = runnerControllers.get(input.runner);
    if (!controller) return failure("dedicated-release-runner-capability-absent");
    const effect = exactRecord(state.effect, ["bodyBase64", "endpointId", "headers", "idempotency", "method", "path", "preconditions", "query", "reconciliation", "riskClass", "v"], "release transport effect");
    const execution = state.reservation.intent.executionContext;
    if (!execution) return failure("release-allocation-context-absent");
    let body: Record<string, unknown>;
    try { body = exactRecord(JSON.parse(Buffer.from(String(effect.bodyBase64), "base64").toString("utf8")), ["authorizationHandle"], "release dispatch body"); }
    catch { return failure("release-dispatch-body-invalid"); }
    try {
      const request = { alias, authorizationHandle: String(body.authorizationHandle), requestId: normalizeReservationPublicationId(state.reservation.reservationId), semanticsDigest: state.effectDigest };
      // The coordinator minted the reconciliation stamp with the RAW ledger id, so it is checked raw.
      if (reconcileOnly) consumeCoordinatorReconciliation(state, { reservationId: state.reservation.reservationId, allocationId: execution.allocationId, effectDigest: request.semanticsDigest });
      const result = reconcileOnly ? await controller.reconcile(request) : await controller.execute(request);
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
    ...(input.runner || input.fallback.prepare ? { async prepare(state: DispatchRequestState, call?: import("./dispatch.js").CoordinatorDispatchCallV1) {
      const endpointId = inertEndpointId(state.effect) ?? "";
      const alias = ENDPOINTS[endpointId];
      if (!alias) {
        if (!input.fallback.prepare) throw new TypeError("fallback prepared dispatch is unavailable");
        return input.fallback.prepare(state, call);
      }
      const intent = state.reservation.intent as unknown as Record<string, unknown>;
      const execution = intent.executionContext as Readonly<{ allocationId?: unknown }> | undefined;
      const authorityGeneration = intent.authorityStateDigest;
      const authorityExpiresAt = intent.expiresAt;
      if (!execution || typeof execution.allocationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$/.test(execution.allocationId) || typeof authorityGeneration !== "string" || !DIGEST.test(authorityGeneration) || typeof authorityExpiresAt !== "string" || !Number.isFinite(Date.parse(authorityExpiresAt))) throw new TypeError("release prepared dispatch authority binding is invalid");
      const effect = exactRecord(state.effect, ["bodyBase64", "endpointId", "headers", "idempotency", "method", "path", "preconditions", "query", "reconciliation", "riskClass", "v"], "release transport effect");
      const bodyBase64 = String(effect.bodyBase64), body = Buffer.from(bodyBase64, "base64");
      if (body.length === 0 || body.toString("base64") !== bodyBase64) throw new TypeError("release prepared dispatch body is not canonical base64");
      const projection = Object.freeze({ v: "reelier.materialized-http-request/v1" as const, method: "POST" as const, origin: "https://reelier.authority-cell.internal", normalizedPath: "/internal/github-release", normalizedQuery: "", reviewedHeaders: Object.freeze({ "content-type": "application/json" }), bodyDigest: `sha256:${createHash("sha256").update(body).digest("hex")}` });
      const routeDigest = authorityDigest({ v: "reelier.github-release-internal-route/v1", alias, endpointId });
      const description = Object.freeze({ v: "reelier.prepared-dispatch-description/v1" as const, routeDigest, materializedRequestDigest: materializedHttpRequestDigest(projection), projection, authorityGeneration, authorityExpiresAt, absoluteDeadlineMs: performance.now() + 30_000, reservationId: state.reservation.reservationId, allocationId: execution.allocationId, behaviorDigest: authorityDigest({ v: "reelier.github-release-internal-behavior/v1", alias, routeDigest }) });
      return createPreparedDispatch({ description, send: async () => await invoke(state) ?? failure("dedicated-release-runner-absent"), requireCoordinatorCommit: true });
    } } : {}),
    async dispatch(state: DispatchRequestState) { if (ENDPOINTS[inertEndpointId(state.effect) ?? ""]) return failure("release-provider-execution-requires-prepared-dispatch"); return input.fallback.dispatch(state); },
    async reconcile(state: DispatchRequestState, outcome: DispatchOutcome) { return await invoke(state, true) ?? (input.fallback.reconcile ? input.fallback.reconcile(state, outcome) : outcome); },
  });
}

/** Confirms the ordinary coordinator's durable receipt only after its configured publication
 * succeeds. Later release effects require this confirmation, not provider evidence alone. */
function createGitHubReleaseReceiptPublication(input: Readonly<{ runner: GitHubReleaseRunnerV1; publication: DispatchPublication }>): DispatchPublication {
  const confirmPublication = publicationConfirmers.get(input.runner);
  const confirmAuthoritativeHead = authoritativeHeadConfirmers.get(input.runner);
  if (!confirmPublication || !confirmAuthoritativeHead) throw new TypeError("release runner publication capability is unavailable");
  if (!input.publication.publishReservation || !input.publication.loadDurableHead) throw new TypeError("release receipt confirmation requires an authoritative durable publication head");
  const identities = new Map<string, Readonly<{ identity: any; reservationReceiptRef: string }>>();
  return Object.freeze({
    async publishReservation(value: Parameters<NonNullable<DispatchPublication["publishReservation"]>>[0]) {
      consumeCoordinatorPublicationCall(value as object, { phase: value.phase, reservationId: value.state.reservation.reservationId, effectDigest: value.state.effectDigest });
      const published = await input.publication.publishReservation!(value);
      // The root publication's own readback: the terminal receipt cannot exist yet, and the assertion
      // below is what pins this head to the reservation phase.
      const head = await input.publication.loadDurableHead!({ v: "reelier.durable-dispatch-publication-query/v1", identity: value.identity, ledgerState: "dispatched", sendStarted: true }, "root-or-terminal");
      if (!head || head.phase !== "reservation" || head.terminalKind !== null || head.receiptRef !== published.receiptRef || head.evidenceDigest !== published.evidenceDigest || head.reservationReceiptRef !== published.receiptRef || head.priorReceiptRef !== null || authorityDigest(head.identity) !== authorityDigest(value.identity)) throw new TypeError("release reservation receipt is not the authoritative durable head");
      identities.set(normalizeReservationPublicationId(value.state.reservation.reservationId), Object.freeze({ identity: value.identity, reservationReceiptRef: published.receiptRef }));
      return published;
    },
    async loadDurableHead(query: Parameters<NonNullable<DispatchPublication["loadDurableHead"]>>[0], expect: Parameters<NonNullable<DispatchPublication["loadDurableHead"]>>[1]) {
      const head = await input.publication.loadDurableHead!(query, expect);
      if (head) {
        if (authorityDigest(head.identity) !== authorityDigest(query.identity)) throw new TypeError("release durable publication head identity conflicts");
        identities.set(normalizeReservationPublicationId(query.identity.reservationId), Object.freeze({ identity: query.identity, reservationReceiptRef: head.reservationReceiptRef }));
        await confirmAuthoritativeHead(query, head);
      }
      return head;
    },
    async publish(value: Parameters<DispatchPublication["publish"]>[0]) {
      consumeCoordinatorPublicationCall(value as object, { phase: value.phase, reservationId: value.state.reservation.reservationId, effectDigest: value.state.effectDigest });
      const published = await input.publication.publish(value);
      const effect = isPlain(value.state.effect) ? value.state.effect : null;
      if ((value.phase === "dispatch" || value.phase === "reconcile") && value.outcome.kind === "acknowledged" && effect && typeof effect.endpointId === "string" && ENDPOINTS[effect.endpointId]) {
        const durable = identities.get(normalizeReservationPublicationId(value.state.reservation.reservationId));
        if (!durable) throw new TypeError("release receipt authoritative identity is absent");
        const head = await input.publication.loadDurableHead!({ v: "reelier.durable-dispatch-publication-query/v1", identity: durable.identity, ledgerState: value.phase === "dispatch" ? "dispatched" : "ambiguous", sendStarted: true }, "terminal");
        const terminalKind = value.phase === "dispatch" ? "acknowledged" : "reconciled";
        if (!head || head.phase !== value.phase || head.terminalKind !== terminalKind || head.receiptRef !== published.receiptRef || head.evidenceDigest !== published.evidenceDigest || head.reservationReceiptRef !== durable.reservationReceiptRef || head.priorReceiptRef !== (value.priorReceiptDigest ?? null) || authorityDigest(head.identity) !== authorityDigest(durable.identity)) throw new TypeError("release receipt publication is not the authoritative durable head");
        await confirmPublication({ requestId: normalizeReservationPublicationId(value.state.reservation.reservationId), providerEvidenceDigest: value.outcome.resultDigest, receiptRef: published.receiptRef, receiptEvidenceDigest: published.evidenceDigest });
      }
      return published;
    },
  });
}

/** @internal Local-host composition seam. Deliberately absent from the public package barrel. */
export function createGitHubReleaseHostComposition(input: Readonly<{ runner: GitHubReleaseRunnerV1 | null; fallback: DispatchAdapter; publication: DispatchPublication }>): Readonly<{ adapter: DispatchAdapter; publication: DispatchPublication }> {
  return Object.freeze({
    adapter: createGitHubReleaseDispatchAdapter({ runner: input.runner, fallback: input.fallback }),
    publication: input.runner ? createGitHubReleaseReceiptPublication({ runner: input.runner, publication: input.publication }) : input.publication,
  });
}

async function candidate(request: GitHubReleaseRunRequestV1, context: GitHubReleaseAuthorizationContextV1, initial: readonly SignedJournalEventV1[], journal: SignedJournal, provider: GitHubReleaseProviderV1, signer: ReleaseContractSignerV1, now: () => Date, hostedAuthorityBindingDigest: string | null): Promise<GitHubReleaseRunResultV1> {
  const auth = context.authorization, plan = auth.operationPlan.value, byPath = new Map(context.fileContents.map(file => [file.path, file.bytesBase64]));
  const refName = `heads/${plan.candidateBranch}`;
  const base = parseRef(await provider.getRef({ repository: plan.repository, ref: `heads/${plan.destinationBranch}` }));
  if (!base || base.sha !== plan.baseCommit) throw new TypeError("candidate publication base branch drifted");
  const baseCommit = parseCommit(await provider.getCommit({ repository: plan.repository, sha: plan.baseCommit }));
  if (!baseCommit || baseCommit.sha !== plan.baseCommit || baseCommit.treeSha !== plan.baseTreeSha) throw new TypeError("candidate publication base tree drifted");
  await step(journal, request, "base-tree-observed", { commitSha: plan.baseCommit, treeSha: plan.baseTreeSha });
  const before = parseRef(await provider.getRef({ repository: plan.repository, ref: refName }));
  if (before && before.sha !== plan.expectedCommitSha) throw new TypeError("candidate branch ref conflicts with authorization");
  if (before && !has(initial, "branch-intent")) throw new TypeError("candidate branch exists without this authorized write intent");
  if (before && has(initial, "branch-intent") && !has(initial, "branch-dispatching")) throw new TypeError("candidate branch appeared after intent but before the authorized dispatching boundary");
  for (let index = 0; index < plan.files.length; index += 1) {
    const file = plan.files[index], bytesBase64 = byPath.get(file.path)!;
    if (!has(initial, "blob-created", "index", index)) { assertWriteLive(auth, now); await step(journal, request, "blob-intent", { index, path: file.path }); await assertPostIntentLive(journal, request, auth, now); await assertBaseRef(provider, plan, plan.baseCommit); await assertPostIntentLive(journal, request, auth, now); const result = await providerWrite(() => provider.createBlob({ repository: plan.repository, contentBase64: bytesBase64 }), raw => parseSha(raw, "blob")); if (result.sha !== file.blobSha) throw new TypeError("provider blob readback does not match expected Git SHA"); await step(journal, request, "blob-created", { index, sha: result.sha }); }
  }
  let events = await journal.load(request.requestId);
  if (!has(events, "tree-created")) { assertWriteLive(auth, now); await step(journal, request, "tree-intent", {}); await assertPostIntentLive(journal, request, auth, now); await assertBaseRef(provider, plan, plan.baseCommit); await assertPostIntentLive(journal, request, auth, now); const tree = await providerWrite(() => provider.createTree({ repository: plan.repository, baseTreeSha: plan.baseTreeSha, files: plan.files.map(file => ({ path: file.path, mode: file.mode, blobSha: file.blobSha })) }), raw => parseSha(raw, "tree")); if (tree.sha !== plan.expectedTreeSha) throw new TypeError("provider tree SHA is not authorized"); await step(journal, request, "tree-created", { sha: tree.sha }); }
  events = await journal.load(request.requestId);
  if (!has(events, "commit-created")) { assertWriteLive(auth, now); await step(journal, request, "commit-intent", {}); await assertPostIntentLive(journal, request, auth, now); await assertBaseRef(provider, plan, plan.baseCommit); await assertPostIntentLive(journal, request, auth, now); const commit = await providerWrite(() => provider.createCommit({ repository: plan.repository, treeSha: plan.expectedTreeSha, ...plan.commit }), raw => parseSha(raw, "commit")); if (commit.sha !== plan.expectedCommitSha) throw new TypeError("provider commit SHA is not authorized"); await step(journal, request, "commit-created", { sha: commit.sha }); }
  events = await journal.load(request.requestId);
  let existing = parseRef(await provider.getRef({ repository: plan.repository, ref: refName }));
  if (!existing) {
    if (has(events, "branch-dispatching")) return pending("branch-dispatching");
    if (!has(events, "branch-intent")) { assertWriteLive(auth, now); await step(journal, request, "branch-intent", {}); }
    await assertPostIntentLive(journal, request, auth, now); await assertBaseRef(provider, plan, plan.baseCommit);
    const atWrite = parseRef(await provider.getRef({ repository: plan.repository, ref: refName }));
    if (atWrite && atWrite.sha !== plan.expectedCommitSha) throw new TypeError("candidate branch ref drifted immediately before provider write");
    if (!atWrite) { await step(journal, request, "branch-dispatching", {}); await assertPostIntentLive(journal, request, auth, now); await assertBaseRef(provider, plan, plan.baseCommit); const finalRef = parseRef(await provider.getRef({ repository: plan.repository, ref: refName })); if (finalRef) throw new TypeError("candidate branch appeared immediately before provider write"); await assertPostIntentLive(journal, request, auth, now); await consequentialWrite(() => provider.createRef({ repository: plan.repository, ref: refName, sha: plan.expectedCommitSha, force: false }), raw => parseSha(raw, "created ref")); }
    existing = await safeRead(() => provider.getRef({ repository: plan.repository, ref: refName }), parseRef);
  }
  if (!existing || existing.sha !== plan.expectedCommitSha) return pending("branch-intent");
  const commit = parseCommit(await provider.getCommit({ repository: plan.repository, sha: plan.expectedCommitSha }));
  if (!commit || commit.parentSha !== plan.baseCommit || commit.treeSha !== plan.expectedTreeSha) throw new TypeError("candidate commit parent or tree readback is tampered");
  return finish(journal, request, auth, "candidate-branch", "candidate-verified", authorityDigest({ ref: existing, commit }), signer, now(), {}, hostedAuthorityBindingDigest);
}

async function pullRequest(request: GitHubReleaseRunRequestV1, auth: VerifiedReleaseAuthorizationV1, events: readonly SignedJournalEventV1[], journal: SignedJournal, provider: GitHubReleaseProviderV1, signer: ReleaseContractSignerV1, now: () => Date, hostedAuthorityBindingDigest: string | null): Promise<GitHubReleaseRunResultV1> {
  const plan = auth.operationPlan.value;
  const base = parseRef(await provider.getRef({ repository: plan.repository, ref: `heads/${plan.destinationBranch}` }));
  const branch = parseRef(await provider.getRef({ repository: plan.repository, ref: `heads/${plan.candidateBranch}` }));
  if (!base || base.sha !== plan.baseCommit || !branch || branch.sha !== plan.expectedCommitSha) throw new TypeError("pull request base or candidate ref drifted");
  let matches = parsePullRequests(await provider.findPullRequests({ repository: plan.repository, head: plan.pullRequest.head, base: plan.pullRequest.base }));
  if (matches.length > 1) throw new TypeError("multiple release pull requests conflict");
  if (matches.length === 1 && has(events, "pr-intent") && !has(events, "pr-dispatching")) throw new TypeError("pull request appeared after intent but before the authorized dispatching boundary");
  if (matches.length === 0) {
    if (has(events, "pr-dispatching")) return pending("pr-dispatching");
    if (!has(events, "pr-intent")) { assertWriteLive(auth, now); await step(journal, request, "pr-intent", {}); }
    await assertPostIntentLive(journal, request, auth, now); await assertBaseRef(provider, plan, plan.baseCommit, true);
    const atWrite = parsePullRequests(await provider.findPullRequests({ repository: plan.repository, head: plan.pullRequest.head, base: plan.pullRequest.base }));
    if (atWrite.length > 1) throw new TypeError("multiple release pull requests conflict immediately before create");
    if (atWrite.length === 0) { await step(journal, request, "pr-dispatching", {}); await assertPostIntentLive(journal, request, auth, now); await assertBaseRef(provider, plan, plan.baseCommit, true); const finalMatches = parsePullRequests(await provider.findPullRequests({ repository: plan.repository, head: plan.pullRequest.head, base: plan.pullRequest.base })); if (finalMatches.length !== 0) throw new TypeError("release pull request appeared immediately before provider write"); await assertPostIntentLive(journal, request, auth, now); await consequentialWrite(() => provider.createPullRequest({ repository: plan.repository, ...plan.pullRequest }), parsePullRequest); }
    matches = await safeRead(() => provider.findPullRequests({ repository: plan.repository, head: plan.pullRequest.head, base: plan.pullRequest.base }), parsePullRequests) ?? [];
    if (matches.length === 0) return pending("pr-intent");
    if (matches.length > 1) throw new TypeError("multiple release pull requests conflict after ambiguous create");
    await step(journal, request, "pr-created", { number: matches[0]!.number });
  } else if (!has(events, "pr-intent")) throw new TypeError("pull request exists without this authorized write intent");
  if (!has(await journal.load(request.requestId), "pr-created")) await step(journal, request, "pr-created", { number: matches[0]!.number });
  let pr = matches[0]!; assertPullRequestPlan(pr, plan, pr.draft);
  if (!pr.draft && has(await journal.load(request.requestId), "pr-ready-intent") && !has(await journal.load(request.requestId), "pr-ready-dispatching")) throw new TypeError("pull request became ready after intent but before the authorized dispatching boundary");
  if (pr.draft) {
    const currentEvents = await journal.load(request.requestId);
    if (has(currentEvents, "pr-ready-dispatching")) return pending("pr-ready-dispatching");
    if (plan.pullRequest.readyForReview !== true) throw new TypeError("pull request ready transition is not authorized");
    if (!has(currentEvents, "pr-ready-intent")) await step(journal, request, "pr-ready-intent", { number: pr.number, readyForReview: true });
    await assertPostIntentLive(journal, request, auth, now); await assertBaseRef(provider, plan, plan.baseCommit, true);
    const atWrite = parsePullRequest(await provider.getPullRequest({ repository: plan.repository, number: pr.number }));
    assertPullRequestPlan(atWrite, plan, atWrite.draft);
    if (atWrite.draft) { await step(journal, request, "pr-ready-dispatching", { number: pr.number }); await assertPostIntentLive(journal, request, auth, now); await assertBaseRef(provider, plan, plan.baseCommit, true); const finalPr = parsePullRequest(await provider.getPullRequest({ repository: plan.repository, number: pr.number })); assertPullRequestPlan(finalPr, plan, true); await assertPostIntentLive(journal, request, auth, now); await consequentialWrite(() => provider.markPullRequestReady({ repository: plan.repository, number: pr.number }), parsePullRequest); }
    pr = await safeRead(() => provider.getPullRequest({ repository: plan.repository, number: pr.number }), parsePullRequest) ?? pr;
  } else if (!has(await journal.load(request.requestId), "pr-ready-intent")) throw new TypeError("pull request became ready without this authorized transition");
  if (pr.draft) return pending("pr-ready-intent");
  assertPullRequestPlan(pr, plan, false);
  await step(journal, request, "pr-ready-confirmed", { number: pr.number });
  return finish(journal, request, auth, "candidate-pull-request", "pr-verified", authorityDigest(pr), signer, now(), {}, hostedAuthorityBindingDigest);
}

async function merge(request: GitHubReleaseRunRequestV1, auth: VerifiedReleaseAuthorizationV1, events: readonly SignedJournalEventV1[], journal: SignedJournal, provider: GitHubReleaseProviderV1, signer: ReleaseContractSignerV1, now: () => Date, hostedAuthorityBindingDigest: string | null): Promise<GitHubReleaseRunResultV1> {
  const plan = auth.operationPlan.value;
  const matches = parsePullRequests(await provider.findPullRequests({ repository: plan.repository, head: plan.pullRequest.head, base: plan.pullRequest.base }));
  if (matches.length !== 1) throw new TypeError("release merge requires exactly one pull request");
  let pr = matches[0]!; assertPullRequestPlan(pr, plan, false);
  if (pr.merged && has(events, "merge-intent") && !has(events, "merge-dispatching")) throw new TypeError("pull request was merged after intent but before the authorized dispatching boundary");
  let mergeSha: string | null = null;
  if (!pr.merged) {
    const base = parseRef(await provider.getRef({ repository: plan.repository, ref: `heads/${plan.destinationBranch}` }));
    if (!base || base.sha !== plan.baseCommit) throw new TypeError("release base branch drifted");
    const checks = parseChecks(await provider.getChecks({ repository: plan.repository, sha: plan.expectedCommitSha }));
    assertChecks(checks, plan);
    if (has(events, "merge-dispatching")) return pending("merge-dispatching");
    if (!has(events, "merge-intent")) { assertWriteLive(auth, now); await step(journal, request, "merge-intent", {}); }
    await assertPostIntentLive(journal, request, auth, now); await assertBaseRef(provider, plan, plan.baseCommit, true);
    const atWritePr = parsePullRequest(await provider.getPullRequest({ repository: plan.repository, number: pr.number })); assertPullRequestPlan(atWritePr, plan, false); if (atWritePr.merged) throw new TypeError("pull request merge state changed immediately before authorized write");
    const atWriteChecks = parseChecks(await provider.getChecks({ repository: plan.repository, sha: plan.expectedCommitSha })); assertChecks(atWriteChecks, plan);
    await step(journal, request, "merge-dispatching", { number: pr.number }); await assertPostIntentLive(journal, request, auth, now); await assertBaseRef(provider, plan, plan.baseCommit, true); const finalPr = parsePullRequest(await provider.getPullRequest({ repository: plan.repository, number: pr.number })); assertPullRequestPlan(finalPr, plan, false); if (finalPr.merged) throw new TypeError("pull request merged immediately before authorized write"); assertChecks(parseChecks(await provider.getChecks({ repository: plan.repository, sha: plan.expectedCommitSha })), plan); await assertPostIntentLive(journal, request, auth, now);
    const result = await consequentialWrite(() => provider.mergePullRequest({ repository: plan.repository, number: pr.number, expectedHeadSha: plan.expectedCommitSha, method: "squash", ...plan.squash }), parseMerge); if (result?.merged) mergeSha = result.sha;
    pr = await safeRead(() => provider.getPullRequest({ repository: plan.repository, number: pr.number }), parsePullRequest) ?? pr;
  } else if (!has(events, "merge-intent")) throw new TypeError("pull request was merged without this authorized write intent");
  mergeSha ??= pr.mergeCommitSha;
  if (!mergeSha || !GIT_SHA.test(mergeSha) || !pr.merged || pr.mergeCommitSha !== mergeSha) return pending("merge-intent");
  const main = await safeRead(() => provider.getRef({ repository: plan.repository, ref: `heads/${plan.destinationBranch}` }), parseRef);
  if (!main || main.sha !== mergeSha) return pending("merge-intent");
  const commit = parseCommit(await provider.getCommit({ repository: plan.repository, sha: mergeSha }));
  if (!commit || commit.parentSha !== plan.baseCommit || commit.treeSha !== plan.expectedTreeSha) throw new TypeError("squash commit parent or tree readback is tampered");
  return finish(journal, request, auth, "merge-exact-sha", "merge-verified", authorityDigest({ pr, main, commit }), signer, now(), { mergeSha }, hostedAuthorityBindingDigest);
}

async function tag(request: GitHubReleaseRunRequestV1, auth: VerifiedReleaseAuthorizationV1, events: readonly SignedJournalEventV1[], journal: SignedJournal, provider: GitHubReleaseProviderV1, signer: ReleaseContractSignerV1, now: () => Date, hostedAuthorityBindingDigest: string | null): Promise<GitHubReleaseRunResultV1> {
  const plan = auth.operationPlan.value, predecessor = await requirePredecessor(journal, auth.authorization.digest, "non-force-tag"), mergeSha = String(predecessor.data.mergeSha ?? "");
  if (!GIT_SHA.test(mergeSha)) throw new TypeError("verified merge predecessor lacks an authoritative merge SHA");
  const main = parseRef(await provider.getRef({ repository: plan.repository, ref: `heads/${plan.destinationBranch}` }));
  if (!main || main.sha !== mergeSha) throw new TypeError("release main ref does not match reconciled squash commit");
  const ref = `tags/${plan.tag}`;
  let existing = parseRef(await provider.getRef({ repository: plan.repository, ref }));
  if (existing && existing.sha !== mergeSha) throw new TypeError("release tag ref conflicts");
  if (existing && !has(events, "tag-intent")) throw new TypeError("release tag exists without this authorized write intent");
  if (existing && has(events, "tag-intent") && !has(events, "tag-dispatching")) throw new TypeError("release tag appeared after intent but before the authorized dispatching boundary");
  const manifest = parseManifest(await provider.readPackageManifest({ repository: plan.repository, sha: mergeSha }));
  if (manifest.name !== plan.npmPreflight.packageName || manifest.version !== plan.npmPreflight.version) throw new TypeError("release package name or version mismatch");
  if (existing && has(events, "tag-dispatching")) return finish(journal, request, auth, "tag-immutable-ref", "tag-verified", authorityDigest({ tagged: existing, manifest, npmVersionAbsentAtDispatch: true, mergeSha }), signer, now(), { mergeSha }, hostedAuthorityBindingDigest);
  if (parseBoolean(await provider.npmVersionExists({ packageName: manifest.name, version: manifest.version }), "npm version state")) throw new TypeError("release npm version already exists");
  if (!existing) {
    if (has(events, "tag-dispatching")) return pending("tag-dispatching");
    if (!has(events, "tag-intent")) { assertWriteLive(auth, now); await step(journal, request, "tag-intent", { npmVersionAbsent: true, packageName: manifest.name, packageVersion: manifest.version }); }
    await assertPostIntentLive(journal, request, auth, now); await assertBaseRef(provider, plan, mergeSha);
    const atIntentManifest = parseManifest(await provider.readPackageManifest({ repository: plan.repository, sha: mergeSha }));
    if (atIntentManifest.name !== plan.npmPreflight.packageName || atIntentManifest.version !== plan.npmPreflight.version) throw new TypeError("release package name or version changed after tag intent");
    if (parseBoolean(await provider.npmVersionExists({ packageName: atIntentManifest.name, version: atIntentManifest.version }), "npm version state")) throw new TypeError("release npm version appeared after tag intent");
    const atWrite = parseRef(await provider.getRef({ repository: plan.repository, ref }));
    if (atWrite && atWrite.sha !== mergeSha) throw new TypeError("release tag drifted immediately before provider write");
    if (!atWrite) { await step(journal, request, "tag-dispatching", {}); await assertPostIntentLive(journal, request, auth, now); await assertBaseRef(provider, plan, mergeSha); const finalTag = parseRef(await provider.getRef({ repository: plan.repository, ref })); if (finalTag) throw new TypeError("release tag appeared immediately before provider write"); const finalManifest = parseManifest(await provider.readPackageManifest({ repository: plan.repository, sha: mergeSha })); if (finalManifest.name !== plan.npmPreflight.packageName || finalManifest.version !== plan.npmPreflight.version || parseBoolean(await provider.npmVersionExists({ packageName: finalManifest.name, version: finalManifest.version }), "npm version state")) throw new TypeError("release package or npm state changed immediately before tag write"); await assertPostIntentLive(journal, request, auth, now); await consequentialWrite(() => provider.createRef({ repository: plan.repository, ref, sha: mergeSha, force: false }), raw => parseSha(raw, "created tag")); }
    existing = await safeRead(() => provider.getRef({ repository: plan.repository, ref }), parseRef);
  }
  if (!existing || existing.sha !== mergeSha) return pending("tag-intent");
  return finish(journal, request, auth, "tag-immutable-ref", "tag-verified", authorityDigest({ tagged: existing, manifest, npmVersionAbsentAtDispatch: true, mergeSha }), signer, now(), { mergeSha }, hostedAuthorityBindingDigest);
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
function normalizeContext(value: GitHubReleaseAuthorizationContextV1 | VerifiedReleaseAuthorizationV1): GitHubReleaseAuthorizationContextV1 { if (isPlain(value) && (["authorization", "fileContents"].sort().join("\0") === Object.keys(value).sort().join("\0") || ["authorization", "fileContents", "hostedAuthority"].sort().join("\0") === Object.keys(value).sort().join("\0"))) { const hasHostedAuthority = Object.prototype.hasOwnProperty.call(value, "hostedAuthority"); const context = exactRecord(value, hasHostedAuthority ? ["authorization", "fileContents", "hostedAuthority"] : ["authorization", "fileContents"], "release authorization context"); return Object.freeze({ authorization: context.authorization as VerifiedReleaseAuthorizationV1, fileContents: inertArray(context.fileContents, "release candidate file array") as readonly Readonly<{ path: string; bytesBase64: string }>[], ...(hasHostedAuthority ? { hostedAuthority: context.hostedAuthority as GitHubReleaseHostedAuthorityBindingV1 } : {}) }); } return Object.freeze({ authorization: value as VerifiedReleaseAuthorizationV1, fileContents: Object.freeze([]) }); }
function assertLive(auth: VerifiedReleaseAuthorizationV1, now: Date): void { if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || now.getTime() < Date.parse(auth.authorization.value.issuedAt) || now.getTime() >= Date.parse(auth.authorization.value.expiresAt)) throw new TypeError("release authorization is stale or clock is invalid"); }
function assertWriteLive(auth: VerifiedReleaseAuthorizationV1, now: () => Date): void { assertLive(auth, now()); }
async function assertPostIntentLive(journal: SignedJournal, request: GitHubReleaseRunRequestV1, auth: VerifiedReleaseAuthorizationV1, now: () => Date): Promise<void> { try { assertWriteLive(auth, now); } catch (error) { await step(journal, request, "expired-refused", { observedAt: safeNowIso(now) }); throw error; } }
function safeNowIso(now: () => Date): string { try { const value = now(); return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : "invalid-clock"; } catch { return "invalid-clock"; } }
async function assertBaseRef(provider: GitHubReleaseProviderV1, plan: VerifiedReleaseAuthorizationV1["operationPlan"]["value"], expectedBase: string, requireCandidate = false): Promise<void> { const base = parseRef(await provider.getRef({ repository: plan.repository, ref: `heads/${plan.destinationBranch}` })); if (!base || base.sha !== expectedBase) throw new TypeError("release base branch drifted immediately before provider write"); if (requireCandidate) { const branch = parseRef(await provider.getRef({ repository: plan.repository, ref: `heads/${plan.candidateBranch}` })); if (!branch || branch.sha !== plan.expectedCommitSha) throw new TypeError("release candidate branch drifted immediately before provider write"); } }
async function finish(journal: SignedJournal, request: GitHubReleaseRunRequestV1, auth: VerifiedReleaseAuthorizationV1, lane: keyof typeof LANES extends never ? never : any, phase: string, subjectDigest: string, signer: ReleaseContractSignerV1, now: Date, extra: Readonly<Record<string, unknown>> = {}, hostedAuthorityBindingDigest: string | null = null): Promise<GitHubReleaseRunResultV1> { const boundSubjectDigest = hostedAuthorityBindingDigest ? authorityDigest({ v: "reelier.github-release-provider-readback/v1", hostedAuthorityBindingDigest, providerReadbackDigest: subjectDigest }) : subjectDigest; const evidence = createGitHubReleaseProviderEvidence({ authorization: auth, lane, observedAt: now.toISOString(), subjectDigest: boundSubjectDigest, signer }); await step(journal, request, phase, { ...extra, evidence, evidenceDigest: evidence.digest, hostedAuthorityBindingDigest, subjectDigest: boundSubjectDigest }); return Object.freeze({ status: "verified", phase, evidenceDigest: evidence.digest }); }
async function step(journal: SignedJournal, request: GitHubReleaseRunRequestV1, phase: string, data: Readonly<Record<string, unknown>>): Promise<void> { const events = await journal.load(request.requestId), prior = events.at(-1)?.phase; if (!prior || !TRANSITIONS[prior]?.includes(phase)) { if (events.some(event => event.phase === phase && authorityDigest(event.data) === authorityDigest(data))) return; throw new TypeError(`invalid release saga transition ${prior ?? "absent"} -> ${phase}`); } await journal.append(request.requestId, request.semanticsDigest, phase, data); }
function has(events: readonly SignedJournalEventV1[], phase: string, key?: string, value?: unknown): boolean { return events.some(event => event.phase === phase && (key === undefined || event.data[key] === value)); }
function pending(phase: string): GitHubReleaseRunResultV1 { return Object.freeze({ status: "pending-reconciliation", phase, evidenceDigest: null }); }
function failure(reason: string, reconciliationStatus: "not-applied" | "conflict" = "not-applied"): DispatchOutcome { return Object.freeze({ kind: "definitive-failure", resultDigest: authorityDigest({ reason }), reconciliationStatus, normalizedProjectionDigest: null, reason } as DispatchOutcome); }
function sha256(bytes: Uint8Array): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function gitBlobSha(bytes: Uint8Array): string { return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex"); }
function validateInvocation(request: unknown): asserts request is GitHubReleaseInvocationV1 { const hasReviewedHost = !!request && typeof request === "object" && Object.hasOwn(request, "reviewedHost"), value = exactRecord(request, hasReviewedHost ? ["alias", "authorizationHandle", "requestId", "reviewedHost", "semanticsDigest"] : ["alias", "authorizationHandle", "requestId", "semanticsDigest"], "GitHub release invocation"); if (hasReviewedHost) exactRecord(value.reviewedHost, ["account", "destination", "limit"], "reviewed GitHub release host binding"); if (!(String(value.alias) in ALIASES) || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(String(value.authorizationHandle)) || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(String(value.requestId)) || !DIGEST.test(String(value.semanticsDigest))) throw new TypeError("GitHub release invocation is invalid"); }
function validateRequest(request: unknown): asserts request is GitHubReleaseRunRequestV1 { const value = exactRecord(request, ["alias", "allocationId", "authorizationHandle", "requestId", "semanticsDigest"], "GitHub release request"); if (!(String(value.alias) in ALIASES) || !/^[a-z0-9][a-z0-9-]{7,127}$/.test(String(value.allocationId)) || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(String(value.authorizationHandle)) || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(String(value.requestId)) || !DIGEST.test(String(value.semanticsDigest))) throw new TypeError("GitHub release request is invalid"); }
function isPlain(value: unknown): value is Record<string, unknown> { if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some(key => typeof key !== "string")) return false; return Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor => "value" in descriptor && descriptor.enumerable); }
function inertEndpointId(value: unknown): string | null { if (!isPlain(value)) return null; const descriptor = Object.getOwnPropertyDescriptor(value, "endpointId"); return descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : null; }
function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> { if (!isPlain(value) || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) throw new TypeError(`${label} is not a closed inert record`); return Object.freeze(Object.fromEntries(keys.map(key => [key, value[key]]))); }
function parseSha(value: unknown, label: string): Readonly<{ sha: string }> { const item = exactRecord(value, ["sha"], label); if (!GIT_SHA.test(String(item.sha))) throw new TypeError(`${label} SHA is invalid`); return Object.freeze({ sha: String(item.sha) }); }
function parseRef(value: unknown): Readonly<{ sha: string }> | null { if (value === null) return null; return parseSha(value, "ref"); }
function parseCommit(value: unknown): Readonly<{ sha: string; parentSha: string; treeSha: string }> | null { if (value === null) return null; const item = exactRecord(value, ["parentSha", "sha", "treeSha"], "commit"); if (![item.sha, item.parentSha, item.treeSha].every(raw => GIT_SHA.test(String(raw)))) throw new TypeError("commit readback is invalid"); return Object.freeze({ sha: String(item.sha), parentSha: String(item.parentSha), treeSha: String(item.treeSha) }); }
function parsePullRequest(value: unknown): GitHubReleasePullRequestV1 { const item = exactRecord(value, ["base", "body", "draft", "head", "headSha", "mergeCommitSha", "merged", "number", "title"], "pull request"); if (!Number.isSafeInteger(item.number) || Number(item.number) <= 0 || typeof item.head !== "string" || typeof item.base !== "string" || typeof item.draft !== "boolean" || typeof item.title !== "string" || typeof item.body !== "string" || !GIT_SHA.test(String(item.headSha)) || typeof item.merged !== "boolean" || !(item.mergeCommitSha === null || GIT_SHA.test(String(item.mergeCommitSha)))) throw new TypeError("pull request readback is invalid"); return Object.freeze({ number: Number(item.number), head: item.head, base: item.base, draft: item.draft, title: item.title, body: item.body, headSha: String(item.headSha), merged: item.merged, mergeCommitSha: item.mergeCommitSha === null ? null : String(item.mergeCommitSha) }); }
function parsePullRequests(value: unknown): readonly GitHubReleasePullRequestV1[] { return Object.freeze(inertArray(value, "pull request list").map(parsePullRequest)); }
function assertPullRequestPlan(pr: GitHubReleasePullRequestV1, plan: VerifiedReleaseAuthorizationV1["operationPlan"]["value"], draft: boolean): void { if (pr.head !== plan.pullRequest.head || pr.base !== plan.pullRequest.base || pr.draft !== draft || pr.title !== plan.pullRequest.title || pr.body !== plan.pullRequest.body || pr.headSha !== plan.expectedCommitSha) throw new TypeError("pull request readback does not match exact authorized metadata"); }
function parseChecks(value: unknown): readonly Readonly<{ name: string; status: string; workflowDigest: string; workflowPath: string }>[] { return Object.freeze(inertArray(value, "checks list").map(raw => { const item = exactRecord(raw, ["name", "status", "workflowDigest", "workflowPath"], "check"); if (typeof item.name !== "string" || typeof item.status !== "string" || typeof item.workflowPath !== "string" || !DIGEST.test(String(item.workflowDigest))) throw new TypeError("check readback is invalid"); return Object.freeze({ name: item.name, status: item.status, workflowDigest: String(item.workflowDigest), workflowPath: item.workflowPath }); })); }
function assertChecks(checks: readonly Readonly<{ name: string; status: string; workflowDigest: string; workflowPath: string }>[], plan: VerifiedReleaseAuthorizationV1["operationPlan"]["value"]): void { const names = checks.map(check => check.name).sort(), ci = plan.workflowCommitments.find(workflow => workflow.path === ".github/workflows/ci.yml"); if (!ci || names.join("\0") !== [...plan.requiredChecks].sort().join("\0") || checks.some(check => check.status !== "success" || check.workflowPath !== ci.path || check.workflowDigest !== ci.digest)) throw new TypeError("required release checks are not bound to the signed CI workflow commitment"); }

function assertReviewedHost(host: Readonly<{ account: string; destination: string; limit: string }>, plan: VerifiedReleaseAuthorizationV1["operationPlan"]["value"], contractDigest: string, signedPackDigest: string): void {
  const ci = plan.workflowCommitments.find(workflow => workflow.path === ".github/workflows/ci.yml");
  if (!ci) throw new TypeError("reviewed GitHub release policy requires the signed CI workflow commitment");
  const policyDigest = githubReviewedOutcomePolicyDigestV1({ repository: plan.repository, baseBranch: plan.destinationBranch, baseSha: plan.baseCommit, headBranch: plan.candidateBranch, headSha: plan.expectedCommitSha, candidateDigest: plan.candidateTreeDigest, workflowPath: ci.path, workflowDigest: ci.digest, requiredChecks: plan.requiredChecks, mergeMethod: "squash", postMergeTreeSha: plan.expectedTreeSha });
  const expectedPackDigest = authorityDigest({ v: "reelier.github-reviewed-signed-pack/v1", contractDigest, policyDigest });
  if (host.account !== plan.repository || host.destination !== plan.candidateBranch || host.limit !== policyDigest || signedPackDigest !== expectedPackDigest) throw new TypeError("reviewed GitHub release contract or host binding conflicts with signed authority");
}
function parseMerge(value: unknown): Readonly<{ merged: boolean; sha: string }> { const item = exactRecord(value, ["merged", "sha"], "merge result"); if (typeof item.merged !== "boolean" || !GIT_SHA.test(String(item.sha))) throw new TypeError("merge result is invalid"); return Object.freeze({ merged: item.merged, sha: String(item.sha) }); }
function parseManifest(value: unknown): Readonly<{ name: string; version: string }> { const item = exactRecord(value, ["name", "version"], "package manifest"); if (typeof item.name !== "string" || typeof item.version !== "string") throw new TypeError("package manifest is invalid"); return Object.freeze({ name: item.name, version: item.version }); }
function parseBoolean(value: unknown, label: string): boolean { if (typeof value !== "boolean") throw new TypeError(`${label} is invalid`); return value; }
async function safeRead<T>(read: () => Promise<unknown>, parse: (value: unknown) => T): Promise<T | null> { let raw: unknown; try { raw = await read(); } catch { return null; } return parse(raw); }
async function providerWrite<T>(write: () => Promise<unknown>, parse: (value: unknown) => T): Promise<T> { let raw: unknown; try { raw = await write(); } catch (error) { if (error instanceof ProviderDefinitiveRefusal) throw error; throw new ProviderWriteAmbiguity(error instanceof Error ? error.message : "provider write response is ambiguous"); } return parse(raw); }
async function consequentialWrite<T>(write: () => Promise<unknown>, parse: (value: unknown) => T): Promise<T | null> { try { return parse(await write()); } catch (error) { if (error instanceof ProviderDefinitiveRefusal) throw error; return null; } }

function inertArray(value: unknown, label: string): readonly unknown[] {
  if (!value || typeof value !== "object" || isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`${label} is not a closed inert array`);
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>, lengthDescriptor = descriptors["length"];
  const count = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : null;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > 10_000) throw new TypeError(`${label} is not a closed inert array`);
  const result: unknown[] = [];
  for (let index = 0; index < count; index += 1) { const descriptor = descriptors[String(index)]; if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError(`${label} is not a closed dense inert array`); result.push(descriptor.value); }
  if (Reflect.ownKeys(descriptors as object).some(key => key !== "length" && (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= count))) throw new TypeError(`${label} is not a closed inert array`);
  return Object.freeze(result);
}

function normalizeProvider(provider: GitHubReleaseProviderV1): GitHubReleaseProviderV1 {
  const invoke = async (method: keyof GitHubReleaseProviderV1, argument: unknown): Promise<unknown> => {
    try { const callable = Reflect.get(provider as object, method); if (typeof callable !== "function") throw new TypeError(`provider method ${method} is absent`); return await Reflect.apply(callable, provider, [argument]); }
    catch (error) { throw normalizeProviderFault(error); }
  };
  return Object.freeze({
    createBlob: (argument: any) => invoke("createBlob", argument), createTree: (argument: any) => invoke("createTree", argument), createCommit: (argument: any) => invoke("createCommit", argument), getRef: (argument: any) => invoke("getRef", argument), createRef: (argument: any) => invoke("createRef", argument), getCommit: (argument: any) => invoke("getCommit", argument), findPullRequests: (argument: any) => invoke("findPullRequests", argument), createPullRequest: (argument: any) => invoke("createPullRequest", argument), markPullRequestReady: (argument: any) => invoke("markPullRequestReady", argument), getPullRequest: (argument: any) => invoke("getPullRequest", argument), getChecks: (argument: any) => invoke("getChecks", argument), mergePullRequest: (argument: any) => invoke("mergePullRequest", argument), npmVersionExists: (argument: any) => invoke("npmVersionExists", argument), readPackageManifest: (argument: any) => invoke("readPackageManifest", argument),
  });
}
function normalizeProviderFault(error: unknown): Error { if (isPlain(error)) { try { const fault = exactRecord(error, ["kind", "reason", "v"], "provider fault"); if (fault.v === "reelier.github-release-provider-fault/v1" && (fault.kind === "transport-uncertain" || fault.kind === "definitive-refusal") && typeof fault.reason === "string" && fault.reason.length > 0 && fault.reason.length <= 512) return fault.kind === "definitive-refusal" ? new ProviderDefinitiveRefusal(fault.reason) : new ProviderTransportUncertainty(fault.reason); } catch { /* unknown failures stay transport-uncertain */ } } return new ProviderTransportUncertainty("provider transport state is uncertain"); }
