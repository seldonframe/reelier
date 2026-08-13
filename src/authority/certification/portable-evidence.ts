import type { KeyObject } from "node:crypto";
import { createHash, createPublicKey } from "node:crypto";
import { parseGitHubIssueLabelsPolicy } from "../../packs/github/compile.js";
import { githubIssueLabelsPolicySchemaId } from "../../packs/github/manifest.js";
import { AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST } from "../adapter-contract.js";
import { verifyAuthoritySignature } from "../crypto.js";
import type { AuthoritySignature } from "../types.js";
import { authorityCanonicalBytes, authorityDigest } from "../wire.js";
import { normalizeSignedJobCard, signedJobCardDigest, verifySignedJobCard } from "../job.js";
import { jobCardTrustMaterialFromPin, type JobCardTrustPinV1 } from "../host/deployment.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
export interface CertificationEvidenceSigner {
  readonly signerId: string;
  sign(digest: string): AuthoritySignature;
}
export interface CertificationEvidenceVerifier {
  readonly signerId: string;
  readonly publicKey: KeyObject;
  readonly purpose?: "authority-evidence" | "authority-journal";
}

export interface CertificationTaskAuthorityEvidenceV1 {
  readonly v: "reelier.certification-task-authority-evidence/v1";
  readonly taskId: string;
  readonly signedJobCard: unknown;
  readonly activation: unknown;
  readonly dispatchSnapshotPreimage: Readonly<Record<string, unknown>>;
  readonly signedJobCardDigest: string;
  readonly activationDigest: string;
  readonly dispatchSnapshotDigest: string;
  readonly operatorConfigDigest: string;
  readonly taskShapeDigest: string;
  readonly instructionsDigest: string;
  readonly runnerDigest: string;
  readonly planDigest: string;
  readonly endpointDigest: string;
  readonly sourceDigest: string;
  readonly policyDigest: string;
  readonly principalSessionDigest: string;
  readonly grantAllocationDigest: string;
  readonly trustHeadDigest: string;
  readonly adapterContractDigest: string;
  readonly declaredIntent: Readonly<Record<string, unknown>>;
  readonly declaredTrigger: Readonly<Record<string, unknown>>;
  readonly intentDigest: string;
  readonly triggerDigest: string;
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}

export interface CertificationPostStateEvidenceV1 {
  readonly v: "reelier.certification-post-state-evidence/v1";
  readonly requestId: string;
  readonly dispatchRequestDigest: string;
  readonly permitSnapshotDigest: string;
  readonly expectedProjectionDigest: string;
  readonly preSourceBundleDigest: string | null;
  readonly projectionSchemaId: string;
  readonly projectionSchemaDigest: string;
  readonly preProjectionDigest: string | null;
  readonly observedProjectionDigest: string | null;
  readonly observationMethod: "hermetic-authoritative-read" | "provider-acknowledgment" | "not-observed";
  readonly observedAt: string;
  readonly confidence: "exact" | "partial" | "pending" | "absent";
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}

export interface CertificationPolicyEvidenceV1 {
  readonly v: "reelier.certification-policy-evidence/v1";
  readonly artifact: "outcome-contract" | "local-gate-policy";
  readonly status: "verified" | "failed" | "unchecked" | "absent";
  readonly schemaId: string | null;
  readonly jcsBase64: string | null;
  readonly policyDigest: string;
  readonly authorityStatePreimage: Readonly<Record<string, unknown>> | null;
  readonly authorityStateDigest: string | null;
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}

export interface CertificationTaskStatusEvidenceV1 {
  readonly v: "reelier.certification-task-status-evidence/v1";
  readonly phase: "dispatch" | "export";
  readonly taskId: string;
  readonly lifecycleState: "active" | "revoked" | "expired" | "inactive";
  readonly grantExpiresAt: string;
  readonly allocationRevoked: boolean;
  readonly observedAt: string;
  readonly durableHistoryDigest: string;
  readonly currentActiveClaim: boolean;
  readonly freshness: "unchecked";
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}

export interface CertificationDuplicateDecisionV1 {
  readonly v: "reelier.certification-duplicate-decision/v1";
  readonly attemptId: string;
  readonly attemptRequestId: string;
  readonly operationKind: "run" | "conflict" | "cleanup";
  readonly originalRequestId: string;
  readonly originalRequestDigest: string;
  readonly originalEffectDigest: string;
  readonly observedAuthorityState: Readonly<Record<string, unknown>>;
  readonly observedAuthorityStateDigest: string;
  readonly observedAt: string;
  readonly budgetDelta: 0;
  readonly providerWriteDelta: 0;
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}
export interface CertificationDuplicateAttemptV1 {
  readonly v: "reelier.certification-duplicate-attempt/v1";
  readonly attemptId: string;
  readonly attemptRequestId: string;
  readonly operationKind: "run" | "conflict" | "cleanup";
  readonly originalRequestId: string;
  readonly observedAuthorityStateDigest: string;
  readonly observedAt: string;
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}
export interface CertificationDuplicateAttemptHeadV1 {
  readonly v: "reelier.certification-duplicate-attempt-head/v1";
  readonly sequence: number;
  readonly previousHeadDigest: string | null;
  readonly count: number;
  readonly historyDigest: string;
  readonly decisionHistoryDigest: string;
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}

export function createCertificationDuplicateAttempt(input: Omit<CertificationDuplicateAttemptV1, "v" | "signerId" | "signature">, signer: CertificationEvidenceSigner): CertificationDuplicateAttemptV1 {
  const body = {
    v: "reelier.certification-duplicate-attempt/v1" as const,
    ...input,
    signerId: signer.signerId,
  };
  if (!input.attemptId || !input.attemptRequestId || !input.originalRequestId || !DIGEST.test(input.observedAuthorityStateDigest) || !validTime(input.observedAt)) throw new TypeError("portable duplicate attempt is invalid");
  return Object.freeze({
    ...body,
    signature: signer.sign(authorityDigest(body)),
  });
}
export function createCertificationDuplicateAttemptHead(attempts: readonly CertificationDuplicateAttemptV1[], decisions: readonly CertificationDuplicateDecisionV1[], previous: CertificationDuplicateAttemptHeadV1 | null, signer: CertificationEvidenceSigner): CertificationDuplicateAttemptHeadV1 {
  const body = {
    v: "reelier.certification-duplicate-attempt-head/v1" as const,
    sequence: previous === null ? 0 : previous.sequence + 1,
    previousHeadDigest: previous === null ? null : authorityDigest(previous),
    count: attempts.length,
    historyDigest: authorityDigest(attempts),
    decisionHistoryDigest: authorityDigest(decisions),
    signerId: signer.signerId,
  };
  return Object.freeze({
    ...body,
    signature: signer.sign(authorityDigest(body)),
  });
}

export function createCertificationTaskStatusEvidence(input: Omit<CertificationTaskStatusEvidenceV1, "v" | "freshness" | "signerId" | "signature">, signer: CertificationEvidenceSigner): CertificationTaskStatusEvidenceV1 {
  const body = {
    v: "reelier.certification-task-status-evidence/v1" as const,
    ...input,
    freshness: "unchecked" as const,
    signerId: signer.signerId,
  };
  validateTaskStatusBody(body);
  return Object.freeze({
    ...body,
    signature: signer.sign(authorityDigest(body)),
  });
}

export function verifyCertificationTaskStatusEvidence(
  value: unknown,
  verifier: CertificationEvidenceVerifier,
): Readonly<{
  status: "verified";
  freshness: "unchecked";
  observationDigest: string;
}> {
  const record = exact(value, ["v", "phase", "taskId", "lifecycleState", "grantExpiresAt", "allocationRevoked", "observedAt", "durableHistoryDigest", "currentActiveClaim", "freshness", "signerId", "signature"], "portable task status") as unknown as CertificationTaskStatusEvidenceV1;
  const { signature, ...body } = record;
  validateTaskStatusBody(body);
  verifySigned(body, signature, verifier, "portable task status");
  return Object.freeze({
    status: "verified",
    freshness: "unchecked",
    observationDigest: authorityDigest(record),
  });
}

export function createCertificationTaskAuthorityEvidence(input: Omit<CertificationTaskAuthorityEvidenceV1, "v" | "signedJobCardDigest" | "activationDigest" | "dispatchSnapshotDigest" | "adapterContractDigest" | "intentDigest" | "triggerDigest" | "signerId" | "signature">, signer: CertificationEvidenceSigner): CertificationTaskAuthorityEvidenceV1 {
  const body = {
    v: "reelier.certification-task-authority-evidence/v1" as const,
    ...input,
    signedJobCardDigest: signedJobCardDigest(normalizeSignedJobCard(input.signedJobCard)),
    activationDigest: authorityDigest(input.activation),
    dispatchSnapshotDigest: authorityDigest(input.dispatchSnapshotPreimage),
    adapterContractDigest: AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST,
    intentDigest: authorityDigest(input.declaredIntent),
    triggerDigest: authorityDigest(input.declaredTrigger),
    signerId: signer.signerId,
  };
  validateTaskAuthorityBody(body);
  return Object.freeze({
    ...body,
    signature: signer.sign(authorityDigest(body)),
  });
}

export function createCertificationPostStateEvidence(input: Omit<CertificationPostStateEvidenceV1, "v" | "signerId" | "signature">, signer: CertificationEvidenceSigner): CertificationPostStateEvidenceV1 {
  const body = {
    v: "reelier.certification-post-state-evidence/v1" as const,
    ...input,
    signerId: signer.signerId,
  };
  validatePostStateBody(body);
  return Object.freeze({
    ...body,
    signature: signer.sign(authorityDigest(body)),
  });
}

export function createCertificationPolicyEvidence(
  input: Readonly<{
    outcomeContract: Readonly<{
      schemaId: string;
      jcsBase64: string;
      digest: string;
    }>;
    localGatePolicyDigest: string;
    authorityStatePreimage: Readonly<Record<string, unknown>>;
  }>,
  signer: CertificationEvidenceSigner,
): readonly CertificationPolicyEvidenceV1[] {
  const authorityStateDigest = authorityDigest(input.authorityStatePreimage);
  const outcome = signPolicy(
    {
      v: "reelier.certification-policy-evidence/v1",
      artifact: "outcome-contract",
      status: "verified",
      schemaId: input.outcomeContract.schemaId,
      jcsBase64: input.outcomeContract.jcsBase64,
      policyDigest: input.outcomeContract.digest,
      authorityStatePreimage: null,
      authorityStateDigest: null,
      signerId: signer.signerId,
    },
    signer,
  );
  const local = signPolicy(
    {
      v: "reelier.certification-policy-evidence/v1",
      artifact: "local-gate-policy",
      status: "unchecked",
      schemaId: null,
      jcsBase64: null,
      policyDigest: input.localGatePolicyDigest,
      authorityStatePreimage: input.authorityStatePreimage,
      authorityStateDigest,
      signerId: signer.signerId,
    },
    signer,
  );
  return Object.freeze([outcome, local]);
}

export function createCertificationDuplicateDecision(input: Omit<CertificationDuplicateDecisionV1, "v" | "observedAuthorityStateDigest" | "budgetDelta" | "providerWriteDelta" | "signerId" | "signature">, signer: CertificationEvidenceSigner): CertificationDuplicateDecisionV1 {
  const body = {
    v: "reelier.certification-duplicate-decision/v1" as const,
    attemptId: input.attemptId,
    attemptRequestId: input.attemptRequestId,
    operationKind: input.operationKind,
    originalRequestId: input.originalRequestId,
    originalRequestDigest: input.originalRequestDigest,
    originalEffectDigest: input.originalEffectDigest,
    observedAuthorityState: input.observedAuthorityState,
    observedAuthorityStateDigest: authorityDigest(input.observedAuthorityState),
    observedAt: input.observedAt,
    budgetDelta: 0 as const,
    providerWriteDelta: 0 as const,
    signerId: signer.signerId,
  };
  validateDuplicateBody(body);
  return Object.freeze({
    ...body,
    signature: signer.sign(authorityDigest(body)),
  });
}

export function verifyCertificationPortableEvidence(
  input: Readonly<{
    taskAuthorities: readonly unknown[];
    postStateEvidence: readonly unknown[];
    policyEvidence: readonly unknown[];
    taskStatusEvidence: readonly unknown[];
    duplicateAttemptHead: unknown;
    duplicateAttempts: readonly unknown[];
    duplicateDecisions: readonly unknown[];
  }>,
  context: Readonly<{
    verifier: CertificationEvidenceVerifier;
    journalVerifier: CertificationEvidenceVerifier;
    trustPin: JobCardTrustPinV1;
    taskId: string;
    authorityCellId: string;
    grants: readonly any[];
    allocations: readonly any[];
    receipts: readonly any[];
    outcomes: readonly any[];
    budgetEvents: readonly any[];
    adapterContractDigest: string;
  }>,
): void {
  if (input.taskAuthorities.length !== 1) throw new TypeError("portable task authority is omitted or duplicated");
  const task = signedExact(input.taskAuthorities[0], ["v", "taskId", "signedJobCard", "activation", "dispatchSnapshotPreimage", "operatorConfigDigest", "taskShapeDigest", "instructionsDigest", "runnerDigest", "planDigest", "endpointDigest", "sourceDigest", "policyDigest", "principalSessionDigest", "grantAllocationDigest", "trustHeadDigest", "declaredIntent", "declaredTrigger", "signedJobCardDigest", "activationDigest", "dispatchSnapshotDigest", "adapterContractDigest", "intentDigest", "triggerDigest", "signerId", "signature"], context.verifier, "portable task authority") as CertificationTaskAuthorityEvidenceV1;
  validateTaskAuthorityBody(task);
  if (task.taskId !== context.taskId || task.adapterContractDigest !== context.adapterContractDigest) throw new TypeError("portable task authority task or Adapter Contract is mismatched");
  const job = normalizeSignedJobCard(task.signedJobCard),
    trustedJob = jobCardTrustMaterialFromPin(job, context.trustPin),
    trustedJobKey = createPublicKey({
      key: Buffer.from(trustedJob.signer.publicKeySpkiBase64, "base64"),
      format: "der",
      type: "spki",
    });
  if (!verifySignedJobCard(job, trustedJobKey) || task.signedJobCardDigest !== signedJobCardDigest(job)) throw new TypeError("portable task authority Job Card trust is invalid");
  const journalSnapshots = new Set(context.outcomes.map((item) => item.permitSnapshotDigest));
  if (!journalSnapshots.has(task.dispatchSnapshotDigest)) throw new TypeError("portable task authority permit preimage is not linked to dispatch");
  if (signedJobCardDigest(normalizeSignedJobCard(task.signedJobCard)) !== task.signedJobCardDigest || authorityDigest(task.activation) !== task.activationDigest || authorityDigest(task.dispatchSnapshotPreimage) !== task.dispatchSnapshotDigest || authorityDigest(task.declaredIntent) !== task.intentDigest || authorityDigest(task.declaredTrigger) !== task.triggerDigest) throw new TypeError("portable task authority normalized objects or declarations were substituted");
  const preimage = task.dispatchSnapshotPreimage as any,
    activation = task.activation as any;
  if (
    preimage.jobCard !== task.signedJobCardDigest ||
    preimage.activation !== task.activationDigest ||
    task.operatorConfigDigest !== preimage.operatorConfig ||
    task.taskShapeDigest !== job.taskShapeDigest ||
    task.instructionsDigest !== job.instructionsDigest ||
    task.runnerDigest !== preimage.runner ||
    task.planDigest !== preimage.plan ||
    task.endpointDigest !== preimage.endpoint ||
    task.trustHeadDigest !== preimage.trustHead ||
    task.trustHeadDigest !== activation.currentTrustHeadDigest ||
    task.principalSessionDigest !==
      authorityDigest({
        principalId: activation.principalId,
        runtimeSessionId: activation.runtimeSessionId,
      }) ||
    task.grantAllocationDigest !==
      authorityDigest({
        rootGrantDigest: activation.signedRootGrant.digest,
        childGrantDigest: activation.signedChildGrant.digest,
        rootAllocationId: activation.rootAllocationId,
        allocationId: activation.allocationId,
      })
  )
    throw new TypeError("portable task authority links were substituted");
  for (const key of ["operatorConfigDigest", "taskShapeDigest", "instructionsDigest", "runnerDigest", "planDigest", "endpointDigest", "sourceDigest", "policyDigest", "principalSessionDigest", "grantAllocationDigest", "trustHeadDigest", "intentDigest", "triggerDigest"] as const) if (!DIGEST.test(task[key])) throw new TypeError("portable task authority digest is invalid");

  const sourceDigests = new Set(context.receipts.map((bundle) => bundle.sourceBundle?.digest));
  const postIds = new Set<string>();
  for (const raw of input.postStateEvidence) {
    const post = signedExact(raw, ["v", "requestId", "dispatchRequestDigest", "permitSnapshotDigest", "expectedProjectionDigest", "preSourceBundleDigest", "projectionSchemaId", "projectionSchemaDigest", "preProjectionDigest", "observedProjectionDigest", "observationMethod", "observedAt", "confidence", "signerId", "signature"], context.verifier, "portable post-state") as CertificationPostStateEvidenceV1;
    validatePostStateBody(post);
    if (post.confidence !== "exact" && post.confidence !== "partial") throw new TypeError("portable post-state pending or absent evidence cannot pass");
    if (postIds.has(post.requestId)) throw new TypeError("portable post-state evidence is duplicated");
    postIds.add(post.requestId);
    if (
      !journalSnapshots.has(post.permitSnapshotDigest) ||
      !context.outcomes.some((item) => item.requestId === post.requestId && item.requestDigest === post.dispatchRequestDigest) ||
      authorityDigest({
        v: "reelier.outcome-request/v1",
        requestId: post.requestId,
        sourceRefs: task.declaredTrigger,
        choices: {},
      }) !== post.dispatchRequestDigest
    )
      throw new TypeError("portable post-state trigger is not linked to authorized dispatch");
    const sourceBundle = context.receipts.find((bundle) => bundle.sourceBundle?.digest === post.preSourceBundleDigest),
      source = sourceBundle?.sourceBundle,
      contract = sourceBundle?.contract?.value,
      sourceAuthority = contract?.sourceAuthority,
      policy = parseGitHubIssueLabelsPolicy(JSON.parse(Buffer.from(contract?.policyCommitment?.jcsBase64 ?? "", "base64").toString("utf8")));
    if (post.preSourceBundleDigest !== null && (!source || authorityDigest(source.value?.projection?.labels) !== post.preProjectionDigest || sourceAuthority?.projectionSchemaId !== post.projectionSchemaId || !Array.isArray(sourceAuthority?.authorizedProjectionPointers) || !sourceAuthority.authorizedProjectionPointers.includes("/labels"))) throw new TypeError("portable post-state pre-read SourceBundle is omitted, substituted, or non-comparable");
    if (
      (task.declaredIntent as any).definitionAlias !== contract?.alias ||
      authorityDigest([...(task.declaredIntent as any).desiredLabels].sort()) !== authorityDigest([...policy.desiredLabels].sort()) ||
      post.expectedProjectionDigest !== authorityDigest([...policy.desiredLabels].sort()) ||
      post.projectionSchemaDigest !==
        authorityDigest({
          schemaId: post.projectionSchemaId,
          pointers: ["/labels"],
        })
    )
      throw new TypeError("portable declared intent, expected projection, or schema is substituted");
  }
  if (
    input.postStateEvidence.length === 0 ||
    input.postStateEvidence.length !==
      context.receipts
        .filter((bundle) => bundle.receipt?.value?.claims?.dispatch === "verified" && !String(bundle.receipt.value.decisionContext.requestId).endsWith(".cleanup"))
        .map((bundle) => bundle.receipt.value.decisionContext.requestId)
        .filter((id, index, all) => all.indexOf(id) === index).length
  )
    throw new TypeError("portable post-state evidence cardinality is incomplete");

  if (input.policyEvidence.length !== 2) throw new TypeError("portable policy evidence is incomplete");
  const policies = input.policyEvidence.map((raw) => {
    const item = signedExact(raw, ["v", "artifact", "status", "schemaId", "jcsBase64", "policyDigest", "authorityStatePreimage", "authorityStateDigest", "signerId", "signature"], context.verifier, "portable policy") as CertificationPolicyEvidenceV1;
    validatePolicyBody(item);
    return item;
  });
  if (policies[0]!.artifact !== "outcome-contract" || policies[0]!.status !== "verified" || policies[1]!.artifact !== "local-gate-policy" || policies[1]!.status !== "unchecked") throw new TypeError("portable policy statuses cannot be upgraded or substituted");
  const contractCommitments = new Set(context.receipts.map((bundle) => authorityDigest(bundle.contract?.value?.policyCommitment)));
  if (
    !contractCommitments.has(
      authorityDigest({
        schemaId: policies[0]!.schemaId,
        jcsBase64: policies[0]!.jcsBase64,
        digest: policies[0]!.policyDigest,
      }),
    ) ||
    task.policyDigest !== policies[0]!.policyDigest ||
    task.sourceDigest !== context.receipts[0]?.sourceBundle?.digest
  )
    throw new TypeError("portable policy or source commitment is not linked to the authorized receipt");
  const local = policies[1]!,
    authorityStateDigests = new Set(context.receipts.map((bundle) => bundle.receipt?.value?.decisionContext?.snapshots?.authorityStateDigest));
  if (!local.authorityStatePreimage || local.authorityStateDigest !== authorityDigest(local.authorityStatePreimage) || (local.authorityStatePreimage as any).localGatePolicyDigest !== local.policyDigest || !authorityStateDigests.has(local.authorityStateDigest)) throw new TypeError("portable local gate policy is not bound to signed authority state");

  if (input.taskStatusEvidence.length !== 2 || (input.taskStatusEvidence[0] as any)?.phase !== "dispatch" || (input.taskStatusEvidence[1] as any)?.phase !== "export") throw new TypeError("portable task status observations are incomplete");
  for (const status of input.taskStatusEvidence) {
    verifyCertificationTaskStatusEvidence(status, context.verifier);
    const s = status as any,
      allocation = context.allocations.find((item) => item.parentAllocationId !== null),
      child = context.grants[1]?.grant,
      expectedRevoked = s.phase === "dispatch" ? false : allocation?.revoked,
      expectedLifecycle = s.phase === "dispatch" ? "active" : expectedRevoked ? "revoked" : Date.parse(child.expiresAt) <= Date.parse(s.observedAt) ? "expired" : "active";
    if (s.taskId !== context.taskId || s.grantExpiresAt !== child?.expiresAt || s.allocationRevoked !== expectedRevoked || s.lifecycleState !== expectedLifecycle || s.currentActiveClaim !== (expectedLifecycle === "active")) throw new TypeError("portable task status is not tied to its signed graph authority observation");
  }
  const rawBudgetEvents = context.budgetEvents.map((node) => node.event);
  const childAllocation = context.allocations.find((item) => item.parentAllocationId !== null),
    grantDigests = context.grants.map((item) => item.digest),
    dispatchJournal = context.outcomes.find((item) => item.phase === "reserved" && item.permitSnapshotDigest === task.dispatchSnapshotDigest),
    terminalOutcomes = context.outcomes.filter((item, index) => context.outcomes[index + 1]?.requestId !== item.requestId);
  const statusTask = (s: any) => ({
      taskId: context.taskId,
      authorityCellId: context.authorityCellId,
      lifecycleState: s.lifecycleState,
      grantExpiresAt: s.grantExpiresAt,
      allocationRevoked: s.allocationRevoked,
    }),
    allocationHistory = {
      allocationId: childAllocation?.allocationId,
      parentAllocationId: childAllocation?.parentAllocationId,
      effects: childAllocation?.effects,
    };
  const dispatchHistory = authorityDigest({
    task: statusTask(input.taskStatusEvidence[0]),
    grants: grantDigests,
    allocation: allocationHistory,
    journalDigest: authorityDigest(dispatchJournal),
    budgetEvents: rawBudgetEvents.slice(0, 2),
  });
  const exportHistory = authorityDigest({
    task: statusTask(input.taskStatusEvidence[1]),
    grants: grantDigests,
    allocation: allocationHistory,
    journalDigests: terminalOutcomes.map((item) => authorityDigest(item)),
    budgetEvents: rawBudgetEvents,
  });
  if (!dispatchJournal || (input.taskStatusEvidence[0] as any).durableHistoryDigest !== dispatchHistory || (input.taskStatusEvidence[1] as any).durableHistoryDigest !== exportHistory) throw new TypeError("portable task status durable task/grant/allocation/journal/budget history is substituted");

  const attemptIds = new Set<string>();
  for (const raw of input.duplicateAttempts) {
    const attempt = signedExact(raw, ["v", "attemptId", "attemptRequestId", "operationKind", "originalRequestId", "observedAuthorityStateDigest", "observedAt", "signerId", "signature"], context.journalVerifier, "portable duplicate attempt") as any;
    if (attempt.v !== "reelier.certification-duplicate-attempt/v1" || attemptIds.has(attempt.attemptId) || !["run", "conflict", "cleanup"].includes(attempt.operationKind) || !DIGEST.test(attempt.observedAuthorityStateDigest) || !validTime(attempt.observedAt)) throw new TypeError("portable duplicate attempts are invalid or duplicated");
    attemptIds.add(attempt.attemptId);
  }
  const head = signedExact(input.duplicateAttemptHead, ["v", "sequence", "previousHeadDigest", "count", "historyDigest", "decisionHistoryDigest", "signerId", "signature"], context.journalVerifier, "portable duplicate attempt head") as any;
  if (head.v !== "reelier.certification-duplicate-attempt-head/v1" || head.sequence !== head.count || (head.count === 0 ? head.previousHeadDigest !== null : !DIGEST.test(head.previousHeadDigest)) || head.count !== input.duplicateAttempts.length || head.historyDigest !== authorityDigest(input.duplicateAttempts) || head.decisionHistoryDigest !== authorityDigest(input.duplicateDecisions)) throw new TypeError("portable duplicate attempt head count or history is incomplete");
  const terminalJournalHeads = context.outcomes.filter((item, index) => context.outcomes[index + 1]?.requestId !== item.requestId).map((item) => item.duplicateAttemptHeadDigest).filter((item): item is string => typeof item === "string");
  if ((head.count > 0 || terminalJournalHeads.length > 0) && !terminalJournalHeads.includes(authorityDigest(head))) throw new TypeError("portable duplicate current checkpoint is absent from durable signed journal history; rollback detected");
  const duplicateIds = new Set<string>();
  for (const raw of input.duplicateDecisions) {
    const node = signedExact(raw, ["v", "attemptId", "attemptRequestId", "operationKind", "originalRequestId", "originalRequestDigest", "originalEffectDigest", "observedAuthorityState", "observedAuthorityStateDigest", "observedAt", "budgetDelta", "providerWriteDelta", "signerId", "signature"], context.verifier, "portable duplicate") as CertificationDuplicateDecisionV1;
    validateDuplicateBody(node);
    if (authorityDigest(node.observedAuthorityState) !== node.observedAuthorityStateDigest || duplicateIds.has(node.attemptId) || !context.outcomes.some((item) => item.requestId === node.originalRequestId && item.requestDigest === node.originalRequestDigest && item.effectDigest === node.originalEffectDigest)) throw new TypeError("portable duplicate is omitted, duplicated, altered, or not linked to the original effect");
    duplicateIds.add(node.attemptId);
  }
  if (input.duplicateAttempts.length !== input.duplicateDecisions.length || input.duplicateAttempts.some((raw: any) => !input.duplicateDecisions.some((decision: any) => decision.attemptId === raw.attemptId && decision.attemptRequestId === raw.attemptRequestId && decision.operationKind === raw.operationKind && decision.originalRequestId === raw.originalRequestId && decision.observedAt === raw.observedAt && decision.observedAuthorityStateDigest === raw.observedAuthorityStateDigest))) throw new TypeError("portable duplicate attempt/decision collection is incomplete");
}

function signPolicy(body: Omit<CertificationPolicyEvidenceV1, "signature">, signer: CertificationEvidenceSigner): CertificationPolicyEvidenceV1 {
  validatePolicyBody(body);
  return Object.freeze({
    ...body,
    signature: signer.sign(authorityDigest(body)),
  });
}
function validateTaskStatusBody(value: any): void {
  if (value.v !== "reelier.certification-task-status-evidence/v1" || !["dispatch", "export"].includes(value.phase) || typeof value.taskId !== "string" || !["active", "revoked", "expired", "inactive"].includes(value.lifecycleState) || !validTime(value.grantExpiresAt) || !validTime(value.observedAt) || typeof value.allocationRevoked !== "boolean" || !DIGEST.test(value.durableHistoryDigest) || typeof value.currentActiveClaim !== "boolean" || value.freshness !== "unchecked" || typeof value.signerId !== "string") throw new TypeError("portable task status is invalid");
  if (value.currentActiveClaim && (value.lifecycleState !== "active" || value.allocationRevoked || Date.parse(value.grantExpiresAt) <= Date.parse(value.observedAt))) throw new TypeError("portable task status cannot claim active after revocation or expiry");
}
function validateTaskAuthorityBody(value: any): void {
  if (value.v !== "reelier.certification-task-authority-evidence/v1" || typeof value.taskId !== "string" || value.adapterContractDigest !== AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST || typeof value.signerId !== "string") throw new TypeError("portable task authority is invalid");
}
function validatePostStateBody(value: any): void {
  if (value.v !== "reelier.certification-post-state-evidence/v1" || typeof value.requestId !== "string" || !DIGEST.test(value.dispatchRequestDigest) || !DIGEST.test(value.permitSnapshotDigest) || !DIGEST.test(value.expectedProjectionDigest) || (value.preSourceBundleDigest !== null && !DIGEST.test(value.preSourceBundleDigest)) || typeof value.projectionSchemaId !== "string" || !DIGEST.test(value.projectionSchemaDigest) || (value.preProjectionDigest !== null && !DIGEST.test(value.preProjectionDigest)) || (value.observedProjectionDigest !== null && !DIGEST.test(value.observedProjectionDigest)) || !["hermetic-authoritative-read", "provider-acknowledgment", "not-observed"].includes(value.observationMethod) || !validTime(value.observedAt) || !["exact", "partial", "pending", "absent"].includes(value.confidence) || typeof value.signerId !== "string") throw new TypeError("portable post-state is invalid");
  if (value.confidence === "exact" && (value.observationMethod !== "hermetic-authoritative-read" || value.preSourceBundleDigest === null || value.preProjectionDigest === null || value.observedProjectionDigest === null || value.expectedProjectionDigest !== value.observedProjectionDigest)) throw new TypeError("portable post-state exact confidence requires comparable authoritative pre/post evidence");
  if (value.confidence === "partial" && (value.observationMethod !== "hermetic-authoritative-read" || value.observedProjectionDigest === null)) throw new TypeError("portable post-state partial confidence requires a reviewed method and observed projection");
  if ((value.confidence === "pending" || value.confidence === "absent") && value.observationMethod === "hermetic-authoritative-read") throw new TypeError("portable post-state confidence contradicts its observation method");
}
function validatePolicyBody(value: any): void {
  if (value.v !== "reelier.certification-policy-evidence/v1" || !["outcome-contract", "local-gate-policy"].includes(value.artifact) || !["verified", "failed", "unchecked", "absent"].includes(value.status) || !DIGEST.test(value.policyDigest) || typeof value.signerId !== "string") throw new TypeError("portable policy evidence is invalid");
  if (value.artifact === "outcome-contract") {
    if (value.status !== "verified" || value.schemaId !== githubIssueLabelsPolicySchemaId || typeof value.jcsBase64 !== "string" || value.authorityStatePreimage !== null || value.authorityStateDigest !== null) throw new TypeError("portable Outcome Contract policy is not verified against the reviewed schema");
    const bytes = Buffer.from(value.jcsBase64, "base64");
    if (bytes.toString("base64") !== value.jcsBase64 || `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== value.policyDigest) throw new TypeError("portable Outcome Contract policy bytes or digest are invalid");
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (!authorityCanonicalBytes(parsed).equals(bytes)) throw new TypeError("portable Outcome Contract policy bytes are not exact JCS");
    parseGitHubIssueLabelsPolicy(parsed);
  } else if (value.status !== "unchecked" || value.schemaId !== null || value.jcsBase64 !== null || !value.authorityStatePreimage || !DIGEST.test(value.authorityStateDigest)) throw new TypeError("portable local gate policy has no bound authority-state evidence");
}
function validateDuplicateBody(value: any): void {
  if (value.v !== "reelier.certification-duplicate-decision/v1" || typeof value.attemptId !== "string" || typeof value.attemptRequestId !== "string" || !["run", "conflict", "cleanup"].includes(value.operationKind) || typeof value.originalRequestId !== "string" || !value.observedAuthorityState || typeof value.observedAuthorityState !== "object" || !DIGEST.test(value.originalRequestDigest) || !DIGEST.test(value.originalEffectDigest) || !DIGEST.test(value.observedAuthorityStateDigest) || !validTime(value.observedAt) || value.budgetDelta !== 0 || value.providerWriteDelta !== 0 || typeof value.signerId !== "string") throw new TypeError("portable duplicate decision is invalid or has nonzero effect");
}
function verifySigned(body: object, signature: AuthoritySignature, verifier: CertificationEvidenceVerifier, label: string): void {
  if ((body as any).signerId !== verifier.signerId || !signature || !verifyAuthoritySignature(verifier.publicKey, verifier.purpose ?? "authority-evidence", authorityDigest(body), signature)) throw new TypeError(`${label} signature is invalid`);
}
function signedExact(value: unknown, fields: readonly string[], verifier: CertificationEvidenceVerifier, label: string): any {
  const record = exact(value, fields, label);
  const { signature, ...body } = record;
  verifySigned(body, signature, verifier, label);
  return record;
}
function exact(value: unknown, fields: readonly string[], label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).join("\0") !== fields.join("\0")) throw new TypeError(`${label} is not an exact canonical object`);
  return value as Record<string, any>;
}
function validTime(value: unknown): value is string {
  return typeof value === "string" && new Date(value).toISOString() === value;
}
