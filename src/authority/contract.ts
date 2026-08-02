import type { AuthoritySignature, OutcomeContract } from "./types.js";
import type { TrustRoots } from "./trust.js";
import { verifyTrustedAuthority } from "./trust.js";
import type { ValidatedDelegationChain } from "./delegation.js";
import { validateContractAgainstDelegation } from "./delegation.js";

export interface StoredSignedContract {
  readonly contract: unknown;
  readonly digest: string;
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}

export type ContractStateEvent = Readonly<{
  kind: "activated" | "revoked";
  contractDigest: string;
  at: string;
}>;

const validatedContractBrand = Symbol("ValidatedContract");

export interface ValidatedContract {
  readonly [validatedContractBrand]: true;
  readonly contract: OutcomeContract;
  readonly digest: string;
  readonly signerId: string;
  readonly signerPrincipalId: string;
}

export type RegisteredDefinitionDigests = ReadonlyMap<string, Readonly<{ packDigest: string; definitionDigest: string }>>;

export function validateStoredContract(input: Readonly<{
  stored: StoredSignedContract;
  trustRoots: TrustRoots;
  delegation: ValidatedDelegationChain;
  registeredDefinitions: RegisteredDefinitionDigests;
  stateEvents: readonly ContractStateEvent[];
  tenant: string;
  requester: string;
  now: Date;
}>): ValidatedContract {
  const verified = verifyTrustedAuthority(input.trustRoots, { tenant: input.tenant, signerId: input.stored.signerId, purpose: "outcome-contract", advertisedDigest: input.stored.digest, value: input.stored.contract, signature: input.stored.signature });
  const contract = verified.value;
  if (contract.tenant !== input.tenant) throw new TypeError("contract tenant mismatch");
  if (!contract.audiences.includes(input.requester)) throw new TypeError("requester is outside contract audience");
  const now = input.now.getTime();
  if (now < Date.parse(contract.validFrom)) throw new TypeError("contract is not yet valid");
  if (now >= Date.parse(contract.validUntil)) throw new TypeError("contract is expired");
  const registration = input.registeredDefinitions.get(contract.alias);
  if (!registration || registration.packDigest !== contract.packDigest || registration.definitionDigest !== contract.definitionDigest) throw new TypeError("registered definition digest mismatch");
  validateContractAgainstDelegation(contract, input.delegation);
  if (verified.principalId !== input.delegation.leafGrantee) throw new TypeError("contract signer principal lacks leaf delegation authority");
  assertActive(input.stateEvents, verified.digest, now);
  return Object.freeze({ [validatedContractBrand]: true as const, contract: deepFreeze(contract), digest: verified.digest, signerId: verified.signerId, signerPrincipalId: verified.principalId });
}

function assertActive(events: readonly ContractStateEvent[], digest: string, now: number): void {
  const relevant = events.filter(event => event.contractDigest === digest);
  let activatedAt: number | undefined;
  let revokedAt: number | undefined;
  let previous = -Infinity;
  for (const event of relevant) {
    const at = Date.parse(event.at);
    if (!Number.isFinite(at) || at < previous) throw new TypeError("contract state is not append-only chronological");
    previous = at;
    if (event.kind === "activated") {
      if (activatedAt !== undefined) throw new TypeError("duplicate activation event");
      if (revokedAt !== undefined) throw new TypeError("contract activation must be first");
      activatedAt = at;
    } else {
      if (activatedAt === undefined) throw new TypeError("contract activation must be first in append-only state");
      if (revokedAt !== undefined) throw new TypeError("duplicate revocation event");
      revokedAt = at;
    }
  }
  if (activatedAt === undefined || activatedAt > now) throw new TypeError("contract is inactive");
  if (revokedAt !== undefined && revokedAt <= now) throw new TypeError("contract is revoked");
}

export function isValidatedContract(value: unknown): value is ValidatedContract {
  return Boolean(value && typeof value === "object" && (value as Partial<ValidatedContract>)[validatedContractBrand] === true);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
