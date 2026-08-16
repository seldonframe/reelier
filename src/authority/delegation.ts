import type { AuthoritySignature, DelegationConstraints, DelegationGrant, DelegationPolicy, OutcomeContract } from "./types.js";
import type { TrustRoots } from "./trust.js";
import { verifyTrustedAuthority } from "./trust.js";

export interface StoredSignedGrant {
  readonly grant: unknown;
  readonly digest: string;
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}

export interface ValidatedDelegationChain {
  readonly grants: readonly DelegationGrant[];
  readonly digests: readonly string[];
  readonly leaf: DelegationGrant;
  readonly leafDigest: string;
  readonly leafGrantee: string;
}

export interface ChildDelegationRequestV1 {
  readonly parent: DelegationGrant;
  readonly child: DelegationGrant;
  readonly activeChildCount: number;
  readonly effects: number;
  readonly now: Date;
}

const validatedDelegationChains = new WeakSet<object>();

export function validateDelegationChain(input: Readonly<{ tenant: string; sponsor: string; now: Date; trustRoots: TrustRoots; grants: readonly StoredSignedGrant[] }>): ValidatedDelegationChain {
  if (input.grants.length === 0) throw new TypeError("delegation chain requires at least one leaf grant");
  const grants: DelegationGrant[] = [];
  const digests: string[] = [];
  const grantIds = new Set<string>();
  const seenDigests = new Set<string>();
  const now = input.now.getTime();
  for (let index = 0; index < input.grants.length; index++) {
    const stored = input.grants[index];
    const verified = verifyTrustedAuthority(input.trustRoots, { tenant: input.tenant, signerId: stored.signerId, purpose: "delegation-grant", advertisedDigest: stored.digest, value: stored.grant, signature: stored.signature });
    const grant = verified.value;
    if (grant.tenant !== input.tenant) throw new TypeError("delegation tenant mismatch");
    if (grant.sponsor !== input.sponsor) throw new TypeError("delegation sponsor drift");
    if (verified.principalId !== grant.grantor) throw new TypeError("delegation signer principal must equal grantor");
    if (grantIds.has(grant.grantId) || seenDigests.has(verified.digest)) throw new TypeError("duplicate delegation grant id or digest");
    if (grant.parentDigest === verified.digest || (grant.parentDigest !== null && seenDigests.has(grant.parentDigest) && grant.parentDigest !== digests[index - 1])) throw new TypeError("delegation cycle detected");
    grantIds.add(grant.grantId);
    seenDigests.add(verified.digest);
    const issued = Date.parse(grant.issuedAt);
    const expires = Date.parse(grant.expiresAt);
    if (now < issued || now >= expires) throw new TypeError("delegation grant is outside current validity");
    if (index === 0) {
      if (grant.parentDigest !== null) throw new TypeError("root delegation parent digest must be null");
    } else {
      const previous = grants[index - 1];
      if (grant.parentDigest !== digests[index - 1]) throw new TypeError("delegation parent digest does not link previous grant");
      if (previous.grantee !== grant.grantor) throw new TypeError("previous grantee must equal child grantor");
      if (issued < Date.parse(previous.issuedAt) || expires > Date.parse(previous.expiresAt)) throw new TypeError("child validity must be contained by parent validity");
      assertAttenuated(previous.constraints, grant.constraints);
      assertDelegationPolicyAttenuated(previous.delegationPolicy, grant.delegationPolicy);
    }
    grants.push(grant);
    digests.push(verified.digest);
  }
  const leaf = grants[grants.length - 1];
  const chain = Object.freeze({ grants: Object.freeze(grants), digests: Object.freeze(digests), leaf, leafDigest: digests[digests.length - 1], leafGrantee: leaf.grantee });
  validatedDelegationChains.add(chain);
  return chain;
}

export function assertValidatedDelegationChain(value: unknown): asserts value is ValidatedDelegationChain {
  if (!value || typeof value !== "object" || !validatedDelegationChains.has(value)) throw new TypeError("validated delegation chain required");
}

/** Validates an unsigned child request before the Authority Cell mints a grant. */
export function validateChildDelegationRequest(input: ChildDelegationRequestV1): void {
  const policy = input.parent.delegationPolicy;
  if (!policy?.mayDelegate) throw new TypeError("delegation parent has no mayDelegate authority");
  if (!Number.isInteger(input.activeChildCount) || input.activeChildCount < 0 || input.activeChildCount >= policy.maxFanOut) throw new TypeError("delegation fan-out exceeds parent policy");
  if (!Number.isInteger(input.effects) || input.effects < 0 || input.effects > policy.maxDelegatedEffects) throw new TypeError("delegation budget exceeds parent policy");
  const issued = Date.parse(input.child.issuedAt), expires = Date.parse(input.child.expiresAt), now = input.now.getTime();
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || now < issued || expires <= now || issued < Date.parse(input.parent.issuedAt) || expires > Date.parse(input.parent.expiresAt)) throw new TypeError("child validity exceeds parent delegation");
  if (expires - now > policy.maxChildDurationSeconds * 1000) throw new TypeError("delegation child duration exceeds parent policy");
  if (input.child.grantor !== input.parent.grantee) throw new TypeError("child grantor must equal parent grantee");
  assertAttenuated(input.parent.constraints, input.child.constraints);
  assertDelegationPolicyAttenuated(policy, input.child.delegationPolicy);
}

function assertAttenuated(parent: DelegationConstraints, child: DelegationConstraints): void {
  assertSubset(parent.definitionAliases, child.definitionAliases, "definition widening");
  assertSubset(parent.audiences, child.audiences, "audience widening");
  const accounts = parent.connectorAccounts.map(value => `${value.connectorId}\0${value.accountId}`);
  assertSubset(accounts, child.connectorAccounts.map(value => `${value.connectorId}\0${value.accountId}`), "connector account widening");
  assertSubset(parent.projectionPointers, child.projectionPointers, "projection widening");
  assertSubset(parent.riskClasses, child.riskClasses, "risk widening");
  if (parent.limits.windowSeconds !== child.limits.windowSeconds) throw new TypeError("delegation fixed window must remain equal");
  for (const field of ["maxEffectsPerWindow", "maxEffectsPerSourceTrigger", "maxBodyBytes"] as const) {
    if (child.limits[field] > parent.limits[field]) throw new TypeError(`delegation ${field} widening`);
  }
}

function assertDelegationPolicyAttenuated(parent: DelegationPolicy | undefined, child: DelegationPolicy | undefined): void {
  if (!parent) {
    if (child?.mayDelegate) throw new TypeError("delegation mayDelegate widening");
    return;
  }
  if (!parent.mayDelegate) {
    if (child?.mayDelegate) throw new TypeError("delegation mayDelegate widening");
    return;
  }
  if (!child) return;
  if (child.mayDelegate && !parent.mayDelegate) throw new TypeError("delegation mayDelegate widening");
  if (child.maxDepth >= parent.maxDepth) throw new TypeError("delegation depth widening");
  if (child.maxFanOut > parent.maxFanOut) throw new TypeError("delegation fan-out widening");
  if (child.maxChildDurationSeconds > parent.maxChildDurationSeconds) throw new TypeError("delegation duration widening");
  if (child.maxDelegatedEffects > parent.maxDelegatedEffects) throw new TypeError("delegation budget widening");
}

function assertSubset(parent: readonly string[], child: readonly string[], message: string): void {
  const allowed = new Set(parent);
  if (child.some(value => !allowed.has(value))) throw new TypeError(`delegation ${message}`);
}

type ContractDelegationView = Pick<OutcomeContract, "tenant" | "sponsor" | "delegationGrantDigest" | "alias" | "audiences" | "connectorId" | "accountId" | "riskClasses" | "limits" | "validFrom" | "validUntil"> & Readonly<{ sourceAuthority: Readonly<{ authorizedProjectionPointers: string[] }> }>;

export function validateContractAgainstDelegation(contract: ContractDelegationView, chain: ValidatedDelegationChain): void {
  const leaf = chain.leaf;
  if (contract.delegationGrantDigest !== chain.leafDigest) throw new TypeError("contract must bind delegation leaf digest");
  if (contract.tenant !== leaf.tenant) throw new TypeError("contract tenant exceeds delegation leaf");
  if (contract.sponsor !== leaf.sponsor) throw new TypeError("contract sponsor exceeds delegation leaf");
  assertSubset(leaf.constraints.definitionAliases, [contract.alias], "contract definition widening");
  assertSubset(leaf.constraints.audiences, contract.audiences, "contract audience widening");
  assertSubset(leaf.constraints.connectorAccounts.map(value => `${value.connectorId}\0${value.accountId}`), [`${contract.connectorId}\0${contract.accountId}`], "contract connector account widening");
  assertSubset(leaf.constraints.projectionPointers, contract.sourceAuthority.authorizedProjectionPointers, "contract projection widening");
  assertSubset(leaf.constraints.riskClasses, contract.riskClasses, "contract risk widening");
  if (contract.limits.windowSeconds !== leaf.constraints.limits.windowSeconds) throw new TypeError("contract limit fixed window mismatch");
  for (const field of ["maxEffectsPerWindow", "maxEffectsPerSourceTrigger", "maxBodyBytes"] as const) if (contract.limits[field] > leaf.constraints.limits[field]) throw new TypeError(`contract limit ${field} widening`);
  if (Date.parse(contract.validFrom) < Date.parse(leaf.issuedAt) || Date.parse(contract.validUntil) > Date.parse(leaf.expiresAt)) throw new TypeError("contract validity exceeds delegation leaf validity");
}
