import type { DispatchOutcome } from "./dispatch.js";
import { materializedHttpRequestDigest, type MaterializedHttpRequestProjectionV1 } from "./http-response-semantics.js";

export type { MaterializedHttpRequestProjectionV1 };

const DIGEST = /^sha256:(?!0{64}$)[0-9a-f]{64}$/;
const preparedBrand = Symbol("reelier.prepared-dispatch");
const commitBrand = Symbol("reelier.dispatch-commit-lease");

export interface PreparedDispatchDescriptionV1 {
  readonly v: "reelier.prepared-dispatch-description/v1";
  readonly routeDigest: string;
  readonly materializedRequestDigest: string;
  readonly projection: MaterializedHttpRequestProjectionV1;
  readonly authorityGeneration: string;
  readonly authorityExpiresAt: string;
  readonly absoluteDeadlineMs: number;
  readonly reservationId: string;
  readonly allocationId: string;
  /** Commits the reviewed route, operator configuration, and response behavior. */
  readonly behaviorDigest?: string;
}

export interface PreparedDispatch { readonly [preparedBrand]: true; readonly description: PreparedDispatchDescriptionV1 }
export interface DispatchCommitLease { readonly [commitBrand]: true }

type PreparedState = { readonly description: PreparedDispatchDescriptionV1; readonly send: () => Promise<DispatchOutcome>; readonly monotonicNow: () => number; readonly wallClockNow: () => number; readonly requireCoordinatorCommit: boolean };
type CommitState = {
  readonly reservationId: string; readonly allocationId: string; readonly preparedDigest: string;
  readonly authorityGeneration: string; readonly authorityExpiresAt: string; readonly absoluteDeadlineMs: number; readonly commitGeneration: string;
  readonly commit?: (description: PreparedDispatchDescriptionV1) => Promise<void>;
};

const preparedStates = new WeakMap<object, PreparedState>();
const commitStates = new WeakMap<object, CommitState>();
const coordinatorCommittedLeases = new WeakSet<object>();
const coordinatorReconciliations = new WeakMap<object, Readonly<{ reservationId: string; allocationId: string; effectDigest: string }>>();

export function createPreparedDispatch(input: Readonly<{ description: PreparedDispatchDescriptionV1; send: () => Promise<DispatchOutcome>; monotonicNow?: () => number; wallClockNow?: () => number; /** @internal Host-only release boundary. */ requireCoordinatorCommit?: boolean }>): PreparedDispatch {
  if (!input || typeof input !== "object" || typeof input.send !== "function") throw new TypeError("prepared dispatch is invalid");
  const description = validateDescription(input.description);
  const capability = Object.freeze(Object.defineProperty({ [preparedBrand]: true as const } as { [preparedBrand]: true; description: PreparedDispatchDescriptionV1 }, "description", { value: description, enumerable: false, writable: false, configurable: false }));
  preparedStates.set(capability, { description, send: input.send, monotonicNow: input.monotonicNow ?? (() => performance.now()), wallClockNow: input.wallClockNow ?? (() => Date.now()), requireCoordinatorCommit: input.requireCoordinatorCommit === true });
  return capability;
}

export function createDispatchCommitLease(input: Readonly<CommitState>): DispatchCommitLease {
  if (!input || typeof input !== "object" || !DIGEST.test(input.preparedDigest) || !input.reservationId || !input.allocationId || !input.authorityGeneration || !input.commitGeneration || !Number.isFinite(input.absoluteDeadlineMs)) throw new TypeError("dispatch commit lease is invalid");
  if (!DIGEST.test(input.preparedDigest)) throw new TypeError("dispatch commit lease digest is invalid");
  const capability = Object.freeze({ [commitBrand]: true as const });
  commitStates.set(capability, Object.freeze({ ...input }));
  return capability;
}

export function describePreparedDispatch(capability: PreparedDispatch): PreparedDispatchDescriptionV1 {
  const state = preparedStates.get(capability as object);
  if (!state) throw new TypeError("invalid or consumed prepared dispatch");
  return state.description;
}

/** @internal Minted only by DispatchCoordinator after budget consumption and durable commit CAS. */
export function authorizeCoordinatorCommittedLease(commitLease: DispatchCommitLease): void {
  if (!commitStates.has(commitLease as object)) throw new TypeError("dispatch commit lease is invalid or consumed");
  coordinatorCommittedLeases.add(commitLease as object);
}

/** @internal Binds one reconciliation attempt to a ledger-reread ambiguous reservation. */
export function authorizeCoordinatorReconciliation(state: object, binding: Readonly<{ reservationId: string; allocationId: string; effectDigest: string }>): void {
  if (!state || typeof state !== "object" || !binding.reservationId || !binding.allocationId || !DIGEST.test(binding.effectDigest)) throw new TypeError("coordinator reconciliation binding is invalid");
  coordinatorReconciliations.set(state, Object.freeze({ ...binding }));
}

/** @internal Consumes the coordinator-only ambiguous-reconciliation authority. */
export function consumeCoordinatorReconciliation(state: object, expected: Readonly<{ reservationId: string; allocationId: string; effectDigest: string }>): void {
  const binding = coordinatorReconciliations.get(state);
  coordinatorReconciliations.delete(state);
  if (!binding || binding.reservationId !== expected.reservationId || binding.allocationId !== expected.allocationId || binding.effectDigest !== expected.effectDigest) throw new TypeError("release reconciliation requires a coordinator-minted ambiguous-reconcile capability");
}

/** Jointly consumes both capabilities. The commit callback is the durable send-started boundary. */
export async function consumePreparedDispatch(prepared: PreparedDispatch, commitLease: DispatchCommitLease): Promise<DispatchOutcome> {
  const state = preparedStates.get(prepared as object);
  const lease = commitStates.get(commitLease as object);
  if (!state || !lease) throw new TypeError("prepared dispatch or commit lease is invalid or consumed");
  const description = state.description;
  if (lease.reservationId !== description.reservationId || lease.allocationId !== description.allocationId || lease.preparedDigest !== description.materializedRequestDigest || lease.authorityGeneration !== description.authorityGeneration || lease.authorityExpiresAt !== description.authorityExpiresAt || lease.absoluteDeadlineMs !== description.absoluteDeadlineMs) throw new TypeError("prepared dispatch and commit lease binding mismatch");
  if (state.requireCoordinatorCommit && !coordinatorCommittedLeases.has(commitLease as object)) throw new TypeError("prepared dispatch requires a coordinator-minted commit capability");
  if (Date.parse(description.authorityExpiresAt) <= state.wallClockNow()) throw new Error("authority lease expired before send");
  if (!Number.isFinite(description.absoluteDeadlineMs) || state.monotonicNow() >= description.absoluteDeadlineMs) throw new Error("dispatch deadline expired before send");
  // Claim both capabilities synchronously, before the first await. Promise races therefore
  // leave exactly one winner and can never invoke the consequential send twice.
  preparedStates.delete(prepared as object);
  commitStates.delete(commitLease as object);
  coordinatorCommittedLeases.delete(commitLease as object);
  if (lease.commit) await lease.commit(description);
  try { return Object.freeze(await state.send()); }
  catch { return Object.freeze({ kind: "ambiguous" as const, resultDigest: materializedHttpRequestDigest({ ...description.projection, v: "reelier.materialized-http-request/v1" }) }); }
}

function validateDescription(value: PreparedDispatchDescriptionV1): PreparedDispatchDescriptionV1 {
  if (!value || typeof value !== "object" || value.v !== "reelier.prepared-dispatch-description/v1") throw new TypeError("prepared dispatch description is invalid");
  if (!DIGEST.test(value.routeDigest) || !DIGEST.test(value.materializedRequestDigest) || !value.reservationId || !value.allocationId || !value.authorityGeneration || !Number.isFinite(value.absoluteDeadlineMs)) throw new TypeError("prepared dispatch description is invalid");
  if (value.behaviorDigest !== undefined && !DIGEST.test(value.behaviorDigest)) throw new TypeError("prepared dispatch behavior digest is invalid");
  const projection = Object.freeze({ ...value.projection, reviewedHeaders: Object.freeze({ ...value.projection.reviewedHeaders }) });
  if (materializedHttpRequestDigest(projection) !== value.materializedRequestDigest) throw new TypeError("prepared request digest does not match projection");
  if (!Number.isFinite(Date.parse(value.authorityExpiresAt))) throw new TypeError("prepared dispatch expiry is invalid");
  return Object.freeze({ ...value, projection });
}
