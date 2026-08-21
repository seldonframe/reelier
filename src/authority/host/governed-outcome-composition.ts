import { isProxy } from "node:util/types";
import type { ReservationSnapshot } from "../ledger.js";
import type { OutcomeContract, SourceBundle } from "../types.js";
import { digestGovernedEffectCommitmentV1 } from "../governed-effect-commitment.js";
import { parseToolEffectContractV1, type ToolEffectContractV1 } from "../tool-effect-contract.js";
import { authorityCanonicalBytes, authorityDigest, parseCanonicalAuthorityJson } from "../wire.js";
import { digestEffectTransportBindingV1, parseEffectTransportBindingV1, type EffectTransportBindingV1 } from "./effect-transports.js";

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
