import { authorityCanonicalBytes, authorityDigest } from "../../authority/wire.js";
import { digestGovernedEffectCommitmentV1 } from "../../authority/governed-effect-commitment.js";
import { isStaticPackProxy } from "../../authority/pack.js";
import type { StaticPackCompileInput, StaticPackDefinition } from "../../authority/pack.js";
import { githubReleaseAliases, githubReleaseDefinitionDigests, githubReleaseEffects, githubReleasePackDigest, githubReleasePolicySchemaId, githubReleaseProjectionSchemaId, githubReleaseReadEndpointId, githubReleaseRecipeId, githubReleaseRiskClass, type GitHubReleaseEffect, type GitHubReleaseProjection } from "./manifest.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]{7,127}$/;

export interface GitHubReleaseGovernedBinding { readonly toolEffectContractDigest: string; readonly transportBindingDigest: string; readonly operationKind: string; readonly reviewedPolicyDigest: string }
export interface GitHubReleaseAllocationPolicy { readonly allocationDigest: string; readonly allocationId: string; readonly authorizationHandleDigest: string; readonly effect: GitHubReleaseEffect; readonly maxEffects: 1; readonly governed?: GitHubReleaseGovernedBinding }

export function validateGitHubReleaseChoices(value: unknown): Record<string, never> {
  inertRecord(value, [], "GitHub release choices (empty)");
  return Object.freeze({});
}

function parsePolicy(value: unknown, expectedEffect: GitHubReleaseEffect): GitHubReleaseAllocationPolicy {
  const governedDescriptor = value && typeof value === "object" && !isStaticPackProxy(value) ? Object.getOwnPropertyDescriptor(value, "governed") : undefined;
  const keys = governedDescriptor?.enumerable ? ["allocationDigest", "allocationId", "authorizationHandleDigest", "effect", "maxEffects", "governed"] : ["allocationDigest", "allocationId", "authorizationHandleDigest", "effect", "maxEffects"];
  const raw = inertRecord(value, keys, "GitHub release policy");
  const governedRaw = governedDescriptor?.enumerable ? inertRecord(raw.governed, ["toolEffectContractDigest", "transportBindingDigest", "operationKind", "reviewedPolicyDigest"], "GitHub release governed binding") : undefined;
  const governed = governedRaw ? Object.freeze({ toolEffectContractDigest: governedRaw.toolEffectContractDigest, transportBindingDigest: governedRaw.transportBindingDigest, operationKind: governedRaw.operationKind, reviewedPolicyDigest: governedRaw.reviewedPolicyDigest }) as GitHubReleaseGovernedBinding : undefined;
  const policy = Object.freeze({ allocationDigest: raw.allocationDigest, allocationId: raw.allocationId, authorizationHandleDigest: raw.authorizationHandleDigest, effect: raw.effect, maxEffects: raw.maxEffects, ...(governed ? { governed } : {}) }) as unknown as GitHubReleaseAllocationPolicy;
  if (!DIGEST.test(policy.allocationDigest) || !DIGEST.test(policy.authorizationHandleDigest) || !ID.test(policy.allocationId) || policy.effect !== expectedEffect || policy.maxEffects !== 1) throw new TypeError("GitHub release policy allocation or effect is invalid");
  if (policy.governed && ([policy.governed.toolEffectContractDigest, policy.governed.transportBindingDigest, policy.governed.reviewedPolicyDigest].some(value => typeof value !== "string" || !DIGEST.test(value)) || typeof policy.governed.operationKind !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(policy.governed.operationKind))) throw new TypeError("GitHub release governed binding is invalid");
  return policy;
}

function compile(input: StaticPackCompileInput, effect: GitHubReleaseEffect, index: number): unknown {
  const source = inertRecord(input.source.projection, ["authorizationHandle"], "GitHub release projection") as unknown as GitHubReleaseProjection;
  const policy = input.policy as GitHubReleaseAllocationPolicy;
  if (authorityDigest({ handle: source.authorizationHandle }) !== policy.authorizationHandleDigest) throw new TypeError("GitHub release authorization handle does not match host policy");
  const alias = githubReleaseAliases[index];
  const reviewedPolicyDigest = policy.governed?.reviewedPolicyDigest ?? authorityDigest(policy);
  const governedCommitmentDigest = digestGovernedEffectCommitmentV1({
    v: "reelier.governed-effect-commitment/v1", definitionAlias: alias, pathCContractDigest: authorityDigest(input.contract),
    toolEffectContractDigest: policy.governed?.toolEffectContractDigest ?? authorityDigest({ v: "reelier.legacy-tool-effect-contract-commitment/v1", definitionAlias: alias, effect, reviewedPolicyDigest }),
    transportBindingDigest: policy.governed?.transportBindingDigest ?? authorityDigest({ v: "reelier.legacy-effect-transport-binding-commitment/v1", definitionAlias: alias, effect, reviewedPolicyDigest }),
    compiledEffectInputDigest: authorityDigest({ v: "reelier.compiled-effect-input/v1", definitionAlias: alias, source: input.source, choices: input.choices, connectorAccount: input.connectorAccount }),
    requestCommitmentDigest: authorityDigest({ v: "reelier.effect-request-commitment/v1", definitionAlias: alias, projection: input.source.projection, choices: input.choices }),
    operationKind: policy.governed?.operationKind ?? `github.${effect}`, reviewedPolicyDigest, packDigest: githubReleasePackDigest, definitionDigest: githubReleaseDefinitionDigests[index],
  });
  return Object.freeze({
    v: "reelier.transport-effect/v1" as const, endpointId: `github.release.${effect}`, method: "POST" as const, path: "/internal/github-release", query: "",
    headers: Object.freeze({ "Content-Type": "application/json" }), bodyBase64: authorityCanonicalBytes({ authorizationHandle: source.authorizationHandle }).toString("base64"),
    riskClass: githubReleaseRiskClass, idempotency: "reconcile-only" as const,
    preconditions: Object.freeze([{ kind: `release-allocation-${effect}`, digest: authorityDigest(policy) }, { kind: "governed-effect-commitment-v1", digest: governedCommitmentDigest }]), reconciliation: Object.freeze({ recipeId: githubReleaseRecipeId }),
  });
}

function inertRecord(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || isStaticPackProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some(key => typeof key !== "string")) throw new TypeError(`${label} must be a closed inert record`);
  const descriptors = Object.getOwnPropertyDescriptors(value), actual = Object.keys(descriptors).sort();
  if (actual.join("\0") !== [...keys].sort().join("\0") || Object.values(descriptors).some(descriptor => !("value" in descriptor) || !descriptor.enumerable)) throw new TypeError(`${label} must be a closed inert record`);
  return Object.freeze(Object.fromEntries(keys.map(key => [key, descriptors[key]!.value])));
}

function definition(index: number): StaticPackDefinition {
  const alias = githubReleaseAliases[index], effect = githubReleaseEffects[index];
  return Object.freeze({ alias, packDigest: githubReleasePackDigest, definitionDigest: githubReleaseDefinitionDigests[index], resolverId: `${alias}_source`, projectionSchemaId: githubReleaseProjectionSchemaId, maxFreshnessSeconds: 60,
    readEndpointIds: [githubReleaseReadEndpointId], writeEndpointIds: [`github.release.${effect}`], riskClasses: [githubReleaseRiskClass], policySchemaId: githubReleasePolicySchemaId, requiredGroundedPointers: ["/authorizationHandle"],
    validateChoices: validateGitHubReleaseChoices, parsePolicy: (value: unknown) => parsePolicy(value, effect), compile: (input: StaticPackCompileInput) => compile(input, effect, index) });
}

export const githubReleaseCandidatePublishDefinition = definition(0);
export const githubReleasePrEnsureDefinition = definition(1);
export const githubReleasePrMergeDefinition = definition(2);
export const githubReleaseTagCreateDefinition = definition(3);
export const githubReleaseDefinitions = Object.freeze([githubReleaseCandidatePublishDefinition, githubReleasePrEnsureDefinition, githubReleasePrMergeDefinition, githubReleaseTagCreateDefinition]);
