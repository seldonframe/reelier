import { authorityDigest } from "../wire.js";
import { authoritySignatureDigest } from "../trust.js";
import { verifyAuthoritySignature } from "../crypto.js";
import type { KeyObject } from "node:crypto";
import type { AuthoritySignature } from "../types.js";
import { assertLinuxAuthorityCellHost } from "./platform.js";
import { unwrapReservedDispatchHandle, type ReservedDispatchHandle } from "../gate.js";
import type { AuthorityLedger, LedgerState, StoredReservationIntent } from "../ledger.js";
import { consumePreparedDispatch, type PreparedDispatch, type PreparedDispatchDescriptionV1 } from "./prepared-dispatch.js";
import type { AuthenticatedProviderIdentityV1 } from "./github-account-identity.js";
import type { AuthorityLatencyPhase, AuthorityLatencyRecorder } from "./latency.js";

export interface DispatchRequestState { readonly reservation: { readonly reservationId: string; readonly state: LedgerState; readonly intent: Pick<StoredReservationIntent, "effectDigest" | "effectCanonicalBase64" | "executionContext" | "routeAuthority"> }; readonly effect: unknown; readonly effectCanonicalBase64: string; readonly effectDigest: string; readonly [key: string]: unknown; }
export type ReconciliationStatus = "matched" | "not-applied" | "conflict" | "unavailable" | "not-attempted";
export interface DispatchOutcome { readonly kind: "acknowledged" | "definitive-failure" | "ambiguous"; readonly resultDigest: string; readonly providerResultDigest?: string; readonly providerStatus?: number; readonly responseDigest?: string; /** Digest of the exact provider request bytes when confidential material was inserted inside the Authority Cell. */ readonly materializedRequestDigest?: string; readonly reconciliationStatus?: ReconciliationStatus; readonly normalizedProjectionDigest?: string | null; readonly receiptRef?: string; readonly evidenceDigest?: string; readonly priorReceiptDigest?: string; }
export interface DispatchAdapter { dispatch(state: DispatchRequestState): Promise<DispatchOutcome>; prepare?(state: DispatchRequestState): Promise<PreparedDispatch>; reconcile?(state: DispatchRequestState, outcome: DispatchOutcome): Promise<DispatchOutcome>; }
export interface DispatchEvidenceWriter { persist(input: Readonly<{ state: DispatchRequestState; outcome: DispatchOutcome; dispatchedRequestDigest: string; }>): Promise<void>; }
export interface DispatchPublication { publish(input: Readonly<{ phase: "dispatch" | "cancelled" | "ambiguous" | "reconcile"; state: DispatchRequestState; outcome: DispatchOutcome; dispatchedRequestDigest: string | null; priorReceiptDigest?: string | null; }>): Promise<Readonly<{ receiptRef: string; evidenceDigest: string }>>; }
export interface DispatchCoordinator { dispatch(handle: ReservedDispatchHandle): Promise<DispatchOutcome>; cancel(handle: ReservedDispatchHandle, reason?: string): Promise<DispatchOutcome>; reconcile(reservationId: string): Promise<DispatchOutcome>; recover(): Promise<readonly string[]>; }
export interface DispatchBudget { consumeOnce(input: Readonly<{ allocationId: string; reservationId: string; effects: number }>): Promise<unknown>; returnOnce(input: Readonly<{ allocationId: string; reservationId: string; effects: number }>): Promise<unknown>; releaseConsumedOnce?(input: Readonly<{ allocationId: string; reservationId: string; effects: number }>): Promise<unknown>; }
export interface CurrentDispatchAuthorityV1 { readonly authorityGeneration: string; readonly authorityExpiresAt: string; readonly authorityStateDigest?: string; readonly sourceBundleDigest?: string; readonly grantDigest?: string; readonly runtimeSessionId?: string; readonly routeAuthorityDigest: string; readonly providerId?: string; readonly connectorId?: string; readonly accountId?: string; readonly endpointId?: string; }
export interface DispatchAuthorityRevalidator { revalidate(state: DispatchRequestState): Promise<CurrentDispatchAuthorityV1>; routeReread(state: DispatchRequestState): Promise<import("../ledger.js").RouteAuthoritySnapshotV1>; }
export interface CertifiedIdentityVerifier { readonly purpose: "authority-evidence"; readonly signerId: string; readonly publicKey: KeyObject; }
export interface CertifiedDispatchOptions { readonly identityProbe: () => Promise<AuthenticatedProviderIdentityV1>; readonly verifyIdentity?: CertifiedIdentityVerifier; readonly revalidator: DispatchAuthorityRevalidator; readonly latencyRecorder?: AuthorityLatencyRecorder; readonly onPhase?: (phase: "identity-probe" | "route-reread" | "authority-validation-before-prepare" | "prepare" | "authority-validation-after-prepare" | "dispatch-commit-cas" | "authority-send-boundary" | "send-started" | "send") => void; }

export function createDispatchCoordinator(ledger: AuthorityLedger, adapter: DispatchAdapter, evidence?: DispatchEvidenceWriter, publication?: DispatchPublication, budget?: DispatchBudget, certified?: CertifiedDispatchOptions): DispatchCoordinator {
  assertLinuxAuthorityCellHost();
  const budgetFor = (state: DispatchRequestState): { allocationId: string; reservationId: string; effects: number } | undefined => {
    const context = state.reservation.intent.executionContext;
    return context ? { allocationId: context.allocationId, reservationId: state.reservation.reservationId, effects: 1 } : undefined;
  };
  return Object.freeze({
    async dispatch(handle: ReservedDispatchHandle): Promise<DispatchOutcome> {
      const state = unwrapReservedDispatchHandle(handle) as DispatchRequestState;
      if (!state.reservation || state.reservation.state !== "reserved") throw new TypeError("dispatch handle is not reserved");
      const reservationId = state.reservation.reservationId;
      const routeAuthority = state.reservation.intent.routeAuthority;
      if (certified && !routeAuthority) throw new Error("certified dispatch requires a durable route authority snapshot");
      let authorityBefore: CurrentDispatchAuthorityV1 | undefined;
      if (certified) { certified.onPhase?.("identity-probe"); const identity = await measureLatency(certified.latencyRecorder, "identity-probe", () => certified.identityProbe()); const expectedIdentity = routeAuthority!.providerAccountIdentity; const loginMatches = identity && (expectedIdentity === `github:${identity.providerLogin}` || expectedIdentity === identity.providerAccountId); const verifier = certified.verifyIdentity; const identityDigest = identity && authorityDigest(identityUnsigned(identity)); let verified = false; if (identity && verifier && verifier.purpose === "authority-evidence" && typeof verifier.signerId === "string" && verifier.signerId.length > 0 && verifier.publicKey?.type === "public" && verifier.publicKey.asymmetricKeyType === "ed25519" && identity.signerId === verifier.signerId && identity.signature && typeof identity.signature === "object") { try { const signature = identity.signature as AuthoritySignature; authoritySignatureDigest(signature); verified = verifyAuthoritySignature(verifier.publicKey, "authority-evidence", identityDigest!, signature); } catch { verified = false; } } if (!identity || !verified || identityDigest !== routeAuthority!.authenticatedProviderIdentityDigest || identity.credentialSlotId !== routeAuthority!.credentialSlotId || identity.slotInstanceId !== routeAuthority!.slotInstanceId || identity.slotVersion !== routeAuthority!.slotVersion || Date.parse(identity.slotExpiresAt) !== Date.parse(routeAuthority!.authorityExpiresAt) || identity.providerAccountId !== routeAuthority!.accountId || !loginMatches || identity.routeDigest !== routeAuthority!.routeDigest) throw new Error("authenticated provider identity binding mismatch"); certified.onPhase?.("route-reread"); const reread = inertRouteSnapshot(await measureLatency(certified.latencyRecorder, "route-reread", () => certified.revalidator.routeReread(state))); if (authorityDigest(reread) !== authorityDigest(routeAuthority!)) throw new Error("route authority snapshot mismatch"); certified.onPhase?.("authority-validation-before-prepare"); authorityBefore = await measureLatency(certified.latencyRecorder, "authority-validation-before-prepare", () => certified.revalidator.revalidate(state)); if (authorityBefore.routeAuthorityDigest !== authorityDigest(routeAuthority!) || authorityBefore.authorityExpiresAt !== routeAuthority!.authorityExpiresAt || authorityBefore.providerId !== undefined && authorityBefore.providerId !== routeAuthority!.providerId || authorityBefore.connectorId !== undefined && authorityBefore.connectorId !== routeAuthority!.connectorId || authorityBefore.accountId !== undefined && authorityBefore.accountId !== routeAuthority!.accountId || authorityBefore.endpointId !== undefined && authorityBefore.endpointId !== routeAuthority!.endpointId) throw new Error("route authority binding mismatch"); }
      if (adapter.prepare && ledger.commitPreparedDispatch) {
        certified?.onPhase?.("prepare");
        const context = state.reservation.intent.executionContext;
        const prepared = await measureLatency(certified?.latencyRecorder, "prepare", () => adapter.prepare!(state));
        const description: PreparedDispatchDescriptionV1 = prepared.description;
        if (routeAuthority && (description.routeDigest !== routeAuthority.routeDigest || description.materializedRequestDigest !== routeAuthority.expectedMaterializedRequestDigest)) throw new Error("prepared dispatch does not match durable route authority");
        if (certified) { certified.onPhase?.("authority-validation-after-prepare"); const authorityAfter = await measureLatency(certified.latencyRecorder, "authority-validation-after-prepare", () => certified.revalidator.revalidate(state)); if (!authorityBefore || authorityAfter.authorityGeneration !== authorityBefore.authorityGeneration || authorityAfter.routeAuthorityDigest !== authorityBefore.routeAuthorityDigest || authorityAfter.authorityExpiresAt !== routeAuthority!.authorityExpiresAt || description.authorityGeneration !== authorityAfter.authorityGeneration || description.authorityExpiresAt !== routeAuthority!.authorityExpiresAt || authorityAfter.providerId !== undefined && authorityAfter.providerId !== routeAuthority!.providerId || authorityAfter.connectorId !== undefined && authorityAfter.connectorId !== routeAuthority!.connectorId || authorityAfter.accountId !== undefined && authorityAfter.accountId !== routeAuthority!.accountId || authorityAfter.endpointId !== undefined && authorityAfter.endpointId !== routeAuthority!.endpointId) throw new Error("dispatch authority changed during preparation"); }
        const budgetClaim = budgetFor(state);
        if (budget && budgetClaim) await budget.consumeOnce(budgetClaim);
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
        let outcome: DispatchOutcome;
        try { certified?.onPhase?.("authority-send-boundary"); outcome = await measureLatency(certified?.latencyRecorder, "authority-send-boundary", () => consumePreparedDispatch(prepared, lease)); certified?.onPhase?.("send"); }
        catch { outcome = { kind: "ambiguous", resultDigest: authorityDigest({ v: "reelier.dispatch-result/v1", reservationId, status: "ambiguous" }) }; }
        const current = await ledger.getReservation(reservationId);
        if (current?.state === "reserved") {
          const marked = await ledger.transition(reservationId, "reserved", { to: "dispatched" });
          if (!marked.ok) throw new Error(`dispatch transition refused: ${marked.reason}`);
        }
        const dispatchedRequestDigest = outcome.materializedRequestDigest ?? description.materializedRequestDigest;
        if (evidence) await evidence.persist({ state, outcome, dispatchedRequestDigest });
        const terminal = outcome.kind;
        const result = await measureLatency(certified?.latencyRecorder, "terminal-transition", () => ledger.transition(reservationId, "dispatched", terminal === "ambiguous" ? { to: "ambiguous" } : { to: terminal, resultDigest: outcome.resultDigest }));
        if (!result.ok) throw new Error(`dispatch result transition refused: ${result.reason}`);
        return Object.freeze({ ...outcome, materializedRequestDigest: dispatchedRequestDigest });
      }
      if (certified) throw new Error("certified dispatch requires prepared commit boundary");
      const transitioned = await ledger.transition(reservationId, "reserved", { to: "dispatched" });
      if (!transitioned.ok) throw new Error(`dispatch transition refused: ${transitioned.reason}`);
      const budgetClaim = budgetFor(state);
      if (budget && budgetClaim) await budget.consumeOnce(budgetClaim);
      let outcome: DispatchOutcome;
      try { outcome = await adapter.dispatch(state); }
      catch { outcome = { kind: "ambiguous", resultDigest: authorityDigest({ v: "reelier.dispatch-result/v1", reservationId, status: "ambiguous" }) }; }
      if (adapter.reconcile && outcome.kind !== "ambiguous") {
        try {
          outcome = Object.freeze(await adapter.reconcile(state, outcome));
        } catch {
          outcome = Object.freeze({ ...outcome, kind: "ambiguous", reconciliationStatus: "unavailable" as const, normalizedProjectionDigest: null });
        }
      }
      const dispatchedRequestDigest = outcome.materializedRequestDigest ?? authorityDigest({ v: "reelier.dispatched-request/v1", reservationId, effectDigest: state.effectDigest, effect: state.effect });
      if (!/^sha256:[0-9a-f]{64}$/.test(dispatchedRequestDigest)) throw new Error("dispatch request digest is invalid");
      if (evidence) await evidence.persist({ state, outcome, dispatchedRequestDigest });
      let published: Readonly<{ receiptRef: string; evidenceDigest: string }> | undefined;
      if (publication) { published = await publication.publish({ phase: "dispatch", state, outcome, dispatchedRequestDigest, priorReceiptDigest: null }); outcome = Object.freeze({ ...outcome, providerResultDigest: outcome.resultDigest, resultDigest: published.receiptRef, receiptRef: published.receiptRef, evidenceDigest: published.evidenceDigest }); }
      const terminal: LedgerState = outcome.kind;
      const result = await measureLatency(undefined, "terminal-transition", () => outcome.kind === "ambiguous"
        ? ledger.transition(reservationId, "dispatched", { to: "ambiguous" })
        : ledger.transition(reservationId, "dispatched", { to: terminal as "acknowledged" | "definitive-failure", resultDigest: outcome.resultDigest }));
      if (!result.ok) throw new Error(`dispatch result transition refused: ${result.reason}`);
      if (publication && published && outcome.reconciliationStatus && outcome.reconciliationStatus !== "not-attempted") {
        const reconciledState = { ...state, reservation: result.reservation } as DispatchRequestState;
        const reconciled = await publication.publish({ phase: "reconcile", state: reconciledState, outcome, dispatchedRequestDigest, priorReceiptDigest: published.receiptRef });
        const reconciliationTransition = await ledger.transition(reservationId, result.reservation.state, { to: "reconciled", resultDigest: reconciled.receiptRef });
        if (!reconciliationTransition.ok) throw new Error(`reconciliation transition refused: ${reconciliationTransition.reason}`);
        outcome = Object.freeze({ ...outcome, resultDigest: reconciled.receiptRef, receiptRef: reconciled.receiptRef, evidenceDigest: reconciled.evidenceDigest, priorReceiptDigest: published.receiptRef });
      }
      return Object.freeze(outcome);
    },
    async cancel(handle: ReservedDispatchHandle, reason = "cancelled-before-dispatch"): Promise<DispatchOutcome> {
      const state = unwrapReservedDispatchHandle(handle) as DispatchRequestState;
      if (!state.reservation || state.reservation.state !== "reserved") throw new TypeError("dispatch handle is not reserved");
      const resultDigest = authorityDigest({ v: "reelier.cancelled-result/v1", reservationId: state.reservation.reservationId, reason });
      const budgetClaim = budgetFor(state);
      if (budget && budgetClaim) await budget.returnOnce(budgetClaim);
      const outcome = Object.freeze({ kind: "definitive-failure" as const, resultDigest });
      const published = publication ? await publication.publish({ phase: "cancelled", state, outcome, dispatchedRequestDigest: null }) : undefined;
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
      const priorReceiptDigest = reservation.resultDigest ?? null;
      const pending = Object.freeze({
        kind: "ambiguous" as const,
        resultDigest: authorityDigest({ v: "reelier.ambiguous-result/v1", reservationId }),
        reconciliationStatus: "not-attempted" as const,
        normalizedProjectionDigest: null,
      });
      let outcome = Object.freeze(await adapter.reconcile(state, pending));
      if (outcome.reconciliationStatus === "not-attempted") throw new Error("reconciliation did not produce a verdict");
      const budgetClaim = budgetFor(state);
      if (budget && budgetClaim && outcome.reconciliationStatus === "not-applied") {
        if (budget.releaseConsumedOnce) await budget.releaseConsumedOnce(budgetClaim);
        else await budget.returnOnce(budgetClaim);
      }
      const published = publication ? await publication.publish({ phase: "reconcile", state, outcome, dispatchedRequestDigest: authorityDigest({ v: "reelier.dispatched-request/v1", reservationId, effectDigest: state.effectDigest, effect: state.effect }), priorReceiptDigest }) : undefined;
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
          const published = publication ? await publication.publish({ phase: "cancelled", state, outcome, dispatchedRequestDigest: null }) : undefined;
          const transitioned = await ledger.transition(reservation.reservationId, "reserved", { to: "cancelled", resultDigest: published?.receiptRef ?? resultDigest });
          if (!transitioned.ok) throw new Error(`cancellation recovery transition refused: ${transitioned.reason}`);
          continue;
        }
        if (reservation.state === "dispatched") {
          const resultDigest = authorityDigest({ v: "reelier.ambiguous-result/v1", reservationId: reservation.reservationId });
          const state = recoveredState(reservation);
          const outcome = Object.freeze({ kind: "ambiguous" as const, resultDigest });
          const published = publication ? await publication.publish({ phase: "ambiguous", state, outcome, dispatchedRequestDigest: authorityDigest({ v: "reelier.dispatched-request/v1", reservationId: reservation.reservationId, effectDigest: reservation.intent.effectDigest }) }) : undefined;
          const transitioned = await ledger.transition(reservation.reservationId, "dispatched", { to: "ambiguous" });
          if (!transitioned.ok) throw new Error(`ambiguity transition refused: ${transitioned.reason}`);
          ambiguous.push(reservation.reservationId);
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

async function measureLatency<T>(recorder: AuthorityLatencyRecorder | undefined, phase: AuthorityLatencyPhase, operation: () => T | Promise<T>): Promise<T> {
  return recorder ? recorder.measure(phase, operation) : operation();
}
