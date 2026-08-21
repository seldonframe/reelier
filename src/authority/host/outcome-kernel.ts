import type { AuthorityLedger, LedgerState } from "../ledger.js";
import type { ReservedDispatchHandle } from "../gate.js";
import { isProxy } from "node:util/types";
import { authorityDigest } from "../wire.js";
import {
  digestGovernedOutcomeV1,
  digestGovernedReceiptV1,
  digestMissionClaimV1,
  digestToolEffectContractV1,
  parseMissionClaimV1,
  parseAttemptV1,
  parseEffectReservationV1,
  parseGovernedOutcomeV1,
  parseGovernedReceiptV1,
  parseObservationV1,
  parseToolEffectContractV1,
  verifyGovernedOutcomeTransitionV1,
  type AttemptV1,
  type EffectReservationV1,
  type EvidenceGradeV1,
  type GovernedOutcomeV1,
  type GovernedReceiptV1,
  type MissionClaimV1,
  type ObservationV1,
  type ToolEffectContractV1,
} from "../tool-effect-contract.js";
import type { DispatchCoordinator, DispatchOutcome, DispatchReservationProjectionV1 } from "./dispatch.js";
import { constructGovernedReceiptV1 } from "./receipt-authority.js";

const trustedVerifierStates = new WeakMap<object, Readonly<{ contractDigest: string; verify: (observation: ObservationV1) => boolean }>>();
const trustedPredecessorPolicyStates = new WeakMap<object, Readonly<{ predecessorContractDigest: string; successorContractDigest: string }>>();
declare const trustedVerifierBrand: unique symbol;
export type TrustedObservationVerifierV1 = Readonly<{ readonly [trustedVerifierBrand]: true }>;
declare const trustedPredecessorPolicyBrand: unique symbol;
export type TrustedOutcomePredecessorPolicyV1 = Readonly<{ readonly [trustedPredecessorPolicyBrand]: true }>;

/** Host-minted capability. The verifier is never copied into mission or effect input. */
export function createTrustedObservationVerifier(input: Readonly<{ contractDigest: string; verify: (observation: ObservationV1) => boolean }>): TrustedObservationVerifierV1 {
  if (!/^sha256:[0-9a-f]{64}$/.test(input?.contractDigest) || typeof input.verify !== "function") throw new TypeError("trusted observation verifier is invalid");
  const capability = Object.freeze(Object.create(null)) as TrustedObservationVerifierV1;
  trustedVerifierStates.set(capability as object, Object.freeze({ contractDigest: input.contractDigest, verify: input.verify }));
  return capability;
}

/** Host-minted policy. Caller DTOs cannot manufacture or inspect the predecessor binding. */
export function createTrustedOutcomePredecessorPolicyV1(input: Readonly<{ predecessorContractDigest: string; successorContractDigest: string }>): TrustedOutcomePredecessorPolicyV1 {
  const parsed = dataRecord(input, ["predecessorContractDigest", "successorContractDigest"], [], "trusted Outcome predecessor policy");
  if (typeof parsed.predecessorContractDigest !== "string" || !SHA.test(parsed.predecessorContractDigest) || typeof parsed.successorContractDigest !== "string" || !SHA.test(parsed.successorContractDigest) || parsed.predecessorContractDigest === parsed.successorContractDigest) throw new TypeError("trusted Outcome predecessor policy is invalid");
  const capability = Object.freeze(Object.create(null)) as TrustedOutcomePredecessorPolicyV1;
  trustedPredecessorPolicyStates.set(capability as object, Object.freeze({ predecessorContractDigest: parsed.predecessorContractDigest, successorContractDigest: parsed.successorContractDigest }));
  return capability;
}

export interface StoredEffectLifecycleV1 {
  readonly v: "reelier.stored-effect-lifecycle/v1";
  readonly missionId: string;
  readonly missionDigest: string;
  readonly contractDigest: string;
  readonly reservation: EffectReservationV1;
  readonly attempt: AttemptV1 | null;
  readonly observation: ObservationV1 | null;
  readonly outcome: GovernedOutcomeV1 | null;
  readonly revision: number;
}

export interface OutcomeKernelStorage {
  readonly durable: boolean;
  claimMission(claim: MissionClaimV1, claimDigest: string): Promise<Readonly<{ status: "claimed" | "exact-existing"; claim: MissionClaimV1 }> | Readonly<{ status: "conflict" }>>;
  loadMission(missionId: string): Promise<MissionClaimV1 | null>;
  loadEffect(missionId: string, reservationId: string): Promise<StoredEffectLifecycleV1 | null>;
  storeEffect(value: StoredEffectLifecycleV1, expectedRevision: number): Promise<Readonly<{ status: "stored"; value: StoredEffectLifecycleV1 }> | Readonly<{ status: "conflict" }>>;
  compareAndPublishReceipt(receipt: GovernedReceiptV1, receiptDigest: string): Promise<Readonly<{ status: "published" | "exact-existing"; receiptDigest: string; receiptRef: string }> | Readonly<{ status: "conflict" }>>;
  loadReceipt(receiptId: string): Promise<Readonly<{ receiptId: string; receiptDigest: string; receiptRef: string }> | null>;
}

export interface MissionOutcomeV1 {
  readonly v: "reelier.mission-outcome/v1";
  readonly missionId: string;
  readonly effects: readonly GovernedOutcomeV1[];
  readonly status: EvidenceGradeV1;
  readonly receiptsDurable: boolean;
  readonly receiptRefs: readonly string[];
}

export interface OutcomeKernel {
  claimMission(claim: MissionClaimV1): Promise<Readonly<{ status: "claimed" | "exact-existing"; claim: MissionClaimV1 }>>;
  execute(input: Readonly<{ missionId: string; effects: readonly OutcomeKernelEffectRequestV1[] }>): Promise<MissionOutcomeV1>;
}
export type OutcomeKernelEffectRequestV1 = Readonly<{ contract: ToolEffectContractV1; verifier: TrustedObservationVerifierV1 } & ({ handle: ReservedDispatchHandle; reservationId?: never } | { handle?: never; reservationId: string })>;

export interface OutcomeKernelOptions {
  readonly ledger: AuthorityLedger;
  readonly coordinator: DispatchCoordinator;
  readonly storage?: OutcomeKernelStorage;
  readonly mode?: "durable" | "hermetic";
  readonly now: () => number;
  readonly authorization: (input: Readonly<{ mission: MissionClaimV1; contract: ToolEffectContractV1; reservation: DispatchReservationProjectionV1 }>) => Promise<"active" | "revoked" | "expired">;
  readonly predecessorPolicy?: TrustedOutcomePredecessorPolicyV1;
  readonly onBoundary?: (boundary: "mission-claim" | "reservation" | "provider-response" | "attempt" | "observation" | "outcome" | "receipt") => void;
}

export function createOutcomeKernel(options: OutcomeKernelOptions): OutcomeKernel {
  if (!options || typeof options !== "object" || typeof options.now !== "function" || typeof options.authorization !== "function") throw new TypeError("outcome kernel options are invalid");
  const hermetic = options.mode === "hermetic";
  const storage = options.storage ?? (hermetic ? createHermeticStorage() : undefined);
  if (!storage || (!storage.durable && !hermetic)) throw new TypeError("durable storage is required outside explicit hermetic mode");
  const predecessorPolicy = options.predecessorPolicy === undefined ? undefined : trustedPredecessorPolicyStates.get(options.predecessorPolicy as object);
  if (options.predecessorPolicy !== undefined && !predecessorPolicy) throw new TypeError("trusted Outcome predecessor policy capability is invalid");
  const boundary = (name: Parameters<NonNullable<OutcomeKernelOptions["onBoundary"]>>[0]) => options.onBoundary?.(name);

  return Object.freeze({
    async claimMission(rawClaim: MissionClaimV1) {
      const claim = parseMissionClaimV1(rawClaim), digest = digestMissionClaimV1(claim);
      const claimed = parseMissionClaimResult(await storage.claimMission(claim, digest));
      if (claimed.status === "conflict") throw new Error("mission claim semantics conflict");
      if (claimed.claim.missionId !== claim.missionId || digestMissionClaimV1(claimed.claim) !== digest) throw new Error("mission claim result does not bind the submitted mission digest");
      boundary("mission-claim");
      return Object.freeze({ status: claimed.status, claim: parseMissionClaimV1(claimed.claim) });
    },

    async execute(input: Readonly<{ missionId: string; effects: readonly OutcomeKernelEffectRequestV1[] }>): Promise<MissionOutcomeV1> {
      const request = parseExecuteRequest(input);
      const mission = await storage.loadMission(request.missionId);
      if (!mission) throw new Error("mission claim is absent");
      const parsedMission = parseMissionClaimV1(mission), missionDigest = digestMissionClaimV1(parsedMission);
      if (parsedMission.missionId !== request.missionId) throw new Error("loaded mission does not bind the queried mission ID");
      const effects: GovernedOutcomeV1[] = [], receiptRefs: string[] = [];
      let receiptsDurable = storage.durable;

      for (const requested of request.effects) {
        const contract = parseToolEffectContractV1(requested.contract), contractDigest = digestToolEffectContractV1(contract);
        if (!parsedMission.contractDigests.includes(contractDigest)) throw new Error("effect contract is outside the mission claim");
        let described: DispatchReservationProjectionV1;
        if (requested.handle) {
          if (!options.coordinator.describe) throw new TypeError("outcome kernel requires a coordinator reservation projection hook");
          described = parseDispatchReservationProjection(options.coordinator.describe(requested.handle));
        } else {
          const restarted = parseLedgerProjection(await options.ledger.getReservation(requested.reservationId));
          if (!restarted) throw new Error("durable reservation is absent on restart");
          described = Object.freeze({ reservationId: restarted.reservationId, state: restarted.state, effectDigest: restarted.effectDigest, allocationId: restarted.allocationId });
        }
        let current = parseLedgerProjection(await options.ledger.getReservation(described.reservationId));
        if (!current || described.effectDigest !== contractDigest || current.effectDigest !== contractDigest || current.reservationId !== described.reservationId || current.state !== described.state || current.allocationId !== described.allocationId) throw new Error("durable reservation projection does not bind the exact contract, state, and allocation");
        let stored = parseStoredEffect(await storage.loadEffect(parsedMission.missionId, current.reservationId));
        if (stored && (stored.missionId !== parsedMission.missionId || stored.reservation.reservationId !== current.reservationId || stored.missionDigest !== missionDigest || stored.contractDigest !== contractDigest || stored.reservation.semanticIdentity !== contract.semanticIdentity)) throw new Error("stored effect identity or semantics conflict");
        if (!stored) {
          const reservation: EffectReservationV1 = Object.freeze({ v: "reelier.effect-reservation/v1", reservationId: current.reservationId, semanticIdentity: contract.semanticIdentity, contractDigest, reservedAt: reservationTime(current, parsedMission.claimedAt) });
          stored = await persist(storage, Object.freeze({ v: "reelier.stored-effect-lifecycle/v1", missionId: parsedMission.missionId, missionDigest, contractDigest, reservation, attempt: null, observation: null, outcome: null, revision: 0 }), 0);
          boundary("reservation");
        }

        if (predecessorPolicy?.successorContractDigest === contractDigest) await requireVerifiedPredecessor(storage, parsedMission, missionDigest, effects, predecessorPolicy.predecessorContractDigest);

        const resumablePending = stored.outcome?.status === "pending" && (current.state === "ambiguous" || current.state === "dispatched");
        if (stored.outcome && !resumablePending) {
          const adopted = stored.outcome;
          effects.push(adopted);
          const receipt = receiptFor(parsedMission, missionDigest, adopted);
          const adoptedRef = parseReceiptHead(await storage.loadReceipt(receipt.receiptId), receipt);
          if (adoptedRef) receiptRefs.push(adoptedRef.receiptRef);
          else await publishAndAdoptReceipt(storage, receipt, receiptRefs, () => { receiptsDurable = false; });
          continue;
        }

        const verifier = trustedVerifierStates.get(requested.verifier as object);
        if (!verifier || verifier.contractDigest !== contractDigest) throw new TypeError("trusted observation verifier binding mismatch");

        const state = current.state;
        let dispatchOutcome: DispatchOutcome | null = null;
        if (state === "reserved") {
          if (!requested.handle) {
            await options.coordinator.recover();
            current = parseLedgerProjection(await options.ledger.getReservation(current.reservationId));
            if (!current || current.state === "reserved") throw new Error("reserved restart recovery did not close the undispatched effect");
          } else {
          const authorization = await options.authorization(Object.freeze({ mission: parsedMission, contract, reservation: described }));
          if (authorization !== "active") throw new Error(`effect authority is ${authorization}`);
          dispatchOutcome = parseDispatchOutcome(await options.coordinator.dispatch(requested.handle));
          boundary("provider-response");
          }
        } else if (state === "ambiguous") {
          dispatchOutcome = parseDispatchOutcome(await options.coordinator.reconcile(current.reservationId));
          boundary("provider-response");
        } else if (state === "dispatched") {
          await options.coordinator.recover();
          const recovered = parseLedgerProjection(await options.ledger.getReservation(current.reservationId));
          if (recovered?.state === "ambiguous") dispatchOutcome = parseDispatchOutcome(await options.coordinator.reconcile(current.reservationId));
        }

        const observedAt = canonicalNow(options.now);
        const attempt = stored.attempt ?? projectAttempt(stored.reservation, current.state, dispatchOutcome, observedAt);
        if (attempt && !stored.attempt) { stored = await persist(storage, { ...stored, attempt }, stored.revision); boundary("attempt"); }
        const observation = stored.observation ?? projectObservation(stored.reservation, dispatchOutcome, observedAt);
        if (observation && !stored.observation) { stored = await persist(storage, { ...stored, observation }, stored.revision); boundary("observation"); }
        const observationVerified = observation?.verdict === "matched" ? verifier.verify(observation) === true : false;
        const status = effectStatus(contract, attempt, observation, dispatchOutcome, observationVerified, hermetic);
        const outcome: GovernedOutcomeV1 = Object.freeze({ v: "reelier.governed-outcome/v1", outcomeId: stableId("outcome", { missionDigest, reservationId: current.reservationId }), contractDigest, semanticIdentity: contract.semanticIdentity, reservation: stored.reservation, attempts: Object.freeze(attempt ? [attempt] : []), observation, status, completedAt: observedAt });
        if (status === "verified") verifyGovernedOutcomeTransitionV1(outcome, { contract, now: observedAt, verifyObservation: ({ observation: candidate }: { observation: ObservationV1 }) => candidate.observationId === observation?.observationId && observationVerified });
        stored = await persist(storage, { ...stored, outcome }, stored.revision); boundary("outcome");
        effects.push(outcome);

        const receipt = receiptFor(parsedMission, missionDigest, outcome);
        await publishAndAdoptReceipt(storage, receipt, receiptRefs, () => { receiptsDurable = false; });
        boundary("receipt");
      }

      const status = aggregateStatus(effects, receiptsDurable && receiptRefs.length === effects.length, hermetic);
      return Object.freeze({ v: "reelier.mission-outcome/v1", missionId: parsedMission.missionId, effects: Object.freeze(effects), status, receiptsDurable: receiptsDurable && receiptRefs.length === effects.length, receiptRefs: Object.freeze(receiptRefs) });
    },
  });
}

async function requireVerifiedPredecessor(storage: OutcomeKernelStorage, mission: MissionClaimV1, missionDigest: string, priorEffects: readonly GovernedOutcomeV1[], predecessorContractDigest: string): Promise<void> {
  if (!storage.durable) throw new Error("verified predecessor requires durable receipt storage");
  const predecessor = [...priorEffects].reverse().find(effect => effect.contractDigest === predecessorContractDigest);
  if (!predecessor || predecessor.status !== "verified") throw new Error("successor effect requires an earlier verified predecessor Outcome");
  const receipt = receiptFor(mission, missionDigest, predecessor);
  const head = parseReceiptHead(await storage.loadReceipt(receipt.receiptId), receipt);
  if (!head) throw new Error("successor effect requires the exact durable predecessor receipt head");
}

async function persist(storage: OutcomeKernelStorage, value: Omit<StoredEffectLifecycleV1, "revision"> & { revision: number }, expectedRevision: number): Promise<StoredEffectLifecycleV1> {
  const candidate = Object.freeze({ ...value, revision: expectedRevision });
  const stored = parseStoreEffectResult(await storage.storeEffect(candidate, expectedRevision));
  if (stored.status === "stored") {
    const result = parseStoredEffect(stored.value)!;
    if (result.revision !== expectedRevision + 1 || authorityDigest({ ...result, revision: 0 }) !== authorityDigest({ ...candidate, revision: 0 })) throw new Error("stored effect lifecycle result does not exactly bind the submitted mission, contract, and reservation identities");
    return result;
  }
  const prior = parseStoredEffect(await storage.loadEffect(value.missionId, value.reservation.reservationId));
  if (prior && (prior.missionId !== value.missionId || prior.reservation.reservationId !== value.reservation.reservationId)) throw new Error("stored effect conflict read does not bind the requested identities");
  if (prior && authorityDigest({ ...prior, revision: 0 }) === authorityDigest({ ...candidate, revision: 0 })) return prior;
  throw new Error("effect lifecycle storage conflict");
}

function projectAttempt(reservation: EffectReservationV1, ledgerState: LedgerState, outcome: DispatchOutcome | null, at: string): AttemptV1 | null {
  const result = outcome?.kind ?? (ledgerState === "acknowledged" || ledgerState === "reconciled" ? "acknowledged" : ledgerState === "definitive-failure" || ledgerState === "cancelled" ? "definitive-failure" : ledgerState === "ambiguous" || ledgerState === "dispatched" ? "ambiguous" : null);
  if (!result) return null;
  return Object.freeze({ v: "reelier.attempt/v1", attemptId: stableId("attempt", { reservationId: reservation.reservationId, result }), reservationId: reservation.reservationId, semanticIdentity: reservation.semanticIdentity, dispatchedAt: at, crossedProviderBoundary: result !== "definitive-failure" || ledgerState !== "cancelled", result });
}

function projectObservation(reservation: EffectReservationV1, outcome: DispatchOutcome | null, at: string): ObservationV1 | null {
  if (!outcome?.reconciliationStatus || outcome.reconciliationStatus === "not-attempted") return null;
  const verdict = outcome.reconciliationStatus;
  if (verdict === "unavailable") return Object.freeze({ v: "reelier.observation/v1", observationId: stableId("observation", { reservationId: reservation.reservationId, verdict }), reservationId: reservation.reservationId, semanticIdentity: reservation.semanticIdentity, observedAt: at, authoritative: false, verdict, projectionDigest: null });
  if (!outcome.normalizedProjectionDigest) throw new Error("authoritative observation has no projection digest");
  return Object.freeze({ v: "reelier.observation/v1", observationId: stableId("observation", { reservationId: reservation.reservationId, verdict, projectionDigest: outcome.normalizedProjectionDigest }), reservationId: reservation.reservationId, semanticIdentity: reservation.semanticIdentity, observedAt: at, authoritative: true, verdict, projectionDigest: outcome.normalizedProjectionDigest });
}

function effectStatus(contract: ToolEffectContractV1, attempt: AttemptV1 | null, observation: ObservationV1 | null, outcome: DispatchOutcome | null, observationVerified: boolean, hermetic: boolean): EvidenceGradeV1 {
  if (outcome?.kind === "definitive-failure" || attempt?.result === "definitive-failure" || observation?.verdict === "conflict" || observation?.verdict === "not-applied") return "failed";
  if (observation?.verdict === "matched" && contract.maximumEvidenceGrade === "verified" && observationVerified && !hermetic) return "verified";
  if (!contract.readback) return "absent";
  if (contract.maximumEvidenceGrade !== "verified") return contract.maximumEvidenceGrade;
  return attempt?.result === "ambiguous" || !observation ? "pending" : "partial";
}

function aggregateStatus(effects: readonly GovernedOutcomeV1[], durable: boolean, hermetic: boolean): EvidenceGradeV1 {
  if (!hermetic && durable && effects.every(effect => effect.status === "verified")) return "verified";
  if (effects.some(effect => effect.status === "failed")) return "failed";
  if (effects.some(effect => effect.status === "pending") || effects.every(effect => effect.status === "verified")) return "pending";
  if (effects.some(effect => effect.status === "partial" || effect.status === "verified")) return "partial";
  return "absent";
}

function reservationTime(reservation: LedgerProjection, missionClaimedAt: string): string { const candidate = reservation.issuedAt; const value = typeof candidate === "string" && Number.isFinite(Date.parse(candidate)) ? new Date(Date.parse(candidate)).toISOString() : missionClaimedAt; if (Date.parse(value) < Date.parse(missionClaimedAt)) throw new Error("effect reservation predates its mission claim"); return value; }
function canonicalNow(now: () => number): string { const value = now(); if (!Number.isFinite(value)) throw new Error("outcome kernel clock is unavailable"); return new Date(value).toISOString(); }
function stableId(prefix: string, value: unknown): string { return `${prefix}_${authorityDigest(value).slice(7, 31)}`; }

type LedgerProjection = Readonly<{ reservationId: string; state: LedgerState; effectDigest: string; allocationId: string | null; issuedAt: string | null }>;
const SHA = /^sha256:[0-9a-f]{64}$/;
const LEDGER_STATES: readonly LedgerState[] = ["issued", "reserved", "dispatched", "acknowledged", "definitive-failure", "ambiguous", "cancelled", "reconciled"];

function dataRecord(value: unknown, required: readonly string[], optional: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) throw new TypeError(`${label} must be an inert data record`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} has an unsupported prototype`);
  const permitted = new Set([...required, ...optional]);
  let count = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (++count > 64 || !permitted.has(key)) throw new TypeError(`${label} is not closed`);
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of required) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} requires enumerable data properties`);
    result[key] = descriptor.value;
  }
  for (const key of optional) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if (!descriptor.enumerable) continue;
    if (!Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} requires enumerable data properties`);
    result[key] = descriptor.value;
  }
  return result;
}

function pickedData(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) throw new TypeError(`${label} must be an inert data record`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} has an unsupported prototype`);
  const result: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} requires enumerable data properties`);
    result[field] = descriptor.value;
  }
  return result;
}

function parseExecuteRequest(value: unknown): Readonly<{ missionId: string; effects: readonly OutcomeKernelEffectRequestV1[] }> {
  const raw = dataRecord(value, ["missionId", "effects"], [], "outcome execution request");
  if (typeof raw.missionId !== "string" || raw.missionId.length === 0 || !Array.isArray(raw.effects) || raw.effects.length === 0 || raw.effects.length > 64 || isProxy(raw.effects)) throw new TypeError("mission effects must be a nonempty bounded array");
  const effects: OutcomeKernelEffectRequestV1[] = [];
  for (let index = 0; index < raw.effects.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw.effects, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError("mission effects must be a dense data array");
    const item = dataRecord(descriptor.value, ["contract", "verifier"], ["handle", "reservationId"], "outcome effect request");
    const hasHandle = Object.hasOwn(item, "handle"), hasReservation = Object.hasOwn(item, "reservationId");
    if (hasHandle === hasReservation || (hasReservation && (typeof item.reservationId !== "string" || item.reservationId.length === 0))) throw new TypeError("outcome effect request must select exactly one reservation authority");
    effects.push(Object.freeze(hasHandle ? { contract: item.contract as ToolEffectContractV1, verifier: item.verifier as TrustedObservationVerifierV1, handle: item.handle as ReservedDispatchHandle } : { contract: item.contract as ToolEffectContractV1, verifier: item.verifier as TrustedObservationVerifierV1, reservationId: item.reservationId as string }));
  }
  return Object.freeze({ missionId: raw.missionId, effects: Object.freeze(effects) });
}

function parseDispatchReservationProjection(value: unknown): DispatchReservationProjectionV1 {
  const raw = dataRecord(value, ["reservationId", "state", "effectDigest", "allocationId"], [], "dispatch reservation projection");
  if (typeof raw.reservationId !== "string" || raw.reservationId.length === 0 || !LEDGER_STATES.includes(raw.state as LedgerState) || typeof raw.effectDigest !== "string" || !SHA.test(raw.effectDigest) || raw.allocationId !== null && (typeof raw.allocationId !== "string" || raw.allocationId.length === 0)) throw new TypeError("dispatch reservation projection is invalid");
  return Object.freeze({ reservationId: raw.reservationId, state: raw.state as LedgerState, effectDigest: raw.effectDigest, allocationId: raw.allocationId as string | null });
}

function parseLedgerProjection(value: unknown): LedgerProjection | null {
  if (value === null || value === undefined) return null;
  const raw = pickedData(value, ["reservationId", "state", "intent"], "ledger reservation projection");
  const intent = pickedData(raw.intent, ["effectDigest"], "ledger reservation intent");
  const contextDescriptor = raw.intent && typeof raw.intent === "object" ? Object.getOwnPropertyDescriptor(raw.intent, "executionContext") : undefined;
  const issuedDescriptor = raw.intent && typeof raw.intent === "object" ? Object.getOwnPropertyDescriptor(raw.intent, "issuedAt") : undefined;
  let allocationId: string | null = null;
  if (contextDescriptor?.enumerable && Object.hasOwn(contextDescriptor, "value") && contextDescriptor.value !== undefined) {
    const context = pickedData(contextDescriptor.value, ["allocationId"], "ledger execution context");
    if (typeof context.allocationId !== "string" || context.allocationId.length === 0) throw new TypeError("ledger allocation is invalid");
    allocationId = context.allocationId;
  } else if (contextDescriptor && (!contextDescriptor.enumerable || !Object.hasOwn(contextDescriptor, "value"))) throw new TypeError("ledger execution context must be a data property");
  let issuedAt: string | null = null;
  if (issuedDescriptor) {
    if (!issuedDescriptor.enumerable || !Object.hasOwn(issuedDescriptor, "value") || typeof issuedDescriptor.value !== "string" || !Number.isFinite(Date.parse(issuedDescriptor.value)) || new Date(Date.parse(issuedDescriptor.value)).toISOString() !== issuedDescriptor.value) throw new TypeError("ledger issuedAt must be a canonical data timestamp");
    issuedAt = issuedDescriptor.value;
  }
  if (typeof raw.reservationId !== "string" || raw.reservationId.length === 0 || !LEDGER_STATES.includes(raw.state as LedgerState) || typeof intent.effectDigest !== "string" || !SHA.test(intent.effectDigest)) throw new TypeError("ledger reservation projection is invalid");
  return Object.freeze({ reservationId: raw.reservationId, state: raw.state as LedgerState, effectDigest: intent.effectDigest, allocationId, issuedAt });
}

function parseStoredEffect(value: unknown): StoredEffectLifecycleV1 | null {
  if (value === null || value === undefined) return null;
  const raw = dataRecord(value, ["v", "missionId", "missionDigest", "contractDigest", "reservation", "attempt", "observation", "outcome", "revision"], [], "stored effect lifecycle");
  if (raw.v !== "reelier.stored-effect-lifecycle/v1" || typeof raw.missionId !== "string" || raw.missionId.length === 0 || typeof raw.missionDigest !== "string" || !SHA.test(raw.missionDigest) || typeof raw.contractDigest !== "string" || !SHA.test(raw.contractDigest) || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0) throw new TypeError("stored effect lifecycle is invalid");
  const reservation = parseEffectReservationV1(raw.reservation), attempt = raw.attempt === null ? null : parseAttemptV1(raw.attempt), observation = raw.observation === null ? null : parseObservationV1(raw.observation), outcome = raw.outcome === null ? null : parseGovernedOutcomeV1(raw.outcome);
  if (reservation.contractDigest !== raw.contractDigest || attempt && attempt.reservationId !== reservation.reservationId || observation && observation.reservationId !== reservation.reservationId || outcome && (outcome.reservation.reservationId !== reservation.reservationId || outcome.contractDigest !== raw.contractDigest)) throw new TypeError("stored effect lifecycle identity drift");
  return Object.freeze({ v: "reelier.stored-effect-lifecycle/v1", missionId: raw.missionId, missionDigest: raw.missionDigest, contractDigest: raw.contractDigest, reservation, attempt, observation, outcome, revision: raw.revision as number });
}

function parseMissionClaimResult(value: unknown): Awaited<ReturnType<OutcomeKernelStorage["claimMission"]>> {
  const statusDescriptor = value && typeof value === "object" && !isProxy(value) ? Object.getOwnPropertyDescriptor(value, "status") : undefined;
  if (!statusDescriptor || !statusDescriptor.enumerable || !Object.hasOwn(statusDescriptor, "value")) throw new TypeError("mission claim result must be inert data");
  if (statusDescriptor.value === "conflict") { dataRecord(value, ["status"], [], "mission claim conflict"); return Object.freeze({ status: "conflict" }); }
  const raw = dataRecord(value, ["status", "claim"], [], "mission claim result");
  if (raw.status !== "claimed" && raw.status !== "exact-existing") throw new TypeError("mission claim result is invalid");
  return Object.freeze({ status: raw.status, claim: parseMissionClaimV1(raw.claim) });
}

function parseStoreEffectResult(value: unknown): Awaited<ReturnType<OutcomeKernelStorage["storeEffect"]>> {
  const statusDescriptor = value && typeof value === "object" && !isProxy(value) ? Object.getOwnPropertyDescriptor(value, "status") : undefined;
  if (!statusDescriptor || !statusDescriptor.enumerable || !Object.hasOwn(statusDescriptor, "value")) throw new TypeError("stored effect result must be inert data");
  if (statusDescriptor.value === "conflict") { dataRecord(value, ["status"], [], "stored effect conflict"); return Object.freeze({ status: "conflict" }); }
  const raw = dataRecord(value, ["status", "value"], [], "stored effect result");
  if (raw.status !== "stored") throw new TypeError("stored effect result is invalid");
  return Object.freeze({ status: "stored", value: parseStoredEffect(raw.value)! });
}

function parseDispatchOutcome(value: unknown): DispatchOutcome {
  const raw = dataRecord(value, ["kind", "resultDigest"], ["providerResultDigest", "providerStatus", "responseDigest", "materializedRequestDigest", "reconciliationStatus", "normalizedProjectionDigest", "receiptRef", "evidenceDigest", "priorReceiptDigest"], "dispatch outcome");
  if (!["acknowledged", "definitive-failure", "ambiguous"].includes(raw.kind as string) || typeof raw.resultDigest !== "string" || !SHA.test(raw.resultDigest)) throw new TypeError("dispatch outcome is invalid");
  const digestFields = ["providerResultDigest", "responseDigest", "materializedRequestDigest", "receiptRef", "evidenceDigest", "priorReceiptDigest"] as const;
  for (const field of digestFields) if (raw[field] !== undefined && (typeof raw[field] !== "string" || !SHA.test(raw[field] as string))) throw new TypeError("dispatch outcome digest is invalid");
  if (raw.providerStatus !== undefined && (!Number.isSafeInteger(raw.providerStatus) || (raw.providerStatus as number) < 100 || (raw.providerStatus as number) > 599)) throw new TypeError("dispatch outcome provider status is invalid");
  if (raw.reconciliationStatus !== undefined && !["matched", "not-applied", "conflict", "unavailable", "not-attempted"].includes(raw.reconciliationStatus as string)) throw new TypeError("dispatch outcome reconciliation status is invalid");
  if (raw.normalizedProjectionDigest !== undefined && raw.normalizedProjectionDigest !== null && (typeof raw.normalizedProjectionDigest !== "string" || !SHA.test(raw.normalizedProjectionDigest))) throw new TypeError("dispatch outcome projection digest is invalid");
  return Object.freeze(Object.fromEntries(Object.keys(raw).map(key => [key, raw[key]])) as unknown as DispatchOutcome);
}

function parseReceiptHead(value: unknown, expectedReceipt: GovernedReceiptV1): Readonly<{ receiptId: string; receiptDigest: string; receiptRef: string }> | null {
  if (value === null || value === undefined) return null;
  const raw = dataRecord(value, ["receiptId", "receiptDigest", "receiptRef"], [], "governed receipt head");
  const expectedDigest = digestGovernedReceiptV1(expectedReceipt);
  if (raw.receiptId !== expectedReceipt.receiptId || raw.receiptDigest !== expectedDigest || typeof raw.receiptRef !== "string" || !SHA.test(raw.receiptRef)) throw new TypeError("governed receipt head does not bind the exact receipt identity and digest");
  return Object.freeze({ receiptId: raw.receiptId, receiptDigest: raw.receiptDigest, receiptRef: raw.receiptRef });
}

function receiptFor(mission: MissionClaimV1, missionDigest: string, outcome: GovernedOutcomeV1): GovernedReceiptV1 {
  return constructGovernedReceiptV1({ receiptId: stableId("receipt", { missionDigest, outcomeDigest: digestGovernedOutcomeV1(outcome) }), mission, outcome, issuedAt: outcome.completedAt });
}

async function publishAndAdoptReceipt(storage: OutcomeKernelStorage, receipt: GovernedReceiptV1, refs: string[], markNotDurable: () => void): Promise<void> {
  if (!storage.durable) { markNotDurable(); return; }
  const parsed = parseGovernedReceiptV1(receipt), receiptDigest = digestGovernedReceiptV1(parsed);
  const raw = await storage.compareAndPublishReceipt(parsed, receiptDigest);
  const statusDescriptor = raw && typeof raw === "object" && !isProxy(raw) ? Object.getOwnPropertyDescriptor(raw, "status") : undefined;
  if (!statusDescriptor || !statusDescriptor.enumerable || !Object.hasOwn(statusDescriptor, "value")) throw new TypeError("atomic receipt publication result must be inert data");
  if (statusDescriptor.value === "conflict") { dataRecord(raw, ["status"], [], "atomic receipt publication conflict"); throw new Error("atomic receipt identity conflict"); }
  const status = dataRecord(raw, ["status", "receiptDigest", "receiptRef"], [], "atomic receipt publication result");
  if ((status.status !== "published" && status.status !== "exact-existing") || status.receiptDigest !== receiptDigest || typeof status.receiptRef !== "string" || !SHA.test(status.receiptRef)) throw new TypeError("atomic receipt publication result does not bind the exact receipt");
  const head = parseReceiptHead(await storage.loadReceipt(receipt.receiptId), receipt);
  if (!head) { markNotDurable(); return; }
  if (head.receiptRef !== status.receiptRef) throw new Error("atomic receipt publication ref does not match the durable head");
  refs.push(head.receiptRef);
}

function createHermeticStorage(): OutcomeKernelStorage {
  const missions = new Map<string, Readonly<{ digest: string; claim: MissionClaimV1 }>>(), effects = new Map<string, StoredEffectLifecycleV1>();
  return Object.freeze({
    durable: false,
    async claimMission(claim: MissionClaimV1, digest: string) { const prior = missions.get(claim.missionId); if (!prior) { missions.set(claim.missionId, Object.freeze({ digest, claim })); return { status: "claimed" as const, claim }; } return prior.digest === digest ? { status: "exact-existing" as const, claim: prior.claim } : { status: "conflict" as const }; },
    async loadMission(id: string) { return missions.get(id)?.claim ?? null; },
    async loadEffect(_missionId: string, id: string) { return effects.get(id) ?? null; },
    async storeEffect(value: StoredEffectLifecycleV1, revision: number) { const prior = effects.get(value.reservation.reservationId); if ((prior?.revision ?? 0) !== revision) return { status: "conflict" as const }; const stored = Object.freeze({ ...value, revision: revision + 1 }); effects.set(value.reservation.reservationId, stored); return { status: "stored" as const, value: stored }; },
    async compareAndPublishReceipt() { return { status: "conflict" as const }; },
    async loadReceipt() { return null; },
  });
}
