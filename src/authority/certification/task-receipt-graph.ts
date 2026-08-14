import { createPublicKey } from "node:crypto";
import type { AuthorityReceiptBundle, AuthoritySignature } from "../types.js";
import { authorityCanonicalBytes, authorityDigest } from "../wire.js";
import { verifyAuthorityReceiptBundle, verifyPortableOutcomeEvidencePublication, verifySanitizedPortableOutcomeEvidenceExport, type PortableOutcomeEvidenceVerifier } from "../verify.js";
import { AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST } from "../adapter-contract.js";
import { verifyCertificationArtifactKeyBinding, type CertificationArtifactKeyBindingCommitmentV1, type CertificationArtifactKeyBindingV1 } from "./lifecycle-authority.js";
import type { AuthorityKeyDescriptorV1 } from "./authority.js";
import { parseTrustEvents, verifySignedCertificationReadiness } from "./authority.js";
import type { JobCardTrustPinV1 } from "../host/deployment.js";
import { verifyAuthoritySignature } from "../crypto.js";
import type { CertificationReceiptExtensionV1 } from "./lifecycle-receipts.js";
import { verifyCertificationPortableEvidence, type CertificationDuplicateAttemptHeadV1, type CertificationDuplicateAttemptV1, type CertificationDuplicateDecisionV1, type CertificationPolicyEvidenceV1, type CertificationPostStateEvidenceV1, type CertificationTaskAuthorityEvidenceV1, type CertificationTaskStatusEvidenceV1 } from "./portable-evidence.js";
import type { PortableOutcomeEvidencePublicationV1, SanitizedPortableOutcomeEvidenceExportV1 } from "../host/portable-receipts.js";
import type { HttpResponseSemanticsProfileV1 } from "../host/http-response-semantics.js";

const COLLECTIONS = ["grants", "principals", "allocations", "budgetEvents", "outcomes", "exceptions", "receipts", "receiptExtensions", "taskAuthorities", "postStateEvidence", "portableOutcomeEvidence", "policyEvidence", "taskStatusEvidence", "duplicateAttempts", "duplicateDecisions", "priorReceiptLinks", "keyDescriptors"] as const;
const COUNT_FIELDS = ["grants", "principals", "allocations", "budgetEvents", "outcomes", "exceptions", "topologyEvidence", "leases", "receipts", "receiptExtensions", "taskAuthorities", "postStateEvidence", "portableOutcomeEvidence", "policyEvidence", "taskStatusEvidence", "duplicateAttempts", "duplicateDecisions", "priorReceiptLinks", "keyDescriptors", "bindingEntries"] as const;
type CollectionName = (typeof COLLECTIONS)[number];
declare const VERIFIED_CERTIFICATION_TASK_GRAPH: unique symbol;

export interface VerifiedNativeOutcomeProjectionV1 {
  readonly taskId: string;
  readonly semanticOperationId: string;
  readonly reservationId: string;
  readonly authorityEvidenceDigest: string;
  readonly receiptDigest: string;
  readonly timeline: readonly Readonly<{ state: AuthorityReceiptBundle["evidence"]["value"]["timeline"][number]["state"]; eventDigest: string }>[];
  readonly verification: Readonly<{
    v: "reelier.verified-native-outcome-proof/v1";
    status: "verified";
    graphDigest: string;
    publicationDigest: string;
    journalReservationId: string;
    routeAuthorityDigest: string;
    writeRouteDigest: string;
    readRouteDigest: string;
    accountDigest: string;
    authenticatedProviderIdentityDigest: string;
    authenticatedIdentityDigest: string;
    materializedRequestDigest: string;
    responseSemanticsProfileDigest: string;
    responseObservationDigest: string;
    preStateEvidenceDigest: string;
    postStateEvidenceDigest: string;
    expectedPostProjectionDigest: string;
    claimStatuses: Readonly<AuthorityReceiptBundle["receipt"]["value"]["claims"]>;
    confidence: "exact" | "partial";
    authoritativeStateSource: "hermetic-github-fixture" | "github-api";
    reconciliationVerdict: "matched" | "conflict";
    reconciliationDigest: string;
    noResend: Readonly<{ status: "verified"; resendCount: 0 }>;
    receiptChain: readonly string[];
    receiptChainDigest: string;
    priorReceiptLinks: readonly Readonly<{ receiptDigest: string; priorReceiptDigest: string | null }>[];
    priorReceiptLinksDigest: string;
    collectionCountsDigest: string;
    cleanupParentReceiptDigest: string | null;
    terminalDigest: string;
    currentTrustObservationDigest: string;
  }>;
}

export interface VerifiedCertificationTaskReceiptGraphV1 {
  readonly status: "verified";
  readonly digest: string;
  readonly duplicateHistoryFreshness: "unchecked";
  readonly [VERIFIED_CERTIFICATION_TASK_GRAPH]: true;
}

export interface VerifiedNativeOutcomeReplayArtifactV1 {
  readonly v: "reelier.verified-native-outcome-replay/v1";
  readonly graph: CertificationTaskReceiptGraphV1;
  readonly trustPin: JobCardTrustPinV1;
  readonly currentTrustObservation: Readonly<Record<string, unknown>>;
  readonly verificationTime: string;
  readonly expectedResponseSemanticsProfile: HttpResponseSemanticsProfileV1;
  readonly authoritySnapshotDigest: string;
}

interface VerifiedNativeOutcomeRecordV1 {
  readonly projections: readonly VerifiedNativeOutcomeProjectionV1[];
  readonly replayArtifact: VerifiedNativeOutcomeReplayArtifactV1;
}

const verifiedNativeOutcomeRecords = new WeakMap<object, VerifiedNativeOutcomeRecordV1>();

export function readVerifiedNativeOutcomeProjections(value: VerifiedCertificationTaskReceiptGraphV1): readonly VerifiedNativeOutcomeProjectionV1[] {
  if (value === null || typeof value !== "object") throw new TypeError("verifier-produced native outcome evidence is required");
  const record = verifiedNativeOutcomeRecords.get(value);
  if (record === undefined) throw new TypeError("verifier-produced native outcome evidence provenance is absent");
  return record.projections;
}

export function createVerifiedNativeOutcomeReplayArtifact(value: VerifiedCertificationTaskReceiptGraphV1): VerifiedNativeOutcomeReplayArtifactV1 {
  if (value === null || typeof value !== "object") throw new TypeError("verifier-produced native outcome evidence is required");
  const record = verifiedNativeOutcomeRecords.get(value);
  if (record === undefined) throw new TypeError("verifier-produced native outcome evidence provenance is absent");
  return record.replayArtifact;
}

export function verifyNativeOutcomeReplayArtifact(value: unknown): VerifiedCertificationTaskReceiptGraphV1 {
  const artifact = exactRecord(value, ["v", "graph", "trustPin", "currentTrustObservation", "verificationTime", "expectedResponseSemanticsProfile", "authoritySnapshotDigest"], "verified native outcome replay artifact") as unknown as VerifiedNativeOutcomeReplayArtifactV1;
  if (artifact.v !== "reelier.verified-native-outcome-replay/v1" || typeof artifact.verificationTime !== "string") throw new TypeError("verified native outcome replay artifact is invalid");
  const verificationTime = new Date(artifact.verificationTime);
  if (!Number.isFinite(verificationTime.getTime()) || verificationTime.toISOString() !== artifact.verificationTime) throw new TypeError("verified native outcome replay time is invalid");
  if (artifact.authoritySnapshotDigest !== authorityDigest({ trustPin: artifact.trustPin, currentTrustObservation: artifact.currentTrustObservation, expectedResponseSemanticsProfile: artifact.expectedResponseSemanticsProfile })) throw new TypeError("verified native outcome replay authority snapshot changed");
  return verifyCertificationTaskReceiptGraph(artifact.graph, {
    trustPin: artifact.trustPin,
    currentTrustObservation: artifact.currentTrustObservation,
    now: verificationTime,
    expectedResponseSemanticsProfile: artifact.expectedResponseSemanticsProfile,
  });
}

interface GraphTerminalCommitmentV1 {
  readonly v: "reelier.certification-task-graph-terminal/v1";
  readonly rootGrantDigest: string;
  readonly contentDigest: string;
  readonly counts: Readonly<Record<(typeof COUNT_FIELDS)[number], number>>;
  readonly collectionDigests: Readonly<Record<CollectionName, string>>;
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}

export interface CertificationTaskReceiptGraphV1 { readonly v: "reelier.certification-task-receipt-graph/v1"; readonly adapterContractDigest: string; readonly taskId: string; readonly authorityCellId: string; readonly rootGrant: any; readonly grants: readonly any[]; readonly principals: readonly any[]; readonly allocations: readonly any[]; readonly budgetEvents: readonly any[]; readonly outcomes: readonly any[]; readonly exceptions: readonly any[]; readonly topology: Readonly<{ status: "unchecked" }>; readonly leases: Readonly<{ status: "absent"; entries: readonly never[] }>; readonly receipts: readonly AuthorityReceiptBundle[]; readonly receiptExtensions: readonly CertificationReceiptExtensionV1[]; readonly taskAuthorities: readonly CertificationTaskAuthorityEvidenceV1[]; readonly postStateEvidence: readonly CertificationPostStateEvidenceV1[]; readonly portableOutcomeEvidence: readonly PortableOutcomeEvidencePublicationV1[]; readonly policyEvidence: readonly CertificationPolicyEvidenceV1[]; readonly taskStatusEvidence: readonly CertificationTaskStatusEvidenceV1[]; readonly duplicateAttemptHead: CertificationDuplicateAttemptHeadV1; readonly duplicateAttempts: readonly CertificationDuplicateAttemptV1[]; readonly duplicateDecisions: readonly CertificationDuplicateDecisionV1[]; readonly priorReceiptLinks: readonly Readonly<{ receiptDigest: string; priorReceiptDigest: string | null }>[]; readonly binding: CertificationArtifactKeyBindingV1; readonly commitment: CertificationArtifactKeyBindingCommitmentV1; readonly keyDescriptors: readonly AuthorityKeyDescriptorV1[]; readonly signedReadiness: unknown; readonly terminalCommitment: GraphTerminalCommitmentV1 }
export interface CertificationTaskReceiptGraphV1 { readonly portableOutcomeEvidenceVersion: "reelier.portable-outcome-graph-extension/v1" }

export function createCertificationTaskReceiptGraph(input: Omit<CertificationTaskReceiptGraphV1, "v" | "adapterContractDigest" | "portableOutcomeEvidenceVersion" | "topology" | "leases" | "priorReceiptLinks" | "terminalCommitment"> & Readonly<{ terminalSigner: Readonly<{ signerId: string; sign(digest: string): AuthoritySignature }> }>): CertificationTaskReceiptGraphV1 {
  const { terminalSigner, ...nodes } = input;
  const links = Object.freeze(input.receipts.map(bundle => Object.freeze({ receiptDigest: authorityDigest(bundle.receipt.value), priorReceiptDigest: bundle.receipt.value.priorReceiptDigest })));
  const topology = Object.freeze({ status: "unchecked" as const }), leases = Object.freeze({ status: "absent" as const, entries: Object.freeze([]) });
  const content = { v: "reelier.certification-task-receipt-graph/v1" as const, adapterContractDigest: AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST, portableOutcomeEvidenceVersion: "reelier.portable-outcome-graph-extension/v1" as const, ...nodes, topology, leases, priorReceiptLinks: links };
  const counts = Object.freeze({ grants: input.grants.length, principals: input.principals.length, allocations: input.allocations.length, budgetEvents: input.budgetEvents.length, outcomes: input.outcomes.length, exceptions: input.exceptions.length, topologyEvidence: 0, leases: 0, receipts: input.receipts.length, receiptExtensions: input.receiptExtensions.length, taskAuthorities: input.taskAuthorities.length, postStateEvidence: input.postStateEvidence.length, portableOutcomeEvidence: input.portableOutcomeEvidence.length, policyEvidence: input.policyEvidence.length, taskStatusEvidence: input.taskStatusEvidence.length, duplicateAttempts: input.duplicateAttempts.length, duplicateDecisions: input.duplicateDecisions.length, priorReceiptLinks: links.length, keyDescriptors: input.keyDescriptors.length, bindingEntries: input.binding.entries.length });
  const collectionDigests = Object.freeze(Object.fromEntries(COLLECTIONS.map(key => [key, authorityDigest(content[key])])) as Record<CollectionName, string>);
  const terminalBody = { v: "reelier.certification-task-graph-terminal/v1" as const, rootGrantDigest: input.rootGrant.digest, contentDigest: authorityDigest(content), counts, collectionDigests, signerId: terminalSigner.signerId };
  const terminalCommitment = Object.freeze({ ...terminalBody, signature: terminalSigner.sign(authorityDigest(terminalBody)) });
  return Object.freeze({ ...content, terminalCommitment });
}

export function verifyCertificationTaskReceiptGraph(value: unknown, options: Readonly<{ trustPin: JobCardTrustPinV1; currentTrustObservation: Readonly<Record<string, unknown>>; now: Date; expectedResponseSemanticsProfile: HttpResponseSemanticsProfileV1 }>): VerifiedCertificationTaskReceiptGraphV1 {
  if (!options?.trustPin || !options.currentTrustObservation || !(options.now instanceof Date) || !Number.isFinite(options.now.getTime()) || !options.expectedResponseSemanticsProfile) throw new TypeError("external current trust, verification time, and response profile anchors are required for graph verification");
  const fields = ["v","adapterContractDigest","portableOutcomeEvidenceVersion","taskId","authorityCellId","rootGrant","grants","principals","allocations","budgetEvents","outcomes","exceptions","receipts","receiptExtensions","taskAuthorities","postStateEvidence","portableOutcomeEvidence","policyEvidence","taskStatusEvidence","duplicateAttemptHead","duplicateAttempts","duplicateDecisions","binding","commitment","keyDescriptors","signedReadiness","topology","leases","priorReceiptLinks","terminalCommitment"];
  const g = exactRecord(value, fields, "private certification receipt graph");
  if (g.v !== "reelier.certification-task-receipt-graph/v1" || g.adapterContractDigest !== AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST || g.portableOutcomeEvidenceVersion !== "reelier.portable-outcome-graph-extension/v1" || typeof g.taskId !== "string" || typeof g.authorityCellId !== "string") throw new TypeError("receipt graph is closed, extension-versioned, or contract mismatched");
  if (containsConfidential(g)) throw new TypeError("receipt graph contains confidential fields");
  for (const key of COLLECTIONS) if (!Array.isArray(g[key])) throw new TypeError(`receipt graph ${key} collection is invalid`);
  if (Object.keys(g.topology ?? {}).join("\0") !== "status" || g.topology.status !== "unchecked") throw new TypeError("receipt graph topology cannot be verified without signed topology evidence");
  const leases = exactRecord(g.leases, ["status", "entries"], "receipt graph leases");
  if (leases.status !== "absent" || !Array.isArray(leases.entries) || leases.entries.length !== 0) throw new TypeError("receipt graph leases cannot be verified without signed lease evidence");
  if (g.receipts.length === 0 || g.receipts.length !== g.priorReceiptLinks.length || new Set(g.receipts.map((b: any) => b.receipt.value.receiptId)).size !== g.receipts.length) throw new TypeError("receipt graph receipt nodes are omitted or duplicated");

  const pin = options.trustPin;
  verifySignedCertificationReadiness({ signed: pin.signedReadiness, readinessCandidate: pin.readinessCandidate, preflight: pin.preflight, humanTrustRoot: pin.humanTrustRoot, keyDescriptors: pin.keyDescriptors, trustEvents: pin.readinessTrustEvents });
  const readinessEvents = parseTrustEvents(pin.readinessTrustEvents, pin.keyDescriptors), currentEvents = parseTrustEvents(pin.currentTrustEvents, pin.keyDescriptors);
  if (readinessEvents.length > currentEvents.length || readinessEvents.some((event, index) => authorityDigest(event) !== authorityDigest(currentEvents[index]))) throw new TypeError("current trust history does not extend signed readiness");
  if (authorityDigest(g.keyDescriptors) !== authorityDigest(pin.keyDescriptors) || authorityDigest(g.signedReadiness) !== authorityDigest(pin.signedReadiness)) throw new TypeError("graph authority descriptors are not the external activated trust set");
  verifyCertificationArtifactKeyBinding(g.binding, g.commitment, { descriptors: pin.keyDescriptors, signedReadiness: pin.signedReadiness });
  const active = new Map<string, boolean>(); for (const event of currentEvents) active.set(event.keyDescriptorDigest, event.action === "activate");
  if (!active.get(authorityDigest(pin.humanTrustRoot))) throw new TypeError("readiness human root is not currently active");
  const evidenceRoot = pin.keyDescriptors.find(item => item.role === "authority-cell" && item.purpose === "authority-evidence");
  if (!evidenceRoot || !active.get(authorityDigest(evidenceRoot))) throw new TypeError("authority evidence root is revoked or not currently active");

  const terminalFields = ["v","rootGrantDigest","contentDigest","counts","collectionDigests","signerId","signature"], terminal = exactRecord(g.terminalCommitment, terminalFields, "receipt graph terminal commitment");
  const counts = exactRecord(terminal.counts, COUNT_FIELDS, "receipt graph terminal counts"), collectionDigests = exactRecord(terminal.collectionDigests, COLLECTIONS, "receipt graph collection digests");
  const expectedCounts = { grants: g.grants.length, principals: g.principals.length, allocations: g.allocations.length, budgetEvents: g.budgetEvents.length, outcomes: g.outcomes.length, exceptions: g.exceptions.length, topologyEvidence: 0, leases: 0, receipts: g.receipts.length, receiptExtensions: g.receiptExtensions.length, taskAuthorities: g.taskAuthorities.length, postStateEvidence: g.postStateEvidence.length, portableOutcomeEvidence: g.portableOutcomeEvidence.length, policyEvidence: g.policyEvidence.length, taskStatusEvidence: g.taskStatusEvidence.length, duplicateAttempts: g.duplicateAttempts.length, duplicateDecisions: g.duplicateDecisions.length, priorReceiptLinks: g.priorReceiptLinks.length, keyDescriptors: g.keyDescriptors.length, bindingEntries: g.binding.entries.length };
  if (COUNT_FIELDS.some(key => counts[key] !== expectedCounts[key]) || COLLECTIONS.some(key => collectionDigests[key] !== authorityDigest(g[key]))) throw new TypeError("receipt graph terminal counts or collection digests are invalid");
  const { terminalCommitment: _terminal, ...content } = g, { signature: terminalSignature, ...terminalBody } = terminal;
  if (terminal.v !== "reelier.certification-task-graph-terminal/v1" || terminal.signerId !== evidenceRoot.keyId || terminal.rootGrantDigest !== g.rootGrant.digest || terminal.contentDigest !== authorityDigest(content) || !verifyAuthoritySignature(publicKey(evidenceRoot), "authority-evidence", authorityDigest(terminalBody), terminalSignature as AuthoritySignature)) throw new TypeError("receipt graph signed terminal commitment is invalid");

  const root = g.grants[0], child = g.grants[1], delegationRoot = pin.keyDescriptors.find(item => item.role === "authority-cell" && item.purpose === "delegation-grant");
  if (!delegationRoot || !active.get(authorityDigest(delegationRoot)) || g.binding.taskId !== g.taskId || g.binding.authorityCellId !== g.authorityCellId || authorityDigest(g.rootGrant.grant) !== g.rootGrant.digest || g.rootGrant.grant.parentDigest !== null || g.grants.length !== 2 || root.digest !== g.rootGrant.digest || child.grant.parentDigest !== root.digest || root.grant.grantee !== child.grant.grantor || child.grant.delegationPolicy?.mayDelegate !== false || root.grant.delegationPolicy?.mayDelegate !== true || root.signerId !== delegationRoot.keyId || child.signerId !== delegationRoot.keyId || !verifyAuthoritySignature(publicKey(delegationRoot), "delegation-grant", root.digest, root.signature) || !verifyAuthoritySignature(publicKey(delegationRoot), "delegation-grant", child.digest, child.signature)) throw new TypeError("receipt graph grant lineage is broken");
  if (g.principals.length !== 2 || Object.keys(g.principals[0] ?? {}).join("\0") !== "principalId\0runtimeSessionId" || Object.keys(g.principals[1] ?? {}).join("\0") !== "principalId\0runtimeSessionId" || g.principals[0].principalId !== root.grant.grantee || g.principals[0].runtimeSessionId !== null || g.principals[1].principalId !== child.grant.grantee || typeof g.principals[1].runtimeSessionId !== "string") throw new TypeError("receipt graph principal lineage is broken");

  verifyBudgetGraph(g);
  verifyOutcomeChronology(g, pin, active);
  verifyExceptions(g);
  verifyReceiptChains(g, pin, root, child);
  verifyReceiptExtensions(g, pin, active);
  const journalRoot = pin.keyDescriptors.find(item => item.role === "authority-cell" && item.purpose === "authority-journal"); if (!journalRoot || !active.get(authorityDigest(journalRoot))) throw new TypeError("authority journal root is revoked or not currently active");
  verifyCertificationPortableEvidence({ taskAuthorities: g.taskAuthorities, postStateEvidence: g.postStateEvidence, policyEvidence: g.policyEvidence, taskStatusEvidence: g.taskStatusEvidence, duplicateAttemptHead: g.duplicateAttemptHead, duplicateAttempts: g.duplicateAttempts, duplicateDecisions: g.duplicateDecisions }, { verifier: { signerId: evidenceRoot.keyId, publicKey: publicKey(evidenceRoot) }, journalVerifier: { signerId: journalRoot.keyId, publicKey: publicKey(journalRoot), purpose: "authority-journal" }, trustPin: pin, taskId: g.taskId, authorityCellId: g.authorityCellId, grants: g.grants, allocations: g.allocations, receipts: g.receipts, outcomes: g.outcomes, budgetEvents: g.budgetEvents, adapterContractDigest: g.adapterContractDigest });
  verifyPortableOutcomeCollection(g, evidenceRoot, options);
  const digest = authorityDigest(g);
  const result = Object.freeze({ status: "verified" as const, digest, duplicateHistoryFreshness: "unchecked" as const }) as VerifiedCertificationTaskReceiptGraphV1;
  const replayArtifact = canonicalFrozenCopy({
    v: "reelier.verified-native-outcome-replay/v1" as const,
    graph: g as CertificationTaskReceiptGraphV1,
    trustPin: options.trustPin,
    currentTrustObservation: options.currentTrustObservation,
    verificationTime: options.now.toISOString(),
    expectedResponseSemanticsProfile: options.expectedResponseSemanticsProfile,
    authoritySnapshotDigest: authorityDigest({ trustPin: options.trustPin, currentTrustObservation: options.currentTrustObservation, expectedResponseSemanticsProfile: options.expectedResponseSemanticsProfile }),
  });
  verifiedNativeOutcomeRecords.set(result, Object.freeze({ projections: projectVerifiedNativeOutcomes(g, digest), replayArtifact }));
  return result;
}

function canonicalFrozenCopy<T>(value: T): T {
  const copy = JSON.parse(authorityCanonicalBytes(value).toString("utf8")) as T;
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== "object" || Object.isFrozen(item)) return;
    for (const child of Object.values(item as Record<string, unknown>)) freeze(child);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}

function projectVerifiedNativeOutcomes(g: any, graphDigest: string): readonly VerifiedNativeOutcomeProjectionV1[] {
  const projections = g.portableOutcomeEvidence.map((publication: any, index: number): VerifiedNativeOutcomeProjectionV1 => {
    const post = g.postStateEvidence[index];
    if (!post || typeof post.requestId !== "string") throw new TypeError("verified native outcome post-state identity is absent");
    const requestIds = new Set([post.requestId, `${post.requestId}.cleanup`]);
    const receiptBundles = g.receipts.filter((bundle: any) => requestIds.has(bundle.receipt.value.decisionContext.requestId));
    const mainReceipts = receiptBundles.filter((bundle: any) => bundle.receipt.value.decisionContext.requestId === post.requestId);
    const terminalReceipt = mainReceipts.at(-1);
    const outcome = [...g.outcomes].reverse().find((item: any) => item.requestId === post.requestId);
    if (!terminalReceipt) throw new TypeError("verified native outcome terminal receipt edge is absent");
    if (!outcome) throw new TypeError("verified native outcome journal edge is absent");
    const receiptDigests = new Set(receiptBundles.map((bundle: any) => authorityDigest(bundle.receipt.value)));
    const receiptChain = Object.freeze(g.receipts.filter((bundle: any) => receiptDigests.has(authorityDigest(bundle.receipt.value))).map((bundle: any) => authorityDigest(bundle.receipt.value)));
    const priorReceiptLinks = Object.freeze(g.priorReceiptLinks.filter((link: any) => receiptDigests.has(link.receiptDigest)).map((link: any) => Object.freeze({ receiptDigest: link.receiptDigest, priorReceiptDigest: link.priorReceiptDigest })));
    if (publication.receiptChainDigest !== authorityDigest(receiptChain)) throw new TypeError("verified native outcome receipt chain projection changed after verification");
    const route = publication.routeAuthority, evidence = publication.evidence, reconciliation = publication.reconciliation;
    const claims = terminalReceipt.receipt.value.claims;
    const claimStatuses = Object.freeze({ authorization: claims.authorization, sourceCompleteness: claims.sourceCompleteness, dispatch: claims.dispatch, providerAcknowledgment: claims.providerAcknowledgment, reconciliation: claims.reconciliation, topology: claims.topology, completeness: claims.completeness });
    const verification = Object.freeze({
      v: "reelier.verified-native-outcome-proof/v1" as const,
      status: "verified" as const,
      graphDigest,
      publicationDigest: authorityDigest(publication),
      journalReservationId: outcome.reservationId,
      routeAuthorityDigest: evidence.routeAuthorityDigest,
      writeRouteDigest: route.writeRouteDigest,
      readRouteDigest: route.readRouteDigest,
      accountDigest: route.accountDigest,
      authenticatedProviderIdentityDigest: route.authenticatedProviderIdentityDigest,
      authenticatedIdentityDigest: authorityDigest(publication.authenticatedIdentity),
      materializedRequestDigest: evidence.materializedRequestDigest,
      responseSemanticsProfileDigest: evidence.responseSemanticsProfileDigest,
      responseObservationDigest: authorityDigest(publication.responseObservation),
      preStateEvidenceDigest: evidence.preStateEvidenceDigest,
      postStateEvidenceDigest: evidence.postStateEvidenceDigest,
      expectedPostProjectionDigest: publication.expectedPostProjectionDigest,
      claimStatuses,
      confidence: evidence.confidence,
      authoritativeStateSource: evidence.authoritativeStateSource,
      reconciliationVerdict: reconciliation.verdict,
      reconciliationDigest: authorityDigest(reconciliation),
      noResend: Object.freeze({ status: "verified" as const, resendCount: 0 as const }),
      receiptChain,
      receiptChainDigest: publication.receiptChainDigest,
      priorReceiptLinks,
      priorReceiptLinksDigest: authorityDigest(priorReceiptLinks),
      collectionCountsDigest: publication.collectionCountsDigest,
      cleanupParentReceiptDigest: evidence.cleanupParentReceiptDigest,
      terminalDigest: publication.terminalDigest,
      currentTrustObservationDigest: publication.currentTrustObservationDigest,
    });
    const timeline = Object.freeze(terminalReceipt.evidence.value.timeline.map((entry: any) => Object.freeze({ state: entry.state, eventDigest: entry.eventDigest })));
    if (timeline.length === 0) throw new TypeError("verified native outcome timeline is absent");
    return Object.freeze({ taskId: g.taskId, semanticOperationId: publication.requestId, reservationId: terminalReceipt.evidence.value.reservationId, authorityEvidenceDigest: terminalReceipt.evidence.digest, receiptDigest: terminalReceipt.receipt.digest, timeline, verification });
  });
  return Object.freeze(projections);
}

function verifyBudgetGraph(g: any): void {
  const allocationFields = ["allocationId","taskId","parentAllocationId","effects","reserved","consumed","returned","revoked","remaining"];
  for (const allocation of g.allocations) { exactRecord(allocation, allocationFields, "receipt graph allocation"); for (const key of ["effects","reserved","consumed","returned","remaining"]) if (!Number.isSafeInteger(allocation[key]) || allocation[key] < 0) throw new TypeError("receipt graph allocation amount is invalid"); }
  const rootAllocation = g.allocations.find((item: any) => item.parentAllocationId === null), childAllocation = g.allocations.find((item: any) => item.parentAllocationId === rootAllocation?.allocationId);
  if (g.allocations.length !== 2 || !rootAllocation || !childAllocation || g.allocations[0] !== rootAllocation || g.allocations[1] !== childAllocation || rootAllocation.taskId !== g.taskId || childAllocation.taskId !== g.taskId || childAllocation.effects > rootAllocation.effects || rootAllocation.effects !== rootAllocation.consumed + rootAllocation.reserved + rootAllocation.remaining || childAllocation.effects !== childAllocation.consumed + childAllocation.returned + childAllocation.reserved + childAllocation.remaining || rootAllocation.consumed !== childAllocation.consumed || rootAllocation.reserved !== childAllocation.remaining + childAllocation.reserved) throw new TypeError("receipt graph budget is imbalanced");
  let previous: any;
  for (const [sequence, node] of g.budgetEvents.entries()) { exactRecord(node, ["sequence","priorBudgetEventDigest","event"], "receipt graph budget event node"); const eventFields = ["v","type","allocationId","taskId","effects",...(node.event?.reservationId === undefined ? [] : ["reservationId"]),"at","eventDigest"]; const event = exactRecord(node.event, eventFields, "receipt graph budget event"); const { eventDigest, ...body } = event; if (node.sequence !== sequence || node.priorBudgetEventDigest !== (sequence === 0 ? null : authorityDigest(previous)) || event.v !== "reelier.delegation-budget-event/v1" || event.taskId !== g.taskId || eventDigest !== authorityDigest(body)) throw new TypeError("receipt graph budget event chronology is invalid"); previous = node; }
  const allocated = g.budgetEvents.filter((node: any) => node.event.type === "allocated"); if (allocated.length !== 2 || allocated[0].event.allocationId !== rootAllocation.allocationId || allocated[1].event.allocationId !== childAllocation.allocationId) throw new TypeError("receipt graph allocation events are incomplete");
  const consumed = g.budgetEvents.filter((node: any) => node.event.type === "consumed" && node.event.allocationId === childAllocation.allocationId).reduce((sum: number, node: any) => sum + node.event.effects, 0), returned = g.budgetEvents.filter((node: any) => (node.event.type === "returned" || node.event.type === "released") && node.event.allocationId === childAllocation.allocationId).reduce((sum: number, node: any) => sum + node.event.effects, 0);
  if (consumed - g.budgetEvents.filter((node: any) => node.event.type === "released" && node.event.allocationId === childAllocation.allocationId).reduce((sum: number, node: any) => sum + node.event.effects, 0) !== childAllocation.consumed || returned !== childAllocation.returned) throw new TypeError("receipt graph budget event conservation is invalid");
}

function verifyOutcomeChronology(g: any, pin: JobCardTrustPinV1, active: Map<string, boolean>): void {
  const journalDescriptor = pin.keyDescriptors.find(item => item.role === "authority-cell" && item.purpose === "authority-journal"); if (!journalDescriptor || !active.get(authorityDigest(journalDescriptor))) throw new TypeError("receipt graph journal signer is not currently active");
  let priorRequest = "", expectedSequence = 0, prior: any;
  for (const outcome of g.outcomes) { const fields = ["v","requestId","requestDigest","reservationId","cleanupReservationId","allocationId","effectDigest","permitSnapshotDigest","adapterContractDigest","exactBytesDigest","conflictReceiptDigest","duplicateAttemptHeadDigest","eventSequence","priorJournalDigest","phase","providerWrites","signerId","signature"]; exactRecord(outcome, fields, "receipt graph outcome"); if (outcome.requestId < priorRequest || (outcome.requestId === priorRequest && outcome.eventSequence !== expectedSequence) || (outcome.requestId !== priorRequest && outcome.eventSequence !== 0)) throw new TypeError("receipt graph outcome canonical chronology is invalid"); if (outcome.requestId !== priorRequest) { priorRequest = outcome.requestId; expectedSequence = 0; prior = undefined; } const body = graphJournalBody(outcome); if (outcome.adapterContractDigest !== AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST || outcome.priorJournalDigest !== (prior ? authorityDigest(graphJournalBody(prior)) : null) || outcome.signerId !== journalDescriptor.keyId || !verifyAuthoritySignature(publicKey(journalDescriptor), "authority-journal", authorityDigest(body), outcome.signature)) throw new TypeError("receipt graph outcome signature or lineage is invalid"); prior = outcome; expectedSequence += 1; }
  if (g.outcomes.length === 0) throw new TypeError("receipt graph outcomes are absent");
}

function verifyExceptions(g: any): void { const terminals = new Map<string, any>(); for (const outcome of g.outcomes) terminals.set(outcome.requestId, outcome); const expected = [...terminals.values()].filter(item => ["failed","pending-reconciliation","conflict"].includes(item.phase)).map(item => item.phase === "conflict" ? { kind: "conflict", requestId: item.requestId, exactBytesDigest: item.exactBytesDigest, receiptDigest: item.conflictReceiptDigest } : { kind: item.phase, requestId: item.requestId, outcomeDigest: authorityDigest(graphJournalBody(item)) }); if (authorityDigest(expected) !== authorityDigest(g.exceptions)) throw new TypeError("receipt graph exceptions are incomplete or substituted"); }

function verifyReceiptChains(g: any, pin: JobCardTrustPinV1, root: any, child: any): void {
  const direct = pin.keyDescriptors.filter((item: any) => item.role === "authority-cell").map((item: any) => ({ tenant: g.authorityCellId, signerId: item.keyId, principalId: item.purpose === "delegation-grant" ? root.grant.grantor : child.grant.grantee, publicKey: publicKey(item), purposes: [item.purpose] }));
  const delegated = g.binding.entries.map((item: any) => ({ tenant: g.authorityCellId, signerId: item.keyId, principalId: child.grant.grantee, publicKey: createPublicKey({ key: Buffer.from(item.publicKeySpkiBase64, "base64"), format: "der", type: "spki" }), purposes: [item.artifactPurpose] }));
  const ordered: any[] = [], requestIds = [...new Set<string>(g.receipts.map((bundle: any) => bundle.receipt.value.decisionContext.requestId))].sort();
  const outcomeIds = new Set(g.outcomes.map((item: any) => item.requestId));
  for (const requestId of requestIds) { if (!outcomeIds.has(requestId) && ![...outcomeIds].some(id => requestId === `${id}.cleanup`)) throw new TypeError("receipt graph receipt is unreachable from an outcome"); let prior: any; const remaining = g.receipts.filter((bundle: any) => bundle.receipt.value.decisionContext.requestId === requestId); while (remaining.length) { const candidates = remaining.filter((bundle: any) => bundle.receipt.value.priorReceiptDigest === (prior ? authorityDigest(prior) : null)); if (candidates.length !== 1) throw new TypeError("receipt graph chain fork or broken prior link"); const bundle = candidates[0]; verifyAuthorityReceiptBundle(bundle, { tenant: g.authorityCellId, trustRoots: [...direct, ...delegated], ...(prior ? { priorReceipt: prior } : {}) }); ordered.push(bundle); remaining.splice(remaining.indexOf(bundle), 1); prior = bundle.receipt.value; } }
  if (authorityDigest(ordered) !== authorityDigest(g.receipts)) throw new TypeError("receipt graph receipt order is not canonical");
  const expectedLinks = g.receipts.map((bundle: any) => ({ receiptDigest: authorityDigest(bundle.receipt.value), priorReceiptDigest: bundle.receipt.value.priorReceiptDigest })); if (authorityDigest(expectedLinks) !== authorityDigest(g.priorReceiptLinks)) throw new TypeError("receipt graph prior links mismatch");
  const terminals = new Map<string, any>(); for (const outcome of g.outcomes) terminals.set(outcome.requestId, outcome);
  for (const terminal of terminals.values()) if (terminal.phase === "conflict") { const bundle = g.receipts.find((candidate: any) => authorityDigest(candidate.receipt.value) === terminal.conflictReceiptDigest); if (!bundle || bundle.receipt.value.decisionContext.requestId !== terminal.requestId || bundle.evidence.value.reconciliation.verdict !== "conflict" || bundle.evidence.value.reconciliation.normalizedProjectionDigest !== terminal.exactBytesDigest) throw new TypeError("receipt graph conflict receipt is not semantically linked to its journal"); }
}

function verifyReceiptExtensions(g: any, pin: JobCardTrustPinV1, active: Map<string, boolean>): void { const descriptor = pin.keyDescriptors.find(item => item.role === "authority-cell" && item.purpose === "authority-receipt"); if (!descriptor || !active.get(authorityDigest(descriptor)) || g.receiptExtensions.length !== g.receipts.length) throw new TypeError("receipt graph Adapter Contract extensions are incomplete or signer is inactive"); for (const [index, extension] of g.receiptExtensions.entries()) { exactRecord(extension, ["v","receiptDigest","adapterContractDigest","signerId","signature"], "receipt graph Adapter Contract extension"); const body = { v: extension.v, receiptDigest: extension.receiptDigest, adapterContractDigest: extension.adapterContractDigest, signerId: extension.signerId }; if (extension.v !== "reelier.certification-receipt-extension/v1" || extension.receiptDigest !== authorityDigest(g.receipts[index].receipt.value) || extension.adapterContractDigest !== AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST || extension.adapterContractDigest !== g.adapterContractDigest || extension.signerId !== descriptor.keyId || !verifyAuthoritySignature(publicKey(descriptor), "authority-receipt", authorityDigest(body), extension.signature)) throw new TypeError("receipt graph Adapter Contract extension is invalid"); } }

function verifyPortableOutcomeCollection(g: any, evidenceRoot: AuthorityKeyDescriptorV1, options: Readonly<{ trustPin: JobCardTrustPinV1; currentTrustObservation: Readonly<Record<string, unknown>>; now: Date; expectedResponseSemanticsProfile: HttpResponseSemanticsProfileV1 }>): void {
  if (g.portableOutcomeEvidence.length !== g.postStateEvidence.length || g.portableOutcomeEvidence.length === 0) throw new TypeError("portable native outcome evidence collection is omitted or duplicated");
  const verifier = { signerId: evidenceRoot.keyId, publicKey: publicKey(evidenceRoot), purpose: "authority-evidence" as const };
  for (const [index, publication] of g.portableOutcomeEvidence.entries()) {
    const post = g.postStateEvidence[index], receiptChain = Object.freeze(g.receipts.filter((bundle: any) => { const requestId = bundle.receipt?.value?.decisionContext?.requestId; return requestId === post.requestId || requestId === `${post.requestId}.cleanup`; }).map((bundle: any) => authorityDigest(bundle.receipt.value))), collectionCounts = portableCollectionCounts(g, post), terminalDigest = authorityDigest({ v: "reelier.portable-terminal-anchor/v1", taskId: g.taskId, rootGrantDigest: g.rootGrant.digest, receiptLinksDigest: authorityDigest(g.priorReceiptLinks), postStateEvidenceDigest: authorityDigest(g.postStateEvidence), collectionCountsDigest: authorityDigest(collectionCounts) });
    const currentTrustObservation = options.currentTrustObservation, verificationTime = options.now;
    const outcome = g.outcomes.find((item: any) => item.requestId === post.requestId && item.phase === "acknowledged") ?? [...g.outcomes].reverse().find((item: any) => item.requestId === post.requestId);
    if (!outcome || publication.requestId !== authorityDigest({ v: "reelier.portable-request-id/v1", requestId: post.requestId }) || publication.expectedPostProjectionDigest !== post.expectedProjectionDigest || publication.reconciliation?.observedProjectionDigest !== post.observedProjectionDigest || publication.reconciliation?.providerWriteCount !== outcome.providerWrites) throw new TypeError("portable runtime provenance is not bound to the executed outcome");
    const cleanupReceipts = g.receipts.filter((bundle: any) => bundle.receipt?.value?.decisionContext?.requestId === `${post.requestId}.cleanup`);
    let expectedCleanupParent: string | null = null;
    if (cleanupReceipts.length > 0) {
      const referencedParents = new Set(cleanupReceipts.map((bundle: any) => bundle.receipt.value.priorReceiptDigest).filter((digest: unknown) => typeof digest === "string"));
      const terminals = cleanupReceipts.filter((bundle: any) => !referencedParents.has(authorityDigest(bundle.receipt.value)));
      if (terminals.length !== 1 || terminals[0].receipt.value.priorReceiptDigest === null) throw new TypeError("portable durable cleanup receipt chain has no exact terminal parent");
      expectedCleanupParent = terminals[0].receipt.value.priorReceiptDigest;
    }
    if (publication.evidence?.cleanupParentReceiptDigest !== expectedCleanupParent) throw new TypeError("portable cleanup parent does not equal the independently verified durable cleanup chain parent");
    verifyPortableOutcomeEvidencePublication(publication, { executionVerifier: verifier, reconciliationVerifier: verifier, currentTrustObservation, receiptChain, collectionCounts, terminalDigest, now: verificationTime, expectedResponseSemanticsProfile: options.expectedResponseSemanticsProfile });
  }
}

/** Verifies the identity-bearing graph privately, then verifies the separate
 * sanitized export's digest/count join. No private graph field is copied into
 * the returned portable result. */
export function verifyCertificationSanitizedPortableOutcomeEvidenceExport(
  portable: SanitizedPortableOutcomeEvidenceExportV1,
  privateGraph: unknown,
  options: Readonly<{ trustPin: JobCardTrustPinV1; currentTrustObservation: Readonly<Record<string, unknown>>; now: Date; expectedResponseSemanticsProfile: HttpResponseSemanticsProfileV1; portableVerifier: PortableOutcomeEvidenceVerifier }>,
): Readonly<{ status: "verified"; graphDigest: string; portableDigest: string }> {
  const graph = verifyCertificationTaskReceiptGraph(privateGraph, options);
  const verified = verifySanitizedPortableOutcomeEvidenceExport(portable, { privateGraph: privateGraph as Readonly<Record<string, unknown>>, verifier: options.portableVerifier });
  return Object.freeze({ status: "verified", graphDigest: graph.digest, portableDigest: verified.digest });
}

function portableCollectionCounts(graph: any, post: any): Readonly<Record<string, number>> { return Object.freeze({ receipts: graph.receipts.length, receiptExtensions: graph.receiptExtensions.length, portableOutcomeEvidence: Array.isArray(graph.portableOutcomeEvidence) ? graph.portableOutcomeEvidence.length : graph.postStateEvidence.length, postStateEvidence: graph.postStateEvidence.length, outcomes: graph.outcomes.length, requestReceipts: graph.receipts.filter((bundle: any) => { const requestId = bundle.receipt?.value?.decisionContext?.requestId; return requestId === post.requestId || requestId === `${post.requestId}.cleanup`; }).length }); }

function graphJournalBody(value: any): any { return { v: value.v, requestId: value.requestId, requestDigest: value.requestDigest, reservationId: value.reservationId, cleanupReservationId: value.cleanupReservationId, allocationId: value.allocationId, effectDigest: value.effectDigest, permitSnapshotDigest: value.permitSnapshotDigest, adapterContractDigest: value.adapterContractDigest, exactBytesDigest: value.exactBytesDigest, conflictReceiptDigest: value.conflictReceiptDigest, duplicateAttemptHeadDigest: value.duplicateAttemptHeadDigest, eventSequence: value.eventSequence, priorJournalDigest: value.priorJournalDigest, phase: value.phase, providerWrites: value.providerWrites }; }
function publicKey(descriptor: Readonly<{ publicKeySpkiBase64: string }>) { return createPublicKey({ key: Buffer.from(descriptor.publicKeySpkiBase64, "base64"), format: "der", type: "spki" }); }
function exactRecord(value: unknown, fields: readonly string[], label: string): any {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} is not an exact canonical object`);
  }
  const keys = Object.keys(value);
  if (keys.length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) {
    throw new TypeError(`${label} is not an exact canonical object`);
  }
  return value as any;
}
function containsConfidential(value: unknown): boolean { if (!value || typeof value !== "object") return typeof value === "string" && /canary-private-token/i.test(value); for (const [key, child] of Object.entries(value as Record<string, unknown>)) { if (/^(bearerToken|credential|credentials|privateKey|secretToken|token)$/i.test(key) || containsConfidential(child)) return true; } return false; }
