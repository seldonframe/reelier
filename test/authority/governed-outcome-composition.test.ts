import test from "node:test";
import assert from "node:assert/strict";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import { digestGovernedEffectCommitmentV1 } from "../../src/authority/governed-effect-commitment.js";
import { resolveGovernedCoordinatorPublicationV1, verifyGovernedOutcomeEffectJoinV1 } from "../../src/authority/host/governed-outcome-composition.js";

const sha = (character: string) => `sha256:${character.repeat(64)}`;
const alias = "github_release_candidate_publish_v1";
const pathCContract = Object.freeze({ alias, packDigest: sha("a"), definitionDigest: sha("b") });
const source = Object.freeze({ projection: Object.freeze({ authorizationHandle: "release_auth_1" }), sourceIdentity: "source_1", triggerIdentity: "trigger_1" });
const choices = Object.freeze({});
const connectorAccount = Object.freeze({ connectorId: "github", accountId: "host" });
const toolEffectContract = Object.freeze({ v: "reelier.tool-effect-contract/v1", contractId: "reviewed.candidate", provider: "github", operation: "github.candidate-publish", operationDigest: sha("1"), schemaDigest: sha("2"), policyDigest: sha("3"), effectClass: "idempotent-write", model: { fields: ["authorizationHandle", "requestId"], maxBytes: 16_384 }, bindings: { credentialRef: "credential", accountRef: "account", destinationRef: "destination", limitRef: "limit" }, semanticIdentity: sha("4"), idempotencyKey: sha("5"), readback: { operation: "github.candidate-readback", projection: ["/repository"] }, result: { success: ["applied"], conflict: ["conflict"], definitiveFailure: ["refused"], ambiguity: ["uncertain"] }, maximumEvidenceGrade: "verified" });
const transportBinding = Object.freeze({ v: "reelier.effect-transport-binding/v1", kind: "mcp", operation: "github.candidate-publish", server: "github", tool: alias, serverSchemaDigest: sha("6"), toolSchemaDigest: sha("7"), readback: { operation: "github.candidate-readback", tool: "github_release_candidate_publish_readback_v1", toolSchemaDigest: sha("8") } });
const reviewedPolicyDigest = sha("9");

function fixture() {
  const commitment = {
    v: "reelier.governed-effect-commitment/v1" as const, definitionAlias: alias, pathCContractDigest: authorityDigest(pathCContract),
    toolEffectContractDigest: authorityDigest(toolEffectContract), transportBindingDigest: authorityDigest(transportBinding),
    compiledEffectInputDigest: authorityDigest({ v: "reelier.compiled-effect-input/v1", definitionAlias: alias, source, choices, connectorAccount }),
    requestCommitmentDigest: authorityDigest({ v: "reelier.effect-request-commitment/v1", definitionAlias: alias, projection: source.projection, choices }),
    operationKind: "github.candidate-publish", reviewedPolicyDigest, packDigest: pathCContract.packDigest, definitionDigest: pathCContract.definitionDigest,
  };
  const effect = Object.freeze({ v: "reelier.transport-effect/v1", endpointId: "github.release.candidate-branch", method: "POST", path: "/internal/github-release", query: "", headers: { "Content-Type": "application/json" }, bodyBase64: Buffer.from("{}").toString("base64"), riskClass: "github_release", idempotency: "reconcile-only", preconditions: [{ kind: "release-allocation-candidate-branch", digest: sha("c") }, { kind: "governed-effect-commitment-v1", digest: digestGovernedEffectCommitmentV1(commitment) }], reconciliation: { recipeId: "github_release_authoritative_readback_v1" } });
  const effectDigest = authorityDigest(effect);
  const reservation = Object.freeze({ reservationId: "reservation_1", state: "reserved", intent: { definitionAlias: alias, contractDigest: authorityDigest(pathCContract), effectDigest, effectCanonicalBase64: authorityCanonicalBytes(effect).toString("base64") } });
  return { commitment, effect, reservation, input: { reservation, pathCContract, source, choices, connectorAccount, toolEffectContract, transportBinding, operationKind: "github.candidate-publish", reviewedPolicyDigest } };
}

test("canonical ledger bytes rederive the governed join after full runtime recreation", () => {
  const first = fixture();
  const verified = verifyGovernedOutcomeEffectJoinV1(first.input as never);
  assert.equal(verified.commitmentDigest, digestGovernedEffectCommitmentV1(first.commitment));
  assert.equal(verified.reservationId, "reservation_1");

  const restarted = fixture();
  assert.deepEqual(verifyGovernedOutcomeEffectJoinV1(restarted.input as never), verified, "no live capability or WeakMap state participates in restart verification");
});

test("every durable commitment substitution refuses before any host binding", () => {
  const base = fixture();
  for (const [name, replacement] of [
    ["pathCContract", { ...pathCContract, definitionDigest: sha("d") }],
    ["toolEffectContract", { ...toolEffectContract, policyDigest: sha("d") }],
    ["transportBinding", { ...transportBinding, toolSchemaDigest: sha("d") }],
    ["source", { ...source, sourceIdentity: "source_other" }],
    ["choices", { mode: "other" }],
    ["operationKind", "github.other"],
    ["reviewedPolicyDigest", sha("d")],
  ] as const) assert.throws(() => verifyGovernedOutcomeEffectJoinV1({ ...base.input, [name]: replacement } as never), /commitment|join|contract|ledger/i, name);

  const decoded = JSON.parse(Buffer.from(base.reservation.intent.effectCanonicalBase64, "base64").toString("utf8"));
  decoded.preconditions.push({ kind: "governed-effect-commitment-v1", digest: decoded.preconditions[1].digest });
  const changed = { ...base.reservation, intent: { ...base.reservation.intent, effectCanonicalBase64: Buffer.from(JSON.stringify(decoded)).toString("base64") } };
  assert.throws(() => verifyGovernedOutcomeEffectJoinV1({ ...base.input, reservation: changed } as never), /canonical|ledger|commitment/i);
});

test("only the exact terminal coordinator publication head resolves as verified", async () => {
  const identity = { v: "reelier.durable-dispatch-publication-identity/v1" as const, reservationId: "reservation_1", tenant: "tenant_1", requestDigest: sha("1"), capabilityDigest: sha("2"), effectDigest: sha("3"), routeAuthorityDigest: sha("4"), expectedDispatchedRequestDigest: sha("5"), reservationIntentDigest: sha("6") };
  const query = { v: "reelier.durable-dispatch-publication-query/v1" as const, identity, ledgerState: "dispatched" as const, sendStarted: true as const };
  const outcome = { kind: "acknowledged" as const, resultDigest: sha("7"), providerResultDigest: sha("8"), receiptRef: sha("7"), evidenceDigest: sha("9"), priorReceiptDigest: sha("a") };
  const head = { v: "reelier.durable-dispatch-publication-head/v1" as const, identity, receiptRef: outcome.receiptRef, evidenceDigest: outcome.evidenceDigest, reservationReceiptRef: outcome.priorReceiptDigest, priorReceiptRef: outcome.priorReceiptDigest, phase: "dispatch" as const, terminalKind: "acknowledged" as const };
  const publication = { async publish() { throw new Error("not used"); }, async publishReservation() { throw new Error("not used"); }, async loadDurableHead(_query: unknown, expect?: string) { assert.equal(expect, "terminal"); return head; } };
  assert.equal(await resolveGovernedCoordinatorPublicationV1(publication, { query, outcome }), outcome.receiptRef);

  for (const replacement of [null, { ...head, receiptRef: sha("b") }, { ...head, evidenceDigest: sha("b") }, { ...head, priorReceiptRef: sha("b") }, { ...head, identity: { ...identity, effectDigest: sha("b") } }, { ...head, phase: "reservation", terminalKind: null, priorReceiptRef: null }]) {
    const candidate = { ...publication, async loadDurableHead() { return replacement as never; } };
    assert.equal(await resolveGovernedCoordinatorPublicationV1(candidate, { query, outcome }), null);
  }
});
