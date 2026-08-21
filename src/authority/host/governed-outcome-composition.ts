import { isProxy } from "node:util/types";
import type { ReservationSnapshot } from "../ledger.js";
import type { OutcomeContract, SourceBundle } from "../types.js";
import { describeAcceptedGateReservationAuthorityV1, revalidateAcceptedGateReservationAuthorityV1, takeAcceptedGateReservationHandleV1, type AcceptedGateReservationAuthorityV1, type ReservedDispatchHandle } from "../gate.js";
import { digestGovernedEffectCommitmentV1 } from "../governed-effect-commitment.js";
import { parseToolEffectContractV1, type ToolEffectContractV1 } from "../tool-effect-contract.js";
import { authorityCanonicalBytes, authorityDigest, parseCanonicalAuthorityJson } from "../wire.js";
import { digestEffectTransportBindingV1, parseEffectTransportBindingV1, type EffectTransportBindingV1 } from "./effect-transports.js";
import type { DispatchOutcome } from "./dispatch.js";
import { describeFileReceiptPublicationReadbackV1, loadFileReceiptPublicationReadbackV1, type FileReceiptPublicationReadbackV1 } from "./receipts.js";
import { normalizeReservationPublicationId } from "./reservation-identity.js";

export interface GovernedOutcomeEffectJoinInputV1 {
  readonly reservation: ReservationSnapshot;
  readonly pathCContract: OutcomeContract;
  readonly source: SourceBundle;
  readonly choices: unknown;
  readonly connectorAccount: Readonly<{ connectorId: string; accountId: string }>;
  readonly toolEffectContract: ToolEffectContractV1;
  readonly transportBinding: EffectTransportBindingV1;
  readonly operationKind: string;
  readonly reviewedPolicyDigest: string;
}

export interface VerifiedGovernedOutcomeEffectJoinV1 {
  readonly reservationId: string;
  readonly effectDigest: string;
  readonly commitmentDigest: string;
  readonly pathCContractDigest: string;
  readonly toolEffectContractDigest: string;
  readonly transportBindingDigest: string;
}

declare const governedOutcomeKernelAuthorityBrand: unique symbol;
export interface GovernedOutcomeKernelAuthorityV1 { readonly [governedOutcomeKernelAuthorityBrand]: true }
type GovernedKernelAuthorityStateV1 = Readonly<{ join: VerifiedGovernedOutcomeEffectJoinV1; gateAuthority: AcceptedGateReservationAuthorityV1 | null; publicationReadback: FileReceiptPublicationReadbackV1 }>;
const governedKernelAuthorities = new WeakMap<object, GovernedKernelAuthorityStateV1>();

export function createGovernedOutcomeKernelAuthorityV1(input: Readonly<{ join: GovernedOutcomeEffectJoinInputV1; gateAuthority?: AcceptedGateReservationAuthorityV1; publicationReadback: FileReceiptPublicationReadbackV1 }>): GovernedOutcomeKernelAuthorityV1 {
  const fields = input && typeof input === "object" && Object.hasOwn(input, "gateAuthority") ? ["join", "gateAuthority", "publicationReadback"] : ["join", "publicationReadback"];
  const raw = closedRecord(input, fields, "governed Outcome kernel authority");
  const join = verifyGovernedOutcomeEffectJoinV1(raw.join as GovernedOutcomeEffectJoinInputV1);
  const publicationReadback = raw.publicationReadback as FileReceiptPublicationReadbackV1, publication = describeFileReceiptPublicationReadbackV1(publicationReadback);
  if (publication.reservationId !== join.reservationId || publication.effectDigest !== join.effectDigest) throw new TypeError("genuine publication readback does not match the durable governed join");
  const gateAuthority = (raw.gateAuthority ?? null) as AcceptedGateReservationAuthorityV1 | null;
  if (gateAuthority) {
    const gate = describeAcceptedGateReservationAuthorityV1(gateAuthority);
    if (gate.reservationId !== join.reservationId || gate.effectDigest !== join.effectDigest || gate.contractDigest !== join.pathCContractDigest) throw new TypeError("genuine gate reservation does not match the durable governed join");
  }
  const authority = Object.freeze(Object.create(null)) as GovernedOutcomeKernelAuthorityV1;
  governedKernelAuthorities.set(authority as object, Object.freeze({ join, gateAuthority, publicationReadback }));
  return authority;
}

/** @internal Kernel-only projection; contains no send-capable handle. */
export function describeGovernedOutcomeKernelAuthorityV1(authority: GovernedOutcomeKernelAuthorityV1, taskContractDigest: string): Readonly<{ reservationId: string; effectDigest: string; hasLiveHandle: boolean }> {
  const state = governedKernelAuthorities.get(authority as object);
  if (!state || state.join.toolEffectContractDigest !== taskContractDigest) throw new TypeError("governed Outcome kernel authority does not bind the Task-4 contract");
  return Object.freeze({ reservationId: state.join.reservationId, effectDigest: state.join.effectDigest, hasLiveHandle: state.gateAuthority !== null });
}

/** @internal Revalidates current signed gate state immediately before releasing the exact handle. */
export async function takeGovernedOutcomeKernelHandleV1(authority: GovernedOutcomeKernelAuthorityV1): Promise<ReservedDispatchHandle> {
  const state = governedKernelAuthorities.get(authority as object);
  if (!state?.gateAuthority) throw new TypeError("governed Outcome authority is readback-only");
  await revalidateAcceptedGateReservationAuthorityV1(state.gateAuthority);
  return takeAcceptedGateReservationHandleV1(state.gateAuthority);
}

/** @internal Resolves only the coordinator's exact terminal publication head. */
export async function resolveGovernedOutcomeKernelPublicationV1(authority: GovernedOutcomeKernelAuthorityV1, outcome: DispatchOutcome): Promise<string | null> {
  const state = governedKernelAuthorities.get(authority as object);
  if (!state) return null;
  return resolveGovernedCoordinatorPublicationV1(state.publicationReadback, outcome);
}

/** @internal Restart adoption is authorized only by the coordinator's exact terminal head. */
export async function revalidateGovernedOutcomeKernelTerminalV1(authority: GovernedOutcomeKernelAuthorityV1, expectedReceiptRef: string | null): Promise<boolean> {
  const state = governedKernelAuthorities.get(authority as object);
  if (!state || typeof expectedReceiptRef !== "string" || !SHA.test(expectedReceiptRef)) return false;
  try {
    const head = await loadFileReceiptPublicationReadbackV1(state.publicationReadback, "terminal");
    return Boolean(head && head.receiptRef === expectedReceiptRef && (head.phase === "dispatch" || head.phase === "reconcile"));
  } catch { return false; }
}

export async function resolveGovernedCoordinatorPublicationV1(readback: FileReceiptPublicationReadbackV1, outcomeInput: DispatchOutcome): Promise<string | null> {
  try {
    const binding = describeFileReceiptPublicationReadbackV1(readback);
    const outcome = picked(outcomeInput, ["kind", "receiptRef", "evidenceDigest", "priorReceiptDigest"], "dispatch outcome");
    if (!outcome.receiptRef || !outcome.evidenceDigest || !outcome.priorReceiptDigest || ![outcome.receiptRef, outcome.evidenceDigest, outcome.priorReceiptDigest].every(value => typeof value === "string" && SHA.test(value))) return null;
    const rawHead = await loadFileReceiptPublicationReadbackV1(readback, "terminal");
    if (!rawHead) return null;
    const head = picked(rawHead, ["v", "identity", "receiptRef", "evidenceDigest", "reservationReceiptRef", "priorReceiptRef", "phase", "terminalKind"], "durable publication head");
    const identity = durableIdentity(head.identity);
    if (head.v !== "reelier.durable-dispatch-publication-head/v1" || identity.reservationId !== normalizeReservationPublicationId(binding.reservationId) || identity.effectDigest !== binding.effectDigest || head.receiptRef !== outcome.receiptRef || head.evidenceDigest !== outcome.evidenceDigest || typeof head.reservationReceiptRef !== "string" || !SHA.test(head.reservationReceiptRef) || head.priorReceiptRef !== outcome.priorReceiptDigest) return null;
    const reconciled = outcomeInput.reconciliationStatus !== undefined && outcomeInput.reconciliationStatus !== "not-attempted";
    const exactTerminal = head.phase === "reconcile" ? head.terminalKind === "reconciled" : head.phase === "dispatch" ? head.terminalKind === outcomeInput.kind : !reconciled && head.phase === "ambiguous" && head.terminalKind === "ambiguous";
    if (!exactTerminal || reconciled && head.phase !== "dispatch" && head.phase !== "reconcile") return null;
    return outcome.receiptRef as string;
  } catch { return null; }
}

const SHA = /^sha256:[0-9a-f]{64}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export function verifyGovernedOutcomeEffectJoinV1(input: GovernedOutcomeEffectJoinInputV1): VerifiedGovernedOutcomeEffectJoinV1 {
  assertInertTree(input, "governed Outcome join", 0, new Set());
  const reservation = picked(input.reservation, ["reservationId", "intent"], "ledger reservation");
  const intent = picked(reservation.intent, ["definitionAlias", "contractDigest", "effectDigest", "effectCanonicalBase64"], "ledger reservation intent");
  if (typeof reservation.reservationId !== "string" || reservation.reservationId.length === 0 || typeof intent.definitionAlias !== "string" || !NAME.test(intent.definitionAlias) || typeof intent.contractDigest !== "string" || !SHA.test(intent.contractDigest) || typeof intent.effectDigest !== "string" || !SHA.test(intent.effectDigest) || typeof intent.effectCanonicalBase64 !== "string") throw new TypeError("ledger reservation join is invalid");
  const contract = picked(input.pathCContract, ["alias", "packDigest", "definitionDigest"], "signed Path-C contract");
  if (contract.alias !== intent.definitionAlias || typeof contract.packDigest !== "string" || !SHA.test(contract.packDigest) || typeof contract.definitionDigest !== "string" || !SHA.test(contract.definitionDigest)) throw new TypeError("signed Path-C contract does not match the ledger reservation");
  const pathCContractDigest = authorityDigest(input.pathCContract);
  if (pathCContractDigest !== intent.contractDigest) throw new TypeError("signed Path-C contract digest does not match the ledger reservation");

  let effect;
  const effectBytes = Buffer.from(intent.effectCanonicalBase64, "base64");
  try { effect = parseCanonicalAuthorityJson("transport-effect", effectBytes.toString("utf8")); } catch { throw new TypeError("canonical ledger effect is invalid"); }
  if (!authorityCanonicalBytes(effect).equals(effectBytes) || authorityDigest(effect) !== intent.effectDigest) throw new TypeError("canonical ledger effect digest does not match its bytes");
  const matches = effect.preconditions.filter(item => item.kind === "governed-effect-commitment-v1");
  if (matches.length !== 1) throw new TypeError("canonical ledger effect requires exactly one governed commitment");

  const toolEffectContract = parseToolEffectContractV1(input.toolEffectContract);
  const transportBinding = parseEffectTransportBindingV1(input.transportBinding);
  if (typeof input.operationKind !== "string" || !NAME.test(input.operationKind) || typeof input.reviewedPolicyDigest !== "string" || !SHA.test(input.reviewedPolicyDigest)) throw new TypeError("governed operation policy is invalid");
  const connectorAccount = picked(input.connectorAccount, ["connectorId", "accountId"], "connector account");
  if (typeof connectorAccount.connectorId !== "string" || typeof connectorAccount.accountId !== "string" || connectorAccount.connectorId.length === 0 || connectorAccount.accountId.length === 0) throw new TypeError("connector account is invalid");
  const commitmentDigest = digestGovernedEffectCommitmentV1({
    v: "reelier.governed-effect-commitment/v1",
    definitionAlias: intent.definitionAlias,
    pathCContractDigest,
    toolEffectContractDigest: authorityDigest(toolEffectContract),
    transportBindingDigest: digestEffectTransportBindingV1(transportBinding),
    compiledEffectInputDigest: authorityDigest({ v: "reelier.compiled-effect-input/v1", definitionAlias: intent.definitionAlias, source: input.source, choices: input.choices, connectorAccount }),
    requestCommitmentDigest: authorityDigest({ v: "reelier.effect-request-commitment/v1", definitionAlias: intent.definitionAlias, projection: input.source.projection, choices: input.choices }),
    operationKind: input.operationKind,
    reviewedPolicyDigest: input.reviewedPolicyDigest,
    packDigest: contract.packDigest,
    definitionDigest: contract.definitionDigest,
  });
  if (matches[0]!.digest !== commitmentDigest) throw new TypeError("durable governed effect commitment join mismatch");
  return Object.freeze({ reservationId: reservation.reservationId, effectDigest: intent.effectDigest, commitmentDigest, pathCContractDigest, toolEffectContractDigest: authorityDigest(toolEffectContract), transportBindingDigest: digestEffectTransportBindingV1(transportBinding) });
}

function picked(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) throw new TypeError(`${label} must be an inert data record`);
  const result: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} requires inert data properties`);
    result[field] = descriptor.value;
  }
  return result;
}

function closedRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  const record = picked(value, fields, label), keys = Reflect.ownKeys(value as object);
  if (keys.length !== fields.length || keys.some(key => typeof key !== "string" || !fields.includes(key))) throw new TypeError(`${label} is not closed`);
  return record;
}

function durableIdentity(value: unknown): Record<string, unknown> {
  const fields = ["v", "reservationId", "tenant", "requestDigest", "capabilityDigest", "effectDigest", "routeAuthorityDigest", "expectedDispatchedRequestDigest", "reservationIntentDigest"] as const;
  const identity = picked(value, fields, "durable publication identity");
  if (identity.v !== "reelier.durable-dispatch-publication-identity/v1" || typeof identity.reservationId !== "string" || identity.reservationId.length === 0 || typeof identity.tenant !== "string" || identity.tenant.length === 0 || fields.slice(3).some(field => typeof identity[field] !== "string" || !SHA.test(identity[field] as string))) throw new TypeError("durable publication identity is invalid");
  return identity;
}

function assertInertTree(value: unknown, label: string, depth: number, seen: Set<object>): void {
  if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) return;
  if (typeof value !== "object" || isProxy(value) || depth > 32 || seen.has(value as object)) throw new TypeError(`${label} must be inert bounded data`);
  seen.add(value as object);
  const keys = Reflect.ownKeys(value as object);
  if (keys.length > 256 || keys.some(key => typeof key !== "string")) throw new TypeError(`${label} must be inert bounded data`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value as object, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} must use data properties`);
    assertInertTree(descriptor.value, label, depth + 1, seen);
  }
  seen.delete(value as object);
}
