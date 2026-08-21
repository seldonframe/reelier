import { authorityCanonicalBytes, authorityDigest } from "../../authority/wire.js";
import { digestGovernedEffectCommitmentV1 } from "../../authority/governed-effect-commitment.js";
import { isStaticPackProxy } from "../../authority/pack.js";
import type { StaticPackCompileInput, StaticPackDefinition } from "../../authority/pack.js";
import { linearEvidenceCommentAlias, linearOutcomeAliases, linearOutcomeDefinitionDigests, linearOutcomeEffects, linearOutcomePackDigest, linearOutcomePolicySchemaId, linearOutcomeProjectionSchemaId, linearOutcomeReadEndpointId, linearOutcomeRecipeId, linearOutcomeRiskClass, type LinearOutcomeEffect, type LinearOutcomeProjection } from "./manifest.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]{7,127}$/;
const OPERATION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export interface LinearOutcomeGovernedBinding { readonly toolEffectContractDigest: string; readonly transportBindingDigest: string; readonly operationKind: string; readonly reviewedPolicyDigest: string; readonly predecessorToolEffectContractDigest?: string }
export interface LinearOutcomeAllocationPolicy { readonly allocationDigest: string; readonly allocationId: string; readonly authorizationHandleDigest: string; readonly effect: LinearOutcomeEffect; readonly maxEffects: 1; readonly governed: LinearOutcomeGovernedBinding; readonly predecessorAlias?: typeof linearEvidenceCommentAlias; readonly predecessorContractDigest?: string; readonly predecessorReceiptRequired?: true }

export function validateLinearOutcomeChoices(value: unknown): Record<string, never> { inertRecord(value, [], "Linear Outcome choices (empty)"); return Object.freeze({}); }

function parsePolicy(value: unknown, expectedEffect: LinearOutcomeEffect): LinearOutcomeAllocationPolicy {
  const status = expectedEffect === "status-transition";
  const keys = status ? ["allocationDigest", "allocationId", "authorizationHandleDigest", "effect", "maxEffects", "governed", "predecessorAlias", "predecessorContractDigest", "predecessorReceiptRequired"] : ["allocationDigest", "allocationId", "authorizationHandleDigest", "effect", "maxEffects", "governed"];
  const raw = inertRecord(value, keys, "Linear Outcome policy");
  const governedKeys = status ? ["toolEffectContractDigest", "transportBindingDigest", "operationKind", "reviewedPolicyDigest", "predecessorToolEffectContractDigest"] : ["toolEffectContractDigest", "transportBindingDigest", "operationKind", "reviewedPolicyDigest"];
  const governedRaw = inertRecord(raw.governed, governedKeys, "Linear Outcome governed binding");
  const governed = Object.freeze({ toolEffectContractDigest: governedRaw.toolEffectContractDigest, transportBindingDigest: governedRaw.transportBindingDigest, operationKind: governedRaw.operationKind, reviewedPolicyDigest: governedRaw.reviewedPolicyDigest, ...(status ? { predecessorToolEffectContractDigest: governedRaw.predecessorToolEffectContractDigest } : {}) }) as LinearOutcomeGovernedBinding;
  const policy = Object.freeze({ allocationDigest: raw.allocationDigest, allocationId: raw.allocationId, authorizationHandleDigest: raw.authorizationHandleDigest, effect: raw.effect, maxEffects: raw.maxEffects, governed, ...(status ? { predecessorAlias: raw.predecessorAlias, predecessorContractDigest: raw.predecessorContractDigest, predecessorReceiptRequired: raw.predecessorReceiptRequired } : {}) }) as unknown as LinearOutcomeAllocationPolicy;
  if (!DIGEST.test(policy.allocationDigest) || !DIGEST.test(policy.authorizationHandleDigest) || !ID.test(policy.allocationId) || policy.effect !== expectedEffect || policy.maxEffects !== 1 || [governed.toolEffectContractDigest, governed.transportBindingDigest, governed.reviewedPolicyDigest].some(item => typeof item !== "string" || !DIGEST.test(item)) || typeof governed.operationKind !== "string" || !OPERATION.test(governed.operationKind)) throw new TypeError("Linear Outcome policy allocation, effect, or governed binding is invalid");
  if (status && (policy.predecessorAlias !== linearEvidenceCommentAlias || typeof policy.predecessorContractDigest !== "string" || !DIGEST.test(policy.predecessorContractDigest) || policy.predecessorReceiptRequired !== true || governed.predecessorToolEffectContractDigest !== policy.predecessorContractDigest)) throw new TypeError("Linear status requires the exact verified comment predecessor contract and receipt");
  return policy;
}

function compile(input: StaticPackCompileInput, effect: LinearOutcomeEffect, index: number): unknown {
  const source = inertRecord(input.source.projection, ["authorizationHandle"], "Linear Outcome projection") as unknown as LinearOutcomeProjection;
  const policy = input.policy as LinearOutcomeAllocationPolicy;
  if (authorityDigest({ handle: source.authorizationHandle }) !== policy.authorizationHandleDigest) throw new TypeError("Linear Outcome authorization handle does not match host policy");
  const alias = linearOutcomeAliases[index];
  const governedCommitmentDigest = digestGovernedEffectCommitmentV1({
    v: "reelier.governed-effect-commitment/v1", definitionAlias: alias, pathCContractDigest: authorityDigest(input.contract), toolEffectContractDigest: policy.governed.toolEffectContractDigest,
    transportBindingDigest: policy.governed.transportBindingDigest, compiledEffectInputDigest: authorityDigest({ v: "reelier.compiled-effect-input/v1", definitionAlias: alias, source: input.source, choices: input.choices, connectorAccount: input.connectorAccount }),
    requestCommitmentDigest: authorityDigest({ v: "reelier.effect-request-commitment/v1", definitionAlias: alias, projection: input.source.projection, choices: input.choices }), operationKind: policy.governed.operationKind,
    reviewedPolicyDigest: policy.governed.reviewedPolicyDigest, packDigest: linearOutcomePackDigest, definitionDigest: linearOutcomeDefinitionDigests[index],
  });
  const predecessor = effect === "status-transition" ? [{ kind: "linear-comment-predecessor-v1", digest: authorityDigest({ v: "reelier.linear-comment-predecessor/v1", alias: policy.predecessorAlias, contractDigest: policy.predecessorContractDigest, receiptRequired: true }) }] : [];
  return Object.freeze({ v: "reelier.transport-effect/v1" as const, endpointId: `linear.outcomes.${effect}`, method: "POST" as const, path: "/internal/linear-outcomes", query: "", headers: Object.freeze({ "Content-Type": "application/json" }), bodyBase64: authorityCanonicalBytes({ authorizationHandle: source.authorizationHandle }).toString("base64"), riskClass: linearOutcomeRiskClass, idempotency: "reconcile-only" as const, preconditions: Object.freeze([{ kind: `linear-allocation-${effect}`, digest: authorityDigest(policy) }, ...predecessor, { kind: "governed-effect-commitment-v1", digest: governedCommitmentDigest }]), reconciliation: Object.freeze({ recipeId: linearOutcomeRecipeId }) });
}

function inertRecord(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || isStaticPackProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some(key => typeof key !== "string")) throw new TypeError(`${label} must be a closed inert record`);
  const descriptors = Object.getOwnPropertyDescriptors(value), actual = Object.keys(descriptors).sort();
  if (actual.join("\0") !== [...keys].sort().join("\0") || Object.values(descriptors).some(descriptor => !("value" in descriptor) || !descriptor.enumerable)) throw new TypeError(`${label} must be a closed inert record`);
  return Object.freeze(Object.fromEntries(keys.map(key => [key, descriptors[key]!.value])));
}

function definition(index: number): StaticPackDefinition {
  const alias = linearOutcomeAliases[index], effect = linearOutcomeEffects[index];
  return Object.freeze({ alias, packDigest: linearOutcomePackDigest, definitionDigest: linearOutcomeDefinitionDigests[index], resolverId: `${alias}_source`, projectionSchemaId: linearOutcomeProjectionSchemaId, maxFreshnessSeconds: 60, readEndpointIds: [linearOutcomeReadEndpointId], writeEndpointIds: [`linear.outcomes.${effect}`], riskClasses: [linearOutcomeRiskClass], policySchemaId: linearOutcomePolicySchemaId, requiredGroundedPointers: ["/authorizationHandle"], validateChoices: validateLinearOutcomeChoices, parsePolicy: (value: unknown) => parsePolicy(value, effect), compile: (input: StaticPackCompileInput) => compile(input, effect, index) });
}

export const linearEvidenceCommentDefinition = definition(0);
export const linearStatusTransitionDefinition = definition(1);
export const linearOutcomeDefinitions = Object.freeze([linearEvidenceCommentDefinition, linearStatusTransitionDefinition]);
