import { isProxy } from "node:util/types";
import { authorityDigest } from "./wire.js";

export interface GovernedEffectCommitmentV1 {
  readonly v: "reelier.governed-effect-commitment/v1";
  readonly definitionAlias: string;
  readonly pathCContractDigest: string;
  readonly toolEffectContractDigest: string;
  readonly transportBindingDigest: string;
  readonly compiledEffectInputDigest: string;
  readonly requestCommitmentDigest: string;
  readonly operationKind: string;
  readonly reviewedPolicyDigest: string;
  readonly packDigest: string;
  readonly definitionDigest: string;
}

const FIELDS = [
  "v", "definitionAlias", "pathCContractDigest", "toolEffectContractDigest",
  "transportBindingDigest", "compiledEffectInputDigest", "requestCommitmentDigest",
  "operationKind", "reviewedPolicyDigest", "packDigest", "definitionDigest",
] as const;
const SHA = /^sha256:[0-9a-f]{64}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export function parseGovernedEffectCommitmentV1(value: unknown): GovernedEffectCommitmentV1 {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) throw new TypeError("governed effect commitment must be an inert data record");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("governed effect commitment must be an inert data record");
  const own = Reflect.ownKeys(value);
  if (own.length !== FIELDS.length || own.some(field => typeof field !== "string" || !FIELDS.includes(field as typeof FIELDS[number]))) throw new TypeError("governed effect commitment must be closed over its exact fields");
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const field of FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError("governed effect commitment requires inert data properties");
    snapshot[field] = descriptor.value;
  }
  if (snapshot.v !== "reelier.governed-effect-commitment/v1") throw new TypeError("governed effect commitment version is invalid");
  if (typeof snapshot.definitionAlias !== "string" || !NAME.test(snapshot.definitionAlias) || typeof snapshot.operationKind !== "string" || !NAME.test(snapshot.operationKind)) throw new TypeError("governed effect commitment identity is invalid");
  for (const field of FIELDS.filter(field => field.endsWith("Digest"))) if (typeof snapshot[field] !== "string" || !SHA.test(snapshot[field] as string)) throw new TypeError(`governed effect commitment ${field} digest is invalid`);
  return Object.freeze({
    v: "reelier.governed-effect-commitment/v1",
    definitionAlias: snapshot.definitionAlias,
    pathCContractDigest: snapshot.pathCContractDigest,
    toolEffectContractDigest: snapshot.toolEffectContractDigest,
    transportBindingDigest: snapshot.transportBindingDigest,
    compiledEffectInputDigest: snapshot.compiledEffectInputDigest,
    requestCommitmentDigest: snapshot.requestCommitmentDigest,
    operationKind: snapshot.operationKind,
    reviewedPolicyDigest: snapshot.reviewedPolicyDigest,
    packDigest: snapshot.packDigest,
    definitionDigest: snapshot.definitionDigest,
  } as GovernedEffectCommitmentV1);
}

export function digestGovernedEffectCommitmentV1(value: unknown): string {
  return authorityDigest(parseGovernedEffectCommitmentV1(value));
}
