import { authorityDigest } from "../wire.js";
import { unwrapReservedDispatchHandle, type ReservedDispatchHandle } from "../gate.js";
import type { AuthorityLedger, LedgerState } from "../ledger.js";

export interface DispatchRequestState { readonly reservation: { readonly reservationId: string; readonly state: LedgerState; readonly intent: { readonly effectDigest: string } }; readonly effect: unknown; readonly effectCanonicalBase64: string; readonly effectDigest: string; readonly [key: string]: unknown; }
export interface DispatchOutcome { readonly kind: "acknowledged" | "definitive-failure" | "ambiguous"; readonly resultDigest: string; readonly providerStatus?: number; readonly responseDigest?: string; }
export interface DispatchAdapter { dispatch(state: DispatchRequestState): Promise<DispatchOutcome>; reconcile?(state: DispatchRequestState, outcome: DispatchOutcome): Promise<DispatchOutcome>; }
export interface DispatchEvidenceWriter { persist(input: Readonly<{ state: DispatchRequestState; outcome: DispatchOutcome; dispatchedRequestDigest: string; }>): Promise<void>; }
export interface DispatchCoordinator { dispatch(handle: ReservedDispatchHandle): Promise<DispatchOutcome>; cancel(handle: ReservedDispatchHandle, reason?: string): Promise<DispatchOutcome>; recover(): Promise<readonly string[]>; }

export function createDispatchCoordinator(ledger: AuthorityLedger, adapter: DispatchAdapter, evidence?: DispatchEvidenceWriter): DispatchCoordinator {
  return Object.freeze({
    async dispatch(handle: ReservedDispatchHandle): Promise<DispatchOutcome> {
      const state = unwrapReservedDispatchHandle(handle) as DispatchRequestState;
      if (!state.reservation || state.reservation.state !== "reserved") throw new TypeError("dispatch handle is not reserved");
      const reservationId = state.reservation.reservationId;
      const transitioned = await ledger.transition(reservationId, "reserved", { to: "dispatched" });
      if (!transitioned.ok) throw new Error(`dispatch transition refused: ${transitioned.reason}`);
      let outcome: DispatchOutcome;
      try { outcome = await adapter.dispatch(state); }
      catch { outcome = { kind: "ambiguous", resultDigest: authorityDigest({ v: "reelier.dispatch-result/v1", reservationId, status: "ambiguous" }) }; }
      if (evidence) await evidence.persist({ state, outcome, dispatchedRequestDigest: authorityDigest({ v: "reelier.dispatched-request/v1", reservationId, effectDigest: state.effectDigest, effect: state.effect }) });
      const terminal: LedgerState = outcome.kind;
      const result = await ledger.transition(reservationId, "dispatched", { to: terminal as "acknowledged" | "definitive-failure" | "ambiguous", resultDigest: outcome.resultDigest });
      if (!result.ok) throw new Error(`dispatch result transition refused: ${result.reason}`);
      return Object.freeze(outcome);
    },
    async cancel(handle: ReservedDispatchHandle, reason = "cancelled-before-dispatch"): Promise<DispatchOutcome> {
      const state = unwrapReservedDispatchHandle(handle) as DispatchRequestState;
      if (!state.reservation || state.reservation.state !== "reserved") throw new TypeError("dispatch handle is not reserved");
      const resultDigest = authorityDigest({ v: "reelier.cancelled-result/v1", reservationId: state.reservation.reservationId, reason });
      const result = await ledger.transition(state.reservation.reservationId, "reserved", { to: "cancelled", resultDigest });
      if (!result.ok) throw new Error(`cancellation refused: ${result.reason}`);
      return Object.freeze({ kind: "definitive-failure", resultDigest });
    },
    async recover(): Promise<readonly string[]> {
      const recovered = await ledger.recover();
      if (!recovered.ok) throw new Error(`authority recovery failed: ${recovered.reason}`);
      const ambiguous: string[] = [];
      for (const reservation of recovered.reservations) {
        if (reservation.state === "dispatched") {
          const resultDigest = authorityDigest({ v: "reelier.ambiguous-result/v1", reservationId: reservation.reservationId });
          const transitioned = await ledger.transition(reservation.reservationId, "dispatched", { to: "ambiguous", resultDigest });
          if (!transitioned.ok) throw new Error(`ambiguity transition refused: ${transitioned.reason}`);
          ambiguous.push(reservation.reservationId);
        }
      }
      return Object.freeze(ambiguous);
    },
  });
}
