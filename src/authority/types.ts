export const authorityKinds = ["principal","delegation-grant","source-bundle","outcome-contract","outcome-request","transport-effect","compiled-capability","decision-context","gate-event","authority-evidence","authority-receipt","pack-manifest"] as const;
export type AuthorityKind = (typeof authorityKinds)[number];
export type AuthoritySignaturePurpose = AuthorityKind | "signed-job-card" | "authority-lease";
export type ClaimStatus = "verified" | "failed" | "unchecked" | "absent";
type Wire<V extends string> = Readonly<{ v: V }>;
export interface Principal extends Wire<"reelier.principal/v1"> { id: string; kind: "operator"|"requester"|"sponsor"|"gate"|"provider" }
/** Host-authenticated execution identity. It is never accepted from an Outcome request body. */
export interface AuthorityExecutionContextV1 extends Wire<"reelier.authority-execution-context/v1"> {
  taskId: string;
  principalId: string;
  grantId: string;
  grantDigest: string;
  allocationId: string;
  runtimeSessionId: string;
  jobId: string;
  authorityCellId: string;
}
export interface SignedAuthorityLeaseV1 extends Wire<"reelier.authority-lease/v1"> {
  tenant: string; kernel: string; taskId: string; definitionAlias: string;
  stateVersion: number; stateDigest: string; jobCardDigest: string; rootGrantDigest: string;
  topologyEvidenceDigest: string; issuedAt: string; expiresAt: string; nonce: string;
  signerId: string; signature: AuthoritySignature;
}
export interface TopologyProbeEvidenceV1 extends Wire<"reelier.topology-probe-evidence/v1"> {
  runtimeIdentity: string; imageIdentity: string; declaredProviderSurfaceDigest: string;
  networkPolicyDigest: string; credentialInventoryDigest: string;
  probeResultsDigest: string; issuedAt: string; freshUntil: string;
  claims: { credentialIsolation: ClaimStatus; providerEgress: ClaimStatus; rawWriteReachability: ClaimStatus; readCoverage: ClaimStatus; runtimeIdentity: ClaimStatus; declaredSurfaceEnforcement: ClaimStatus };
}
export interface ConfidentialTransferCommitmentV1 extends Wire<"reelier.confidential-transfer/v1"> {
  sourceOutcome: string; destinationOutcome: string; secretSlot: string; valueDigest: string;
  destination: string; retention: { expiresAt: string; deleteAfterTerminalHours: number };
  deletion: "pending" | "deleted" | "unavailable";
}
export interface TaskReceiptGraphV1 extends Wire<"reelier.task-receipt-graph/v1"> {
  taskId: string; rootGrantDigest: string; grants: readonly string[]; principals: readonly string[];
  allocations: readonly string[]; budgetEvents: readonly string[]; outcomes: readonly string[];
  exceptions: readonly string[]; topologyEvidence: readonly string[]; leases: readonly string[];
  receipts: readonly string[]; priorReceiptLinks: readonly string[];
}
export interface AuthorityLimits { maxEffectsPerWindow:number; windowSeconds:number; maxEffectsPerSourceTrigger:number; maxBodyBytes:number }
export interface ConnectorAccount { connectorId:string; accountId:string }
export interface DelegationPolicy { mayDelegate:boolean; maxDepth:number; maxFanOut:number; maxChildDurationSeconds:number; maxDelegatedEffects:number }
export interface ConservedBudgetV1 extends Wire<"reelier.conserved-budget/v1"> { taskId:string; allocationId:string; rootAllocationId:string; effects:{root:number;reserved:number;consumed:number;returned:number;remaining:number} }
export interface DelegationBudgetEventV1 extends Wire<"reelier.delegation-budget-event/v1"> { eventId:string; taskId:string; allocationId:string; kind:"allocated"|"consumed"|"returned"|"expired"|"revoked"; effects:number; at:string; previousDigest:string|null }
export interface DelegationConstraints { definitionAliases:string[]; audiences:string[]; connectorAccounts:ConnectorAccount[]; projectionPointers:string[]; riskClasses:string[]; limits:AuthorityLimits }
export interface DelegationGrant extends Wire<"reelier.delegation-grant/v1"> { tenant:string; grantId:string; parentDigest:string|null; sponsor:string; grantor:string; grantee:string; issuedAt:string; expiresAt:string; constraints:DelegationConstraints; delegationPolicy?:DelegationPolicy }
export interface OutcomeRequest extends Wire<"reelier.outcome-request/v1"> { requestId:string; sourceRefs:Record<string,string>; choices:Record<string,string|number|boolean|null> }
export interface SourceClaim { claimId:string; projectionPointer:string }
export interface SourceObservationEvidence { index:number;planDigest:string;endpointId:string;rawDigest:string }
export interface SourceBundle extends Wire<"reelier.source-bundle/v1"> { tenant:string; definitionDigest:string; projectionSchemaId:string; sourceRefsDigest:string; readSetDigest:string; sourceIdentity:string; triggerIdentity:string; observedAt:string; freshUntil:string; provenance:{resolverId:string;observations:SourceObservationEvidence[]}; claims:{grounded:SourceClaim[];authored:SourceClaim[];unresolved:SourceClaim[]}; projection:Record<string,unknown> }
export interface OutcomeContract extends Wire<"reelier.outcome-contract/v1"> { tenant:string;alias:string;contractId:string;validFrom:string;validUntil:string;packDigest:string;definitionDigest:string;sponsor:string;audiences:string[];delegationGrantDigest:string;connectorId:string;accountId:string;sourceAuthority:{resolverId:string;projectionSchemaId:string;allowedReadEndpointIds:string[];authorizedProjectionPointers:string[];maxFreshnessSeconds:number};riskClasses:string[];limits:AuthorityLimits;policyCommitment:{schemaId:string;jcsBase64:string;digest:string} }
export interface TransportEffect extends Wire<"reelier.transport-effect/v1"> { endpointId:string;method:"POST"|"PUT"|"PATCH"|"DELETE";path:string;query:string;headers:Record<string,string>;bodyBase64:string;riskClass:string;idempotency:"native"|"reconcile-only";preconditions:{kind:string;digest:string}[];reconciliation:{recipeId:string} }
export interface CompiledCapability extends Wire<"reelier.compiled-capability/v1"> { tenant:string;requester:string;definitionAlias:string;requestDigest:string;requestKey:string;contractDigest:string;sourceBundleDigest:string;sourceSnapshotDigest:string;authorityStateDigest:string;limits:AuthorityLimits;limitsDigest:string;capabilityId:string;outcomeKey:string;effectDigest:string;issuedAt:string;expiresAt:string }
export interface DecisionContext extends Wire<"reelier.decision-context/v1"> { tenant:string;requester:string;definitionAlias:string;requestId:string;requestDigest:string;requestKey:string;contractDigest:string|null;capabilityId:string|null;capabilityDigest:string|null;outcomeKey:string|null;effectDigest:string|null;snapshots:{sourceBundleDigest:string|null;authorityStateDigest:string|null} }
export type DecisionArtifactPresence = "absent" | "unchecked";
export interface DecisionContextPresence { contract:DecisionArtifactPresence;capability:DecisionArtifactPresence;outcome:DecisionArtifactPresence;effect:DecisionArtifactPresence;sourceBundleSnapshot:DecisionArtifactPresence;authorityStateSnapshot:DecisionArtifactPresence }
export interface GateEvent extends Wire<"reelier.gate-event/v1"> { eventId:string;at:string;verdict:"accepted"|"refused";reasonCode:string;decisionContextDigest:string }
export interface AuthorityEvidence extends Wire<"reelier.authority-evidence/v1"> {
  evidenceId:string;
  receiptId:string;
  decisionContextDigest:string;
  gateEventDigest:string;
  effectDigest:string;
  reservationId:string;
  timeline:readonly { state:"reserved"|"dispatched"|"acknowledged"|"definitive-failure"|"ambiguous"|"reconciled"|"cancelled"; at:string; eventDigest:string }[];
  dispatchedRequestDigest:string|null;
  providerResponseDigest:string|null;
  reconciliation:{ recipeId:string; verdict:"matched"|"not-applied"|"conflict"|"unavailable"|"not-attempted"; normalizedProjectionDigest:string|null };
  topology:{ egress:ClaimStatus; secretIsolation:ClaimStatus; ingressAuthentication:ClaimStatus; notes:string|null };
}
export interface AuthorityReceipt extends Wire<"reelier.authority-receipt/v1"> { receiptId:string;gateEventDigest:string;decisionContextDigest:string;decisionContext:DecisionContext;evidenceDigest:string;priorReceiptDigest:string|null;claims:{authorization:ClaimStatus;sourceCompleteness:ClaimStatus;dispatch:ClaimStatus;providerAcknowledgment:ClaimStatus;reconciliation:ClaimStatus;topology:ClaimStatus;completeness:ClaimStatus} }
export interface OutcomePackManifest extends Wire<"reelier.outcome-pack-manifest/v1"> { packId:string;packDigest:string;definitions:string[] }
export interface AuthorityWireByKind { principal:Principal;"delegation-grant":DelegationGrant;"source-bundle":SourceBundle;"outcome-contract":OutcomeContract;"outcome-request":OutcomeRequest;"transport-effect":TransportEffect;"compiled-capability":CompiledCapability;"decision-context":DecisionContext;"gate-event":GateEvent;"authority-evidence":AuthorityEvidence;"authority-receipt":AuthorityReceipt;"pack-manifest":OutcomePackManifest }
export type AuthorityWire = AuthorityWireByKind[AuthorityKind];
export type AuthoritySignature = Readonly<{ alg:"ed25519";sig:string }>;

export interface SignedAuthorityArtifact<K extends AuthorityKind = AuthorityKind> {
  readonly kind:K;
  readonly signerId:string;
  readonly digest:string;
  readonly value:AuthorityWireByKind[K];
  readonly signature:AuthoritySignature;
}
export interface AuthorityReceiptBundle {
  readonly v:"reelier.authority-receipt-bundle/v1";
  readonly contract:SignedAuthorityArtifact<"outcome-contract">;
  readonly delegation:readonly SignedAuthorityArtifact<"delegation-grant">[];
  readonly sourceBundle:SignedAuthorityArtifact<"source-bundle">;
  readonly capability:SignedAuthorityArtifact<"compiled-capability">;
  readonly transportEffect:SignedAuthorityArtifact<"transport-effect">;
  readonly gateEvent:SignedAuthorityArtifact<"gate-event">;
  readonly evidence:SignedAuthorityArtifact<"authority-evidence">;
  readonly receipt:SignedAuthorityArtifact<"authority-receipt">;
  readonly packManifest:SignedAuthorityArtifact<"pack-manifest">;
  readonly signatures:readonly { readonly kind:AuthorityKind; readonly digest:string; readonly signerId:string; readonly signature:AuthoritySignature }[];
}
