import type { AuthorityLedger, LedgerState, ReservationSnapshot } from "../ledger.js";
import type { ReservedDispatchHandle } from "../gate.js";
import { authorityDigest } from "../wire.js";
import {
  digestGovernedOutcomeV1,
  digestMissionClaimV1,
  digestToolEffectContractV1,
  parseMissionClaimV1,
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
declare const trustedVerifierBrand: unique symbol;
export type TrustedObservationVerifierV1 = Readonly<{ readonly [trustedVerifierBrand]: true }>;

/** Host-minted capability. The verifier is never copied into mission or effect input. */
export function createTrustedObservationVerifier(input: Readonly<{ contractDigest: string; verify: (observation: ObservationV1) => boolean }>): TrustedObservationVerifierV1 {
  if (!/^sha256:[0-9a-f]{64}$/.test(input?.contractDigest) || typeof input.verify !== "function") throw new TypeError("trusted observation verifier is invalid");
  const capability = Object.freeze(Object.create(null)) as TrustedObservationVerifierV1;
  trustedVerifierStates.set(capability as object, Object.freeze({ contractDigest: input.contractDigest, verify: input.verify }));
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
  publishReceipt(receipt: GovernedReceiptV1): Promise<Readonly<{ durable: true; receiptRef: string }> | Readonly<{ durable: false }>>;
  loadReceipt(receiptId: string): Promise<Readonly<{ receiptRef: string }> | null>;
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
  readonly onBoundary?: (boundary: "mission-claim" | "reservation" | "provider-response" | "attempt" | "observation" | "outcome" | "receipt") => void;
}

export function createOutcomeKernel(options: OutcomeKernelOptions): OutcomeKernel {
  if (!options || typeof options !== "object" || typeof options.now !== "function" || typeof options.authorization !== "function") throw new TypeError("outcome kernel options are invalid");
  const hermetic = options.mode === "hermetic";
  const storage = options.storage ?? (hermetic ? createHermeticStorage() : undefined);
  if (!storage || (!storage.durable && !hermetic)) throw new TypeError("durable storage is required outside explicit hermetic mode");
  const boundary = (name: Parameters<NonNullable<OutcomeKernelOptions["onBoundary"]>>[0]) => options.onBoundary?.(name);

  return Object.freeze({
    async claimMission(rawClaim: MissionClaimV1) {
      const claim = parseMissionClaimV1(rawClaim), digest = digestMissionClaimV1(claim);
      const claimed = await storage.claimMission(claim, digest);
      if (claimed.status === "conflict") throw new Error("mission claim semantics conflict");
      boundary("mission-claim");
      return Object.freeze({ status: claimed.status, claim: parseMissionClaimV1(claimed.claim) });
    },

    async execute(input: Readonly<{ missionId: string; effects: readonly OutcomeKernelEffectRequestV1[] }>): Promise<MissionOutcomeV1> {
      const mission = await storage.loadMission(input.missionId);
      if (!mission) throw new Error("mission claim is absent");
      const parsedMission = parseMissionClaimV1(mission), missionDigest = digestMissionClaimV1(parsedMission);
      if (!Array.isArray(input.effects) || input.effects.length === 0 || input.effects.length > 64) throw new TypeError("mission effects must be a nonempty bounded array");
      const effects: GovernedOutcomeV1[] = [], receiptRefs: string[] = [];
      let receiptsDurable = storage.durable;

      for (const requested of input.effects) {
        const contract = parseToolEffectContractV1(requested.contract), contractDigest = digestToolEffectContractV1(contract);
        if (!parsedMission.contractDigests.includes(contractDigest)) throw new Error("effect contract is outside the mission claim");
        const verifier = trustedVerifierStates.get(requested.verifier as object);
        if (!verifier || verifier.contractDigest !== contractDigest) throw new TypeError("trusted observation verifier binding mismatch");
        let described: DispatchReservationProjectionV1;
        if (requested.handle) {
          if (!options.coordinator.describe) throw new TypeError("outcome kernel requires a coordinator reservation projection hook");
          described = options.coordinator.describe(requested.handle);
        } else {
          const restarted = await options.ledger.getReservation(requested.reservationId);
          if (!restarted) throw new Error("durable reservation is absent on restart");
          described = Object.freeze({ reservationId: restarted.reservationId, state: restarted.state, effectDigest: restarted.intent.effectDigest, allocationId: restarted.intent.executionContext?.allocationId ?? null });
        }
        let current = await options.ledger.getReservation(described.reservationId);
        if (!current || current.reservationId !== described.reservationId || current.intent.effectDigest !== described.effectDigest) throw new Error("durable reservation projection mismatch");
        let stored = await storage.loadEffect(parsedMission.missionId, current.reservationId);
        if (stored && (stored.missionDigest !== missionDigest || stored.contractDigest !== contractDigest || stored.reservation.semanticIdentity !== contract.semanticIdentity)) throw new Error("stored effect semantics conflict");
        if (!stored) {
          const reservation: EffectReservationV1 = Object.freeze({ v: "reelier.effect-reservation/v1", reservationId: current.reservationId, semanticIdentity: contract.semanticIdentity, contractDigest, reservedAt: reservationTime(current, parsedMission.claimedAt) });
          stored = await persist(storage, Object.freeze({ v: "reelier.stored-effect-lifecycle/v1", missionId: parsedMission.missionId, missionDigest, contractDigest, reservation, attempt: null, observation: null, outcome: null, revision: 0 }), 0);
          boundary("reservation");
        }

        const state = current.state;
        let dispatchOutcome: DispatchOutcome | null = null;
        if (state === "reserved") {
          if (!requested.handle) {
            await options.coordinator.recover();
            current = await options.ledger.getReservation(current.reservationId);
            if (!current || current.state === "reserved") throw new Error("reserved restart recovery did not close the undispatched effect");
          } else {
          const authorization = await options.authorization(Object.freeze({ mission: parsedMission, contract, reservation: described }));
          if (authorization !== "active") throw new Error(`effect authority is ${authorization}`);
          dispatchOutcome = await options.coordinator.dispatch(requested.handle);
          boundary("provider-response");
          }
        } else if (state === "ambiguous") {
          dispatchOutcome = await options.coordinator.reconcile(current.reservationId);
          boundary("provider-response");
        } else if (state === "dispatched") {
          await options.coordinator.recover();
          const recovered = await options.ledger.getReservation(current.reservationId);
          if (recovered?.state === "ambiguous") dispatchOutcome = await options.coordinator.reconcile(current.reservationId);
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

        const receipt = constructGovernedReceiptV1({ receiptId: stableId("receipt", { missionDigest, outcomeDigest: digestGovernedOutcomeV1(outcome) }), mission: parsedMission, outcome, issuedAt: observedAt });
        const published = await storage.publishReceipt(receipt);
        if (published.durable) {
          const head = await storage.loadReceipt(receipt.receiptId);
          if (head?.receiptRef === published.receiptRef) receiptRefs.push(published.receiptRef); else receiptsDurable = false;
        } else receiptsDurable = false;
        boundary("receipt");
      }

      const status = aggregateStatus(effects, receiptsDurable && receiptRefs.length === effects.length, hermetic);
      return Object.freeze({ v: "reelier.mission-outcome/v1", missionId: parsedMission.missionId, effects: Object.freeze(effects), status, receiptsDurable: receiptsDurable && receiptRefs.length === effects.length, receiptRefs: Object.freeze(receiptRefs) });
    },
  });
}

async function persist(storage: OutcomeKernelStorage, value: Omit<StoredEffectLifecycleV1, "revision"> & { revision: number }, expectedRevision: number): Promise<StoredEffectLifecycleV1> {
  const candidate = Object.freeze({ ...value, revision: expectedRevision });
  const stored = await storage.storeEffect(candidate, expectedRevision);
  if (stored.status === "stored") return stored.value;
  const prior = await storage.loadEffect(value.missionId, value.reservation.reservationId);
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
  if (contract.maximumEvidenceGrade !== "verified") return contract.maximumEvidenceGrade;
  if (!contract.readback) return "absent";
  return attempt?.result === "ambiguous" || !observation ? "pending" : "partial";
}

function aggregateStatus(effects: readonly GovernedOutcomeV1[], durable: boolean, hermetic: boolean): EvidenceGradeV1 {
  if (!hermetic && durable && effects.every(effect => effect.status === "verified")) return "verified";
  if (effects.some(effect => effect.status === "failed")) return "failed";
  if (effects.some(effect => effect.status === "pending") || effects.every(effect => effect.status === "verified")) return "pending";
  if (effects.some(effect => effect.status === "partial" || effect.status === "verified")) return "partial";
  return "absent";
}

function reservationTime(reservation: ReservationSnapshot, missionClaimedAt: string): string { const candidate = reservation.intent.issuedAt; const value = typeof candidate === "string" && Number.isFinite(Date.parse(candidate)) ? new Date(Date.parse(candidate)).toISOString() : missionClaimedAt; if (Date.parse(value) < Date.parse(missionClaimedAt)) throw new Error("effect reservation predates its mission claim"); return value; }
function canonicalNow(now: () => number): string { const value = now(); if (!Number.isFinite(value)) throw new Error("outcome kernel clock is unavailable"); return new Date(value).toISOString(); }
function stableId(prefix: string, value: unknown): string { return `${prefix}_${authorityDigest(value).slice(7, 31)}`; }

function createHermeticStorage(): OutcomeKernelStorage {
  const missions = new Map<string, Readonly<{ digest: string; claim: MissionClaimV1 }>>(), effects = new Map<string, StoredEffectLifecycleV1>();
  return Object.freeze({
    durable: false,
    async claimMission(claim: MissionClaimV1, digest: string) { const prior = missions.get(claim.missionId); if (!prior) { missions.set(claim.missionId, Object.freeze({ digest, claim })); return { status: "claimed" as const, claim }; } return prior.digest === digest ? { status: "exact-existing" as const, claim: prior.claim } : { status: "conflict" as const }; },
    async loadMission(id: string) { return missions.get(id)?.claim ?? null; },
    async loadEffect(_missionId: string, id: string) { return effects.get(id) ?? null; },
    async storeEffect(value: StoredEffectLifecycleV1, revision: number) { const prior = effects.get(value.reservation.reservationId); if ((prior?.revision ?? 0) !== revision) return { status: "conflict" as const }; const stored = Object.freeze({ ...value, revision: revision + 1 }); effects.set(value.reservation.reservationId, stored); return { status: "stored" as const, value: stored }; },
    async publishReceipt() { return { durable: false as const }; },
    async loadReceipt() { return null; },
  });
}
