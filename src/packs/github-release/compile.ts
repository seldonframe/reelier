import { authorityCanonicalBytes, authorityDigest } from "../../authority/wire.js";
import { isProxy } from "node:util/types";
import type { StaticPackCompileInput, StaticPackDefinition } from "../../authority/pack.js";
import { githubReleaseAliases, githubReleaseDefinitionDigests, githubReleaseEffects, githubReleasePackDigest, githubReleasePolicySchemaId, githubReleaseProjectionSchemaId, githubReleaseReadEndpointId, githubReleaseRecipeId, githubReleaseRiskClass, type GitHubReleaseEffect, type GitHubReleaseProjection } from "./manifest.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]{7,127}$/;

export interface GitHubReleaseAllocationPolicy { readonly allocationDigest: string; readonly allocationId: string; readonly authorizationHandleDigest: string; readonly effect: GitHubReleaseEffect; readonly maxEffects: 1 }

export function validateGitHubReleaseChoices(value: unknown): Record<string, never> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 0) throw new TypeError("GitHub release choices must be empty");
  return Object.freeze({});
}

function parsePolicy(value: unknown, expectedEffect: GitHubReleaseEffect): GitHubReleaseAllocationPolicy {
  const policy = inertRecord(value, ["allocationDigest", "allocationId", "authorizationHandleDigest", "effect", "maxEffects"], "GitHub release policy") as unknown as GitHubReleaseAllocationPolicy;
  if (!DIGEST.test(policy.allocationDigest) || !DIGEST.test(policy.authorizationHandleDigest) || !ID.test(policy.allocationId) || policy.effect !== expectedEffect || policy.maxEffects !== 1) throw new TypeError("GitHub release policy allocation or effect is invalid");
  return Object.freeze({ ...policy });
}

function compile(input: StaticPackCompileInput, effect: GitHubReleaseEffect): unknown {
  const source = inertRecord(input.source.projection, ["authorizationHandle"], "GitHub release projection") as unknown as GitHubReleaseProjection;
  const policy = input.policy as GitHubReleaseAllocationPolicy;
  if (authorityDigest({ handle: source.authorizationHandle }) !== policy.authorizationHandleDigest) throw new TypeError("GitHub release authorization handle does not match host policy");
  return Object.freeze({
    v: "reelier.transport-effect/v1" as const, endpointId: `github.release.${effect}`, method: "POST" as const, path: "/internal/github-release", query: "",
    headers: Object.freeze({ "Content-Type": "application/json" }), bodyBase64: authorityCanonicalBytes({ authorizationHandle: source.authorizationHandle }).toString("base64"),
    riskClass: githubReleaseRiskClass, idempotency: "reconcile-only" as const,
    preconditions: Object.freeze([{ kind: `release-allocation-${effect}`, digest: authorityDigest(policy) }]), reconciliation: Object.freeze({ recipeId: githubReleaseRecipeId }),
  });
}

function inertRecord(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some(key => typeof key !== "string")) throw new TypeError(`${label} must be a closed inert record`);
  const descriptors = Object.getOwnPropertyDescriptors(value), actual = Object.keys(descriptors).sort();
  if (actual.join("\0") !== [...keys].sort().join("\0") || Object.values(descriptors).some(descriptor => !("value" in descriptor) || !descriptor.enumerable)) throw new TypeError(`${label} must be a closed inert record`);
  return Object.freeze(Object.fromEntries(keys.map(key => [key, descriptors[key]!.value])));
}

function definition(index: number): StaticPackDefinition {
  const alias = githubReleaseAliases[index], effect = githubReleaseEffects[index];
  return Object.freeze({ alias, packDigest: githubReleasePackDigest, definitionDigest: githubReleaseDefinitionDigests[index], resolverId: `${alias}_source`, projectionSchemaId: githubReleaseProjectionSchemaId, maxFreshnessSeconds: 60,
    readEndpointIds: [githubReleaseReadEndpointId], writeEndpointIds: [`github.release.${effect}`], riskClasses: [githubReleaseRiskClass], policySchemaId: githubReleasePolicySchemaId, requiredGroundedPointers: ["/authorizationHandle"],
    validateChoices: validateGitHubReleaseChoices, parsePolicy: (value: unknown) => parsePolicy(value, effect), compile: (input: StaticPackCompileInput) => compile(input, effect) });
}

export const githubReleaseCandidatePublishDefinition = definition(0);
export const githubReleasePrEnsureDefinition = definition(1);
export const githubReleasePrMergeDefinition = definition(2);
export const githubReleaseTagCreateDefinition = definition(3);
export const githubReleaseDefinitions = Object.freeze([githubReleaseCandidatePublishDefinition, githubReleasePrEnsureDefinition, githubReleasePrMergeDefinition, githubReleaseTagCreateDefinition]);
