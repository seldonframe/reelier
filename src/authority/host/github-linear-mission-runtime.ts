import { isProxy } from "node:util/types";
import type { OutcomeKernelStorage } from "./outcome-kernel.js";
import { createOutcomeKernel, createTrustedObservationVerifier, createTrustedOutcomePredecessorPolicyV1 } from "./outcome-kernel.js";
import { createSignedJournalOutcomeKernelStorage } from "./outcome-kernel-fs-storage.js";
import type { SignedJournal } from "./signed-journal.js";
import { authenticateOutcomeRequest } from "../keys.js";
import { bindAcceptedGateReservationAuthorityV1, describeAcceptedGateReservationAuthorityV1, type AcceptedGateReservationAuthorityV1 } from "../gate.js";
import { authorityDigest } from "../wire.js";
import { createAuthorityAgentTools, type AuthorityAgentToolsV1, type AuthorityAgentToolContextV1 } from "./agent-tools.js";
import { createGenuineGovernedOutcomeLocalComponentsV1, type LocalAuthorityRuntimeOptions } from "./local.js";
import type { AuthorityHostConfig } from "./config.js";
import type { CoordinatorDispatchCallV1, DispatchAdapter, DispatchOutcome, DispatchRequestState } from "./dispatch.js";
import { governedDurableDispatchPublicationQueryV1 } from "./dispatch.js";
import { compileEffectTransportV1, type CompiledEffectTransportV1, type EffectTransportHostBindingsV1 } from "./effect-transports.js";
import { createGovernedOutcomeKernelAuthorityV1 } from "./governed-outcome-composition.js";
import { governedOutcomeCompositionAliasesV1, governedOutcomeCompositionProfileStateV1, type GovernedOutcomeCompositionProfileV1, type GitHubLinearOutcomePackV1, type ReviewedOutcomeOperationV1 } from "../packs/github-linear-outcomes.js";
import type { GitHubReleaseRunnerV1 } from "./github-release-runner.js";
import { createLinearOutcomeExecutorV1, type LinearOutcomeProviderV1 } from "./linear-outcome-runner.js";
import type { AuthorityExecutionContextV1 } from "../types.js";

type Mode = "github-linear" | "linear-only";
type StoredJoin = Readonly<{ alias: string; reservationId: string; join: Readonly<Record<string, unknown>> }>;
type RequestPlan = Readonly<{ requestId: string; semanticsDigest: string; missionId: string; mode: Mode; executionContext: AuthorityExecutionContextV1; sourceRefs: Readonly<Record<string, string>>; choices: Readonly<Record<string, unknown>>; joins: readonly StoredJoin[]; lifecycleState: string; receiptRef?: string }>;
type OutcomeReview = Readonly<{ reviewId: string; requestIds: readonly string[] }>;

export interface GenuineGitHubLinearMissionRuntimeInputV1 {
  readonly config: AuthorityHostConfig;
  readonly profile: GovernedOutcomeCompositionProfileV1;
  readonly githubReleaseRunner: GitHubReleaseRunnerV1;
  readonly linearProvider: LinearOutcomeProviderV1;
  readonly resolveHostBindings: (references: GitHubLinearOutcomePackV1["operations"][keyof GitHubLinearOutcomePackV1["operations"]]["contract"]["bindings"]) => Promise<EffectTransportHostBindingsV1>;
  readonly journal: SignedJournal;
  readonly outcomeReceiptPublication: Pick<OutcomeKernelStorage, "compareAndPublishReceipt" | "loadReceipt">;
  readonly localOptions: LocalAuthorityRuntimeOptions;
  readonly observationAuthKey: string;
  readonly now: () => number;
}
/** @deprecated Raw provider/authority options are retained only for source compatibility and always refuse. */
export interface GitHubLinearMissionProviderV1 { dispatch(operation: string, input: unknown): Promise<Readonly<{ outcome: string; data: unknown }>>; readback(operation: string, input: unknown): Promise<Readonly<{ outcome: string; data: unknown }>> }
type LegacyGitHubLinearMissionRuntimeInputV1 = Readonly<{ rootDir: string; authority: unknown; provider: GitHubLinearMissionProviderV1; resolveHostBindings: (references: GitHubLinearOutcomePackV1["operations"][keyof GitHubLinearOutcomePackV1["operations"]]["contract"]["bindings"]) => Promise<EffectTransportHostBindingsV1>; now: () => number }>;

export async function createGitHubLinearMissionRuntimeV1(input: GenuineGitHubLinearMissionRuntimeInputV1 | LegacyGitHubLinearMissionRuntimeInputV1): Promise<Readonly<{ agentTools: AuthorityAgentToolsV1; reviewOutcomes(requestIds: readonly string[]): Promise<void>; inspectEvidence(): Promise<Readonly<{ activationConfirmations: number; routineApprovals: number; requests: readonly RequestPlan[]; reviews: readonly OutcomeReview[] }>> }>> {
  const raw = exactInput(input);
  const profileState = governedOutcomeCompositionProfileStateV1(raw.profile);
  if (!/^[0-9a-f]{64}$/.test(raw.observationAuthKey) || typeof raw.now !== "function" || typeof raw.resolveHostBindings !== "function") throw new TypeError("genuine governed mission runtime host bindings are invalid");
  if (Object.hasOwn(raw.localOptions, "dispatchAdapter") || Object.hasOwn(raw.localOptions, "githubReleaseRunner")) throw new TypeError("genuine governed mission runtime owns its exact prepared adapters");
  const pack = profileState.pack, operations = operationMap(pack);
  const predecessorPolicy = createTrustedOutcomePredecessorPolicyV1({ predecessorContractDigest: authorityDigest(pack.operations.linearEvidenceComment.contract), successorContractDigest: authorityDigest(pack.operations.linearStatusTransition.contract) });
  const linearExecutor = createLinearOutcomeExecutorV1({ pack, provider: raw.linearProvider, predecessorPolicy });
  const compiled = new Map<string, CompiledEffectTransportV1>();
  for (const alias of ["linear_evidence_comment_v1", "linear_status_transition_v1"] as const) {
    const operation = operations.get(alias)!;
    const modelInput = alias === "linear_evidence_comment_v1" ? { evidenceUrl: profileState.authority.linear.evidenceUrl } : { requestId: "host-bound-status" };
    compiled.set(alias, compileEffectTransportV1({ contract: operation.contract, binding: operation.binding, modelInput, observationAuthKey: raw.observationAuthKey, resolveHostBindings: raw.resolveHostBindings, executor: linearExecutor }));
  }
  const fallback: DispatchAdapter = Object.freeze({
    async dispatch(state: DispatchRequestState) { return refused(state, "prepared-dispatch-required"); },
    async prepare(state: DispatchRequestState, call?: CoordinatorDispatchCallV1) { const item = compiled.get((state.reservation.intent as any).definitionAlias); if (!item || !call) throw new TypeError("governed Linear prepared authority is absent"); return item.prepareGoverned(state, call); },
    async reconcile(state: DispatchRequestState, prior: DispatchOutcome) { const item = compiled.get((state.reservation.intent as any).definitionAlias); return item ? item.adapter.reconcile!(translated(state, item), prior) : refused(state, "readback-unavailable"); },
  });
  const components = await createGenuineGovernedOutcomeLocalComponentsV1(raw.config, Object.freeze({ ...raw.localOptions, dispatchAdapter: fallback, githubReleaseRunner: raw.githubReleaseRunner }));
  const storage = await createSignedJournalOutcomeKernelStorage({ journal: raw.journal, receiptPublication: raw.outcomeReceiptPublication });
  const kernel = createOutcomeKernel({ storage, ledger: components.ledger, coordinator: components.coordinator, now: raw.now, authorization: async () => { throw new TypeError("legacy kernel authorization is prohibited in genuine governed composition"); }, predecessorPolicy });

  const backend = {
    async jobsSearch(_value: unknown, context: AuthorityAgentToolContextV1) { const execution = requiredContext(context); return { requestId: "", verdict: "accepted" as const, reasonCode: "agent-ready", lifecycleState: "ready", jobs: (["github-linear", "linear-only"] as const).map(mode => ({ jobRef: opaqueRef(execution, mode) })) }; },
    async jobLoad(value: unknown, context: AuthorityAgentToolContextV1) { const execution = requiredContext(context), ref = readString(value, "jobId"), mode = resolveRef(execution, ref); return mode ? { requestId: "", verdict: "accepted" as const, reasonCode: "outcome-proposed", lifecycleState: "proposed", jobRef: ref } : refusedIngress("", "unknown-outcome"); },
    async invoke(value: unknown, context: AuthorityAgentToolContextV1) { const execution = requiredContext(context), requestId = readString(value, "requestId"), mode = resolveRef(execution, readString(value, "jobRef")); if (!mode) return refusedIngress(requestId, "unknown-outcome"); return run(requestId, mode, execution, readRecord(value, "sourceRefs"), readRecord(value, "choices")); },
    async status(value: unknown, context: AuthorityAgentToolContextV1) { const execution = requiredContext(context), requestId = readString(value, "requestId"), plan = await loadPlan(raw.journal, requestId); if (!plan || authorityDigest(plan.executionContext) !== authorityDigest(execution)) return refusedIngress(requestId, "unknown-request"); return run(requestId, plan.mode, execution, plan.sourceRefs, plan.choices); },
  };

  async function run(requestId: string, mode: Mode, executionContext: AuthorityExecutionContextV1, sourceRefs: Readonly<Record<string, string>>, choices: Readonly<Record<string, unknown>>) {
    const semanticsDigest = authorityDigest({ v: "reelier.genuine-governed-mission-request/v1", requestId, mode, executionContext, sourceRefs, choices, profile: profileState.scope });
    const key = planKey(requestId);
    return raw.journal.withLease(`mission_${key.slice(-64)}`, async () => {
      let plan = await loadPlan(raw.journal, requestId);
      if (plan && plan.semanticsDigest !== semanticsDigest) return refusedIngress(requestId, "request-semantics-conflict");
      if (plan?.lifecycleState === "reconciled" && plan.receiptRef) {
        const aliases = mode === "linear-only" ? governedOutcomeCompositionAliasesV1.slice(3) : governedOutcomeCompositionAliasesV1;
        if (plan.joins.length !== aliases.length || aliases.some((alias, index) => plan!.joins[index]?.alias !== alias)) return refusedIngress(requestId, "reconciled-index-conflict");
        for (const stored of plan.joins) {
          const reservation = await components.ledger.getReservation(stored.reservationId), operation = operations.get(stored.alias);
          if (!reservation || !operation || !["acknowledged", "reconciled"].includes(reservation.state) || !reservation.resultDigest) return refusedIngress(requestId, "reconciled-authority-absent");
          createGovernedOutcomeKernelAuthorityV1({ join: { ...stored.join, reservation } as never, publication: components.publication, publicationQuery: governedDurableDispatchPublicationQueryV1(reservation) });
          const indexed = await storage.loadEffect(plan.missionId, reservation.reservationId);
          const head = await components.publication.loadDurableHead!(governedDurableDispatchPublicationQueryV1(reservation), "terminal");
          if (indexed?.outcome?.status !== "verified" || indexed.outcome.reservation.reservationId !== reservation.reservationId || !head || head.receiptRef !== reservation.resultDigest) return refusedIngress(requestId, "reconciled-authority-conflict");
        }
        return { requestId, verdict: "accepted" as const, reasonCode: "reconciled", lifecycleState: "reconciled", receiptRef: plan.receiptRef };
      }
      plan ??= Object.freeze({ requestId, semanticsDigest, missionId: `mission_${authorityDigest({ semanticsDigest }).slice(7)}`, mode, executionContext, sourceRefs, choices, joins: Object.freeze([]), lifecycleState: "claimed" });
      const aliases = mode === "linear-only" ? governedOutcomeCompositionAliasesV1.slice(3) : governedOutcomeCompositionAliasesV1;
      const requestedOperations = aliases.map(alias => operations.get(alias)!);
      await kernel.claimMission({ v: "reelier.mission-claim/v1", missionId: plan.missionId, mandateDigest: authorityDigest(profileState.scope), promptDigest: authorityDigest({ requestId, source: "prompt-redacted" }), contractDigests: requestedOperations.map(operation => authorityDigest(operation.contract)), claimedAt: new Date(raw.now()).toISOString() });
      const effectRequests: any[] = [];
      let outcome: Awaited<ReturnType<typeof kernel.execute>> | undefined;
      for (let index = 0; index < aliases.length; index += 1) {
        const alias = aliases[index]!, operation = requestedOperations[index]!;
        let stored: StoredJoin | undefined = plan.joins.find(item => item.alias === alias), gateAuthority: AcceptedGateReservationAuthorityV1 | undefined;
        if (!stored) {
          const effectRequestId = `effect_${authorityDigest({ semanticsDigest, alias }).slice(7, 39)}`;
          const authenticated = authenticateOutcomeRequest({ tenant: raw.config.tenant, requester: executionContext.principalId, definitionAlias: alias, request: { v: "reelier.outcome-request/v1", requestId: effectRequestId, sourceRefs, choices }, executionContext });
          const decided = await components.gate.decide(authenticated);
          if (decided.kind === "accepted") {
            gateAuthority = bindAcceptedGateReservationAuthorityV1(components.gate, decided);
            const description = describeAcceptedGateReservationAuthorityV1(gateAuthority);
            stored = Object.freeze({ alias, reservationId: description.reservationId, join: Object.freeze({ pathCContract: description.pathCContract, source: description.source, choices: description.choices, connectorAccount: description.connectorAccount, toolEffectContract: operation.contract, transportBinding: operation.binding, operationKind: operation.contract.operation, reviewedPolicyDigest: operation.contract.policyDigest }) });
            plan = Object.freeze({ ...plan, joins: Object.freeze([...plan.joins, stored]) });
            await appendPlan(raw.journal, key, plan);
          } else {
            if (decided.kind !== "existing" || decided.status.verdict !== "accepted") return refusedIngress(requestId, decided.kind === "unavailable" ? decided.reason : decided.kind === "refused" ? decided.status.reasonCode : "existing-reservation-unindexed");
            return pendingIngress(requestId);
          }
        }
        const reservation = await components.ledger.getReservation(stored.reservationId);
        if (!reservation) return refusedIngress(requestId, "reservation-absent");
        const governedAuthority = createGovernedOutcomeKernelAuthorityV1({ join: { ...stored.join, reservation } as never, ...(gateAuthority ? { gateAuthority } : {}), publication: components.publication, publicationQuery: governedDurableDispatchPublicationQueryV1(reservation) });
        const verifier = compiled.get(alias)?.verifier ?? createTrustedObservationVerifier({ contractDigest: authorityDigest(operation.contract), verify: observation => observation.authoritative && observation.verdict === "matched" && observation.projectionDigest !== null && observation.semanticIdentity === operation.contract.semanticIdentity });
        effectRequests.push({ contract: operation.contract, verifier, governedAuthority });
        const groupBoundary = mode === "linear-only" ? index === aliases.length - 1 : index === 2 || index === aliases.length - 1;
        if (groupBoundary) {
          outcome = await kernel.execute({ missionId: plan.missionId, effects: effectRequests });
          effectRequests.length = 0;
          if (outcome.effects.at(-1)?.status !== "verified") {
            const next = Object.freeze({ ...plan, lifecycleState: "pending" });
            await appendPlan(raw.journal, key, next);
            return pendingIngress(requestId);
          }
        }
      }
      if (!outcome) throw new TypeError("genuine governed mission has no composed effects");
      const reconciled = outcome.status === "verified", next = Object.freeze({ ...plan, lifecycleState: reconciled ? "reconciled" : "pending", ...(reconciled && outcome.receiptRefs.length ? { receiptRef: outcome.receiptRefs.at(-1) } : {}) });
      await appendPlan(raw.journal, key, next);
      return reconciled ? { requestId, verdict: "accepted" as const, reasonCode: "reconciled", lifecycleState: "reconciled", receiptRef: next.receiptRef } : pendingIngress(requestId);
    });
  }

  return Object.freeze({ agentTools: createAuthorityAgentTools(backend), async reviewOutcomes(requestIds) { if (!Array.isArray(requestIds) || requestIds.length < 1 || new Set(requestIds).size !== requestIds.length) throw new TypeError("Outcome review request IDs are invalid"); for (const id of requestIds) { const plan = await loadPlan(raw.journal, id); if (!plan || plan.lifecycleState !== "reconciled" || !plan.receiptRef) throw new TypeError("Outcome review requires reconciled durable receipts"); } const review: OutcomeReview = Object.freeze({ reviewId: `review_${authorityDigest({ requestIds }).slice(7)}`, requestIds: Object.freeze([...requestIds]) }), semantics = authorityDigest(review); await raw.journal.withLease(`review_${semantics.slice(7)}`, async () => { const events = await raw.journal.load(review.reviewId); if (events.length === 0) await raw.journal.append(review.reviewId, semantics, "outcome-review", Object.freeze({ review })); else if (events.length !== 1 || events[0].semanticsDigest !== semantics) throw new TypeError("Outcome review semantic conflict"); }); }, async inspectEvidence() { const ids = await raw.journal.listRequestIds(), requests = ids.filter(id => id.startsWith("request_")).map(async id => foldPlans(await raw.journal.load(id))), reviews = ids.filter(id => id.startsWith("review_")).map(async id => { const events = await raw.journal.load(id); const review = events.length === 1 && events[0].phase === "outcome-review" ? events[0].data.review : null; return review && typeof review === "object" ? review as OutcomeReview : null; }); return Object.freeze({ activationConfirmations: components.deployment.jobCard ? 1 : 0, routineApprovals: 0, requests: Object.freeze((await Promise.all(requests)).filter((item): item is RequestPlan => Boolean(item))), reviews: Object.freeze((await Promise.all(reviews)).filter((item): item is OutcomeReview => Boolean(item))) }); } });
}

function exactInput(value: unknown): GenuineGitHubLinearMissionRuntimeInputV1 { const keys = ["config", "profile", "githubReleaseRunner", "linearProvider", "resolveHostBindings", "journal", "outcomeReceiptPublication", "localOptions", "observationAuthKey", "now"]; if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value) || Reflect.ownKeys(value).length !== keys.length || Reflect.ownKeys(value).some(key => typeof key !== "string" || !keys.includes(key))) throw new TypeError("legacy or raw governed mission runtime options are prohibited"); for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError("genuine governed mission runtime options must be inert data properties"); } return value as GenuineGitHubLinearMissionRuntimeInputV1; }
function operationMap(pack: GitHubLinearOutcomePackV1): Map<string, ReviewedOutcomeOperationV1> { return new Map([[governedOutcomeCompositionAliasesV1[0], pack.operations.candidatePublish], [governedOutcomeCompositionAliasesV1[1], pack.operations.pullRequestEnsure], [governedOutcomeCompositionAliasesV1[2], pack.operations.exactHeadMerge], [governedOutcomeCompositionAliasesV1[3], pack.operations.linearEvidenceComment], [governedOutcomeCompositionAliasesV1[4], pack.operations.linearStatusTransition]]); }
function translated(state: DispatchRequestState, compiled: CompiledEffectTransportV1): DispatchRequestState { return Object.freeze({ reservation: state.reservation, effect: compiled.effect, effectDigest: compiled.effect.contractDigest, effectCanonicalBase64: Buffer.from(JSON.stringify(compiled.effect)).toString("base64") }); }
function refused(state: DispatchRequestState, reason: string): DispatchOutcome { return Object.freeze({ kind: "definitive-failure", resultDigest: authorityDigest({ reservationId: state.reservation.reservationId, reason }) }); }
function requiredContext(context: AuthorityAgentToolContextV1): AuthorityExecutionContextV1 { if (!context.executionContext || context.executionContext.principalId !== context.requester || context.executionContext.authorityCellId.length === 0) throw new TypeError("authenticated execution context is required"); return context.executionContext; }
function opaqueRef(context: AuthorityExecutionContextV1, mode: Mode): string { return `outcomeref_${authorityDigest({ v: "reelier.reviewed-outcome-ref/v1", context, mode }).slice(7)}`; }
function resolveRef(context: AuthorityExecutionContextV1, ref: string): Mode | null { for (const mode of ["github-linear", "linear-only"] as const) if (opaqueRef(context, mode) === ref) return mode; return null; }
function planKey(requestId: string): string { return `request_${authorityDigest({ requestId }).slice(7)}`; }
async function loadPlan(journal: SignedJournal, requestId: string): Promise<RequestPlan | null> { return foldPlans(await journal.load(planKey(requestId))); }
function foldPlans(events: readonly import("./signed-journal.js").SignedJournalEventV1[]): RequestPlan | null { let prior: RequestPlan | null = null; const rank: Record<string, number> = { claimed: 0, pending: 1, reconciled: 2 }; for (const event of events) { const plan = event.phase === "mission-plan" && event.data.plan && typeof event.data.plan === "object" ? event.data.plan as RequestPlan : null; if (!plan || plan.semanticsDigest !== event.semanticsDigest || authorityDigest({ requestId: plan.requestId }).slice(7) !== event.requestId.slice("request_".length) || !(plan.lifecycleState in rank) || prior && (plan.requestId !== prior.requestId || plan.missionId !== prior.missionId || plan.mode !== prior.mode || plan.semanticsDigest !== prior.semanticsDigest || rank[plan.lifecycleState]! < rank[prior.lifecycleState]! || plan.joins.length < prior.joins.length || prior.joins.some((join, index) => authorityDigest(join) !== authorityDigest(plan.joins[index])))) throw new TypeError("signed mission lifecycle index conflicts or regresses"); prior = plan; } return prior; }
async function appendPlan(journal: SignedJournal, key: string, plan: RequestPlan): Promise<void> { await journal.append(key, plan.semanticsDigest, "mission-plan", Object.freeze({ plan })); }
function readString(value: unknown, field: string): string { const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; return typeof record[field] === "string" ? record[field] as string : ""; }
function readRecord(value: unknown, field: string): Readonly<Record<string, any>> { const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}, item = record[field]; return item && typeof item === "object" && !Array.isArray(item) ? Object.freeze({ ...(item as Record<string, unknown>) }) : Object.freeze({}); }
function refusedIngress(requestId: string, reasonCode: string) { return Object.freeze({ requestId, verdict: "refused" as const, reasonCode, lifecycleState: "refused" }); }
function pendingIngress(requestId: string) { return Object.freeze({ requestId, verdict: "accepted" as const, reasonCode: "pending", lifecycleState: "pending" }); }
