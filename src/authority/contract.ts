import type { AuthoritySignature, OutcomeContract } from "./types.js";
import type { TrustRoots } from "./trust.js";
import { verifyTrustedAuthority } from "./trust.js";
import type { ValidatedDelegationChain } from "./delegation.js";
import { assertValidatedDelegationChain, validateContractAgainstDelegation } from "./delegation.js";
import { authorityDigest } from "./wire.js";

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

declare const validatedContractBrand: unique symbol;
declare const verifiedStoredContractBrand: unique symbol;

export interface VerifiedStoredContract {
  readonly [verifiedStoredContractBrand]: true;
  readonly contract: OutcomeContract;
  readonly digest: string;
  readonly signerId: string;
  readonly signerPrincipalId: string;
}

export interface ValidatedContract {
  readonly [validatedContractBrand]: true;
  readonly contract: OutcomeContract;
  readonly digest: string;
  readonly signerId: string;
  readonly signerPrincipalId: string;
  readonly validationInstant: string;
  readonly activationSnapshotDigest: string;
}

export interface RegisteredDefinitionDigests {
  readonly get: (alias: string) => Readonly<{ packDigest: string; definitionDigest: string; maxFreshnessSeconds: number }> | undefined;
}

const validatedContracts = new WeakSet<object>();
const verifiedContracts = new WeakSet<object>();

export function verifyStoredContract(input: Readonly<{ stored: StoredSignedContract; trustRoots: TrustRoots; tenant: string }>): VerifiedStoredContract {
  const verified = verifyTrustedAuthority(input.trustRoots, { tenant: input.tenant, signerId: input.stored.signerId, purpose: "outcome-contract", advertisedDigest: input.stored.digest, value: input.stored.contract, signature: input.stored.signature });
  const contract = verified.value;
  if (contract.tenant !== input.tenant) throw new TypeError("contract tenant mismatch");
  const result = Object.freeze({ contract: deepFreeze(contract), digest: verified.digest, signerId: verified.signerId, signerPrincipalId: verified.principalId }) as VerifiedStoredContract;
  verifiedContracts.add(result);
  return result;
}

export function validateVerifiedContractEligibility(input: Readonly<{
  verified: VerifiedStoredContract; definitionAlias: string; delegation: ValidatedDelegationChain;
  registeredDefinitions: RegisteredDefinitionDigests; stateEvents: readonly ContractStateEvent[];
  requester: string; now: Date;
}>): ValidatedContract {
  if (!verifiedContracts.has(input.verified as object)) throw new TypeError("eligibility requires a verified stored contract");
  assertValidatedDelegationChain(input.delegation);
  const contract = input.verified.contract;
  if (contract.alias !== input.definitionAlias) throw new TypeError("authenticated definition alias mismatch");
  if (!contract.audiences.includes(input.requester)) throw new TypeError("requester is outside contract audience");
  const now = input.now.getTime();
  if (now < Date.parse(contract.validFrom)) throw new TypeError("contract is not yet valid");
  if (now >= Date.parse(contract.validUntil)) throw new TypeError("contract is expired");
  const registration = input.registeredDefinitions.get(input.definitionAlias);
  if (!registration || registration.packDigest !== contract.packDigest || registration.definitionDigest !== contract.definitionDigest) throw new TypeError("registered definition digest mismatch");
  if (contract.sourceAuthority.maxFreshnessSeconds > registration.maxFreshnessSeconds) throw new TypeError("contract freshness exceeds registered resolver maximum");
  validateContractAgainstDelegation(contract, input.delegation);
  if (input.verified.signerPrincipalId !== input.delegation.leafGrantee) throw new TypeError("contract signer principal lacks leaf delegation authority");
  const activationSnapshotDigest = assertActive(input.stateEvents, input.verified.digest, now);
  const validated = Object.freeze({ contract, digest: input.verified.digest, signerId: input.verified.signerId, signerPrincipalId: input.verified.signerPrincipalId, validationInstant: input.now.toISOString(), activationSnapshotDigest }) as ValidatedContract;
  validatedContracts.add(validated);
  return validated;
}

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
  const verified = verifyStoredContract({ stored: input.stored, trustRoots: input.trustRoots, tenant: input.tenant });
  return validateVerifiedContractEligibility({ verified, definitionAlias: verified.contract.alias, delegation: input.delegation, registeredDefinitions: input.registeredDefinitions, stateEvents: input.stateEvents, requester: input.requester, now: input.now });
}

function assertActive(events: readonly ContractStateEvent[], digest: string, now: number): string {
  const relevant = events.filter(event => event.contractDigest === digest).map(event => Object.freeze({ kind: event.kind, contractDigest: event.contractDigest, at: event.at }));
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
  return authorityDigest({ v: "reelier.contract-state-snapshot/internal-v1", contractDigest: digest, events: relevant });
}

export function isValidatedContract(value: unknown): value is ValidatedContract {
  return Boolean(value && typeof value === "object" && validatedContracts.has(value));
}

export function assertValidatedContract(value: unknown): asserts value is ValidatedContract {
  if (!isValidatedContract(value)) throw new TypeError("compile requires a validated contract");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
