import { authorityDigest } from "../wire.js";
import { hasAcceptedGateReservationHandleRevalidatorV1, revalidateAcceptedGateReservationHandleV1 } from "../gate.js";
import { authoritySignatureDigest } from "../trust.js";
import { verifyAuthoritySignature } from "../crypto.js";
import type { KeyObject } from "node:crypto";
import type { AuthoritySignature } from "../types.js";
import { assertLinuxAuthorityCellHost } from "./platform.js";
import { unwrapReservedDispatchHandle, type ReservedDispatchHandle } from "../gate.js";
import type { AuthorityLedger, LedgerState, StoredReservationIntent } from "../ledger.js";
import { authorizeCoordinatorCommittedLease, authorizeCoordinatorReconciliation, consumePreparedDispatch, type PreparedDispatch, type PreparedDispatchDescriptionV1 } from "./prepared-dispatch.js";
import { normalizeReservationPublicationId } from "./reservation-identity.js";
import type { AuthenticatedProviderIdentityV1 } from "./github-account-identity.js";
import type { AuthorityLatencyPhase, AuthorityLatencyRecorder } from "./latency.js";
import { isProxy } from "node:util/types";

export interface DispatchRequestState { readonly reservation: { readonly reservationId: string; readonly state: LedgerState; readonly intent: Pick<StoredReservationIntent, "effectDigest" | "effectCanonicalBase64" | "executionContext" | "routeAuthority"> & Readonly<{ requestId?: string }> }; readonly effect: unknown; readonly effectCanonicalBase64: string; readonly effectDigest: string; readonly [key: string]: unknown; }
export type ReconciliationStatus = "matched" | "not-applied" | "conflict" | "unavailable" | "not-attempted";
export interface DispatchOutcome { readonly kind: "acknowledged" | "definitive-failure" | "ambiguous"; readonly resultDigest: string; readonly providerResultDigest?: string; readonly providerStatus?: number; readonly responseDigest?: string; /** Digest of the exact provider request bytes when confidential material was inserted inside the Authority Cell. */ readonly materializedRequestDigest?: string; readonly reconciliationStatus?: ReconciliationStatus; readonly normalizedProjectionDigest?: string | null; readonly receiptRef?: string; readonly evidenceDigest?: string; readonly priorReceiptDigest?: string; readonly reason?: string; }
declare const coordinatorDispatchCallBrand: unique symbol;
export type CoordinatorDispatchCallV1 = Readonly<{ readonly [coordinatorDispatchCallBrand]: true }>;
export interface DispatchAdapter { dispatch(state: DispatchRequestState, call?: CoordinatorDispatchCallV1): Promise<DispatchOutcome>; prepare?(state: DispatchRequestState, call?: CoordinatorDispatchCallV1): Promise<PreparedDispatch>; reconcile?(state: DispatchRequestState, outcome: DispatchOutcome): Promise<DispatchOutcome>; }
export interface DispatchEvidenceWriter { persist(input: Readonly<{ state: DispatchRequestState; outcome: DispatchOutcome; dispatchedRequestDigest: string; }>): Promise<void>; }
export type DurableDispatchPublicationIdentityV1 = Readonly<{ v:"reelier.durable-dispatch-publication-identity/v1";reservationId:string;tenant:string;requestDigest:string;capabilityDigest:string;effectDigest:string;routeAuthorityDigest:string;expectedDispatchedRequestDigest:string;reservationIntentDigest:string }>;
export type DurableDispatchPublicationQueryV1 = Readonly<{v:"reelier.durable-dispatch-publication-query/v1";identity:DurableDispatchPublicationIdentityV1;ledgerState:"dispatched"|"ambiguous";sendStarted:true}>;
export type DurableDispatchPublicationHeadV1 = Readonly<{v:"reelier.durable-dispatch-publication-head/v1";identity:DurableDispatchPublicationIdentityV1;receiptRef:string;evidenceDigest:string;reservationReceiptRef:string;priorReceiptRef:string|null}&(
  |Readonly<{phase:"reservation";terminalKind:null;priorReceiptRef:null}>
  |Readonly<{phase:"dispatch";terminalKind:"acknowledged"|"definitive-failure";priorReceiptRef:string}>
  |Readonly<{phase:"ambiguous";terminalKind:"ambiguous";priorReceiptRef:string}>
  |Readonly<{phase:"reconcile";terminalKind:"reconciled";priorReceiptRef:string}>
)>;
export interface DispatchPublication {
  publish(input: Readonly<{ phase: "dispatch" | "cancelled" | "ambiguous" | "reconcile"; state: DispatchRequestState; outcome: DispatchOutcome; dispatchedRequestDigest: string | null; priorReceiptDigest?: string | null; }>): Promise<Readonly<{ receiptRef: string; evidenceDigest: string }>>;
  publishReservation?(input:Readonly<{phase:"reservation";identity:DurableDispatchPublicationIdentityV1;state:DispatchRequestState;outcome:DispatchOutcome;dispatchedRequestDigest:null;priorReceiptDigest:null}>):Promise<Readonly<{receiptRef:string;evidenceDigest:string}>>;
  /** `expect` states what the caller is entitled to see. `"terminal"` refuses a chain that stopped
   * at its reservation root, so a rolled-back or lost terminal receipt can never read as absent
   * progress. `"root-or-terminal"` is only for the two readbacks with a legitimate reservation-only
   * window: recovery of a pre-terminal crash, and the root publication's own readback. */
  loadDurableHead?(query:DurableDispatchPublicationQueryV1,expect?:"terminal"|"root-or-terminal"):Promise<DurableDispatchPublicationHeadV1|null>;
}
export interface DispatchReservationProjectionV1 { readonly reservationId: string; readonly state: LedgerState; readonly effectDigest: string; readonly allocationId: string | null; }
export interface DispatchCoordinator { describe?(handle: ReservedDispatchHandle): DispatchReservationProjectionV1; dispatch(handle: ReservedDispatchHandle): Promise<DispatchOutcome>; cancel(handle: ReservedDispatchHandle, reason?: string): Promise<DispatchOutcome>; reconcile(reservationId: string): Promise<DispatchOutcome>; recover(): Promise<readonly string[]>; }

/** Closes and detaches the provider-returned result before coordinator logic observes it. */
export function parseDispatchOutcomeV1(value: unknown): DispatchOutcome {
  const required = ["kind", "resultDigest"] as const;
  const optional = ["providerResultDigest", "providerStatus", "responseDigest", "materializedRequestDigest", "reconciliationStatus", "normalizedProjectionDigest", "receiptRef", "evidenceDigest", "priorReceiptDigest", "reason"] as const;
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("dispatch outcome must be inert provider data");
  const permitted = new Set<string>([...required, ...optional]), raw: Record<string, unknown> = Object.create(null);
  let count = 0; for (const key in value) { if (!Object.hasOwn(value, key)) continue; if (++count > 32 || !permitted.has(key)) throw new TypeError("dispatch outcome is not closed"); }
  for (const key of required) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError("dispatch outcome requires data properties"); raw[key] = descriptor.value; }
  for (const key of optional) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor) continue; if (!descriptor.enumerable) continue; if (!Object.hasOwn(descriptor, "value")) throw new TypeError("dispatch outcome requires data properties"); raw[key] = descriptor.value; }
  if (!["acknowledged", "definitive-failure", "ambiguous"].includes(raw.kind as string) || typeof raw.resultDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(raw.resultDigest)) throw new TypeError("dispatch outcome is invalid");
  for (const key of ["providerResultDigest", "responseDigest", "materializedRequestDigest", "receiptRef", "evidenceDigest", "priorReceiptDigest"]) if (raw[key] !== undefined && (typeof raw[key] !== "string" || !/^sha256:[0-9a-f]{64}$/.test(raw[key] as string))) throw new TypeError("dispatch outcome digest is invalid");
  if (raw.providerStatus !== undefined && (!Number.isSafeInteger(raw.providerStatus) || (raw.providerStatus as number) < 100 || (raw.providerStatus as number) > 599)) throw new TypeError("dispatch outcome provider status is invalid");
  if (raw.reconciliationStatus !== undefined && !["matched", "not-applied", "conflict", "unavailable", "not-attempted"].includes(raw.reconciliationStatus as string)) throw new TypeError("dispatch outcome reconciliation status is invalid");
  if (raw.normalizedProjectionDigest !== undefined && raw.normalizedProjectionDigest !== null && (typeof raw.normalizedProjectionDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(raw.normalizedProjectionDigest))) throw new TypeError("dispatch outcome projection digest is invalid");
  if (raw.reason !== undefined && (typeof raw.reason !== "string" || raw.reason.length === 0 || raw.reason.length > 4096)) throw new TypeError("dispatch outcome reason is invalid");
  return Object.freeze(Object.fromEntries(Object.keys(raw).map(key => [key, raw[key]])) as unknown as DispatchOutcome);
}
export class DispatchBoundaryFailure extends Error {
  readonly classification: string;
  readonly phase: string;
  readonly providerEffectPossible: boolean;
  constructor(input: Readonly<{ classification: string; phase: string; providerEffectPossible: boolean; cause?: unknown }>) {
    super(input.classification, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "DispatchBoundaryFailure";
    this.classification = input.classification;
    this.phase = input.phase;
    this.providerEffectPossible = input.providerEffectPossible;
    Object.freeze(this);
  }
}
export interface DispatchBudget { consumeOnce(input: Readonly<{ allocationId: string; reservationId: string; effects: number }>): Promise<unknown>; returnOnce(input: Readonly<{ allocationId: string; reservationId: string; effects: number }>): Promise<unknown>; releaseConsumedOnce?(input: Readonly<{ allocationId: string; reservationId: string; effects: number }>): Promise<unknown>; }
export interface CurrentDispatchAuthorityV1 { readonly authorityGeneration: string; readonly authorityExpiresAt: string; readonly authorityStateDigest?: string; readonly sourceBundleDigest?: string; readonly grantDigest?: string; readonly runtimeSessionId?: string; readonly routeAuthorityDigest: string; readonly providerId?: string; readonly connectorId?: string; readonly accountId?: string; readonly endpointId?: string; }
export interface DispatchAuthorityRevalidator { revalidate(state: DispatchRequestState): Promise<CurrentDispatchAuthorityV1>; routeReread(state: DispatchRequestState): Promise<import("../ledger.js").RouteAuthoritySnapshotV1>; }
export interface CertifiedIdentityVerifier { readonly purpose: "authority-evidence"; readonly signerId: string; readonly publicKey: KeyObject; }
export interface CertifiedDispatchOptions { readonly identityProbe: () => Promise<AuthenticatedProviderIdentityV1>; readonly verifyIdentity?: CertifiedIdentityVerifier; readonly revalidator: DispatchAuthorityRevalidator; readonly latencyRecorder?: AuthorityLatencyRecorder; readonly onPhase?: (phase: "identity-probe" | "route-reread" | "authority-validation-before-prepare" | "prepare" | "authority-validation-after-prepare" | "dispatch-commit-cas" | "authority-send-boundary" | "send-started" | "send") => void; }

const coordinatorPublicationCalls = new WeakMap<object, Readonly<{ phase: string; reservationId: string; effectDigest: string }>>();
interface CoordinatorDispatchCallStateV1 { readonly call: object; readonly state: DispatchRequestState; readonly reservationId: string; readonly effectDigest: string; delegate: object | null }
const coordinatorDispatchCalls = new WeakMap<object, CoordinatorDispatchCallStateV1>();
const coordinatorDispatchDelegates = new WeakMap<object, CoordinatorDispatchCallStateV1>();

/** @internal Binds one downstream host authority object to the exact live coordinator call. */
export function bindCoordinatorDispatchCallDelegateV1(call: unknown, delegate: object, state: DispatchRequestState): boolean {
  if (!call || typeof call !== "object" || !delegate || typeof delegate !== "object") return false;
  const binding = coordinatorDispatchCalls.get(call as object);
  if (!binding || binding.delegate !== null || coordinatorDispatchDelegates.has(delegate) || binding.state !== state || binding.reservationId !== state.reservation?.reservationId || binding.effectDigest !== state.effectDigest) return false;
  binding.delegate = delegate;
  coordinatorDispatchDelegates.set(delegate, binding);
  return true;
}

/** @internal Jointly consumes the downstream delegate and its exact live coordinator call. */
export function consumeCoordinatorDispatchCallDelegateV1(delegate: unknown, expected: Readonly<{ reservationId: string; effectDigest: string }>): boolean {
  if (!delegate || typeof delegate !== "object") return false;
  const binding = coordinatorDispatchDelegates.get(delegate as object);
  if (!binding || binding.delegate !== delegate || binding.reservationId !== expected.reservationId || binding.effectDigest !== expected.effectDigest) return false;
  revokeCoordinatorDispatchCall(binding.call);
  return true;
}

function createCoordinatorDispatchCall(state: DispatchRequestState): CoordinatorDispatchCallV1 {
  const call = Object.freeze(Object.create(null)) as CoordinatorDispatchCallV1;
  coordinatorDispatchCalls.set(call as object, { call: call as object, state, reservationId: state.reservation.reservationId, effectDigest: state.effectDigest, delegate: null });
  return call;
}

function revokeCoordinatorDispatchCall(call: object): void {
  const binding = coordinatorDispatchCalls.get(call);
  coordinatorDispatchCalls.delete(call);
  if (binding?.delegate && coordinatorDispatchDelegates.get(binding.delegate) === binding) coordinatorDispatchDelegates.delete(binding.delegate);
  if (binding) binding.delegate = null;
}

/** @internal Consumed by host-private publication wrappers; never exported from the package barrel. */
export function consumeCoordinatorPublicationCall(input: object, expected: Readonly<{ phase: string; reservationId: string; effectDigest: string }>): void {
  const actual = coordinatorPublicationCalls.get(input);
  coordinatorPublicationCalls.delete(input);
  if (!actual || actual.phase !== expected.phase || actual.reservationId !== expected.reservationId || actual.effectDigest !== expected.effectDigest) throw new TypeError("release receipt publication requires a coordinator-minted publication capability");
}

function coordinatorPublicationCall<T extends Readonly<{ phase: string; state: DispatchRequestState }>>(input: T): T {
  coordinatorPublicationCalls.set(input as object, Object.freeze({ phase: input.phase, reservationId: input.state.reservation.reservationId, effectDigest: input.state.effectDigest }));
  return input;
}

export function createDispatchCoordinator(ledger: AuthorityLedger, adapter: DispatchAdapter, evidence?: DispatchEvidenceWriter, publication?: DispatchPublication, budget?: DispatchBudget, certified?: CertifiedDispatchOptions): DispatchCoordinator {
  assertLinuxAuthorityCellHost();
  if(publication&&Boolean(publication.publishReservation)!==Boolean(publication.loadDurableHead))throw new TypeError("durable dispatch publication methods must be configured as a pair");
  const describedStates = new WeakMap<object, DispatchRequestState>();
  const takeState = (handle: ReservedDispatchHandle): DispatchRequestState => {
    const described = describedStates.get(handle as object);
    if (described) { describedStates.delete(handle as object); return described; }
    return unwrapReservedDispatchHandle(handle) as DispatchRequestState;
  };
  const budgetFor = (state: DispatchRequestState): { allocationId: string; reservationId: string; effects: number } | undefined => {
    const context = state.reservation.intent.executionContext;
    return context ? { allocationId: context.allocationId, reservationId: state.reservation.reservationId, effects: 1 } : undefined;
  };
  return Object.freeze({
    describe(handle: ReservedDispatchHandle): DispatchReservationProjectionV1 {
      let state = describedStates.get(handle as object);
      if (!state) { state = unwrapReservedDispatchHandle(handle) as DispatchRequestState; describedStates.set(handle as object, state); }
      if (!state.reservation?.reservationId || !state.effectDigest) throw new TypeError("dispatch handle has no reservation projection");
      return Object.freeze({ reservationId: state.reservation.reservationId, state: state.reservation.state, effectDigest: state.effectDigest, allocationId: state.reservation.intent.executionContext?.allocationId ?? null });
    },
    async dispatch(handle: ReservedDispatchHandle): Promise<DispatchOutcome> {
      const revalidateGoverned = hasAcceptedGateReservationHandleRevalidatorV1(handle) ? () => revalidateAcceptedGateReservationHandleV1(handle) : undefined;
      const state = takeState(handle);
      if (!state.reservation || state.reservation.state !== "reserved") throw new TypeError("dispatch handle is not reserved");
      const reservationId = state.reservation.reservationId;
      const routeAuthority = state.reservation.intent.routeAuthority;
      if (certified && !routeAuthority) throw new Error("certified dispatch requires a durable route authority snapshot");
      let authorityBefore: CurrentDispatchAuthorityV1 | undefined;
      if (certified) {
        certified.onPhase?.("identity-probe");
        const identity = await measureLatency(certified.latencyRecorder, "identity-probe", () => certified.identityProbe());
        const expectedIdentity = routeAuthority!.providerAccountIdentity;
        const loginMatches = identity && (expectedIdentity === `github:${identity.providerLogin}` || expectedIdentity === identity.providerAccountId);
        const verifier = certified.verifyIdentity;
        const identityDigest = identity && authorityDigest(identityUnsigned(identity));
        let verified = false;
        if (identity && verifier && verifier.purpose === "authority-evidence" && typeof verifier.signerId === "string" && verifier.signerId.length > 0 && verifier.publicKey?.type === "public" && verifier.publicKey.asymmetricKeyType === "ed25519" && identity.signerId === verifier.signerId && identity.signature && typeof identity.signature === "object") {
          try {
            const signature = identity.signature as AuthoritySignature;
            authoritySignatureDigest(signature);
            verified = verifyAuthoritySignature(verifier.publicKey, "authority-evidence", identityDigest!, signature);
          } catch { verified = false; }
        }
        if (!identity || !verified || identityDigest !== routeAuthority!.authenticatedProviderIdentityDigest || identity.credentialSlotId !== routeAuthority!.credentialSlotId || identity.slotInstanceId !== routeAuthority!.slotInstanceId || identity.slotVersion !== routeAuthority!.slotVersion || Date.parse(identity.slotExpiresAt) < Date.parse(routeAuthority!.authorityExpiresAt) || identity.providerAccountId !== routeAuthority!.accountId || !loginMatches || identity.routeDigest !== routeAuthority!.routeDigest) throw new Error("authenticated provider identity binding mismatch");
        certified.onPhase?.("route-reread");
        const reread = inertRouteSnapshot(await measureLatency(certified.latencyRecorder, "route-reread", () => certified.revalidator.routeReread(state)));
        if (authorityDigest(reread) !== authorityDigest(routeAuthority!)) throw new Error("route authority snapshot mismatch");
        certified.onPhase?.("authority-validation-before-prepare");
        authorityBefore = await measureLatency(certified.latencyRecorder, "authority-validation-before-prepare", () => certified.revalidator.revalidate(state));
        if (
          authorityBefore.authorityGeneration !== routeAuthority!.authorityGeneration
          || authorityBefore.routeAuthorityDigest !== authorityDigest(routeAuthority!)
          || authorityBefore.authorityExpiresAt !== routeAuthority!.authorityExpiresAt
          || authorityBefore.providerId !== undefined && authorityBefore.providerId !== routeAuthority!.providerId
          || authorityBefore.connectorId !== undefined && authorityBefore.connectorId !== routeAuthority!.connectorId
          || authorityBefore.accountId !== undefined && authorityBefore.accountId !== routeAuthority!.accountId
          || authorityBefore.endpointId !== undefined && authorityBefore.endpointId !== routeAuthority!.endpointId
        ) throw new Error("route authority generation or binding mismatch");
      }
      if (adapter.prepare && ledger.commitPreparedDispatch) {
        const call = createCoordinatorDispatchCall(state);
        try {
        certified?.onPhase?.("prepare");
        const context = state.reservation.intent.executionContext;
        const prepared = await measureLatency(certified?.latencyRecorder, "prepare", () => adapter.prepare!(state, call));
        const description: PreparedDispatchDescriptionV1 = prepared.description;
        if (routeAuthority && (description.routeDigest !== routeAuthority.routeDigest || description.materializedRequestDigest !== routeAuthority.expectedMaterializedRequestDigest)) throw new Error("prepared dispatch does not match durable route authority");
        await revalidateGoverned?.();
        const revalidatePreparedAuthority = certified ? async (): Promise<void> => {
          certified.onPhase?.("authority-validation-after-prepare");
          const authorityAfter = await measureLatency(certified.latencyRecorder, "authority-validation-after-prepare", () => certified.revalidator.revalidate(state));
          if (
            !authorityBefore
            || authorityAfter.authorityGeneration !== routeAuthority!.authorityGeneration
            || authorityAfter.authorityGeneration !== authorityBefore.authorityGeneration
            || authorityAfter.routeAuthorityDigest !== authorityBefore.routeAuthorityDigest
            || authorityAfter.authorityExpiresAt !== routeAuthority!.authorityExpiresAt
            || description.authorityGeneration !== routeAuthority!.authorityGeneration
            || description.authorityGeneration !== authorityAfter.authorityGeneration
            || description.authorityExpiresAt !== routeAuthority!.authorityExpiresAt
            || authorityAfter.providerId !== undefined && authorityAfter.providerId !== routeAuthority!.providerId
            || authorityAfter.connectorId !== undefined && authorityAfter.connectorId !== routeAuthority!.connectorId
            || authorityAfter.accountId !== undefined && authorityAfter.accountId !== routeAuthority!.accountId
            || authorityAfter.endpointId !== undefined && authorityAfter.endpointId !== routeAuthority!.endpointId
          ) throw new Error("dispatch authority changed during preparation");
        } : undefined;
        await revalidatePreparedAuthority?.();
        const budgetClaim = budgetFor(state);
        if (budget && budgetClaim) await budget.consumeOnce(budgetClaim);
        await revalidatePreparedAuthority?.();
        await revalidateGoverned?.();
        let lease: import("./prepared-dispatch.js").DispatchCommitLease;
        try { certified?.onPhase?.("dispatch-commit-cas"); lease = await measureLatency(certified?.latencyRecorder, "dispatch-commit-cas", () => ledger.commitPreparedDispatch!({ reservationId, allocationId: context?.allocationId ?? description.allocationId, expectedAuthorityGeneration: description.authorityGeneration, preparedDescription: description, absoluteDeadlineMs: description.absoluteDeadlineMs })); }
        catch (error) {
          if (budget && budgetClaim) {
            let committed = false;
            try { committed = (await ledger.getReservation(reservationId))?.state !== "reserved"; } catch { committed = true; }
            if (!committed) { if (budget.releaseConsumedOnce) await budget.releaseConsumedOnce(budgetClaim); else await budget.returnOnce(budgetClaim); }
          }
          throw error;
        }
        let reservationRoot:Readonly<{receiptRef:string;evidenceDigest:string}>|undefined;
        if(publication?.publishReservation){
          const persisted=await ledger.getReservation(reservationId);
          if(!persisted||persisted.state!=="dispatched"||persisted.sendStarted!==true)throw new Error("prepared commit did not persist send-started before publication");
          const identity=durableIdentity(persisted);
          // Receipt construction needs the accepted gate/source/capability provenance, while
          // durable identity must come from the reservation reread after the prepared CAS.
          const rootState=Object.freeze({...state,reservation:persisted}) as DispatchRequestState;
          const rootOutcome=Object.freeze({kind:"ambiguous" as const,resultDigest:authorityDigest({reservationId,phase:"reservation"})});
          try { reservationRoot=await publication.publishReservation(coordinatorPublicationCall({phase:"reservation",identity,state:rootState,outcome:rootOutcome,dispatchedRequestDigest:null,priorReceiptDigest:null})); }
          catch (error) { throw new DispatchBoundaryFailure({ classification: "reservation-publication-unavailable", phase: "reservation-publication", providerEffectPossible: false, cause: error }); }
        }
        await revalidatePreparedAuthority?.();
        await revalidateGoverned?.();
        authorizeCoordinatorCommittedLease(lease);
        let outcome: DispatchOutcome;
        try { certified?.onPhase?.("authority-send-boundary"); outcome = parseDispatchOutcomeV1(await measureLatency(certified?.latencyRecorder, "authority-send-boundary", () => consumePreparedDispatch(prepared, lease))); certified?.onPhase?.("send"); }
        catch { outcome = { kind: "ambiguous", resultDigest: authorityDigest({ v: "reelier.dispatch-result/v1", reservationId, status: "ambiguous" }) }; }
        if (adapter.reconcile && outcome.kind !== "ambiguous" && (!outcome.reconciliationStatus || outcome.reconciliationStatus === "not-attempted")) {
          try {
            outcome = parseDispatchOutcomeV1(await adapter.reconcile(state, outcome));
          } catch {
            outcome = Object.freeze({ ...outcome, kind: "ambiguous", reconciliationStatus: "unavailable" as const, normalizedProjectionDigest: null });
          }
        }
        const current = await ledger.getReservation(reservationId);
        if (current?.state === "reserved") {
          const marked = await ledger.transition(reservationId, "reserved", { to: "dispatched" });
          if (!marked.ok) throw new Error(`dispatch transition refused: ${marked.reason}`);
        }
        const dispatchedRequestDigest = outcome.materializedRequestDigest ?? description.materializedRequestDigest;
        if (evidence) await evidence.persist({ state, outcome, dispatchedRequestDigest });
        let terminalPublication:Readonly<{receiptRef:string;evidenceDigest:string}>|undefined;
        if(publication){terminalPublication=await publication.publish(coordinatorPublicationCall({phase:outcome.kind==="ambiguous"?"ambiguous":"dispatch",state,outcome,dispatchedRequestDigest,priorReceiptDigest:reservationRoot?.receiptRef??null}));if(outcome.kind!=="ambiguous")outcome=Object.freeze({...outcome,providerResultDigest:outcome.resultDigest,resultDigest:terminalPublication.receiptRef,receiptRef:terminalPublication.receiptRef,evidenceDigest:terminalPublication.evidenceDigest,priorReceiptDigest:reservationRoot?.receiptRef});}
        const terminal = outcome.kind;
        const result = await measureLatency(certified?.latencyRecorder, "terminal-transition", () => ledger.transition(reservationId, "dispatched", terminal === "ambiguous" ? { to: "ambiguous" } : { to: terminal, resultDigest: outcome.resultDigest }));
        if (!result.ok) throw new Error(`dispatch result transition refused: ${result.reason}`);
        return Object.freeze({ ...outcome, materializedRequestDigest: dispatchedRequestDigest, ...(terminalPublication&&outcome.kind==="ambiguous"?{receiptRef:terminalPublication.receiptRef,evidenceDigest:terminalPublication.evidenceDigest,priorReceiptDigest:reservationRoot?.receiptRef}:{}) });
        } finally { revokeCoordinatorDispatchCall(call as object); }
      }
      if (certified) throw new Error("certified dispatch requires prepared commit boundary");
      const transitioned = await ledger.transition(reservationId, "reserved", { to: "dispatched" });
      if (!transitioned.ok) throw new Error(`dispatch transition refused: ${transitioned.reason}`);
      const budgetClaim = budgetFor(state);
      if (budget && budgetClaim) await budget.consumeOnce(budgetClaim);
      let outcome: DispatchOutcome;
      const call = createCoordinatorDispatchCall(state);
      try { outcome = parseDispatchOutcomeV1(await adapter.dispatch(state, call)); }
      catch { outcome = { kind: "ambiguous", resultDigest: authorityDigest({ v: "reelier.dispatch-result/v1", reservationId, status: "ambiguous" }) }; }
      finally { revokeCoordinatorDispatchCall(call as object); }
      if (adapter.reconcile && outcome.kind !== "ambiguous") {
        try {
          outcome = parseDispatchOutcomeV1(await adapter.reconcile(state, outcome));
        } catch {
          outcome = Object.freeze({ ...outcome, kind: "ambiguous", reconciliationStatus: "unavailable" as const, normalizedProjectionDigest: null });
        }
      }
      const dispatchedRequestDigest = outcome.materializedRequestDigest ?? authorityDigest({ v: "reelier.dispatched-request/v1", reservationId, effectDigest: state.effectDigest, effect: state.effect });
      if (!/^sha256:[0-9a-f]{64}$/.test(dispatchedRequestDigest)) throw new Error("dispatch request digest is invalid");
      if (evidence) await evidence.persist({ state, outcome, dispatchedRequestDigest });
      let published: Readonly<{ receiptRef: string; evidenceDigest: string }> | undefined;
      if (publication) { published = await publication.publish(coordinatorPublicationCall({ phase: "dispatch", state, outcome, dispatchedRequestDigest, priorReceiptDigest: null })); outcome = Object.freeze({ ...outcome, providerResultDigest: outcome.resultDigest, resultDigest: published.receiptRef, receiptRef: published.receiptRef, evidenceDigest: published.evidenceDigest }); }
      const terminal: LedgerState = outcome.kind;
      const result = await measureLatency(undefined, "terminal-transition", () => outcome.kind === "ambiguous"
        ? ledger.transition(reservationId, "dispatched", { to: "ambiguous" })
        : ledger.transition(reservationId, "dispatched", { to: terminal as "acknowledged" | "definitive-failure", resultDigest: outcome.resultDigest }));
      if (!result.ok) throw new Error(`dispatch result transition refused: ${result.reason}`);
      if (publication && published && outcome.reconciliationStatus && outcome.reconciliationStatus !== "not-attempted") {
        const reconciledState = { ...state, reservation: result.reservation } as DispatchRequestState;
        const reconciled = await publication.publish(coordinatorPublicationCall({ phase: "reconcile", state: reconciledState, outcome, dispatchedRequestDigest, priorReceiptDigest: published.receiptRef }));
        const reconciliationTransition = await ledger.transition(reservationId, result.reservation.state, { to: "reconciled", resultDigest: reconciled.receiptRef });
        if (!reconciliationTransition.ok) throw new Error(`reconciliation transition refused: ${reconciliationTransition.reason}`);
        outcome = Object.freeze({ ...outcome, resultDigest: reconciled.receiptRef, receiptRef: reconciled.receiptRef, evidenceDigest: reconciled.evidenceDigest, priorReceiptDigest: published.receiptRef });
      }
      return Object.freeze(outcome);
    },
    async cancel(handle: ReservedDispatchHandle, reason = "cancelled-before-dispatch"): Promise<DispatchOutcome> {
      const state = takeState(handle);
      if (!state.reservation || state.reservation.state !== "reserved") throw new TypeError("dispatch handle is not reserved");
      const resultDigest = authorityDigest({ v: "reelier.cancelled-result/v1", reservationId: state.reservation.reservationId, reason });
      const budgetClaim = budgetFor(state);
      if (budget && budgetClaim) await budget.returnOnce(budgetClaim);
      const outcome = Object.freeze({ kind: "definitive-failure" as const, resultDigest });
      const published = publication ? await publication.publish(coordinatorPublicationCall({ phase: "cancelled", state, outcome, dispatchedRequestDigest: null })) : undefined;
      const terminalDigest = published?.receiptRef ?? resultDigest;
      const result = await ledger.transition(state.reservation.reservationId, "reserved", { to: "cancelled", resultDigest: terminalDigest });
      if (!result.ok) throw new Error(`cancellation refused: ${result.reason}`);
      return Object.freeze({ ...outcome, ...(published ? { providerResultDigest: outcome.resultDigest } : {}), resultDigest: result.reservation.resultDigest ?? terminalDigest, receiptRef: published?.receiptRef, evidenceDigest: published?.evidenceDigest });
    },
    async reconcile(reservationId: string): Promise<DispatchOutcome> {
      if (!adapter.reconcile) throw new Error("reconciliation adapter is not configured");
      const reservation = await ledger.getReservation(reservationId);
      if (!reservation) throw new Error("reservation not found");
      if (reservation.state !== "ambiguous") throw new Error("only ambiguous reservations can be reconciled");
      const state = recoveredState(reservation);
      let priorReceiptDigest = reservation.resultDigest ?? null;
      if(publication?.loadDurableHead){
        if(reservation.sendStarted!==true)throw new Error("ambiguous reservation is missing send-started marker");
        const identity=durableIdentity(reservation),head=assertDurableHead(await publication.loadDurableHead(durableQuery(identity,"ambiguous"),"terminal"),identity);
        if(!head)throw new Error("durable governed receipt chain is absent");
        if(head.phase==="reconcile"){
          const adopted=await ledger.transition(reservationId,"ambiguous",{to:"reconciled",resultDigest:head.receiptRef});
          if(!adopted.ok)throw new Error(`reconciliation adoption refused: ${adopted.reason}`);
          return Object.freeze({kind:"acknowledged",resultDigest:head.receiptRef,receiptRef:head.receiptRef,evidenceDigest:head.evidenceDigest,priorReceiptDigest:head.priorReceiptRef??undefined,reconciliationStatus:"matched"});
        }
        if(head.phase!=="ambiguous")throw new Error("durable governed receipt head is not reconcilable");
        priorReceiptDigest=head.receiptRef;
      }
      const pending = Object.freeze({
        kind: "ambiguous" as const,
        resultDigest: authorityDigest({ v: "reelier.ambiguous-result/v1", reservationId }),
        reconciliationStatus: "not-attempted" as const,
        normalizedProjectionDigest: null,
      });
      const reconciliationContext = state.reservation.intent.executionContext;
      if (reconciliationContext) authorizeCoordinatorReconciliation(state, { reservationId, allocationId: reconciliationContext.allocationId, effectDigest: state.effectDigest });
      let outcome = parseDispatchOutcomeV1(await adapter.reconcile(state, pending));
      if (outcome.reconciliationStatus === "not-attempted") throw new Error("reconciliation did not produce a verdict");
      const budgetClaim = budgetFor(state);
      if (budget && budgetClaim && outcome.reconciliationStatus === "not-applied") {
        if (budget.releaseConsumedOnce) await budget.releaseConsumedOnce(budgetClaim);
        else await budget.returnOnce(budgetClaim);
      }
      const published = publication ? await publication.publish(coordinatorPublicationCall({ phase: "reconcile", state, outcome, dispatchedRequestDigest: authorityDigest({ v: "reelier.dispatched-request/v1", reservationId, effectDigest: state.effectDigest, effect: state.effect }), priorReceiptDigest })) : undefined;
      const resultDigest = published?.receiptRef ?? outcome.resultDigest;
      const terminal = await ledger.transition(reservationId, "ambiguous", { to: "reconciled", resultDigest });
      if (!terminal.ok) throw new Error(`reconciliation transition refused: ${terminal.reason}`);
      return Object.freeze({ ...outcome, resultDigest, ...(published ? { receiptRef: published.receiptRef, evidenceDigest: published.evidenceDigest } : {}), ...(priorReceiptDigest ? { priorReceiptDigest } : {}) });
    },
    async recover(): Promise<readonly string[]> {
      const recovered = await ledger.recover({ deferTerminal: true });
      if (!recovered.ok) throw new Error(`authority recovery failed: ${recovered.reason}`);
      const ambiguous: string[] = [];
      for (const reservation of recovered.reservations) {
        if (reservation.state === "reserved") {
          const resultDigest = authorityDigest({ v: "reelier.cancelled-result/v1", reservationId: reservation.reservationId, reason: "restart" });
          const state = recoveredState(reservation);
          const budgetClaim = budgetFor(state);
          if (budget && budgetClaim) await budget.returnOnce(budgetClaim);
          const outcome = Object.freeze({ kind: "definitive-failure" as const, resultDigest });
          const published = publication ? await publication.publish(coordinatorPublicationCall({ phase: "cancelled", state, outcome, dispatchedRequestDigest: null })) : undefined;
          const transitioned = await ledger.transition(reservation.reservationId, "reserved", { to: "cancelled", resultDigest: published?.receiptRef ?? resultDigest });
          if (!transitioned.ok) throw new Error(`cancellation recovery transition refused: ${transitioned.reason}`);
          continue;
        }
        if (reservation.state === "dispatched") {
          if(publication?.loadDurableHead&&reservation.sendStarted!==true)throw new Error("dispatched reservation is missing send-started marker");
          const resultDigest = authorityDigest({ v: "reelier.ambiguous-result/v1", reservationId: reservation.reservationId });
          const state = recoveredState(reservation);
          const outcome = Object.freeze({ kind: "ambiguous" as const, resultDigest });
          let published:Readonly<{receiptRef:string;evidenceDigest:string}>|undefined;
          if(publication?.loadDurableHead){
            // The only legitimate reservation-only window: the root is published and the terminal
            // receipt was about to be written when the Cell crashed, so this branch republishes it.
            const identity=durableIdentity(reservation),head=assertDurableHead(await publication.loadDurableHead(durableQuery(identity,"dispatched"),"root-or-terminal"),identity);
            if(!head)throw new Error("send-started reservation is missing durable reservation root");
            if(head.phase==="dispatch"&&(head.terminalKind==="acknowledged"||head.terminalKind==="definitive-failure")){
              const adopted=await ledger.transition(reservation.reservationId,"dispatched",{to:head.terminalKind,resultDigest:head.receiptRef});
              if(!adopted.ok)throw new Error(`durable terminal adoption refused: ${adopted.reason}`);
              continue;
            }
            if(head.phase==="ambiguous"){
              const adopted=await ledger.transition(reservation.reservationId,"dispatched",{to:"ambiguous"});
              if(!adopted.ok)throw new Error(`durable ambiguity adoption refused: ${adopted.reason}`);
              ambiguous.push(reservation.reservationId);continue;
            }
            if(head.phase!=="reservation")throw new Error("durable governed receipt head is incompatible with dispatched recovery");
            published=await publication.publish(coordinatorPublicationCall({phase:"ambiguous",state,outcome,dispatchedRequestDigest:identity.expectedDispatchedRequestDigest,priorReceiptDigest:head.receiptRef}));
          }else if(publication)published=await publication.publish(coordinatorPublicationCall({ phase: "ambiguous", state, outcome, dispatchedRequestDigest: authorityDigest({ v: "reelier.dispatched-request/v1", reservationId: reservation.reservationId, effectDigest: reservation.intent.effectDigest }) }));
          const transitioned = await ledger.transition(reservation.reservationId, "dispatched", { to: "ambiguous" });
          if (!transitioned.ok) throw new Error(`ambiguity transition refused: ${transitioned.reason}`);
          ambiguous.push(reservation.reservationId);
          continue;
        }
        if(reservation.state==="ambiguous"&&publication?.loadDurableHead){
          if(reservation.sendStarted!==true)throw new Error("ambiguous reservation is missing send-started marker");
          const identity=durableIdentity(reservation),head=assertDurableHead(await publication.loadDurableHead(durableQuery(identity,"ambiguous"),"terminal"),identity);
          if(!head)throw new Error("ambiguous reservation is missing durable governed receipt chain");
          if(head.phase==="reconcile"){
            const adopted=await ledger.transition(reservation.reservationId,"ambiguous",{to:"reconciled",resultDigest:head.receiptRef});
            if(!adopted.ok)throw new Error(`durable reconciliation adoption refused: ${adopted.reason}`);
          }else if(head.phase!=="ambiguous")throw new Error("durable governed receipt head is incompatible with ambiguous recovery");
        }
      }
      return Object.freeze(ambiguous);
    },
  });
}

function inertRouteSnapshot(value: import("../ledger.js").RouteAuthoritySnapshotV1): import("../ledger.js").RouteAuthoritySnapshotV1 {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("route authority snapshot is not inert");
  const keys = ["v","connectorRegistrationDigest","operatorConfigurationDigest","routeDigest","providerId","connectorId","accountId","providerAccountIdentity","endpointId","credentialSlotId","slotInstanceId","slotVersion","authenticatedProviderIdentityDigest","sourceReadRouteDigest","projectionSchemaDigest","expectedMaterializedRequestDigest","authorityGeneration","authorityExpiresAt"];
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== keys.length || keys.some(key => !(key in descriptors)) || Object.keys(descriptors).some(key => !keys.includes(key)) || Object.values(descriptors).some(descriptor => !("value" in descriptor) || descriptor.get || descriptor.set)) throw new TypeError("route authority snapshot is not inert");
  return Object.freeze({ ...value });
}
function identityUnsigned(value: AuthenticatedProviderIdentityV1): Omit<AuthenticatedProviderIdentityV1, "signerId" | "signature"> { const { signerId: _signerId, signature: _signature, ...unsigned } = value; return unsigned; }

function recoveredState(reservation: DispatchRequestState["reservation"]): DispatchRequestState {
  const encoded = reservation.intent.effectCanonicalBase64;
  let effect: unknown = {};
  if (encoded) {
    try { effect = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")); } catch { effect = {}; }
  }
  return { reservation, effect, effectCanonicalBase64: encoded ?? "", effectDigest: reservation.intent.effectDigest } as DispatchRequestState;
}

function durableIdentity(reservation:import("../ledger.js").ReservationSnapshot):DurableDispatchPublicationIdentityV1{
  const intent=reservation.intent;
  const route=intent.routeAuthority;
  const prepared=reservation.preparedDispatchBinding;
  const expectedDispatchedRequestDigest=prepared?.materializedRequestDigest??route?.expectedMaterializedRequestDigest;
  if(!expectedDispatchedRequestDigest)throw new TypeError("durable publication requires a prepared dispatch binding");
  const required=[intent.requestDigest,intent.capabilityDigest,intent.effectDigest,expectedDispatchedRequestDigest];
  if(typeof intent.tenant!=="string"||intent.tenant.length===0||required.some(value=>typeof value!=="string"||!/^sha256:(?!0{64}$)[0-9a-f]{64}$/.test(value)))throw new TypeError("durable publication identity is invalid");
  const reservationId=normalizeReservationPublicationId(reservation.reservationId);
  const routeAuthorityDigest=route?authorityDigest(route):authorityDigest({v:"reelier.internal-prepared-route-authority/v1",routeDigest:prepared!.routeDigest,behaviorDigest:prepared!.behaviorDigest,authorityGeneration:prepared!.authorityGeneration,authorityExpiresAt:prepared!.authorityExpiresAt});
  return Object.freeze({v:"reelier.durable-dispatch-publication-identity/v1",reservationId,tenant:intent.tenant,requestDigest:intent.requestDigest,capabilityDigest:intent.capabilityDigest,effectDigest:intent.effectDigest,routeAuthorityDigest,expectedDispatchedRequestDigest,reservationIntentDigest:authorityDigest({v:"reelier.dispatch-reservation-intent/v1",intent})});
}

function durableQuery(identity:DurableDispatchPublicationIdentityV1,ledgerState:"dispatched"|"ambiguous"):DurableDispatchPublicationQueryV1{return Object.freeze({v:"reelier.durable-dispatch-publication-query/v1",identity,ledgerState,sendStarted:true});}
/** @internal Exact predicted query for a genuine reserved effect; verified against the post-commit head. */
export function governedDurableDispatchPublicationQueryV1(reservation:import("../ledger.js").ReservationSnapshot):DurableDispatchPublicationQueryV1{return durableQuery(durableIdentity(reservation),"dispatched");}
function assertDurableHead(value:DurableDispatchPublicationHeadV1|null,identity:DurableDispatchPublicationIdentityV1):DurableDispatchPublicationHeadV1|null{
  if(value===null)return null;
  if(!value||typeof value!=="object"||Object.getPrototypeOf(value)!==Object.prototype||authorityDigest(value.identity)!==authorityDigest(identity))throw new TypeError("durable governed receipt head identity mismatch");
  if(value.v!=="reelier.durable-dispatch-publication-head/v1"||!/^sha256:(?!0{64}$)[0-9a-f]{64}$/.test(value.receiptRef)||!/^sha256:(?!0{64}$)[0-9a-f]{64}$/.test(value.evidenceDigest)||value.reservationReceiptRef!==((value.phase==="reservation")?value.receiptRef:value.reservationReceiptRef))throw new TypeError("durable governed receipt head is invalid");
  if(value.phase==="reservation"&&(value.terminalKind!==null||value.priorReceiptRef!==null||value.reservationReceiptRef!==value.receiptRef))throw new TypeError("durable reservation root is invalid");
  if(value.phase!=="reservation"&&(typeof value.priorReceiptRef!=="string"||!/^sha256:(?!0{64}$)[0-9a-f]{64}$/.test(value.priorReceiptRef)))throw new TypeError("durable governed receipt prior is invalid");
  return value;
}

async function measureLatency<T>(recorder: AuthorityLatencyRecorder | undefined, phase: AuthorityLatencyPhase, operation: () => T | Promise<T>): Promise<T> {
  return recorder ? recorder.measure(phase, operation) : operation();
}
