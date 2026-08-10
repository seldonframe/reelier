export const CAPABILITY_LIFETIME_MS = 60_000;

export type LedgerState =
  | "issued"
  | "reserved"
  | "dispatched"
  | "acknowledged"
  | "definitive-failure"
  | "ambiguous"
  | "cancelled"
  | "reconciled";

export interface LimitSlotIntent {
  readonly kind: "contract-window" | "source-trigger";
  readonly key: string;
  readonly maximum: number;
}

export interface ReservationIntent {
  readonly tenant: string;
  readonly requester: string;
  readonly definitionAlias: string;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly canonicalRequestDigest: string;
  readonly canonicalRequestBytes: Uint8Array;
  readonly requestKey: string;
  readonly ingressClaimDigest: string;
  readonly decisionContextDigest: string;
  readonly capabilityId: string;
  readonly capabilityDigest: string;
  readonly capabilityBytes: Uint8Array;
  readonly contractDigest: string;
  readonly sourceBundleDigest: string;
  readonly sourceSnapshotDigest: string;
  readonly authorityStateDigest: string;
  readonly limits: Readonly<{ maxEffectsPerWindow:number;windowSeconds:number;maxEffectsPerSourceTrigger:number;maxBodyBytes:number }>;
  readonly limitsDigest: string;
  readonly outcomeKey: string;
  readonly effectDigest: string;
  /** Canonical transport-effect bytes retained for restart-time evidence when available. */
  readonly effectCanonicalBase64?: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly limitSlots: readonly LimitSlotIntent[];
  /** Host-authenticated task/principal lineage; never read from OutcomeRequest. */
  readonly executionContext?: import("./types.js").AuthorityExecutionContextV1;
}

export interface StoredReservationIntent extends Omit<ReservationIntent, "canonicalRequestBytes" | "capabilityBytes" | "limitSlots"> {
  readonly canonicalRequestBase64: string;
  readonly capabilityBase64: string;
  readonly limitSlots: readonly LimitSlotIntent[];
}
export interface ReservationLinkage {readonly reservationId:string;readonly state:Exclude<LedgerState,"issued">;readonly ingressClaimDigest:string;readonly capabilityId:string;readonly capabilityDigest:string;readonly authorityStateDigest:string;readonly decisionContextDigest:string;readonly updatedAt:string;readonly receiptRef?:string}

export interface ReservationSnapshot {
  readonly reservationId: string;
  readonly state: Exclude<LedgerState, "issued">;
  readonly intent: StoredReservationIntent;
  readonly limitAssignments: readonly Readonly<{ key: string; index: number; maximum: number }>[];
  readonly sequence: number;
  readonly updatedAt: string;
  readonly resultDigest?: string;
}

export type TransitionEvent =
  | Readonly<{ to: "dispatched" }>
  | Readonly<{ to: "ambiguous"; resultDigest?: string }>
  | Readonly<{ to: "cancelled"; resultDigest: string }>
  | Readonly<{ to: "acknowledged" | "definitive-failure" | "reconciled"; resultDigest: string }>;

export interface ReservationHistoryEntry {
  readonly sequence: number;
  readonly from: LedgerState;
  readonly to: Exclude<LedgerState, "issued">;
  readonly at: string;
  readonly eventDigest: string;
  readonly resultDigest?: string;
}

export interface ReservationHistory {
  readonly reservation: ReservationSnapshot;
  readonly entries: readonly ReservationHistoryEntry[];
}

export type ReserveReason =
  | "idempotency-conflict"
  | "semantic-duplicate"
  | "capability-integrity"
  | "capability-already-reserved"
  | "limit-exceeded"
  | "not-yet-valid"
  | "expired"
  | "clock-rollback"
  | "integrity-failure"
  | "busy"
  | "lock-owner-unverifiable"
  | "corruption";

export type TransitionReason =
  | "not-found"
  | "state-conflict"
  | "illegal-transition"
  | "expired"
  | "not-yet-valid"
  | "clock-rollback"
  | "busy"
  | "lock-owner-unverifiable"
  | "corruption";

export type ReserveResult =
  | Readonly<{ ok: true; status: "reserved" | "existing"; dispatchEligible: boolean; reservation: ReservationSnapshot }>
  | Readonly<{ ok: false; reason: ReserveReason }>;

export type TransitionResult =
  | Readonly<{ ok: true; status: "transitioned"; reservation: ReservationSnapshot }>
  | Readonly<{ ok: false; reason: TransitionReason }>;

export interface LedgerTopology {
  readonly directorySync: "verified" | "best-effort";
}

export type RecoverResult =
  | Readonly<{ ok: true; reservations: readonly ReservationSnapshot[]; highWaterMark: string | null; topology: LedgerTopology }>
  | Readonly<{ ok: false; reason: "busy" | "lock-owner-unverifiable" | "corruption" }>;

export type ObserveClockResult =
  | Readonly<{ ok:true;status:"advanced"|"equal";observedAt:string }>
  | Readonly<{ ok:false;reason:"clock-rollback"|"clock-unavailable"|"busy"|"lock-owner-unverifiable"|"corruption" }>;
export type BindIngressResult =
  | Readonly<{ok:true;status:"claimed";evaluationEligible:true;ingressClaimDigest:string}>
  | Readonly<{ok:true;status:"exact-existing";evaluationEligible:false;ingressClaimDigest:string}>
  | Readonly<{ok:false;reason:"conflict";evaluationEligible:false;ingressClaimDigest:string}>
  | Readonly<{ok:false;reason:"integrity-failure"|"busy"|"lock-owner-unverifiable"|"corruption"}>;
export interface RedactedIngressBinding {readonly requestId:string;readonly requestKey:string;readonly definitionAlias:string;readonly ingressClaimDigest:string;readonly bindingStatus:"bound"}
export interface VerifiedIngressClaimLinkage {readonly tenant:string;readonly requester:string;readonly requestId:string;readonly definitionAlias:string;readonly requestDigest:string;readonly requestKey:string;readonly ingressClaimDigest:string}

export interface AuthorityLedger {
  observeClock(): Promise<ObserveClockResult>;
  bindIngress(request: import("./keys.js").AuthenticatedOutcomeRequest): Promise<BindIngressResult>;
  lookupIngress(requestKey:string):Promise<RedactedIngressBinding|undefined>;
  lookupIngressClaimLinkage(requestKey:string):Promise<VerifiedIngressClaimLinkage|undefined>;
  reserve(intent: ReservationIntent): Promise<ReserveResult>;
  transition(reservationId: string, expectedState: LedgerState, event: TransitionEvent): Promise<TransitionResult>;
  recover(options?: Readonly<{ deferTerminal?: boolean }>): Promise<RecoverResult>;
  getReservation(reservationId: string): Promise<ReservationSnapshot | undefined>;
  lookupReservationLinkage(reservationId:string):Promise<ReservationLinkage|undefined>;
  getReservationHistory(reservationId: string): Promise<ReservationHistory | undefined>;
  getHighWaterMark(): Promise<Readonly<{ observedAt: string | null }>>;
}
