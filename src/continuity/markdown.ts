import type {
  ClaimProjectionV1,
  ConsequenceProjectionV1,
  DecisionProjectionV1,
  ObligationProjectionV1,
  ResumeProjectionV1,
} from "./projection.js";

const none = (items: readonly string[]): readonly string[] => items.length === 0 ? ["- none"] : items;
const bullets = (items: readonly string[]): string => none(items.map((item) => `- ${item}`)).join("\n");

function decision(item: DecisionProjectionV1): string {
  return `${item.decisionId}: ${item.statement} (decided by ${item.decidedBy}; evidence ${item.evidenceDigest})`;
}

function obligation(item: ObligationProjectionV1): string {
  return `${item.obligationId} [${item.state}]: ${item.statement} (owner ${item.ownerWorkloadId}; acceptance evidence: ${item.acceptanceEvidence}; evidence ${item.evidenceDigest ?? "absent"})`;
}

function consequence(item: ConsequenceProjectionV1): string {
  return `${item.semanticOperationId} [${item.state}]: reservation ${item.reservationId}; authority evidence ${item.authorityEvidenceDigest}; receipt ${item.receiptDigest ?? "absent"}`;
}

function claim(item: ClaimProjectionV1): string {
  return `${item.claimId} [${item.status}]: ${item.statement}; evidence ${item.evidenceDigest ?? "absent"}`;
}

export function renderResumeMarkdown(projection: ResumeProjectionV1): string {
  const sections = projection.sections;
  const obligations = [
    ...sections.workState.open,
    ...sections.workState.blocked,
    ...sections.workState.satisfied,
    ...sections.workState.abandoned,
  ];
  const uncertainty = [
    ...sections.evidenceAndUncertainty.uncertainClaims.map(claim),
    ...sections.evidenceAndUncertainty.unresolvedExceptions.map((item) => `${item.exceptionId} [open]: ${item.reason}; evidence ${item.evidenceDigest ?? "absent"}`),
  ];
  return [
    `# Resume task ${projection.taskId}`,
    `Cursor: ${projection.cursor}; segment: ${projection.segmentDigest}`,
    "",
    "## 1. Outcome owed",
    sections.outcomeOwed.outcome,
    `Acceptance projection: ${sections.outcomeOwed.completionProjection}`,
    `Non-goals:\n${bullets(sections.outcomeOwed.nonGoals)}`,
    "",
    "## 2. Binding decisions",
    bullets(sections.bindingDecisions.map(decision)),
    "",
    "## 3. Work state",
    bullets(obligations.map(obligation)),
    "",
    "## 4. Consequential state",
    bullets(sections.consequentialState.map(consequence)),
    "",
    "## 5. Remaining envelope",
    `Open obligations:\n${bullets(sections.remainingEnvelope.openObligationIds)}`,
    `Blocked obligations:\n${bullets(sections.remainingEnvelope.blockedObligationIds)}`,
    `Superseded decisions: ${sections.remainingEnvelope.supersededDecisionCount}`,
    `Job Card: ${projection.jobCardDigest}`,
    `Authority snapshot: ${projection.authoritySnapshotDigest}`,
    "",
    "## 6. Evidence and uncertainty",
    `Evidence references:\n${bullets(sections.evidenceAndUncertainty.evidenceRefs)}`,
    `Uncertainty:\n${bullets(uncertainty)}`,
    "",
    "## 7. Next safe actions",
    bullets(sections.nextSafeActions),
    "",
  ].join("\n");
}
