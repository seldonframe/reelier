import { createHash, createPublicKey, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { open, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CertificationCellHost } from "./cell.js";
import { certificationCellHostInternalState } from "./cell.js";
import { parseCertificationOperatorConfigV3 } from "./config.js";
import { parseCertificationScenarioPlan } from "./manifests.js";
import { authorityCanonicalBytes, authorityDigest } from "../wire.js";
import { authenticateOutcomeRequest } from "../keys.js";
import { createTrustRoots } from "../trust.js";
import { signAuthorityDigest, verifyAuthoritySignature } from "../crypto.js";
import { createStaticPackRegistry } from "../pack.js";
import { createSourceRegistry } from "../source.js";
import { createConnectorRegistry } from "../connector.js";
import { createAuthorityStatePort } from "../state.js";
import { createAuthorityGate } from "../gate.js";
import { createFileGateDecisionSink } from "../decision.js";
import { FsAuthorityLedger } from "../host/fs-ledger.js";
import { createDispatchCoordinator } from "../host/dispatch.js";
import { validateContractAgainstDelegation, validateDelegationChain } from "../delegation.js";
import { githubIssueLabelsDefinition, parseGitHubIssueLabelsPolicy } from "../../packs/github/compile.js";
import { createGitHubIssueLabelsSourceResolver } from "../../packs/github/source.js";
import { githubIssueLabelsAlias, githubIssueLabelsDefinitionDigest, githubIssueLabelsPackDigest, githubIssueLabelsPolicySchemaId, githubIssueLabelsReadEndpointId, githubIssueLabelsResolverId, githubIssueLabelsRiskClass, githubIssueLabelsWriteEndpointId } from "../../packs/github/manifest.js";
import { confinedExistingDirectory, ensureConfinedDirectory, listConfinedFileNames, readConfinedFile, readUnlinkedFile } from "./filesystem.js";
import { assertLinuxAuthorityCellHost } from "../host/platform.js";
import { createCertificationLifecycleReceiptPublication } from "./lifecycle-receipts.js";
import { createCertificationTaskReceiptGraph, type CertificationTaskReceiptGraphV1 } from "./task-receipt-graph.js";
import { parseAuthorityReceiptBundle } from "../evidence.js";

export type HermeticGitHubMode = "normal" | "source-drift" | "effect-drift" | "provider-503" | "accessor-response" | "cut-after-budget" | "cut-after-dispatched" | "cut-after-send-intent" | "cut-after-apply" | "pause-after-dispatched";
export interface GitHubHermeticRunnerResult { readonly requestId: string; readonly status: "acknowledged" | "refused" | "failed" | "pending-reconciliation" | "duplicate" | "conflict" | "cleaned"; readonly success: false; readonly providerWrites: number; readonly reservationId: string | null; readonly labels?: readonly string[] }
export interface GitHubIssueLabelsHermeticComposition { run(input: Readonly<{ bearerToken: string; requestId: string }>): Promise<GitHubHermeticRunnerResult>; conflict(input: Readonly<{ bearerToken: string; requestId: string }>): Promise<GitHubHermeticRunnerResult>; cleanup(input: Readonly<{ bearerToken: string; requestId: string }>): Promise<GitHubHermeticRunnerResult>; exportGraph(input: Readonly<{ bearerToken: string }>): Promise<CertificationTaskReceiptGraphV1>; recover(): Promise<readonly string[]>; status(input: Readonly<{ bearerToken: string; requestId: string }>): Promise<GitHubHermeticRunnerResult> }
type JournalPhase = "reserved" | "budget-intent" | "budget-consumed" | "dispatched" | "provider-send-intent" | "provider-applied" | "acknowledged" | "cleaned" | "refused" | "failed" | "pending-reconciliation";
interface Journal { readonly v: "reelier.github-certification-journal/v1"; readonly requestId: string; readonly requestDigest: string; readonly reservationId: string; readonly allocationId: string; readonly effectDigest: string; readonly permitSnapshotDigest: string; readonly phase: JournalPhase; readonly providerWrites: number; readonly signerId?: string; readonly signature?: Readonly<{ alg: "ed25519"; sig: string }> }
type Issue = Readonly<{ owner: string; repo: string; issueNumber: number; issueState: string; labels: readonly string[] }>;

/** Non-barrel hermetic test composition. Executable authority comes only from the branded real Cell. */
export async function createGitHubIssueLabelsHermeticComposition(cell: CertificationCellHost): Promise<GitHubIssueLabelsHermeticComposition> {
  assertLinuxAuthorityCellHost();
  const state = certificationCellHostInternalState(cell);
  const journalAuthority = state.hermeticGitHubAuthority();
  const modes: readonly string[] = ["normal", "source-drift", "effect-drift", "provider-503", "accessor-response", "cut-after-budget", "cut-after-dispatched", "cut-after-send-intent", "cut-after-apply", "pause-after-dispatched"];
  const mode = journalAuthority.lifecycle.schedule as HermeticGitHubMode;
  if (!modes.includes(mode) || journalAuthority.binding.scheduleDigest !== authorityDigest({ v: "reelier.certification-hermetic-schedule/v1", schedule: mode })) throw new TypeError("GitHub hermetic schedule commitment is invalid");
  const config = parseCertificationOperatorConfigV3(JSON.parse((await readUnlinkedFile(path.join(state.workspace, "config.json"))).toString("utf8")));
  if (config.scenarios.length !== 1 || config.scenarios[0] !== "github-issue-labels") throw new TypeError("GitHub runner requires the exact selected scenario");
  const planFile = JSON.parse((await readUnlinkedFile(path.join(state.workspace, "inputs", "plans", "github-issue-labels.json"))).toString("utf8"));
  parseCertificationScenarioPlan(planFile, config, ["github-issue-labels"]);
  const resource = config.resources["github-issue-labels"] as { apiBaseUrl: string; owner: string; repository: string; issueNumber: number };
  const desired = (config.desiredState["github-issue-labels"] as { labels: readonly string[] }).labels;
  if (resource.apiBaseUrl !== "https://api.github.com") throw new TypeError("GitHub endpoint is not the reviewed endpoint");
  const activation = JSON.parse((await readUnlinkedFile(path.join(state.workspace, "authority", "delegation", "root-activation.json"))).toString("utf8"));
  const constraints = activation.signedRootGrant.grant.constraints;
  const exactAccount = constraints.connectorAccounts.some((item: any) => item.connectorId === "github" && item.accountId === "github_fixlyai_reelier");
  if (!exactAccount || !constraints.definitionAliases.includes(githubIssueLabelsAlias) || !constraints.riskClasses.includes(githubIssueLabelsRiskClass)) throw new TypeError("GitHub account, definition, or risk authority is not exact");
  const journalRoot = await ensureConfinedDirectory(state.workspace, ["authority", "github-label-runner"]);
  const ledgerRoot = await ensureConfinedDirectory(state.workspace, ["authority", "github-label-runner", "ledger"]);
  const decisionRoot = await ensureConfinedDirectory(state.workspace, ["authority", "github-label-runner", "decisions"]);
  const receiptRoot = await ensureConfinedDirectory(state.workspace, ["authority", "github-label-runner", "receipts"]);
  const provider = await createBrandedProvider(journalRoot, resource, desired, mode);
  const gateRuntime = await buildGate({ state, activation, constraints, provider, ledgerRoot, decisionRoot, resource, desired });
  const cleanupGateRuntime = await buildGate({ state, activation, constraints, provider, ledgerRoot, decisionRoot, resource, desired: ["before"] });
  const requestIdsByReservation = new Map<string, string>();
  let controlledCut: ControlledCut | undefined;
  const publication = createCertificationLifecycleReceiptPublication({ rootDir: receiptRoot, lifecycle: journalAuthority.lifecycle, signedRootGrant: activation.signedRootGrant, now: () => state.now?.() ?? new Date() });
  const coordinator = createDispatchCoordinator(gateRuntime.ledger, {
    async dispatch(dispatchState) {
      const requestId = requestIdsByReservation.get(dispatchState.reservation.reservationId); if (!requestId) throw new Error("dispatch request binding missing");
      const current = await loadJournal(journalRoot, requestId, journalAuthority); if (!current) throw new Error("dispatch journal missing");
      await saveJournal(journalRoot, { ...current, phase: "dispatched" }, journalAuthority);
      if (mode === "cut-after-dispatched") { controlledCut = new ControlledCut(); throw controlledCut; }
      if (mode === "pause-after-dispatched") await new Promise(resolve => setTimeout(resolve, 500));
      await saveJournal(journalRoot, { ...current, phase: "provider-send-intent" }, journalAuthority);
      if (mode === "cut-after-send-intent") { controlledCut = new ControlledCut(); throw controlledCut; }
      const rawResponse = await provider.replaceLabels(dispatchState.effect);
      await saveJournal(journalRoot, { ...current, phase: "provider-applied", providerWrites: (await provider.snapshot()).writes }, journalAuthority);
      if (mode === "cut-after-apply") { controlledCut = new ControlledCut(); throw controlledCut; }
      const response = normalizeProviderAcknowledgment(rawResponse);
      if (response.status < 200 || response.status >= 300) return { kind: "ambiguous" as const, resultDigest: authorityDigest(response), providerStatus: response.status, reconciliationStatus: "not-attempted" as const };
      return { kind: "acknowledged" as const, resultDigest: authorityDigest(response), providerStatus: response.status, reconciliationStatus: "not-attempted" as const };
    },
    async reconcile(_state, prior) { if (prior.kind === "definitive-failure") return prior; const snapshot = await provider.snapshot(); const matched = authorityDigest(snapshot.labels) === authorityDigest([...desired].sort()); return { kind: matched ? "acknowledged" as const : "ambiguous" as const, resultDigest: authorityDigest({ v: "reelier.github-reconciliation/v1", labels: snapshot.labels }), reconciliationStatus: matched ? "matched" as const : "conflict" as const, normalizedProjectionDigest: authorityDigest(snapshot.labels) }; },
  }, undefined, publication);
  const cleanupCoordinator = createDispatchCoordinator(cleanupGateRuntime.ledger, { async dispatch(dispatchState) { const restored = await provider.restore(); return { kind: "acknowledged" as const, resultDigest: authorityDigest({ v: "reelier.github-cleanup-result/v1", reservationId: dispatchState.reservation.reservationId, labels: restored.labels }), providerStatus: 200, reconciliationStatus: "matched" as const, normalizedProjectionDigest: authorityDigest(restored.labels) }; }, async reconcile(_state, outcome) { return outcome; } }, undefined, publication);

  async function executeRun(value: Readonly<{ bearerToken: string; requestId: string }>): Promise<GitHubHermeticRunnerResult> {
    closed(value, ["bearerToken", "requestId"], "GitHub runner call"); validateRequestId(value.requestId);
    const accessPermit = await state.issueHermeticGitHubPermit(value.bearerToken); await state.revalidateHermeticGitHubPermit(accessPermit);
    const prior = await loadJournal(journalRoot, value.requestId, journalAuthority); if (prior) return view(prior);
    for (const name of await readdir(journalRoot)) { if (!name.endsWith(".journal.json")) continue; const existingId = name.slice(0, -13); const existing = await loadJournal(journalRoot, existingId, journalAuthority); if (existing?.phase === "acknowledged") { const snapshot = await provider.snapshot(); return Object.freeze({ requestId: value.requestId, status: "duplicate" as const, success: false as const, providerWrites: snapshot.writes, reservationId: existing.reservationId }); } }
    const permit = await state.issueHermeticGitHubPermit(value.bearerToken);
    const request = { v: "reelier.outcome-request/v1", requestId: value.requestId, sourceRefs: { issue: "issue_1" }, choices: {} };
    const authenticated = authenticateOutcomeRequest({ tenant: activation.authorityCellId, requester: activation.principalId, definitionAlias: githubIssueLabelsAlias, request, executionContext: { v: "reelier.authority-execution-context/v1", taskId: activation.taskId, principalId: activation.principalId, grantId: activation.grantId, grantDigest: activation.signedRootGrant.digest, allocationId: activation.allocationId, runtimeSessionId: activation.runtimeSessionId, jobId: activation.jobId, authorityCellId: activation.authorityCellId } });
    const decided = await gateRuntime.gate.decide(authenticated);
    if (decided.kind !== "accepted") {
      const snapshot = await provider.snapshot();
      if (decided.kind === "refused" && decided.status.reasonCode === "semantic-duplicate") return Object.freeze({ requestId: value.requestId, status: "duplicate", success: false, providerWrites: snapshot.writes, reservationId: null });
      throw new Error(`GitHub AuthorityGate refused: ${JSON.stringify(decided)}`);
    }
    const reservationId = decided.signedDecision.reservationId!;
    requestIdsByReservation.set(reservationId, value.requestId);
    const reservation = await gateRuntime.ledger.getReservation(reservationId); if (!reservation) throw new Error("GitHub reservation missing");
    const read2 = normalizeIssue(await provider.readIssue());
    const expectedResource = read2.owner === resource.owner && read2.repo === resource.repository && read2.issueNumber === resource.issueNumber;
    const effect2 = githubIssueLabelsDefinition.compile({ source: gateRuntime.sourceFor(read2), policy: parseGitHubIssueLabelsPolicy({ desiredLabels: desired }), choices: {} } as any);
    const effectDigest2 = mode === "effect-drift" ? authorityDigest({ effect2, drift: true }) : authorityDigest(effect2);
    const permitSnapshotDigest = authorityDigest({ v: "reelier.github-permit-snapshot/v1", activation: authorityDigest(activation), plan: authorityDigest(planFile), allocationId: activation.allocationId, effectDigest: reservation.intent.effectDigest });
    let journal: Journal = { v: "reelier.github-certification-journal/v1", requestId: value.requestId, requestDigest: authorityDigest(request), reservationId, allocationId: activation.allocationId, effectDigest: reservation.intent.effectDigest, permitSnapshotDigest, phase: "reserved", providerWrites: 0 };
    await saveJournal(journalRoot, journal, journalAuthority);
    if (!expectedResource || effectDigest2 !== reservation.intent.effectDigest) {
      await coordinator.cancel(decided.handle, "source-or-effect-drift"); journal = { ...journal, phase: "refused" }; await saveJournal(journalRoot, journal, journalAuthority); return view(journal);
    }
    await state.revalidateHermeticGitHubPermit(permit);
    journal = { ...journal, phase: "budget-intent" }; await saveJournal(journalRoot, journal, journalAuthority);
    await state.delegationAuthority.budget.consumeOnce({ allocationId: activation.allocationId, reservationId, effects: 1 });
    journal = { ...journal, phase: "budget-consumed" }; await saveJournal(journalRoot, journal, journalAuthority);
    if (mode === "cut-after-budget") throw new ControlledCut();
    try {
      const outcome = await coordinator.dispatch(decided.handle);
      if (controlledCut) throw controlledCut;
      journal = { ...(await loadJournal(journalRoot, value.requestId, journalAuthority) ?? journal), phase: outcome.kind === "acknowledged" ? "acknowledged" : outcome.kind === "definitive-failure" ? "failed" : "pending-reconciliation", providerWrites: (await provider.snapshot()).writes };
      await saveJournal(journalRoot, journal, journalAuthority); return view(journal);
    } catch (error) { if (error instanceof ControlledCut) throw error; throw error; }
  }
  async function run(value: Readonly<{ bearerToken: string; requestId: string }>): Promise<GitHubHermeticRunnerResult> {
    closed(value, ["bearerToken", "requestId"], "GitHub runner call"); validateRequestId(value.requestId);
    return withRequestLock(journalRoot, value.requestId, () => executeRun(value));
  }
  async function recover(): Promise<readonly string[]> {
    const recovered: string[] = [];
    for (const name of await readdir(journalRoot)) {
      if (!name.endsWith(".journal.json")) continue; const requestId = name.slice(0, -13); await withRequestLock(journalRoot, requestId, async () => { const journal = await loadJournal(journalRoot, requestId, journalAuthority); if (!journal) return;
      const boundReservation = await gateRuntime.ledger.getReservation(journal.reservationId), allocation = await state.delegationAuthority.budget.get(journal.allocationId);
      if (!boundReservation || boundReservation.intent.requestDigest !== journal.requestDigest || boundReservation.intent.effectDigest !== journal.effectDigest || boundReservation.intent.executionContext?.allocationId !== journal.allocationId || !allocation || allocation.taskId !== activation.taskId || allocation.revoked) throw new TypeError("GitHub dispatch journal authority binding is invalid or tampered");
      const compatible: Record<JournalPhase, readonly string[]> = { reserved: ["reserved"], "budget-intent": ["reserved"], "budget-consumed": ["reserved"], dispatched: ["dispatched", "ambiguous"], "provider-send-intent": ["dispatched", "ambiguous"], "provider-applied": ["ambiguous", "dispatched"], acknowledged: ["acknowledged", "reconciled"], cleaned: ["acknowledged", "reconciled"], refused: ["cancelled", "reconciled"], failed: ["definitive-failure"], "pending-reconciliation": ["ambiguous"] };
      if (!compatible[journal.phase].includes(boundReservation.state)) throw new TypeError("GitHub signed journal rollback conflicts with monotonic ledger truth");
      if (journal.phase === "reserved" || journal.phase === "budget-intent") {
        const reservation = await gateRuntime.ledger.getReservation(journal.reservationId);
        if (reservation?.state === "reserved") {
          const resultDigest = authorityDigest({ v: "reelier.github-pre-network-recovery/v1", reservationId: journal.reservationId, phase: journal.phase });
          const transitioned = await gateRuntime.ledger.transition(journal.reservationId, "reserved", { to: "cancelled", resultDigest });
          if (!transitioned.ok) throw new Error(`GitHub pre-network recovery refused: ${transitioned.reason}`);
        }
        await saveJournal(journalRoot, { ...journal, phase: "refused" }, journalAuthority);
      } else if (journal.phase === "budget-consumed") {
        const reservation = await gateRuntime.ledger.getReservation(journal.reservationId);
        if (reservation?.state === "reserved") {
          const resultDigest = authorityDigest({ v: "reelier.github-pre-network-recovery/v1", reservationId: journal.reservationId, phase: journal.phase });
          const transitioned = await gateRuntime.ledger.transition(journal.reservationId, "reserved", { to: "cancelled", resultDigest });
          if (!transitioned.ok) throw new Error(`GitHub consumed recovery refused: ${transitioned.reason}`);
        }
        await state.delegationAuthority.budget.releaseConsumedOnce({ allocationId: journal.allocationId, reservationId: journal.reservationId, effects: 1 });
        await saveJournal(journalRoot, { ...journal, phase: "refused" }, journalAuthority);
      } else if (journal.phase === "dispatched") {
        const reservation = await gateRuntime.ledger.getReservation(journal.reservationId);
        if (reservation?.state === "ambiguous") {
          await saveJournal(journalRoot, { ...journal, phase: "pending-reconciliation" }, journalAuthority);
        } else {
          await coordinator.recover(); await saveJournal(journalRoot, { ...journal, phase: "pending-reconciliation" }, journalAuthority);
        }
      } else if (journal.phase === "provider-send-intent" || journal.phase === "provider-applied") { await coordinator.recover(); const outcome = await coordinator.reconcile(journal.reservationId); await saveJournal(journalRoot, { ...journal, phase: outcome.reconciliationStatus === "matched" ? "acknowledged" : "pending-reconciliation", providerWrites: (await provider.snapshot()).writes }, journalAuthority); }
      recovered.push(journal.requestId);
      });
    }
    return Object.freeze(recovered);
  }
  return Object.freeze({ run, recover,
    async exportGraph(value: Readonly<{ bearerToken: string }>) { closed(value, ["bearerToken"], "GitHub graph export call"); const accessPermit = await state.issueHermeticGitHubPermit(value.bearerToken); await state.revalidateHermeticGitHubPermit(accessPermit); const portable = await confinedExistingDirectory(receiptRoot, ["portable"]); if (!portable) throw new TypeError("portable receipt store is absent"); const receipts = await Promise.all((await listConfinedFileNames(receiptRoot, portable)).filter(name => name.endsWith(".json")).map(async name => parseAuthorityReceiptBundle(JSON.parse((await readConfinedFile(receiptRoot, portable, name)).toString("utf8"))))); const outcomes: Journal[] = []; for (const name of await readdir(journalRoot)) if (name.endsWith(".journal.json")) outcomes.push((await loadJournal(journalRoot, name.slice(0, -13), journalAuthority))!); const allocation = await state.delegationAuthority.budget.get(activation.allocationId); if (!allocation) throw new TypeError("GitHub graph allocation is absent"); return createCertificationTaskReceiptGraph({ taskId: activation.taskId, authorityCellId: activation.authorityCellId, rootGrant: activation.signedRootGrant, grants: [activation.signedRootGrant], principals: [{ principalId: activation.principalId, runtimeSessionId: activation.runtimeSessionId }], allocations: [allocation], budgetEvents: [{ kind: "consumed", allocationId: activation.allocationId, effects: allocation.consumed }], outcomes, exceptions: outcomes.filter(item => item.phase === "failed" || item.phase === "pending-reconciliation"), receipts, binding: journalAuthority.binding, commitment: journalAuthority.commitment, keyDescriptors: journalAuthority.keyDescriptors, signedReadiness: journalAuthority.signedReadiness }); },
    async conflict(value: Readonly<{ bearerToken: string; requestId: string }>) { closed(value, ["bearerToken", "requestId"], "GitHub conflict call"); const accessPermit = await state.issueHermeticGitHubPermit(value.bearerToken); await state.revalidateHermeticGitHubPermit(accessPermit); const snapshot = await provider.snapshot(); const prior = await loadJournal(journalRoot, value.requestId, journalAuthority); if (!prior) throw new TypeError("GitHub conflict requires an existing request"); return Object.freeze({ requestId: value.requestId, status: "conflict" as const, success: false as const, providerWrites: snapshot.writes, reservationId: prior.reservationId }); },
    async cleanup(value: Readonly<{ bearerToken: string; requestId: string }>) { closed(value, ["bearerToken", "requestId"], "GitHub cleanup call"); const journal = await loadJournal(journalRoot, value.requestId, journalAuthority); if (journal?.phase === "cleaned") { await state.principalRegistry.resolve(value.bearerToken, state.now?.() ?? new Date()); const snapshot = await provider.snapshot(); return Object.freeze({ ...view(journal), labels: snapshot.labels }); } const accessPermit = await state.issueHermeticGitHubPermit(value.bearerToken); await state.revalidateHermeticGitHubPermit(accessPermit); if (!journal || journal.phase !== "acknowledged") throw new TypeError("GitHub cleanup requires authoritative reconciliation and acknowledged apply"); const cleanupId = `${value.requestId}.cleanup`, request = { v: "reelier.outcome-request/v1", requestId: cleanupId, sourceRefs: { issue: "issue_1" }, choices: {} }; const authenticated = authenticateOutcomeRequest({ tenant: activation.authorityCellId, requester: activation.principalId, definitionAlias: githubIssueLabelsAlias, request, executionContext: { v: "reelier.authority-execution-context/v1", taskId: activation.taskId, principalId: activation.principalId, grantId: activation.grantId, grantDigest: activation.signedRootGrant.digest, allocationId: activation.allocationId, runtimeSessionId: activation.runtimeSessionId, jobId: activation.jobId, authorityCellId: activation.authorityCellId } }); const decided = await cleanupGateRuntime.gate.decide(authenticated); if (decided.kind !== "accepted") throw new TypeError(`GitHub cleanup authority refused: ${decided.kind}`); await state.delegationAuthority.budget.consumeOnce({ allocationId: activation.allocationId, reservationId: decided.signedDecision.reservationId!, effects: 1 }); const outcome = await cleanupCoordinator.dispatch(decided.handle); if (outcome.kind !== "acknowledged" || outcome.reconciliationStatus !== "matched") throw new TypeError("GitHub cleanup is ambiguous and remains budget-consumed"); const snapshot = await provider.snapshot(); const cleaned = { ...journal, phase: "cleaned" as const, providerWrites: snapshot.writes }; await saveJournal(journalRoot, cleaned, journalAuthority); return Object.freeze({ ...view(cleaned), labels: snapshot.labels }); },
    async status(value: Readonly<{ bearerToken: string; requestId: string }>) { closed(value, ["bearerToken", "requestId"], "GitHub runner status call"); validateRequestId(value.requestId); const accessPermit = await state.issueHermeticGitHubPermit(value.bearerToken); await state.revalidateHermeticGitHubPermit(accessPermit); const journal = await loadJournal(journalRoot, value.requestId, journalAuthority); if (!journal) throw new TypeError("GitHub runner request not found"); return view(journal); } });
}

async function buildGate(input: any) {
  assertLinuxAuthorityCellHost();
  const authority = input.state.hermeticGitHubAuthority();
  const grant = input.activation.signedRootGrant.grant, policyBytes = authorityCanonicalBytes({ desiredLabels: input.desired });
  const accountId = "github_fixlyai_reelier";
  const contract = { v: "reelier.outcome-contract/v1", tenant: input.activation.authorityCellId, alias: githubIssueLabelsAlias, contractId: "github_certification_contract", validFrom: grant.issuedAt, validUntil: grant.expiresAt, packDigest: githubIssueLabelsPackDigest, definitionDigest: githubIssueLabelsDefinitionDigest, sponsor: grant.sponsor, audiences: [input.activation.principalId], delegationGrantDigest: input.activation.signedRootGrant.digest, connectorId: "github", accountId, sourceAuthority: { resolverId: githubIssueLabelsResolverId, projectionSchemaId: "github_issue_labels_projection_v1", allowedReadEndpointIds: [githubIssueLabelsReadEndpointId], authorizedProjectionPointers: ["/owner", "/repo", "/issueNumber", "/issueState", "/labels"], maxFreshnessSeconds: 60 }, riskClasses: [githubIssueLabelsRiskClass], limits: input.constraints.limits, policyCommitment: { schemaId: githubIssueLabelsPolicySchemaId, jcsBase64: policyBytes.toString("base64"), digest: `sha256:${createHash("sha256").update(policyBytes).digest("hex")}` } };
  const contractDigest = authorityDigest(contract), candidate = { contractEnvelope: envelope(contract, contractDigest, authority.contractDescriptor.keyId, null, "outcome-contract", authority.signContract(contractDigest)), delegationEnvelopes: [envelope(grant, input.activation.signedRootGrant.digest, input.activation.signedRootGrant.signerId, null, "delegation-grant", input.activation.signedRootGrant.signature, 0)], stateEvents: [{ index: 0, kind: "activated", contractDigest, at: grant.issuedAt }] };
  const trustRoots = createTrustRoots([{ tenant: input.activation.authorityCellId, signerId: authority.contractDescriptor.keyId, principalId: input.activation.principalId, publicKey: descriptorPublicKey(authority.contractDescriptor), purposes: ["outcome-contract"] }, { tenant: input.activation.authorityCellId, signerId: input.activation.signedRootGrant.signerId, principalId: grant.grantor, publicKey: publicKeyFromPin(input.state.currentTrustPinPath, input.activation.signedRootGrant.signerId), purposes: ["delegation-grant"] }, { tenant: input.activation.authorityCellId, signerId: authority.gateDescriptor.keyId, principalId: input.activation.principalId, publicKey: descriptorPublicKey(authority.gateDescriptor), purposes: ["gate-event"] }]);
  validateContractAgainstDelegation(contract as any, validateDelegationChain({ tenant: input.activation.authorityCellId, sponsor: contract.sponsor, now: input.state.now?.() ?? new Date(), trustRoots, grants: [input.activation.signedRootGrant] }));
  const packs = createStaticPackRegistry([githubIssueLabelsDefinition]), sources = createSourceRegistry([createGitHubIssueLabelsSourceResolver(input.activation.authorityCellId)]), connectors = createConnectorRegistry([{ tenant: input.activation.authorityCellId, connectorId: "github", accountId, providerAccountIdentity: accountId, allowedReadEndpointIds: [githubIssueLabelsReadEndpointId], allowedWriteEndpointIds: [githubIssueLabelsWriteEndpointId], riskClasses: [githubIssueLabelsRiskClass], operatorConfigurationDigest: authorityDigest({ resource: input.resource }) }]);
  const ledger = new FsAuthorityLedger(input.ledgerRoot, { now: () => input.state.now?.().getTime() ?? Date.parse("2026-08-11T20:10:00.000Z") });
  const sourceFor = (issue: Issue) => ({ projection: issue, digest: authorityDigest(issue) });
  const statePort = createAuthorityStatePort({ async loadCompleteContractSet() { return { ok: true as const, snapshot: { tenant: input.activation.authorityCellId, definitionAlias: githubIssueLabelsAlias, stateVersion: 1, candidates: [candidate] } as any, backendToken: {} }; }, async advanceVersion() { return { ok: true as const, backendObservedToken: {} }; }, async withCurrent(_token, callback) { return { ok: true as const, value: await callback() }; }, async executeSourceReads(plans) { const issue = await input.provider.readIssue(); return { ok: true as const, observations: plans.map((plan: any) => ({ planDigest: plan.planDigest, rawBytes: Buffer.from(JSON.stringify(issue)) })) }; } });
  const gate = createAuthorityGate({ trustRoots, packs, sources, connectors, state: statePort, ledger, localGatePolicyDigest: authorityDigest({ v: "reelier.github-certification-gate-policy/v1" }), decisionSink: createFileGateDecisionSink(input.decisionRoot), signer: { async sign(value) { if (value.purpose !== "gate-event") throw new TypeError("GitHub gate signer purpose is invalid"); return { signerId: authority.gateDescriptor.keyId, signature: authority.signGate(value.digest) }; } }, eventId: () => `evt_${randomUUID()}`, capabilityId: () => `cap_${randomUUID()}` });
  return { gate, ledger, sourceFor };
}

async function createBrandedProvider(root: string, resource: any, desired: readonly string[], mode: HermeticGitHubMode) { const file = path.join(root, "provider-state.json"); let reads = 0; async function load() { try { const raw = inertRecord(JSON.parse((await readUnlinkedFile(file)).toString("utf8")), "GitHub provider state"); exact(raw, ["v", "before", "labels", "writes"], "GitHub provider state"); return { before: normalizeLabels(raw.before), labels: normalizeLabels(raw.labels), writes: raw.writes as number }; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; const initial = { before: Object.freeze(["before"]), labels: Object.freeze(["before"]), writes: 0 }; await persist(initial); return initial; } } async function persist(state: { before: readonly string[]; labels: readonly string[]; writes: number }) { const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify({ v: "reelier.github-hermetic-provider/v1", ...state })}\n`, { flag: "wx", mode: 0o600 }); await rename(temp, file); } await load(); return Object.freeze({ async readIssue() { reads += 1; const state = await load(); return normalizeIssue({ owner: resource.owner, repo: resource.repository, issueNumber: resource.issueNumber, issueState: "open", labels: mode === "source-drift" && reads === 2 ? ["drifted"] : state.labels }); }, async replaceLabels(_effect: unknown) { const state = await load(); await persist({ ...state, labels: Object.freeze([...desired].sort()), writes: state.writes + 1 }); if (mode === "accessor-response") return Object.create(Object.prototype, { status: { enumerable: true, get() { throw new Error("accessor must not execute"); } }, acknowledgmentId: { enumerable: true, value: "ack" } }); return { status: mode === "provider-503" ? 503 : 200, acknowledgmentId: "ack_1" }; }, async snapshot() { const state = await load(); return Object.freeze(state); }, async restore() { const state = await load(); const next = { ...state, labels: state.before, writes: state.writes + 1 }; await persist(next); return Object.freeze(next); } }); }
function normalizeLabels(value: unknown): readonly string[] { const labels = inertArray(value, "GitHub durable labels"); if (labels.some(item => typeof item !== "string")) throw new TypeError("GitHub durable labels invalid"); return Object.freeze([...(labels as string[])].sort()); }
function normalizeIssue(value: unknown): Issue { const raw = inertRecord(value, "GitHub issue"); exact(raw, ["owner", "repo", "issueNumber", "issueState", "labels"], "GitHub issue"); const labels = inertArray(raw.labels, "GitHub labels"); if (typeof raw.owner !== "string" || typeof raw.repo !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(raw.owner) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(raw.repo) || !Number.isSafeInteger(raw.issueNumber) || typeof raw.issueState !== "string" || labels.some(x => typeof x !== "string")) throw new TypeError("GitHub issue response invalid"); return Object.freeze({ owner: raw.owner, repo: raw.repo, issueNumber: raw.issueNumber as number, issueState: raw.issueState, labels: Object.freeze([...(labels as string[])].sort()) }); }
function normalizeProviderAcknowledgment(value: unknown) { const raw = inertRecord(value, "GitHub acknowledgment"); exact(raw, ["status", "acknowledgmentId"], "GitHub acknowledgment"); if (!Number.isSafeInteger(raw.status) || typeof raw.acknowledgmentId !== "string") throw new TypeError("GitHub acknowledgment invalid"); return Object.freeze({ status: raw.status as number, acknowledgmentId: raw.acknowledgmentId }); }
function envelope(value: any, digest: string, signerId: string, key: any, purpose: any, signature?: any, index?: number) { return { canonicalBase64: authorityCanonicalBytes(value).toString("base64"), advertisedDigest: digest, signerId, signature: signature ?? signAuthorityDigest(key, purpose, digest), ...(index === undefined ? {} : { index }) }; }
function publicKeyFromPin(pinPath: string, signerId: string) { const pin = JSON.parse(readFileSync(pinPath, "utf8")); const descriptor = pin.keyDescriptors.find((x: any) => x.keyId === signerId); if (!descriptor) throw new TypeError("delegation signer descriptor missing"); return createPublicKey({ key: Buffer.from(descriptor.publicKeySpkiBase64, "base64"), format: "der", type: "spki" }); }
function descriptorPublicKey(descriptor: Readonly<{ publicKeySpkiBase64: string }>) { return createPublicKey({ key: Buffer.from(descriptor.publicKeySpkiBase64, "base64"), format: "der", type: "spki" }); }
class ControlledCut extends Error { constructor() { super("controlled cut"); } }
function journalPath(root: string, requestId: string) { return path.join(root, `${requestId}.journal.json`); }
async function saveJournal(root: string, value: Journal, authority: any) { const prior = await loadJournal(root, value.requestId, authority); if (prior) assertJournalTransition(prior, value); const body = journalBody(value), digest = authorityDigest(body), signed = { ...body, signerId: authority.journalDescriptor.keyId, signature: authority.signJournal(digest) }; const file = journalPath(root, value.requestId), temp = `${file}.${randomUUID()}.tmp`, bytes = Buffer.from(`${JSON.stringify(signed)}\n`); const handle = await open(temp, "wx", 0o600); try { await handle.write(bytes); await handle.sync(); } finally { await handle.close(); } await rename(temp, file); }
async function loadJournal(root: string, requestId: string, authority: any): Promise<Journal | undefined> { try { const journal = parseJournal(JSON.parse((await readUnlinkedFile(journalPath(root, requestId))).toString("utf8")), requestId); if (journal.signerId !== authority.journalDescriptor.keyId || !journal.signature || !verifyAuthoritySignature(descriptorPublicKey(authority.journalDescriptor), "authority-journal", authorityDigest(journalBody(journal)), journal.signature)) throw new TypeError("GitHub dispatch journal signature is invalid or tampered"); return journal; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
function parseJournal(value: unknown, expectedRequestId: string): Journal {
  const raw = inertRecord(value, "GitHub dispatch journal");
  exact(raw, ["v", "requestId", "requestDigest", "reservationId", "allocationId", "effectDigest", "permitSnapshotDigest", "phase", "providerWrites", "signerId", "signature"], "GitHub dispatch journal");
  const phases: readonly string[] = ["reserved", "budget-intent", "budget-consumed", "dispatched", "provider-send-intent", "provider-applied", "acknowledged", "cleaned", "refused", "failed", "pending-reconciliation"];
  if (raw.v !== "reelier.github-certification-journal/v1" || raw.requestId !== expectedRequestId || !/^sha256:[0-9a-f]{64}$/.test(raw.requestDigest) || typeof raw.reservationId !== "string" || typeof raw.allocationId !== "string" || !/^sha256:[0-9a-f]{64}$/.test(raw.effectDigest) || !/^sha256:[0-9a-f]{64}$/.test(raw.permitSnapshotDigest) || !phases.includes(raw.phase) || !Number.isSafeInteger(raw.providerWrites) || raw.providerWrites < 0 || typeof raw.signerId !== "string" || !raw.signature || raw.signature.alg !== "ed25519" || typeof raw.signature.sig !== "string") throw new TypeError("GitHub dispatch journal is invalid");
  return Object.freeze(raw as Journal);
}
function journalBody(value: Journal) { return { v: value.v, requestId: value.requestId, requestDigest: value.requestDigest, reservationId: value.reservationId, allocationId: value.allocationId, effectDigest: value.effectDigest, permitSnapshotDigest: value.permitSnapshotDigest, phase: value.phase, providerWrites: value.providerWrites }; }
function assertJournalTransition(prior: Journal, next: Journal) { const stable = ["requestId", "requestDigest", "reservationId", "allocationId", "effectDigest", "permitSnapshotDigest"] as const; if (stable.some(key => prior[key] !== next[key])) throw new TypeError("GitHub dispatch journal identity conflict"); const allowed: Record<JournalPhase, readonly JournalPhase[]> = { reserved: ["budget-intent", "refused"], "budget-intent": ["budget-consumed", "refused"], "budget-consumed": ["dispatched", "refused"], dispatched: ["provider-send-intent", "pending-reconciliation"], "provider-send-intent": ["provider-applied", "acknowledged", "failed", "pending-reconciliation"], "provider-applied": ["acknowledged", "failed", "pending-reconciliation"], acknowledged: ["cleaned"], cleaned: [], refused: [], failed: [], "pending-reconciliation": ["acknowledged"] }; if (!allowed[prior.phase].includes(next.phase)) throw new TypeError("GitHub dispatch journal phase transition is invalid"); }
async function withRequestLock<T>(root: string, requestId: string, operation: () => Promise<T>): Promise<T> { const lock = path.join(root, `${requestId}.lock`); let handle; try { handle = await open(lock, "wx", 0o600); await handle.writeFile(`${process.pid}\n`, "utf8"); await handle.sync(); return await operation(); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("GitHub dispatch request is busy"); throw error; } finally { if (handle) { await handle.close(); await unlink(lock).catch(() => undefined); } } }
function view(journal: Journal): GitHubHermeticRunnerResult { const status = journal.phase === "acknowledged" ? "acknowledged" : journal.phase === "cleaned" ? "cleaned" : journal.phase === "refused" ? "refused" : journal.phase === "failed" ? "failed" : "pending-reconciliation"; return Object.freeze({ requestId: journal.requestId, status, success: false, providerWrites: journal.providerWrites, reservationId: journal.reservationId }); }
function validateRequestId(value: string) { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(value)) throw new TypeError("GitHub request id invalid"); }
function closed(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, any> { const raw = inertRecord(value, label); exact(raw, keys, label); }
function inertRecord(value: unknown, label: string): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some(key => typeof key !== "string" || Object.getOwnPropertyDescriptor(value, key)?.get || Object.getOwnPropertyDescriptor(value, key)?.set)) throw new TypeError(`${label} must be an inert plain object`); return value as Record<string, any>; }
function inertArray(value: unknown, label: string): readonly unknown[] { if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).some(key => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Object.getOwnPropertyDescriptor(value, key)?.get || Object.getOwnPropertyDescriptor(value, key)?.set))) throw new TypeError(`${label} must be an inert dense array`); return value; }
function exact(value: Record<string, any>, keys: readonly string[], label: string) { if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError(`${label} is closed`); }
