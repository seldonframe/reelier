import { linearOutcomeManifest, linearEvidenceCommentAlias, linearStatusTransitionAlias } from "./manifest.js";
import { linearEvidenceCommentDefinition, linearOutcomeDefinitions, linearStatusTransitionDefinition, validateLinearOutcomeChoices } from "./compile.js";
import { createLinearOutcomeSourceResolvers } from "./source.js";
import { reconcileLinearOutcome } from "./reconcile.js";

const resolvers = createLinearOutcomeSourceResolvers();
export const linearOutcomePacks = Object.freeze(linearOutcomeDefinitions.map((definition, index) => Object.freeze({ manifest: linearOutcomeManifest, definition, resolver: resolvers[index], reconcile: reconcileLinearOutcome })));

export { linearOutcomeManifest, linearEvidenceCommentAlias, linearStatusTransitionAlias, linearOnlyEvidenceCommentAlias, linearOnlyStatusTransitionAlias, linearOutcomeAliases, linearOutcomePackDigest, linearOutcomeDefinitionDigests } from "./manifest.js";
export { linearEvidenceCommentDefinition, linearStatusTransitionDefinition, linearOnlyEvidenceCommentDefinition, linearOnlyStatusTransitionDefinition, linearOutcomeDefinitions, validateLinearOutcomeChoices } from "./compile.js";
export { createLinearOutcomeSourceResolvers } from "./source.js";
export { reconcileLinearOutcome } from "./reconcile.js";
