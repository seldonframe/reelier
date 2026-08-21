import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import { digestGovernedEffectCommitmentV1 } from "../../src/authority/governed-effect-commitment.js";
import { createGovernedOutcomeKernelAuthorityV1, describeGovernedOutcomeKernelAuthorityV1, resolveGovernedCoordinatorPublicationV1, resolveGovernedOutcomeKernelPublicationV1, takeGovernedOutcomeKernelHandleV1, verifyGovernedOutcomeEffectJoinV1 } from "../../src/authority/host/governed-outcome-composition.js";
import { bindFileReceiptPublicationReadbackV1, createFileReceiptPublication } from "../../src/authority/host/receipts.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";

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
  const reservation = Object.freeze({ reservationId: "reservation_1", state: "reserved", intent: { tenant: "tenant_1", requestDigest: sha("1"), capabilityDigest: sha("2"), definitionAlias: alias, contractDigest: authorityDigest(pathCContract), effectDigest, effectCanonicalBase64: authorityCanonicalBytes(effect).toString("base64"), routeAuthority: { expectedMaterializedRequestDigest: sha("5") } } });
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

test("a restarted governed authority is opaque and readback-only", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux"), root = await mkdtemp(path.join(os.tmpdir(), "reelier-governed-readback-only-"));
  const joined = fixture();
  const outcome = { kind: "acknowledged" as const, resultDigest: sha("7"), providerResultDigest: sha("8"), receiptRef: sha("7"), evidenceDigest: sha("9"), priorReceiptDigest: sha("a") };
  try {
    const readback = bindFileReceiptPublicationReadbackV1(createFileReceiptPublication({ rootDir: root }), joined.reservation as never), authority = createGovernedOutcomeKernelAuthorityV1({ join: joined.input as never, publicationReadback: readback });
    assert.deepEqual(Reflect.ownKeys(authority), []);
    assert.deepEqual(describeGovernedOutcomeKernelAuthorityV1(authority, authorityDigest(toolEffectContract)), { reservationId: "reservation_1", effectDigest: joined.reservation.intent.effectDigest, hasLiveHandle: false });
    await assert.rejects(() => takeGovernedOutcomeKernelHandleV1(authority), /readback-only/i);
    assert.equal(await resolveGovernedOutcomeKernelPublicationV1(authority, outcome), null);
    assert.equal(await resolveGovernedCoordinatorPublicationV1(readback, outcome), null);
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});

test("governed publication readback refuses duck-typed resolver and query substitution", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux"), root = await mkdtemp(path.join(os.tmpdir(), "reelier-governed-publication-binding-"));
  try {
    const joined = fixture(), publication = createFileReceiptPublication({ rootDir: root }), readback = bindFileReceiptPublicationReadbackV1(publication, joined.reservation as never);
    const authority = createGovernedOutcomeKernelAuthorityV1({ join: joined.input as never, publicationReadback: readback });
    assert.deepEqual(describeGovernedOutcomeKernelAuthorityV1(authority, authorityDigest(toolEffectContract)), { reservationId: "reservation_1", effectDigest: joined.reservation.intent.effectDigest, hasLiveHandle: false });
    assert.throws(() => bindFileReceiptPublicationReadbackV1({ loadDurableHead: async () => null } as never, joined.reservation as never), /genuine|publication/i);
    assert.throws(() => createGovernedOutcomeKernelAuthorityV1({ join: joined.input as never, publicationReadback: {} as never }), /genuine|publication|readback/i);
    assert.throws(() => createGovernedOutcomeKernelAuthorityV1({ join: joined.input as never, publicationReadback: structuredClone(readback) as never }), /genuine|publication|readback/i);
    const crossed = bindFileReceiptPublicationReadbackV1(publication, { ...joined.reservation, reservationId: "reservation_other" } as never);
    assert.throws(() => createGovernedOutcomeKernelAuthorityV1({ join: joined.input as never, publicationReadback: crossed }), /publication|join|reservation/i);
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});
