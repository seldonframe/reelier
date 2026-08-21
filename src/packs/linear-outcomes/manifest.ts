import { authorityDigest } from "../../authority/wire.js";

export const linearEvidenceCommentAlias = "linear_evidence_comment_v1" as const;
export const linearStatusTransitionAlias = "linear_status_transition_v1" as const;
export const linearOnlyEvidenceCommentAlias = "linear_only_evidence_comment_v1" as const;
export const linearOnlyStatusTransitionAlias = "linear_only_status_transition_v1" as const;
export const linearOutcomeAliases = [linearEvidenceCommentAlias, linearStatusTransitionAlias, linearOnlyEvidenceCommentAlias, linearOnlyStatusTransitionAlias] as const;
export const linearOutcomeEffects = ["evidence-comment", "status-transition", "evidence-comment", "status-transition"] as const;
export type LinearOutcomeAlias = (typeof linearOutcomeAliases)[number];
export type LinearOutcomeEffect = (typeof linearOutcomeEffects)[number];

export const linearOutcomeProjectionSchemaId = "linear_authorization_handle_projection_v1";
export const linearOutcomePolicySchemaId = "linear_one_effect_allocation_policy_v1";
export const linearOutcomeReadEndpointId = "linear.outcomes.authorization.read";
export const linearOutcomeRiskClass = "linear_outcome";
export const linearOutcomeRecipeId = "linear_outcome_authoritative_readback_v1";

const definitions = linearOutcomeAliases.map((alias, index) => Object.freeze({
  v: "reelier.outcome-pack-definition/v1", alias, resolverId: `${alias}_source`, projectionSchemaId: linearOutcomeProjectionSchemaId,
  policySchemaId: linearOutcomePolicySchemaId, readEndpointIds: [linearOutcomeReadEndpointId], writeEndpointIds: [`linear.outcomes.${linearOutcomeEffects[index]}`],
  riskClasses: [linearOutcomeRiskClass], requiredGroundedPointers: ["/authorizationHandle"], maxFreshnessSeconds: 60,
}));
export const linearOutcomePackDigest = authorityDigest({ v: "reelier.outcome-pack/v1", packId: "linear_outcomes", definitions });
export const linearOutcomeDefinitionDigests = Object.freeze(definitions.map(definition => authorityDigest({ ...definition, packDigest: linearOutcomePackDigest })));
export const linearOutcomeManifest = Object.freeze({ v: "reelier.outcome-pack-manifest/v1" as const, packId: "linear_outcomes", packDigest: linearOutcomePackDigest, definitions: linearOutcomeAliases });

export interface LinearOutcomeProjection extends Record<string, unknown> { readonly authorizationHandle: string }
