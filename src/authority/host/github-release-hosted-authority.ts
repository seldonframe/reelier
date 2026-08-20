import { authorityDigest } from "../wire.js";
import type { VerifiedCustomerRootedAuthorityV1 } from "../ambient-authority.js";
import type { VerifiedReleaseAuthorizationV1 } from "../release-contracts.js";

export interface GitHubReleaseHostedAuthorityBindingV1 {
  readonly v: "reelier.github-release-hosted-authority-binding/v1";
  readonly digest: string;
}

interface BindingRecord {
  readonly authority: VerifiedCustomerRootedAuthorityV1;
  readonly digest: string;
}

const bindings = new WeakMap<GitHubReleaseHostedAuthorityBindingV1, BindingRecord>();

/**
 * Host-only capability that carries an already verified customer-rooted authority into the
 * four-outcome release runner. It deliberately contains no provider credential or resolver.
 */
export function createGitHubReleaseHostedAuthorityBindingV1(authority: VerifiedCustomerRootedAuthorityV1): GitHubReleaseHostedAuthorityBindingV1 {
  if (!authority || !authority.domain || !authority.proof || !authority.standing || !authority.hosted || !authority.mission) throw new TypeError("verified hosted authority is required");
  const digest = authorityDigest({
    v: "reelier.github-release-hosted-authority-binding/v1",
    authorityDigest: authority.mission.authorityDigest,
    hostedAuthorityDigest: authority.mission.hostedAuthorityDigest,
    missionGrantDigest: authorityDigest(authority.mission),
    standingAuthorityDigest: authority.mission.standingAuthorityDigest,
    trustDomainDigest: authority.mission.trustDomainDigest,
  });
  const binding = Object.freeze({ v: "reelier.github-release-hosted-authority-binding/v1" as const, digest });
  bindings.set(binding, Object.freeze({ authority, digest }));
  return binding;
}

/** Returns the digest that must be carried into provider-readback evidence and durable receipts. */
export function assertGitHubReleaseHostedAuthorityBindingV1(value: unknown, authorization: VerifiedReleaseAuthorizationV1, now: Date): string {
  if (!value || typeof value !== "object" || !bindings.has(value as GitHubReleaseHostedAuthorityBindingV1)) throw new TypeError("hosted release authority binding is absent or unrecognized");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError("hosted release authority clock is invalid");
  const record = bindings.get(value as GitHubReleaseHostedAuthorityBindingV1)!;
  const authority = record.authority;
  if (authority.mission.connector.connectorId !== "github" || authority.mission.connector.accountId !== authorization.operationPlan.value.repository) throw new TypeError("hosted release authority GitHub account does not match the signed release repository");
  const time = now.getTime();
  for (const [label, validFrom, validUntil] of [["customer approval", authority.proof.issuedAt, authority.proof.expiresAt], ["standing authority", authority.standing.validFrom, authority.standing.validUntil], ["hosted authority", authority.hosted.validFrom, authority.hosted.validUntil], ["mission child grant", authority.mission.validFrom, authority.mission.validUntil]] as const) {
    if (time < Date.parse(validFrom) || time >= Date.parse(validUntil)) throw new TypeError(`${label} is stale for the release outcome`);
  }
  return authorityDigest({ v: "reelier.github-release-hosted-release-binding/v1", hostedAuthorityBindingDigest: record.digest, releaseAuthorizationDigest: authorization.authorization.digest });
}
