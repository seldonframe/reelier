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
import { createAuthorityStatePort, digestAuthorityState } from "../state.js";
import { createAuthorityGate } from "../gate.js";
import { createFileGateDecisionSink } from "../decision.js";
import { FsAuthorityLedger } from "../host/fs-ledger.js";
import { createDispatchCoordinator } from "../host/dispatch.js";
import { validateContractAgainstDelegation, validateDelegationChain } from "../delegation.js";
import { githubIssueLabelsDefinition, parseGitHubIssueLabelsPolicy } from "../../packs/github/compile.js";
import { createGitHubIssueLabelsSourceResolver } from "../../packs/github/source.js";
import { githubIssueLabelsAlias, githubIssueLabelsDefinitionDigest, githubIssueLabelsPackDigest, githubIssueLabelsPolicySchemaId, githubIssueLabelsReadEndpointId, githubIssueLabelsResolverId, githubIssueLabelsRiskClass, githubIssueLabelsWriteEndpointId } from "../../packs/github/manifest.js";
import { confinedExistingDirectory, ensureConfinedDirectory, listConfinedFileNames, publishPrivateContentAddressed, readConfinedFile, readUnlinkedFile } from "./filesystem.js";
import { assertLinuxAuthorityCellHost } from "../host/platform.js";
import { createCertificationLifecycleReceiptPublication, loadCertificationReceiptExtensions } from "./lifecycle-receipts.js";
import { createCertificationTaskReceiptGraph, type CertificationTaskReceiptGraphV1 } from "./task-receipt-graph.js";
import { createPortableOutcomeEvidencePublication } from "../host/portable-receipts.js";
import { buildMaterializedHttpRequestProjection } from "../drivers/json-https.js";
import { parseAuthorityReceiptBundle } from "../evidence.js";
import { AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST } from "../adapter-contract.js";
import { createCertificationDuplicateAttempt, createCertificationDuplicateAttemptHead, createCertificationDuplicateDecision, createCertificationPolicyEvidence, createCertificationPostStateEvidence, createCertificationTaskAuthorityEvidence, createCertificationTaskStatusEvidence } from "./portable-evidence.js";

export type HermeticGitHubMode = "normal" | "source-drift" | "effect-drift" | "provider-503" | "accessor-response" | "cut-after-budget" | "cut-after-dispatched" | "cut-after-send-intent" | "cut-after-apply" | "cut-after-cleanup-publication" | "cut-after-conflict-publication" | "cut-after-conflict-receipt-before-extension" | "pause-after-dispatched";
let testDispatchedBarrier: ((requestId: string) => Promise<void>) | undefined;
/** Test-only, non-barrel scheduler seam for proving live-dispatch exclusion without wall-clock timing. */
export function __testSetGitHubIssueLabelsRunnerBarrier(barrier: (requestId: string) => Promise<void>): () => void {
  const prior = testDispatchedBarrier;
  testDispatchedBarrier = barrier;
  return () => { testDispatchedBarrier = prior; };
}
export interface GitHubHermeticRunnerResult {
  readonly requestId: string;
  readonly status: "acknowledged" | "refused" | "failed" | "pending-reconciliation" | "duplicate" | "conflict" | "cleaned";
  readonly success: false;
  readonly providerWrites: number;
  readonly reservationId: string | null;
  readonly labels?: readonly string[];
  readonly exactBytesDigest?: string;
}
export interface GitHubIssueLabelsHermeticComposition {
  run(input: Readonly<{ bearerToken: string; requestId: string }>): Promise<GitHubHermeticRunnerResult>;
  conflict(
    input: Readonly<{
      bearerToken: string;
      requestId: string;
      exactBytes: string;
    }>,
  ): Promise<GitHubHermeticRunnerResult>;
  cleanup(input: Readonly<{ bearerToken: string; requestId: string }>): Promise<GitHubHermeticRunnerResult>;
  exportGraph(input: Readonly<{ bearerToken: string }>): Promise<CertificationTaskReceiptGraphV1>;
  recover(): Promise<readonly string[]>;
  status(input: Readonly<{ bearerToken: string; requestId: string }>): Promise<GitHubHermeticRunnerResult>;
}
type JournalPhase = "reserved" | "budget-intent" | "budget-consumed" | "dispatched" | "provider-send-intent" | "provider-applied" | "acknowledged" | "conflict-publication-pending" | "conflict" | "cleanup-reserved" | "cleanup-budget-consumed" | "cleanup-dispatched" | "cleanup-send-intent" | "cleanup-applied" | "cleanup-publication-pending" | "cleanup-receipted" | "cleanup-refused" | "refused" | "failed" | "pending-reconciliation";
interface Journal {
  readonly v: "reelier.github-certification-journal/v1";
  readonly requestId: string;
  readonly requestDigest: string;
  readonly reservationId: string;
  readonly cleanupReservationId?: string | null;
  readonly allocationId: string;
  readonly effectDigest: string;
  readonly permitSnapshotDigest: string;
  readonly adapterContractDigest?: string;
  readonly exactBytesDigest?: string | null;
  readonly conflictReceiptDigest?: string | null;
  readonly duplicateAttemptHeadDigest?: string | null;
  readonly eventSequence?: number;
  readonly priorJournalDigest?: string | null;
  readonly phase: JournalPhase;
  readonly providerWrites: number;
  readonly signerId?: string;
  readonly signature?: Readonly<{ alg: "ed25519"; sig: string }>;
}
type Issue = Readonly<{
  owner: string;
  repo: string;
  issueNumber: number;
  issueState: string;
  labels: readonly string[];
}>;

/** Non-barrel hermetic test composition. Executable authority comes only from the branded real Cell. */
export async function createGitHubIssueLabelsHermeticComposition(cell: CertificationCellHost): Promise<GitHubIssueLabelsHermeticComposition> {
  assertLinuxAuthorityCellHost();
  const state = certificationCellHostInternalState(cell);
  const journalAuthority = state.hermeticGitHubAuthority();
  const modes: readonly string[] = ["normal", "source-drift", "effect-drift", "provider-503", "accessor-response", "cut-after-budget", "cut-after-dispatched", "cut-after-send-intent", "cut-after-apply", "cut-after-cleanup-publication", "cut-after-conflict-publication", "cut-after-conflict-receipt-before-extension", "pause-after-dispatched"];
  const mode = journalAuthority.lifecycle.schedule as HermeticGitHubMode;
  if (
    !modes.includes(mode) ||
    journalAuthority.binding.scheduleDigest !==
      authorityDigest({
        v: "reelier.certification-hermetic-schedule/v1",
        schedule: mode,
      })
  )
    throw new TypeError("GitHub hermetic schedule commitment is invalid");
  const config = parseCertificationOperatorConfigV3(JSON.parse((await readUnlinkedFile(path.join(state.workspace, "config.json"))).toString("utf8")));
  if (config.scenarios.length !== 1 || config.scenarios[0] !== "github-issue-labels") throw new TypeError("GitHub runner requires the exact selected scenario");
  const planFile = JSON.parse((await readUnlinkedFile(path.join(state.workspace, "inputs", "plans", "github-issue-labels.json"))).toString("utf8"));
  parseCertificationScenarioPlan(planFile, config, ["github-issue-labels"]);
  const resource = config.resources["github-issue-labels"] as {
    apiBaseUrl: string;
    owner: string;
    repository: string;
    issueNumber: number;
  };
  const desired = (config.desiredState["github-issue-labels"] as { labels: readonly string[] }).labels;
  if (resource.apiBaseUrl !== "https://api.github.com") throw new TypeError("GitHub endpoint is not the reviewed endpoint");
  const activation = JSON.parse((await readUnlinkedFile(path.join(state.workspace, "authority", "delegation", "root-activation.json"))).toString("utf8"));
  const constraints = activation.signedChildGrant.grant.constraints;
  const exactAccount = constraints.connectorAccounts.some((item: any) => item.connectorId === "github" && item.accountId === "github_fixlyai_reelier");
  if (!exactAccount || !constraints.definitionAliases.includes(githubIssueLabelsAlias) || !constraints.riskClasses.includes(githubIssueLabelsRiskClass)) throw new TypeError("GitHub account, definition, or risk authority is not exact");
  const journalRoot = await ensureConfinedDirectory(state.workspace, ["authority", "github-label-runner"]);
  const ledgerRoot = await ensureConfinedDirectory(state.workspace, ["authority", "github-label-runner", "ledger"]);
  const decisionRoot = await ensureConfinedDirectory(state.workspace, ["authority", "github-label-runner", "decisions"]);
  const receiptRoot = await ensureConfinedDirectory(state.workspace, ["authority", "github-label-runner", "receipts"]);
  const portableEvidenceRoot = await ensureConfinedDirectory(state.workspace, ["authority", "github-label-runner", "portable-evidence"]);
  const evidenceAuthority = journalAuthority.lifecycle.direct.get("authority-evidence");
  if (!evidenceAuthority) throw new TypeError("authority evidence signer is absent");
  const evidenceSigner = {
    signerId: evidenceAuthority.descriptor.keyId,
    sign: (digest: string) => signAuthorityDigest(evidenceAuthority.privateKey, "authority-evidence", digest),
  };
  const attemptSigner = {
    signerId: journalAuthority.journalDescriptor.keyId,
    sign: (digest: string) => journalAuthority.signJournal(digest),
  };
  await ensureDuplicateLedger(portableEvidenceRoot, attemptSigner);
  const policyBytes = authorityCanonicalBytes({ desiredLabels: desired });
  const outcomePolicy = Object.freeze({
    schemaId: githubIssueLabelsPolicySchemaId,
    jcsBase64: policyBytes.toString("base64"),
    digest: `sha256:${createHash("sha256").update(policyBytes).digest("hex")}`,
  });
  const localGatePolicyDigest = authorityDigest({
    v: "reelier.github-certification-gate-policy/v1",
  });
  const provider = await createBrandedProvider(journalRoot, resource, desired, mode, state.now, evidenceSigner, descriptorPublicKey(evidenceAuthority.descriptor));
  const gateRuntime = await buildGate({
    state,
    activation,
    constraints,
    provider,
    ledgerRoot,
    decisionRoot,
    resource,
    desired,
  });
  const cleanupGateRuntime = await buildGate({
    state,
    activation,
    constraints,
    provider,
    ledgerRoot,
    decisionRoot,
    resource,
    desired: ["before"],
  });
  const requestIdsByReservation = new Map<string, string>(),
    cleanupRequestIdsByReservation = new Map<string, string>();
  let controlledCut: ControlledCut | undefined;
  const publication = createCertificationLifecycleReceiptPublication({
    rootDir: receiptRoot,
    lifecycle: journalAuthority.lifecycle,
    signedGrants: [activation.signedRootGrant, activation.signedChildGrant],
    now: () => state.now?.() ?? new Date(),
  });
  async function recordDuplicate(attemptRequestId: string, operationKind: "run" | "conflict" | "cleanup", original: Journal, observedAuthorityState: Readonly<Record<string, unknown>>): Promise<void> {
    await withPortableLedgerLock(portableEvidenceRoot, async () => {
      const ledger = await loadDuplicateLedger(portableEvidenceRoot),
        sequence = ledger.head.count,
        observedAt = (state.now?.() ?? new Date()).toISOString(),
        observedAuthorityStateDigest = authorityDigest(observedAuthorityState),
        attemptId = `duplicate_attempt_${authorityDigest({ attemptRequestId, operationKind, sequence, originalRequestId: original.requestId, observedAt }).slice(7, 31)}`,
        attempt = createCertificationDuplicateAttempt(
          {
            attemptId,
            attemptRequestId,
            operationKind,
            originalRequestId: original.requestId,
            observedAuthorityStateDigest,
            observedAt,
          },
          attemptSigner,
        ),
        decision = createCertificationDuplicateDecision(
          {
            attemptId,
            attemptRequestId,
            operationKind,
            originalRequestId: original.requestId,
            originalRequestDigest: original.requestDigest,
            originalEffectDigest: original.effectDigest,
            observedAuthorityState,
            observedAt,
          },
          evidenceSigner,
        ),
        attempts = [...ledger.attempts, attempt],
        decisions = [...ledger.decisions, decision],
        head = createCertificationDuplicateAttemptHead(attempts, decisions, ledger.head, attemptSigner);
      await saveDuplicateLedger(portableEvidenceRoot, {
        v: "reelier.certification-duplicate-ledger/v1",
        head,
        attempts,
        decisions,
      });
      const current = await loadJournal(journalRoot, original.requestId, journalAuthority);
      if (!current) throw new TypeError("duplicate attempt original journal is absent");
      await saveJournal(journalRoot, { ...current, duplicateAttemptHeadDigest: authorityDigest(head) }, journalAuthority);
    });
  }
  const coordinator = createDispatchCoordinator(
    gateRuntime.ledger,
    {
      async dispatch(dispatchState) {
        const requestId = requestIdsByReservation.get(dispatchState.reservation.reservationId);
        if (!requestId) throw new Error("dispatch request binding missing");
        const current = await loadJournal(journalRoot, requestId, journalAuthority);
        if (!current) throw new Error("dispatch journal missing");
        await saveJournal(journalRoot, { ...current, phase: "dispatched" }, journalAuthority);
        await testDispatchedBarrier?.(requestId);
        if (mode === "cut-after-dispatched") {
          controlledCut = new ControlledCut();
          throw controlledCut;
        }
        if (mode === "pause-after-dispatched") await new Promise((resolve) => setTimeout(resolve, 500));
        await saveJournal(journalRoot, { ...current, phase: "provider-send-intent" }, journalAuthority);
        if (mode === "cut-after-send-intent") {
          controlledCut = new ControlledCut();
          throw controlledCut;
        }
        const rawResponse = await provider.replaceLabels(dispatchState.effect, requestId);
        await saveJournal(
          journalRoot,
          {
            ...current,
            phase: "provider-applied",
            providerWrites: (await provider.snapshot()).writes,
          },
          journalAuthority,
        );
        if (mode === "cut-after-apply") {
          controlledCut = new ControlledCut();
          throw controlledCut;
        }
        const response = normalizeProviderAcknowledgment(rawResponse);
        if (response.status < 200 || response.status >= 300)
          return {
            kind: "ambiguous" as const,
            resultDigest: authorityDigest(response),
            providerStatus: response.status,
            reconciliationStatus: "not-attempted" as const,
          };
        return {
          kind: "acknowledged" as const,
          resultDigest: authorityDigest(response),
          providerStatus: response.status,
          reconciliationStatus: "not-attempted" as const,
        };
      },
      async reconcile(_state, prior) {
        if (prior.kind === "definitive-failure") return prior;
        const snapshot = await provider.snapshot();
        const matched = authorityDigest(snapshot.labels) === authorityDigest([...desired].sort());
        return {
          kind: matched ? ("acknowledged" as const) : ("ambiguous" as const),
          resultDigest: authorityDigest({
            v: "reelier.github-reconciliation/v1",
            labels: snapshot.labels,
          }),
          reconciliationStatus: matched ? ("matched" as const) : ("conflict" as const),
          normalizedProjectionDigest: authorityDigest(snapshot.labels),
        };
      },
    },
    undefined,
    publication,
  );
  const cleanupPublication = Object.freeze({
    async publish(value: Parameters<typeof publication.publish>[0]) {
      const reservationId = value.state.reservation.reservationId,
        requestId = cleanupRequestIdsByReservation.get(reservationId),
        stagedPath = path.join(journalRoot, `${reservationId}.cleanup-publication.json`);
      let publishValue = value;
      if (value.phase === "dispatch") {
        if (!requestId) throw new TypeError("cleanup publication request binding is absent");
        await writeFile(stagedPath, `${JSON.stringify(value)}\n`, {
          flag: "wx",
          mode: 0o600,
        }).catch(async (error) => {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        });
        const current = await loadJournal(journalRoot, requestId, journalAuthority);
        if (!current) throw new TypeError("cleanup publication journal is absent");
        await saveJournal(journalRoot, { ...current, phase: "cleanup-publication-pending" }, journalAuthority);
        if (mode === "cut-after-cleanup-publication") throw new ControlledCut();
      } else {
        const staged = JSON.parse((await readUnlinkedFile(stagedPath)).toString("utf8"));
        publishValue = { ...value, state: staged.state };
      }
      return publication.publish(publishValue);
    },
  });
  const cleanupCoordinator = createDispatchCoordinator(
    cleanupGateRuntime.ledger,
    {
      async dispatch(dispatchState) {
        const requestId = cleanupRequestIdsByReservation.get(dispatchState.reservation.reservationId);
        if (!requestId) throw new TypeError("cleanup request binding missing");
        let current = await loadJournal(journalRoot, requestId, journalAuthority);
        if (!current) throw new TypeError("cleanup journal is absent");
        await saveJournal(journalRoot, { ...current, phase: "cleanup-dispatched" }, journalAuthority);
        current = (await loadJournal(journalRoot, requestId, journalAuthority))!;
        await saveJournal(journalRoot, { ...current, phase: "cleanup-send-intent" }, journalAuthority);
        const restored = await provider.restore();
        current = (await loadJournal(journalRoot, requestId, journalAuthority))!;
        await saveJournal(
          journalRoot,
          {
            ...current,
            phase: "cleanup-applied",
            providerWrites: restored.writes,
          },
          journalAuthority,
        );
        return {
          kind: "acknowledged" as const,
          resultDigest: authorityDigest({
            v: "reelier.github-cleanup-result/v1",
            reservationId: dispatchState.reservation.reservationId,
            labels: restored.labels,
          }),
          providerStatus: 200,
          reconciliationStatus: "matched" as const,
          normalizedProjectionDigest: authorityDigest(restored.labels),
        };
      },
      async reconcile(_state, _outcome) {
        const snapshot = await provider.snapshot(),
          restored = authorityDigest(snapshot.labels) === authorityDigest(snapshot.before);
        return {
          kind: restored ? ("acknowledged" as const) : ("ambiguous" as const),
          resultDigest: authorityDigest({
            v: "reelier.github-cleanup-reconciliation/v1",
            labels: snapshot.labels,
          }),
          reconciliationStatus: restored ? ("matched" as const) : ("conflict" as const),
          normalizedProjectionDigest: authorityDigest(snapshot.labels),
        };
      },
    },
    undefined,
    cleanupPublication,
  );

  async function publishPendingConflict(journal: Journal): Promise<Readonly<{ receiptRef: string; evidenceDigest: string }>> {
    if (journal.phase !== "conflict-publication-pending" || !journal.exactBytesDigest) throw new TypeError("GitHub conflict publication journal is not pending");
    const reservation = await gateRuntime.ledger.getReservation(journal.reservationId);
    if (!reservation) throw new TypeError("GitHub conflict ledger reservation is absent");
    const encodedEffect = reservation.intent.effectCanonicalBase64;
    if (typeof encodedEffect !== "string") throw new TypeError("GitHub conflict ledger effect bytes are absent");
    const effect = JSON.parse(Buffer.from(encodedEffect, "base64").toString("utf8"));
    return publication.publish({
      phase: "reconcile",
      state: {
        reservation,
        effect,
        effectCanonicalBase64: encodedEffect,
        effectDigest: reservation.intent.effectDigest,
      },
      outcome: {
        kind: "ambiguous",
        resultDigest: journal.exactBytesDigest,
        reconciliationStatus: "conflict",
        normalizedProjectionDigest: journal.exactBytesDigest,
      },
      dispatchedRequestDigest: journal.exactBytesDigest,
    });
  }

  async function persistReconciledPostState(journal: Journal): Promise<void> {
    const observed = normalizeIssue(await provider.readIssue());
    await provider.recordReconciliation(journal.requestId, observed);
    await persistExactPostState(portableEvidenceRoot, journal, observed, evidenceSigner, state.now);
  }

  async function executeRun(value: Readonly<{ bearerToken: string; requestId: string }>): Promise<GitHubHermeticRunnerResult> {
    closed(value, ["bearerToken", "requestId"], "GitHub runner call");
    validateRequestId(value.requestId);
    const accessSnapshot = await state.observeHermeticGitHubState(value.bearerToken);
    const prior = await loadJournal(journalRoot, value.requestId, journalAuthority);
    if (prior) {
      await recordDuplicate(value.requestId, "run", prior, accessSnapshot.preimage);
      return view(prior);
    }
    for (const name of await readdir(journalRoot)) {
      if (!name.endsWith(".journal.json")) continue;
      const existingId = name.slice(0, -13);
      const existing = await loadJournal(journalRoot, existingId, journalAuthority);
      if (existing && ["acknowledged", "conflict", "cleanup-receipted"].includes(existing.phase)) {
        const snapshot = await provider.snapshot();
        await recordDuplicate(value.requestId, "run", existing, accessSnapshot.preimage);
        return Object.freeze({
          requestId: value.requestId,
          status: "duplicate" as const,
          success: false as const,
          providerWrites: snapshot.writes,
          reservationId: existing.reservationId,
        });
      }
    }
    const permit = await state.issueHermeticGitHubPermit(value.bearerToken);
    const permitSnapshot = state.hermeticGitHubPermitSnapshot(permit);
    const request = {
      v: "reelier.outcome-request/v1",
      requestId: value.requestId,
      sourceRefs: { issue: "issue_1" },
      choices: {},
    };
    const authenticated = authenticateOutcomeRequest({
      tenant: activation.authorityCellId,
      requester: activation.principalId,
      definitionAlias: githubIssueLabelsAlias,
      request,
      executionContext: {
        v: "reelier.authority-execution-context/v1",
        taskId: activation.taskId,
        principalId: activation.principalId,
        grantId: activation.grantId,
        grantDigest: activation.signedChildGrant.digest,
        allocationId: activation.allocationId,
        runtimeSessionId: activation.runtimeSessionId,
        jobId: activation.jobId,
        authorityCellId: activation.authorityCellId,
      },
    });
    const decided = await gateRuntime.gate.decide(authenticated);
    if (decided.kind !== "accepted") {
      const snapshot = await provider.snapshot();
      if (decided.kind === "refused" && decided.status.reasonCode === "semantic-duplicate") {
        const originals: Journal[] = [];
        for (const name of (await readdir(journalRoot)).filter((name) => name.endsWith(".journal.json"))) {
          const original = await loadJournal(journalRoot, name.slice(0, -13), journalAuthority);
          if (original) originals.push(original);
        }
        const original = originals.sort((a, b) => a.requestId.localeCompare(b.requestId))[0];
        if (!original) throw new TypeError("semantic duplicate original request is absent");
        await recordDuplicate(value.requestId, "run", original, accessSnapshot.preimage);
        return Object.freeze({
          requestId: value.requestId,
          status: "duplicate",
          success: false,
          providerWrites: snapshot.writes,
          reservationId: null,
        });
      }
      throw new Error(`GitHub AuthorityGate refused: ${JSON.stringify(decided)}`);
    }
    const reservationId = decided.signedDecision.reservationId!;
    requestIdsByReservation.set(reservationId, value.requestId);
    const reservation = await gateRuntime.ledger.getReservation(reservationId);
    if (!reservation) throw new Error("GitHub reservation missing");
    const read2 = normalizeIssue(await provider.readIssue());
    const expectedResource = read2.owner === resource.owner && read2.repo === resource.repository && read2.issueNumber === resource.issueNumber;
    const effect2 = githubIssueLabelsDefinition.compile({
      source: gateRuntime.sourceFor(read2),
      policy: parseGitHubIssueLabelsPolicy({ desiredLabels: desired }),
      choices: {},
    } as any);
    const effectDigest2 = mode === "effect-drift" ? authorityDigest({ effect2, drift: true }) : authorityDigest(effect2);
    if (permitSnapshot.adapterContractDigest !== AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST) throw new TypeError("GitHub pre-dispatch permit Adapter Contract mismatch");
    const permitSnapshotDigest = permitSnapshot.digest;
    const jobCard = JSON.parse((await readUnlinkedFile(path.join(state.workspace, "authority", "deployment", "job-card.json"))).toString("utf8"));
    const taskAuthority = createCertificationTaskAuthorityEvidence(
      {
        taskId: activation.taskId,
        signedJobCard: jobCard,
        activation,
        dispatchSnapshotPreimage: permitSnapshot.preimage,
        operatorConfigDigest: authorityDigest(config),
        taskShapeDigest: jobCard.taskShapeDigest,
        instructionsDigest: jobCard.instructionsDigest,
        runnerDigest: permitSnapshot.preimage.runner as string,
        planDigest: permitSnapshot.preimage.plan as string,
        endpointDigest: permitSnapshot.preimage.endpoint as string,
        sourceDigest: reservation.intent.sourceBundleDigest,
        policyDigest: outcomePolicy.digest,
        principalSessionDigest: authorityDigest({
          principalId: activation.principalId,
          runtimeSessionId: activation.runtimeSessionId,
        }),
        grantAllocationDigest: authorityDigest({
          rootGrantDigest: activation.signedRootGrant.digest,
          childGrantDigest: activation.signedChildGrant.digest,
          rootAllocationId: activation.rootAllocationId,
          allocationId: activation.allocationId,
        }),
        trustHeadDigest: activation.currentTrustHeadDigest,
        declaredIntent: {
          definitionAlias: githubIssueLabelsAlias,
          desiredLabels: desired,
        },
        declaredTrigger: request.sourceRefs,
      },
      evidenceSigner,
    );
    await savePortableEvidence(portableEvidenceRoot, "task-authority.json", taskAuthority);
    const projectionSchemaId = "github_issue_labels_projection_v1",
      projectionSchemaDigest = authorityDigest({
        schemaId: projectionSchemaId,
        pointers: ["/labels"],
      });
    await savePortableEvidence(
      portableEvidenceRoot,
      `post-state.${value.requestId}.pre.json`,
      createCertificationPostStateEvidence(
        {
          requestId: value.requestId,
          dispatchRequestDigest: authorityDigest(request),
          permitSnapshotDigest,
          expectedProjectionDigest: authorityDigest([...desired].sort()),
          preSourceBundleDigest: reservation.intent.sourceBundleDigest,
          projectionSchemaId,
          projectionSchemaDigest,
          preProjectionDigest: authorityDigest(read2.labels),
          observedProjectionDigest: null,
          observationMethod: "not-observed",
          observedAt: (state.now?.() ?? new Date()).toISOString(),
          confidence: "pending",
        },
        evidenceSigner,
      ),
    );
    let journal: Journal = {
      v: "reelier.github-certification-journal/v1",
      requestId: value.requestId,
      requestDigest: authorityDigest(request),
      reservationId,
      cleanupReservationId: null,
      allocationId: activation.allocationId,
      effectDigest: reservation.intent.effectDigest,
      permitSnapshotDigest,
      phase: "reserved",
      providerWrites: 0,
    };
    await saveJournal(journalRoot, journal, journalAuthority);
    const dispatchJournal = (await loadJournal(journalRoot, value.requestId, journalAuthority))!,
      dispatchHistory = await state.delegationAuthority.budget.eventsForTask(activation.taskId),
      dispatchObservedAt = (state.now?.() ?? new Date()).toISOString();
    await savePortableEvidence(
      portableEvidenceRoot,
      "task-status.dispatch.json",
      createCertificationTaskStatusEvidence(
        {
          phase: "dispatch",
          taskId: activation.taskId,
          lifecycleState: "active",
          grantExpiresAt: activation.signedChildGrant.grant.expiresAt,
          allocationRevoked: false,
          observedAt: dispatchObservedAt,
          durableHistoryDigest: authorityDigest({
            task: {
              taskId: activation.taskId,
              authorityCellId: activation.authorityCellId,
              lifecycleState: "active",
              grantExpiresAt: activation.signedChildGrant.grant.expiresAt,
              allocationRevoked: false,
            },
            grants: [activation.signedRootGrant.digest, activation.signedChildGrant.digest],
            allocation: {
              allocationId: activation.allocationId,
              parentAllocationId: activation.rootAllocationId,
              effects: activation.signedChildGrant.grant.constraints.limits.maxEffectsPerWindow,
            },
            journalDigest: authorityDigest(dispatchJournal),
            budgetEvents: dispatchHistory,
          }),
          currentActiveClaim: true,
        },
        evidenceSigner,
      ),
    );
    if (!expectedResource || effectDigest2 !== reservation.intent.effectDigest) {
      await coordinator.cancel(decided.handle, "source-or-effect-drift");
      journal = { ...journal, phase: "refused" };
      await saveJournal(journalRoot, journal, journalAuthority);
      return view(journal);
    }
    await provider.authorizeExecution({
      requestId: value.requestId,
      effect: effect2,
      permitSnapshotDigest,
      connectorRegistration: gateRuntime.connectorRegistration,
      projectionSchemaDigest,
      expectedPostProjectionDigest: authorityDigest([...desired].sort()),
      preLabels: read2.labels,
      authorityGeneration: reservation.intent.authorityStateDigest,
      authorityExpiresAt: reservation.intent.expiresAt,
    });
    await state.revalidateHermeticGitHubPermit(permit);
    journal = { ...journal, phase: "budget-intent" };
    await saveJournal(journalRoot, journal, journalAuthority);
    await state.delegationAuthority.budget.consumeOnce({
      allocationId: activation.allocationId,
      reservationId,
      effects: 1,
    });
    journal = { ...journal, phase: "budget-consumed" };
    await saveJournal(journalRoot, journal, journalAuthority);
    if (mode === "cut-after-budget") throw new ControlledCut();
    try {
      const outcome = await coordinator.dispatch(decided.handle);
      if (controlledCut) throw controlledCut;
      journal = {
        ...((await loadJournal(journalRoot, value.requestId, journalAuthority)) ?? journal),
        phase: outcome.kind === "acknowledged" ? "acknowledged" : outcome.kind === "definitive-failure" ? "failed" : "pending-reconciliation",
        providerWrites: (await provider.snapshot()).writes,
      };
      await saveJournal(journalRoot, journal, journalAuthority);
      if (journal.phase === "acknowledged") await persistReconciledPostState(journal);
      return view(journal);
    } catch (error) {
      if (error instanceof ControlledCut) throw error;
      throw error;
    }
  }
  async function run(value: Readonly<{ bearerToken: string; requestId: string }>): Promise<GitHubHermeticRunnerResult> {
    closed(value, ["bearerToken", "requestId"], "GitHub runner call");
    validateRequestId(value.requestId);
    return withRequestLock(journalRoot, value.requestId, () => executeRun(value));
  }
  async function recover(): Promise<readonly string[]> {
    const recovered: string[] = [];
    for (const name of await readdir(journalRoot)) {
      if (!name.endsWith(".journal.json")) continue;
      const requestId = name.slice(0, -13);
      await withRequestLock(journalRoot, requestId, async () => {
        const journal = await loadJournal(journalRoot, requestId, journalAuthority);
        if (!journal) return;
        const boundReservation = await gateRuntime.ledger.getReservation(journal.reservationId),
          allocation = await state.delegationAuthority.budget.get(journal.allocationId);
        if (!boundReservation || boundReservation.intent.requestDigest !== journal.requestDigest || boundReservation.intent.effectDigest !== journal.effectDigest || boundReservation.intent.executionContext?.allocationId !== journal.allocationId || !allocation || allocation.taskId !== activation.taskId || allocation.revoked) throw new TypeError("GitHub dispatch journal authority binding is invalid or tampered");
        const compatible: Record<JournalPhase, readonly string[]> = {
          reserved: ["reserved"],
          "budget-intent": ["reserved"],
          "budget-consumed": ["reserved"],
          dispatched: ["dispatched", "ambiguous"],
          "provider-send-intent": ["dispatched", "ambiguous"],
          "provider-applied": ["ambiguous", "dispatched"],
          acknowledged: ["acknowledged", "reconciled"],
          "conflict-publication-pending": ["acknowledged", "reconciled"],
          conflict: ["acknowledged", "reconciled"],
          "cleanup-reserved": ["acknowledged", "reconciled"],
          "cleanup-budget-consumed": ["acknowledged", "reconciled"],
          "cleanup-dispatched": ["acknowledged", "reconciled"],
          "cleanup-send-intent": ["acknowledged", "reconciled"],
          "cleanup-applied": ["acknowledged", "reconciled"],
          "cleanup-publication-pending": ["acknowledged", "reconciled"],
          "cleanup-receipted": ["acknowledged", "reconciled"],
          "cleanup-refused": ["acknowledged", "reconciled"],
          refused: ["cancelled", "reconciled"],
          failed: ["definitive-failure"],
          "pending-reconciliation": ["ambiguous"],
        };
        if (!compatible[journal.phase].includes(boundReservation.state)) throw new TypeError("GitHub signed journal rollback conflicts with monotonic ledger truth");
        if (journal.phase === "conflict-publication-pending") {
          const published = await publishPendingConflict(journal);
          await saveJournal(
            journalRoot,
            {
              ...journal,
              phase: "conflict",
              conflictReceiptDigest: published.receiptRef,
            },
            journalAuthority,
          );
        } else if (journal.phase.startsWith("cleanup-")) {
          if (!journal.cleanupReservationId) throw new TypeError("GitHub cleanup journal reservation binding is absent");
          cleanupRequestIdsByReservation.set(journal.cleanupReservationId, journal.requestId);
          const cleanupReservation = await cleanupGateRuntime.ledger.getReservation(journal.cleanupReservationId);
          if (!cleanupReservation || cleanupReservation.intent.executionContext?.allocationId !== journal.allocationId) throw new TypeError("GitHub cleanup journal authority binding is invalid");
          if (journal.phase === "cleanup-reserved" || journal.phase === "cleanup-budget-consumed") {
            await cleanupCoordinator.recover();
            if (journal.phase === "cleanup-budget-consumed")
              await state.delegationAuthority.budget.releaseConsumedOnce({
                allocationId: journal.allocationId,
                reservationId: journal.cleanupReservationId,
                effects: 1,
              });
            await saveJournal(journalRoot, { ...journal, phase: "cleanup-refused" }, journalAuthority);
          } else if (journal.phase !== "cleanup-receipted" && journal.phase !== "cleanup-refused") {
            if (cleanupReservation.state === "dispatched") {
              const transitioned = await cleanupGateRuntime.ledger.transition(journal.cleanupReservationId, "dispatched", { to: "ambiguous" });
              if (!transitioned.ok) throw new Error(`cleanup ambiguity recovery refused: ${transitioned.reason}`);
            }
            const currentCleanup = await cleanupGateRuntime.ledger.getReservation(journal.cleanupReservationId);
            const outcome = currentCleanup?.state === "ambiguous" ? await cleanupCoordinator.reconcile(journal.cleanupReservationId) : undefined;
            const snapshot = await provider.snapshot();
            await saveJournal(
              journalRoot,
              {
                ...journal,
                phase: outcome?.reconciliationStatus === "matched" ? "cleanup-receipted" : "cleanup-publication-pending",
                providerWrites: snapshot.writes,
              },
              journalAuthority,
            );
          }
        } else if (journal.phase === "reserved" || journal.phase === "budget-intent") {
          const reservation = await gateRuntime.ledger.getReservation(journal.reservationId);
          if (reservation?.state === "reserved") {
            const resultDigest = authorityDigest({
              v: "reelier.github-pre-network-recovery/v1",
              reservationId: journal.reservationId,
              phase: journal.phase,
            });
            const transitioned = await gateRuntime.ledger.transition(journal.reservationId, "reserved", { to: "cancelled", resultDigest });
            if (!transitioned.ok) throw new Error(`GitHub pre-network recovery refused: ${transitioned.reason}`);
          }
          await saveJournal(journalRoot, { ...journal, phase: "refused" }, journalAuthority);
        } else if (journal.phase === "budget-consumed") {
          const reservation = await gateRuntime.ledger.getReservation(journal.reservationId);
          if (reservation?.state === "reserved") {
            const resultDigest = authorityDigest({
              v: "reelier.github-pre-network-recovery/v1",
              reservationId: journal.reservationId,
              phase: journal.phase,
            });
            const transitioned = await gateRuntime.ledger.transition(journal.reservationId, "reserved", { to: "cancelled", resultDigest });
            if (!transitioned.ok) throw new Error(`GitHub consumed recovery refused: ${transitioned.reason}`);
          }
          await state.delegationAuthority.budget.releaseConsumedOnce({
            allocationId: journal.allocationId,
            reservationId: journal.reservationId,
            effects: 1,
          });
          await saveJournal(journalRoot, { ...journal, phase: "refused" }, journalAuthority);
        } else if (journal.phase === "dispatched") {
          const reservation = await gateRuntime.ledger.getReservation(journal.reservationId);
          if (reservation?.state === "ambiguous") {
            await saveJournal(journalRoot, { ...journal, phase: "pending-reconciliation" }, journalAuthority);
          } else {
            await coordinator.recover();
            await saveJournal(journalRoot, { ...journal, phase: "pending-reconciliation" }, journalAuthority);
          }
        } else if (journal.phase === "provider-send-intent" || journal.phase === "provider-applied" || journal.phase === "pending-reconciliation") {
          await coordinator.recover();
          const outcome = await coordinator.reconcile(journal.reservationId);
          const next = {
            ...journal,
            phase: outcome.reconciliationStatus === "matched" ? ("acknowledged" as const) : ("pending-reconciliation" as const),
            providerWrites: (await provider.snapshot()).writes,
          };
          await saveJournal(journalRoot, next, journalAuthority);
          if (next.phase === "acknowledged") await persistReconciledPostState(next);
        }
        recovered.push(journal.requestId);
      });
    }
    return Object.freeze(recovered);
  }
  return Object.freeze({
    run,
    recover,
    async exportGraph(value: Readonly<{ bearerToken: string }>) {
      closed(value, ["bearerToken"], "GitHub graph export call");
      await state.principalRegistry.resolve(value.bearerToken, state.now?.() ?? new Date());
      const portable = await confinedExistingDirectory(receiptRoot, ["portable"]);
      if (!portable) throw new TypeError("portable receipt store is absent");
      const unorderedReceipts = await Promise.all((await listConfinedFileNames(receiptRoot, portable)).filter((name) => name.endsWith(".json")).map(async (name) => parseAuthorityReceiptBundle(JSON.parse((await readConfinedFile(receiptRoot, portable, name)).toString("utf8")))));
      const receipts = canonicalReceiptOrder(unorderedReceipts);
      const unorderedExtensions = await loadCertificationReceiptExtensions(receiptRoot),
        extensionsByReceipt = new Map(unorderedExtensions.map((extension) => [extension.receiptDigest, extension]));
      if (extensionsByReceipt.size !== unorderedExtensions.length) throw new TypeError("portable receipt Adapter Contract extensions contain duplicate receipt digests");
      const receiptExtensions = Object.freeze(
        receipts.map((bundle) => {
          const extension = extensionsByReceipt.get(authorityDigest(bundle.receipt.value));
          if (!extension) throw new TypeError("portable receipt Adapter Contract extension is absent");
          return extension;
        }),
      );
      if (extensionsByReceipt.size !== receiptExtensions.length) throw new TypeError("portable receipt Adapter Contract extensions contain extras");
      const outcomes: Journal[] = [];
      for (const name of (await readdir(journalRoot)).filter((name) => name.endsWith(".journal.json")).sort()) outcomes.push(...(await loadJournalHistory(journalRoot, name.slice(0, -13), journalAuthority)));
      const rootAllocation = await state.delegationAuthority.budget.get(activation.rootAllocationId),
        allocation = await state.delegationAuthority.budget.get(activation.allocationId);
      if (!rootAllocation || !allocation) throw new TypeError("GitHub graph allocation is absent");
      const rawBudgetEvents = await state.delegationAuthority.budget.eventsForTask(activation.taskId);
      const budgetEvents: any[] = [];
      for (const [sequence, event] of rawBudgetEvents.entries())
        budgetEvents.push(
          Object.freeze({
            sequence,
            priorBudgetEventDigest: sequence === 0 ? null : authorityDigest(budgetEvents[sequence - 1]),
            event,
          }),
        );
      const terminalOutcomes = outcomes.filter((item, index) => outcomes[index + 1]?.requestId !== item.requestId);
      if (terminalOutcomes.some((item) => item.phase === "conflict-publication-pending")) throw new TypeError("portable conflict receipt lifecycle is pending journal completion");
      const exceptions = terminalOutcomes
        .filter((item) => item.phase === "failed" || item.phase === "pending-reconciliation" || item.phase === "conflict")
        .map((item) =>
          item.phase === "conflict"
            ? {
                kind: "conflict",
                requestId: item.requestId,
                exactBytesDigest: item.exactBytesDigest,
                receiptDigest: item.conflictReceiptDigest,
              }
            : {
                kind: item.phase,
                requestId: item.requestId,
                outcomeDigest: authorityDigest(journalBody(item)),
              },
        );
      const taskAuthorities = await loadPortableEvidence(portableEvidenceRoot, (name) => name === "task-authority.json");
      const prePost = await loadPortableEvidence(portableEvidenceRoot, (name) => /^post-state\..+\.pre\.json$/.test(name)),
        exactPost = await loadPortableEvidence(portableEvidenceRoot, (name) => /^post-state\..+\.exact\.json$/.test(name)),
        exactByRequest = new Map(exactPost.map((item) => [item.requestId, item]));
      const postStateEvidence = Object.freeze(prePost.map((item) => exactByRequest.get(item.requestId) ?? item));
      if (exactByRequest.size > postStateEvidence.length) throw new TypeError("portable post-state exact evidence has no pre-dispatch commitment");
      const policyEvidence = createCertificationPolicyEvidence(
        {
          outcomeContract: outcomePolicy,
          localGatePolicyDigest,
          authorityStatePreimage: gateRuntime.authorityStatePreimage,
        },
        evidenceSigner,
      );
      const dispatchStatus = await loadPortableEvidence(portableEvidenceRoot, (name) => name === "task-status.dispatch.json");
      const taskState = await state.delegationAuthority.taskStatus({
        tenant: activation.authorityCellId,
        requester: activation.signedRootGrant.grant.sponsor,
        taskId: activation.taskId,
      });
      const exportObservedAt = (state.now?.() ?? new Date()).toISOString(),
        exportLifecycle = taskState.lifecycleState === "active" && !allocation.revoked && Date.parse(activation.signedChildGrant.grant.expiresAt) > Date.parse(exportObservedAt) ? "active" : allocation.revoked ? "revoked" : Date.parse(activation.signedChildGrant.grant.expiresAt) <= Date.parse(exportObservedAt) ? "expired" : "inactive";
      const exportStatus = createCertificationTaskStatusEvidence(
        {
          phase: "export",
          taskId: activation.taskId,
          lifecycleState: exportLifecycle,
          grantExpiresAt: activation.signedChildGrant.grant.expiresAt,
          allocationRevoked: allocation.revoked,
          observedAt: exportObservedAt,
          durableHistoryDigest: authorityDigest({
            task: {
              taskId: activation.taskId,
              authorityCellId: activation.authorityCellId,
              lifecycleState: exportLifecycle,
              grantExpiresAt: activation.signedChildGrant.grant.expiresAt,
              allocationRevoked: allocation.revoked,
            },
            grants: [activation.signedRootGrant.digest, activation.signedChildGrant.digest],
            allocation: {
              allocationId: allocation.allocationId,
              parentAllocationId: allocation.parentAllocationId,
              effects: allocation.effects,
            },
            journalDigests: terminalOutcomes.map((item) => authorityDigest(item)),
            budgetEvents: rawBudgetEvents,
          }),
          currentActiveClaim: exportLifecycle === "active",
        },
        evidenceSigner,
      );
      const taskStatusEvidence = Object.freeze([...dispatchStatus, exportStatus]);
      const duplicateLedger = await loadDuplicateLedger(portableEvidenceRoot),
        duplicateAttempts = duplicateLedger.attempts,
        duplicateDecisions = duplicateLedger.decisions,
        duplicateAttemptHead = duplicateLedger.head;
      const providerSnapshot = await provider.snapshot(), currentTrustPin = inertRecord(JSON.parse((await readUnlinkedFile(state.currentTrustPinPath)).toString("utf8")), "GitHub current trust pin") as any,
        currentTrustEvents = inertArray(currentTrustPin.currentTrustEvents, "GitHub current trust events") as readonly any[], latestTrustEvent = currentTrustEvents.at(-1);
      if (!latestTrustEvent || typeof latestTrustEvent.occurredAt !== "string") throw new TypeError("GitHub current trust observation is absent");
      const priorReceiptLinks = Object.freeze(receipts.map(bundle => Object.freeze({ receiptDigest: authorityDigest(bundle.receipt.value), priorReceiptDigest: bundle.receipt.value.priorReceiptDigest })));
      const portableOutcomeEvidence = Object.freeze(postStateEvidence.map((post: any) => {
        const execution = providerSnapshot.executions.find((item: any) => item.requestId === post.requestId), outcome = [...terminalOutcomes].reverse().find(item => item.requestId === post.requestId);
        if (!execution || !outcome || execution.status !== "reconciled" || !execution.routeAuthoritySnapshot || !execution.authenticatedIdentity || !execution.portableRouteAuthority || !execution.portableAuthenticatedIdentity || !execution.materializedRequest || !execution.responseSemanticsProfile || !execution.preStateEvidence || !execution.postStateEvidence || !execution.reconciliation || !execution.responseSemanticsProfile.acknowledgedStatuses?.includes(execution.responseStatus) || authorityDigest(execution.postStateEvidence.projection) !== post.observedProjectionDigest || execution.expectedPostProjectionDigest !== post.expectedProjectionDigest) throw new TypeError("durable executed portable runtime provenance is absent or inconsistent");
        const receiptChain = Object.freeze(receipts.filter(bundle => {
          const requestId = bundle.receipt.value.decisionContext.requestId;
          return requestId === post.requestId || requestId === `${post.requestId}.cleanup`;
        }).map(bundle => authorityDigest(bundle.receipt.value)));
        const collectionCounts = Object.freeze({ receipts: receipts.length, receiptExtensions: receiptExtensions.length, portableOutcomeEvidence: postStateEvidence.length, postStateEvidence: postStateEvidence.length, outcomes: outcomes.length, requestReceipts: receiptChain.length });
        const terminalDigest = authorityDigest({ v: "reelier.portable-terminal-anchor/v1", taskId: activation.taskId, rootGrantDigest: activation.signedRootGrant.digest, receiptLinksDigest: authorityDigest(priorReceiptLinks), postStateEvidenceDigest: authorityDigest(postStateEvidence), collectionCountsDigest: authorityDigest(collectionCounts) });
        const currentTrustObservation = Object.freeze({ v: "reelier.portable-current-trust-observation/v1" as const, observedAt: latestTrustEvent.occurredAt, expiresAt: activation.signedChildGrant.grant.expiresAt, activeAuthorityEvidenceSignerIds: Object.freeze([evidenceSigner.signerId]) });
        return createPortableOutcomeEvidencePublication({ requestId: post.requestId, routeAuthority: execution.portableRouteAuthority, authenticatedIdentity: execution.portableAuthenticatedIdentity, materializedRequest: execution.materializedRequest, responseSemanticsProfile: execution.responseSemanticsProfile, preStateEvidence: execution.preStateEvidence, postStateEvidence: execution.postStateEvidence, expectedPostProjectionDigest: execution.expectedPostProjectionDigest, confidence: post.confidence, authoritativeStateSource: "hermetic-github-fixture", reconciliation: execution.reconciliation, cleanupParentReceiptDigest: execution.cleanupParentReceiptDigest, receiptChain, collectionCounts, terminalDigest, currentTrustObservation, executionSigner: evidenceSigner, reconciliationSigner: evidenceSigner });
      }));
      return createCertificationTaskReceiptGraph({
        taskId: activation.taskId,
        authorityCellId: activation.authorityCellId,
        rootGrant: activation.signedRootGrant,
        grants: [activation.signedRootGrant, activation.signedChildGrant],
        principals: [
          {
            principalId: activation.signedRootGrant.grant.grantee,
            runtimeSessionId: null,
          },
          {
            principalId: activation.principalId,
            runtimeSessionId: activation.runtimeSessionId,
          },
        ],
        allocations: [rootAllocation, allocation],
        budgetEvents,
        outcomes,
        exceptions,
        receipts,
        receiptExtensions,
        taskAuthorities,
        postStateEvidence,
        portableOutcomeEvidence,
        policyEvidence,
        taskStatusEvidence,
        duplicateAttemptHead,
        duplicateAttempts,
        duplicateDecisions,
        binding: journalAuthority.binding,
        commitment: journalAuthority.commitment,
        keyDescriptors: journalAuthority.keyDescriptors,
        signedReadiness: journalAuthority.signedReadiness,
        terminalSigner: evidenceSigner,
      });
    },
    async conflict(
      value: Readonly<{
        bearerToken: string;
        requestId: string;
        exactBytes: string;
      }>,
    ) {
      closed(value, ["bearerToken", "requestId", "exactBytes"], "GitHub conflict call");
      validateRequestId(value.requestId);
      const decoded = Buffer.from(value.exactBytes, "base64");
      if (decoded.length === 0 || decoded.toString("base64") !== value.exactBytes) throw new TypeError("GitHub conflict exact bytes must be canonical nonempty base64");
      const exactBytesDigest = authorityDigest({
        v: "reelier.exact-conflicting-bytes/v1",
        base64: value.exactBytes,
      });
      return withRequestLock(journalRoot, value.requestId, async () => {
        const accessSnapshot = await state.observeHermeticGitHubState(value.bearerToken);
        const snapshot = await provider.snapshot();
        let prior = await loadJournal(journalRoot, value.requestId, journalAuthority);
        if (!prior) throw new TypeError("GitHub conflict requires an existing request");
        if (prior.phase === "conflict" || prior.phase === "conflict-publication-pending") {
          if (prior.exactBytesDigest !== exactBytesDigest) throw new TypeError("GitHub conflict exact bytes changed after terminal commitment");
          if (prior.phase === "conflict") {
            await recordDuplicate(value.requestId, "conflict", prior, accessSnapshot.preimage);
            return view(prior);
          }
        } else {
          if (prior.phase !== "acknowledged") throw new TypeError("GitHub conflict requires an acknowledged request");
          prior = {
            ...prior,
            phase: "conflict-publication-pending",
            exactBytesDigest,
            conflictReceiptDigest: null,
            providerWrites: snapshot.writes,
          };
          await saveJournal(journalRoot, prior, journalAuthority);
          prior = (await loadJournal(journalRoot, value.requestId, journalAuthority))!;
        }
        const published = await publishPendingConflict(prior);
        if (mode === "cut-after-conflict-publication") throw new ControlledCut();
        const committed = {
          ...prior,
          phase: "conflict" as const,
          conflictReceiptDigest: published.receiptRef,
        };
        await saveJournal(journalRoot, committed, journalAuthority);
        return view(committed);
      });
    },
    async cleanup(value: Readonly<{ bearerToken: string; requestId: string }>) {
      closed(value, ["bearerToken", "requestId"], "GitHub cleanup call");
      let journal = await loadJournal(journalRoot, value.requestId, journalAuthority);
      if (journal?.phase === "cleanup-receipted") {
        const accessSnapshot = await state.observeHermeticGitHubState(value.bearerToken);
        await recordDuplicate(value.requestId, "cleanup", journal, accessSnapshot.preimage);
        const snapshot = await provider.snapshot();
        return Object.freeze({ ...view(journal), labels: snapshot.labels });
      }
      const accessPermit = await state.issueHermeticGitHubPermit(value.bearerToken);
      await state.revalidateHermeticGitHubPermit(accessPermit);
      if (!journal || journal.phase !== "acknowledged") throw new TypeError("GitHub cleanup requires authoritative reconciliation and acknowledged apply");
      const cleanupId = `${value.requestId}.cleanup`,
        request = {
          v: "reelier.outcome-request/v1",
          requestId: cleanupId,
          sourceRefs: { issue: "issue_1" },
          choices: {},
        };
      const authenticated = authenticateOutcomeRequest({
        tenant: activation.authorityCellId,
        requester: activation.principalId,
        definitionAlias: githubIssueLabelsAlias,
        request,
        executionContext: {
          v: "reelier.authority-execution-context/v1",
          taskId: activation.taskId,
          principalId: activation.principalId,
          grantId: activation.grantId,
          grantDigest: activation.signedChildGrant.digest,
          allocationId: activation.allocationId,
          runtimeSessionId: activation.runtimeSessionId,
          jobId: activation.jobId,
          authorityCellId: activation.authorityCellId,
        },
      });
      const decided = await cleanupGateRuntime.gate.decide(authenticated);
      if (decided.kind !== "accepted") throw new TypeError(`GitHub cleanup authority refused: ${decided.kind}`);
      const cleanupReservationId = decided.signedDecision.reservationId!;
      cleanupRequestIdsByReservation.set(cleanupReservationId, value.requestId);
      journal = { ...journal, cleanupReservationId, phase: "cleanup-reserved" };
      await saveJournal(journalRoot, journal, journalAuthority);
      await state.delegationAuthority.budget.consumeOnce({
        allocationId: activation.allocationId,
        reservationId: cleanupReservationId,
        effects: 1,
      });
      journal = (await loadJournal(journalRoot, value.requestId, journalAuthority))!;
      await saveJournal(journalRoot, { ...journal, phase: "cleanup-budget-consumed" }, journalAuthority);
      const outcome = await cleanupCoordinator.dispatch(decided.handle);
      if (outcome.kind !== "acknowledged" || outcome.reconciliationStatus !== "matched") throw new TypeError("GitHub cleanup is ambiguous and remains budget-consumed");
      await provider.recordCleanupParent(value.requestId, outcome.priorReceiptDigest ?? null);
      const snapshot = await provider.snapshot();
      journal = (await loadJournal(journalRoot, value.requestId, journalAuthority))!;
      const cleaned = {
        ...journal,
        phase: "cleanup-receipted" as const,
        providerWrites: snapshot.writes,
      };
      await saveJournal(journalRoot, cleaned, journalAuthority);
      return Object.freeze({ ...view(cleaned), labels: snapshot.labels });
    },
    async status(value: Readonly<{ bearerToken: string; requestId: string }>) {
      closed(value, ["bearerToken", "requestId"], "GitHub runner status call");
      validateRequestId(value.requestId);
      await state.principalRegistry.resolve(value.bearerToken, state.now?.() ?? new Date());
      const journal = await loadJournal(journalRoot, value.requestId, journalAuthority);
      if (!journal) throw new TypeError("GitHub runner request not found");
      return view(journal);
    },
  });
}

async function savePortableEvidence(root: string, name: string, value: unknown): Promise<void> {
  await publishPrivateContentAddressed(path.dirname(root), path.basename(root), name, `${JSON.stringify(value)}\n`);
}

async function loadPortableEvidence(root: string, select: (name: string) => boolean): Promise<any[]> {
  const values: any[] = [];
  for (const name of (await listConfinedFileNames(root, root)).filter(select).sort()) values.push(JSON.parse((await readConfinedFile(root, root, name)).toString("utf8")));
  return values;
}

type DuplicateLedger = Readonly<{ v: "reelier.certification-duplicate-ledger/v1"; head: any; attempts: readonly any[]; decisions: readonly any[] }>;
async function ensureDuplicateLedger(root: string, signer: any): Promise<void> {
  try {
    await readConfinedFile(root, root, "duplicate-ledger.json");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const head = createCertificationDuplicateAttemptHead([], [], null, signer);
    await saveDuplicateLedger(root, { v: "reelier.certification-duplicate-ledger/v1", head, attempts: [], decisions: [] });
  }
}
async function loadDuplicateLedger(root: string): Promise<DuplicateLedger> {
  const raw = JSON.parse((await readConfinedFile(root, root, "duplicate-ledger.json")).toString("utf8"));
  if (!raw || raw.v !== "reelier.certification-duplicate-ledger/v1" || !raw.head || !Array.isArray(raw.attempts) || !Array.isArray(raw.decisions)) throw new TypeError("durable duplicate ledger is invalid");
  return Object.freeze(raw);
}
async function saveDuplicateLedger(root: string, value: DuplicateLedger): Promise<void> {
  const file = path.join(root, "duplicate-ledger.json"),
    temporary = `${file}.${randomUUID()}.tmp`,
    handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
}
async function withPortableLedgerLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const lock = path.join(root, "duplicate-ledger.lock");
  let handle;
  for (;;) {
    try {
      handle = await open(lock, "wx", 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  try {
    await handle.writeFile(`${process.pid}\n`);
    await handle.sync();
    return await operation();
  } finally {
    await handle.close();
    await unlink(lock).catch(() => undefined);
  }
}

async function persistExactPostState(root: string, journal: Journal, observed: Issue, signer: Parameters<typeof createCertificationPostStateEvidence>[1], now?: () => Date): Promise<void> {
  const [pre] = await loadPortableEvidence(root, (name) => name === `post-state.${journal.requestId}.pre.json`);
  if (!pre) throw new TypeError("portable post-state pre-dispatch commitment is absent");
  const exact = createCertificationPostStateEvidence(
    {
      requestId: journal.requestId,
      dispatchRequestDigest: journal.requestDigest,
      permitSnapshotDigest: journal.permitSnapshotDigest,
      expectedProjectionDigest: pre.expectedProjectionDigest,
      preSourceBundleDigest: pre.preSourceBundleDigest,
      projectionSchemaId: pre.projectionSchemaId,
      projectionSchemaDigest: pre.projectionSchemaDigest,
      preProjectionDigest: pre.preProjectionDigest,
      observedProjectionDigest: authorityDigest(observed.labels),
      observationMethod: "hermetic-authoritative-read",
      observedAt: (now?.() ?? new Date()).toISOString(),
      confidence: "exact",
    },
    signer,
  );
  await savePortableEvidence(root, `post-state.${journal.requestId}.exact.json`, exact);
}

async function buildGate(input: any) {
  assertLinuxAuthorityCellHost();
  const authority = input.state.hermeticGitHubAuthority();
  const grant = input.activation.signedChildGrant.grant,
    rootGrant = input.activation.signedRootGrant.grant,
    policyBytes = authorityCanonicalBytes({ desiredLabels: input.desired });
  const accountId = "github_fixlyai_reelier";
  const contract = {
    v: "reelier.outcome-contract/v1",
    tenant: input.activation.authorityCellId,
    alias: githubIssueLabelsAlias,
    contractId: "github_certification_contract",
    validFrom: grant.issuedAt,
    validUntil: grant.expiresAt,
    packDigest: githubIssueLabelsPackDigest,
    definitionDigest: githubIssueLabelsDefinitionDigest,
    sponsor: grant.sponsor,
    audiences: [input.activation.principalId],
    delegationGrantDigest: input.activation.signedChildGrant.digest,
    connectorId: "github",
    accountId,
    sourceAuthority: {
      resolverId: githubIssueLabelsResolverId,
      projectionSchemaId: "github_issue_labels_projection_v1",
      allowedReadEndpointIds: [githubIssueLabelsReadEndpointId],
      authorizedProjectionPointers: ["/owner", "/repo", "/issueNumber", "/issueState", "/labels"],
      maxFreshnessSeconds: 60,
    },
    riskClasses: [githubIssueLabelsRiskClass],
    limits: input.constraints.limits,
    policyCommitment: {
      schemaId: githubIssueLabelsPolicySchemaId,
      jcsBase64: policyBytes.toString("base64"),
      digest: `sha256:${createHash("sha256").update(policyBytes).digest("hex")}`,
    },
  };
  const contractDigest = authorityDigest(contract),
    candidate = {
      contractEnvelope: envelope(contract, contractDigest, authority.contractDescriptor.keyId, null, "outcome-contract", authority.signContract(contractDigest)),
      delegationEnvelopes: [envelope(rootGrant, input.activation.signedRootGrant.digest, input.activation.signedRootGrant.signerId, null, "delegation-grant", input.activation.signedRootGrant.signature, 0), envelope(grant, input.activation.signedChildGrant.digest, input.activation.signedChildGrant.signerId, null, "delegation-grant", input.activation.signedChildGrant.signature, 1)],
      stateEvents: [{ index: 0, kind: "activated", contractDigest, at: grant.issuedAt }],
    };
  const trustRoots = createTrustRoots([
    {
      tenant: input.activation.authorityCellId,
      signerId: authority.contractDescriptor.keyId,
      principalId: input.activation.principalId,
      publicKey: descriptorPublicKey(authority.contractDescriptor),
      purposes: ["outcome-contract"],
    },
    {
      tenant: input.activation.authorityCellId,
      signerId: input.activation.signedRootGrant.signerId,
      principalId: rootGrant.grantor,
      publicKey: publicKeyFromPin(input.state.currentTrustPinPath, input.activation.signedRootGrant.signerId),
      purposes: ["delegation-grant"],
    },
    {
      tenant: input.activation.authorityCellId,
      signerId: authority.gateDescriptor.keyId,
      principalId: input.activation.principalId,
      publicKey: descriptorPublicKey(authority.gateDescriptor),
      purposes: ["gate-event"],
    },
  ]);
  validateContractAgainstDelegation(
    contract as any,
    validateDelegationChain({
      tenant: input.activation.authorityCellId,
      sponsor: contract.sponsor,
      now: input.state.now?.() ?? new Date(),
      trustRoots,
      grants: [input.activation.signedRootGrant, input.activation.signedChildGrant],
    }),
  );
  const connectorRegistration = Object.freeze({
        tenant: input.activation.authorityCellId,
        connectorId: "github",
        accountId,
        providerAccountIdentity: accountId,
        allowedReadEndpointIds: [githubIssueLabelsReadEndpointId],
        allowedWriteEndpointIds: [githubIssueLabelsWriteEndpointId],
        riskClasses: [githubIssueLabelsRiskClass],
        operatorConfigurationDigest: authorityDigest({
          resource: input.resource,
        }),
      });
  const packs = createStaticPackRegistry([githubIssueLabelsDefinition]),
    sources = createSourceRegistry([createGitHubIssueLabelsSourceResolver(input.activation.authorityCellId)]),
    connectors = createConnectorRegistry([connectorRegistration]);
  const ledger = new FsAuthorityLedger(input.ledgerRoot, {
    now: () => input.state.now?.().getTime() ?? Date.parse("2026-08-11T20:10:00.000Z"),
  });
  const sourceFor = (issue: Issue) => ({
    projection: issue,
    digest: authorityDigest(issue),
  });
  const candidateSet = {
    tenant: input.activation.authorityCellId,
    definitionAlias: githubIssueLabelsAlias,
    stateVersion: 1,
    candidates: [candidate],
  } as any;
  const statePort = createAuthorityStatePort({
    async loadCompleteContractSet() {
      return { ok: true as const, snapshot: candidateSet, backendToken: {} };
    },
    async advanceVersion() {
      return { ok: true as const, backendObservedToken: {} };
    },
    async withCurrent(_token, callback) {
      return { ok: true as const, value: await callback() };
    },
    async executeSourceReads(plans) {
      const issue = await input.provider.readIssue();
      return {
        ok: true as const,
        observations: plans.map((plan: any) => ({
          planDigest: plan.planDigest,
          rawBytes: Buffer.from(JSON.stringify(issue)),
        })),
      };
    },
  });
  const localGatePolicyDigest = authorityDigest({
    v: "reelier.github-certification-gate-policy/v1",
  });
  const authorityStatePreimage = digestAuthorityState({
    snapshot: candidateSet,
    trustRoots,
    packs,
    sources,
    connectors,
    localGatePolicyDigest,
  }).preimage;
  const gate = createAuthorityGate({
    trustRoots,
    packs,
    sources,
    connectors,
    state: statePort,
    ledger,
    localGatePolicyDigest,
    decisionSink: createFileGateDecisionSink(input.decisionRoot),
    signer: {
      async sign(value) {
        if (value.purpose !== "gate-event") throw new TypeError("GitHub gate signer purpose is invalid");
        return {
          signerId: authority.gateDescriptor.keyId,
          signature: authority.signGate(value.digest),
        };
      },
    },
    eventId: () => `evt_${randomUUID()}`,
    capabilityId: () => `cap_${randomUUID()}`,
  });
  return { gate, ledger, sourceFor, authorityStatePreimage, connectorRegistration };
}

async function createBrandedProvider(root: string, resource: any, desired: readonly string[], mode: HermeticGitHubMode, now: (() => Date) | undefined, signer: Readonly<{ signerId: string; sign(digest: string): any }>, signerPublicKey: ReturnType<typeof createPublicKey>) {
  const file = path.join(root, "provider-state.json");
  let reads = 0;
  const profile = Object.freeze({ v: "reelier.http-response-semantics/v1" as const, profileId: "github.issue-labels.hermetic-v1", acknowledgedStatuses: Object.freeze([200]) });
  function seal(body: any) { return Object.freeze({ ...body, signerId: signer.signerId, signature: signer.sign(authorityDigest(body)) }); }
  function verifyExecution(value: any): any { const { signerId, signature, ...body } = value ?? {}; if (signerId !== signer.signerId || !signature || !verifyAuthoritySignature(signerPublicKey, "authority-evidence", authorityDigest(body), signature)) throw new TypeError("GitHub execution provenance signature is invalid or tampered"); return value; }
  async function load() {
    try {
      const raw = inertRecord(JSON.parse((await readUnlinkedFile(file)).toString("utf8")), "GitHub provider state");
      exact(raw, ["v", "before", "labels", "writes", "executions"], "GitHub provider state");
      if (raw.v !== "reelier.github-hermetic-provider/v3") throw new TypeError(raw.v === "reelier.github-hermetic-provider/v2" ? "GitHub provider v2 provenance cannot be migrated safely; rerun the hermetic execution" : "GitHub provider state provenance version is unsupported");
      const executions = inertArray(raw.executions, "GitHub provider executions").map(verifyExecution);
      return {
        before: normalizeLabels(raw.before),
        labels: normalizeLabels(raw.labels),
        writes: raw.writes as number,
        executions: Object.freeze(executions),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const initial = {
        before: Object.freeze(["before"]),
        labels: Object.freeze(["before"]),
        writes: 0,
        executions: Object.freeze([]),
      };
      await persist(initial);
      return initial;
    }
  }
  async function persist(state: { before: readonly string[]; labels: readonly string[]; writes: number; executions: readonly any[] }) {
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify({ v: "reelier.github-hermetic-provider/v3", ...state })}\n`, { flag: "wx", mode: 0o600 });
    await rename(temp, file);
  }
  await load();
  async function replaceExecution(requestId: string, update: (value: any) => any): Promise<any> { const state = await load(), index = state.executions.findIndex((item: any) => item.requestId === requestId); if (index < 0) throw new TypeError("GitHub signed execution provenance is absent"); const executions = [...state.executions], next = seal(update(executions[index])); executions[index] = next; await persist({ ...state, executions: Object.freeze(executions) }); return next; }
  return Object.freeze({
    async readIssue() {
      reads += 1;
      const state = await load();
      return normalizeIssue({
        owner: resource.owner,
        repo: resource.repository,
        issueNumber: resource.issueNumber,
        issueState: "open",
        labels: mode === "source-drift" && reads === 2 ? ["drifted"] : state.labels,
      });
    },
    async authorizeExecution(input: any) {
      const state = await load();
      if (state.executions.some((item: any) => item.requestId === input.requestId)) return state.executions.find((item: any) => item.requestId === input.requestId);
      const effect = inertRecord(input.effect, "GitHub authorized transport effect") as any;
      exact(effect, ["v", "endpointId", "method", "path", "query", "headers", "bodyBase64", "riskClass", "idempotency", "preconditions", "reconciliation"], "GitHub executed transport effect");
      const body = Buffer.from(String(effect.bodyBase64), "base64"), materializedRequest = buildMaterializedHttpRequestProjection({ baseUrl: resource.apiBaseUrl } as any, effect.method, effect.path, effect.query, effect.headers, body);
      const observedAt = (now?.() ?? new Date()).toISOString(), routeDescriptor = Object.freeze({ v: "reelier.github-hermetic-authorized-route/v1", providerId: "github", connectorId: input.connectorRegistration.connectorId, accountId: input.connectorRegistration.accountId, providerAccountIdentity: input.connectorRegistration.providerAccountIdentity, endpointId: effect.endpointId, origin: materializedRequest.origin, method: materializedRequest.method, path: materializedRequest.normalizedPath, responseSemanticsProfileDigest: authorityDigest(profile) }), routeDigest = authorityDigest(routeDescriptor), readRouteDigest = authorityDigest({ v: "reelier.github-hermetic-authorized-read-route/v1", providerId: "github", endpointId: githubIssueLabelsReadEndpointId, origin: resource.apiBaseUrl, owner: resource.owner, repository: resource.repository, issueNumber: resource.issueNumber, projectionSchemaDigest: input.projectionSchemaDigest }), credentialSlotId = "github-hermetic-provider", slotInstanceId = authorityDigest({ v: "reelier.github-hermetic-provider-session/v1", requestId: input.requestId, permitSnapshotDigest: input.permitSnapshotDigest }), slotVersion = "1";
      const identityBody = Object.freeze({ v: "reelier.authenticated-provider-identity/v1" as const, providerId: "github" as const, credentialSlotId, slotInstanceId, slotVersion, slotExpiresAt: input.authorityExpiresAt, providerAccountId: input.connectorRegistration.accountId, providerLogin: resource.owner, routeDigest, observedAt }), authenticatedIdentity = Object.freeze({ ...identityBody, signerId: signer.signerId, signature: signer.sign(authorityDigest(identityBody)) });
      const routeAuthoritySnapshot = Object.freeze({ v: "reelier.route-authority-snapshot/v1" as const, connectorRegistrationDigest: authorityDigest(input.connectorRegistration), operatorConfigurationDigest: input.connectorRegistration.operatorConfigurationDigest, routeDigest, providerId: "github", connectorId: input.connectorRegistration.connectorId, accountId: input.connectorRegistration.accountId, providerAccountIdentity: input.connectorRegistration.providerAccountIdentity, endpointId: effect.endpointId, credentialSlotId, slotInstanceId, slotVersion, authenticatedProviderIdentityDigest: authorityDigest(identityBody), sourceReadRouteDigest: readRouteDigest, projectionSchemaDigest: input.projectionSchemaDigest, expectedMaterializedRequestDigest: authorityDigest(materializedRequest), authorityGeneration: input.authorityGeneration, authorityExpiresAt: input.authorityExpiresAt });
      const accountDigest = authorityDigest({ v: "reelier.portable-provider-account/v1", providerId: "github", connectorId: routeAuthoritySnapshot.connectorId, accountId: routeAuthoritySnapshot.accountId, providerAccountIdentity: routeAuthoritySnapshot.providerAccountIdentity });
      const portableRouteAuthority = Object.freeze({ v: "reelier.portable-route-authority/v1" as const, writeRouteDigest: routeAuthoritySnapshot.routeDigest, readRouteDigest: routeAuthoritySnapshot.sourceReadRouteDigest, accountDigest, authenticatedProviderIdentityDigest: routeAuthoritySnapshot.authenticatedProviderIdentityDigest, expectedMaterializedRequestDigest: routeAuthoritySnapshot.expectedMaterializedRequestDigest, responseSemanticsProfileDigest: authorityDigest(profile), projectionSchemaDigest: routeAuthoritySnapshot.projectionSchemaDigest });
      const portableAuthenticatedIdentity = Object.freeze({ v: "reelier.portable-authenticated-identity/v1" as const, identityDigest: routeAuthoritySnapshot.authenticatedProviderIdentityDigest, providerId: "github" as const, accountDigest, routeDigest: routeAuthoritySnapshot.routeDigest, observedAt: authenticatedIdentity.observedAt });
      const preStateEvidence = Object.freeze({ v: "reelier.portable-comparable-state/v1" as const, readRouteDigest, accountDigest, projectionSchemaDigest: input.projectionSchemaDigest, projection: Object.freeze([...input.preLabels]), complete: true as const, observedAt });
      const execution = seal({ v: "reelier.github-executed-runtime-provenance/v2", requestId: input.requestId, status: "authorized", routeAuthoritySnapshot, authenticatedIdentity, portableRouteAuthority, portableAuthenticatedIdentity, materializedRequest, responseSemanticsProfile: profile, preStateEvidence, postStateEvidence: null, expectedPostProjectionDigest: input.expectedPostProjectionDigest, reconciliation: null, cleanupParentReceiptDigest: null, beforeWriteCount: state.writes, afterWriteCount: state.writes, sendCount: 0, responseStatus: null });
      await persist({ ...state, executions: Object.freeze([...state.executions, execution]) });
      return execution;
    },
    async replaceLabels(effectValue: unknown, requestId: string) {
      const state = await load(), current = state.executions.find((item: any) => item.requestId === requestId);
      if (!current) throw new TypeError("GitHub execution authorization is absent");
      const effect = inertRecord(effectValue, "GitHub executed transport effect") as any;
      exact(effect, ["v", "endpointId", "method", "path", "query", "headers", "bodyBase64", "riskClass", "idempotency", "preconditions", "reconciliation"], "GitHub executed transport effect");
      const materializedRequest = buildMaterializedHttpRequestProjection({ baseUrl: resource.apiBaseUrl } as any, effect.method, effect.path, effect.query, effect.headers, Buffer.from(String(effect.bodyBase64), "base64"));
      if (authorityDigest(materializedRequest) !== authorityDigest(current.materializedRequest)) throw new TypeError("GitHub execution differs from signed materialized request provenance");
      const status = mode === "provider-503" ? 503 : 200, writes = state.writes + 1, executed = seal({ ...withoutSeal(current), status: "executed", afterWriteCount: writes, sendCount: current.sendCount + 1, responseStatus: status });
      await persist({ ...state, labels: Object.freeze([...desired].sort()), writes, executions: Object.freeze(state.executions.map((item: any) => item.requestId === requestId ? executed : item)) });
      if (mode === "accessor-response")
        return Object.create(Object.prototype, {
          status: {
            enumerable: true,
            get() {
              throw new Error("accessor must not execute");
            },
          },
          acknowledgmentId: { enumerable: true, value: "ack" },
        });
      return {
        status,
        acknowledgmentId: "ack_1",
      };
    },
    async recordReconciliation(requestId: string, observed: Issue) {
      return replaceExecution(requestId, current => { const reconciliation = Object.freeze({ verdict: authorityDigest(observed.labels) === current.expectedPostProjectionDigest ? "matched" : "conflict", providerWriteCount: current.afterWriteCount - current.beforeWriteCount, resendCount: Math.max(0, current.sendCount - 1), observedProjectionDigest: authorityDigest(observed.labels) }), postStateEvidence = Object.freeze({ v: "reelier.portable-comparable-state/v1" as const, readRouteDigest: current.portableRouteAuthority.readRouteDigest, accountDigest: current.portableRouteAuthority.accountDigest, projectionSchemaDigest: current.portableRouteAuthority.projectionSchemaDigest, projection: observed.labels, complete: true as const, observedAt: (now?.() ?? new Date()).toISOString() }); return { ...withoutSeal(current), status: "reconciled", postStateEvidence, reconciliation }; });
    },
    async recordCleanupParent(requestId: string, cleanupParentReceiptDigest: string | null) { return replaceExecution(requestId, current => ({ ...withoutSeal(current), cleanupParentReceiptDigest })); },
    async snapshot() {
      const state = await load();
      return Object.freeze(state);
    },
    async restore() {
      const state = await load();
      const next = { ...state, labels: state.before, writes: state.writes + 1 };
      await persist(next);
      return Object.freeze(next);
    },
  });
}
function withoutSeal(value: any): any { const { signerId: _signerId, signature: _signature, ...body } = value; return body; }
function normalizeLabels(value: unknown): readonly string[] {
  const labels = inertArray(value, "GitHub durable labels");
  if (labels.some((item) => typeof item !== "string")) throw new TypeError("GitHub durable labels invalid");
  return Object.freeze([...(labels as string[])].sort());
}
function normalizeIssue(value: unknown): Issue {
  const raw = inertRecord(value, "GitHub issue");
  exact(raw, ["owner", "repo", "issueNumber", "issueState", "labels"], "GitHub issue");
  const labels = inertArray(raw.labels, "GitHub labels");
  if (typeof raw.owner !== "string" || typeof raw.repo !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(raw.owner) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(raw.repo) || !Number.isSafeInteger(raw.issueNumber) || typeof raw.issueState !== "string" || labels.some((x) => typeof x !== "string")) throw new TypeError("GitHub issue response invalid");
  return Object.freeze({
    owner: raw.owner,
    repo: raw.repo,
    issueNumber: raw.issueNumber as number,
    issueState: raw.issueState,
    labels: Object.freeze([...(labels as string[])].sort()),
  });
}
function normalizeProviderAcknowledgment(value: unknown) {
  const raw = inertRecord(value, "GitHub acknowledgment");
  exact(raw, ["status", "acknowledgmentId"], "GitHub acknowledgment");
  if (!Number.isSafeInteger(raw.status) || typeof raw.acknowledgmentId !== "string") throw new TypeError("GitHub acknowledgment invalid");
  return Object.freeze({
    status: raw.status as number,
    acknowledgmentId: raw.acknowledgmentId,
  });
}
function envelope(value: any, digest: string, signerId: string, key: any, purpose: any, signature?: any, index?: number) {
  return {
    canonicalBase64: authorityCanonicalBytes(value).toString("base64"),
    advertisedDigest: digest,
    signerId,
    signature: signature ?? signAuthorityDigest(key, purpose, digest),
    ...(index === undefined ? {} : { index }),
  };
}
function publicKeyFromPin(pinPath: string, signerId: string) {
  const pin = JSON.parse(readFileSync(pinPath, "utf8"));
  const descriptor = pin.keyDescriptors.find((x: any) => x.keyId === signerId);
  if (!descriptor) throw new TypeError("delegation signer descriptor missing");
  return createPublicKey({
    key: Buffer.from(descriptor.publicKeySpkiBase64, "base64"),
    format: "der",
    type: "spki",
  });
}
function descriptorPublicKey(descriptor: Readonly<{ publicKeySpkiBase64: string }>) {
  return createPublicKey({
    key: Buffer.from(descriptor.publicKeySpkiBase64, "base64"),
    format: "der",
    type: "spki",
  });
}
class ControlledCut extends Error {
  constructor() {
    super("controlled cut");
  }
}
function journalPath(root: string, requestId: string) {
  return path.join(root, `${requestId}.journal.json`);
}
async function saveJournal(root: string, value: Journal, authority: any) {
  const prior = await loadJournal(root, value.requestId, authority);
  if (prior) assertJournalTransition(prior, value);
  const sequenced = {
      ...value,
      adapterContractDigest: AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST,
      eventSequence: prior === undefined ? 0 : prior.eventSequence! + 1,
      priorJournalDigest: prior === undefined ? null : authorityDigest(journalBody(prior)),
    },
    body = journalBody(sequenced),
    digest = authorityDigest(body),
    signed = {
      ...body,
      signerId: authority.journalDescriptor.keyId,
      signature: authority.signJournal(digest),
    };
  const generation = path.join(root, `${value.requestId}.journal-generation.${String(sequenced.eventSequence).padStart(8, "0")}.${digest.slice(7)}.json`),
    generationHandle = await open(generation, "wx", 0o600);
  try {
    await generationHandle.writeFile(`${JSON.stringify(signed)}\n`);
    await generationHandle.sync();
  } finally {
    await generationHandle.close();
  }
  const file = journalPath(root, value.requestId),
    temp = `${file}.${randomUUID()}.tmp`,
    bytes = Buffer.from(`${JSON.stringify(signed)}\n`);
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.write(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
}
async function loadJournal(root: string, requestId: string, authority: any): Promise<Journal | undefined> {
  try {
    const journal = verifiedJournal(JSON.parse((await readUnlinkedFile(journalPath(root, requestId))).toString("utf8")), requestId, authority),
      prefix = `${requestId}.journal-generation.`,
      generations: Journal[] = [];
    for (const name of await readdir(root)) if (name.startsWith(prefix) && name.endsWith(".json")) generations.push(verifiedJournal(JSON.parse((await readUnlinkedFile(path.join(root, name))).toString("utf8")), requestId, authority));
    generations.sort((left, right) => left.eventSequence! - right.eventSequence!);
    if (generations.length === 0 || generations.some((item, index) => item.eventSequence !== index || item.priorJournalDigest !== (index === 0 ? null : authorityDigest(journalBody(generations[index - 1]!)))) || authorityDigest(journalBody(generations[generations.length - 1]!)) !== authorityDigest(journalBody(journal))) throw new TypeError("GitHub journal head rollback, fork, or generation omission detected");
    return journal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
async function loadJournalHistory(root: string, requestId: string, authority: any): Promise<readonly Journal[]> {
  const head = await loadJournal(root, requestId, authority);
  if (!head) return Object.freeze([]);
  const prefix = `${requestId}.journal-generation.`,
    generations: Journal[] = [];
  for (const name of await readdir(root)) if (name.startsWith(prefix) && name.endsWith(".json")) generations.push(verifiedJournal(JSON.parse((await readUnlinkedFile(path.join(root, name))).toString("utf8")), requestId, authority));
  generations.sort((left, right) => left.eventSequence! - right.eventSequence!);
  return Object.freeze(generations);
}
function verifiedJournal(value: unknown, requestId: string, authority: any): Journal {
  const journal = parseJournal(value, requestId);
  if (journal.signerId !== authority.journalDescriptor.keyId || !journal.signature || !verifyAuthoritySignature(descriptorPublicKey(authority.journalDescriptor), "authority-journal", authorityDigest(journalBody(journal)), journal.signature)) throw new TypeError("GitHub dispatch journal signature is invalid or tampered");
  return journal;
}
function parseJournal(value: unknown, expectedRequestId: string): Journal {
  const raw = inertRecord(value, "GitHub dispatch journal");
  exact(raw, ["v", "requestId", "requestDigest", "reservationId", "cleanupReservationId", "allocationId", "effectDigest", "permitSnapshotDigest", "adapterContractDigest", "exactBytesDigest", "conflictReceiptDigest", "duplicateAttemptHeadDigest", "eventSequence", "priorJournalDigest", "phase", "providerWrites", "signerId", "signature"], "GitHub dispatch journal");
  const phases: readonly string[] = ["reserved", "budget-intent", "budget-consumed", "dispatched", "provider-send-intent", "provider-applied", "acknowledged", "conflict-publication-pending", "conflict", "cleanup-reserved", "cleanup-budget-consumed", "cleanup-dispatched", "cleanup-send-intent", "cleanup-applied", "cleanup-publication-pending", "cleanup-receipted", "cleanup-refused", "refused", "failed", "pending-reconciliation"];
  if (raw.v !== "reelier.github-certification-journal/v1" || raw.requestId !== expectedRequestId || !/^sha256:[0-9a-f]{64}$/.test(raw.requestDigest) || typeof raw.reservationId !== "string" || (raw.cleanupReservationId !== null && typeof raw.cleanupReservationId !== "string") || typeof raw.allocationId !== "string" || !/^sha256:[0-9a-f]{64}$/.test(raw.effectDigest) || !/^sha256:[0-9a-f]{64}$/.test(raw.permitSnapshotDigest) || raw.adapterContractDigest !== AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST || (raw.exactBytesDigest !== null && !/^sha256:[0-9a-f]{64}$/.test(raw.exactBytesDigest)) || (raw.conflictReceiptDigest !== null && !/^sha256:[0-9a-f]{64}$/.test(raw.conflictReceiptDigest)) || !Number.isSafeInteger(raw.eventSequence) || raw.eventSequence < 0 || (raw.priorJournalDigest !== null && !/^sha256:[0-9a-f]{64}$/.test(raw.priorJournalDigest)) || !phases.includes(raw.phase) || !Number.isSafeInteger(raw.providerWrites) || raw.providerWrites < 0 || typeof raw.signerId !== "string" || !raw.signature || raw.signature.alg !== "ed25519" || typeof raw.signature.sig !== "string" || (raw.phase === "conflict" && (raw.exactBytesDigest === null || raw.conflictReceiptDigest === null)) || (raw.phase === "conflict-publication-pending" && (raw.exactBytesDigest === null || raw.conflictReceiptDigest !== null)) || (!["conflict", "conflict-publication-pending"].includes(raw.phase) && (raw.exactBytesDigest !== null || raw.conflictReceiptDigest !== null))) throw new TypeError("GitHub dispatch journal is invalid");
  if (raw.duplicateAttemptHeadDigest !== null && !/^sha256:[0-9a-f]{64}$/.test(raw.duplicateAttemptHeadDigest)) throw new TypeError("GitHub duplicate checkpoint digest is invalid");
  return Object.freeze(raw as Journal);
}
function journalBody(value: Journal) {
  return {
    v: value.v,
    requestId: value.requestId,
    requestDigest: value.requestDigest,
    reservationId: value.reservationId,
    cleanupReservationId: value.cleanupReservationId,
    allocationId: value.allocationId,
    effectDigest: value.effectDigest,
    permitSnapshotDigest: value.permitSnapshotDigest,
    adapterContractDigest: value.adapterContractDigest,
    exactBytesDigest: value.exactBytesDigest ?? null,
    conflictReceiptDigest: value.conflictReceiptDigest ?? null,
    duplicateAttemptHeadDigest: value.duplicateAttemptHeadDigest ?? null,
    eventSequence: value.eventSequence,
    priorJournalDigest: value.priorJournalDigest,
    phase: value.phase,
    providerWrites: value.providerWrites,
  };
}
function assertJournalTransition(prior: Journal, next: Journal) {
  const stable = ["requestId", "requestDigest", "reservationId", "allocationId", "effectDigest", "permitSnapshotDigest"] as const;
  if (stable.some((key) => prior[key] !== next[key]) || (prior.cleanupReservationId !== null && prior.cleanupReservationId !== next.cleanupReservationId)) throw new TypeError("GitHub dispatch journal identity conflict");
  const allowed: Record<JournalPhase, readonly JournalPhase[]> = {
    reserved: ["budget-intent", "refused"],
    "budget-intent": ["budget-consumed", "refused"],
    "budget-consumed": ["dispatched", "refused"],
    dispatched: ["provider-send-intent", "pending-reconciliation"],
    "provider-send-intent": ["provider-applied", "acknowledged", "failed", "pending-reconciliation"],
    "provider-applied": ["acknowledged", "failed", "pending-reconciliation"],
    acknowledged: ["cleanup-reserved", "conflict-publication-pending"],
    "conflict-publication-pending": ["conflict"],
    conflict: [],
    "cleanup-reserved": ["cleanup-budget-consumed", "cleanup-refused"],
    "cleanup-budget-consumed": ["cleanup-dispatched", "cleanup-refused"],
    "cleanup-dispatched": ["cleanup-send-intent", "cleanup-publication-pending"],
    "cleanup-send-intent": ["cleanup-applied", "cleanup-publication-pending"],
    "cleanup-applied": ["cleanup-publication-pending"],
    "cleanup-publication-pending": ["cleanup-receipted"],
    "cleanup-receipted": [],
    "cleanup-refused": [],
    refused: [],
    failed: [],
    "pending-reconciliation": ["acknowledged"],
  };
  const duplicateCheckpoint = prior.phase === next.phase && next.duplicateAttemptHeadDigest !== null && prior.duplicateAttemptHeadDigest !== next.duplicateAttemptHeadDigest;
  if (!allowed[prior.phase].includes(next.phase) && !duplicateCheckpoint) throw new TypeError("GitHub dispatch journal phase transition is invalid");
}
async function withRequestLock<T>(root: string, requestId: string, operation: () => Promise<T>): Promise<T> {
  const lock = path.join(root, `${requestId}.lock`);
  let handle;
  try {
    handle = await open(lock, "wx", 0o600);
    await handle.writeFile(`${process.pid}\n`, "utf8");
    await handle.sync();
    return await operation();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("GitHub dispatch request is busy");
    throw error;
  } finally {
    if (handle) {
      await handle.close();
      await unlink(lock).catch(() => undefined);
    }
  }
}
function view(journal: Journal): GitHubHermeticRunnerResult {
  const status = journal.phase === "acknowledged" ? "acknowledged" : journal.phase === "conflict" ? "conflict" : journal.phase === "cleanup-receipted" ? "cleaned" : journal.phase === "refused" || journal.phase === "cleanup-refused" ? "refused" : journal.phase === "failed" ? "failed" : "pending-reconciliation";
  return Object.freeze({
    requestId: journal.requestId,
    status,
    success: false,
    providerWrites: journal.providerWrites,
    reservationId: journal.reservationId,
    ...(journal.exactBytesDigest ? { exactBytesDigest: journal.exactBytesDigest } : {}),
  });
}
function canonicalReceiptOrder(receipts: readonly ReturnType<typeof parseAuthorityReceiptBundle>[]): readonly ReturnType<typeof parseAuthorityReceiptBundle>[] {
  const ordered: ReturnType<typeof parseAuthorityReceiptBundle>[] = [];
  const requests = [...new Set(receipts.map((bundle) => bundle.receipt.value.decisionContext.requestId))].sort();
  for (const requestId of requests) {
    const remaining = receipts.filter((bundle) => bundle.receipt.value.decisionContext.requestId === requestId);
    let prior: string | null = null;
    while (remaining.length > 0) {
      const candidates = remaining.filter((bundle) => bundle.receipt.value.priorReceiptDigest === prior);
      if (candidates.length !== 1) throw new TypeError("portable receipt chain is forked or incomplete");
      const next = candidates[0]!;
      ordered.push(next);
      remaining.splice(remaining.indexOf(next), 1);
      prior = authorityDigest(next.receipt.value);
    }
  }
  if (ordered.length !== receipts.length) throw new TypeError("portable receipt chain is incomplete");
  return Object.freeze(ordered);
}
function validateRequestId(value: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(value)) throw new TypeError("GitHub request id invalid");
}
function closed(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, any> {
  const raw = inertRecord(value, label);
  exact(raw, keys, label);
}
function inertRecord(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some((key) => typeof key !== "string" || Object.getOwnPropertyDescriptor(value, key)?.get || Object.getOwnPropertyDescriptor(value, key)?.set)) throw new TypeError(`${label} must be an inert plain object`);
  return value as Record<string, any>;
}
function inertArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).some((key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Object.getOwnPropertyDescriptor(value, key)?.get || Object.getOwnPropertyDescriptor(value, key)?.set))) throw new TypeError(`${label} must be an inert dense array`);
  return value;
}
function exact(value: Record<string, any>, keys: readonly string[], label: string) {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) throw new TypeError(`${label} is closed`);
}
