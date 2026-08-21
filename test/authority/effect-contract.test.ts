import assert from "node:assert/strict";
import test from "node:test";
import {
  digestGovernedOutcomeV1,
  digestToolEffectContractV1,
  parseGovernedOutcomeV1,
  parseToolEffectContractV1,
  verifyGovernedOutcomeTransitionV1,
} from "../../src/authority/tool-effect-contract.js";
import { authorityDigest } from "../../src/authority/wire.js";

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

test("effect contract rejects nested accessors without invoking them", () => {
  let reads = 0;
  const hostile = { ...contract, model: { get fields() { reads++; return ["summary"]; }, maxBytes: 1024 } };
  assert.throws(() => parseToolEffectContractV1(hostile));
  assert.equal(reads, 0);
});

test("lifecycle standalone parsers close provider packs, mission claims, and receipts", async () => {
  const api = await import("../../src/authority/tool-effect-contract.js");
  const receipt = { v: "reelier.governed-receipt/v1", receiptId: "receipt_1", outcomeDigest: digest, missionDigest: digest, issuedAt: "2026-08-20T12:00:00.000Z", status: "verified" };
  assert.equal(api.parseGovernedReceiptV1(receipt).receiptId, "receipt_1");
  assert.throws(() => api.parseGovernedReceiptV1({ ...receipt, extra: true }));
});

test("governed outcome transition refuses unverifiable chronology and verified masquerades", () => {
  const contractDigest = digestToolEffectContractV1(contract);
  const projectionDigest = authorityDigest(contract.readback.projection);
  const outcome = {
    v: "reelier.governed-outcome/v1", outcomeId: "outcome_1", contractDigest, semanticIdentity: contract.semanticIdentity,
    reservation: { v: "reelier.effect-reservation/v1", reservationId: "reservation_1", semanticIdentity: contract.semanticIdentity, contractDigest, reservedAt: "2026-08-20T12:00:00.000Z" },
    attempts: [{ v: "reelier.attempt/v1", attemptId: "attempt_1", reservationId: "reservation_1", semanticIdentity: contract.semanticIdentity, dispatchedAt: "2026-08-20T12:00:01.000Z", crossedProviderBoundary: true, result: "acknowledged" }],
    observation: { v: "reelier.observation/v1", observationId: "observation_1", reservationId: "reservation_1", semanticIdentity: contract.semanticIdentity, observedAt: "2026-08-20T12:00:02.000Z", authoritative: true, verdict: "matched", projectionDigest },
    status: "verified", completedAt: "2026-08-20T12:00:03.000Z",
  } as const;
  const context = { contract, now: "2026-08-20T12:00:04.000Z" } as const;
  assert.equal(parseGovernedOutcomeV1(outcome).status, "verified");
  const verified = verifyGovernedOutcomeTransitionV1(outcome, context);
  assert.equal(verified.status, "verified");
  assert.equal(Object.isFrozen(verified), true);
  assert.equal(typeof digestGovernedOutcomeV1(outcome), "string");
  assert.throws(() => parseGovernedOutcomeV1({ ...outcome, observation: { ...outcome.observation, authoritative: false } }));
  assert.equal(parseGovernedOutcomeV1({ ...outcome, status: "partial" }).status, "partial");
  assert.throws(() => parseGovernedOutcomeV1({ ...outcome, completedAt: "2026-08-20T11:00:00.000Z" }));
  assert.throws(() => parseGovernedOutcomeV1({ ...outcome, attempts: [{ ...outcome.attempts[0], semanticIdentity: "drift" }] }));

  const differentContract = { ...contract, operation: "events.update" } as const;
  assert.throws(() => verifyGovernedOutcomeTransitionV1(outcome, { ...context, contract: differentContract }));
  assert.throws(() => verifyGovernedOutcomeTransitionV1(outcome, { ...context, extra: true }));
  assert.throws(() => verifyGovernedOutcomeTransitionV1({ ...outcome, observation: { ...outcome.observation, projectionDigest: digest } }, context));
  const partialContract = { ...contract, maximumEvidenceGrade: "partial" } as const;
  const partialDigest = digestToolEffectContractV1(partialContract);
  assert.throws(() => verifyGovernedOutcomeTransitionV1({ ...outcome, contractDigest: partialDigest, reservation: { ...outcome.reservation, contractDigest: partialDigest } }, { ...context, contract: partialContract }));
  for (const status of ["partial", "pending", "absent", "failed"] as const) assert.throws(() => verifyGovernedOutcomeTransitionV1({ ...outcome, status }, context));

  for (const futureOutcome of [
    { ...outcome, reservation: { ...outcome.reservation, reservedAt: "2026-08-20T12:00:05.000Z" }, attempts: [], observation: null, status: "pending" as const, completedAt: "2026-08-20T12:00:05.000Z" },
    { ...outcome, attempts: [{ ...outcome.attempts[0], dispatchedAt: "2026-08-20T12:00:05.000Z" }], observation: null, status: "pending" as const, completedAt: "2026-08-20T12:00:05.000Z" },
    { ...outcome, observation: { ...outcome.observation, observedAt: "2026-08-20T12:00:05.000Z" }, completedAt: "2026-08-20T12:00:05.000Z" },
    { ...outcome, completedAt: "2026-08-20T12:00:05.000Z" },
  ]) assert.throws(() => verifyGovernedOutcomeTransitionV1(futureOutcome, context));

  const ambiguous = { ...outcome, attempts: [
    { ...outcome.attempts[0], result: "ambiguous" as const },
    { ...outcome.attempts[0], attemptId: "attempt_2", dispatchedAt: "2026-08-20T12:00:02.000Z" },
  ], observation: null, status: "pending" as const, completedAt: "2026-08-20T12:00:03.000Z" };
  assert.throws(() => verifyGovernedOutcomeTransitionV1(ambiguous, context));
  assert.equal(verifyGovernedOutcomeTransitionV1({ ...ambiguous, attempts: [{ ...ambiguous.attempts[0], crossedProviderBoundary: false }, ambiguous.attempts[1]] }, context).status, "pending");

  let getterReads = 0;
  const hostileContext = Object.create(null, {
    contract: { enumerable: true, get() { getterReads++; return contract; } },
    now: { enumerable: true, value: context.now },
  });
  assert.throws(() => verifyGovernedOutcomeTransitionV1(outcome, hostileContext));
  assert.equal(getterReads, 0);
});
