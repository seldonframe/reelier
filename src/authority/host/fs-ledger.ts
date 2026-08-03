import canonicalize from "canonicalize";
import { createHash, randomBytes } from "node:crypto";
import {
  lstatSync,
  realpathSync,
} from "node:fs";
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import type {
  AuthorityLedger,
  BindIngressResult,
  LedgerState,
  ObserveClockResult,
  RedactedIngressBinding,
  RecoverResult,
  ReservationHistory,
  ReservationHistoryEntry,
  ReservationIntent,
  ReservationSnapshot,
  ReserveReason,
  ReserveResult,
  StoredReservationIntent,
  TransitionEvent,
  TransitionReason,
  TransitionResult,
} from "../ledger.js";
import { CAPABILITY_LIFETIME_MS } from "../ledger.js";
import type { CompiledCapability, OutcomeRequest } from "../types.js";
import { authorityDigest, parseCanonicalAuthorityJson } from "../wire.js";
import type { AuthenticatedOutcomeRequest } from "../keys.js";
import { authenticatedOutcomeRequestState, deriveAuthorityRequestKey, digestOutcomeRequest } from "../keys.js";
import {
  ADMISSION_SLOT_NAME,
  buildPublicationName,
  classifyCoordinationOwnerBytes,
  COORDINATION_ACK_VERSION,
  coordinationCanonicalBytes,
  coordinationCanonicalDigest,
  coordinationHostDigest,
  coordinationIdentityMatches,
  coordinationRawDigest,
  encodeCoordinationIdentityWire,
  isK1ReservedName,
  parseCoordinationAckBytes,
  parseCoordinationIdentityWire,
  parseCoordinationOwnerBytes,
  parseK1Name,
  parsePublicationName,
  type CoordinationAck,
  type CoordinationFileIdentity,
  type CoordinationIdentityWire,
  type CoordinationOwner,
  type PartialOwnerState,
  type ParsedK1Name,
} from "./fs-ledger-coordination.js";

type OperationContext = "reservation" | "dispatch" | "result" | "ingress" | "clock";

export const reservationFaultPoints = Object.freeze([
  "after-lock-acquire",
  "reservation-before-clock-high-water-write", "reservation-after-clock-high-water-write",
  "reservation-before-create", "reservation-after-create", "reservation-before-write", "reservation-after-write",
  "reservation-before-file-sync", "reservation-after-file-sync", "reservation-before-close", "reservation-after-close",
  "reservation-before-directory-sync", "reservation-after-directory-sync",
  "reservation-before-claim-acquisition", "reservation-after-claim-acquisition",
  "reservation-before-commit-marker", "reservation-after-commit-marker",
] as const);
export const dispatchFaultPoints = Object.freeze([
  "dispatch-before-clock-high-water-write", "dispatch-after-clock-high-water-write",
  "dispatch-before-create", "dispatch-after-create", "dispatch-before-write", "dispatch-after-write",
  "dispatch-before-file-sync", "dispatch-after-file-sync", "dispatch-before-close", "dispatch-after-close",
  "dispatch-before-directory-sync", "dispatch-after-directory-sync",
  "dispatch-before-journal-transition", "dispatch-after-journal-transition",
] as const);
export const resultFaultPoints = Object.freeze([
  "result-before-clock-high-water-write", "result-after-clock-high-water-write",
  "result-before-create", "result-after-create", "result-before-write", "result-after-write",
  "result-before-file-sync", "result-after-file-sync", "result-before-close", "result-after-close",
  "result-before-directory-sync", "result-after-directory-sync",
  "result-before-journal-transition", "result-after-journal-transition",
] as const);
export const ingressFaultPoints = Object.freeze([
  "ingress-before-create", "ingress-after-create", "ingress-before-write", "ingress-after-write",
  "ingress-before-file-sync", "ingress-after-file-sync", "ingress-before-close", "ingress-after-close",
  "ingress-before-directory-sync", "ingress-after-directory-sync",
] as const);
export const clockFaultPoints = Object.freeze([
  "clock-before-clock-high-water-write", "clock-after-clock-high-water-write",
  "clock-before-create", "clock-after-create", "clock-before-write", "clock-after-write",
  "clock-before-file-sync", "clock-after-file-sync", "clock-before-close", "clock-after-close",
  "clock-before-directory-sync", "clock-after-directory-sync",
] as const);
export const ledgerLockFaultPoints = Object.freeze([
  "after-admission-prep-enumeration", "after-admission-slot-enumeration",
  "after-pre-admission-housekeeping-initial-enumeration", "after-pre-admission-housekeeping-generation-closed",
  "before-pre-admission-housekeeping-final-validation",
  "after-coordination-cleanup-marker-enumeration",
  "after-lock-publication-stage-create", "after-lock-publication-owner-create",
  "after-lock-publication-owner-partial-write", "after-lock-publication-owner-sync",
  "after-lock-publication-stage-sync", "after-lock-publication-rename", "after-lock-publication-root-sync",
  "after-active-lock-metadata", "before-active-lock-content-read",
  "after-mutating-admission-enumeration", "after-publication-stage-enumeration", "before-publication-stage-validation",
  "after-lock-publication-rename-collision", "before-publication-stage-root-reenumeration",
  "before-publication-stage-final-validation", "before-publication-stage-final-liveness",
  "before-publication-stage-remove-attempt", "before-creator-stage-withdrawal-validation", "after-publication-stage-cleanup-root-sync",
  "after-lock-publication-provisional-predecessor-selection", "before-lock-publication-provisional-root-reenumeration",
  "before-lock-publication-provisional-predecessor-liveness", "before-staged-publication-settlement",
  "after-lock-publication-generation-closed", "before-lock-publication-predecessor-validation",
  "before-ledger-operation-callback",
  "after-owner-file-sync", "after-lock-directory-sync", "before-lock-retire", "after-lock-retire",
] as const);
export const ledgerFaultPoints = Object.freeze([...reservationFaultPoints, ...dispatchFaultPoints, ...resultFaultPoints, ...ingressFaultPoints, ...clockFaultPoints, ...ledgerLockFaultPoints]);
export type LedgerFaultPoint = (typeof ledgerFaultPoints)[number];

export interface FsAuthorityLedgerOptions {
  readonly now?: () => number;
  readonly faultInjector?: (point: LedgerFaultPoint) => void;
  readonly lockTimeoutMs?: number;
}
export const __testAdmissionClockOption: unique symbol = Symbol();
export const __testPrepHousekeeperRuntimeOption: unique symbol = Symbol();
interface PrepHousekeeperRuntime {
  readonly monotonicNow: () => number;
  readonly delay: (milliseconds: number) => Promise<void>;
  readonly observeBoundary?: (point: string) => void;
}
declare const prepAttemptTokenBrand: unique symbol;
declare const prepRetirementAuthorityBrand: unique symbol;
declare const prepRetiredCleanupAuthorityBrand: unique symbol;
type PrepCreatorAttemptToken=Readonly<{readonly [prepAttemptTokenBrand]:never}>;
type PrepRetirementAuthority=Readonly<{readonly [prepRetirementAuthorityBrand]:never}>;
type PrepRetiredCleanupAuthority=Readonly<{readonly [prepRetiredCleanupAuthorityBrand]:never}>;
type PrepHousekeepingRoute=
  |Readonly<{kind:"silent"}>
  |Readonly<{kind:"no-authority"}>
  |Readonly<{kind:"dead-prep";token:PrepCreatorAttemptToken;retirementAuthority:PrepRetirementAuthority}>
  |Readonly<{kind:"retired-prep";cleanupAuthority:PrepRetiredCleanupAuthority}>;
type PrepAuthorityDescriptor=
  |Readonly<{kind:"dead-prep";targetName:string;pid:number}>
  |Readonly<{kind:"prep-retired-cleanup";targetName:string;lifecycleName:string|null;orphan:boolean}>;
interface PrepAuthorityBinding {readonly snapshot:HybridRootSnapshot;readonly descriptor:PrepAuthorityDescriptor}
const prepAttemptRuntimeIdentity=Object.freeze({kind:"prep-housekeeper-runtime"});
const prepAttemptRuntimeBindings=new WeakMap<object,typeof prepAttemptRuntimeIdentity>();
const prepRetirementAuthorityBindings=new WeakMap<object,PrepAuthorityBinding>();
const prepRetiredCleanupAuthorityBindings=new WeakMap<object,PrepAuthorityBinding>();
type InternalFsAuthorityLedgerOptions = FsAuthorityLedgerOptions & {
  readonly [__testAdmissionClockOption]?: () => unknown;
  readonly [__testPrepHousekeeperRuntimeOption]?: PrepHousekeeperRuntime;
};

interface TransactionRecord {
  readonly v: "reelier.authority-ledger-transaction/v4";
  readonly intent: StoredReservationIntent;
}

interface IngressRecord {
  readonly v:"reelier.authority-ingress-claim/internal-v1";readonly tenant:string;readonly requester:string;readonly requestId:string;
  readonly definitionAlias:string;readonly requestDigest:string;readonly requestKey:string;readonly canonicalRequestBase64:string;
}

interface ClaimDescriptor {
  readonly kind: "ingress" | "outcome" | "capability" | "limit";
  readonly key: string;
  readonly index?: number;
}

interface ClaimRecord {
  readonly v: "reelier.authority-ledger-claim/v1";
  readonly descriptor: ClaimDescriptor;
  readonly transactionDigest: string;
}

interface ReserveEvent {
  readonly v: "reelier.authority-ledger-event/v1";
  readonly sequence: number;
  readonly previousDigest: string | null;
  readonly type: "reserve";
  readonly transactionDigest: string;
  readonly reservation: ReservationSnapshot;
}

interface TransitionJournalEvent {
  readonly v: "reelier.authority-ledger-event/v1";
  readonly sequence: number;
  readonly previousDigest: string | null;
  readonly type: "transition";
  readonly reservationId: string;
  readonly from: Exclude<LedgerState, "issued">;
  readonly to: Exclude<LedgerState, "issued" | "reserved">;
  readonly at: string;
  readonly resultDigest?: string;
}

interface ClockEvent {
  readonly v: "reelier.authority-ledger-event/v1";
  readonly sequence: number;
  readonly previousDigest: string | null;
  readonly type: "clock";
  readonly observedAt: string;
}

type JournalEvent = ReserveEvent | TransitionJournalEvent | ClockEvent;
type JournalBody =
  | Omit<ReserveEvent, "v" | "sequence" | "previousDigest">
  | Omit<TransitionJournalEvent, "v" | "sequence" | "previousDigest">
  | Omit<ClockEvent, "v" | "sequence" | "previousDigest">;

interface LedgerView {
  readonly events: readonly JournalEvent[];
  readonly eventDigests: readonly string[];
  readonly reservations: Map<string, ReservationSnapshot>;
  readonly committedTransactions: Set<string>;
  readonly highWaterMark: string | null;
}

interface LockOwner { readonly v: 1; readonly host: string; readonly pid: number; readonly nonce: string }
type RetirementDisposition = "released" | "recovery-pending" | "publication-aborted";
interface RetiredLock { readonly name: string; readonly directory: string; readonly disposition: RetirementDisposition; readonly owner: LockOwner; readonly ownerBytes: Buffer }
type FileIdentity=CoordinationFileIdentity;
type HybridEntryKind="directory"|"file"|"symlink"|"other";
interface HybridChildSnapshot { readonly name:string;readonly kind:HybridEntryKind;readonly identity:FileIdentity;readonly bytes?:Buffer }
interface HybridEntrySnapshot { readonly name:string;readonly kind:HybridEntryKind;readonly identity:FileIdentity;readonly bytes?:Buffer;readonly children?:readonly HybridChildSnapshot[] }
interface HybridRootSnapshot { readonly names:readonly string[];readonly entries:readonly HybridEntrySnapshot[] }
type HybridGuardDecision="continue-legacy"|"busy"|"corruption"|"retry"|"progress"|"reclassify";
type HybridSnapshotRelation="unchanged"|"monotonic-progress"|"membership-churn"|"corruption";
interface HybridOwnedArtifact { readonly parsed:ParsedK1Name;readonly entry:HybridEntrySnapshot;readonly owner:CoordinationOwner;readonly ownerBytes:Buffer;readonly ownerIdentity:FileIdentity;readonly state:PartialOwnerState }
interface HybridAckArtifact { readonly parsed:Extract<ParsedK1Name,{kind:"coordination-ack"|"coordination-stage"}>;readonly entry:HybridEntrySnapshot;readonly ack:CoordinationAck|null }
interface HybridLegacyCleanupArtifact { readonly kind:"ack"|"stage";readonly entry:HybridEntrySnapshot;readonly ack:CleanupAck }
interface PublicationStage {
  readonly name:string;
  readonly directory:string;
  readonly directoryIdentity:FileIdentity;
  readonly hostDigest:string;
  readonly ticket:bigint;
  readonly pid:number;
  readonly nonce:string;
  readonly state:"empty"|"zero"|"partial"|"complete";
  readonly ownerIdentity?:FileIdentity;
  readonly ownerBytes?:Buffer;
  readonly owner?:LockOwner;
}
interface PublicationSettlementState {
  readonly removalAuthorizations:Map<string,PublicationStage>;
  readonly removalDisappearances:Map<string,"sync-pending"|"synced">;
  rootSyncPending:boolean;
  generationInvalidated:boolean;
}
type PublicationRetry = "retry" | "integrity-replacement";
type PublicationCanonicalMembershipChurn = Readonly<{kind:"canonical-membership-churn";predecessor:PublicationStage|null}>;
interface PublicationElection {
  readonly predecessor:PublicationStage;
}
interface ProvisionalPublicationName { readonly name:string;readonly ticket:bigint;readonly pid:number;readonly pidText:string }
interface ProvisionalPublicationWait { readonly names:readonly string[];readonly predecessor:PublicationStage }
type ProvisionalPublicationObservation = Readonly<{kind:"wait";state:ProvisionalPublicationWait}> | Readonly<{kind:"fallback";selected:boolean;safeCanonicalMembershipChurn:boolean}>;
type ProvisionalEpochEligibility = "unearned" | "earned" | "revoked";
type MutatingAdmissionMemo = Readonly<{kind:"unseeded"}> | Readonly<{kind:"saturated";names:readonly string[]}> | Readonly<{kind:"disabled"}>;
type MutatingAdmissionObservation = Readonly<{kind:"saturated";names:readonly string[]}> | Readonly<{kind:"fallback"}>;
interface OwnedOwnerSnapshot {
  readonly directoryIdentity:FileIdentity;
  readonly ownerIdentity:FileIdentity;
  readonly ownerBytes:Buffer;
}
interface CleanupAck { readonly disposition: RetirementDisposition; readonly journalHead: string | null; readonly markerName: string; readonly owner: LockOwner; readonly ownerDigest: string; readonly v: "reelier.authority-ledger-lock-cleanup-ack/v1" }
type TombstoneResolution = Readonly<{ kind: "refused"; reason: ReserveReason }> | Readonly<{ kind: "existing"; reservationId: string }>;
type LockResult = { ok: true; owner: LockOwner; reclaimed: boolean } | { ok: false; reason: "busy" | "lock-owner-unverifiable" | "corruption" };

const SHA = /^sha256:[0-9a-f]{64}$/;
const ZERO_SHA = `sha256:${"0".repeat(64)}`;
const ID = /^[A-Za-z0-9._~-]{1,128}$/;
const FILE_HEX = /^[0-9a-f]{64}$/;
const INGRESS_FILE = /^([0-9a-f]{64})\.json$/;
const RETIRED_LOCK = /^\.authority-ledger-lock-([1-9][0-9]*)-([0-9a-f]{64})\.(released|recovery-pending|publication-aborted)$/;
const PUBLICATION_STAGE = /^\.authority-ledger-lock-publication-([0-9a-f]{64})-([0-9a-f]{16})-([1-9][0-9]*)-([0-9a-f]{64})\.tmp$/;
const MAX_PUBLICATION_TICKET = 0xffffffffffffffffn;
const MAX_ADMITTED_MUTATING_PUBLICATION_STAGES = 2;
const CLEANUP_ACK = /^\.authority-ledger-lock-cleanup-([0-9a-f]{64})\.ack$/;
const CLEANUP_STAGE = /^\.authority-ledger-lock-cleanup-stage-([1-9][0-9]*)-([0-9a-f]{64})-([0-9a-f]{64})\.tmp$/;
const JOURNAL_FILE = /^(\d{16})-([0-9a-f]{64})$/;
const LEGAL = new Set(["reserved>dispatched", "dispatched>acknowledged", "dispatched>definitive-failure", "dispatched>ambiguous", "acknowledged>reconciled", "ambiguous>reconciled"]);
const TOMBSTONE_REASONS = new Set<ReserveReason>(["idempotency-conflict", "semantic-duplicate", "capability-integrity", "capability-already-reserved", "limit-exceeded"]);

class LedgerCorruption extends Error {}
class CoordinationExhausted extends Error {
  constructor(readonly phase:"acquisition"|"housekeeping",readonly cause:"snapshot-churn"|"transient-sharing") { super(`${phase}:${cause}`); }
}
class RetiredLockTransient extends Error {}

export class AuthorityLedgerReadError extends Error {
  constructor(readonly code: "busy" | "lock-owner-unverifiable" | "corruption") {
    super(`authority ledger read refused: ${code}`);
  }
}

export class FsAuthorityLedger implements AuthorityLedger {
  readonly root: string;
  readonly options: Required<Pick<FsAuthorityLedgerOptions, "now" | "lockTimeoutMs">> & Pick<FsAuthorityLedgerOptions, "faultInjector">;
  private readonly admissionClock:()=>unknown;
  private readonly prepHousekeeperRuntime:PrepHousekeeperRuntime;
  private lockTail:Promise<void>=Promise.resolve();

  constructor(root: string, options: FsAuthorityLedgerOptions = {}) {
    const resolved = path.resolve(root);
    let rootStat;
    try { rootStat = lstatSync(resolved,{bigint:true}); } catch { throw new TypeError("authority ledger root must be an existing directory"); }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new TypeError("authority ledger root must be a real directory");
    for(let current=path.dirname(resolved);;current=path.dirname(current)){
      let ancestorStat;
      try{ancestorStat=lstatSync(current);}catch{throw new TypeError("authority ledger root may not traverse a symlink or reparse point");}
      if(ancestorStat.isSymbolicLink())throw new TypeError("authority ledger root may not traverse a symlink or reparse point");
      if(path.dirname(current)===current)break;
    }
    const real = realpathSync.native(resolved);
    if(process.platform==="win32"){
      let realStat;
      try{realStat=lstatSync(real,{bigint:true});}catch{throw new TypeError("authority ledger root may not traverse a symlink or reparse point");}
      if(realStat.dev!==rootStat.dev||realStat.ino!==rootStat.ino)throw new TypeError("authority ledger root may not traverse a symlink or reparse point");
    }else if(real!==resolved)throw new TypeError("authority ledger root may not traverse a symlink or reparse point");
    this.root = real;
    const internalOptions=options as InternalFsAuthorityLedgerOptions;
    this.options = { now: options.now ?? Date.now, faultInjector: options.faultInjector, lockTimeoutMs: options.lockTimeoutMs ?? 30_000 };
    this.admissionClock=internalOptions[__testAdmissionClockOption]??(()=>process.hrtime.bigint());
    this.prepHousekeeperRuntime=internalOptions[__testPrepHousekeeperRuntimeOption]??{monotonicNow,delay};
  }

  async observeClock(): Promise<ObserveClockResult> {
    return this.withLock("clock", async reclaimed => {
      const view=await this.prepare(reclaimed,false,"clock");
      let now:number,observedAt:string;try{now=this.options.now();if(!Number.isSafeInteger(now)||now<0)throw new TypeError("invalid clock");observedAt=new Date(now).toISOString();}catch{return frozen({ok:false as const,reason:"clock-unavailable" as const});}
      if(view.highWaterMark!==null){const high=parseIso(view.highWaterMark);if(now<high)return frozen({ok:false as const,reason:"clock-rollback" as const});if(now===high)return frozen({ok:true as const,status:"equal" as const,observedAt:view.highWaterMark});}
      await this.persistClock(view,now,"clock");
      return frozen({ok:true as const,status:"advanced" as const,observedAt});
    }) as Promise<ObserveClockResult>;
  }

  async bindIngress(request:AuthenticatedOutcomeRequest):Promise<BindIngressResult>{
    let attempted:IngressRecord;try{attempted=normalizeAuthenticatedIngress(request);}catch{return frozen({ok:false as const,reason:"integrity-failure" as const});}
    return this.withLock("ingress",async()=>{
      await this.ensureLayout();await this.assertNoLinks();
      await this.verifyIngressDirectory();
      const relative=path.join("ingress",`${attempted.requestKey.slice(7)}.json`);
      let existing:IngressRecord|undefined;try{existing=await this.readIngress(attempted.requestKey);}catch(error){if(!hasCode(error,"ENOENT"))throw error;}
      if(existing){const ingressClaimDigest=authorityDigest(existing);if(canonicalBytes(existing).equals(canonicalBytes(attempted)))return frozen({ok:true as const,status:"exact-existing" as const,evaluationEligible:false as const,ingressClaimDigest});return frozen({ok:false as const,reason:"conflict" as const,evaluationEligible:false as const,ingressClaimDigest});}
      await this.writeImmutable(relative,attempted,"ingress");
      const verified=await this.readIngress(attempted.requestKey);
      return frozen({ok:true as const,status:"claimed" as const,evaluationEligible:true as const,ingressClaimDigest:authorityDigest(verified)});
    }) as Promise<BindIngressResult>;
  }

  async lookupIngress(requestKey:string):Promise<RedactedIngressBinding|undefined>{
    if(!SHA.test(requestKey)||requestKey===ZERO_SHA)return undefined;
    const result=await this.withLock("ingress",async()=>{await this.ensureLayout();await this.assertNoLinks();let record:IngressRecord;try{record=await this.readIngress(requestKey);}catch(error){if(hasCode(error,"ENOENT"))return undefined;throw error;}return frozen({requestId:record.requestId,requestKey:record.requestKey,definitionAlias:record.definitionAlias,ingressClaimDigest:authorityDigest(record),bindingStatus:"bound" as const});});
    if(isLockFailure(result))throw new AuthorityLedgerReadError(result.reason);return result as RedactedIngressBinding|undefined;
  }

  async lookupIngressClaimLinkage(requestKey:string){
    if(!SHA.test(requestKey)||requestKey===ZERO_SHA)return undefined;
    const result=await this.withLock("ingress",async()=>{await this.ensureLayout();await this.assertNoLinks();let record:IngressRecord;try{record=await this.readIngress(requestKey);}catch(error){if(hasCode(error,"ENOENT"))return undefined;throw error;}return frozen({tenant:record.tenant,requester:record.requester,requestId:record.requestId,definitionAlias:record.definitionAlias,requestDigest:record.requestDigest,requestKey:record.requestKey,ingressClaimDigest:authorityDigest(record)});});
    if(isLockFailure(result))throw new AuthorityLedgerReadError(result.reason);return result as import("../ledger.js").VerifiedIngressClaimLinkage|undefined;
  }

  async reserve(input: ReservationIntent): Promise<ReserveResult> {
    let normalized: StoredReservationIntent;
    try { normalized = normalizeIntent(input); } catch { return frozen({ ok: false, reason: "integrity-failure" }); }
    return this.withLock("reservation", async reclaimed => {
      let view = await this.prepare(reclaimed, false, "reservation");
      try{await this.verifyIngressIntent(normalized);}catch{return frozen({ok:false as const,reason:"integrity-failure" as const});}
      const now = this.options.now();
      const clockReason = clockValidity(normalized, now, view.highWaterMark);
      if (clockReason) return frozen({ ok: false, reason: clockReason });
      view = await this.persistClock(view, now, "reservation");

      const transaction: TransactionRecord = frozen({ v: "reelier.authority-ledger-transaction/v4", intent: normalized });
      const transactionDigest = rawDigest(canonicalBytes(transaction));
      const transactionHex = transactionDigest.slice(7);
      const committed=view.reservations.get(transactionDigest);
      if(committed){if(!canonicalBytes(committed.intent).equals(canonicalBytes(normalized)))throw new LedgerCorruption("committed transaction intent mismatch");return frozen({ok:true,status:"existing",dispatchEligible:false,reservation:detachReservation(committed)});}
      await this.writeImmutable(path.join("transactions", transactionHex), transaction, "reservation");
      const tombstone = await this.readTombstone(transactionHex);
      view = await this.loadView();
      if (tombstone?.kind === "refused") return frozen({ ok: false, reason: tombstone.reason });
      if (tombstone?.kind === "existing") {
        const reservation = view.reservations.get(tombstone.reservationId);
        if (!reservation) throw new LedgerCorruption("duplicate resolution reservation missing");
        return frozen({ ok: true, status: "existing", dispatchEligible: false, reservation: detachReservation(reservation) });
      }
      const existingOwn = [...view.reservations.values()].find(value => value.reservationId === transactionDigest);
      if (existingOwn) return frozen({ ok: true, status: "existing", dispatchEligible: false, reservation: detachReservation(existingOwn) });
      const outcome = await this.commitTransaction(transactionDigest, transaction, view, "reservation");
      if (!outcome.ok) return outcome;
      return frozen({ ok: true, status: outcome.status, dispatchEligible: outcome.status === "reserved", reservation: detachReservation(outcome.reservation) });
    });
  }

  async transition(reservationId: string, expectedState: LedgerState, event: TransitionEvent): Promise<TransitionResult> {
    if (!SHA.test(reservationId) || !isTransitionEventInput(event)) return frozen({ ok: false, reason: "corruption" });
    const context: OperationContext = event.to === "dispatched" ? "dispatch" : "result";
    return this.withLock(context, async reclaimed => {
      let view = await this.prepare(reclaimed, false, context);
      const current = view.reservations.get(reservationId);
      if (!current) return frozen({ ok: false, reason: "not-found" });
      if (current.state !== expectedState) return frozen({ ok: false, reason: "state-conflict" });
      if (!LEGAL.has(`${expectedState}>${event.to}`)) return frozen({ ok: false, reason: "illegal-transition" });
      const now = this.options.now();
      if (now < parseIso(current.intent.issuedAt)) return frozen({ ok: false, reason: "not-yet-valid" });
      if (event.to === "dispatched" && now >= parseIso(current.intent.expiresAt)) return frozen({ ok: false, reason: "expired" });
      if (view.highWaterMark !== null && now < parseIso(view.highWaterMark)) return frozen({ ok: false, reason: "clock-rollback" });
      view = await this.persistClock(view, now, context);
      const at = new Date(now).toISOString();
      const resultDigest = "resultDigest" in event ? event.resultDigest : undefined;
      this.fault(`${context}-before-journal-transition` as LedgerFaultPoint);
      const transition = await this.appendEvent(view, {
        type: "transition", reservationId, from: current.state, to: event.to, at,
        ...(resultDigest === undefined ? {} : { resultDigest }),
      }, context) as TransitionJournalEvent;
      this.fault(`${context}-after-journal-transition` as LedgerFaultPoint);
      const next = applyTransition(current, transition);
      return frozen({ ok: true, status: "transitioned", reservation: detachReservation(next) });
    });
  }

  async recover(): Promise<RecoverResult> {
    return this.withLock("reservation", async () => {
      try {
        const view = await this.prepare(false, true, "reservation");
        return frozen({
          ok: true,
          reservations: Object.freeze([...view.reservations.values()].sort((a, b) => a.reservationId.localeCompare(b.reservationId)).map(detachReservation)),
          highWaterMark: view.highWaterMark,
          topology: frozen({ directorySync: process.platform === "win32" ? "best-effort" : "verified" }),
        });
      } catch (error) {
        if (error instanceof LedgerCorruption) return frozen({ ok: false as const, reason: "corruption" as const });
        throw error;
      }
    },{admitContender:false,permitPrepHousekeepingWrite:true});
  }

  async getReservation(reservationId: string): Promise<ReservationSnapshot | undefined> {
    const result = await this.withLock("reservation", async reclaimed => {
      const view = await this.prepare(reclaimed, false, "reservation");
      const value = view.reservations.get(reservationId);
      return value ? detachReservation(value) : undefined;
    });
    if (isLockFailure(result)) throw new AuthorityLedgerReadError(result.reason);
    return result as ReservationSnapshot | undefined;
  }

  async lookupReservationLinkage(reservationId:string) {
    const reservation=await this.getReservation(reservationId);if(!reservation)return undefined;
    return frozen({reservationId:reservation.reservationId,state:reservation.state,ingressClaimDigest:reservation.intent.ingressClaimDigest,capabilityId:reservation.intent.capabilityId,capabilityDigest:reservation.intent.capabilityDigest,authorityStateDigest:reservation.intent.authorityStateDigest,decisionContextDigest:reservation.intent.decisionContextDigest,updatedAt:reservation.updatedAt,...(reservation.resultDigest?{receiptRef:reservation.resultDigest}:{})});
  }

  async getReservationHistory(reservationId: string): Promise<ReservationHistory | undefined> {
    const result = await this.withLock("reservation", async reclaimed => {
      const view = await this.prepare(reclaimed, false, "reservation");
      const reservation = view.reservations.get(reservationId);
      if (!reservation) return undefined;
      const entries: ReservationHistoryEntry[] = [];
      for (let index = 0; index < view.events.length; index++) {
        const event = view.events[index];
        if (event.type === "reserve" && event.reservation.reservationId === reservationId) entries.push({
          sequence: event.sequence, from: "issued", to: "reserved", at: event.reservation.updatedAt, eventDigest: view.eventDigests[index],
        });
        if (event.type === "transition" && event.reservationId === reservationId) entries.push({
          sequence: event.sequence, from: event.from, to: event.to, at: event.at, eventDigest: view.eventDigests[index],
          ...(event.resultDigest === undefined ? {} : { resultDigest: event.resultDigest }),
        });
      }
      return frozen({ reservation: detachReservation(reservation), entries: Object.freeze(entries.map(entry => frozen(entry))) });
    });
    if (isLockFailure(result)) throw new AuthorityLedgerReadError(result.reason);
    return result as ReservationHistory | undefined;
  }

  async getHighWaterMark(): Promise<Readonly<{ observedAt: string | null }>> {
    const result = await this.withLock("reservation", async reclaimed => frozen({ observedAt: (await this.prepare(reclaimed, false, "reservation")).highWaterMark }));
    if (isLockFailure(result)) throw new AuthorityLedgerReadError(result.reason);
    return result as Readonly<{ observedAt: string | null }>;
  }

  private async withLock<T>(context: OperationContext, operation: (reclaimed: boolean) => Promise<T>,coordination:Readonly<{admitContender?:boolean;permitPrepHousekeepingWrite?:boolean}>={}): Promise<T | Readonly<{ ok: false; reason: "busy" | "lock-owner-unverifiable" | "corruption" }>> {
    const preceding=this.lockTail;let release!:()=>void;this.lockTail=new Promise<void>(resolve=>{release=resolve;});await preceding;
    try {
      const lock = await this.acquireLock({admitContender:coordination.admitContender??true,permitPrepHousekeepingWrite:coordination.permitPrepHousekeepingWrite??false});
      if (!lock.ok) return frozen({ ok: false, reason: lock.reason });
      try {
        await this.assertNoLinks();
        await this.ensureLayout();
        const housekeepingDeadline=monotonicNow()+this.options.lockTimeoutMs;
        await this.settlePublicationStages(housekeepingDeadline,true);
        const pending=await this.serviceRetirementArtifacts(housekeepingDeadline);
        if(pending.length>0){const recovered=await this.prepare(true,false,context);const journalHead=recovered.eventDigests.at(-1)??null;for(const marker of pending)await this.acknowledgeAndCleanup(marker,journalHead,housekeepingDeadline);}
        await this.assertNoLinks();
        if (context === "reservation") this.fault("after-lock-acquire");
        this.fault("before-ledger-operation-callback");
        return await operation(false);
      } catch (error) {
        if(error instanceof CoordinationExhausted)return frozen({ok:false,reason:"busy"});
        if (error instanceof LedgerCorruption) return frozen({ ok: false, reason: "corruption" });
        throw error;
      } finally {
        await this.releaseLock(lock.owner);
      }
    } finally { release(); }
  }

  private async acquireLock(coordination:Readonly<{admitContender:boolean;permitPrepHousekeepingWrite:boolean}>): Promise<LockResult> {
    const {admitContender}=coordination;let prepHousekeepingWritePermitted=coordination.permitPrepHousekeepingWrite;
    const monotonicNow=this.prepHousekeeperRuntime.monotonicNow,delay=this.prepHousekeeperRuntime.delay;
    const deadline = monotonicNow() + this.options.lockTimeoutMs;
    const prepAttemptToken=mintUnboundPrepCreatorAttemptToken();
    const owner: LockOwner = { v: 1, host: hostname(), pid: process.pid, nonce: randomBytes(32).toString("hex") };
    const ownerBytes=canonicalBytes(owner);let stageName="",stagePath="",ownerPath="",stageTicket:bigint|null=null;
    let stageCreated=false,published=false,expectedStage:PublicationStage|null=null,election:PublicationElection|null=null,provisionalWait:ProvisionalPublicationWait|null=null,stagedSettlementStarted=false,provisionalEpochEligibility:ProvisionalEpochEligibility="unearned",waitedOnActiveLock=false,fullReelectionPending=false,provisionalFallbackResetPending=false;
    let mutatingAdmissionMemo:MutatingAdmissionMemo=admitContender?{kind:"unseeded"}:{kind:"disabled"};
    let retryDelayMs=5;
    const backoff=async()=>{const remaining=deadline-monotonicNow();if(remaining<=0)return;await delay(Math.min(retryDelayMs,remaining));retryDelayMs=Math.min(50,retryDelayMs*2);};
    const attempt=async():Promise<LockResult>=>{while (true) {
      try {
        const hybridGuard=await this.classifyHybridCoordinationEpoch(prepAttemptToken,prepHousekeepingWritePermitted);
        if(hybridGuard==="retry"){
          if(monotonicNow()>=deadline)return {ok:false,reason:"busy"};
          await backoff();continue;
        }
        if(hybridGuard==="progress"||hybridGuard==="reclassify"){retryDelayMs=5;if(monotonicNow()>=deadline)prepHousekeepingWritePermitted=false;continue;}
        if(hybridGuard==="busy")return {ok:false,reason:"busy"};
        if(hybridGuard==="corruption")return {ok:false,reason:"corruption"};
        const active=await this.inspectActiveLock(deadline);
        if(active==="retry"){
          if(monotonicNow()>=deadline)throw new CoordinationExhausted("acquisition","snapshot-churn");
          await backoff();continue;
        }
        if(active!=="absent"){
          if(active!=="wait")return active;
          waitedOnActiveLock=true;
          if(monotonicNow()>=deadline)return {ok:false,reason:"busy"};
          await backoff();continue;
        }
        if(waitedOnActiveLock){waitedOnActiveLock=false;if(!fullReelectionPending)retryDelayMs=5;}
        if(stageCreated&&monotonicNow()>=deadline)return {ok:false,reason:"busy"};
        if(!stageCreated){
          if(admitContender&&mutatingAdmissionMemo.kind!=="disabled"){
            const observation=await this.observeMutatingAdmissionSaturation(mutatingAdmissionMemo);
            if(observation.kind==="saturated"){
              mutatingAdmissionMemo={kind:"saturated",names:observation.names};
              if(monotonicNow()>=deadline)return {ok:false,reason:"busy"};
              await backoff();continue;
            }
            mutatingAdmissionMemo={kind:"disabled"};
          }
          const existingStages=await this.settlePublicationStages(deadline,false,null,admitContender);
          if(existingStages.length>0&&!admitContender){
            if(monotonicNow()>=deadline)return {ok:false,reason:"busy"};
            await backoff();continue;
          }
          if(existingStages.filter(stage=>stage.pid===process.pid&&stage.state==="complete").length===1)return {ok:false,reason:"busy"};
          if(stageName===""){
            const maxVisible=existingStages.reduce((maximum,stage)=>stage.ticket>maximum?stage.ticket:maximum,0n);
            if(maxVisible===MAX_PUBLICATION_TICKET)return {ok:false,reason:"busy"};
            let raw:unknown;try{raw=this.admissionClock();}catch{return {ok:false,reason:"corruption"};}
            if(typeof raw!=="bigint"||raw<0n||raw>MAX_PUBLICATION_TICKET)return {ok:false,reason:"corruption"};
            const ticket=raw>maxVisible?raw:maxVisible+1n;
            stageTicket=ticket;stageName=this.publicationStageName(owner,ticket);stagePath=this.absolute(stageName);ownerPath=path.join(stagePath,"owner.json");
          }
          mutatingAdmissionMemo={kind:"disabled"};
          try{
            await mkdir(stagePath);
            if(stageTicket===null)throw new LedgerCorruption("creator publication ticket absent");
            const directoryStat=await lstat(stagePath,{bigint:true});
            if(directoryStat.isSymbolicLink()||!directoryStat.isDirectory()||(await readdir(stagePath,{withFileTypes:true})).length!==0)throw new LedgerCorruption("invalid new creator publication stage");
            expectedStage={name:stageName,directory:stagePath,directoryIdentity:fileIdentity(directoryStat),hostDigest:this.hostDigest(owner.host),ticket:stageTicket,pid:owner.pid,nonce:owner.nonce,state:"empty"};stageCreated=true;
            const validatedStage=await this.validatePublicationStage(stageName);if(!samePublicationStage(expectedStage,validatedStage))throw new LedgerCorruption("creator publication stage changed after creation");
            this.fault("after-lock-publication-stage-create");
          }
          catch(error){if(hasCode(error,"EEXIST")){continue;}throw error;}
          let handle:FileHandle|undefined;
          try{
            handle=await open(ownerPath,"wx",0o600);expectedStage=await this.validatePublicationStage(stageName);this.fault("after-lock-publication-owner-create");
            await this.writeAll(handle,ownerBytes.subarray(0,1),0);expectedStage=await this.validatePublicationStage(stageName);this.fault("after-lock-publication-owner-partial-write");
            await this.writeAll(handle,ownerBytes.subarray(1),1);await handle.sync();expectedStage=await this.validatePublicationStage(stageName);this.fault("after-lock-publication-owner-sync");this.fault("after-owner-file-sync");
            await this.assertPublicationStageUnchanged(expectedStage);
          }finally{if(handle)await handle.close();}
          await this.syncDirectory(stagePath);this.fault("after-lock-publication-stage-sync");this.fault("after-lock-directory-sync");
          expectedStage=await this.assertPublicationStageUnchanged(expectedStage);
          retryDelayMs=5;
        }
        if(election!==null){
          const predecessorState=await this.pollPublicationPredecessor(election.predecessor);
          if(predecessorState==="live"){
            if(monotonicNow()>=deadline)return {ok:false,reason:"busy"};
            await backoff();continue;
          }
          election=null;retryDelayMs=5;
        }
        if(!stagedSettlementStarted){
          if(expectedStage===null)throw new LedgerCorruption("creator publication snapshot absent");
          const hadProvisionalWait=provisionalWait!==null;
          const provisional=await this.inspectProvisionalPublicationWait(expectedStage,provisionalWait);
          if(provisional.kind==="wait"){
            provisionalWait=provisional.state;
            if(monotonicNow()>=deadline)return {ok:false,reason:"busy"};
            await backoff();continue;
          }
          if(hadProvisionalWait&&provisional.safeCanonicalMembershipChurn&&provisionalEpochEligibility!=="revoked")provisionalEpochEligibility="earned";
          else provisionalEpochEligibility="revoked";
          if(hadProvisionalWait)provisionalFallbackResetPending=true;
          provisionalWait=null;
          this.fault("before-staged-publication-settlement");
          stagedSettlementStarted=true;
        }
        const settlement=provisionalEpochEligibility==="earned"
          ?await this.settlePublicationStages(deadline,false,expectedStage,false,true)
          :await this.settlePublicationStages(deadline,false,expectedStage);
        if(!Array.isArray(settlement)){
          if(expectedStage===null)throw new LedgerCorruption("creator publication snapshot absent");
          const fresh=await this.inspectProvisionalPublicationWait(expectedStage,null,settlement.predecessor);
          if(fresh.kind==="wait"){
            provisionalWait=fresh.state;
            stagedSettlementStarted=false;
            if(monotonicNow()>=deadline)return {ok:false,reason:"busy"};
            await backoff();
            continue;
          }
          provisionalEpochEligibility="revoked";
          if(fresh.selected)this.fault("before-staged-publication-settlement");
          continue;
        }
        provisionalEpochEligibility="revoked";
        const generation=[...settlement].sort(comparePublicationOrder);
        if(provisionalFallbackResetPending){provisionalFallbackResetPending=false;retryDelayMs=5;}
        if(fullReelectionPending){fullReelectionPending=false;retryDelayMs=5;}
        const ownIndex=generation.findIndex(stage=>stage.name===stageName);
        if(ownIndex<0)throw new LedgerCorruption("creator publication stage disappeared");
        if(expectedStage===null||!samePublicationStage(expectedStage,generation[ownIndex]))throw new LedgerCorruption("creator publication stage changed after full settlement");
        if(ownIndex>0){election={predecessor:generation[ownIndex-1]};retryDelayMs=5;continue;}
        const finalNames=await this.publicationStageNames();
        if(!sameStrings(generation.map(stage=>stage.name),finalNames)){election=null;fullReelectionPending=true;continue;}
        if(expectedStage===null)throw new LedgerCorruption("creator publication snapshot absent");
        const finalOwnStage=await this.validatePublicationStage(stageName);
        if(!samePublicationStage(expectedStage,finalOwnStage))throw new LedgerCorruption("creator publication stage changed before rename");
        try{await rename(stagePath,this.absolute("lock"));published=true;stageCreated=false;}
        catch(error){if(hasCode(error,"EEXIST")||hasCode(error,"ENOTEMPTY")||isTransientLockError(error)){this.fault("after-lock-publication-rename-collision");election=null;if(monotonicNow()>=deadline)return {ok:false,reason:"busy"};await backoff();continue;}throw error;}
        if(expectedStage===null||expectedStage.ownerIdentity===undefined||expectedStage.ownerBytes===undefined)throw new LedgerCorruption("published owner snapshot absent");
        const publishedSnapshot:OwnedOwnerSnapshot={directoryIdentity:expectedStage.directoryIdentity,ownerIdentity:expectedStage.ownerIdentity,ownerBytes:expectedStage.ownerBytes};
        this.fault("after-lock-publication-rename");
        this.assertPublishedSnapshotUnchanged(publishedSnapshot,await this.validatePublishedOwner(owner));
        await this.syncDirectory(this.root);
        this.fault("after-lock-publication-root-sync");
        this.assertPublishedSnapshotUnchanged(publishedSnapshot,await this.validatePublishedOwner(owner));
        return { ok: true, owner, reclaimed:false };
      } catch (error) {
        if(error instanceof CoordinationExhausted)return {ok:false,reason:"busy"};
        if(error instanceof LedgerCorruption||stageCreated&&hasCode(error,"ENOENT"))return {ok:false,reason:"corruption"};
        throw error;
      }
    }};
    try{
      const result=await attempt();
      return stageCreated?await this.finishCreatorPublicationStage(stageName,expectedStage,result):result;
    }catch(error){
      if(stageCreated)await this.finishCreatorPublicationStage(stageName,expectedStage,{ok:false,reason:"corruption"});
      if(published)try{await this.retireOwnedLock(owner,"publication-aborted",deadline,false);}catch{}
      throw error;
    }
  }

  private publicationStageName(owner:LockOwner,ticket:bigint):string{return buildPublicationName(owner,ticket);}
  private hostDigest(host:string):string{return coordinationHostDigest(host);}

  private async inspectProvisionalPublicationWait(expectedOwn:PublicationStage,previous:ProvisionalPublicationWait|null,expectedPredecessor:PublicationStage|null=null):Promise<ProvisionalPublicationObservation>{
    let names:string[];
    try{names=await this.rawPublicationStageNames();}
    catch(error){if(hasCode(error,"ENOENT")||isSnapshotSharingError(error))return {kind:"fallback",selected:false,safeCanonicalMembershipChurn:false};throw error;}
    const ordered=this.parseProvisionalPublicationNames(names,expectedOwn.name);
    if(ordered===null||(previous!==null&&!sameStrings(previous.names,names)))return {kind:"fallback",selected:false,safeCanonicalMembershipChurn:false};
    const ownIndex=ordered.findIndex(item=>item.name===expectedOwn.name);
    if(ownIndex<=0)return {kind:"fallback",selected:false,safeCanonicalMembershipChurn:false};
    const selected=ordered[ownIndex-1];
    let selectedDirectoryIdentity:FileIdentity;
    try{const info=await lstat(this.absolute(selected.name),{bigint:true});if(info.isSymbolicLink()||!info.isDirectory())return {kind:"fallback",selected:false,safeCanonicalMembershipChurn:false};selectedDirectoryIdentity=fileIdentity(info);}
    catch(error){if(hasCode(error,"ENOENT")||isSnapshotSharingError(error))return {kind:"fallback",selected:false,safeCanonicalMembershipChurn:false};throw error;}
    this.fault("after-lock-publication-provisional-predecessor-selection");
    let own:PublicationStage,predecessor:PublicationStage;
    try{
      own=await this.validatePublicationStage(expectedOwn.name);
      predecessor=await this.validatePublicationStage(selected.name);
    }catch(error){if(error instanceof LedgerCorruption||hasCode(error,"ENOENT")||isSnapshotSharingError(error))return {kind:"fallback",selected:true,safeCanonicalMembershipChurn:false};throw error;}
    if(!samePublicationStage(expectedOwn,own)||!sameFileIdentity(selectedDirectoryIdentity,predecessor.directoryIdentity)||previous!==null&&!samePublicationStage(previous.predecessor,predecessor)||expectedPredecessor!==null&&!samePublicationStage(expectedPredecessor,predecessor))return {kind:"fallback",selected:true,safeCanonicalMembershipChurn:false};
    this.fault("before-lock-publication-provisional-root-reenumeration");
    let closedNames:string[];
    try{closedNames=await this.rawPublicationStageNames();}
    catch(error){if(hasCode(error,"ENOENT")||isSnapshotSharingError(error))return {kind:"fallback",selected:true,safeCanonicalMembershipChurn:false};throw error;}
    const closedOrdered=this.parseProvisionalPublicationNames(closedNames,expectedOwn.name);
    if(closedOrdered===null)return {kind:"fallback",selected:true,safeCanonicalMembershipChurn:false};
    if(!sameStrings(names,closedNames))return {kind:"fallback",selected:true,safeCanonicalMembershipChurn:previous!==null};
    this.fault("before-lock-publication-provisional-predecessor-liveness");
    if(processLiveness(predecessor.pid)!=="alive")return {kind:"fallback",selected:true,safeCanonicalMembershipChurn:false};
    return {kind:"wait",state:{names:Object.freeze([...names]),predecessor}};
  }

  private parseProvisionalPublicationNames(names:readonly string[],ownName:string):ProvisionalPublicationName[]|null{
    const localHostDigest=this.hostDigest(hostname()),identities=new Set<string>(),parsed:ProvisionalPublicationName[]=[];
    for(const name of names){
      const match=PUBLICATION_STAGE.exec(name);
      if(!match)return null;
      const ticket=BigInt(`0x${match[2]}`),pid=Number(match[3]),pidText=match[3];
      if(ticket===0n||!Number.isSafeInteger(pid)||pid<=0||match[1]!==localHostDigest)return null;
      const identity=`${match[1]}:${pidText}`;
      if(identities.has(identity))return null;
      identities.add(identity);
      parsed.push({name,ticket,pid,pidText});
    }
    if(!parsed.some(item=>item.name===ownName))return null;
    return parsed.sort(compareProvisionalPublicationOrder);
  }

  private async observeMutatingAdmissionSaturation(memo:Exclude<MutatingAdmissionMemo,Readonly<{kind:"disabled"}>>):Promise<MutatingAdmissionObservation>{
    let names:string[];
    try{names=(await readdir(this.root)).filter(name=>name.startsWith(".authority-ledger-lock-publication-")).sort();}
    catch(error){if(hasCode(error,"ENOENT")||isSnapshotSharingError(error))return {kind:"fallback"};throw error;}
    this.fault("after-mutating-admission-enumeration");
    if(memo.kind==="saturated")return sameStrings(memo.names,names)?{kind:"saturated",names:memo.names}:{kind:"fallback"};
    if(names.length<MAX_ADMITTED_MUTATING_PUBLICATION_STAGES)return {kind:"fallback"};
    const localHostDigest=this.hostDigest(hostname()),identities=new Set<string>(),pids:number[]=[];
    for(const name of names){
      const match=PUBLICATION_STAGE.exec(name);
      if(!match)return {kind:"fallback"};
      const ticket=BigInt(`0x${match[2]}`),pid=Number(match[3]);
      if(ticket===0n||!Number.isSafeInteger(pid)||pid<=0||match[1]!==localHostDigest)return {kind:"fallback"};
      const identity=`${match[1]}:${match[3]}`;
      if(identities.has(identity))return {kind:"fallback"};
      identities.add(identity);
      pids.push(pid);
    }
    const liveness=pids.map(pid=>processLiveness(pid));
    return liveness.every(value=>value==="alive")?{kind:"saturated",names:Object.freeze([...names])}:{kind:"fallback"};
  }

  private async classifyHybridCoordinationEpoch(prepAttemptToken:PrepCreatorAttemptToken,permitPrepHousekeepingWrite:boolean):Promise<HybridGuardDecision>{
    let names:string[];
    try{names=(await readdir(this.root)).sort();}catch(error){if(hasCode(error,"ENOENT")||isSnapshotSharingError(error))return "retry";throw error;}
    if(!names.some(isK1ReservedName))return "continue-legacy";
    this.fault("after-pre-admission-housekeeping-initial-enumeration");
    let initial:HybridRootSnapshot;
    try{initial=await this.readHybridRootSnapshot(names);}catch(error){if(hasCode(error,"ENOENT")||isSnapshotSharingError(error))return "retry";if(error instanceof LedgerCorruption)return "corruption";throw error;}
    this.fault("after-coordination-cleanup-marker-enumeration");
    this.fault("after-admission-prep-enumeration");
    this.fault("after-admission-slot-enumeration");
    let closedNames:string[];
    try{closedNames=(await readdir(this.root)).sort();}catch(error){if(hasCode(error,"ENOENT")||isSnapshotSharingError(error))return "retry";throw error;}
    if(!sameStrings(names,closedNames))return "retry";
    this.fault("after-pre-admission-housekeeping-generation-closed");
    this.fault("before-pre-admission-housekeeping-final-validation");
    let finalNames:string[],finalSnapshot:HybridRootSnapshot,finalClosedNames:string[],finalClosedSnapshot:HybridRootSnapshot;
    try{
      finalNames=(await readdir(this.root)).sort();
      finalSnapshot=await this.readHybridRootSnapshot(finalNames);
      finalClosedNames=(await readdir(this.root)).sort();
      if(!sameStrings(finalNames,finalClosedNames)){
        const changedSnapshot=await this.readHybridRootSnapshot(finalClosedNames),changedClosedNames=(await readdir(this.root)).sort();
        if(sameStrings(finalClosedNames,changedClosedNames))try{if(this.classifyClosedHybridGraph(changedSnapshot)==="corruption")return "corruption";}catch(error){if(error instanceof LedgerCorruption)return "corruption";throw error;}
        return "retry";
      }
      finalClosedSnapshot=await this.readHybridRootSnapshot(finalClosedNames);
    }catch(error){if(hasCode(error,"ENOENT")||isSnapshotSharingError(error))return "retry";if(error instanceof LedgerCorruption)return "corruption";throw error;}
    let decision:HybridGuardDecision;try{decision=this.classifyClosedHybridGraph(finalClosedSnapshot);}catch(error){if(error instanceof LedgerCorruption)return "corruption";throw error;}
    const closedRelation=this.compareHybridRootSnapshots(finalSnapshot,finalClosedSnapshot);
    if(closedRelation==="corruption"||decision==="corruption")return "corruption";
    if(closedRelation!=="unchanged")return "retry";
    const epochRelation=this.compareHybridRootSnapshots(initial,finalClosedSnapshot);
    if(epochRelation==="corruption")return "corruption";
    if(epochRelation!=="unchanged")return "retry";
    const transition=await this.observeStablePrepHousekeepingRoute(deriveStablePrepHousekeepingRoute(finalClosedSnapshot,decision,prepAttemptToken),permitPrepHousekeepingWrite);
    return transition==="progress"||transition==="reclassify"?transition:decision;
  }

  private async observeStablePrepHousekeepingRoute(route:PrepHousekeepingRoute,permitWrite:boolean):Promise<"busy"|"progress"|"reclassify">{
    if(route.kind==="no-authority"){this.prepHousekeeperRuntime.observeBoundary?.("prep-only-no-authority");return "busy";}
    if(route.kind==="dead-prep"){
      this.prepHousekeeperRuntime.observeBoundary?.("prep-only-creator-token-carried");
      this.prepHousekeeperRuntime.observeBoundary?.("prep-only-prep-retirement-authority-dead-owner");
      return this.transitionPrepHousekeeping(route.retirementAuthority,permitWrite);
    }
    if(route.kind==="retired-prep"){
      this.prepHousekeeperRuntime.observeBoundary?.("prep-only-prep-retired-cleanup-authority");
      return this.transitionPrepHousekeeping(route.cleanupAuthority,permitWrite);
    }
    return "busy";
  }

  private async transitionPrepHousekeeping(authority:PrepRetirementAuthority|PrepRetiredCleanupAuthority,permitWrite:boolean):Promise<"busy"|"progress"|"reclassify">{
    const retirement=prepRetirementAuthorityBindings.get(authority),cleanup=prepRetiredCleanupAuthorityBindings.get(authority),binding=retirement??cleanup;
    prepRetirementAuthorityBindings.delete(authority);prepRetiredCleanupAuthorityBindings.delete(authority);
    if(binding===undefined)return "busy";
    const first=await this.revalidatePrepHousekeepingAuthority(binding);
    this.prepHousekeeperRuntime.observeBoundary?.("prep-only-before-transition");
    const second=await this.revalidatePrepHousekeepingAuthority(binding);
    if(first==="corruption"||second==="corruption"){this.prepHousekeeperRuntime.observeBoundary?.("prep-only-transition-refused");throw new LedgerCorruption("prep housekeeping authority changed before transition");}
    if(first!=="exact"||second!=="exact"){this.prepHousekeeperRuntime.observeBoundary?.("prep-only-transition-refused");return "busy";}
    if(!permitWrite){this.prepHousekeeperRuntime.observeBoundary?.("prep-only-transition-refused");return "busy";}
    this.prepHousekeeperRuntime.observeBoundary?.("prep-only-after-final-revalidation");
    const result=binding.descriptor.kind==="dead-prep"?await this.retireBoundPrep(binding):await this.advanceBoundPrepCleanup(binding);
    if(result==="busy")this.prepHousekeeperRuntime.observeBoundary?.("prep-only-transition-refused");
    return result;
  }

  private boundPrepArtifact(binding:PrepAuthorityBinding,retired:boolean):HybridOwnedArtifact{
    const entry=binding.snapshot.entries.find(value=>value.name===binding.descriptor.targetName),parsed=parseK1Name(binding.descriptor.targetName);
    if(entry===undefined||parsed===null)throw new LedgerCorruption("prep housekeeping binding lost its exact target");
    if(retired&&parsed.kind!=="admission-prep-retired"||!retired&&parsed.kind!=="admission-prep")throw new LedgerCorruption("prep housekeeping binding target kind changed");
    if(parsed.kind!=="admission-prep"&&parsed.kind!=="admission-prep-retired")throw new LedgerCorruption("invalid prep housekeeping target");
    const owner:CoordinationOwner={host:hostname(),nonce:parsed.nonce,pid:parsed.pid,v:1};
    if(parsed.kind==="admission-prep-retired"){
      const partial=this.classifyHybridAuthenticatedPartialPrepMarker(parsed,entry,binding.snapshot);if(partial!==null)return partial;
    }
    return this.classifyHybridNamedOwnerDirectory(parsed,entry,owner,parsed.kind==="admission-prep-retired"?parsed.state:null);
  }

  private async retireBoundPrep(binding:PrepAuthorityBinding):Promise<"progress"|"reclassify">{
    const artifact=this.boundPrepArtifact(binding,false),parsed=artifact.parsed;if(parsed.kind!=="admission-prep")throw new LedgerCorruption("invalid prep retirement binding");
    const destinationName=`.authority-ledger-admission-prep-retired-${parsed.hostDigest}-${parsed.pid}-${parsed.nonce}.${artifact.state}`,source=this.absolute(parsed.name),destination=this.absolute(destinationName);
    try{await lstat(destination);return "reclassify";}catch(error){if(isSnapshotSharingError(error))return "reclassify";if(!hasCode(error,"ENOENT"))throw error;}
    try{await rename(source,destination);}catch(error){if(hasCode(error,"EEXIST")||hasCode(error,"ENOTEMPTY")||hasCode(error,"ENOENT")||isSnapshotSharingError(error))return "reclassify";throw error;}
    const moved=await lstat(destination,{bigint:true});if(!sameFileIdentity(artifact.entry.identity,fileIdentity(moved)))throw new LedgerCorruption("prep retirement changed directory identity");
    await this.syncDirectory(this.root);
    this.prepHousekeeperRuntime.observeBoundary?.("prep-only-prep-retirement-root-synced");
    return "progress";
  }

  private boundPrepCleanup(binding:PrepAuthorityBinding):Readonly<{ack:CoordinationAck;bytes:Buffer;stageName:string;artifact:HybridOwnedArtifact}>{
    const artifact=this.boundPrepArtifact(binding,true),parsed=artifact.parsed;if(parsed.kind!=="admission-prep-retired")throw new LedgerCorruption("invalid prep cleanup binding");
    const ack:CoordinationAck={directoryIdentity:encodeCoordinationIdentityWire(artifact.entry.identity),kind:"admission-prep-retired",markerName:parsed.name,originalName:`.authority-ledger-admission-prep-${parsed.hostDigest}-${parsed.pid}-${parsed.nonce}.tmp`,owner:artifact.owner,ownerBytesDigest:coordinationRawDigest(artifact.ownerBytes),ownerBytesLength:String(artifact.ownerBytes.length),ownerDigest:coordinationCanonicalDigest(artifact.owner),ownerIdentity:parsed.state==="empty"?null:encodeCoordinationIdentityWire(artifact.ownerIdentity),purpose:"prep-retired",recoveryAuthority:"dead-owner-or-exact-creator",state:parsed.state,v:COORDINATION_ACK_VERSION};
    const bytes=coordinationCanonicalBytes(ack),stageName=`.authority-ledger-coordination-cleanup-stage-p-${coordinationRawDigest(bytes).slice(7)}.tmp`;
    return {ack,bytes,stageName,artifact};
  }

  private async advanceBoundPrepCleanup(binding:PrepAuthorityBinding):Promise<"busy"|"progress"|"reclassify">{
    if(binding.descriptor.kind!=="prep-retired-cleanup")return "busy";
    const lifecycle=binding.descriptor.lifecycleName;
    if(binding.descriptor.orphan){
      if(lifecycle===null)return "busy";
      const parsed=parseK1Name(lifecycle),entry=binding.snapshot.entries.find(value=>value.name===lifecycle);if(parsed?.kind!=="coordination-ack"||entry?.kind!=="file"||entry.bytes===undefined||entry.identity.nlink!==1n)return "busy";
      let ack:CoordinationAck;try{ack=parseCoordinationAckBytes(entry.bytes);}catch{throw new LedgerCorruption("invalid orphan prep cleanup acknowledgment");}
      if(ack.purpose!=="prep-retired"||coordinationRawDigest(entry.bytes).slice(7)!==parsed.digest||ack.markerName!==binding.descriptor.targetName)return "busy";
      const originalName=String(ack.originalName);if(await this.prepCleanupNameExists(binding.descriptor.targetName)||await this.prepCleanupNameExists(originalName))return "reclassify";
      if(!await this.revalidatePrepCleanupFile(lifecycle,entry,entry.bytes))return "reclassify";
      try{await unlink(this.absolute(lifecycle));}catch(error){if(hasCode(error,"ENOENT")||hasCode(error,"EEXIST")||hasCode(error,"ENOTEMPTY")||isSnapshotSharingError(error))return "reclassify";throw error;}
      await this.syncDirectory(this.root);
      this.prepHousekeeperRuntime.observeBoundary?.("prep-only-cleanup-final-root-synced");
      return "progress";
    }
    const cleanup=this.boundPrepCleanup(binding);
    const stagePath=this.absolute(cleanup.stageName);
    if(lifecycle===null){let handle:FileHandle|undefined;try{handle=await open(stagePath,"wx",0o600);const created=await handle.stat({bigint:true});if(!created.isFile()||created.isSymbolicLink()||created.nlink!==1n)throw new LedgerCorruption("invalid new prep cleanup stage");}catch(error){if(hasCode(error,"EEXIST")||isSnapshotSharingError(error))return "reclassify";throw error;}finally{if(handle)await handle.close();}this.prepHousekeeperRuntime.observeBoundary?.("prep-only-cleanup-stage-zero");return "progress";}
    const entry=binding.snapshot.entries.find(value=>value.name===lifecycle),parsed=parseK1Name(lifecycle);if(entry?.kind!=="file"||entry.bytes===undefined||entry.identity.nlink!==1n)return "busy";
    if(parsed?.kind==="coordination-ack"){
      if(lifecycle!==`.authority-ledger-coordination-cleanup-${coordinationRawDigest(cleanup.bytes).slice(7)}.ack`||!entry.bytes.equals(cleanup.bytes))return "busy";
      if(await this.prepCleanupNameExists(String(cleanup.ack.originalName)))return "reclassify";
      if(!await this.revalidatePrepCleanupMarker(cleanup.artifact)||!await this.revalidatePrepCleanupFile(lifecycle,entry,cleanup.bytes))return "reclassify";
      const markerPath=this.absolute(cleanup.artifact.parsed.name),children=cleanup.artifact.entry.children??[];
      if(children.length!==0){
        try{await unlink(path.join(markerPath,"owner.json"));}catch(error){if(hasCode(error,"ENOENT")||hasCode(error,"EEXIST")||hasCode(error,"ENOTEMPTY")||isSnapshotSharingError(error))return "reclassify";throw error;}
      }
      try{await rmdir(markerPath);}catch(error){if(hasCode(error,"ENOENT")||hasCode(error,"EEXIST")||hasCode(error,"ENOTEMPTY")||isSnapshotSharingError(error))return "reclassify";throw error;}
      await this.syncDirectory(this.root);
      this.prepHousekeeperRuntime.observeBoundary?.("prep-only-cleanup-marker-root-synced");
      return "progress";
    }
    if(lifecycle!==cleanup.stageName||parsed?.kind!=="coordination-stage"||parsed.purpose!=="prep-retired")return "busy";
    const current=entry.bytes;
    if(current.equals(cleanup.bytes)){
      const finalName=`.authority-ledger-coordination-cleanup-${coordinationRawDigest(cleanup.bytes).slice(7)}.ack`,finalPath=this.absolute(finalName),originalName=String(cleanup.ack.originalName);
      if(await this.prepCleanupNameExists(finalName)||await this.prepCleanupNameExists(originalName))return "reclassify";
      if(!await this.revalidatePrepCleanupMarker(cleanup.artifact)||!await this.revalidatePrepCleanupFile(lifecycle,entry,cleanup.bytes))return "reclassify";
      try{await rename(stagePath,finalPath);}catch(error){if(hasCode(error,"EEXIST")||hasCode(error,"ENOTEMPTY")||hasCode(error,"ENOENT")||isSnapshotSharingError(error))return "reclassify";throw error;}
      let movedEntry:{identity:FileIdentity;bytes:Buffer};try{movedEntry=await this.readExactPrepCleanupFile(finalPath,"renamed prep cleanup acknowledgment");}catch(error){if(hasCode(error,"ENOENT")||isSnapshotSharingError(error))return "reclassify";throw error;}if(!sameFileIdentity(entry.identity,movedEntry.identity)||!movedEntry.bytes.equals(cleanup.bytes))throw new LedgerCorruption("prep cleanup acknowledgment changed during rename");
      await this.syncDirectory(this.root);
      this.prepHousekeeperRuntime.observeBoundary?.("prep-only-cleanup-ack-root-synced");
      return "progress";
    }
    if(current.length>=cleanup.bytes.length||!cleanup.bytes.subarray(0,current.length).equals(current))return "busy";
    let handle:FileHandle|undefined;
    try{
      handle=await open(stagePath,"r+");const opened=fileIdentity(await handle.stat({bigint:true})),named=fileIdentity(await lstat(stagePath,{bigint:true}));if(!sameFileIdentity(entry.identity,opened)||!sameFileIdentity(opened,named)||opened.nlink!==1n)throw new LedgerCorruption("prep cleanup stage identity changed before append");
      const observed=await handle.readFile();if(!observed.equals(current))throw new LedgerCorruption("prep cleanup stage bytes changed before append");
      if(current.length===0){await this.writeAll(handle,cleanup.bytes.subarray(0,1),0);}
      else{await this.writeAll(handle,cleanup.bytes.subarray(current.length),current.length);await handle.sync();}
      const finalIdentity=fileIdentity(await handle.stat({bigint:true})),finalNamed=fileIdentity(await lstat(stagePath,{bigint:true}));if(!sameFileIdentity(entry.identity,finalIdentity)||!sameFileIdentity(finalIdentity,finalNamed))throw new LedgerCorruption("prep cleanup stage identity changed during append");
    }catch(error){if(error instanceof LedgerCorruption)throw error;if(hasCode(error,"ENOENT")||isSnapshotSharingError(error))throw new LedgerCorruption("prep cleanup stage changed during append");throw error;}finally{if(handle)await handle.close();}
    this.prepHousekeeperRuntime.observeBoundary?.(current.length===0?"prep-only-cleanup-stage-prefix":"prep-only-cleanup-stage-complete");
    return "progress";
  }

  private async prepCleanupNameExists(name:string):Promise<boolean>{
    try{await lstat(this.absolute(name));return true;}catch(error){if(hasCode(error,"ENOENT"))return false;if(isSnapshotSharingError(error))return true;throw error;}
  }

  private async readExactPrepCleanupFile(target:string,label:string):Promise<{identity:FileIdentity;bytes:Buffer}>{
    const before=await lstat(target,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n)throw new LedgerCorruption(`invalid ${label}`);const identity=fileIdentity(before),bytes=await readFile(target),after=fileIdentity(await lstat(target,{bigint:true}));if(!sameFileIdentity(identity,after))throw new LedgerCorruption(`${label} identity changed during validation`);return {identity,bytes};
  }

  private async revalidatePrepCleanupFile(name:string,expected:HybridEntrySnapshot,bytes:Buffer):Promise<boolean>{
    try{const actual=await this.readExactPrepCleanupFile(this.absolute(name),"prep cleanup file");if(!sameFileIdentity(expected.identity,actual.identity)||!bytes.equals(actual.bytes))throw new LedgerCorruption("prep cleanup file changed before mutation");return true;}catch(error){if(hasCode(error,"ENOENT")||isSnapshotSharingError(error))return false;throw error;}
  }

  private async revalidatePrepCleanupMarker(artifact:HybridOwnedArtifact):Promise<boolean>{
    const target=this.absolute(artifact.parsed.name),ownerPath=path.join(target,"owner.json");
    try{
      const directory=fileIdentity(await lstat(target,{bigint:true}));if(!sameFileIdentity(artifact.entry.identity,directory))throw new LedgerCorruption("prep cleanup marker identity changed before mutation");
      const children=await readdir(target);if(artifact.entry.children?.length===0){if(children.length!==0)throw new LedgerCorruption("authenticated partial prep marker gained content");return true;}
      if(children.length!==1||children[0]!=="owner.json")throw new LedgerCorruption("prep cleanup marker contents changed before mutation");
      const owner=await this.readExactPrepCleanupFile(ownerPath,"prep cleanup marker owner");if(!sameFileIdentity(artifact.ownerIdentity,owner.identity)||!artifact.ownerBytes.equals(owner.bytes))throw new LedgerCorruption("prep cleanup marker owner changed before mutation");return true;
    }catch(error){if(hasCode(error,"ENOENT")||isSnapshotSharingError(error))return false;throw error;}
  }

  private async revalidatePrepHousekeepingAuthority(binding:PrepAuthorityBinding):Promise<"exact"|"busy"|"corruption">{
    let names:string[],snapshot:HybridRootSnapshot,closedNames:string[],closedSnapshot:HybridRootSnapshot;
    try{
      names=(await readdir(this.root)).sort();snapshot=await this.readHybridRootSnapshot(names);
      closedNames=(await readdir(this.root)).sort();if(!sameStrings(names,closedNames))return "busy";
      closedSnapshot=await this.readHybridRootSnapshot(closedNames);
      const finalNames=(await readdir(this.root)).sort();if(!sameStrings(closedNames,finalNames))return "busy";
    }catch(error){if(hasCode(error,"ENOENT")||isSnapshotSharingError(error))return "busy";if(error instanceof LedgerCorruption)return "corruption";throw error;}
    const closureRelation=this.compareHybridRootSnapshots(snapshot,closedSnapshot);
    if(closureRelation==="corruption")return "corruption";
    if(closureRelation!=="unchanged")return "busy";
    let decision:HybridGuardDecision;try{decision=this.classifyClosedHybridGraph(closedSnapshot);}catch(error){if(error instanceof LedgerCorruption)return "corruption";throw error;}
    if(decision==="corruption")return "corruption";
    const relation=this.compareHybridRootSnapshots(binding.snapshot,closedSnapshot);
    if(relation==="corruption")return "corruption";
    if(relation!=="unchanged"||decision!=="busy")return "busy";
    const descriptor=describeStablePrepAuthority(closedSnapshot,decision);
    if(descriptor===null||!samePrepAuthorityDescriptor(binding.descriptor,descriptor))return "busy";
    if(descriptor.kind==="dead-prep"&&processLiveness(descriptor.pid)!=="dead")return "busy";
    return "exact";
  }

  private async readHybridRootSnapshot(names:readonly string[]):Promise<HybridRootSnapshot>{
    const relevant=names.filter(name=>isK1ReservedName(name)||name==="lock"||name.startsWith(".authority-ledger-lock-")).sort(),entries:HybridEntrySnapshot[]=[];
    for(const name of relevant){
      const target=this.absolute(name),info=await lstat(target,{bigint:true}),identity=fileIdentity(info),kind=hybridKind(info);
      if(kind==="file"){const bytes=await readFile(target);entries.push({name,kind,identity,bytes});continue;}
      if(kind!=="directory"){entries.push({name,kind,identity});continue;}
      const children:HybridChildSnapshot[]=[];
      for(const childName of (await readdir(target)).sort()){
        const childPath=path.join(target,childName),childInfo=await lstat(childPath,{bigint:true}),childKind=hybridKind(childInfo),childIdentity=fileIdentity(childInfo);
        children.push(childKind==="file"?{name:childName,kind:childKind,identity:childIdentity,bytes:await readFile(childPath)}:{name:childName,kind:childKind,identity:childIdentity});
      }
      entries.push({name,kind,identity,children});
    }
    return {names:Object.freeze([...names]),entries:Object.freeze(entries)};
  }

  private compareHybridRootSnapshots(left:HybridRootSnapshot,right:HybridRootSnapshot):HybridSnapshotRelation{
    if(sameHybridRootSnapshot(left,right))return "unchanged";
    const rightByName=new Map(right.entries.map(entry=>[entry.name,entry]));
    let progressed=false;
    for(const entry of left.entries){
      const other=rightByName.get(entry.name);if(other===undefined)continue;
      if(sameHybridEntrySnapshot(entry,other))continue;
      if(entry.kind!==other.kind||!sameFileIdentity(entry.identity,other.identity))return "corruption";
      if(this.isHybridOwnerConstruction(entry,other)||this.isHybridStageConstruction(entry,other)){progressed=true;continue;}
      return "corruption";
    }
    return sameStrings(left.names,right.names)?progressed?"monotonic-progress":"corruption":"membership-churn";
  }

  private isHybridOwnerConstruction(left:HybridEntrySnapshot,right:HybridEntrySnapshot):boolean{
    if(left.kind!=="directory"||right.kind!=="directory")return false;
    const parsed=parseK1Name(left.name),publication=parsePublicationName(left.name),localHost=hostname();let owner:CoordinationOwner;
    if(parsed?.kind==="admission-prep"){
      if(parsed.hostDigest!==coordinationHostDigest(localHost))return false;
      owner={host:localHost,nonce:parsed.nonce,pid:parsed.pid,v:1};
    }else if(publication!==null){
      if(publication.hostDigest!==coordinationHostDigest(localHost))return false;
      owner={host:localHost,nonce:publication.nonce,pid:publication.pid,v:1};
    }else return false;
    const children=left.children??[],otherChildren=right.children??[];
    if(children.length===0){
      if(otherChildren.length!==1)return false;const child=otherChildren[0];
      return child.name==="owner.json"&&child.kind==="file"&&child.identity.nlink===1n&&child.bytes!==undefined&&classifyCoordinationOwnerBytes(child.bytes,owner)!=="invalid";
    }
    if(children.length!==1||otherChildren.length!==1)return false;
    const child=children[0],other=otherChildren[0];
    if(child.name!=="owner.json"||other.name!=="owner.json"||child.kind!=="file"||other.kind!=="file"||!sameFileIdentity(child.identity,other.identity)||child.identity.nlink!==1n||child.bytes===undefined||other.bytes===undefined)return false;
    if(classifyCoordinationOwnerBytes(child.bytes,owner)==="complete")return false;
    return isStrictBufferPrefix(child.bytes,other.bytes)&&classifyCoordinationOwnerBytes(other.bytes,owner)!=="invalid";
  }

  private isHybridStageConstruction(left:HybridEntrySnapshot,right:HybridEntrySnapshot):boolean{
    if(left.kind!=="file"||right.kind!=="file"||left.identity.nlink!==1n||left.bytes===undefined||right.bytes===undefined)return false;
    const parsed=parseK1Name(left.name),typedStage=parsed?.kind==="coordination-stage",legacyStage=CLEANUP_STAGE.test(left.name);
    return (typedStage||legacyStage)&&isStrictBufferPrefix(left.bytes,right.bytes);
  }

  private classifyClosedHybridGraph(snapshot:HybridRootSnapshot):HybridGuardDecision{
    const byName=new Map(snapshot.entries.map(entry=>[entry.name,entry])),parsedK1:ParsedK1Name[]=[],owned:HybridOwnedArtifact[]=[],acks:HybridAckArtifact[]=[];
    const localHost=hostname(),localDigest=coordinationHostDigest(localHost);
    for(const name of snapshot.names){
      if(isK1ReservedName(name)){
        const parsed=parseK1Name(name);if(parsed===null)throw new LedgerCorruption("invalid K1 reserved artifact name");parsedK1.push(parsed);
      }else if(name.startsWith(".authority-ledger-lock-")&&!PUBLICATION_STAGE.test(name)&&!RETIRED_LOCK.test(name)&&!CLEANUP_ACK.test(name)&&!CLEANUP_STAGE.test(name))throw new LedgerCorruption("invalid hybrid legacy artifact name");
    }
    const publicationEntries=snapshot.entries.filter(entry=>entry.name.startsWith(".authority-ledger-lock-publication-"));
    if(publicationEntries.length>1)throw new LedgerCorruption("multiple publication stages in K1 generation");
    const publications=publicationEntries.map(entry=>this.classifyHybridPublication(entry,localHost,localDigest));
    const activeEntry=byName.get("lock"),activeOwner=activeEntry?this.classifyHybridCompleteOwnerDirectory(activeEntry,null,localHost):null;
    const retired=new Map<string,Readonly<{owner:CoordinationOwner;entry:HybridEntrySnapshot;disposition:RetirementDisposition}>>();
    for(const entry of snapshot.entries){const match=RETIRED_LOCK.exec(entry.name);if(!match)continue;const owner=this.classifyHybridCompleteOwnerDirectory(entry,{host:localHost,pid:Number(match[1]),nonce:match[2]},localHost);retired.set(entry.name,{owner,entry,disposition:match[3] as RetirementDisposition});}
    const legacyCleanup=snapshot.entries.filter(entry=>CLEANUP_ACK.test(entry.name)||CLEANUP_STAGE.test(entry.name)).map(entry=>this.classifyHybridLegacyCleanup(entry,retired,localHost));
    for(const parsed of parsedK1){
      const entry=byName.get(parsed.name);if(!entry)throw new LedgerCorruption("K1 artifact disappeared from closed snapshot");
      if(parsed.kind==="coordination-ack"||parsed.kind==="coordination-stage"){
        if(entry.kind!=="file"||entry.identity.nlink!==1n||entry.bytes===undefined)throw new LedgerCorruption("invalid coordination cleanup object");
        let ack:CoordinationAck|null=null;try{ack=parseCoordinationAckBytes(entry.bytes);}catch(error){if(parsed.kind==="coordination-ack"||entry.bytes.length>0&&!Buffer.from("{").equals(entry.bytes.subarray(0,1)))throw new LedgerCorruption("invalid coordination cleanup bytes");}
        if(ack!==null){if(coordinationRawDigest(entry.bytes).slice(7)!==parsed.digest||parsed.kind==="coordination-stage"&&ack.purpose!==parsed.purpose)throw new LedgerCorruption("coordination cleanup digest or purpose mismatch");}
        acks.push({parsed,entry,ack});continue;
      }
      if(parsed.kind==="admission-slot"){
        const owner=this.classifyHybridCompleteOwnerDirectory(entry,null,localHost),child=hybridOwnerChild(entry)!;owned.push({parsed,entry,owner,ownerBytes:child.bytes!,ownerIdentity:child.identity,state:"complete"});continue;
      }
      const namedOwner:CoordinationOwner={host:localHost,nonce:parsed.nonce,pid:parsed.pid,v:1};if(parsed.hostDigest!==localDigest)throw new LedgerCorruption("foreign K1 artifact provenance");
      const declared=parsed.kind==="admission-prep"?null:parsed.kind==="admission-prep-retired"||parsed.kind==="creator-withdrawal"?parsed.state:"complete";
      const partial=parsed.kind==="admission-prep-retired"?this.classifyHybridAuthenticatedPartialPrepMarker(parsed,entry,snapshot):null;
      owned.push(partial??this.classifyHybridNamedOwnerDirectory(parsed,entry,namedOwner,declared));
    }
    const preps=owned.filter(item=>item.parsed.kind==="admission-prep"),slots=owned.filter(item=>item.parsed.kind==="admission-slot"),prepRetired=owned.filter(item=>item.parsed.kind==="admission-prep-retired"),slotRetired=owned.filter(item=>item.parsed.kind==="admission-slot-retired"),withdrawals=owned.filter(item=>item.parsed.kind==="creator-withdrawal");
    if(preps.length>1||slots.length>1||prepRetired.length>1||slotRetired.length>1||withdrawals.length>1)throw new LedgerCorruption("duplicate K1 coordination authority");
    const coordinationByDigest=new Map<string,{ack:boolean;stages:number}>();for(const artifact of acks){const state=coordinationByDigest.get(artifact.parsed.digest)??{ack:false,stages:0};if(artifact.parsed.kind==="coordination-ack")state.ack=true;else state.stages++;coordinationByDigest.set(artifact.parsed.digest,state);}for(const state of coordinationByDigest.values())if(state.stages>1||state.ack&&state.stages>0)throw new LedgerCorruption("duplicate coordination cleanup lifecycle state");
    const lifecyclePurposes=new Set<string>();for(const artifact of acks){const purpose=artifact.parsed.kind==="coordination-stage"?artifact.parsed.purpose:artifact.ack?.purpose;if(purpose===undefined||lifecyclePurposes.has(purpose)||artifact.parsed.kind==="coordination-ack"&&artifact.ack!.owner.host!==localHost)throw new LedgerCorruption("invalid coordination cleanup provenance or purpose multiplicity");lifecyclePurposes.add(purpose);}
    for(const artifact of acks)if(artifact.parsed.kind==="coordination-stage")this.validateHybridCleanupStage(artifact,byName,prepRetired,slotRetired,withdrawals,retired,activeOwner,acks);
    const livenessOwners=[...owned.map(item=>item.owner),...publications.map(item=>item.owner),...(activeOwner===null?[]:[activeOwner]),...[...retired.values()].map(item=>item.owner)];
    for(const owner of livenessOwners)if(processLiveness(owner.pid)==="unverifiable")throw new LedgerCorruption("unverifiable K1 owner liveness");
    for(const ack of acks)if(ack.ack!==null)this.validateHybridAckBinding(ack,byName,owned,retired,acks);
    this.validateHybridLegacyCleanupCoexistence(legacyCleanup,owned,slotRetired,byName,activeOwner,retired,publications.length,acks.length);
    const orphanFinalDecision=this.classifyHybridOrphanFinalGeneration(byName,owned,retired,activeOwner,publications.length,acks);if(orphanFinalDecision!==null)return orphanFinalDecision;
    if(preps.length){if(parsedK1.length!==1||publications.length||activeOwner!==null||retired.size)throw new LedgerCorruption("impossible preparation graph");return "busy";}
    if(slots.length){
      if(parsedK1.length!==1||retired.size||acks.length||prepRetired.length||slotRetired.length||withdrawals.length)throw new LedgerCorruption("impossible fixed-slot graph");
      const slot=slots[0];if(publications.length&&activeOwner!==null)throw new LedgerCorruption("slot cannot bind stage and active lock");
      if(publications.length&&!sameCoordinationOwner(slot.owner,publications[0].owner))throw new LedgerCorruption("slot publication owner mismatch");
      if(activeOwner!==null&&!sameCoordinationOwner(slot.owner,activeOwner))throw new LedgerCorruption("slot active owner mismatch");
      return "busy";
    }
    if(prepRetired.length){if(slotRetired.length||withdrawals.length||publications.length||activeOwner!==null||retired.size)throw new LedgerCorruption("impossible retired preparation graph");return "busy";}
    if(slotRetired.length){
      if(prepRetired.length||publications.length)throw new LedgerCorruption("impossible retired slot graph");
      const marker=slotRetired[0],parsed=marker.parsed as Extract<ParsedK1Name,{kind:"admission-slot-retired"}>;
      if(parsed.disposition==="withdrawn"){
        if(activeOwner!==null)throw new LedgerCorruption("withdrawn slot cannot bind active lock");
        const terminalNames=[...withdrawals.filter(value=>sameCoordinationOwner(value.owner,marker.owner)).map(value=>value.parsed.name),...[...retired.values()].filter(value=>value.disposition==="publication-aborted"&&sameCoordinationOwner(value.owner,marker.owner)).map(value=>value.entry.name)];
        const bound=acks.filter(value=>value.ack?.purpose==="slot-retired"&&value.ack.markerName===parsed.name&&terminalNames.includes(String(value.ack.terminalArtifactName)));
        if(withdrawals.length+retired.size!==1||terminalNames.length!==1||acks.some(value=>value.ack?.purpose==="slot-retired")&&bound.length===0)throw new LedgerCorruption("withdrawn slot lacks exact terminal binding");
      }else if(parsed.disposition==="published"){
        if(withdrawals.length)throw new LedgerCorruption("published slot cannot bind a withdrawal");
        this.classifyHybridPublishedSuccessor(marker,byName,activeOwner,retired);
      }else if(withdrawals.length||activeOwner!==null||retired.size)throw new LedgerCorruption("abandoned slot has an impossible successor");
      return "busy";
    }
    if(withdrawals.length){const withdrawalName=withdrawals[0].parsed.name,bound=acks.some(value=>value.parsed.kind==="coordination-ack"&&value.ack?.purpose==="creator-withdrawal"&&value.ack.markerName===withdrawalName),slotAuthority=acks.some(value=>value.parsed.kind==="coordination-ack"&&value.ack?.purpose==="slot-retired"&&value.ack.disposition==="withdrawn"&&value.ack.terminalArtifactName===withdrawalName&&sameCoordinationOwner(value.ack.owner,withdrawals[0].owner));if(preps.length||slots.length||prepRetired.length||slotRetired.length||publications.length||activeOwner!==null||retired.size||!bound&&!slotAuthority)throw new LedgerCorruption("withdrawal lacks a closed final retirement lineage");return "busy";}
    if(parsedK1.length>0)return "busy";
    return "continue-legacy";
  }

  private classifyHybridPublication(entry:HybridEntrySnapshot,localHost:string,localDigest:string):Readonly<{owner:CoordinationOwner;state:PartialOwnerState}>{
    const parsed=parsePublicationName(entry.name);if(parsed===null||parsed.hostDigest!==localDigest)throw new LedgerCorruption("invalid K1 publication membership");const owner:CoordinationOwner={host:localHost,nonce:parsed.nonce,pid:parsed.pid,v:1};const classified=this.classifyHybridNamedOwnerDirectory({kind:"admission-prep",name:entry.name,hostDigest:parsed.hostDigest,pid:parsed.pid,nonce:parsed.nonce},entry,owner,null);return {owner,state:classified.state};
  }

  private classifyHybridCompleteOwnerDirectory(entry:HybridEntrySnapshot,expected:Readonly<{host:string;pid:number;nonce:string}>|null,localHost:string):CoordinationOwner{
    if(entry.kind!=="directory")throw new LedgerCorruption("invalid owner directory");const child=hybridOwnerChild(entry);if(child===null||entry.children?.length!==1||child.kind!=="file"||child.identity.nlink!==1n||child.bytes===undefined)throw new LedgerCorruption("invalid owner directory contents");let owner:CoordinationOwner;try{owner=parseCoordinationOwnerBytes(child.bytes);}catch{throw new LedgerCorruption("invalid canonical owner");}if(owner.host!==localHost||expected!==null&&(owner.host!==expected.host||owner.pid!==expected.pid||owner.nonce!==expected.nonce))throw new LedgerCorruption("owner provenance mismatch");return owner;
  }

  private classifyHybridNamedOwnerDirectory(parsed:ParsedK1Name,entry:HybridEntrySnapshot,owner:CoordinationOwner,declared:PartialOwnerState|null):HybridOwnedArtifact{
    if(entry.kind!=="directory")throw new LedgerCorruption("invalid K1 directory");const children=entry.children??[];
    if(children.length===0){if(declared!==null&&declared!=="empty")throw new LedgerCorruption("K1 state mismatch");return {parsed,entry,owner,ownerBytes:Buffer.alloc(0),ownerIdentity:entry.identity,state:"empty"};}
    const child=hybridOwnerChild(entry);if(children.length!==1||child===null||child.kind!=="file"||child.identity.nlink!==1n||child.bytes===undefined)throw new LedgerCorruption("invalid K1 owner object");const state=classifyCoordinationOwnerBytes(child.bytes,owner);if(state==="invalid"||state==="empty"||declared!==null&&state!==declared)throw new LedgerCorruption("invalid K1 owner bytes");return {parsed,entry,owner,ownerBytes:child.bytes,ownerIdentity:child.identity,state};
  }

  private classifyHybridAuthenticatedPartialPrepMarker(parsed:Extract<ParsedK1Name,{kind:"admission-prep-retired"}>,entry:HybridEntrySnapshot,snapshot:HybridRootSnapshot):HybridOwnedArtifact|null{
    if(entry.kind!=="directory"||(entry.children??[]).length!==0||parsed.state==="empty")return null;
    const candidates:CoordinationAck[]=[];
    for(const candidateName of snapshot.names){
      const candidate=parseK1Name(candidateName);if(candidate?.kind!=="coordination-ack")continue;const candidateEntry=snapshot.entries.find(value=>value.name===candidateName);if(candidateEntry?.kind!=="file"||candidateEntry.bytes===undefined||candidateEntry.identity.nlink!==1n)continue;
      let ack:CoordinationAck;try{ack=parseCoordinationAckBytes(candidateEntry.bytes);}catch{continue;}
      if(ack.purpose==="prep-retired"&&ack.markerName===parsed.name&&coordinationRawDigest(candidateEntry.bytes).slice(7)===candidate.digest)candidates.push(ack);
    }
    if(candidates.length!==1)return null;
    const ack=candidates[0],owner=ack.owner,localHost=hostname(),hostDigest=coordinationHostDigest(localHost);
    if(owner.host!==localHost||parsed.hostDigest!==hostDigest||owner.pid!==parsed.pid||owner.nonce!==parsed.nonce||ack.state!==parsed.state||ack.originalName!==`.authority-ledger-admission-prep-${hostDigest}-${owner.pid}-${owner.nonce}.tmp`||!coordinationIdentityMatches(ack.directoryIdentity as CoordinationIdentityWire,entry.identity)||ack.ownerIdentity===null)throw new LedgerCorruption("partial prep marker acknowledgment binding mismatch");
    const ownerBytes=this.validateHybridHistoricalOwnerBytes(ack),ownerIdentity=parseCoordinationIdentityWire(ack.ownerIdentity);
    return {parsed,entry,owner,ownerBytes,ownerIdentity,state:parsed.state};
  }

  private validateHybridAckBinding(source:HybridAckArtifact,byName:Map<string,HybridEntrySnapshot>,owned:readonly HybridOwnedArtifact[],retired:Map<string,Readonly<{owner:CoordinationOwner;entry:HybridEntrySnapshot;disposition:RetirementDisposition}>>,acks:readonly HybridAckArtifact[]):void{
    const ack=source.ack;if(ack===null)throw new LedgerCorruption("incomplete coordination record cannot bind authority");
    const markerName=String(ack.markerName),marker=byName.get(markerName),owner=ack.owner,hostDigest=coordinationHostDigest(owner.host),parsedMarker=parseK1Name(markerName);
    if(ack.purpose==="prep-retired"){
      const state=String(ack.state);if(parsedMarker?.kind!=="admission-prep-retired"||parsedMarker.hostDigest!==hostDigest||parsedMarker.pid!==owner.pid||parsedMarker.nonce!==owner.nonce||parsedMarker.state!==state||ack.originalName!==`.authority-ledger-admission-prep-${hostDigest}-${owner.pid}-${owner.nonce}.tmp`)throw new LedgerCorruption("prep-retired ack name binding mismatch");
    }else if(ack.purpose==="slot-retired"){
      if(parsedMarker?.kind!=="admission-slot-retired"||parsedMarker.hostDigest!==hostDigest||parsedMarker.pid!==owner.pid||parsedMarker.nonce!==owner.nonce||parsedMarker.disposition!==ack.disposition||ack.originalName!==ADMISSION_SLOT_NAME)throw new LedgerCorruption("slot-retired ack name binding mismatch");
      const historicalOwnerBytes=coordinationCanonicalBytes(owner);if(ack.ownerBytesDigest!==coordinationRawDigest(historicalOwnerBytes)||ack.ownerBytesLength!==String(historicalOwnerBytes.length))throw new LedgerCorruption("slot-retired ack historical owner bytes mismatch");
      if(ack.disposition==="abandoned"&&(ack.terminalArtifactName!==ack.markerName||ack.terminalArtifactDigest!==coordinationRawDigest(historicalOwnerBytes)))throw new LedgerCorruption("abandoned slot historical terminal mismatch");
    }else{
      const state=String(ack.state);if(parsedMarker?.kind!=="creator-withdrawal"||parsedMarker.hostDigest!==hostDigest||parsedMarker.pid!==owner.pid||parsedMarker.nonce!==owner.nonce||parsedMarker.state!==state||ack.originalName!==buildPublicationName(owner,parsedMarker.ticket))throw new LedgerCorruption("withdrawal ack name binding mismatch");
    }
    if(ack.purpose==="prep-retired"||ack.purpose==="creator-withdrawal")this.validateHybridHistoricalOwnerBytes(ack);
    if(marker!==undefined){
      const markerIdentity=(ack.purpose==="slot-retired"?ack.slotIdentity:ack.directoryIdentity) as CoordinationIdentityWire;if(!coordinationIdentityMatches(markerIdentity,marker.identity))throw new LedgerCorruption("coordination marker identity mismatch");
      const child=hybridOwnerChild(marker),wire=ack.ownerIdentity,partialArtifact=owned.find(item=>item.parsed.kind==="admission-prep-retired"&&item.parsed.name===markerName&&item.entry===marker),authenticatedPartial=ack.purpose==="prep-retired"&&parsedMarker?.kind==="admission-prep-retired"&&parsedMarker.state!=="empty"&&(marker.children??[]).length===0&&partialArtifact!==undefined&&wire!==null&&coordinationIdentityMatches(wire as CoordinationIdentityWire,partialArtifact.ownerIdentity);
      if(wire===null){if(child!==null)throw new LedgerCorruption("coordination empty owner mismatch");}
      else if(child===null){if(!authenticatedPartial)throw new LedgerCorruption("coordination owner identity mismatch");}
      else if(!coordinationIdentityMatches(wire as CoordinationIdentityWire,child.identity))throw new LedgerCorruption("coordination owner identity mismatch");
      if(!authenticatedPartial){const bytes=child?.bytes??Buffer.alloc(0);if(ack.ownerBytesDigest!==coordinationRawDigest(bytes)||ack.ownerBytesLength!==String(bytes.length))throw new LedgerCorruption("coordination owner bytes mismatch");}
    }
    if(ack.purpose==="prep-retired"){
      const artifact=owned.find(item=>item.parsed.kind==="admission-prep-retired"&&item.parsed.name===ack.markerName);if(artifact!==undefined&&!sameCoordinationOwner(artifact.owner,owner))throw new LedgerCorruption("prep-retired ack owner mismatch");
    }else if(ack.purpose==="slot-retired"){
      const artifact=owned.find(item=>item.parsed.kind==="admission-slot-retired"&&item.parsed.name===ack.markerName);if(artifact!==undefined&&(!sameCoordinationOwner(artifact.owner,owner)||!coordinationIdentityMatches(ack.slotIdentity as CoordinationIdentityWire,artifact.entry.identity)))throw new LedgerCorruption("slot-retired ack binding mismatch");
      const terminalName=String(ack.terminalArtifactName),terminalEntry=byName.get(terminalName),ownedTerminal=owned.find(item=>item.parsed.name===terminalName),retiredTerminal=retired.get(terminalName),activeTerminal=terminalName==="lock"&&terminalEntry!==undefined?this.classifyHybridCompleteOwnerDirectory(terminalEntry,null,hostname()):undefined,terminalOwner=ownedTerminal?.owner??retiredTerminal?.owner??activeTerminal;
      if(terminalEntry!==undefined){const child=hybridOwnerChild(terminalEntry);if(child?.bytes===undefined||ack.terminalArtifactDigest!==coordinationRawDigest(child.bytes)||terminalOwner===undefined||!sameCoordinationOwner(terminalOwner,owner))throw new LedgerCorruption("slot-retired terminal mismatch");}
      if(ack.disposition==="abandoned"){
        if(terminalName!==markerName||terminalEntry===undefined&&processLiveness(owner.pid)!=="dead")throw new LedgerCorruption("abandoned slot lacks its terminal authority");
      }else if(ack.disposition==="withdrawn"){
        const validWithdrawal=ownedTerminal?.parsed.kind==="creator-withdrawal",validAborted=retiredTerminal?.disposition==="publication-aborted";if(terminalEntry===undefined||!validWithdrawal&&!validAborted)throw new LedgerCorruption("withdrawn slot lacks its terminal authority");
      }else if(terminalEntry===undefined||terminalName!=="lock"&&retiredTerminal===undefined)throw new LedgerCorruption("published slot lacks its terminal authority");
    }else{
      const artifact=owned.find(item=>item.parsed.kind==="creator-withdrawal"&&item.parsed.name===ack.markerName);if(artifact!==undefined&&!sameCoordinationOwner(artifact.owner,owner))throw new LedgerCorruption("withdrawal ack owner mismatch");const referenceName=String(ack.slotRetirementAckName),referenceDigest=String(ack.slotRetirementAckDigest),parsedReference=parseK1Name(referenceName);if(parsedReference?.kind!=="coordination-ack"||referenceDigest!==`sha256:${parsedReference.digest}`)throw new LedgerCorruption("withdrawal slot ack reference mismatch");const withdrawnMarkerName=`.authority-ledger-admission-retired-${hostDigest}-${owner.pid}-${owner.nonce}.withdrawn`;if(byName.has(withdrawnMarkerName))throw new LedgerCorruption("withdrawal final precedes retired slot marker removal");const referenced=acks.find(value=>value.parsed.kind==="coordination-ack"&&value.parsed.digest===parsedReference.digest),referencedStage=acks.some(value=>value.parsed.kind==="coordination-stage"&&value.parsed.digest===parsedReference.digest),slotFinals=acks.filter(value=>value.parsed.kind==="coordination-ack"&&value.ack?.purpose==="slot-retired");if(referenced!==undefined){const referencedAck=referenced.ack;if(slotFinals.length!==1||slotFinals[0]!==referenced||referencedAck===null||coordinationCanonicalDigest(referencedAck)!==referenceDigest||referencedAck.purpose!=="slot-retired"||!sameCoordinationOwner(referencedAck.owner,owner)||referencedAck.disposition!=="withdrawn"||referencedAck.terminalArtifactName!==markerName||String(referencedAck.markerName)!==withdrawnMarkerName)throw new LedgerCorruption("withdrawal slot ack mismatch or non-monotonic marker presence");}else if(slotFinals.length!==0||source.parsed.kind==="coordination-stage"||referencedStage)throw new LedgerCorruption("withdrawal lacks final slot acknowledgment");
    }
  }

  private validateHybridHistoricalOwnerBytes(ack:CoordinationAck):Buffer{
    const state=String(ack.state),complete=coordinationCanonicalBytes(ack.owner),length=BigInt(String(ack.ownerBytesLength));let expected:Buffer;
    if(state==="empty"||state==="zero"){if(length!==0n)throw new LedgerCorruption("empty historical owner state has nonzero length");expected=Buffer.alloc(0);}
    else if(state==="partial"){if(length<=0n||length>=BigInt(complete.length))throw new LedgerCorruption("partial historical owner length is not a strict prefix");expected=complete.subarray(0,Number(length));}
    else if(state==="complete"&&ack.purpose==="prep-retired"){if(length!==BigInt(complete.length))throw new LedgerCorruption("complete historical owner length mismatch");expected=complete;}
    else throw new LedgerCorruption("impossible historical owner state");
    if(ack.ownerBytesLength!==String(expected.length)||ack.ownerBytesDigest!==coordinationRawDigest(expected))throw new LedgerCorruption("historical owner raw-byte commitment mismatch");return expected;
  }

  private classifyHybridLegacyCleanup(entry:HybridEntrySnapshot,retired:Map<string,Readonly<{owner:CoordinationOwner;entry:HybridEntrySnapshot;disposition:RetirementDisposition}>>,localHost:string):HybridLegacyCleanupArtifact{
    if(entry.kind!=="file"||entry.identity.nlink!==1n||entry.bytes===undefined)throw new LedgerCorruption("invalid legacy cleanup object in K1 generation");
    const ackMatch=CLEANUP_ACK.exec(entry.name);if(ackMatch){const ack=parseCanonical(entry.bytes) as CleanupAck;assertCleanupAck(ack);if(authorityDigest(ack).slice(7)!==ackMatch[1])throw new LedgerCorruption("legacy cleanup acknowledgment digest mismatch");this.validateHybridLegacyCleanupAck(ack,localHost);return {kind:"ack",entry,ack};}
    const stageMatch=CLEANUP_STAGE.exec(entry.name);if(!stageMatch)throw new LedgerCorruption("invalid legacy cleanup artifact name");
    const pid=Number(stageMatch[1]),nonce=stageMatch[2],markers=[...retired.values()].filter(value=>value.owner.pid===pid&&value.owner.nonce===nonce);
    if(markers.length!==1||markers[0].disposition==="recovery-pending")throw new LedgerCorruption("legacy cleanup stage lacks an exact resolved marker");
    const marker=markers[0],owner={host:marker.owner.host,nonce:marker.owner.nonce,pid:marker.owner.pid,v:1 as const},ack:CleanupAck={disposition:marker.disposition,journalHead:null,markerName:marker.entry.name,owner,ownerDigest:authorityDigest(owner),v:"reelier.authority-ledger-lock-cleanup-ack/v1"},expected=canonicalBytes(ack);
    if(stageMatch[3]!==authorityDigest(ack).slice(7)||entry.bytes.length>expected.length||!expected.subarray(0,entry.bytes.length).equals(entry.bytes))throw new LedgerCorruption("legacy cleanup stage is not its canonical marker-bound prefix");
    this.validateHybridLegacyCleanupAck(ack,localHost);return {kind:"stage",entry,ack};
  }

  private validateHybridLegacyCleanupAck(ack:CleanupAck,localHost:string):void{
    const marker=RETIRED_LOCK.exec(ack.markerName);if(!marker||marker[3]!==ack.disposition||Number(marker[1])!==ack.owner.pid||marker[2]!==ack.owner.nonce||ack.owner.host!==localHost||authorityDigest(ack.owner)!==ack.ownerDigest)throw new LedgerCorruption("legacy cleanup acknowledgment binding mismatch");
  }

  private validateHybridLegacyCleanupCoexistence(legacy:readonly HybridLegacyCleanupArtifact[],owned:readonly HybridOwnedArtifact[],slotMarkers:readonly HybridOwnedArtifact[],byName:Map<string,HybridEntrySnapshot>,activeOwner:CoordinationOwner|null,retired:Map<string,Readonly<{owner:CoordinationOwner;entry:HybridEntrySnapshot;disposition:RetirementDisposition}>>,publicationCount:number,coordinationCount:number):void{
    if(legacy.length===0)return;
    if(legacy.length!==1||slotMarkers.length!==1||owned.length!==1||publicationCount!==0||coordinationCount!==0)throw new LedgerCorruption("legacy cleanup lineage cannot coexist with this K1 generation");
    const slot=slotMarkers[0],parsed=slot.parsed;if(parsed.kind!=="admission-slot-retired"||parsed.disposition!=="published")throw new LedgerCorruption("legacy cleanup coexistence requires a published slot marker");
    const successor=this.classifyHybridPublishedSuccessor(slot,byName,activeOwner,retired),retiredSuccessor=retired.get(successor.name),artifact=legacy[0];
    if(retiredSuccessor===undefined||retiredSuccessor.disposition==="recovery-pending"||artifact.ack.disposition!==retiredSuccessor.disposition||artifact.ack.journalHead!==null||artifact.ack.markerName!==successor.name||!sameCoordinationOwner(artifact.ack.owner,slot.owner))throw new LedgerCorruption("legacy cleanup artifact is not the published slot's exact resolved successor lineage");
  }

  private validateHybridCleanupStage(stage:HybridAckArtifact,byName:Map<string,HybridEntrySnapshot>,prepMarkers:readonly HybridOwnedArtifact[],slotMarkers:readonly HybridOwnedArtifact[],withdrawalMarkers:readonly HybridOwnedArtifact[],retired:Map<string,Readonly<{owner:CoordinationOwner;entry:HybridEntrySnapshot;disposition:RetirementDisposition}>>,activeOwner:CoordinationOwner|null,acks:readonly HybridAckArtifact[]):void{
    let expected:CoordinationAck;
    if(stage.parsed.kind!=="coordination-stage")throw new LedgerCorruption("invalid cleanup stage classifier input");
    if(stage.parsed.purpose==="prep-retired"){
      if(prepMarkers.length!==1)throw new LedgerCorruption("prep-retired cleanup stage lacks its predecessor marker");
      const marker=prepMarkers[0],parsed=marker.parsed;if(parsed.kind!=="admission-prep-retired")throw new LedgerCorruption("invalid prep-retired predecessor");
      expected={directoryIdentity:encodeCoordinationIdentityWire(marker.entry.identity),kind:"admission-prep-retired",markerName:parsed.name,originalName:`.authority-ledger-admission-prep-${parsed.hostDigest}-${parsed.pid}-${parsed.nonce}.tmp`,owner:marker.owner,ownerBytesDigest:coordinationRawDigest(marker.ownerBytes),ownerBytesLength:String(marker.ownerBytes.length),ownerDigest:coordinationCanonicalDigest(marker.owner),ownerIdentity:marker.state==="empty"?null:encodeCoordinationIdentityWire(marker.ownerIdentity),purpose:"prep-retired",recoveryAuthority:"dead-owner-or-exact-creator",state:parsed.state,v:COORDINATION_ACK_VERSION};
    }else if(stage.parsed.purpose==="slot-retired"){
      if(slotMarkers.length!==1)throw new LedgerCorruption("slot-retired cleanup stage lacks its predecessor marker");
      const marker=slotMarkers[0],parsed=marker.parsed;if(parsed.kind!=="admission-slot-retired")throw new LedgerCorruption("invalid slot-retired predecessor");
      let terminalName:string,terminalBytes:Buffer,recoveryAuthority:string;
      if(parsed.disposition==="abandoned"){terminalName=parsed.name;terminalBytes=marker.ownerBytes;recoveryAuthority="dead-owner-or-exact-creator";}
      else{
        const candidates:Array<Readonly<{name:string;entry:HybridEntrySnapshot}>>=[];
        if(parsed.disposition==="withdrawn"){
          for(const item of withdrawalMarkers)if(sameCoordinationOwner(item.owner,marker.owner))candidates.push({name:item.parsed.name,entry:item.entry});
          for(const item of retired.values())if(item.disposition==="publication-aborted"&&sameCoordinationOwner(item.owner,marker.owner))candidates.push({name:item.entry.name,entry:item.entry});
          recoveryAuthority="exact-withdrawal-marker";
        }else{
          const successor=this.classifyHybridPublishedSuccessor(marker,byName,activeOwner,retired);candidates.push({name:successor.name,entry:successor.entry});
          recoveryAuthority="active-owner-or-exact-lock-successor";
        }
        if(candidates.length!==1)throw new LedgerCorruption("slot-retired cleanup stage lacks its exact terminal proof");
        terminalName=candidates[0].name;const child=hybridOwnerChild(candidates[0].entry);if(child?.bytes===undefined)throw new LedgerCorruption("slot-retired cleanup terminal has no exact bytes");terminalBytes=child.bytes;
      }
      expected={disposition:parsed.disposition,kind:"admission-slot-retired",markerName:parsed.name,originalName:ADMISSION_SLOT_NAME,owner:marker.owner,ownerBytesDigest:coordinationRawDigest(marker.ownerBytes),ownerBytesLength:String(marker.ownerBytes.length),ownerDigest:coordinationCanonicalDigest(marker.owner),ownerIdentity:encodeCoordinationIdentityWire(marker.ownerIdentity),purpose:"slot-retired",recoveryAuthority,slotIdentity:encodeCoordinationIdentityWire(marker.entry.identity),terminalArtifactDigest:coordinationRawDigest(terminalBytes),terminalArtifactName:terminalName,v:COORDINATION_ACK_VERSION};
    }else{
      if(withdrawalMarkers.length!==1)throw new LedgerCorruption("creator-withdrawal cleanup stage lacks its predecessor marker");
      const marker=withdrawalMarkers[0],parsed=marker.parsed;if(parsed.kind!=="creator-withdrawal")throw new LedgerCorruption("invalid creator-withdrawal predecessor");
      const references=acks.filter(value=>value.parsed.kind==="coordination-ack"&&value.ack?.purpose==="slot-retired"&&value.ack.disposition==="withdrawn"&&value.ack.terminalArtifactName===parsed.name&&sameCoordinationOwner(value.ack.owner,marker.owner));
      if(references.length!==1)throw new LedgerCorruption("creator-withdrawal cleanup stage lacks its exact final slot acknowledgment");
      const reference=references[0],referenceAck=reference.ack!,slotMarkerName=String(referenceAck.markerName);if(byName.has(slotMarkerName)||parseK1Name(slotMarkerName)?.kind!=="admission-slot-retired"||referenceAck.terminalArtifactDigest!==coordinationRawDigest(marker.ownerBytes))throw new LedgerCorruption("creator-withdrawal stage predecessor chain is not monotonic");
      expected={directoryIdentity:encodeCoordinationIdentityWire(marker.entry.identity),kind:"creator-withdrawal",markerName:parsed.name,originalName:buildPublicationName(marker.owner,parsed.ticket),owner:marker.owner,ownerBytesDigest:coordinationRawDigest(marker.ownerBytes),ownerBytesLength:String(marker.ownerBytes.length),ownerDigest:coordinationCanonicalDigest(marker.owner),ownerIdentity:marker.state==="empty"?null:encodeCoordinationIdentityWire(marker.ownerIdentity),purpose:"creator-withdrawal",recoveryAuthority:"exact-slot-retirement-ack",slotRetirementAckDigest:coordinationCanonicalDigest(referenceAck),slotRetirementAckName:reference.parsed.name,state:parsed.state,v:COORDINATION_ACK_VERSION};
    }
    const expectedBytes=coordinationCanonicalBytes(expected),actualBytes=stage.entry.bytes!;
    if(coordinationRawDigest(expectedBytes).slice(7)!==stage.parsed.digest||actualBytes.length>expectedBytes.length||!expectedBytes.subarray(0,actualBytes.length).equals(actualBytes))throw new LedgerCorruption("cleanup stage is not its canonical predecessor-bound prefix");
  }

  private classifyHybridOrphanFinalGeneration(byName:Map<string,HybridEntrySnapshot>,owned:readonly HybridOwnedArtifact[],retired:Map<string,Readonly<{owner:CoordinationOwner;entry:HybridEntrySnapshot;disposition:RetirementDisposition}>>,activeOwner:CoordinationOwner|null,publicationCount:number,acks:readonly HybridAckArtifact[]):HybridGuardDecision|null{
    const finals=acks.filter(value=>value.parsed.kind==="coordination-ack"&&value.ack!==null),orphans=finals.filter(value=>!byName.has(String(value.ack!.markerName)));
    if(orphans.length===0)return null;
    if(orphans.length!==1||publicationCount!==0)throw new LedgerCorruption("K1 generation contains multiple or mixed orphan-final lineages");
    const orphan=orphans[0],ack=orphan.ack!;
    if(ack.purpose==="prep-retired"){
      if(acks.length!==1||owned.length!==0||activeOwner!==null||retired.size!==0)throw new LedgerCorruption("orphan prep-retired final has unrelated generation residue");
      return "busy";
    }
    if(ack.purpose==="creator-withdrawal"){
      if(acks.length!==1||owned.length!==0||activeOwner!==null||retired.size!==0)throw new LedgerCorruption("orphan creator-withdrawal final has unrelated generation residue");
      return "busy";
    }
    if(ack.purpose!=="slot-retired")throw new LedgerCorruption("unknown orphan-final lineage");
    if(ack.disposition==="published"){
      if(acks.length!==1||owned.length!==0)throw new LedgerCorruption("orphan published-slot final has unrelated K1 residue");
      const successor=this.classifyHybridPublishedSuccessor({owner:ack.owner},byName,activeOwner,retired);
      if(ack.terminalArtifactName!==successor.name||ack.terminalArtifactDigest!==coordinationRawDigest(successor.bytes))throw new LedgerCorruption("orphan published-slot final does not bind its unique successor");
      return "busy";
    }
    if(ack.disposition==="abandoned"){
      if(acks.length!==1||owned.length!==0||activeOwner!==null||retired.size!==0||processLiveness(ack.owner.pid)!=="dead")throw new LedgerCorruption("orphan abandoned-slot final lacks an isolated dead-owner lineage");
      return "busy";
    }
    if(ack.disposition!=="withdrawn"||activeOwner!==null)throw new LedgerCorruption("invalid orphan slot-final disposition lineage");
    const withdrawals=owned.filter(value=>value.parsed.kind==="creator-withdrawal"),otherOwned=owned.filter(value=>value.parsed.kind!=="creator-withdrawal"),aborted=[...retired.values()].filter(value=>value.disposition==="publication-aborted");
    if(otherOwned.length||withdrawals.length+retired.size!==1||withdrawals.length+aborted.length!==1)throw new LedgerCorruption("orphan withdrawn-slot final requires one exact terminal lineage");
    const terminal=withdrawals.length?{name:withdrawals[0].parsed.name,entry:withdrawals[0].entry,owner:withdrawals[0].owner}:{name:aborted[0].entry.name,entry:aborted[0].entry,owner:aborted[0].owner};
    const child=hybridOwnerChild(terminal.entry);if(child?.bytes===undefined||!sameCoordinationOwner(terminal.owner,ack.owner)||ack.terminalArtifactName!==terminal.name||ack.terminalArtifactDigest!==coordinationRawDigest(child.bytes))throw new LedgerCorruption("orphan withdrawn-slot final terminal proof mismatch");
    const creatorLifecycle=acks.filter(value=>(value.parsed.kind==="coordination-stage"?value.parsed.purpose:value.ack?.purpose)==="creator-withdrawal");
    if(withdrawals.length===0&&acks.length!==1||withdrawals.length===1&&(acks.length<1||acks.length>2||acks.length===2&&creatorLifecycle.length!==1))throw new LedgerCorruption("orphan withdrawn-slot lineage has incoherent cleanup lifecycle");
    return "busy";
  }

  private classifyHybridPublishedSuccessor(marker:Readonly<{owner:CoordinationOwner}>,byName:Map<string,HybridEntrySnapshot>,activeOwner:CoordinationOwner|null,retired:Map<string,Readonly<{owner:CoordinationOwner;entry:HybridEntrySnapshot;disposition:RetirementDisposition}>>):Readonly<{name:string;entry:HybridEntrySnapshot;bytes:Buffer}>{
    const candidates:Array<Readonly<{name:string;entry:HybridEntrySnapshot;owner:CoordinationOwner}>>=[],active=byName.get("lock");
    if(active!==undefined){if(activeOwner===null)throw new LedgerCorruption("published slot active successor is unclassified");candidates.push({name:"lock",entry:active,owner:activeOwner});}
    for(const item of retired.values())candidates.push({name:item.entry.name,entry:item.entry,owner:item.owner});
    if(candidates.length!==1||!sameCoordinationOwner(candidates[0].owner,marker.owner))throw new LedgerCorruption("published slot requires exactly one same-owner successor");
    const child=hybridOwnerChild(candidates[0].entry);if(child?.bytes===undefined)throw new LedgerCorruption("published slot successor has no exact owner bytes");
    return {name:candidates[0].name,entry:candidates[0].entry,bytes:child.bytes};
  }

  private async inspectActiveLock(deadline:number):Promise<"absent"|"retry"|"wait"|Extract<LockResult,{ok:false}>>{
    const directory=this.absolute("lock");let directoryStat;
    try{directoryStat=await lstat(directory,{bigint:true});}catch(error){if(hasCode(error,"ENOENT"))return "absent";if(isSnapshotSharingError(error)){if(monotonicNow()<deadline)return "retry";throw new CoordinationExhausted("acquisition","transient-sharing");}throw error;}
    try{
      if(directoryStat.isSymbolicLink()||!directoryStat.isDirectory())throw new LedgerCorruption("invalid active lock directory");
      const initialDirectoryIdentity=fileIdentity(directoryStat);this.fault("after-active-lock-metadata");this.fault("before-active-lock-content-read");
      const entries=await readdir(directory,{withFileTypes:true});if(entries.length!==1||entries[0].name!=="owner.json"||entries[0].isSymbolicLink()||!entries[0].isFile())throw new LedgerCorruption("invalid active lock contents");
      const target=path.join(directory,"owner.json"),info=await lstat(target,{bigint:true});if(info.isSymbolicLink()||!info.isFile()||info.nlink!==1n)throw new LedgerCorruption("invalid active lock owner object");
      const bytes=await readFile(target);let existing:LockOwner;try{existing=parseCanonical(bytes) as LockOwner;assertLockOwner(existing);}catch{throw new LedgerCorruption("invalid active lock owner");}
      const finalDirectory=await lstat(directory,{bigint:true}),finalOwner=await lstat(target,{bigint:true});if(!sameFileIdentity(initialDirectoryIdentity,fileIdentity(finalDirectory))||!sameFileIdentity(fileIdentity(info),fileIdentity(finalOwner)))return "retry";
      if(existing.host!==hostname())return {ok:false,reason:"lock-owner-unverifiable"};const liveness=processLiveness(existing.pid);if(liveness==="unverifiable")return {ok:false,reason:"lock-owner-unverifiable"};if(liveness==="alive")return "wait";
      if(!await this.retireOwnedLock(existing,"recovery-pending",deadline,false))return "wait";return "absent";
    }catch(error){if(hasCode(error,"ENOENT"))return "retry";if(isSnapshotSharingError(error)){if(monotonicNow()<deadline)return "retry";throw new CoordinationExhausted("acquisition","transient-sharing");}throw error;}
  }

  private async validatePublicationStage(name:string):Promise<PublicationStage>{
    this.fault("before-publication-stage-validation");
    const match=PUBLICATION_STAGE.exec(name);if(!match)throw new LedgerCorruption("invalid publication stage name");const ticket=BigInt(`0x${match[2]}`),pid=Number(match[3]);if(ticket===0n||!Number.isSafeInteger(pid)||pid<=0||match[1]!==this.hostDigest(hostname()))throw new LedgerCorruption("invalid publication stage provenance");
    const directory=this.absolute(name),directoryStat=await lstat(directory,{bigint:true});if(directoryStat.isSymbolicLink()||!directoryStat.isDirectory())throw new LedgerCorruption("invalid publication stage directory");const entries=await readdir(directory,{withFileTypes:true});
    const directoryIdentity=fileIdentity(directoryStat);
    if(entries.length===0)return {name,directory,directoryIdentity,hostDigest:match[1],ticket,pid,nonce:match[4],state:"empty"};if(entries.length!==1||entries[0].name!=="owner.json"||entries[0].isSymbolicLink()||!entries[0].isFile())throw new LedgerCorruption("invalid publication stage contents");
    const ownerPath=path.join(directory,"owner.json"),ownerStat=await lstat(ownerPath,{bigint:true});if(ownerStat.isSymbolicLink()||!ownerStat.isFile()||ownerStat.nlink!==1n)throw new LedgerCorruption("invalid publication stage owner object");const ownerBytes=await readFile(ownerPath),ownerIdentity=fileIdentity(ownerStat);if(ownerBytes.length===0)return {name,directory,directoryIdentity,hostDigest:match[1],ticket,pid,nonce:match[4],state:"zero",ownerIdentity,ownerBytes};
    const expectedOwner:LockOwner={host:hostname(),nonce:match[4],pid,v:1},expectedBytes=canonicalBytes(expectedOwner);
    if(ownerBytes.length<expectedBytes.length&&expectedBytes.subarray(0,ownerBytes.length).equals(ownerBytes))return {name,directory,directoryIdentity,hostDigest:match[1],ticket,pid,nonce:match[4],state:"partial",ownerIdentity,ownerBytes};
    if(!ownerBytes.equals(expectedBytes))throw new LedgerCorruption("invalid publication owner bytes");
    return {name,directory,directoryIdentity,hostDigest:match[1],ticket,pid,nonce:match[4],state:"complete",ownerIdentity,ownerBytes,owner:expectedOwner};
  }

  private settlePublicationStages(deadline:number,activeOwner:boolean,ownedStage:PublicationStage|null,requireDeadCleanup:boolean,yieldCanonicalMembershipChurn:true):Promise<PublicationStage[]|PublicationCanonicalMembershipChurn>;
  private settlePublicationStages(deadline:number,activeOwner:boolean,ownedStage?:PublicationStage|null,requireDeadCleanup?:boolean,yieldCanonicalMembershipChurn?:false):Promise<PublicationStage[]>;
  private async settlePublicationStages(deadline:number,activeOwner:boolean,ownedStage:PublicationStage|null=null,requireDeadCleanup=false,yieldCanonicalMembershipChurn=false):Promise<PublicationStage[]|PublicationCanonicalMembershipChurn>{
    const phase=activeOwner?"housekeeping" as const:"acquisition" as const,state:PublicationSettlementState={removalAuthorizations:new Map<string,PublicationStage>(),removalDisappearances:new Map<string,"sync-pending"|"synced">(),rootSyncPending:false,generationInvalidated:false};
    for(;;){
      let retry:PublicationRetry="retry";
      try{
        if(state.rootSyncPending){
          await this.syncDirectory(this.root);
          state.rootSyncPending=false;
          for(const [name,phase] of state.removalDisappearances)if(phase==="sync-pending")state.removalDisappearances.set(name,"synced");
          this.fault("after-publication-stage-cleanup-root-sync");
        }
        const result=await this.servicePublicationGeneration(state,activeOwner,ownedStage,requireDeadCleanup,yieldCanonicalMembershipChurn);
        if(Array.isArray(result))return result;
        if(typeof result==="object")return result;
        retry=result;
        if(state.rootSyncPending)continue;
      }catch(error){
        if(!this.shouldRetrySnapshot(error,deadline,phase))throw error;
        state.generationInvalidated=true;
      }
      if(monotonicNow()>=deadline){if(retry==="integrity-replacement")throw new LedgerCorruption("publication stage replacement did not stabilize");throw new CoordinationExhausted(phase,"snapshot-churn");}
      await delay(5);
    }
  }

  private async servicePublicationGeneration(state:PublicationSettlementState,activeOwner:boolean,ownedStage:PublicationStage|null,requireDeadCleanup:boolean,yieldCanonicalMembershipChurn:boolean):Promise<PublicationStage[]|PublicationRetry|PublicationCanonicalMembershipChurn>{
    if(await this.captureAuthorizedPublicationDisappearances(state))return "retry";
    const names=await this.publicationStageNames();
    this.fault("after-publication-stage-enumeration");
    this.assertNoTombstonedPublicationNames(state,names);
    const stages:PublicationStage[]=[];
    const identities=new Set<string>();
    for(const name of names){
      const stage=await this.validatePublicationStage(name);
      const identity=`${stage.hostDigest}:${stage.pid}`;
      if(identities.has(identity))throw new LedgerCorruption("ambiguous publication stages");
      identities.add(identity);
      stages.push(stage);
    }
    const initialLiveness=stages.map(stage=>processLiveness(stage.pid));
    if(initialLiveness.some(value=>value==="unverifiable"))throw new LedgerCorruption("unverifiable publication stage owner");
    this.fault("before-publication-stage-root-reenumeration");
    const closedNames=await this.publicationStageNames();
    this.assertNoTombstonedPublicationNames(state,closedNames);
    if(!sameStrings(names,closedNames))return this.publicationMembershipChanged(state,activeOwner,ownedStage,yieldCanonicalMembershipChurn,stages,initialLiveness,names,closedNames);
    if(stages.length>0)this.fault("after-lock-publication-generation-closed");
    const finalNames=await this.publicationStageNames();
    this.assertNoTombstonedPublicationNames(state,finalNames);
    if(!sameStrings(closedNames,finalNames))return this.publicationMembershipChanged(state,activeOwner,ownedStage,yieldCanonicalMembershipChurn,stages,initialLiveness,closedNames,finalNames);
    const finalStages:PublicationStage[]=[];
    for(let index=0;index<stages.length;index++){
      const stage=stages[index];
      const current=await this.validatePublicationStage(stage.name);
      if(!samePublicationStage(stage,current)){
        if(ownedStage?.name===stage.name)throw new LedgerCorruption("publication stage changed after generation closure");
        if(initialLiveness[index]==="dead"&&isAuthorizedPublicationRemovalProgress(stage,current)){state.generationInvalidated=true;return "retry";}
        if(activeOwner&&!isPublicationStageProgress(stage,current))throw new LedgerCorruption("publication stage changed after generation closure");
        state.generationInvalidated=true;
        return isPublicationStageProgress(stage,current)?"retry":"integrity-replacement";
      }
      finalStages.push(current);
    }
    const finalLiveness=finalStages.map(stage=>processLiveness(stage.pid));
    if(finalLiveness.some(value=>value==="unverifiable"))throw new LedgerCorruption("unverifiable publication stage owner");
    const deadStages=finalStages.filter((_,index)=>finalLiveness[index]==="dead");
    if(!requireDeadCleanup&&!yieldCanonicalMembershipChurn&&state.generationInvalidated&&deadStages.length>0&&deadStages.length<finalStages.length)return this.completePublicationGeneration(state,finalStages);
    const removedNames:string[]=[];
    for(const deadStage of deadStages){
      const expectedNames=finalStages.filter(stage=>!removedNames.includes(stage.name)).map(stage=>stage.name);
      this.fault("before-publication-stage-root-reenumeration");
      const removalNames=await this.publicationStageNames();
      this.assertNoTombstonedPublicationNames(state,removalNames);
      if(!sameStrings(expectedNames,removalNames))return "retry";
      if(state.removalDisappearances.has(deadStage.name))throw new LedgerCorruption("disappeared publication stage cannot reuse cleanup authority");
      const removal=await this.removeDeadPublicationStage(deadStage,state.removalAuthorizations);
      if(removal==="removed"){
        state.removalDisappearances.set(deadStage.name,"sync-pending");
        state.rootSyncPending=true;
        removedNames.push(deadStage.name);
        continue;
      }
      if(removal==="live")return this.completePublicationGeneration(state,finalStages);
      return removal;
    }
    if(removedNames.length>0)return "retry";
    return this.completePublicationGeneration(state,finalStages);
  }

  private assertNoTombstonedPublicationNames(state:PublicationSettlementState,names:readonly string[]):void{
    for(const name of state.removalDisappearances.keys())if(names.includes(name))throw new LedgerCorruption("publication stage reappeared before cleanup generation closure");
  }

  private completePublicationGeneration(state:PublicationSettlementState,stages:PublicationStage[]):PublicationStage[]|PublicationRetry{
    if(state.rootSyncPending||[...state.removalDisappearances.values()].some(phase=>phase==="sync-pending"))return "retry";
    for(const [name,phase] of state.removalDisappearances)if(phase==="synced"){
      state.removalDisappearances.delete(name);
      state.removalAuthorizations.delete(name);
    }
    return stages;
  }

  private publicationMembershipChanged(state:PublicationSettlementState,activeOwner:boolean,ownedStage:PublicationStage|null,yieldCanonicalMembershipChurn:boolean,previousStages:readonly PublicationStage[],initialLiveness:readonly ("alive"|"dead"|"unverifiable")[],_previous:readonly string[],current:readonly string[]):"retry"|PublicationCanonicalMembershipChurn{
    const pristine=!state.generationInvalidated&&!state.rootSyncPending&&state.removalAuthorizations.size===0&&state.removalDisappearances.size===0;
    const ordered=ownedStage===null?null:this.parseProvisionalPublicationNames(current,ownedStage.name);
    if(yieldCanonicalMembershipChurn&&!activeOwner&&ownedStage!==null&&pristine&&initialLiveness.every(value=>value==="alive")&&ordered!==null){
      const ownIndex=ordered.findIndex(item=>item.name===ownedStage.name);
      const predecessor=ownIndex>0?previousStages.find(stage=>stage.name===ordered[ownIndex-1].name)??null:null;
      return {kind:"canonical-membership-churn",predecessor};
    }
    state.generationInvalidated=true;
    return "retry";
  }

  private async captureAuthorizedPublicationDisappearances(state:PublicationSettlementState):Promise<boolean>{
    let disappeared=false;
    for(const [name,authorized] of state.removalAuthorizations){
      if(state.removalDisappearances.has(name))continue;
      try{
        await lstat(authorized.directory,{bigint:true});
      }
      catch(error){
        if(!hasCode(error,"ENOENT"))throw error;
        if(!state.removalDisappearances.has(name)){
          state.removalDisappearances.set(name,"sync-pending");
          state.rootSyncPending=true;
          disappeared=true;
        }
      }
    }
    return disappeared;
  }

  private async pollPublicationPredecessor(expected:PublicationStage):Promise<"live"|"reselect">{
    this.fault("before-lock-publication-predecessor-validation");
    let current:PublicationStage;
    try{current=await this.validatePublicationStage(expected.name);}catch(error){if(hasCode(error,"ENOENT"))return "reselect";throw error;}
    if(!samePublicationStage(expected,current))return "reselect";
    return processLiveness(current.pid)==="alive"?"live":"reselect";
  }

  private async removeDeadPublicationStage(stage:PublicationStage,removalAuthorizations:Map<string,PublicationStage>):Promise<"removed"|"live"|PublicationRetry>{
    this.fault("before-publication-stage-final-validation");
    const current=await this.validatePublicationStage(stage.name);
    const authorized=removalAuthorizations.get(stage.name);
    if(authorized!==undefined&&!samePublicationStage(authorized,current)){
      if(isAuthorizedPublicationRemovalProgress(authorized,current))return "retry";
      throw new LedgerCorruption("publication stage replaced during cleanup retry");
    }
    if(!samePublicationStage(stage,current))return isPublicationStageProgress(stage,current)?"retry":"integrity-replacement";
    removalAuthorizations.set(stage.name,current);
    this.fault("before-publication-stage-final-liveness");
    const liveness=processLiveness(stage.pid);
    if(liveness==="alive")return "live";
    if(liveness==="unverifiable")throw new LedgerCorruption("publication stage owner became unverifiable");
    this.fault("before-publication-stage-remove-attempt");
    await rm(stage.directory,{recursive:true});
    return "removed";
  }

  private async finishCreatorPublicationStage(name:string,expected:PublicationStage|null,result:LockResult):Promise<LockResult>{
    if(expected===null)return result;
    const cleanupDeadline=monotonicNow()+this.options.lockTimeoutMs;
    let retryDelayMs=5,removalAttempted=false,syncPending=false;
    const cleanupBackoff=async()=>{const remaining=cleanupDeadline-monotonicNow();if(remaining<=0)return;await delay(Math.min(retryDelayMs,remaining));retryDelayMs=Math.min(50,retryDelayMs*2);};
    for(;;){
      try{
        if(syncPending){
          await this.syncDirectory(this.root);
          this.fault("after-publication-stage-cleanup-root-sync");
          return result;
        }
        this.fault("before-creator-stage-withdrawal-validation");
        let current:PublicationStage;
        try{current=await this.validatePublicationStage(name);}
        catch(error){if(hasCode(error,"ENOENT")){syncPending=true;continue;}throw error;}
        const exact=samePublicationStage(expected,current);
        const authorizedProgress=removalAttempted&&isAuthorizedCreatorPublicationRemovalProgress(expected,current);
        if(!exact&&!authorizedProgress)return result.ok||result.reason!=="corruption"?{ok:false,reason:"corruption"}:result;
        removalAttempted=true;
        this.fault("before-publication-stage-remove-attempt");
        try{await rm(current.directory,{recursive:true});syncPending=true;continue;}
        catch(error){if(hasCode(error,"ENOENT")){syncPending=true;continue;}throw error;}
      }catch(error){
        if(!isSnapshotSharingError(error))return result.ok||result.reason!=="corruption"?{ok:false,reason:"corruption"}:result;
        if(monotonicNow()>=cleanupDeadline)return result;
        await cleanupBackoff();
      }
    }
  }

  private async publicationStageNames():Promise<string[]>{
    const names=await this.rawPublicationStageNames();
    for(const name of names)if(!PUBLICATION_STAGE.test(name))throw new LedgerCorruption("invalid publication stage name");
    return names;
  }

  private async rawPublicationStageNames():Promise<string[]>{return (await readdir(this.root)).filter(name=>name.startsWith(".authority-ledger-lock-publication-")).sort();}

  private shouldRetrySnapshot(error:unknown,deadline:number,phase:"acquisition"|"housekeeping"):boolean{
    if(!hasCode(error,"ENOENT")&&!isSnapshotSharingError(error))return false;
    if(monotonicNow()<deadline)return true;
    throw new CoordinationExhausted(phase,hasCode(error,"ENOENT")?"snapshot-churn":"transient-sharing");
  }

  private async writeAll(handle:FileHandle,bytes:Buffer,position:number):Promise<void>{
    let offset=0;
    while(offset<bytes.length){
      const remaining=bytes.length-offset;
      const result=await handle.write(bytes,offset,remaining,position+offset);
      if(!Number.isSafeInteger(result.bytesWritten)||result.bytesWritten<=0||result.bytesWritten>remaining)throw new LedgerCorruption("invalid publication write progress");
      offset+=result.bytesWritten;
    }
  }

  private async assertPublicationStageUnchanged(expected:PublicationStage):Promise<PublicationStage>{
    const current=await this.validatePublicationStage(expected.name);
    if(!samePublicationStage(expected,current))throw new LedgerCorruption("publication stage changed");
    return current;
  }

  private async validatePublishedOwner(owner:LockOwner):Promise<OwnedOwnerSnapshot>{
    const directory=this.absolute("lock"),directoryStat=await lstat(directory,{bigint:true});
    if(directoryStat.isSymbolicLink()||!directoryStat.isDirectory())throw new LedgerCorruption("invalid published lock directory");
    const entries=await readdir(directory,{withFileTypes:true});
    if(entries.length!==1||entries[0].name!=="owner.json"||entries[0].isSymbolicLink()||!entries[0].isFile())throw new LedgerCorruption("invalid published lock contents");
    const ownerPath=path.join(directory,"owner.json"),ownerStat=await lstat(ownerPath,{bigint:true});
    if(ownerStat.isSymbolicLink()||!ownerStat.isFile()||ownerStat.nlink!==1n)throw new LedgerCorruption("invalid published owner object");
    const ownerBytes=await readFile(ownerPath);
    if(!ownerBytes.equals(canonicalBytes(owner)))throw new LedgerCorruption("published owner changed");
    return {directoryIdentity:fileIdentity(directoryStat),ownerIdentity:fileIdentity(ownerStat),ownerBytes};
  }

  private assertPublishedSnapshotUnchanged(expected:OwnedOwnerSnapshot,current:OwnedOwnerSnapshot):void{
    if(!sameFileIdentity(expected.directoryIdentity,current.directoryIdentity)||!sameFileIdentity(expected.ownerIdentity,current.ownerIdentity)||!expected.ownerBytes.equals(current.ownerBytes))throw new LedgerCorruption("published owner changed");
  }

  private async releaseLock(owner: LockOwner): Promise<void> {
    const deadline = monotonicNow() + this.options.lockTimeoutMs;
    try { await this.retireOwnedLock(owner, "released", deadline, true); }
    catch { /* A crash/corrupt owner must remain for the next fail-closed acquisition. */ }
  }

  private retiredLockName(owner: LockOwner,disposition:RetirementDisposition): string {
    return `.authority-ledger-lock-${owner.pid}-${owner.nonce}.${disposition}`;
  }

  private async retireOwnedLock(owner: LockOwner, disposition:RetirementDisposition, deadline: number, injectFaults: boolean): Promise<boolean> {
    const expected = canonicalBytes(owner);
    let current: Buffer;
    try { current = await readFile(this.absolute(path.join("lock", "owner.json"))); }
    catch (error) { if (hasCode(error, "ENOENT")) return false; throw error; }
    if (!current.equals(expected)) return false;
    if (injectFaults) this.fault("before-lock-retire");
    const retiredName = this.retiredLockName(owner,disposition);
    const retiredDirectory = this.absolute(retiredName);
    for (;;) {
      try { await rename(this.absolute("lock"), retiredDirectory); break; }
      catch (error) {
        if (hasCode(error, "ENOENT")) return false;
        if (isTransientLockError(error) && monotonicNow() < deadline) { await delay(5); continue; }
        throw error;
      }
    }
    if (injectFaults) this.fault("after-lock-retire");
    await this.syncDirectory(this.root);
    const retired = await this.validateRetiredLock(retiredName);
    if (!retired.ownerBytes.equals(expected)) throw new LedgerCorruption("retired lock owner changed");
    return true;
  }

  private async validateRetiredLock(name: string): Promise<RetiredLock> {
    const match = RETIRED_LOCK.exec(name);
    if (!match) throw new LedgerCorruption("invalid retired lock name");
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new LedgerCorruption("invalid retired lock pid");
    const directory = this.absolute(name);
    const directoryStat = await lstat(directory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new LedgerCorruption("invalid retired lock directory");
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length === 0) throw new LedgerCorruption("incomplete retirement marker");
    if (entries.length !== 1 || entries[0].name !== "owner.json" || entries[0].isSymbolicLink() || !entries[0].isFile()) throw new LedgerCorruption("invalid retired lock contents");
    const ownerPath=path.join(directory,"owner.json"),ownerStat=await lstat(ownerPath);
    if(ownerStat.isSymbolicLink()||!ownerStat.isFile()||ownerStat.nlink!==1)throw new LedgerCorruption("invalid retired lock owner object");
    const ownerBytes = await readFile(ownerPath);
    const owner = parseCanonical(ownerBytes) as LockOwner;
    assertLockOwner(owner);
    if (owner.host !== hostname() || owner.pid !== pid || owner.nonce !== match[2]) throw new LedgerCorruption("retired lock owner mismatch");
    return { name,directory,disposition:match[3] as RetirementDisposition,owner,ownerBytes };
  }

  private cleanupAck(marker:RetiredLock,journalHead:string|null):CleanupAck{const owner={host:marker.owner.host,nonce:marker.owner.nonce,pid:marker.owner.pid,v:1 as const};return {disposition:marker.disposition,journalHead,markerName:marker.name,owner,ownerDigest:authorityDigest(owner),v:"reelier.authority-ledger-lock-cleanup-ack/v1"};}
  private cleanupAckName(ack:CleanupAck):string{return `.authority-ledger-lock-cleanup-${authorityDigest(ack).slice(7)}.ack`;}
  private cleanupStageName(marker:RetiredLock,ack:CleanupAck):string{return `.authority-ledger-lock-cleanup-stage-${marker.owner.pid}-${marker.owner.nonce}-${authorityDigest(ack).slice(7)}.tmp`;}

  private async serviceRetirementArtifacts(deadline:number):Promise<RetiredLock[]>{
    let names=await readdir(this.root);
    const prefixed=()=>names.filter(name=>name.startsWith(".authority-ledger-lock-"));
    for(const name of prefixed())if(!RETIRED_LOCK.test(name)&&!CLEANUP_ACK.test(name)&&!CLEANUP_STAGE.test(name)&&!PUBLICATION_STAGE.test(name))throw new LedgerCorruption("invalid ledger lock artifact name");

    const acknowledged=new Map<string,string>();
    for(const name of names.filter(name=>CLEANUP_ACK.test(name))){const ack=await this.readCleanupAck(name);if(acknowledged.has(ack.markerName))throw new LedgerCorruption("duplicate cleanup acknowledgment");acknowledged.set(ack.markerName,name);await this.finishAcknowledgedCleanup(name,ack,deadline);}

    names=await readdir(this.root);
    const stages=names.filter(name=>CLEANUP_STAGE.test(name));
    const stageOwners=new Set<string>();
    for(const name of stages){
      const match=CLEANUP_STAGE.exec(name)!;const key=`${match[1]}:${match[2]}`;if(stageOwners.has(key))throw new LedgerCorruption("duplicate cleanup stage");stageOwners.add(key);
      const stagePath=this.absolute(name),stageStat=await lstat(stagePath);if(stageStat.isSymbolicLink()||!stageStat.isFile()||stageStat.nlink!==1)throw new LedgerCorruption("invalid cleanup stage object");
      const markerNames=names.filter(candidate=>{const marker=RETIRED_LOCK.exec(candidate);return marker?.[1]===match[1]&&marker[2]===match[2];});if(markerNames.length!==1)throw new LedgerCorruption("cleanup stage has no unique marker");
      const marker=await this.validateRetiredLock(markerNames[0]);const journalHead=await this.cleanupJournalHead(marker.disposition),ack=this.cleanupAck(marker,journalHead);if(authorityDigest(ack).slice(7)!==match[3])throw new LedgerCorruption("cleanup stage digest mismatch");
      await unlink(stagePath);await this.syncDirectory(this.root);await this.acknowledgeAndCleanup(marker,journalHead,deadline);
    }

    names=await readdir(this.root);
    const pending:RetiredLock[]=[];
    for(const name of names){if(!name.startsWith(".authority-ledger-lock-")||PUBLICATION_STAGE.test(name))continue;if(CLEANUP_ACK.test(name)||CLEANUP_STAGE.test(name))throw new LedgerCorruption("unresolved cleanup artifact");if(!RETIRED_LOCK.test(name))throw new LedgerCorruption("invalid retirement marker");const marker=await this.validateRetiredLock(name);if(marker.disposition==="recovery-pending")pending.push(marker);else await this.acknowledgeAndCleanup(marker,null,deadline);}
    return pending;
  }

  private async cleanupJournalHead(disposition:RetirementDisposition):Promise<string|null>{if(disposition!=="recovery-pending")return null;const view=await this.loadView();return view.eventDigests.at(-1)??null;}

  private async readCleanupAck(name:string):Promise<CleanupAck>{
    const match=CLEANUP_ACK.exec(name);if(!match)throw new LedgerCorruption("invalid cleanup acknowledgment name");const target=this.absolute(name),info=await lstat(target);if(info.isSymbolicLink()||!info.isFile()||info.nlink!==1)throw new LedgerCorruption("invalid cleanup acknowledgment object");const ack=parseCanonical(await readFile(target)) as CleanupAck;assertCleanupAck(ack);if(authorityDigest(ack).slice(7)!==match[1])throw new LedgerCorruption("cleanup acknowledgment digest mismatch");const marker=RETIRED_LOCK.exec(ack.markerName);if(!marker||marker[3]!==ack.disposition||Number(marker[1])!==ack.owner.pid||marker[2]!==ack.owner.nonce)throw new LedgerCorruption("cleanup acknowledgment marker mismatch");if(ack.owner.host!==hostname()||authorityDigest(ack.owner)!==ack.ownerDigest)throw new LedgerCorruption("cleanup acknowledgment owner mismatch");const expectedHead=await this.cleanupJournalHead(ack.disposition);if(ack.journalHead!==expectedHead)throw new LedgerCorruption("cleanup acknowledgment journal head mismatch");return ack;
  }

  private async finishAcknowledgedCleanup(ackName:string,ack:CleanupAck,deadline:number):Promise<void>{
    const markerPath=this.absolute(ack.markerName);let markerExists=true;try{const info=await lstat(markerPath);if(info.isSymbolicLink()||!info.isDirectory())throw new LedgerCorruption("invalid acknowledged marker object");const entries=await readdir(markerPath,{withFileTypes:true});if(entries.length===1&&entries[0].name==="owner.json"&&entries[0].isFile()&&!entries[0].isSymbolicLink()){const marker=await this.validateRetiredLock(ack.markerName);if(authorityDigest(marker.owner)!==ack.ownerDigest||!marker.ownerBytes.equals(canonicalBytes(ack.owner))||marker.disposition!==ack.disposition)throw new LedgerCorruption("cleanup acknowledgment owner mismatch");}else if(entries.length!==0)throw new LedgerCorruption("invalid partial acknowledged marker");}catch(error){if(hasCode(error,"ENOENT"))markerExists=false;else throw error;}
    if(markerExists)await this.removeWithRetry(markerPath,deadline,true);await this.syncDirectory(this.root);await this.unlinkWithRetry(this.absolute(ackName),deadline);await this.syncDirectory(this.root);
  }

  private async acknowledgeAndCleanup(marker:RetiredLock,journalHead:string|null,deadline:number):Promise<void>{
    const ack=this.cleanupAck(marker,journalHead),ackName=this.cleanupAckName(ack),stageName=this.cleanupStageName(marker,ack),stagePath=this.absolute(stageName),ackPath=this.absolute(ackName);let handle;
    try{handle=await open(stagePath,"wx",0o600);await handle.writeFile(canonicalBytes(ack));await handle.sync();}finally{if(handle)await handle.close();}
    for(;;){try{await rename(stagePath,ackPath);break;}catch(error){if(isTransientLockError(error)&&monotonicNow()<deadline){await delay(5);continue;}throw error;}}
    await this.syncDirectory(this.root);await this.finishAcknowledgedCleanup(ackName,ack,deadline);
  }

  private async removeWithRetry(target:string,deadline:number,recursive:boolean):Promise<void>{for(;;){try{await rm(target,{recursive});return;}catch(error){if(hasCode(error,"ENOENT"))return;if(isTransientLockError(error)&&monotonicNow()<deadline){await delay(5);continue;}throw error;}}}
  private async unlinkWithRetry(target:string,deadline:number):Promise<void>{for(;;){try{await unlink(target);return;}catch(error){if(hasCode(error,"ENOENT"))return;if(isTransientLockError(error)&&monotonicNow()<deadline){await delay(5);continue;}throw error;}}}

  private async prepare(reclaimed: boolean, makeDispatchedAmbiguous: boolean, context: OperationContext): Promise<LedgerView> {
    await this.ensureLayout();
    await this.assertNoLinks();
    await this.verifyIngressDirectory();
    let view = await this.loadView();
    view = await this.recoverTransactions(view, context);
    if (reclaimed || makeDispatchedAmbiguous) {
      for (const reservation of [...view.reservations.values()]) {
        if (reservation.state !== "dispatched") continue;
        if (view.highWaterMark === null) throw new LedgerCorruption("dispatched reservation has no durable clock");
        const transition = await this.appendEvent(view, { type: "transition", reservationId: reservation.reservationId, from: "dispatched", to: "ambiguous", at: view.highWaterMark }, "result") as TransitionJournalEvent;
        view = await this.loadView();
        if (!view.reservations.has(transition.reservationId)) throw new LedgerCorruption("lost recovered reservation");
      }
    }
    return view;
  }

  private async verifyIngressDirectory():Promise<void>{const names=await readdir(this.absolute("ingress"));for(const name of names){const match=INGRESS_FILE.exec(name);if(!match)throw new LedgerCorruption("invalid ingress filename");await this.readIngress(`sha256:${match[1]}`);}}

  private async ensureLayout(): Promise<void> {
    for (const directory of ["transactions", "claims", "journal", "tombstones", "ingress"]) await mkdir(this.absolute(directory), { recursive: true });
  }

  private async assertNoLinks(): Promise<void> {
    const allowedRoot = new Set(["transactions", "claims", "journal", "tombstones", "ingress", "decisions", "lock"]);
    const volatileRead=async<T>(operation:()=>Promise<T>):Promise<T|undefined>=>{const deadline=monotonicNow()+1_000;for(;;){try{return await operation();}catch(error){if(hasCode(error,"ENOENT"))return undefined;if(process.platform!=="win32"||!(hasCode(error,"EPERM")||hasCode(error,"EACCES")||hasCode(error,"EBUSY"))||monotonicNow()>=deadline)throw error;await delay(2);}}};
    const walk = async (directory: string, root = false, volatile = false): Promise<void> => {
      const entries=volatile?await volatileRead(()=>readdir(directory,{withFileTypes:true})):await readdir(directory,{withFileTypes:true});if(!entries)return;
      for (const entry of entries) {
        if (entry.isSymbolicLink()) throw new LedgerCorruption("symlink or reparse point below ledger root");
        const rootDirectoryArtifact=root&&(RETIRED_LOCK.test(entry.name)||PUBLICATION_STAGE.test(entry.name));
        const rootFileArtifact=root&&(CLEANUP_ACK.test(entry.name)||CLEANUP_STAGE.test(entry.name));
        if(root&&!allowedRoot.has(entry.name)&&!rootDirectoryArtifact&&!rootFileArtifact)throw new LedgerCorruption("unexpected ledger root entry");
        const full = path.join(directory, entry.name);
        const childVolatile=volatile||(root&&entry.name==="decisions")||(root&&PUBLICATION_STAGE.test(entry.name));
        const actual=childVolatile?await volatileRead(()=>lstat(full)):await lstat(full);if(!actual)continue;
        if(actual.isSymbolicLink())throw new LedgerCorruption("symlink or reparse point below ledger root");
        if(rootFileArtifact&&(!actual.isFile()||actual.nlink!==1))throw new LedgerCorruption("invalid root artifact object");
        if((rootDirectoryArtifact||root&&allowedRoot.has(entry.name))&&!actual.isDirectory())throw new LedgerCorruption("invalid ledger directory object");
        if(actual.isDirectory())await walk(full,false,childVolatile);
        else if(!actual.isFile()||actual.nlink!==1)throw new LedgerCorruption("unexpected filesystem object");
      }
    };
    await walk(this.root, true);
  }

  private async persistClock(view: LedgerView, now: number, context: OperationContext): Promise<LedgerView> {
    if(view.highWaterMark!==null){const high=parseIso(view.highWaterMark);if(now<high)throw new LedgerCorruption("clock high-water rollback");if(now===high)return view;}
    this.fault(`${context}-before-clock-high-water-write` as LedgerFaultPoint);
    await this.appendEvent(view, { type: "clock", observedAt: new Date(now).toISOString() }, context);
    this.fault(`${context}-after-clock-high-water-write` as LedgerFaultPoint);
    return this.loadView();
  }

  private async recoverTransactions(view: LedgerView, context: OperationContext): Promise<LedgerView> {
    const names = await readdir(this.absolute("transactions"));
    if (names.some(name => !FILE_HEX.test(name))) throw new LedgerCorruption("invalid transaction filename");
    const transactions = new Map<string, TransactionRecord>();
    for (const name of names) transactions.set(`sha256:${name}`, await this.readTransaction(name));
    const tombstones = await readdir(this.absolute("tombstones"));
    if (tombstones.some(name => !FILE_HEX.test(name) || !transactions.has(`sha256:${name}`))) throw new LedgerCorruption("invalid or ownerless tombstone");
    for (const name of tombstones) {
      const resolution = await this.readTombstone(name);
      if(view.committedTransactions.has(`sha256:${name}`))throw new LedgerCorruption("committed transaction has tombstone");
      if (resolution?.kind === "existing" && !view.reservations.has(resolution.reservationId)) throw new LedgerCorruption("duplicate resolution points to missing reservation");
    }
    for (const reservation of view.reservations.values()) {
      const transaction = transactions.get(reservation.reservationId);
      if (!transaction || !canonicalBytes(transaction.intent).equals(canonicalBytes(reservation.intent))) throw new LedgerCorruption("committed transaction intent missing or mismatched");
      await this.verifyIngressIntent(reservation.intent);
    }
    for (const name of names.sort()) {
      const transactionDigest = `sha256:${name}`;
      await this.verifyIngressIntent(transactions.get(transactionDigest)!.intent);
      if (view.committedTransactions.has(transactionDigest) || await this.readTombstone(name)) continue;
      await this.commitTransaction(transactionDigest, transactions.get(transactionDigest)!, view, context);
      view = await this.loadView();
    }
    await this.verifyClaims(view, new Set(transactions.keys()));
    return view;
  }

  private async commitTransaction(transactionDigest: string, transaction: TransactionRecord, view: LedgerView, context: OperationContext): Promise<ReserveResult & ({ ok: true } | { ok: false })> {
    const intent = transaction.intent;
    const reservations = [...view.reservations.values()];
    const ingress = reservations.find(value => value.intent.tenant === intent.tenant && value.intent.requester === intent.requester && value.intent.requestId === intent.requestId);
    if (ingress) {
      if (ingress.intent.definitionAlias === intent.definitionAlias && ingress.intent.canonicalRequestBase64 === intent.canonicalRequestBase64 && ingress.intent.canonicalRequestDigest === intent.canonicalRequestDigest) {
        await this.resolveExisting(transactionDigest, ingress.reservationId);
        return frozen({ ok: true, status: "existing", dispatchEligible: false, reservation: detachReservation(ingress) });
      }
      return this.abort(transactionDigest, "idempotency-conflict");
    }
    if (reservations.some(value => value.intent.tenant === intent.tenant && value.intent.outcomeKey === intent.outcomeKey)) return this.abort(transactionDigest, "semantic-duplicate");
    const capability = reservations.find(value => value.intent.capabilityId === intent.capabilityId);
    if (capability) {
      const reason: ReserveReason = capability.intent.capabilityDigest === intent.capabilityDigest && capability.intent.capabilityBase64 === intent.capabilityBase64
        ? "capability-already-reserved" : "capability-integrity";
      return this.abort(transactionDigest, reason);
    }
    const assignments: { key: string; index: number; maximum: number }[] = [];
    for (const slot of intent.limitSlots) {
      const existingAssignments = reservations.flatMap(value => value.limitAssignments.filter(item => item.key === slot.key));
      const committedMaximum = existingAssignments.reduce((minimum, item) => Math.min(minimum, item.maximum), slot.maximum);
      const occupied = new Set(existingAssignments.map(item => item.index));
      const index = Array.from({ length: committedMaximum }, (_, value) => value).find(value => !occupied.has(value));
      if (index === undefined) return this.abort(transactionDigest, "limit-exceeded");
      assignments.push({ key: slot.key, index, maximum: slot.maximum });
    }

    const descriptors: ClaimDescriptor[] = [
      { kind: "ingress", key: canonicalKey([intent.tenant, intent.requester, intent.requestId]) },
      { kind: "outcome", key: canonicalKey([intent.tenant, intent.outcomeKey]) },
      { kind: "capability", key: canonicalKey([intent.capabilityId]) },
      ...assignments.map(value => ({ kind: "limit" as const, key: value.key, index: value.index })),
    ];
    descriptors.sort((left, right) => claimOrder(left).localeCompare(claimOrder(right)));
    for (const descriptor of descriptors) {
      this.fault("reservation-before-claim-acquisition");
      const claim: ClaimRecord = { v: "reelier.authority-ledger-claim/v1", descriptor, transactionDigest };
      const claimName = claimDigest(descriptor);
      const created = await this.writeImmutable(path.join("claims", claimName), claim, "reservation");
      if (!created) {
        const existing = await this.readClaim(claimName);
        if (existing.transactionDigest !== transactionDigest) throw new LedgerCorruption("claim unexpectedly owned by another transaction");
      }
      this.fault("reservation-after-claim-acquisition");
    }
    this.fault("reservation-before-commit-marker");
    const nextSequence = view.events.length + 1;
    const reservation: ReservationSnapshot = frozen({
      reservationId: transactionDigest,
      state: "reserved",
      intent,
      limitAssignments: Object.freeze(assignments.map(value => frozen({ ...value }))),
      sequence: nextSequence,
      updatedAt: view.highWaterMark ?? (() => { throw new LedgerCorruption("reservation commit has no durable clock"); })(),
    });
    await this.appendEvent(view, { type: "reserve", transactionDigest, reservation }, "reservation");
    this.fault("reservation-after-commit-marker");
    return frozen({ ok: true, status: "reserved", dispatchEligible: false, reservation: detachReservation(reservation) });
  }

  private async abort(transactionDigest: string, reason: ReserveReason): Promise<Readonly<{ ok: false; reason: ReserveReason }>> {
    const transactionHex = transactionDigest.slice(7);
    await this.writeImmutable(path.join("tombstones", transactionHex), { v: "reelier.authority-ledger-tombstone/v1", transactionDigest, reason }, "reservation");
    for (const name of await readdir(this.absolute("claims"))) {
      const claim = await this.readClaim(name);
      if (claim.transactionDigest !== transactionDigest) continue;
      await unlink(this.absolute(path.join("claims", name)));
    }
    await this.syncDirectory(this.absolute("claims"));
    return frozen({ ok: false, reason });
  }

  private async resolveExisting(transactionDigest: string, reservationId: string): Promise<void> {
    const transactionHex = transactionDigest.slice(7);
    await this.writeImmutable(path.join("tombstones", transactionHex), { v: "reelier.authority-ledger-tombstone/v1", transactionDigest, resolution: "existing", reservationId }, "reservation");
    for (const name of await readdir(this.absolute("claims"))) {
      const claim = await this.readClaim(name);
      if (claim.transactionDigest === transactionDigest) await unlink(this.absolute(path.join("claims", name)));
    }
    await this.syncDirectory(this.absolute("claims"));
  }

  private async readTombstone(transactionHex: string): Promise<TombstoneResolution | undefined> {
    try {
      const value = parseCanonical(await readFile(this.absolute(path.join("tombstones", transactionHex)))) as Record<string, unknown>;
      if (!value || typeof value !== "object") throw new LedgerCorruption("invalid tombstone");
      if (value.v !== "reelier.authority-ledger-tombstone/v1" || value.transactionDigest !== `sha256:${transactionHex}`) throw new LedgerCorruption("invalid tombstone");
      if (value.resolution === "existing") {
        assertExactKeys(value, ["reservationId", "resolution", "transactionDigest", "v"]);
        if (typeof value.reservationId !== "string" || !SHA.test(value.reservationId)) throw new LedgerCorruption("invalid duplicate resolution");
        return frozen({ kind: "existing", reservationId: value.reservationId });
      }
      assertExactKeys(value, ["reason", "transactionDigest", "v"]);
      if (!TOMBSTONE_REASONS.has(value.reason as ReserveReason)) throw new LedgerCorruption("invalid tombstone");
      return frozen({ kind: "refused", reason: value.reason as ReserveReason });
    } catch (error) {
      if (hasCode(error, "ENOENT")) return undefined;
      throw error;
    }
  }

  private async readTransaction(name: string): Promise<TransactionRecord> {
    const bytes = await readFile(this.absolute(path.join("transactions", name)));
    if (rawDigest(bytes) !== `sha256:${name}`) throw new LedgerCorruption("transaction filename digest mismatch");
    const value = parseCanonical(bytes) as TransactionRecord;
    if (!value || typeof value !== "object") throw new LedgerCorruption("invalid transaction");
    assertExactKeys(value, ["intent", "v"]);
    if (value.v !== "reelier.authority-ledger-transaction/v4") throw new LedgerCorruption("invalid transaction version");
    const normalized = normalizeStoredIntent(value.intent);
    if (!canonicalBytes(normalized).equals(canonicalBytes(value.intent))) throw new LedgerCorruption("transaction intent is not closed");
    return value;
  }

  private async readIngress(requestKey:string):Promise<IngressRecord>{
    if(!SHA.test(requestKey)||requestKey===ZERO_SHA)throw new LedgerCorruption("invalid ingress request key");
    const name=`${requestKey.slice(7)}.json`;const bytes=await readFile(this.absolute(path.join("ingress",name)));const value=parseCanonical(bytes) as IngressRecord;
    assertExactKeys(value,["canonicalRequestBase64","definitionAlias","requestDigest","requestId","requestKey","requester","tenant","v"]);
    if(value.v!=="reelier.authority-ingress-claim/internal-v1"||value.requestKey!==requestKey)throw new LedgerCorruption("ingress filename or key mismatch");
    normalizeIngressRecord(value);return value;
  }

  private async verifyIngressIntent(intent:StoredReservationIntent):Promise<void>{
    let ingress:IngressRecord;try{ingress=await this.readIngress(intent.requestKey);}catch(error){if(hasCode(error,"ENOENT"))throw new LedgerCorruption("reservation ingress claim missing");throw error;}
    if(authorityDigest(ingress)!==intent.ingressClaimDigest||ingress.tenant!==intent.tenant||ingress.requester!==intent.requester||ingress.requestId!==intent.requestId||ingress.definitionAlias!==intent.definitionAlias||ingress.requestDigest!==intent.requestDigest||ingress.canonicalRequestBase64!==intent.canonicalRequestBase64)throw new LedgerCorruption("reservation ingress linkage mismatch");
  }

  private async verifyClaims(view: LedgerView, transactions: Set<string>): Promise<void> {
    const names = await readdir(this.absolute("claims"));
    if (names.some(name => !FILE_HEX.test(name))) throw new LedgerCorruption("invalid claim filename");
    for (const name of names) {
      const claim = await this.readClaim(name);
      if (!transactions.has(claim.transactionDigest)) throw new LedgerCorruption("claim owner transaction missing");
      if (!view.committedTransactions.has(claim.transactionDigest)) throw new LedgerCorruption("uncommitted claim remained after recovery");
    }
    for (const reservation of view.reservations.values()) {
      const expected: ClaimDescriptor[] = [
        { kind: "ingress", key: canonicalKey([reservation.intent.tenant, reservation.intent.requester, reservation.intent.requestId]) },
        { kind: "outcome", key: canonicalKey([reservation.intent.tenant, reservation.intent.outcomeKey]) },
        { kind: "capability", key: canonicalKey([reservation.intent.capabilityId]) },
        ...reservation.limitAssignments.map(value => ({ kind: "limit" as const, key: value.key, index: value.index })),
      ];
      for (const descriptor of expected) {
        let claim: ClaimRecord;
        try { claim = await this.readClaim(claimDigest(descriptor)); }
        catch (error) { if (hasCode(error, "ENOENT")) throw new LedgerCorruption("committed reservation claim missing"); throw error; }
        if (claim.transactionDigest !== reservation.reservationId) throw new LedgerCorruption("committed reservation claim owner mismatch");
      }
    }
  }

  private async readClaim(name: string): Promise<ClaimRecord> {
    if (!FILE_HEX.test(name)) throw new LedgerCorruption("invalid claim filename");
    const claim = parseCanonical(await readFile(this.absolute(path.join("claims", name)))) as ClaimRecord;
    assertExactKeys(claim, ["descriptor", "transactionDigest", "v"]);
    assertClaimDescriptor(claim.descriptor);
    if (claim.v !== "reelier.authority-ledger-claim/v1" || !SHA.test(claim.transactionDigest) || claimDigest(claim.descriptor) !== name) throw new LedgerCorruption("claim filename or content mismatch");
    return claim;
  }

  private async loadView(): Promise<LedgerView> {
    const names = await readdir(this.absolute("journal"));
    const parsedNames = names.map(name => {
      const match = JOURNAL_FILE.exec(name);
      if (!match) throw new LedgerCorruption("invalid journal filename");
      return { name, sequence: Number(match[1]), digest: `sha256:${match[2]}` };
    }).sort((a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name));
    const events: JournalEvent[] = [];
    const eventDigests: string[] = [];
    const reservations = new Map<string, ReservationSnapshot>();
    const committedTransactions = new Set<string>();
    let highWaterMark: string | null = null;
    for (let index = 0; index < parsedNames.length; index++) {
      const named = parsedNames[index];
      if (named.sequence !== index + 1) throw new LedgerCorruption("journal gap or duplicate sequence");
      const bytes = await readFile(this.absolute(path.join("journal", named.name)));
      if (rawDigest(bytes) !== named.digest) throw new LedgerCorruption("journal filename digest mismatch");
      const event = parseCanonical(bytes) as JournalEvent;
      assertJournalEvent(event);
      if (event.v !== "reelier.authority-ledger-event/v1" || event.sequence !== named.sequence || event.previousDigest !== (eventDigests.at(-1) ?? null)) throw new LedgerCorruption("journal continuity mismatch");
      if (event.type === "clock") {
        if (!isIso(event.observedAt) || (highWaterMark !== null && parseIso(event.observedAt) < parseIso(highWaterMark))) throw new LedgerCorruption("clock journal rollback");
        highWaterMark = event.observedAt;
      } else if (event.type === "reserve") {
        if (!SHA.test(event.transactionDigest) || committedTransactions.has(event.transactionDigest)) throw new LedgerCorruption("duplicate or invalid transaction commit");
        validateReservation(event.reservation);
        if (event.reservation.reservationId !== event.transactionDigest || event.reservation.sequence !== event.sequence || reservations.has(event.reservation.reservationId) || highWaterMark === null || event.reservation.updatedAt !== highWaterMark) throw new LedgerCorruption("reservation commit mismatch");
        reservations.set(event.reservation.reservationId, detachReservation(event.reservation));
        committedTransactions.add(event.transactionDigest);
      } else if (event.type === "transition") {
        const current = reservations.get(event.reservationId);
        if (
          !current || current.state !== event.from || !LEGAL.has(`${event.from}>${event.to}`) || !isIso(event.at) ||
          highWaterMark === null || event.at !== highWaterMark || parseIso(event.at) < parseIso(current.updatedAt) ||
          !hasValidResultDigest(event.to, event.resultDigest)
        ) throw new LedgerCorruption("illegal journal transition");
        reservations.set(event.reservationId, applyTransition(current, event));
      } else throw new LedgerCorruption("unexpected journal record");
      events.push(event);
      eventDigests.push(named.digest);
    }
    return { events, eventDigests, reservations, committedTransactions, highWaterMark };
  }

  private async appendEvent(view: LedgerView, body: JournalBody, context: OperationContext): Promise<JournalEvent> {
    const event = {
      v: "reelier.authority-ledger-event/v1",
      sequence: view.events.length + 1,
      previousDigest: view.eventDigests.at(-1) ?? null,
      ...body,
    } as JournalEvent;
    const bytes = canonicalBytes(event);
    const digest = rawDigest(bytes);
    const name = `${String(event.sequence).padStart(16, "0")}-${digest.slice(7)}`;
    await this.writeImmutable(path.join("journal", name), event, context);
    return event;
  }

  private async writeImmutable(relative: string, value: unknown, context: OperationContext): Promise<boolean> {
    const target = this.absolute(relative);
    const parent = path.dirname(target);
    const bytes = canonicalBytes(value);
    this.fault(`${context}-before-create` as LedgerFaultPoint);
    let handle;
    try {
      handle = await open(target, "wx", 0o600);
    } catch (error) {
      if (hasCode(error, "EEXIST")) {
        const existing = await readFile(target);
        if (!existing.equals(bytes)) throw new LedgerCorruption("immutable record collision");
        return false;
      }
      throw error;
    }
    try {
      this.fault(`${context}-after-create` as LedgerFaultPoint);
      this.fault(`${context}-before-write` as LedgerFaultPoint);
      await handle.writeFile(bytes);
      this.fault(`${context}-after-write` as LedgerFaultPoint);
      this.fault(`${context}-before-file-sync` as LedgerFaultPoint);
      await handle.sync();
      this.fault(`${context}-after-file-sync` as LedgerFaultPoint);
      this.fault(`${context}-before-close` as LedgerFaultPoint);
    } finally {
      await handle.close();
    }
    this.fault(`${context}-after-close` as LedgerFaultPoint);
    this.fault(`${context}-before-directory-sync` as LedgerFaultPoint);
    await this.syncDirectory(parent);
    this.fault(`${context}-after-directory-sync` as LedgerFaultPoint);
    return true;
  }

  private async syncDirectory(directory: string): Promise<void> {
    if (process.platform === "win32") return;
    const handle = await open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  }

  private absolute(relative: string): string {
    const resolved = path.resolve(this.root, relative);
    if (resolved !== this.root && !resolved.startsWith(`${this.root}${path.sep}`)) throw new LedgerCorruption("ledger path escaped root");
    return resolved;
  }

  private fault(point: LedgerFaultPoint): void { this.options.faultInjector?.(point); }
}

function normalizeAuthenticatedIngress(request:AuthenticatedOutcomeRequest):IngressRecord{
  const state=authenticatedOutcomeRequestState(request);const bytes=Buffer.from(state.canonicalRequestBase64,"base64");if(bytes.toString("base64")!==state.canonicalRequestBase64)throw new TypeError("authenticated request base64 is not canonical");
  const wire=parseCanonicalAuthorityJson("outcome-request",bytes.toString("utf8"));const requestDigest=digestOutcomeRequest(wire);const requestKey=deriveAuthorityRequestKey({tenant:state.tenant,requester:state.requester,requestId:wire.requestId});
  if(authorityDigest(state.request)!==requestDigest||state.requestDigest!==requestDigest||state.requestKey!==requestKey||wire.requestId!==state.request.requestId)throw new TypeError("authenticated request state mismatch");
  return normalizeIngressRecord({v:"reelier.authority-ingress-claim/internal-v1",tenant:state.tenant,requester:state.requester,requestId:wire.requestId,definitionAlias:state.definitionAlias,requestDigest,requestKey,canonicalRequestBase64:state.canonicalRequestBase64});
}
function normalizeIngressRecord(value:IngressRecord):IngressRecord{
  if(!value||typeof value!=="object")throw new LedgerCorruption("invalid ingress record");for(const id of [value.tenant,value.requester,value.requestId,value.definitionAlias])if(typeof id!=="string"||!ID.test(id))throw new LedgerCorruption("invalid ingress identity");
  if(!SHA.test(value.requestDigest)||value.requestDigest===ZERO_SHA||!SHA.test(value.requestKey)||value.requestKey===ZERO_SHA||typeof value.canonicalRequestBase64!=="string")throw new LedgerCorruption("invalid ingress digest");const bytes=Buffer.from(value.canonicalRequestBase64,"base64");if(bytes.length===0||bytes.toString("base64")!==value.canonicalRequestBase64)throw new LedgerCorruption("invalid ingress canonical bytes");
  let wire:OutcomeRequest;try{wire=parseCanonicalAuthorityJson("outcome-request",bytes.toString("utf8"));}catch{throw new LedgerCorruption("invalid ingress canonical request");}if(wire.requestId!==value.requestId||digestOutcomeRequest(wire)!==value.requestDigest||deriveAuthorityRequestKey({tenant:value.tenant,requester:value.requester,requestId:value.requestId})!==value.requestKey)throw new LedgerCorruption("invalid ingress tuple linkage");return frozen({...value});
}

function normalizeIntent(input: ReservationIntent): StoredReservationIntent {
  if (!input || typeof input !== "object") throw new TypeError("reservation intent required");
  for (const id of [input.tenant, input.requester, input.definitionAlias, input.requestId, input.capabilityId]) if (typeof id !== "string" || !ID.test(id)) throw new TypeError("invalid reservation identity");
  for (const digest of [input.requestDigest, input.canonicalRequestDigest, input.requestKey, input.ingressClaimDigest,input.decisionContextDigest, input.capabilityDigest, input.contractDigest, input.sourceBundleDigest, input.sourceSnapshotDigest, input.authorityStateDigest, input.limitsDigest, input.outcomeKey, input.effectDigest]) if (typeof digest !== "string" || !SHA.test(digest) || digest === ZERO_SHA) throw new TypeError("invalid reservation digest");
  if (!input.limits) throw new TypeError("sealed limits required");
  const sealed = input as ReservationIntent & Required<Pick<ReservationIntent, "definitionAlias" | "requestDigest" | "contractDigest" | "sourceBundleDigest" | "sourceSnapshotDigest" | "authorityStateDigest" | "limits" | "limitsDigest">>;
  const request = Buffer.from(input.canonicalRequestBytes);
  const capability = Buffer.from(input.capabilityBytes);
  if (request.length === 0 || capability.length === 0) throw new TypeError("canonical bytes must be nonempty");
  if (rawDigest(request) !== input.canonicalRequestDigest || sealed.requestDigest !== input.canonicalRequestDigest || rawDigest(capability) !== input.capabilityDigest) throw new TypeError("canonical byte digest mismatch");
  const requestWire = parseCanonicalAuthorityJson("outcome-request", request.toString("utf8")) as OutcomeRequest;
  const capabilityWire = parseCanonicalAuthorityJson("compiled-capability", capability.toString("utf8")) as CompiledCapability;
  if (requestWire.requestId !== input.requestId) throw new TypeError("request identity does not match canonical request bytes");
  if(digestOutcomeRequest(requestWire)!==input.requestDigest||deriveAuthorityRequestKey({tenant:input.tenant,requester:input.requester,requestId:input.requestId})!==input.requestKey)throw new TypeError("request digest or key mismatch");
  if (
    capabilityWire.tenant !== input.tenant || capabilityWire.requester !== input.requester || capabilityWire.definitionAlias !== sealed.definitionAlias ||
    capabilityWire.requestDigest !== sealed.requestDigest || capabilityWire.capabilityId !== input.capabilityId || capabilityWire.requestKey !== input.requestKey ||
    capabilityWire.contractDigest !== sealed.contractDigest || capabilityWire.sourceBundleDigest !== sealed.sourceBundleDigest ||
    capabilityWire.sourceSnapshotDigest !== sealed.sourceSnapshotDigest || capabilityWire.authorityStateDigest !== sealed.authorityStateDigest ||
    authorityDigest(capabilityWire.limits) !== authorityDigest(sealed.limits) || capabilityWire.limitsDigest !== sealed.limitsDigest ||
    capabilityWire.outcomeKey !== input.outcomeKey || capabilityWire.effectDigest !== input.effectDigest ||
    capabilityWire.issuedAt !== input.issuedAt || capabilityWire.expiresAt !== input.expiresAt
  ) throw new TypeError("capability identity does not match canonical capability bytes");
  const issued = parseIso(input.issuedAt);
  const expires = parseIso(input.expiresAt);
  if (expires - issued !== CAPABILITY_LIFETIME_MS) throw new TypeError("capability lifetime must be exactly 60000ms");
  const expectedLimitsDigest = authorityDigest({ v: "reelier.capability-limits/internal-v1", contractDigest: sealed.contractDigest, limits: sealed.limits });
  if (sealed.limitsDigest !== expectedLimitsDigest || capabilityWire.limitsDigest !== expectedLimitsDigest) throw new TypeError("capability limits commitment mismatch");
  const slots = input.limitSlots.map(slot => {
    if (!SHA.test(slot.key) || !Number.isSafeInteger(slot.maximum) || slot.maximum < 1 || slot.maximum > 1_000_000) throw new TypeError("invalid limit slot");
    return frozen({ kind: slot.kind, key: slot.key, maximum: slot.maximum });
  });
  if (slots.length !== 2 || slots[0].kind !== "contract-window" || slots[1].kind !== "source-trigger" || slots[0].maximum !== sealed.limits.maxEffectsPerWindow || slots[1].maximum !== sealed.limits.maxEffectsPerSourceTrigger || new Set(slots.map(slot => slot.key)).size !== slots.length) throw new TypeError("limit slots must exactly match sealed limits");
  return frozen({
    tenant: input.tenant, requester: input.requester, definitionAlias: sealed.definitionAlias, requestId: input.requestId, requestDigest: sealed.requestDigest,
    canonicalRequestDigest: input.canonicalRequestDigest, canonicalRequestBase64: request.toString("base64"), requestKey: input.requestKey,ingressClaimDigest:input.ingressClaimDigest,decisionContextDigest:input.decisionContextDigest,
    capabilityId: input.capabilityId, capabilityDigest: input.capabilityDigest, capabilityBase64: capability.toString("base64"),
    contractDigest: sealed.contractDigest, sourceBundleDigest: sealed.sourceBundleDigest, sourceSnapshotDigest: sealed.sourceSnapshotDigest,
    authorityStateDigest: sealed.authorityStateDigest, limits: frozen({ ...sealed.limits }), limitsDigest: sealed.limitsDigest,
    outcomeKey: input.outcomeKey, effectDigest: input.effectDigest, issuedAt: input.issuedAt, expiresAt: input.expiresAt,
    limitSlots: Object.freeze(slots),
  });
}

function normalizeStoredIntent(input: StoredReservationIntent): StoredReservationIntent {
  if (!input || typeof input !== "object" || typeof input.canonicalRequestBase64 !== "string" || typeof input.capabilityBase64 !== "string") throw new LedgerCorruption("malformed stored intent");
  assertExactKeys(input, ["authorityStateDigest", "capabilityBase64", "capabilityDigest", "capabilityId", "canonicalRequestBase64", "canonicalRequestDigest", "contractDigest", "decisionContextDigest", "definitionAlias", "effectDigest", "expiresAt", "ingressClaimDigest", "issuedAt", "limitSlots", "limits", "limitsDigest", "outcomeKey", "requestDigest", "requestId", "requestKey", "requester", "sourceBundleDigest", "sourceSnapshotDigest", "tenant"]);
  if (!Array.isArray(input.limitSlots)) throw new LedgerCorruption("malformed stored limit slots");
  for (const slot of input.limitSlots) assertExactKeys(slot, ["key", "kind", "maximum"]);
  const request = Buffer.from(input.canonicalRequestBase64, "base64");
  const capability = Buffer.from(input.capabilityBase64, "base64");
  if (request.toString("base64") !== input.canonicalRequestBase64 || capability.toString("base64") !== input.capabilityBase64) throw new LedgerCorruption("noncanonical stored base64");
  try {
    return normalizeIntent({ ...input, canonicalRequestBytes: request, capabilityBytes: capability });
  } catch { throw new LedgerCorruption("invalid stored intent"); }
}

function validateReservation(value: ReservationSnapshot): void {
  if (!value || !SHA.test(value.reservationId) || value.state !== "reserved" || !Number.isSafeInteger(value.sequence) || !isIso(value.updatedAt)) throw new LedgerCorruption("invalid reservation snapshot");
  assertExactKeys(value, ["intent", "limitAssignments", "reservationId", "sequence", "state", "updatedAt"]);
  normalizeStoredIntent(value.intent);
  if (!Array.isArray(value.limitAssignments) || value.limitAssignments.length !== value.intent.limitSlots.length) throw new LedgerCorruption("invalid limit assignments");
  for (let index = 0; index < value.limitAssignments.length; index++) {
    const assignment = value.limitAssignments[index];
    const slot = value.intent.limitSlots[index];
    assertExactKeys(assignment, ["index", "key", "maximum"]);
    if (
      !SHA.test(assignment.key) || assignment.key !== slot.key || assignment.maximum !== slot.maximum ||
      !Number.isSafeInteger(assignment.index) || assignment.index < 0 || assignment.index >= assignment.maximum
    ) throw new LedgerCorruption("invalid limit assignment");
  }
}

function assertClaimDescriptor(value: ClaimDescriptor): void {
  if (!value || typeof value !== "object" || !["ingress", "outcome", "capability", "limit"].includes(value.kind) || !SHA.test(value.key)) throw new LedgerCorruption("invalid claim descriptor");
  assertExactKeys(value, value.kind === "limit" ? ["index", "key", "kind"] : ["key", "kind"]);
  if (value.kind === "limit" && (!Number.isSafeInteger(value.index) || value.index! < 0)) throw new LedgerCorruption("invalid limit claim index");
}

function assertJournalEvent(event: JournalEvent): void {
  if (!event || typeof event !== "object" || !Number.isSafeInteger(event.sequence) || event.sequence < 1 || (event.previousDigest !== null && !SHA.test(event.previousDigest))) throw new LedgerCorruption("malformed journal event");
  if (event.type === "clock") {
    assertExactKeys(event, ["observedAt", "previousDigest", "sequence", "type", "v"]);
    if (!isIso(event.observedAt)) throw new LedgerCorruption("invalid clock event");
  } else if (event.type === "reserve") {
    assertExactKeys(event, ["previousDigest", "reservation", "sequence", "transactionDigest", "type", "v"]);
    if (!SHA.test(event.transactionDigest)) throw new LedgerCorruption("invalid reservation event transaction");
  } else if (event.type === "transition") {
    assertExactKeys(event, event.resultDigest === undefined
      ? ["at", "from", "previousDigest", "reservationId", "sequence", "to", "type", "v"]
      : ["at", "from", "previousDigest", "reservationId", "resultDigest", "sequence", "to", "type", "v"]);
    if (!SHA.test(event.reservationId) || !isIso(event.at) || !hasValidResultDigest(event.to, event.resultDigest)) throw new LedgerCorruption("invalid transition event identity");
  }
  else throw new LedgerCorruption("unexpected journal event type");
}

function assertExactKeys(value: object, expected: readonly string[]): void {
  if (Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")) throw new LedgerCorruption("record contains missing or unexpected fields");
}

function applyTransition(current: ReservationSnapshot, event: TransitionJournalEvent): ReservationSnapshot {
  return frozen({
    ...current,
    state: event.to,
    sequence: event.sequence,
    updatedAt: event.at,
    ...(event.resultDigest === undefined ? {} : { resultDigest: event.resultDigest }),
  });
}

function clockValidity(intent: StoredReservationIntent, now: number, highWater: string | null): "not-yet-valid" | "expired" | "clock-rollback" | undefined {
  if (highWater !== null && now < parseIso(highWater)) return "clock-rollback";
  if (now < parseIso(intent.issuedAt)) return "not-yet-valid";
  if (now >= parseIso(intent.expiresAt)) return "expired";
  return undefined;
}

function claimDigest(descriptor: ClaimDescriptor): string { return rawDigest(canonicalBytes({ v: "reelier.authority-ledger-claim-key/v1", ...descriptor })).slice(7); }
function claimOrder(descriptor: ClaimDescriptor): string {
  const rank = { ingress: "0", outcome: "1", capability: "2", limit: "3" }[descriptor.kind];
  return `${rank}-${descriptor.key}-${String(descriptor.index ?? 0).padStart(8, "0")}`;
}
function canonicalKey(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) { const bytes = Buffer.from(part, "utf8"); hash.update(`${bytes.length}:`, "ascii"); hash.update(bytes); }
  return `sha256:${hash.digest("hex")}`;
}
function canonicalBytes(value: unknown): Buffer {
  const encoded = canonicalize(value);
  if (encoded === undefined) throw new LedgerCorruption("record is not canonicalizable");
  return Buffer.from(encoded, "utf8");
}
function parseCanonical(bytes: Uint8Array): unknown {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw new LedgerCorruption("malformed or truncated JSON"); }
  if (!canonicalBytes(value).equals(Buffer.from(bytes))) throw new LedgerCorruption("noncanonical JSON bytes");
  return value;
}
function rawDigest(bytes: Uint8Array): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function parseIso(value: string): number {
  if (!isIso(value)) throw new LedgerCorruption("invalid canonical instant");
  return Date.parse(value);
}
function isIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function isTransitionEventInput(value: unknown): value is TransitionEvent {
  if (!value || typeof value !== "object" || !("to" in value) || typeof value.to !== "string") return false;
  const resultDigest = "resultDigest" in value ? value.resultDigest : undefined;
  if (!hasValidResultDigest(value.to, resultDigest)) return false;
  const expectedKeys = resultDigest === undefined ? ["to"] : ["resultDigest", "to"];
  return Object.keys(value).sort().join("\0") === expectedKeys.join("\0");
}
function hasValidResultDigest(to: unknown, resultDigest: unknown): boolean {
  if (to === "dispatched" || to === "ambiguous") return resultDigest === undefined;
  if (to === "acknowledged" || to === "definitive-failure" || to === "reconciled") {
    return typeof resultDigest === "string" && SHA.test(resultDigest) && resultDigest !== ZERO_SHA;
  }
  return false;
}
function assertLockOwner(value: LockOwner): void {
  if (!value || value.v !== 1 || typeof value.host !== "string" || value.host.length === 0 || !Number.isSafeInteger(value.pid) || value.pid <= 0 || !/^[0-9a-f]{64}$/.test(value.nonce) || Object.keys(value).sort().join(",") !== "host,nonce,pid,v") throw new LedgerCorruption("invalid lock owner");
}
function assertCleanupAck(value:CleanupAck):void{if(!value||value.v!=="reelier.authority-ledger-lock-cleanup-ack/v1"||!(["released","recovery-pending","publication-aborted"] as unknown[]).includes(value.disposition)||typeof value.markerName!=="string"||!SHA.test(value.ownerDigest)||value.ownerDigest===ZERO_SHA||(value.journalHead!==null&&(!SHA.test(value.journalHead)||value.journalHead===ZERO_SHA))||Object.keys(value).sort().join(",")!=="disposition,journalHead,markerName,owner,ownerDigest,v")throw new LedgerCorruption("invalid cleanup acknowledgment");assertLockOwner(value.owner);}
function mintUnboundPrepCreatorAttemptToken():PrepCreatorAttemptToken{
  const token=Object.freeze({}) as PrepCreatorAttemptToken;
  prepAttemptRuntimeBindings.set(token,prepAttemptRuntimeIdentity);
  return token;
}
function deriveStablePrepHousekeepingRoute(snapshot:HybridRootSnapshot,decision:HybridGuardDecision,token:PrepCreatorAttemptToken):PrepHousekeepingRoute{
  if(decision!=="busy")return {kind:"silent"};
  const parsed=snapshot.names.map(parseK1Name).filter((value):value is ParsedK1Name=>value!==null);
  const descriptor=describeStablePrepAuthority(snapshot,decision);
  if(descriptor?.kind==="dead-prep"){
    if(processLiveness(descriptor.pid)!=="dead")return {kind:"silent"};
    if(prepAttemptRuntimeBindings.get(token)!==prepAttemptRuntimeIdentity)return {kind:"silent"};
    const retirementAuthority=Object.freeze({}) as PrepRetirementAuthority;
    prepRetirementAuthorityBindings.set(retirementAuthority,{snapshot,descriptor});
    return {kind:"dead-prep",token,retirementAuthority};
  }
  if(descriptor?.kind==="prep-retired-cleanup"){
    const cleanupAuthority=Object.freeze({}) as PrepRetiredCleanupAuthority;
    prepRetiredCleanupAuthorityBindings.set(cleanupAuthority,{snapshot,descriptor});
    return {kind:"retired-prep",cleanupAuthority};
  }
  return parsed.some(value=>value.kind==="admission-slot"||value.kind==="creator-withdrawal")?{kind:"no-authority"}:{kind:"silent"};
}
function describeStablePrepAuthority(snapshot:HybridRootSnapshot,decision:HybridGuardDecision):PrepAuthorityDescriptor|null{
  if(decision!=="busy")return null;
  const parsed=snapshot.names.map(parseK1Name).filter((value):value is ParsedK1Name=>value!==null),localDigest=coordinationHostDigest(hostname());
  const prep=parsed.find((value):value is Extract<ParsedK1Name,{kind:"admission-prep"}>=>value.kind==="admission-prep");
  if(prep!==undefined&&prep.hostDigest===localDigest)return {kind:"dead-prep",targetName:prep.name,pid:prep.pid};
  const marker=parsed.find((value):value is Extract<ParsedK1Name,{kind:"admission-prep-retired"}>=>value.kind==="admission-prep-retired");
  if(marker!==undefined){
    const lifecycle=parsed.find(value=>value.kind==="coordination-stage"&&value.purpose==="prep-retired"||value.kind==="coordination-ack"&&prepCleanupAck(snapshot,value)?.purpose==="prep-retired");
    return {kind:"prep-retired-cleanup",targetName:marker.name,lifecycleName:lifecycle?.name??null,orphan:false};
  }
  for(const value of parsed){
    if(value.kind!=="coordination-ack")continue;
    const ack=prepCleanupAck(snapshot,value);if(ack?.purpose!=="prep-retired")continue;
    const markerName=String(ack.markerName),originalName=String(ack.originalName);
    if(snapshot.names.includes(markerName)||snapshot.names.includes(originalName))continue;
    return {kind:"prep-retired-cleanup",targetName:markerName,lifecycleName:value.name,orphan:true};
  }
  return null;
}
function prepCleanupAck(snapshot:HybridRootSnapshot,parsed:Extract<ParsedK1Name,{kind:"coordination-ack"}>):CoordinationAck|null{
  const entry=snapshot.entries.find(value=>value.name===parsed.name);if(entry?.kind!=="file"||entry.bytes===undefined)return null;
  try{return parseCoordinationAckBytes(entry.bytes);}catch{return null;}
}
function samePrepAuthorityDescriptor(left:PrepAuthorityDescriptor,right:PrepAuthorityDescriptor):boolean{
  return left.kind===right.kind&&left.targetName===right.targetName&&(left.kind==="dead-prep"&&right.kind==="dead-prep"?left.pid===right.pid:left.kind==="prep-retired-cleanup"&&right.kind==="prep-retired-cleanup"&&left.lifecycleName===right.lifecycleName&&left.orphan===right.orphan);
}
function processLiveness(pid: number): "alive" | "dead" | "unverifiable" {
  try { process.kill(pid, 0); return "alive"; }
  catch (error) {
    if (hasCode(error, "ESRCH")) return "dead";
    if (hasCode(error, "EPERM")) return "unverifiable";
    return "unverifiable";
  }
}
function detachReservation(value: ReservationSnapshot): ReservationSnapshot {
  return frozen(JSON.parse(JSON.stringify(value)) as ReservationSnapshot);
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
function hasCode(error: unknown, code: string): boolean { return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === code); }
function fileIdentity(stat:Readonly<{dev:bigint;ino:bigint;mode:bigint;nlink:bigint}>):FileIdentity{return {dev:stat.dev,ino:stat.ino,mode:stat.mode,nlink:stat.nlink};}
export function __testEncodeCoordinationIdentityWire(raw:Readonly<{dev:bigint;ino:bigint;mode:bigint;nlink:bigint}>):CoordinationIdentityWire{return encodeCoordinationIdentityWire(raw);}
export function __testParseCoordinationIdentityWire(wire:unknown):CoordinationFileIdentity{return parseCoordinationIdentityWire(wire);}
export function __testCoordinationIdentityMatches(wire:CoordinationIdentityWire,raw:Readonly<{dev:bigint;ino:bigint;mode:bigint;nlink:bigint}>):boolean{return coordinationIdentityMatches(wire,raw);}
export function __testSamePublicationFileIdentity(left:Readonly<{dev:bigint;ino:bigint;mode:bigint;nlink:bigint}>,right:Readonly<{dev:bigint;ino:bigint;mode:bigint;nlink:bigint}>):boolean{return left.dev===right.dev&&left.ino===right.ino&&left.mode===right.mode&&left.nlink===right.nlink;}
function sameFileIdentity(left:FileIdentity,right:FileIdentity):boolean{return __testSamePublicationFileIdentity(left,right);}
export function __testSamePublicationStageSnapshot(
  left:Readonly<{name:string;state:string;directoryIdentity:FileIdentity;ownerIdentity?:FileIdentity;ownerBytes?:Buffer}>,
  right:Readonly<{name:string;state:string;directoryIdentity:FileIdentity;ownerIdentity?:FileIdentity;ownerBytes?:Buffer}>,
):boolean{
  return left.name===right.name
    &&left.state===right.state
    &&sameFileIdentity(left.directoryIdentity,right.directoryIdentity)
    &&(left.ownerIdentity===undefined
      ?right.ownerIdentity===undefined
      :right.ownerIdentity!==undefined&&sameFileIdentity(left.ownerIdentity,right.ownerIdentity))
    &&(left.ownerBytes===undefined
      ?right.ownerBytes===undefined
      :right.ownerBytes!==undefined&&left.ownerBytes.equals(right.ownerBytes));
}
function samePublicationStage(left:PublicationStage,right:PublicationStage):boolean{return __testSamePublicationStageSnapshot(left,right);}
function comparePublicationOrder(left:PublicationStage,right:PublicationStage):number{return comparePublicationTuple(left.ticket,String(left.pid),right.ticket,String(right.pid));}
function compareProvisionalPublicationOrder(left:ProvisionalPublicationName,right:ProvisionalPublicationName):number{return comparePublicationTuple(left.ticket,left.pidText,right.ticket,right.pidText);}
function comparePublicationTuple(leftTicket:bigint,leftPidText:string,rightTicket:bigint,rightPidText:string):number{return leftTicket<rightTicket?-1:leftTicket>rightTicket?1:leftPidText<rightPidText?-1:leftPidText>rightPidText?1:0;}
function isAuthorizedPublicationRemovalProgress(left:PublicationStage,right:PublicationStage):boolean{return left.name===right.name&&left.state==="complete"&&left.ownerIdentity!==undefined&&left.ownerBytes!==undefined&&right.state==="empty"&&right.ownerIdentity===undefined&&right.ownerBytes===undefined&&sameFileIdentity(left.directoryIdentity,right.directoryIdentity);}
function isAuthorizedCreatorPublicationRemovalProgress(left:PublicationStage,right:PublicationStage):boolean{return left.name===right.name&&(left.state==="zero"||left.state==="partial"||left.state==="complete")&&left.ownerIdentity!==undefined&&left.ownerBytes!==undefined&&right.state==="empty"&&right.ownerIdentity===undefined&&right.ownerBytes===undefined&&sameFileIdentity(left.directoryIdentity,right.directoryIdentity);}
function isPublicationStageProgress(left:PublicationStage,right:PublicationStage):boolean{
  if(left.name!==right.name||!sameFileIdentity(left.directoryIdentity,right.directoryIdentity))return false;
  if(left.ownerIdentity===undefined)return right.ownerIdentity===undefined||right.ownerBytes!==undefined;
  if(right.ownerIdentity===undefined||!sameFileIdentity(left.ownerIdentity,right.ownerIdentity)||left.ownerBytes===undefined||right.ownerBytes===undefined)return false;
  return left.ownerBytes.length<=right.ownerBytes.length&&right.ownerBytes.subarray(0,left.ownerBytes.length).equals(left.ownerBytes);
}
function sameStrings(left:readonly string[],right:readonly string[]):boolean{return left.length===right.length&&left.every((value,index)=>value===right[index]);}
function hybridKind(info:Readonly<{isSymbolicLink():boolean;isDirectory():boolean;isFile():boolean}>):HybridEntryKind{return info.isSymbolicLink()?"symlink":info.isDirectory()?"directory":info.isFile()?"file":"other";}
function hybridOwnerChild(entry:HybridEntrySnapshot):HybridChildSnapshot|null{return entry.children?.find(child=>child.name==="owner.json")??null;}
function sameCoordinationOwner(left:CoordinationOwner,right:CoordinationOwner):boolean{return left.host===right.host&&left.pid===right.pid&&left.nonce===right.nonce&&left.v===right.v;}
function sameHybridRootSnapshot(left:HybridRootSnapshot,right:HybridRootSnapshot):boolean{
  if(!sameStrings(left.names,right.names)||left.entries.length!==right.entries.length)return false;
  return left.entries.every((entry,index)=>sameHybridEntrySnapshot(entry,right.entries[index]));
}
function sameHybridEntrySnapshot(left:HybridEntrySnapshot,right:HybridEntrySnapshot):boolean{if(left.name!==right.name||left.kind!==right.kind||!sameFileIdentity(left.identity,right.identity)||!sameOptionalBuffer(left.bytes,right.bytes))return false;const children=left.children??[],otherChildren=right.children??[];return children.length===otherChildren.length&&children.every((child,index)=>{const other=otherChildren[index];return child.name===other.name&&child.kind===other.kind&&sameFileIdentity(child.identity,other.identity)&&sameOptionalBuffer(child.bytes,other.bytes);});}
function isStrictBufferPrefix(left:Buffer,right:Buffer):boolean{return left.length<right.length&&right.subarray(0,left.length).equals(left);}
function sameOptionalBuffer(left:Buffer|undefined,right:Buffer|undefined):boolean{return left===undefined?right===undefined:right!==undefined&&left.equals(right);}
function isSnapshotSharingError(error:unknown):boolean{return ["EPERM","EACCES","EBUSY"].some(code=>hasCode(error,code));}
function isTransientLockError(error: unknown): boolean { return ["ENOENT", "EPERM", "EACCES", "EBUSY", "ENOTEMPTY"].some(code => hasCode(error, code)); }
function monotonicNow():number{return Number(process.hrtime.bigint()/1_000_000n);}
function delay(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
function isLockFailure(value: unknown): value is { ok: false; reason: "busy" | "lock-owner-unverifiable" | "corruption" } {
  return Boolean(value && typeof value === "object" && "ok" in value && (value as { ok: unknown }).ok === false);
}
