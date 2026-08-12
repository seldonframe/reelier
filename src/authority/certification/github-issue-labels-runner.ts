import { authorityCanonicalBytes, authorityDigest, parseAuthorityWire } from "../wire.js";
import { authenticateOutcomeRequest, authenticatedOutcomeRequestState, deriveContractWindowLimitKey, deriveProviderSourceTriggerLimitKey, digestOutcomeRequest } from "../keys.js";
import type { AuthorityLedger, ReservationIntent } from "../ledger.js";
import { createReservedDispatchHandle } from "../gate.js";
import { createDispatchCoordinator } from "../host/dispatch.js";
import type { FsDelegationBudgetLedger } from "../host/delegation-budget.js";
import { compileGitHubIssueLabels, parseGitHubIssueLabelsPolicy } from "../../packs/github/compile.js";
import { githubIssueLabelsAlias } from "../../packs/github/manifest.js";

type Issue = Readonly<{ owner: string; repo: string; issueNumber: number; issueState: string; labels: readonly string[] }>;
type Fault = "none" | "source-drift" | "effect-drift";
interface FixedProvider { readIssue(): Promise<Issue>; replaceLabels(effect: unknown): Promise<Readonly<{ status: number; acknowledgmentId: string }>> }
interface CurrentPermitCell { revalidateCurrentPermit(): Promise<void> }
export interface GitHubIssueLabelsRunnerHost { run(input: Readonly<{ requestId: string }>): Promise<Readonly<{ status: "acknowledged" | "refused"; success: false; reservationId: string }>> }

/** Host-construction boundary: all executable dependencies are captured once; run accepts data only. */
export function createGitHubIssueLabelsRunnerHost(input: Readonly<{ cell: CurrentPermitCell; ledger: AuthorityLedger; budget: FsDelegationBudgetLedger; provider: FixedProvider; fault?: Fault }>): GitHubIssueLabelsRunnerHost {
  closed(input, ["cell", "ledger", "budget", "provider", "fault"], true, "GitHub runner host construction");
  if (!input.cell || typeof input.cell.revalidateCurrentPermit !== "function" || !input.provider || typeof input.provider.readIssue !== "function" || typeof input.provider.replaceLabels !== "function") throw new TypeError("GitHub runner requires fixed host-owned Cell and provider dependencies");
  const fault = input.fault ?? "none";
  if (!["none", "source-drift", "effect-drift"].includes(fault)) throw new TypeError("GitHub runner fault mode is invalid");
  const coordinator = createDispatchCoordinator(input.ledger, {
    async dispatch(state) {
      const acknowledgment = await input.provider.replaceLabels(state.effect);
      return Object.freeze({ kind: "acknowledged" as const, resultDigest: authorityDigest({ v: "reelier.github-label-acknowledgment/v1", status: acknowledgment.status, acknowledgmentId: acknowledgment.acknowledgmentId }), providerStatus: acknowledgment.status, reconciliationStatus: "not-attempted" as const, normalizedProjectionDigest: null });
    },
  }, undefined, undefined, input.budget);
  return Object.freeze({
    async run(value: Readonly<{ requestId: string }>) {
      closed(value, ["requestId"], false, "GitHub runner call");
      if (typeof value.requestId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(value.requestId)) throw new TypeError("GitHub runner request id is invalid");
      const read1 = normalizeIssue(await input.provider.readIssue());
      const effect1 = compile(read1);
      const reservation = await reserve(input.ledger, value.requestId, read1, effect1);
      const handle = createReservedDispatchHandle({ reservation, effect: effect1, effectCanonicalBase64: authorityCanonicalBytes(effect1).toString("base64"), effectDigest: authorityDigest(effect1) });
      const read2 = normalizeIssue(await input.provider.readIssue());
      const compiled2 = compile(read2);
      const effect2 = fault === "effect-drift" ? Object.freeze({ ...(compiled2 as Record<string, unknown>), path: "/repos/fixlyai/reelier-certification/issues/2/labels" }) : compiled2;
      if (authorityDigest(read1) !== authorityDigest(read2) || authorityDigest(effect1) !== authorityDigest(effect2)) {
        await coordinator.cancel(handle, fault === "effect-drift" ? "effect-drift" : "source-drift");
        return Object.freeze({ status: "refused" as const, success: false as const, reservationId: reservation.reservationId });
      }
      await input.cell.revalidateCurrentPermit();
      const outcome = await coordinator.dispatch(handle);
      if (outcome.kind !== "acknowledged") throw new Error("GitHub provider dispatch did not acknowledge");
      return Object.freeze({ status: "acknowledged" as const, success: false as const, reservationId: reservation.reservationId });
    },
  });
}

function compile(issue: Issue): unknown { return compileGitHubIssueLabels({ source: { projection: issue }, policy: parseGitHubIssueLabelsPolicy({ desiredLabels: ["certification-after"] }) }); }
function normalizeIssue(value: Issue): Issue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("GitHub authoritative issue read is invalid");
  const raw = value as Record<string, unknown>; closed(raw, ["owner", "repo", "issueNumber", "issueState", "labels"], false, "GitHub authoritative issue");
  if (typeof raw.owner !== "string" || typeof raw.repo !== "string" || !Number.isSafeInteger(raw.issueNumber) || typeof raw.issueState !== "string" || !Array.isArray(raw.labels) || raw.labels.some(label => typeof label !== "string")) throw new TypeError("GitHub authoritative issue read is invalid");
  return Object.freeze({ owner: raw.owner, repo: raw.repo, issueNumber: raw.issueNumber as number, issueState: raw.issueState, labels: Object.freeze([...(raw.labels as string[])].sort()) });
}

async function reserve(ledger: AuthorityLedger, requestId: string, issue: Issue, effect: unknown) {
  const tenant = "cell_github_certification", requester = "principal_github_certification";
  const request = parseAuthorityWire("outcome-request", { v: "reelier.outcome-request/v1", requestId, sourceRefs: { issue: "issue_1" }, choices: {} });
  const authenticated = authenticateOutcomeRequest({ tenant, requester, definitionAlias: githubIssueLabelsAlias, request });
  const clock = await ledger.observeClock(); if (!clock.ok) throw new Error("GitHub runner ledger clock unavailable");
  const ingress = await ledger.bindIngress(authenticated); if (!ingress.ok || !ingress.evaluationEligible) throw new Error("GitHub runner ingress reservation refused");
  const issuedAt = "2026-08-11T20:00:00.000Z", expiresAt = "2026-08-11T20:01:00.000Z";
  const limits = Object.freeze({ maxEffectsPerWindow: 1, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 });
  const contractDigest = authorityDigest({ v: "reelier.github-certification-contract/v1", tenant });
  const effectDigest = authorityDigest(effect), requestDigest = digestOutcomeRequest(request), requestKey = authenticatedOutcomeRequestState(authenticated).requestKey;
  const sourceBundleDigest = authorityDigest({ v: "reelier.github-certification-source/v1", issue });
  const sourceSnapshotDigest = authorityDigest({ v: "reelier.github-certification-source-snapshot/v1", sourceBundleDigest });
  const authorityStateDigest = authorityDigest({ v: "reelier.github-certification-authority-state/v1", tenant, contractDigest });
  const limitsDigest = authorityDigest({ v: "reelier.capability-limits/internal-v1", contractDigest, limits });
  const outcomeKey = authorityDigest({ v: "reelier.github-certification-outcome/v1", tenant, requestId, sourceBundleDigest, effectDigest });
  const capabilityId = `capability_${requestId}`;
  const capability = parseAuthorityWire("compiled-capability", { v: "reelier.compiled-capability/v1", tenant, requester, definitionAlias: githubIssueLabelsAlias, requestDigest, requestKey, contractDigest, sourceBundleDigest, sourceSnapshotDigest, authorityStateDigest, limits, limitsDigest, capabilityId, outcomeKey, effectDigest, issuedAt, expiresAt });
  const canonicalRequestBytes = authorityCanonicalBytes(request), capabilityBytes = authorityCanonicalBytes(capability);
  const decisionContextDigest = authorityDigest({ v: "reelier.github-certification-decision-context/v1", tenant, requestId, capabilityDigest: authorityDigest(capability) });
  const intent: ReservationIntent = { tenant, requester, definitionAlias: githubIssueLabelsAlias, requestId, requestDigest, canonicalRequestDigest: requestDigest, canonicalRequestBytes, requestKey, ingressClaimDigest: ingress.ingressClaimDigest, decisionContextDigest, capabilityId, capabilityDigest: authorityDigest(capability), capabilityBytes, contractDigest, sourceBundleDigest, sourceSnapshotDigest, authorityStateDigest, limits, limitsDigest, outcomeKey, effectDigest, effectCanonicalBase64: authorityCanonicalBytes(effect).toString("base64"), issuedAt, expiresAt, limitSlots: [{ kind: "contract-window", key: deriveContractWindowLimitKey({ tenant, contractDigest, issuedAt, windowSeconds: limits.windowSeconds }).key, maximum: 1 }, { kind: "source-trigger", key: deriveProviderSourceTriggerLimitKey({ tenant, connectorId: "github", providerAccountIdentity: "github_fixlyai_reelier", resolverId: "github_issue_labels_source_v1", sourceIdentity: `github.${issue.owner}.${issue.repo}.${issue.issueNumber}`, triggerIdentity: authorityDigest({ labels: issue.labels }).replace(":", ".") }), maximum: 1 }], executionContext: { v: "reelier.authority-execution-context/v1", taskId: "task_github_certification", principalId: requester, grantId: "grant_github_certification", grantDigest: authorityDigest({ v: "reelier.github-certification-grant/v1" }), allocationId: "allocation_github_certification", runtimeSessionId: "session_github_certification", jobId: "job_github_certification", authorityCellId: tenant } };
  const result = await ledger.reserve(intent); if (!result.ok || !result.dispatchEligible) throw new Error(`GitHub runner reservation refused: ${result.ok ? result.status : result.reason}`);
  return result.reservation;
}

function closed(value: unknown, keys: readonly string[], optionalFault: boolean, label: string): asserts value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a closed plain object`);
  const allowed = optionalFault ? keys : keys; const own = Reflect.ownKeys(value);
  if (own.some(key => typeof key !== "string") || own.some(key => !allowed.includes(key as string)) || own.some(key => Object.getOwnPropertyDescriptor(value, key)?.get || Object.getOwnPropertyDescriptor(value, key)?.set) || (!optionalFault && own.length !== keys.length) || (optionalFault && own.length !== keys.length && own.length !== keys.length - 1)) throw new TypeError(`${label} is closed against caller substitution`);
}
