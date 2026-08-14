import type { AuthoritySignature } from "../types.js";
import { authorityDigest } from "../wire.js";
import type { DispatchPublication } from "./dispatch.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface PortableOutcomeEvidenceV1 {
  readonly v: "reelier.portable-outcome-evidence/v1";
  readonly routeAuthorityDigest: string;
  readonly materializedRequestDigest: string;
  readonly responseSemanticsProfileDigest: string;
  readonly preStateEvidenceDigest: string;
  readonly postStateEvidenceDigest: string;
  readonly confidence: "exact" | "partial" | "pending" | "absent";
  readonly authoritativeStateSource: "hermetic-github-fixture" | "github-api";
  readonly executionAttestationSignerId: string;
  readonly reconciliationAttestationSignerId: string;
  readonly attestationSignerRelationship: "same-authority-cell";
  readonly cleanupParentReceiptDigest: string | null;
}

export interface PortableOutcomeAttestationV1 {
  readonly v: "reelier.portable-outcome-attestation/v1";
  readonly purpose: "execution" | "reconciliation";
  readonly statementDigest: string;
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}

export interface PortableOutcomeEvidencePublicationV1 {
  readonly v: "reelier.portable-outcome-evidence-publication/v1";
  readonly requestId: string;
  readonly evidence: PortableOutcomeEvidenceV1;
  readonly routeAuthority: Readonly<Record<string, unknown>>;
  readonly authenticatedIdentity: Readonly<Record<string, unknown>>;
  readonly materializedRequest: Readonly<Record<string, unknown>>;
  readonly responseSemanticsProfile: Readonly<Record<string, unknown>>;
  readonly responseObservation: Readonly<Record<string, unknown>>;
  readonly preStateEvidence: Readonly<Record<string, unknown>>;
  readonly postStateEvidence: Readonly<Record<string, unknown>>;
  readonly expectedPostProjectionDigest: string;
  readonly reconciliation: Readonly<Record<string, unknown>>;
  readonly receiptChainDigest: string;
  readonly collectionCountsDigest: string;
  readonly terminalDigest: string;
  readonly currentTrustObservationDigest: string;
  readonly executionAttestation: PortableOutcomeAttestationV1;
  readonly reconciliationAttestation: PortableOutcomeAttestationV1;
}

export interface PortableOutcomeSigner {
  readonly signerId: string;
  sign(digest: string): AuthoritySignature;
}

export type PortableOutcomeEvidencePublicationInput = Readonly<{
  requestId: string;
  routeAuthority: Readonly<Record<string, unknown>>;
  authenticatedIdentity: Readonly<Record<string, unknown>>;
  materializedRequest: Readonly<Record<string, unknown>>;
  responseSemanticsProfile: Readonly<Record<string, unknown>>;
  responseObservation: Readonly<Record<string, unknown>>;
  preStateEvidence: Readonly<Record<string, unknown>>;
  postStateEvidence: Readonly<Record<string, unknown>>;
  expectedPostProjectionDigest: string;
  confidence: PortableOutcomeEvidenceV1["confidence"];
  authoritativeStateSource: PortableOutcomeEvidenceV1["authoritativeStateSource"];
  reconciliation: Readonly<Record<string, unknown>>;
  cleanupParentReceiptDigest: string | null;
  receiptChain: readonly string[];
  collectionCounts: Readonly<Record<string, number>>;
  terminalDigest: string;
  currentTrustObservation: Readonly<Record<string, unknown>>;
  executionSigner: PortableOutcomeSigner;
  reconciliationSigner: PortableOutcomeSigner;
}>;

/** Composes durable local publication with a portable publication. The local
 * write must complete before portable evidence can become externally visible. */
export function createPortableAuthorityReceiptPublication(input: Readonly<{ localPublication: DispatchPublication; portablePublication: DispatchPublication; beforePublish?: () => void | Promise<void> }>): DispatchPublication {
  if (!input?.localPublication || typeof input.localPublication.publish !== "function" || !input.portablePublication || typeof input.portablePublication.publish !== "function") throw new TypeError("portable receipt publications are invalid");
  return Object.freeze({
    async publish(value: Parameters<DispatchPublication["publish"]>[0]) {
      await input.beforePublish?.();
      await input.localPublication.publish(value);
      return input.portablePublication.publish(value);
    },
  });
}

export function createPortableOutcomeEvidencePublication(input: PortableOutcomeEvidencePublicationInput): PortableOutcomeEvidencePublicationV1 {
  if (!input || typeof input.requestId !== "string" || !DIGEST.test(input.requestId)) throw new TypeError("portable outcome request must be an opaque digest");
  for (const [label, value] of [["route authority", input.routeAuthority], ["authenticated identity", input.authenticatedIdentity], ["materialized request", input.materializedRequest], ["response semantics", input.responseSemanticsProfile], ["response observation", input.responseObservation], ["pre-state", input.preStateEvidence], ["post-state", input.postStateEvidence], ["reconciliation", input.reconciliation], ["trust observation", input.currentTrustObservation]] as const) assertInertRecord(value, label);
  if (!DIGEST.test(input.expectedPostProjectionDigest) || !DIGEST.test(input.terminalDigest) || input.cleanupParentReceiptDigest !== null && !DIGEST.test(input.cleanupParentReceiptDigest)) throw new TypeError("portable outcome digest is invalid");
  if (!Array.isArray(input.receiptChain) || input.receiptChain.some(value => !DIGEST.test(value))) throw new TypeError("portable outcome receipt chain is invalid");
  if (!input.executionSigner?.signerId || typeof input.executionSigner.sign !== "function" || !input.reconciliationSigner?.signerId || typeof input.reconciliationSigner.sign !== "function") throw new TypeError("portable outcome attestation signer is invalid");
  const routeAuthorityDigest = authorityDigest(input.routeAuthority), materializedRequestDigest = authorityDigest(input.materializedRequest), responseSemanticsProfileDigest = authorityDigest(input.responseSemanticsProfile), preStateEvidenceDigest = authorityDigest(input.preStateEvidence), postStateEvidenceDigest = authorityDigest(input.postStateEvidence);
  const evidence: PortableOutcomeEvidenceV1 = Object.freeze({
    v: "reelier.portable-outcome-evidence/v1",
    routeAuthorityDigest,
    materializedRequestDigest,
    responseSemanticsProfileDigest,
    preStateEvidenceDigest,
    postStateEvidenceDigest,
    confidence: input.confidence,
    authoritativeStateSource: input.authoritativeStateSource,
    executionAttestationSignerId: input.executionSigner.signerId,
    reconciliationAttestationSignerId: input.reconciliationSigner.signerId,
    attestationSignerRelationship: "same-authority-cell",
    cleanupParentReceiptDigest: input.cleanupParentReceiptDigest,
  });
  const anchors = Object.freeze({ receiptChainDigest: authorityDigest(input.receiptChain), collectionCountsDigest: authorityDigest(input.collectionCounts), terminalDigest: input.terminalDigest, currentTrustObservationDigest: authorityDigest(input.currentTrustObservation) });
  const executionStatement = executionStatementDigest({ requestId: input.requestId, evidence, routeAuthority: input.routeAuthority, authenticatedIdentity: input.authenticatedIdentity, materializedRequest: input.materializedRequest, responseSemanticsProfile: input.responseSemanticsProfile, responseObservation: input.responseObservation, preStateEvidence: input.preStateEvidence, expectedPostProjectionDigest: input.expectedPostProjectionDigest, ...anchors });
  const executionAttestation = attestation("execution", executionStatement, input.executionSigner);
  const reconciliationStatement = reconciliationStatementDigest({ requestId: input.requestId, evidence, postStateEvidence: input.postStateEvidence, reconciliation: input.reconciliation, executionAttestation, ...anchors });
  const reconciliationAttestation = attestation("reconciliation", reconciliationStatement, input.reconciliationSigner);
  return Object.freeze({ v: "reelier.portable-outcome-evidence-publication/v1", requestId: input.requestId, evidence, routeAuthority: input.routeAuthority, authenticatedIdentity: input.authenticatedIdentity, materializedRequest: input.materializedRequest, responseSemanticsProfile: input.responseSemanticsProfile, responseObservation: input.responseObservation, preStateEvidence: input.preStateEvidence, postStateEvidence: input.postStateEvidence, expectedPostProjectionDigest: input.expectedPostProjectionDigest, reconciliation: input.reconciliation, ...anchors, executionAttestation, reconciliationAttestation });
}

export function portableExecutionStatementDigest(value: Pick<PortableOutcomeEvidencePublicationV1, "requestId" | "evidence" | "routeAuthority" | "authenticatedIdentity" | "materializedRequest" | "responseSemanticsProfile" | "responseObservation" | "preStateEvidence" | "expectedPostProjectionDigest" | "receiptChainDigest" | "collectionCountsDigest" | "terminalDigest" | "currentTrustObservationDigest">): string { const { requestId, evidence, routeAuthority, authenticatedIdentity, materializedRequest, responseSemanticsProfile, responseObservation, preStateEvidence, expectedPostProjectionDigest, receiptChainDigest, collectionCountsDigest, terminalDigest, currentTrustObservationDigest } = value; return executionStatementDigest({ requestId, evidence, routeAuthority, authenticatedIdentity, materializedRequest, responseSemanticsProfile, responseObservation, preStateEvidence, expectedPostProjectionDigest, receiptChainDigest, collectionCountsDigest, terminalDigest, currentTrustObservationDigest }); }
export function portableReconciliationStatementDigest(value: Pick<PortableOutcomeEvidencePublicationV1, "requestId" | "evidence" | "postStateEvidence" | "reconciliation" | "executionAttestation" | "receiptChainDigest" | "collectionCountsDigest" | "terminalDigest" | "currentTrustObservationDigest">): string { const { requestId, evidence, postStateEvidence, reconciliation, executionAttestation, receiptChainDigest, collectionCountsDigest, terminalDigest, currentTrustObservationDigest } = value; return reconciliationStatementDigest({ requestId, evidence, postStateEvidence, reconciliation, executionAttestation, receiptChainDigest, collectionCountsDigest, terminalDigest, currentTrustObservationDigest }); }

function executionStatementDigest(value: object): string { return authorityDigest({ v: "reelier.portable-execution-statement/v1", ...value }); }
function reconciliationStatementDigest(value: object): string { return authorityDigest({ v: "reelier.portable-reconciliation-statement/v1", ...value }); }
function attestation(purpose: PortableOutcomeAttestationV1["purpose"], statementDigest: string, signer: PortableOutcomeSigner): PortableOutcomeAttestationV1 { const body = { v: "reelier.portable-outcome-attestation/v1" as const, purpose, statementDigest, signerId: signer.signerId }; return Object.freeze({ ...body, signature: signer.sign(authorityDigest(body)) }); }

export function assertPortableInertRecord(value: unknown, label: string): asserts value is Record<string, unknown> { assertInertRecord(value, label); }
function assertInertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`portable ${label} is not a canonical object`);
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !("value" in descriptor) || descriptor.get || descriptor.set)) throw new TypeError(`portable ${label} contains an accessor`);
}
