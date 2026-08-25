import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  digestGovernedReceiptV1,
  digestGovernedOutcomeV1,
  digestMissionClaimV1,
  digestAttemptV1,
  digestObservationV1,
  digestProviderOutcomePackV1,
  digestToolEffectContractV1,
  parseGovernedReceiptV1,
  parseGovernedOutcomeV1,
  parseMissionClaimV1,
  parseAttemptV1,
  parseObservationV1,
  parseProviderOutcomePackV1,
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

test("ToolEffect JSON Schema accepts arbitrary valid providers and rejects every representable runtime violation", () => {
  const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;
  const schema = JSON.parse(readFileSync(path.join(process.cwd(), "contract", "authority", "v1", "tool-effect-contract.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: true }).compile(schema);
  const valid = { ...structuredClone(contract), provider: "not-a-provider-enum" };
  assert.equal(validate(valid), true, JSON.stringify(validate.errors));

  const invalid = [
    { ...valid, contractId: "contract/id" },
    { ...valid, operationDigest: "sha256:" + "A".repeat(64) },
    { ...valid, model: { fields: ["summary", "summary"], maxBytes: 1024 } },
    { ...valid, model: { fields: ["summary"], maxBytes: 1_073_741_825 } },
    { ...valid, bindings: { ...valid.bindings, credentialRef: "" } },
    { ...valid, readback: { operation: "events.get", projection: ["/id", "/id"] } },
    { ...valid, readback: null, maximumEvidenceGrade: "verified" },
    { ...valid, result: { success: [], conflict: [], definitiveFailure: [], ambiguity: [] } },
    { ...valid, result: { success: ["created"], conflict: [], definitiveFailure: [], ambiguity: [], extra: true } },
  ];
  for (const candidate of invalid) assert.equal(validate(candidate), false, JSON.stringify(validate.errors));

  const crossGroupDuplicate = { ...valid, result: { success: ["created"], conflict: ["created"], definitiveFailure: [], ambiguity: [] } };
  assert.equal(validate(crossGroupDuplicate), true, "JSON Schema cannot express cross-array disjointness");
  assert.throws(() => parseToolEffectContractV1(crossGroupDuplicate), /overlap/);
});

test("effect contract rejects nested accessors without invoking them", () => {
  let reads = 0;
  const hostile = { ...contract, model: { get fields() { reads++; return ["summary"]; }, maxBytes: 1024 } };
  assert.throws(() => parseToolEffectContractV1(hostile));
  assert.equal(reads, 0);
});

test("wire graph bounds refuse hostile shapes before descriptor materialization", () => {
  const hugeArray = new Array(65).fill("field");
  const hugeObject = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`field${index}`, index]));
  const deepest: Record<string, unknown> = {};
  let deep: Record<string, unknown> = deepest; for (let index = 0; index < 18; index++) deep = { child: deep };
  const nodeLeaves = Array.from({ length: 20 }, () => Array.from({ length: 60 }, () => ({}))).flat();
  const manyNodes = Array.from({ length: 20 }, (_, index) => nodeLeaves.slice(index * 60, index * 60 + 60));
  const leafSet = new Set<object>(nodeLeaves);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const shared = { node: {} };
  const original = Object.getOwnPropertyDescriptor;
  const descriptorCalls = new Map<object, number>();
  Object.getOwnPropertyDescriptor = ((value: object, key: PropertyKey) => {
    if (value === hugeArray || value === hugeObject || value === deepest || value === cycle || value === shared || leafSet.has(value)) descriptorCalls.set(value, (descriptorCalls.get(value) ?? 0) + 1);
    return original(value, key);
  }) as typeof Object.getOwnPropertyDescriptor;
  try {
    assert.throws(() => parseToolEffectContractV1({ ...contract, model: { fields: hugeArray, maxBytes: 1 } }));
    assert.throws(() => parseToolEffectContractV1({ ...contract, model: { fields: ["field"], maxBytes: 1, hugeObject } }));
    assert.throws(() => parseToolEffectContractV1({ ...contract, deep }));
    assert.throws(() => parseToolEffectContractV1({ ...contract, manyNodes }));
    assert.throws(() => parseToolEffectContractV1({ ...contract, model: cycle }));
    assert.throws(() => parseToolEffectContractV1({ ...contract, model: shared, bindings: shared }));
  } finally {
    Object.getOwnPropertyDescriptor = original;
  }
  assert.equal(descriptorCalls.get(hugeArray) ?? 0, 0);
  assert.equal(descriptorCalls.get(hugeObject) ?? 0, 0);
  assert.equal(descriptorCalls.get(deepest) ?? 0, 0);
  assert.ok(nodeLeaves.reduce<number>((count, leaf) => count + (descriptorCalls.get(leaf) ?? 0), 0) < nodeLeaves.length);
  assert.equal(descriptorCalls.get(cycle), 1);
  assert.equal(descriptorCalls.get(shared), 1);

  const sparse = new Array(2); sparse[0] = "field";
  for (const hostile of [
    { ...contract, provider: () => "calendar-like" },
    { ...contract, model: { fields: sparse, maxBytes: 1 } },
  ]) assert.throws(() => parseToolEffectContractV1(hostile));
});

test("million-property objects and short arrays stop before bulk own-key materialization", () => {
  const million = 1_000_000;
  const hugeObject: Record<string, unknown> = { ...contract };
  for (let index = 0; index < million; index++) hugeObject[`extra${index}`] = index;
  const shortArray = ["summary"] as unknown as unknown[] & Record<string, unknown>;
  for (let index = 0; index < million; index++) shortArray[`extra${index}`] = index;

  const original = Object.getOwnPropertyDescriptors;
  let bulkDescriptorCalls = 0;
  Object.getOwnPropertyDescriptors = (() => { bulkDescriptorCalls++; throw new Error("bulk descriptor materialization reached"); }) as typeof Object.getOwnPropertyDescriptors;
  try {
    assert.throws(() => parseToolEffectContractV1(hugeObject));
    assert.throws(() => parseToolEffectContractV1({ ...contract, model: { fields: shortArray, maxBytes: 1 } }));
  } finally {
    Object.getOwnPropertyDescriptors = original;
  }
  assert.equal(bulkDescriptorCalls, 0);
});

test("hidden and symbol extras are inert out-of-band data while expected descriptors stay strict", () => {
  let getterReads = 0;
  const decorated = { ...contract, model: { fields: [...contract.model.fields], maxBytes: contract.model.maxBytes } };
  Object.defineProperty(decorated, "hidden", { get() { getterReads++; return "ignored"; } });
  Object.defineProperty(decorated, Symbol("hidden"), { get() { getterReads++; return "ignored"; } });
  Object.defineProperty(decorated.model, "hidden", { get() { getterReads++; return "ignored"; } });
  Object.defineProperty(decorated.model.fields, Symbol("hidden"), { get() { getterReads++; return "ignored"; } });
  const parsed = parseToolEffectContractV1(decorated);
  assert.equal(getterReads, 0);
  assert.deepEqual(parsed, parseToolEffectContractV1(contract));
  assert.equal(digestToolEffectContractV1(decorated), digestToolEffectContractV1(contract));

  const hiddenExpected = { ...contract };
  Object.defineProperty(hiddenExpected, "provider", { enumerable: false, value: contract.provider });
  assert.throws(() => parseToolEffectContractV1(hiddenExpected));
  let expectedReads = 0;
  const accessorExpected = { ...contract };
  Object.defineProperty(accessorExpected, "provider", { enumerable: true, get() { expectedReads++; return contract.provider; } });
  assert.throws(() => parseToolEffectContractV1(accessorExpected));
  assert.equal(expectedReads, 0);
});

test("lifecycle standalone parsers close provider packs, mission claims, and receipts", async () => {
  const pack = { v: "reelier.provider-outcome-pack/v1", packId: "pack_1", provider: "calendar-like", contractDigest: digest, preflightOperation: "events.preflight", dispatchOperation: "events.create", readbackOperation: "events.get" } as const;
  const claim = { v: "reelier.mission-claim/v1", missionId: "mission_1", mandateDigest: digest, promptDigest: digest, contractDigests: [digest], claimedAt: "2026-08-20T11:59:59.000Z" } as const;
  const receipt = { v: "reelier.governed-receipt/v1", receiptId: "receipt_1", outcomeDigest: digest, missionDigest: digest, issuedAt: "2026-08-20T12:00:00.000Z", status: "verified" };
  const parsedPack = parseProviderOutcomePackV1(pack);
  const parsedClaim = parseMissionClaimV1(claim);
  const parsedReceipt = parseGovernedReceiptV1(receipt);
  assert.equal(Object.isFrozen(parsedPack), true);
  assert.equal(Object.isFrozen(parsedClaim.contractDigests), true);
  assert.equal(Object.isFrozen(parsedReceipt), true);
  assert.match(digestProviderOutcomePackV1(parsedPack), /^sha256:[a-f0-9]{64}$/u);
  assert.match(digestMissionClaimV1(parsedClaim), /^sha256:[a-f0-9]{64}$/u);
  assert.match(digestGovernedReceiptV1(parsedReceipt), /^sha256:[a-f0-9]{64}$/u);
  assert.notEqual(digestProviderOutcomePackV1({ ...pack, provider: "document-like" }), digestProviderOutcomePackV1(pack));
  assert.notEqual(digestMissionClaimV1({ ...claim, missionId: "mission_2" }), digestMissionClaimV1(claim));
  assert.notEqual(digestGovernedReceiptV1({ ...receipt, receiptId: "receipt_2" }), digestGovernedReceiptV1(receipt));
  for (const [parser, value] of [[parseProviderOutcomePackV1, pack], [parseMissionClaimV1, claim], [parseGovernedReceiptV1, receipt]] as const) {
    assert.throws(() => parser({ ...value, extra: true }));
  }
  assert.throws(() => parseMissionClaimV1({ ...claim, contractDigests: [digest, digest] }));
});

test("attempt and observation parsers close provider-crossing evidence combinations", () => {
  const attempt = { v: "reelier.attempt/v1", attemptId: "attempt_1", reservationId: "reservation_1", semanticIdentity: "effect_1", dispatchedAt: "2026-08-20T12:00:01.000Z", crossedProviderBoundary: true, result: "acknowledged" } as const;
  const localFailure = { ...attempt, crossedProviderBoundary: false, result: "definitive-failure" as const };
  assert.equal(parseAttemptV1(localFailure).result, "definitive-failure");
  assert.match(digestAttemptV1(attempt), /^sha256:[a-f0-9]{64}$/u);
  for (const result of ["acknowledged", "ambiguous"] as const) assert.throws(() => parseAttemptV1({ ...attempt, crossedProviderBoundary: false, result }));

  const observation = { v: "reelier.observation/v1", observationId: "observation_1", reservationId: "reservation_1", semanticIdentity: "effect_1", observedAt: "2026-08-20T12:00:02.000Z", authoritative: true, verdict: "matched", projectionDigest: digest } as const;
  for (const verdict of ["matched", "conflict", "not-applied"] as const) {
    assert.equal(parseObservationV1({ ...observation, verdict }).verdict, verdict);
    assert.throws(() => parseObservationV1({ ...observation, verdict, authoritative: false }));
    assert.throws(() => parseObservationV1({ ...observation, verdict, projectionDigest: null }));
  }
  const unavailable = { ...observation, authoritative: false, verdict: "unavailable" as const, projectionDigest: null };
  assert.equal(parseObservationV1(unavailable).verdict, "unavailable");
  assert.match(digestObservationV1(unavailable), /^sha256:[a-f0-9]{64}$/u);
  assert.throws(() => parseObservationV1({ ...unavailable, authoritative: true }));
  assert.throws(() => parseObservationV1({ ...unavailable, projectionDigest: digest }));
});

test("governed outcome transition refuses unverifiable chronology and verified masquerades", () => {
  const contractDigest = digestToolEffectContractV1(contract);
  const pointerListDigest = authorityDigest(contract.readback.projection);
  let verifierCalls = 0;
  const verifyObservation = (input: unknown) => {
    verifierCalls++;
    const trusted = input as { contract: typeof contract; observation: { projectionDigest: string | null } };
    assert.equal(Object.isFrozen(trusted), true);
    assert.equal(Object.isFrozen(trusted.contract), true);
    assert.equal(Object.isFrozen(trusted.observation), true);
    return trusted.contract.contractId === contract.contractId && trusted.observation.projectionDigest === digest;
  };
  const outcome = {
    v: "reelier.governed-outcome/v1", outcomeId: "outcome_1", contractDigest, semanticIdentity: contract.semanticIdentity,
    reservation: { v: "reelier.effect-reservation/v1", reservationId: "reservation_1", semanticIdentity: contract.semanticIdentity, contractDigest, reservedAt: "2026-08-20T12:00:00.000Z" },
    attempts: [{ v: "reelier.attempt/v1", attemptId: "attempt_1", reservationId: "reservation_1", semanticIdentity: contract.semanticIdentity, dispatchedAt: "2026-08-20T12:00:01.000Z", crossedProviderBoundary: true, result: "acknowledged" }],
    observation: { v: "reelier.observation/v1", observationId: "observation_1", reservationId: "reservation_1", semanticIdentity: contract.semanticIdentity, observedAt: "2026-08-20T12:00:02.000Z", authoritative: true, verdict: "matched", projectionDigest: digest },
    status: "verified", completedAt: "2026-08-20T12:00:03.000Z",
  } as const;
  const context = { contract, now: "2026-08-20T12:00:04.000Z", verifyObservation } as const;
  assert.equal(parseGovernedOutcomeV1(outcome).status, "verified");
  const verified = verifyGovernedOutcomeTransitionV1(outcome, context);
  assert.equal(verified.status, "verified");
  assert.equal(verifierCalls, 1);
  assert.equal(Object.isFrozen(verified), true);
  assert.equal(typeof digestGovernedOutcomeV1(outcome), "string");
  let contextExtraReads = 0;
  const decoratedContext = { ...context };
  Object.defineProperty(decoratedContext, "hidden", { get() { contextExtraReads++; return "ignored"; } });
  Object.defineProperty(decoratedContext, Symbol("hidden"), { get() { contextExtraReads++; return "ignored"; } });
  assert.equal(verifyGovernedOutcomeTransitionV1(outcome, decoratedContext).status, "verified");
  assert.equal(contextExtraReads, 0);
  assert.throws(() => parseGovernedOutcomeV1({ ...outcome, observation: { ...outcome.observation, authoritative: false } }));
  assert.equal(parseGovernedOutcomeV1({ ...outcome, status: "partial" }).status, "partial");
  assert.throws(() => parseGovernedOutcomeV1({ ...outcome, completedAt: "2026-08-20T11:00:00.000Z" }));
  assert.throws(() => parseGovernedOutcomeV1({ ...outcome, attempts: [{ ...outcome.attempts[0], semanticIdentity: "drift" }] }));
  assert.throws(() => parseGovernedOutcomeV1({ ...outcome, attempts: [outcome.attempts[0], { ...outcome.attempts[0], dispatchedAt: "2026-08-20T12:00:02.000Z" }] }));

  const differentContract = { ...contract, operation: "events.update" } as const;
  assert.throws(() => verifyGovernedOutcomeTransitionV1(outcome, { ...context, contract: differentContract }));
  assert.throws(() => verifyGovernedOutcomeTransitionV1(outcome, { ...context, extra: true }));
  assert.throws(() => verifyGovernedOutcomeTransitionV1({ ...outcome, observation: { ...outcome.observation, projectionDigest: `sha256:${"b".repeat(64)}` } }, context));
  assert.throws(() => verifyGovernedOutcomeTransitionV1({ ...outcome, observation: { ...outcome.observation, projectionDigest: pointerListDigest } }, { ...context, verifyObservation: () => false }));
  assert.throws(() => verifyGovernedOutcomeTransitionV1(outcome, { ...context, verifyObservation: () => false }));
  assert.throws(() => verifyGovernedOutcomeTransitionV1(outcome, { ...context, verifyObservation: () => { throw new Error("untrusted observation"); } }));
  assert.throws(() => verifyGovernedOutcomeTransitionV1(outcome, { ...context, verifyObservation: (() => "yes") as unknown as typeof verifyObservation }));
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
  assert.equal(verifyGovernedOutcomeTransitionV1({ ...ambiguous, attempts: [{ ...ambiguous.attempts[0], crossedProviderBoundary: false, result: "definitive-failure" }, ambiguous.attempts[1]] }, context).status, "pending");

  let getterReads = 0;
  const hostileContext = Object.create(null, {
    contract: { enumerable: true, get() { getterReads++; return contract; } },
    now: { enumerable: true, value: context.now },
    verifyObservation: { enumerable: true, value: context.verifyObservation },
  });
  assert.throws(() => verifyGovernedOutcomeTransitionV1(outcome, hostileContext));
  assert.equal(getterReads, 0);

  let verifierGetterReads = 0;
  const hostileVerifier = Object.create(null, {
    contract: { enumerable: true, value: contract },
    now: { enumerable: true, value: context.now },
    verifyObservation: { enumerable: true, get() { verifierGetterReads++; return verifyObservation; } },
  });
  assert.throws(() => verifyGovernedOutcomeTransitionV1(outcome, hostileVerifier));
  assert.equal(verifierGetterReads, 0);
});
