import assert from "node:assert/strict";
import test from "node:test";
import {
  digestGovernedOutcomeV1,
  digestToolEffectContractV1,
  parseGovernedOutcomeV1,
  parseToolEffectContractV1,
  verifyGovernedOutcomeTransitionV1,
} from "../../src/authority/tool-effect-contract.js";

const digest = `sha256:${"a".repeat(64)}`;
const contract = {
  v: "reelier.tool-effect-contract/v1", contractId: "contract_1", provider: "calendar-like", operation: "events.create",
  operationDigest: digest, schemaDigest: digest, policyDigest: digest, effectClass: "idempotent-write",
  model: { fields: ["summary", "startsAt"], maxBytes: 1024 },
  bindings: { credentialRef: "credential_1", accountRef: "account_1", destinationRef: "destination_1", limitRef: "limit_1" },
  semanticIdentity: "event:customer_1:2026-08-20", idempotencyKey: "idem_1",
  readback: { operation: "events.get", projection: ["/id", "/status"] },
  result: { success: ["created"], conflict: ["duplicate"], definitiveFailure: ["forbidden"], ambiguity: ["timeout"] }, maximumEvidenceGrade: "verified",
} as const;

test("neutral ToolEffectContract seals arbitrary providers and detaches parsed state", () => {
  const parsed = parseToolEffectContractV1(contract);
  assert.equal(parsed.provider, "calendar-like");
  assert.equal(digestToolEffectContractV1(parsed), digestToolEffectContractV1(contract));
  assert.throws(() => parseToolEffectContractV1({ ...contract, provider: "calendar-like", extra: true }));
  assert.throws(() => parseToolEffectContractV1({ ...contract, model: { fields: ["summary", "summary"], maxBytes: 1024 } }));
  assert.throws(() => parseToolEffectContractV1(new Proxy(contract, {})));
  assert.throws(() => parseToolEffectContractV1({ ...contract, provider: { get value() { return "x"; } } }));
  (contract.model.fields as unknown as string[])[0] = "mutated";
  assert.equal(parsed.model.fields[0], "summary");
});

test("readback projections use closed JSON pointer paths rather than identifier syntax", () => {
  assert.deepEqual(parseToolEffectContractV1({ ...contract, readback: { operation: "events.get", projection: ["/body/id", "/body/status~1code"] } }).readback?.projection, ["/body/id", "/body/status~1code"]);
  assert.throws(() => parseToolEffectContractV1({ ...contract, readback: { operation: "events.get", projection: ["body/id"] } }));
  assert.throws(() => parseToolEffectContractV1({ ...contract, readback: { operation: "events.get", projection: ["/body/~2"] } }));
});

test("governed outcome transition refuses unverifiable chronology and verified masquerades", () => {
  const outcome = {
    v: "reelier.governed-outcome/v1", outcomeId: "outcome_1", contractDigest: digestToolEffectContractV1(contract), semanticIdentity: contract.semanticIdentity,
    reservation: { v: "reelier.effect-reservation/v1", reservationId: "reservation_1", semanticIdentity: contract.semanticIdentity, contractDigest: digestToolEffectContractV1(contract), reservedAt: "2026-08-20T12:00:00.000Z" },
    attempts: [{ v: "reelier.attempt/v1", attemptId: "attempt_1", reservationId: "reservation_1", semanticIdentity: contract.semanticIdentity, dispatchedAt: "2026-08-20T12:00:01.000Z", crossedProviderBoundary: true, result: "acknowledged" }],
    observation: { v: "reelier.observation/v1", observationId: "observation_1", reservationId: "reservation_1", semanticIdentity: contract.semanticIdentity, observedAt: "2026-08-20T12:00:02.000Z", authoritative: true, verdict: "matched", projectionDigest: digest },
    status: "verified", completedAt: "2026-08-20T12:00:03.000Z",
  } as const;
  assert.equal(parseGovernedOutcomeV1(outcome).status, "verified");
  assert.equal(verifyGovernedOutcomeTransitionV1(outcome).status, "verified");
  assert.equal(typeof digestGovernedOutcomeV1(outcome), "string");
  assert.throws(() => parseGovernedOutcomeV1({ ...outcome, observation: { ...outcome.observation, authoritative: false } }));
  assert.throws(() => parseGovernedOutcomeV1({ ...outcome, status: "partial" }));
  assert.throws(() => parseGovernedOutcomeV1({ ...outcome, completedAt: "2026-08-20T11:00:00.000Z" }));
  assert.throws(() => parseGovernedOutcomeV1({ ...outcome, attempts: [{ ...outcome.attempts[0], semanticIdentity: "drift" }] }));
});
