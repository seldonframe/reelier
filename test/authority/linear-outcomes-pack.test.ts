import test from "node:test";
import assert from "node:assert/strict";
import { authorityDigest } from "../../src/authority/wire.js";
import {
  linearEvidenceCommentAlias,
  linearEvidenceCommentDefinition,
  linearOutcomeAliases,
  linearOutcomeManifest,
  linearStatusTransitionAlias,
  linearStatusTransitionDefinition,
} from "../../src/packs/linear-outcomes/index.js";
import { governedOutcomeCompositionAliasesV1 } from "../../src/authority/packs/github-linear-outcomes.js";

const sha = (character: string) => `sha256:${character.repeat(64)}`;
const source = Object.freeze({ sourceIdentity: "linear-source", triggerIdentity: "linear-trigger", projection: Object.freeze({ authorizationHandle: "linear_auth_1" }), claims: Object.freeze({ grounded: Object.freeze([{ claimId: "linear-authorization", projectionPointer: "/authorizationHandle" }]), authored: Object.freeze([]), unresolved: Object.freeze([]) }) });
const connectorAccount = Object.freeze({ connectorId: "linear", accountId: "workspace_1" });

function policy(effect: "evidence-comment" | "status-transition") {
  const common = { allocationDigest: sha("a"), allocationId: `linear-${effect}-allocation`, authorizationHandleDigest: authorityDigest({ handle: "linear_auth_1" }), effect, maxEffects: 1 as const, governed: { toolEffectContractDigest: sha(effect === "evidence-comment" ? "b" : "c"), transportBindingDigest: sha("d"), operationKind: `linear.${effect}`, reviewedPolicyDigest: sha("e") } };
  return effect === "status-transition" ? { ...common, predecessorAlias: linearEvidenceCommentAlias, predecessorContractDigest: sha("b"), predecessorReceiptRequired: true } : common;
}

test("Linear is a signed two-definition Path-C pack and the governed profile has exactly five canonical aliases", () => {
  assert.deepEqual(linearOutcomeManifest.definitions, [linearEvidenceCommentAlias, linearStatusTransitionAlias]);
  assert.deepEqual(linearOutcomeAliases, [linearEvidenceCommentAlias, linearStatusTransitionAlias]);
  assert.deepEqual(governedOutcomeCompositionAliasesV1, ["github_release_candidate_publish_v1", "github_release_pr_ensure_v1", "github_release_pr_merge_v1", linearEvidenceCommentAlias, linearStatusTransitionAlias]);
});

test("both Linear definitions emit an exact durable governed commitment and status binds its comment predecessor", () => {
  for (const [definition, effect] of [[linearEvidenceCommentDefinition, "evidence-comment"], [linearStatusTransitionDefinition, "status-transition"]] as const) {
    const contract = { alias: definition.alias, packDigest: definition.packDigest, definitionDigest: definition.definitionDigest } as never;
    const parsedPolicy = definition.parsePolicy(policy(effect));
    const compiled = definition.compile({ contract, source, choices: Object.freeze({}), policy: parsedPolicy, connectorAccount } as never) as any;
    assert.equal(compiled.v, "reelier.transport-effect/v1");
    assert.equal(compiled.preconditions.filter((item: any) => item.kind === "governed-effect-commitment-v1").length, 1);
    assert.equal(compiled.preconditions[0].kind, `linear-allocation-${effect}`);
    if (effect === "status-transition") assert.equal(compiled.preconditions[1].kind, "linear-comment-predecessor-v1");
  }
});

test("status refuses any missing or substituted comment predecessor binding", () => {
  const base = policy("status-transition") as any;
  for (const changed of [
    { ...base, predecessorAlias: "other_alias" },
    { ...base, predecessorContractDigest: sha("f") },
    { ...base, predecessorReceiptRequired: false },
  ]) assert.throws(() => linearStatusTransitionDefinition.parsePolicy(changed), /predecessor|comment/i);
});
