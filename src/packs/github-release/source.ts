import type { PlannedSourceRead, RegisteredSourceResolver, ResolverSourceObservation, SourceProjection } from "../../authority/source.js";
import { authorityDigest } from "../../authority/wire.js";
import { githubReleaseAliases, githubReleaseDefinitionDigests, githubReleaseProjectionSchemaId, githubReleaseReadEndpointId } from "./manifest.js";

const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

export function createGitHubReleaseSourceResolvers(tenant = "*"): readonly RegisteredSourceResolver[] {
  if (typeof tenant !== "string" || tenant.length === 0) throw new TypeError("tenant is required");
  return Object.freeze(githubReleaseAliases.map((alias, index) => Object.freeze({
    tenant, resolverId: `${alias}_source`, definitionDigest: githubReleaseDefinitionDigests[index], projectionSchemaId: githubReleaseProjectionSchemaId,
    readEndpointIds: [githubReleaseReadEndpointId], maxFreshnessSeconds: 60,
    plan: (refs: Readonly<Record<string, string>>) => {
      if (Object.keys(refs).length !== 1 || !OPAQUE.test(refs.authorization ?? "")) throw new TypeError("GitHub release source requires one opaque authorization reference");
      return [Object.freeze({ endpointId: githubReleaseReadEndpointId, opaqueHandle: refs.authorization })];
    },
    project: (input: Readonly<{ plans: readonly PlannedSourceRead[]; observations: readonly ResolverSourceObservation[]; observedAt: string }>): SourceProjection => {
      if (input.plans.length !== 1 || input.observations.length !== 1) throw new TypeError("GitHub release source requires one authenticated observation");
      let raw: unknown;
      try { raw = JSON.parse(Buffer.from(input.observations[0].bodyBase64, "base64").toString("utf8")); } catch { throw new TypeError("GitHub release source is not JSON"); }
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 1 || !OPAQUE.test((raw as Record<string, string>).authorizationHandle ?? "")) throw new TypeError("GitHub release source must expose only an opaque authorization handle");
      const authorizationHandle = (raw as Record<string, string>).authorizationHandle;
      return Object.freeze({
        sourceIdentity: `github-release-${authorityDigest({ authorizationHandle }).slice(7)}`,
        triggerIdentity: `github-release-${authorityDigest({ alias, authorizationHandle }).slice(7)}`,
        projection: Object.freeze({ authorizationHandle }),
        claims: Object.freeze({ grounded: Object.freeze([{ claimId: "github-release-authorization", projectionPointer: "/authorizationHandle" }]), authored: Object.freeze([]), unresolved: Object.freeze([]) }),
      });
    },
  })));
}
