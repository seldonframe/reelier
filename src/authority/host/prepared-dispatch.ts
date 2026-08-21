import type { DispatchOutcome } from "./dispatch.js";
import { materializedHttpRequestDigest, type MaterializedHttpRequestProjectionV1 } from "./http-response-semantics.js";
import { authorityDigest } from "../wire.js";
import { isProxy } from "node:util/types";

export type { MaterializedHttpRequestProjectionV1 };

/** Credential-free commitment for prepared effects that are not HTTP requests. */
export interface PreparedEffectProjectionV1 {
  readonly v: "reelier.prepared-effect-projection/v1";
  readonly transport: string;
  readonly operationDigest: string;
  readonly requestDigest: string;
}
export type PreparedDispatchProjectionV1 = MaterializedHttpRequestProjectionV1 | PreparedEffectProjectionV1;

const DIGEST = /^sha256:(?!0{64}$)[0-9a-f]{64}$/;
const preparedBrand = Symbol("reelier.prepared-dispatch");
const commitBrand = Symbol("reelier.dispatch-commit-lease");

export interface PreparedDispatchDescriptionV1 {
  readonly v: "reelier.prepared-dispatch-description/v1";
  readonly routeDigest: string;
  readonly materializedRequestDigest: string;
  readonly projection: PreparedDispatchProjectionV1;
  readonly authorityGeneration: string;
  readonly authorityExpiresAt: string;
  readonly absoluteDeadlineMs: number;
  readonly reservationId: string;
  readonly allocationId: string;
  /** Commits the reviewed route, operator configuration, and response behavior. */
  readonly behaviorDigest?: string;
}

/** Closed, restart-safe subset of a prepared dispatch. It binds both external routes and
 * host-owned internal sagas without pretending that every dispatch has provider route authority. */
export interface PreparedDispatchBindingV1 {
  readonly v: "reelier.prepared-dispatch-binding/v1";
  readonly routeDigest: string;
  readonly materializedRequestDigest: string;
  readonly authorityGeneration: string;
  readonly authorityExpiresAt: string;
  readonly behaviorDigest: string | null;
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
  const raw = inertRecord(input, ["description", "send"], ["monotonicNow", "wallClockNow", "requireCoordinatorCommit"], "prepared dispatch");
  if (typeof raw.send !== "function") throw new TypeError("prepared dispatch is invalid");
  const description = validateDescription(raw.description as PreparedDispatchDescriptionV1);
  const capability = Object.freeze(Object.defineProperty({ [preparedBrand]: true as const } as { [preparedBrand]: true; description: PreparedDispatchDescriptionV1 }, "description", { value: description, enumerable: false, writable: false, configurable: false }));
  preparedStates.set(capability, { description, send: raw.send as () => Promise<DispatchOutcome>, monotonicNow: typeof raw.monotonicNow === "function" ? raw.monotonicNow as () => number : (() => performance.now()), wallClockNow: typeof raw.wallClockNow === "function" ? raw.wallClockNow as () => number : (() => Date.now()), requireCoordinatorCommit: raw.requireCoordinatorCommit === true });
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

export function preparedDispatchBinding(description: PreparedDispatchDescriptionV1): PreparedDispatchBindingV1 {
  const value = validateDescription(description);
  return Object.freeze({
    v: "reelier.prepared-dispatch-binding/v1",
    routeDigest: value.routeDigest,
    materializedRequestDigest: value.materializedRequestDigest,
    authorityGeneration: value.authorityGeneration,
    authorityExpiresAt: value.authorityExpiresAt,
    behaviorDigest: value.behaviorDigest ?? null,
  });
}

export function validatePreparedDispatchBinding(value: unknown): PreparedDispatchBindingV1 {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("prepared dispatch binding is invalid");
  const keys = ["v", "routeDigest", "materializedRequestDigest", "authorityGeneration", "authorityExpiresAt", "behaviorDigest"] as const;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !(key in descriptors)) || Reflect.ownKeys(value).some(key => typeof key !== "string" || !keys.includes(key as typeof keys[number])) || Object.values(descriptors).some(descriptor => !("value" in descriptor) || !descriptor.enumerable)) throw new TypeError("prepared dispatch binding is not closed");
  const raw = value as Record<typeof keys[number], unknown>;
  if (raw.v !== "reelier.prepared-dispatch-binding/v1" || !DIGEST.test(String(raw.routeDigest)) || !DIGEST.test(String(raw.materializedRequestDigest)) || typeof raw.authorityGeneration !== "string" || raw.authorityGeneration.length === 0 || typeof raw.authorityExpiresAt !== "string" || !Number.isFinite(Date.parse(raw.authorityExpiresAt)) || raw.behaviorDigest !== null && !DIGEST.test(String(raw.behaviorDigest))) throw new TypeError("prepared dispatch binding is invalid");
  return Object.freeze({ v: raw.v, routeDigest: String(raw.routeDigest), materializedRequestDigest: String(raw.materializedRequestDigest), authorityGeneration: raw.authorityGeneration, authorityExpiresAt: raw.authorityExpiresAt, behaviorDigest: raw.behaviorDigest === null ? null : String(raw.behaviorDigest) });
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
  try { return inertDispatchOutcome(await state.send()); }
  catch { return Object.freeze({ kind: "ambiguous" as const, resultDigest: preparedDispatchProjectionDigest(description.projection) }); }
}

function validateDescription(value: PreparedDispatchDescriptionV1): PreparedDispatchDescriptionV1 {
  const raw = inertRecord(value, ["v", "routeDigest", "materializedRequestDigest", "projection", "authorityGeneration", "authorityExpiresAt", "absoluteDeadlineMs", "reservationId", "allocationId"], ["behaviorDigest"], "prepared dispatch description");
  if (raw.v !== "reelier.prepared-dispatch-description/v1" || typeof raw.routeDigest !== "string" || !DIGEST.test(raw.routeDigest) || typeof raw.materializedRequestDigest !== "string" || !DIGEST.test(raw.materializedRequestDigest) || typeof raw.reservationId !== "string" || !raw.reservationId || typeof raw.allocationId !== "string" || !raw.allocationId || typeof raw.authorityGeneration !== "string" || !raw.authorityGeneration || !Number.isFinite(raw.absoluteDeadlineMs)) throw new TypeError("prepared dispatch description is invalid");
  if (raw.behaviorDigest !== undefined && (typeof raw.behaviorDigest !== "string" || !DIGEST.test(raw.behaviorDigest))) throw new TypeError("prepared dispatch behavior digest is invalid");
  const projection = validateProjection(raw.projection as PreparedDispatchProjectionV1);
  if (preparedDispatchProjectionDigest(projection) !== raw.materializedRequestDigest) throw new TypeError("prepared request digest does not match projection");
  if (typeof raw.authorityExpiresAt !== "string" || !Number.isFinite(Date.parse(raw.authorityExpiresAt))) throw new TypeError("prepared dispatch expiry is invalid");
  return Object.freeze({ v: "reelier.prepared-dispatch-description/v1", routeDigest: raw.routeDigest, materializedRequestDigest: raw.materializedRequestDigest, projection, authorityGeneration: raw.authorityGeneration, authorityExpiresAt: raw.authorityExpiresAt, absoluteDeadlineMs: raw.absoluteDeadlineMs as number, reservationId: raw.reservationId, allocationId: raw.allocationId, ...(raw.behaviorDigest === undefined ? {} : { behaviorDigest: raw.behaviorDigest as string }) });
}

export function preparedDispatchProjectionDigest(value: PreparedDispatchProjectionV1): string {
  const projection = validateProjection(value);
  return projection.v === "reelier.materialized-http-request/v1" ? materializedHttpRequestDigest(projection) : authorityDigest(projection);
}

function validateProjection(value: PreparedDispatchProjectionV1): PreparedDispatchProjectionV1 {
  const version = value && typeof value === "object" && !isProxy(value) ? Object.getOwnPropertyDescriptor(value, "v") : undefined;
  if (!version || !version.enumerable || !Object.hasOwn(version, "value")) throw new TypeError("prepared projection requires inert data properties");
  if (version.value !== "reelier.materialized-http-request/v1") return validateNeutralProjection(value);
  const raw = inertRecord(value, ["v", "method", "origin", "normalizedPath", "normalizedQuery", "reviewedHeaders", "bodyDigest"], [], "materialized HTTP projection");
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(raw.method as string) || typeof raw.origin !== "string" || typeof raw.normalizedPath !== "string" || typeof raw.normalizedQuery !== "string" || typeof raw.bodyDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(raw.bodyDigest)) throw new TypeError("materialized HTTP projection primitives are invalid");
  const headersRaw = raw.reviewedHeaders;
  if (!headersRaw || typeof headersRaw !== "object" || Array.isArray(headersRaw) || isProxy(headersRaw) || Object.getPrototypeOf(headersRaw) !== Object.prototype) throw new TypeError("materialized HTTP headers are not inert");
  const headers: Record<string, string> = {}; let count = 0;
  for (const name in headersRaw) { if (!Object.hasOwn(headersRaw, name)) continue; if (++count > 64) throw new TypeError("materialized HTTP headers are too large"); const descriptor = Object.getOwnPropertyDescriptor(headersRaw, name); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string") throw new TypeError("materialized HTTP headers require data properties"); headers[name] = descriptor.value; }
  return Object.freeze({ v: raw.v, method: raw.method, origin: raw.origin, normalizedPath: raw.normalizedPath, normalizedQuery: raw.normalizedQuery, reviewedHeaders: Object.freeze(headers), bodyDigest: raw.bodyDigest } as MaterializedHttpRequestProjectionV1);
}

function validateNeutralProjection(value: PreparedDispatchProjectionV1): PreparedEffectProjectionV1 {
  const raw = inertRecord(value, ["v", "transport", "operationDigest", "requestDigest"], [], "prepared effect projection");
  if (raw.v !== "reelier.prepared-effect-projection/v1" || typeof raw.transport !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(raw.transport) || typeof raw.operationDigest !== "string" || !DIGEST.test(raw.operationDigest) || typeof raw.requestDigest !== "string" || !DIGEST.test(raw.requestDigest)) throw new TypeError("prepared effect projection is invalid");
  return Object.freeze({ v: raw.v, transport: raw.transport, operationDigest: raw.operationDigest, requestDigest: raw.requestDigest });
}

function inertRecord(value: unknown, required: readonly string[], optional: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be inert data`);
  const allowed = new Set([...required, ...optional]); let count = 0;
  for (const key in value) { if (!Object.hasOwn(value, key)) continue; if (++count > 64 || !allowed.has(key)) throw new TypeError(`${label} is not closed`); }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of required) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} requires data properties`); result[key] = descriptor.value; }
  for (const key of optional) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable) continue; if (!Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} requires data properties`); result[key] = descriptor.value; }
  return result;
}

function inertDispatchOutcome(value: unknown): DispatchOutcome {
  const raw = inertRecord(value, ["kind", "resultDigest"], ["providerResultDigest", "providerStatus", "responseDigest", "materializedRequestDigest", "reconciliationStatus", "normalizedProjectionDigest", "receiptRef", "evidenceDigest", "priorReceiptDigest"], "prepared dispatch result");
  if (!["acknowledged", "definitive-failure", "ambiguous"].includes(raw.kind as string) || typeof raw.resultDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(raw.resultDigest)) throw new TypeError("prepared dispatch result is invalid");
  return Object.freeze(Object.fromEntries(Object.keys(raw).map(key => [key, raw[key]])) as unknown as DispatchOutcome);
}
