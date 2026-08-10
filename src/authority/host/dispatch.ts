import { authorityDigest } from "../wire.js";
import { unwrapReservedDispatchHandle, type ReservedDispatchHandle } from "../gate.js";
import type { AuthorityLedger, LedgerState, StoredReservationIntent } from "../ledger.js";

export interface DispatchRequestState { readonly reservation: { readonly reservationId: string; readonly state: LedgerState; readonly intent: Pick<StoredReservationIntent, "effectDigest" | "effectCanonicalBase64" | "executionContext"> }; readonly effect: unknown; readonly effectCanonicalBase64: string; readonly effectDigest: string; readonly [key: string]: unknown; }
export type ReconciliationStatus = "matched" | "not-applied" | "conflict" | "unavailable" | "not-attempted";
export interface DispatchOutcome { readonly kind: "acknowledged" | "definitive-failure" | "ambiguous"; readonly resultDigest: string; readonly providerResultDigest?: string; readonly providerStatus?: number; readonly responseDigest?: string; readonly reconciliationStatus?: ReconciliationStatus; readonly normalizedProjectionDigest?: string | null; readonly receiptRef?: string; readonly evidenceDigest?: string; readonly priorReceiptDigest?: string; }
export interface DispatchAdapter { dispatch(state: DispatchRequestState): Promise<DispatchOutcome>; reconcile?(state: DispatchRequestState, outcome: DispatchOutcome): Promise<DispatchOutcome>; }
export interface DispatchEvidenceWriter { persist(input: Readonly<{ state: DispatchRequestState; outcome: DispatchOutcome; dispatchedRequestDigest: string; }>): Promise<void>; }
export interface DispatchPublication { publish(input: Readonly<{ phase: "dispatch" | "cancelled" | "ambiguous" | "reconcile"; state: DispatchRequestState; outcome: DispatchOutcome; dispatchedRequestDigest: string | null; priorReceiptDigest?: string | null; }>): Promise<Readonly<{ receiptRef: string; evidenceDigest: string }>>; }
export interface DispatchCoordinator { dispatch(handle: ReservedDispatchHandle): Promise<DispatchOutcome>; cancel(handle: ReservedDispatchHandle, reason?: string): Promise<DispatchOutcome>; reconcile(reservationId: string): Promise<DispatchOutcome>; recover(): Promise<readonly string[]>; }
export interface DispatchBudget { consumeOnce(input: Readonly<{ allocationId: string; reservationId: string; effects: number }>): Promise<unknown>; returnOnce(input: Readonly<{ allocationId: string; reservationId: string; effects: number }>): Promise<unknown>; releaseConsumedOnce?(input: Readonly<{ allocationId: string; reservationId: string; effects: number }>): Promise<unknown>; }

export function createDispatchCoordinator(ledger: AuthorityLedger, adapter: DispatchAdapter, evidence?: DispatchEvidenceWriter, publication?: DispatchPublication, budget?: DispatchBudget): DispatchCoordinator {
  const budgetFor = (state: DispatchRequestState): { allocationId: string; reservationId: string; effects: number } | undefined => {
    const context = state.reservation.intent.executionContext;
    return context ? { allocationId: context.allocationId, reservationId: state.reservation.reservationId, effects: 1 } : undefined;
  };
  return Object.freeze({
    async dispatch(handle: ReservedDispatchHandle): Promise<DispatchOutcome> {
      const state = unwrapReservedDispatchHandle(handle) as DispatchRequestState;
      if (!state.reservation || state.reservation.state !== "reserved") throw new TypeError("dispatch handle is not reserved");
      const reservationId = state.reservation.reservationId;
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
      const dispatchedRequestDigest = authorityDigest({ v: "reelier.dispatched-request/v1", reservationId, effectDigest: state.effectDigest, effect: state.effect });
      if (evidence) await evidence.persist({ state, outcome, dispatchedRequestDigest });
      let published: Readonly<{ receiptRef: string; evidenceDigest: string }> | undefined;
      if (publication) { published = await publication.publish({ phase: "dispatch", state, outcome, dispatchedRequestDigest, priorReceiptDigest: null }); outcome = Object.freeze({ ...outcome, providerResultDigest: outcome.resultDigest, resultDigest: published.receiptRef, receiptRef: published.receiptRef, evidenceDigest: published.evidenceDigest }); }
      const terminal: LedgerState = outcome.kind;
      const result = outcome.kind === "ambiguous"
        ? await ledger.transition(reservationId, "dispatched", { to: "ambiguous" })
        : await ledger.transition(reservationId, "dispatched", { to: terminal as "acknowledged" | "definitive-failure", resultDigest: outcome.resultDigest });
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
          const transitioned = await ledger.transition(reservation.reservationId, "dispatched", { to: "ambiguous", resultDigest: published?.receiptRef ?? resultDigest });
          if (!transitioned.ok) throw new Error(`ambiguity transition refused: ${transitioned.reason}`);
          ambiguous.push(reservation.reservationId);
        }
      }
      return Object.freeze(ambiguous);
    },
  });
}

function recoveredState(reservation: DispatchRequestState["reservation"]): DispatchRequestState {
  const encoded = reservation.intent.effectCanonicalBase64;
  let effect: unknown = {};
  if (encoded) {
    try { effect = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")); } catch { effect = {}; }
  }
  return { reservation, effect, effectCanonicalBase64: encoded ?? "", effectDigest: reservation.intent.effectDigest } as DispatchRequestState;
}
