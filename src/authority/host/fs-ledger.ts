import canonicalize from "canonicalize";
import { createHash, randomBytes } from "node:crypto";
import {
  lstatSync,
  realpathSync,
} from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
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
  "after-lock-publication-stage-create", "after-lock-publication-owner-create",
  "after-lock-publication-owner-partial-write", "after-lock-publication-owner-sync",
  "after-lock-publication-stage-sync", "after-lock-publication-rename", "after-lock-publication-root-sync",
  "after-owner-file-sync", "after-lock-directory-sync", "before-lock-retire", "after-lock-retire",
] as const);
export const ledgerFaultPoints = Object.freeze([...reservationFaultPoints, ...dispatchFaultPoints, ...resultFaultPoints, ...ingressFaultPoints, ...clockFaultPoints, ...ledgerLockFaultPoints]);
export type LedgerFaultPoint = (typeof ledgerFaultPoints)[number];

export interface FsAuthorityLedgerOptions {
  readonly now?: () => number;
  readonly faultInjector?: (point: LedgerFaultPoint) => void;
  readonly lockTimeoutMs?: number;
}

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
interface PublicationStage { readonly name:string;readonly directory:string;readonly hostDigest:string;readonly pid:number;readonly nonce:string;readonly state:"empty"|"zero"|"partial"|"complete";readonly ownerBytes?:Buffer;readonly owner?:LockOwner }
interface CleanupAck { readonly disposition: RetirementDisposition; readonly journalHead: string | null; readonly markerName: string; readonly owner: LockOwner; readonly ownerDigest: string; readonly v: "reelier.authority-ledger-lock-cleanup-ack/v1" }
type TombstoneResolution = Readonly<{ kind: "refused"; reason: ReserveReason }> | Readonly<{ kind: "existing"; reservationId: string }>;
type LockResult = { ok: true; owner: LockOwner; reclaimed: boolean } | { ok: false; reason: "busy" | "lock-owner-unverifiable" | "corruption" };

const SHA = /^sha256:[0-9a-f]{64}$/;
const ZERO_SHA = `sha256:${"0".repeat(64)}`;
const ID = /^[A-Za-z0-9._~-]{1,128}$/;
const FILE_HEX = /^[0-9a-f]{64}$/;
const INGRESS_FILE = /^([0-9a-f]{64})\.json$/;
const RETIRED_LOCK = /^\.authority-ledger-lock-([1-9][0-9]*)-([0-9a-f]{64})\.(released|recovery-pending|publication-aborted)$/;
const PUBLICATION_STAGE = /^\.authority-ledger-lock-publication-([0-9a-f]{64})-([1-9][0-9]*)-([0-9a-f]{64})\.tmp$/;
const CLEANUP_ACK = /^\.authority-ledger-lock-cleanup-([0-9a-f]{64})\.ack$/;
const CLEANUP_STAGE = /^\.authority-ledger-lock-cleanup-stage-([1-9][0-9]*)-([0-9a-f]{64})-([0-9a-f]{64})\.tmp$/;
const JOURNAL_FILE = /^(\d{16})-([0-9a-f]{64})$/;
const LEGAL = new Set(["reserved>dispatched", "dispatched>acknowledged", "dispatched>definitive-failure", "dispatched>ambiguous", "acknowledged>reconciled", "ambiguous>reconciled"]);
const TOMBSTONE_REASONS = new Set<ReserveReason>(["idempotency-conflict", "semantic-duplicate", "capability-integrity", "capability-already-reserved", "limit-exceeded"]);

class LedgerCorruption extends Error {}
class RetiredLockTransient extends Error {}

export class AuthorityLedgerReadError extends Error {
  constructor(readonly code: "busy" | "lock-owner-unverifiable" | "corruption") {
    super(`authority ledger read refused: ${code}`);
  }
}

export class FsAuthorityLedger implements AuthorityLedger {
  readonly root: string;
  readonly options: Required<Pick<FsAuthorityLedgerOptions, "now" | "lockTimeoutMs">> & Pick<FsAuthorityLedgerOptions, "faultInjector">;
  private lockTail:Promise<void>=Promise.resolve();

  constructor(root: string, options: FsAuthorityLedgerOptions = {}) {
    const resolved = path.resolve(root);
    let rootStat;
    try { rootStat = lstatSync(resolved); } catch { throw new TypeError("authority ledger root must be an existing directory"); }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new TypeError("authority ledger root must be a real directory");
    const real = realpathSync.native(resolved);
    if (normalizePath(real) !== normalizePath(resolved)) throw new TypeError("authority ledger root may not traverse a symlink or reparse point");
    this.root = real;
    this.options = { now: options.now ?? Date.now, faultInjector: options.faultInjector, lockTimeoutMs: options.lockTimeoutMs ?? 30_000 };
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
    });
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

  private async withLock<T>(context: OperationContext, operation: (reclaimed: boolean) => Promise<T>): Promise<T | Readonly<{ ok: false; reason: "busy" | "lock-owner-unverifiable" | "corruption" }>> {
    const preceding=this.lockTail;let release!:()=>void;this.lockTail=new Promise<void>(resolve=>{release=resolve;});await preceding;
    try {
      const lock = await this.acquireLock();
      if (!lock.ok) return frozen({ ok: false, reason: lock.reason });
      try {
        await this.assertNoLinks();
        await this.ensureLayout();
        const housekeepingDeadline=monotonicNow()+this.options.lockTimeoutMs;
        await this.servicePublicationStages(housekeepingDeadline,true);
        const pending=await this.serviceRetirementArtifacts(housekeepingDeadline);
        if(pending.length>0){const recovered=await this.prepare(true,false,context);const journalHead=recovered.eventDigests.at(-1)??null;for(const marker of pending)await this.acknowledgeAndCleanup(marker,journalHead,housekeepingDeadline);}
        await this.assertNoLinks();
        if (context === "reservation") this.fault("after-lock-acquire");
        return await operation(false);
      } catch (error) {
        if (error instanceof LedgerCorruption) return frozen({ ok: false, reason: "corruption" });
        throw error;
      } finally {
        await this.releaseLock(lock.owner);
      }
    } finally { release(); }
  }

  private async acquireLock(): Promise<LockResult> {
    const deadline = monotonicNow() + this.options.lockTimeoutMs;
    const owner: LockOwner = { v: 1, host: hostname(), pid: process.pid, nonce: randomBytes(32).toString("hex") };
    const stageName=this.publicationStageName(owner),stagePath=this.absolute(stageName),ownerPath=path.join(stagePath,"owner.json"),ownerBytes=canonicalBytes(owner);
    let stageCreated=false,published=false,expectedStageBytes:Buffer|undefined|null=null;
    while (true) {
      try {
        const active=await this.inspectActiveLock(deadline);
        if(active!=="absent"){
          if(active!=="wait")return active;
          if(monotonicNow()>=deadline){if(stageCreated)await this.removeOwnedPublicationStage(stageName,expectedStageBytes);return {ok:false,reason:"busy"};}
          await delay(5);continue;
        }
        if(!stageCreated){
          const publicationBusy=await this.servicePublicationStages(deadline,false);
          if(publicationBusy){if(monotonicNow()>=deadline)return {ok:false,reason:"busy"};await delay(5);continue;}
          try{await mkdir(stagePath);stageCreated=true;expectedStageBytes=undefined;this.fault("after-lock-publication-stage-create");}
          catch(error){if(hasCode(error,"EEXIST")){continue;}throw error;}
          let handle;
          try{
            handle=await open(ownerPath,"wx",0o600);expectedStageBytes=Buffer.alloc(0);this.fault("after-lock-publication-owner-create");
            await handle.write(ownerBytes.subarray(0,1),0,1,0);expectedStageBytes=ownerBytes.subarray(0,1);this.fault("after-lock-publication-owner-partial-write");
            await handle.write(ownerBytes.subarray(1),0,ownerBytes.length-1,1);expectedStageBytes=ownerBytes;await handle.sync();this.fault("after-lock-publication-owner-sync");this.fault("after-owner-file-sync");
          }finally{if(handle)await handle.close();}
          await this.syncDirectory(stagePath);this.fault("after-lock-publication-stage-sync");this.fault("after-lock-directory-sync");
        }
        try{await rename(stagePath,this.absolute("lock"));published=true;stageCreated=false;this.fault("after-lock-publication-rename");}
        catch(error){if(hasCode(error,"EEXIST")||hasCode(error,"ENOTEMPTY")||isTransientLockError(error)){if(monotonicNow()>=deadline){await this.removeOwnedPublicationStage(stageName,expectedStageBytes);return {ok:false,reason:"busy"};}await delay(5);continue;}throw error;}
        await this.syncDirectory(this.root);
        this.fault("after-lock-publication-root-sync");
        return { ok: true, owner, reclaimed:false };
      } catch (error) {
        if(error instanceof LedgerCorruption){if(stageCreated)try{await this.removeOwnedPublicationStage(stageName,expectedStageBytes);}catch{}return {ok:false,reason:"corruption"};}
        if(stageCreated)try{await this.removeOwnedPublicationStage(stageName,expectedStageBytes);}catch{}
        if(published)try{await this.retireOwnedLock(owner,"publication-aborted",deadline,false);}catch{}
        throw error;
      }
    }
  }

  private publicationStageName(owner:LockOwner):string{return `.authority-ledger-lock-publication-${this.hostDigest(owner.host)}-${owner.pid}-${owner.nonce}.tmp`;}
  private hostDigest(host:string):string{return createHash("sha256").update(host,"utf8").digest("hex");}

  private async inspectActiveLock(deadline:number):Promise<"absent"|"wait"|Extract<LockResult,{ok:false}>>{
    const directory=this.absolute("lock");let directoryStat;
    try{directoryStat=await lstat(directory);}catch(error){if(hasCode(error,"ENOENT"))return "absent";if(isTransientLockError(error)&&monotonicNow()<deadline)return "wait";throw error;}
    if(directoryStat.isSymbolicLink()||!directoryStat.isDirectory())throw new LedgerCorruption("invalid active lock directory");
    const entries=await readdir(directory,{withFileTypes:true});if(entries.length!==1||entries[0].name!=="owner.json"||entries[0].isSymbolicLink()||!entries[0].isFile())throw new LedgerCorruption("invalid active lock contents");
    const target=path.join(directory,"owner.json"),info=await lstat(target);if(info.isSymbolicLink()||!info.isFile()||info.nlink!==1)throw new LedgerCorruption("invalid active lock owner object");
    const bytes=await readFile(target);let existing:LockOwner;try{existing=parseCanonical(bytes) as LockOwner;assertLockOwner(existing);}catch{throw new LedgerCorruption("invalid active lock owner");}
    if(existing.host!==hostname())return {ok:false,reason:"lock-owner-unverifiable"};const liveness=processLiveness(existing.pid);if(liveness==="unverifiable")return {ok:false,reason:"lock-owner-unverifiable"};if(liveness==="alive")return "wait";
    if(!await this.retireOwnedLock(existing,"recovery-pending",deadline,false))return "wait";return "absent";
  }

  private async validatePublicationStage(name:string):Promise<PublicationStage>{
    const match=PUBLICATION_STAGE.exec(name);if(!match)throw new LedgerCorruption("invalid publication stage name");const pid=Number(match[2]);if(!Number.isSafeInteger(pid)||pid<=0||match[1]!==this.hostDigest(hostname()))throw new LedgerCorruption("invalid publication stage provenance");
    const directory=this.absolute(name),directoryStat=await lstat(directory);if(directoryStat.isSymbolicLink()||!directoryStat.isDirectory())throw new LedgerCorruption("invalid publication stage directory");const entries=await readdir(directory,{withFileTypes:true});
    if(entries.length===0)return {name,directory,hostDigest:match[1],pid,nonce:match[3],state:"empty"};if(entries.length!==1||entries[0].name!=="owner.json"||entries[0].isSymbolicLink()||!entries[0].isFile())throw new LedgerCorruption("invalid publication stage contents");
    const ownerPath=path.join(directory,"owner.json"),ownerStat=await lstat(ownerPath);if(ownerStat.isSymbolicLink()||!ownerStat.isFile()||ownerStat.nlink!==1)throw new LedgerCorruption("invalid publication stage owner object");const ownerBytes=await readFile(ownerPath);if(ownerBytes.length===0)return {name,directory,hostDigest:match[1],pid,nonce:match[3],state:"zero",ownerBytes};
    let owner:LockOwner;try{owner=parseCanonical(ownerBytes) as LockOwner;assertLockOwner(owner);}catch{try{JSON.parse(ownerBytes.toString("utf8"));}catch{return {name,directory,hostDigest:match[1],pid,nonce:match[3],state:"partial",ownerBytes};}throw new LedgerCorruption("invalid complete publication owner");}
    if(owner.host!==hostname()||this.hostDigest(owner.host)!==match[1]||owner.pid!==pid||owner.nonce!==match[3])throw new LedgerCorruption("publication stage owner mismatch");return {name,directory,hostDigest:match[1],pid,nonce:match[3],state:"complete",ownerBytes,owner};
  }

  private async servicePublicationStages(deadline:number,activeOwner:boolean):Promise<boolean>{
    const names=(await readdir(this.root)).filter(name=>name.startsWith(".authority-ledger-lock-publication-"));for(const name of names)if(!PUBLICATION_STAGE.test(name))throw new LedgerCorruption("invalid publication stage name");const stages:PublicationStage[]=[];const identities=new Set<string>();
    for(const name of names){const stage=await this.validatePublicationStage(name),identity=`${stage.hostDigest}:${stage.pid}`;if(identities.has(identity))throw new LedgerCorruption("ambiguous publication stages");identities.add(identity);stages.push(stage);}
    let live=false,removed=false;for(const stage of stages){const liveness=processLiveness(stage.pid);if(liveness==="unverifiable")throw new LedgerCorruption("unverifiable publication stage owner");if(liveness==="alive"){live=true;continue;}const current=await this.validatePublicationStage(stage.name);if(current.state!==stage.state||!sameOptionalBytes(current.ownerBytes,stage.ownerBytes))throw new LedgerCorruption("publication stage changed");await this.removeWithRetry(stage.directory,deadline,true);removed=true;}if(removed)await this.syncDirectory(this.root);return !activeOwner&&live;
  }

  private async removeOwnedPublicationStage(name:string,expected:Buffer|undefined|null):Promise<void>{
    if(expected===null)return;let stage:PublicationStage;try{stage=await this.validatePublicationStage(name);}catch(error){if(hasCode(error,"ENOENT"))return;throw error;}if(expected===undefined){if(stage.state!=="empty")return;}else if(!sameOptionalBytes(stage.ownerBytes,expected))return;await rm(stage.directory,{recursive:true});await this.syncDirectory(this.root);
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
function normalizePath(value: string): string { return process.platform === "win32" ? value.toLowerCase() : value; }
function hasCode(error: unknown, code: string): boolean { return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === code); }
function sameOptionalBytes(left:Buffer|undefined,right:Buffer|undefined):boolean{return left===undefined?right===undefined:right!==undefined&&left.equals(right);}
function isTransientLockError(error: unknown): boolean { return ["ENOENT", "EPERM", "EACCES", "ENOTEMPTY"].some(code => hasCode(error, code)); }
function monotonicNow():number{return Number(process.hrtime.bigint()/1_000_000n);}
function delay(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
function isLockFailure(value: unknown): value is { ok: false; reason: "busy" | "lock-owner-unverifiable" | "corruption" } {
  return Boolean(value && typeof value === "object" && "ok" in value && (value as { ok: unknown }).ok === false);
}
