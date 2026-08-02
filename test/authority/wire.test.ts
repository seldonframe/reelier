import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  assertAcceptedDecisionContext,
  authorityCanonicalBytes,
  authorityDigest,
  decisionContextPresence,
  parseCanonicalAuthorityJson,
  parseAuthorityWire,
  parsePortableAuthorityEvidence,
} from "../../src/authority/wire.js";
import type { AuthorityKind } from "../../src/authority/types.js";
import { evaluateVerifyClaims } from "../../src/verify.js";

const zeroDigest = "sha256:" + "0".repeat(64);
const policyBytes = Buffer.from('{"channel":"sms","template":"Appointment {{time}}"}', "utf8");
const limits = { maxEffectsPerWindow: 10, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 };
const constraints = {
  definitionAliases: ["definition_1"], audiences: ["requester_1"],
  connectorAccounts: [{ connectorId: "highlevel", accountId: "location_1" }],
  projectionPointers: ["/appointment/startTime", "/contact/phone"], riskClasses: ["message"], limits,
};
const contract = {
  v: "reelier.outcome-contract/v1", tenant: "tenant_1", alias: "definition_1", contractId: "contract_1",
  validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2026-02-01T00:00:00.000Z", packDigest: zeroDigest,
  definitionDigest: zeroDigest, sponsor: "sponsor_1", audiences: ["requester_1"], delegationGrantDigest: zeroDigest,
  connectorId: "highlevel", accountId: "location_1",
  sourceAuthority: { resolverId: "highlevel_appointment", projectionSchemaId: "highlevel.appointment-reminder/v1", allowedReadEndpointIds: ["appointments.get", "contacts.get"], authorizedProjectionPointers: ["/appointment/startTime", "/contact/phone"] },
  riskClasses: ["message"], limits,
  policyCommitment: { schemaId: "highlevel.sms-reminder-policy/v1", jcsBase64: policyBytes.toString("base64"), digest: "sha256:" + createHash("sha256").update(policyBytes).digest("hex") },
};
const rootGrant = {
  v: "reelier.delegation-grant/v1", tenant: "tenant_1", grantId: "grant_root", parentDigest: null,
  sponsor: "sponsor_1", grantor: "operator_1", grantee: "gate_1", issuedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-02-01T00:00:00.000Z", constraints,
};
const sourceBundle = {
  v: "reelier.source-bundle/v1", tenant: "tenant_1", definitionDigest: zeroDigest,
  projectionSchemaId: "highlevel.appointment-reminder/v1", sourceIdentity: "source_1", triggerIdentity: "trigger_1",
  observedAt: "2026-01-01T00:00:00.000Z", rawDigest: zeroDigest, freshUntil: "2026-01-01T00:01:00.000Z",
  provenance: { resolverId: "resolver_1", endpointId: "read_1" },
  claims: { grounded: [{ claimId: "appointment_time", projectionPointer: "/appointment/startTime" }], authored: [], unresolved: [] },
  projection: { appointment: { startTime: "2026-01-02T12:00:00.000Z" } },
};

function without<T extends Record<string, unknown>>(value: T, key: keyof T): Omit<T, keyof T> {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

const request = {
  v: "reelier.outcome-request/v1",
  requestId: "req_01HZY3Y7V6K8M4Q2P9N5R1T0X",
  sourceRefs: { appointment: "ref_01HZY3Y7V6K8M4Q2P9N5R1T0X" },
  choices: {},
};

const acceptedDecisionContext = {
  v: "reelier.decision-context/v1",
  tenant: "tenant_1",
  requester: "requester_1",
  requestId: "request_1",
  requestDigest: "sha256:" + "1".repeat(64),
  requestKey: "sha256:" + "2".repeat(64),
  contractDigest: "sha256:" + "3".repeat(64),
  capabilityId: "capability_1",
  capabilityDigest: "sha256:" + "4".repeat(64),
  outcomeKey: "sha256:" + "5".repeat(64),
  effectDigest: "sha256:" + "6".repeat(64),
  snapshots: {
    sourceBundleDigest: "sha256:" + "7".repeat(64),
    authorityStateDigest: "sha256:" + "8".repeat(64),
  },
};
const refusedDecisionContext = {
  ...acceptedDecisionContext,
  contractDigest: null,
  capabilityId: null,
  capabilityDigest: null,
  outcomeKey: null,
  effectDigest: null,
  snapshots: { sourceBundleDigest: null, authorityStateDigest: null },
};
const decisionContextDigest = authorityDigest(acceptedDecisionContext);
const gateEvent = {
  v: "reelier.gate-event/v1",
  eventId: "event_1",
  at: "2026-01-01T00:00:00.000Z",
  verdict: "accepted",
  reasonCode: "accepted",
  decisionContextDigest,
};
const receiptClaims = {
  authorization: "verified",
  sourceCompleteness: "verified",
  dispatch: "verified",
  providerAcknowledgment: "unchecked",
  reconciliation: "absent",
  topology: "unchecked",
  completeness: "unchecked",
};
const authorityReceipt = {
  v: "reelier.authority-receipt/v1",
  receiptId: "receipt_1",
  gateEventDigest: authorityDigest(gateEvent),
  decisionContextDigest,
  decisionContext: acceptedDecisionContext,
  claims: receiptClaims,
};

test("DecisionContext parses as an independently versioned closed wire object", () => {
  assert.deepEqual(parseAuthorityWire("decision-context", acceptedDecisionContext), acceptedDecisionContext);
  assert.deepEqual(parseAuthorityWire("decision-context", refusedDecisionContext), refusedDecisionContext);
  assert.throws(() => parseAuthorityWire("decision-context", { ...acceptedDecisionContext, extra: true }), /additional properties/i);
  for (const field of ["contractDigest", "capabilityId", "capabilityDigest", "outcomeKey", "effectDigest"] as const) {
    assert.throws(() => parseAuthorityWire("decision-context", without(acceptedDecisionContext, field)), /required property/i, field);
  }
  for (const field of ["sourceBundleDigest", "authorityStateDigest"] as const) {
    assert.throws(() => parseAuthorityWire("decision-context", { ...acceptedDecisionContext, snapshots: without(acceptedDecisionContext.snapshots, field) }), /required property/i, field);
  }
  for (const field of ["tenant", "requester", "requestId", "capabilityId"] as const) {
    assert.throws(() => parseAuthorityWire("decision-context", { ...acceptedDecisionContext, [field]: "" }), /pattern/i, field);
  }
  for (const field of ["requestDigest", "requestKey", "contractDigest", "capabilityDigest", "outcomeKey", "effectDigest"] as const) {
    assert.throws(() => parseAuthorityWire("decision-context", { ...acceptedDecisionContext, [field]: zeroDigest }), /pattern/i, field);
  }
  for (const field of ["sourceBundleDigest", "authorityStateDigest"] as const) {
    assert.throws(() => parseAuthorityWire("decision-context", { ...acceptedDecisionContext, snapshots: { ...acceptedDecisionContext.snapshots, [field]: zeroDigest } }), /pattern/i, field);
  }
});

test("DecisionContext enforces intrinsic capability pairing and downstream artifact ordering", () => {
  assert.throws(() => parseAuthorityWire("decision-context", { ...acceptedDecisionContext, capabilityId: null }), /capability.*paired/i);
  assert.throws(() => parseAuthorityWire("decision-context", { ...acceptedDecisionContext, capabilityDigest: null }), /capability.*paired/i);
  assert.throws(() => parseAuthorityWire("decision-context", { ...acceptedDecisionContext, contractDigest: null }), /artifact dependency/i);
  assert.throws(() => parseAuthorityWire("decision-context", { ...acceptedDecisionContext, outcomeKey: null }), /artifact dependency/i);
  assert.throws(() => parseAuthorityWire("decision-context", { ...acceptedDecisionContext, effectDigest: null }), /artifact dependency/i);
  assert.doesNotThrow(() => parseAuthorityWire("decision-context", { ...acceptedDecisionContext, capabilityId: null, capabilityDigest: null }));
});

test("accepted contexts require all nullable artifacts while refusal presence stays claim-neutral", () => {
  assert.deepEqual(assertAcceptedDecisionContext(acceptedDecisionContext), acceptedDecisionContext);
  assert.throws(() => assertAcceptedDecisionContext(refusedDecisionContext), /accepted decision context.*non-null/i);
  assert.deepEqual(decisionContextPresence(refusedDecisionContext), {
    contract: "absent",
    capability: "absent",
    outcome: "absent",
    effect: "absent",
    sourceBundleSnapshot: "absent",
    authorityStateSnapshot: "absent",
  });
  assert.deepEqual(decisionContextPresence(acceptedDecisionContext), {
    contract: "unchecked",
    capability: "unchecked",
    outcome: "unchecked",
    effect: "unchecked",
    sourceBundleSnapshot: "unchecked",
    authorityStateSnapshot: "unchecked",
  });
});

test("every DecisionContext field is digest-bound and breaks an unchanged receipt", () => {
  const mutations: [string, typeof acceptedDecisionContext][] = [
    ["v", { ...acceptedDecisionContext, v: "reelier.decision-context/v2" }],
    ["tenant", { ...acceptedDecisionContext, tenant: "tenant_2" }],
    ["requester", { ...acceptedDecisionContext, requester: "requester_2" }],
    ["requestId", { ...acceptedDecisionContext, requestId: "request_2" }],
    ["requestDigest", { ...acceptedDecisionContext, requestDigest: "sha256:" + "9".repeat(64) }],
    ["requestKey", { ...acceptedDecisionContext, requestKey: "sha256:" + "a".repeat(64) }],
    ["contractDigest", { ...acceptedDecisionContext, contractDigest: "sha256:" + "b".repeat(64) }],
    ["capabilityId", { ...acceptedDecisionContext, capabilityId: "capability_2" }],
    ["capabilityDigest", { ...acceptedDecisionContext, capabilityDigest: "sha256:" + "c".repeat(64) }],
    ["outcomeKey", { ...acceptedDecisionContext, outcomeKey: "sha256:" + "d".repeat(64) }],
    ["effectDigest", { ...acceptedDecisionContext, effectDigest: "sha256:" + "e".repeat(64) }],
    ["snapshots.sourceBundleDigest", { ...acceptedDecisionContext, snapshots: { ...acceptedDecisionContext.snapshots, sourceBundleDigest: "sha256:" + "f".repeat(64) } }],
    ["snapshots.authorityStateDigest", { ...acceptedDecisionContext, snapshots: { ...acceptedDecisionContext.snapshots, authorityStateDigest: "sha256:" + "9".repeat(64) } }],
  ];
  for (const [field, mutated] of mutations) {
    assert.notEqual(authorityDigest(mutated), decisionContextDigest, field);
    assert.throws(() => parseAuthorityWire("authority-receipt", { ...authorityReceipt, decisionContext: mutated }), /invalid authority-receipt/i, field);
  }
});

test("portable authority evidence refuses context, GateEvent, and receipt swaps", () => {
  assert.deepEqual(parsePortableAuthorityEvidence(gateEvent, authorityReceipt), { gateEvent, receipt: authorityReceipt });
  const otherContext = { ...acceptedDecisionContext, requestId: "request_2" };
  const otherContextDigest = authorityDigest(otherContext);
  const otherGate = { ...gateEvent, eventId: "event_2", decisionContextDigest: otherContextDigest };
  const otherReceipt = { ...authorityReceipt, receiptId: "receipt_2", gateEventDigest: authorityDigest(otherGate), decisionContextDigest: otherContextDigest, decisionContext: otherContext };
  assert.throws(() => parsePortableAuthorityEvidence(gateEvent, otherReceipt), /decision context.*GateEvent/i);
  assert.throws(() => parsePortableAuthorityEvidence(otherGate, authorityReceipt), /decision context.*GateEvent|GateEvent digest/i);
  assert.throws(() => parsePortableAuthorityEvidence(gateEvent, { ...authorityReceipt, gateEventDigest: authorityDigest(otherGate) }), /GateEvent digest/i);
});

test("OutcomeRequest parses only the closed v1 request boundary", () => {
  const parsed = parseAuthorityWire("outcome-request", request);
  assert.deepEqual(parsed, request);
  assert.notEqual(parsed, request, "parse result must not retain caller object identity");
  assert.throws(() => parseAuthorityWire("outcome-request", { ...request, tenant: "forbidden" }), /additional properties/i);
  assert.throws(() => parseAuthorityWire("outcome-request", { ...request, v: "reelier.outcome-request/v2" }), /must be equal/i);
  assert.throws(
    () => parseAuthorityWire("outcome-request", { ...request, sourceRefs: { appointment: "https://example.test/write" } }),
    /pattern/i,
  );
  for (const key of ["tenant", "providerAccount", "account", "connector", "pack", "endpoint", "recipient", "template", "body", "url", "providerArgs", "credentials", "TENANT"]) {
    assert.throws(() => parseAuthorityWire("outcome-request", { ...request, choices: { [key]: "x" } }), /property name/i, key);
  }
  assert.throws(() => parseAuthorityWire("outcome-request", { ...request, choices: { x: { nested: "no" } } }), /must be/i);
  assert.throws(() => parseAuthorityWire("outcome-request", { ...request, choices: { x: "x".repeat(257) } }), /more than 256 characters/i);
});

test("OutcomeRequest forbidden names are denied by both the schema and parser", () => {
  const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;
  const ajv = new Ajv2020({ strict: true });
  const schema = JSON.parse(readFileSync(path.join(process.cwd(), "contract/authority/v1/outcome-request.schema.json"), "utf8"));
  const validate = ajv.compile(schema);
  for (const key of ["tenant", "TENANT", "account", "providerAccount", "connector", "pack", "endpoint", "recipient", "template", "body", "URL", "providerArgs", "providerArguments", "credentials"]) {
    const candidate = { ...request, choices: { [key]: "x" } };
    assert.equal(validate(candidate), false, `schema must deny ${key}`);
    assert.throws(() => parseAuthorityWire("outcome-request", candidate), /forbidden choice property name|property name/i, key);
  }
});

test("TransportEffect seals headers, query, base64 bytes, preconditions, and reconciliation", () => {
  const effect = {
    v: "reelier.transport-effect/v1", endpointId: "connector_1", method: "POST", path: "/v1/messages", query: "account=tenant_1&mode=send",
    headers: { "Content-Type": "application/json" }, bodyBase64: "e30=", riskClass: "message", idempotency: "native",
    preconditions: [], reconciliation: { recipeId: "message-readback" },
  };
  assert.deepEqual(parseAuthorityWire("transport-effect", effect), effect);
  assert.deepEqual(parseAuthorityWire("transport-effect", { ...effect, query: "name=%C3%A9" }), { ...effect, query: "name=%C3%A9" });
  for (const header of ["AUTHORIZATION", "cOOKIE", "HOST"]) assert.throws(() => parseAuthorityWire("transport-effect", { ...effect, headers: { [header]: "x" } }), /property name/i);
  assert.throws(() => parseAuthorityWire("transport-effect", { ...effect, bodyBase64: "e3=" }), /pattern/i);
  assert.throws(() => parseAuthorityWire("transport-effect", { ...effect, query: "mode=send&account=tenant_1" }), /canonically encoded/i);
  assert.throws(() => parseAuthorityWire("transport-effect", { ...effect, query: "x=%af" }), /pattern/i);
  for (const query of ["&", "a==b", "a=%41", "a=1&a=2", "b=1&a=2", "a=%af", "a=%C3", "a=%C3%28", "a+b=c", "a=1#x", "a=hello world"]) {
    assert.throws(() => parseAuthorityWire("transport-effect", { ...effect, query }), /invalid transport-effect/i, query);
  }
});

test("OutcomeContract binds the complete signed standing authority and validates its policy commitment", () => {
  assert.deepEqual(parseAuthorityWire("outcome-contract", contract), contract);
  for (const field of ["sponsor", "audiences", "delegationGrantDigest", "connectorId", "accountId", "sourceAuthority", "riskClasses", "limits", "policyCommitment"] as const) {
    const { [field]: _, ...missing } = contract;
    assert.throws(() => parseAuthorityWire("outcome-contract", missing), /required property/i, field);
  }
  assert.throws(() => parseAuthorityWire("outcome-contract", { ...contract, audiences: [] }), /fewer than 1/i);
  assert.throws(() => parseAuthorityWire("outcome-contract", { ...contract, audiences: ["requester_1", "requester_1"] }), /duplicate items/i);
  assert.throws(() => parseAuthorityWire("outcome-contract", { ...contract, sourceAuthority: { ...contract.sourceAuthority, authorizedProjectionPointers: ["not/a/pointer"] } }), /pattern/i);
  assert.throws(() => parseAuthorityWire("outcome-contract", { ...contract, limits: { ...limits, maxBodyBytes: 0 } }), /must be >= 1/i);
  assert.throws(() => parseAuthorityWire("outcome-contract", { ...contract, policyCommitment: { ...contract.policyCommitment, jcsBase64: "e30" } }), /pattern|base64/i);
  const nonJson = Buffer.from("not json", "utf8").toString("base64");
  assert.throws(() => parseAuthorityWire("outcome-contract", { ...contract, policyCommitment: { ...contract.policyCommitment, jcsBase64: nonJson } }), /policy commitment.*JSON/i);
  const nonJcs = Buffer.from('{"template":"Appointment {{time}}", "channel":"sms"}', "utf8").toString("base64");
  assert.throws(() => parseAuthorityWire("outcome-contract", { ...contract, policyCommitment: { ...contract.policyCommitment, jcsBase64: nonJcs } }), /policy commitment.*JCS/i);
  assert.throws(() => parseAuthorityWire("outcome-contract", { ...contract, policyCommitment: { ...contract.policyCommitment, digest: "sha256:" + "1".repeat(64) } }), /policy commitment.*digest/i);
});

test("DelegationGrant has explicit root or child parent and closed attenuable constraints", () => {
  assert.deepEqual(parseAuthorityWire("delegation-grant", rootGrant), rootGrant);
  assert.deepEqual(parseAuthorityWire("delegation-grant", { ...rootGrant, grantId: "grant_child", parentDigest: zeroDigest }), { ...rootGrant, grantId: "grant_child", parentDigest: zeroDigest });
  assert.throws(() => parseAuthorityWire("delegation-grant", { ...rootGrant, parentDigest: "" }), /must match a schema in anyOf/i);
  assert.throws(() => parseAuthorityWire("delegation-grant", { ...rootGrant, constraints: { ...constraints, definitionAliases: [] } }), /fewer than 1/i);
  assert.throws(() => parseAuthorityWire("delegation-grant", { ...rootGrant, constraints: { ...constraints, audiences: ["requester_1", "requester_1"] } }), /duplicate items/i);
  assert.throws(() => parseAuthorityWire("delegation-grant", { ...rootGrant, constraints: { ...constraints, wildcard: true } }), /additional properties/i);
});

test("SourceBundle claim entries bind disjoint canonical projection paths", () => {
  assert.deepEqual(parseAuthorityWire("source-bundle", sourceBundle), sourceBundle);
  assert.throws(() => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: { ...sourceBundle.claims, authored: [{ claimId: "copy", projectionPointer: "/appointment/startTime" }] } }), /projection pointer.*more than one class/i);
  assert.throws(() => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: { ...sourceBundle.claims, authored: [{ claimId: "appointment_time", projectionPointer: "/copy" }] } }), /claim id.*unique/i);
  assert.throws(() => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: { ...sourceBundle.claims, grounded: [{ claimId: "appointment_time", projectionPointer: "appointment/startTime" }] } }), /pattern/i);
  assert.throws(() => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: { ...sourceBundle.claims, grounded: [{ claimId: "missing", projectionPointer: "/appointment/missing" }] } }), /projection pointer.*own path/i);
});

test("amended wire required fields and nested objects are closed", () => {
  const requiredCases: [AuthorityKind, Record<string, unknown>, string[]][] = [
    ["outcome-contract", contract, ["sponsor", "audiences", "delegationGrantDigest", "connectorId", "accountId", "sourceAuthority", "riskClasses", "limits", "policyCommitment"]],
    ["delegation-grant", rootGrant, ["parentDigest", "sponsor", "constraints"]],
    ["source-bundle", sourceBundle, ["definitionDigest", "projectionSchemaId"]],
  ];
  for (const [kind, value, fields] of requiredCases) for (const field of fields) {
    assert.throws(() => parseAuthorityWire(kind, without(value, field)), /required property/i, `${kind}.${field}`);
  }
  for (const field of Object.keys(contract.sourceAuthority)) assert.throws(
    () => parseAuthorityWire("outcome-contract", { ...contract, sourceAuthority: without(contract.sourceAuthority, field as keyof typeof contract.sourceAuthority) }),
    /required property/i, `sourceAuthority.${field}`,
  );
  for (const field of Object.keys(contract.policyCommitment)) assert.throws(
    () => parseAuthorityWire("outcome-contract", { ...contract, policyCommitment: without(contract.policyCommitment, field as keyof typeof contract.policyCommitment) }),
    /required property/i, `policyCommitment.${field}`,
  );
  for (const field of Object.keys(limits)) assert.throws(
    () => parseAuthorityWire("outcome-contract", { ...contract, limits: without(limits, field as keyof typeof limits) }),
    /required property/i, `limits.${field}`,
  );
  for (const field of Object.keys(limits)) assert.throws(
    () => parseAuthorityWire("delegation-grant", { ...rootGrant, constraints: { ...constraints, limits: without(limits, field as keyof typeof limits) } }),
    /required property/i, `constraints.limits.${field}`,
  );
  for (const field of Object.keys(constraints)) assert.throws(
    () => parseAuthorityWire("delegation-grant", { ...rootGrant, constraints: without(constraints, field as keyof typeof constraints) }),
    /required property/i, `constraints.${field}`,
  );
  for (const field of Object.keys(constraints.connectorAccounts[0])) assert.throws(
    () => parseAuthorityWire("delegation-grant", { ...rootGrant, constraints: { ...constraints, connectorAccounts: [without(constraints.connectorAccounts[0], field as keyof typeof constraints.connectorAccounts[0])] } }),
    /required property/i, `connectorAccount.${field}`,
  );
  for (const claimClass of ["grounded", "authored", "unresolved"] as const) assert.throws(
    () => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: without(sourceBundle.claims, claimClass) }),
    /required property/i, `claims.${claimClass}`,
  );
  for (const field of ["claimId", "projectionPointer"] as const) assert.throws(
    () => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: { ...sourceBundle.claims, grounded: [without(sourceBundle.claims.grounded[0], field)] } }),
    /required property/i, `claim.${field}`,
  );
  const additionalCases: [AuthorityKind, unknown, string][] = [
    ["outcome-contract", { ...contract, sourceAuthority: { ...contract.sourceAuthority, extra: true } }, "sourceAuthority"],
    ["outcome-contract", { ...contract, limits: { ...limits, extra: 1 } }, "contract limits"],
    ["outcome-contract", { ...contract, policyCommitment: { ...contract.policyCommitment, extra: true } }, "policyCommitment"],
    ["delegation-grant", { ...rootGrant, constraints: { ...constraints, extra: true } }, "constraints"],
    ["delegation-grant", { ...rootGrant, constraints: { ...constraints, connectorAccounts: [{ ...constraints.connectorAccounts[0], extra: true }] } }, "connectorAccount"],
    ["delegation-grant", { ...rootGrant, constraints: { ...constraints, limits: { ...limits, extra: 1 } } }, "grant limits"],
    ["source-bundle", { ...sourceBundle, claims: { ...sourceBundle.claims, extra: [] } }, "claims"],
    ["source-bundle", { ...sourceBundle, claims: { ...sourceBundle.claims, grounded: [{ ...sourceBundle.claims.grounded[0], extra: true }] } }, "claim"],
  ];
  for (const [kind, value, label] of additionalCases) assert.throws(() => parseAuthorityWire(kind, value), /additional properties/i, label);
});

test("standing authority enforces lower and upper bounds table", () => {
  const integerBounds = { maxEffectsPerWindow: 1000000, windowSeconds: 31536000, maxEffectsPerSourceTrigger: 1000000, maxBodyBytes: 10485760 };
  for (const [field, upper] of Object.entries(integerBounds)) {
    for (const valid of [1, upper]) {
      assert.doesNotThrow(() => parseAuthorityWire("outcome-contract", { ...contract, limits: { ...limits, [field]: valid } }), `contract ${field}=${valid}`);
      assert.doesNotThrow(() => parseAuthorityWire("delegation-grant", { ...rootGrant, constraints: { ...constraints, limits: { ...limits, [field]: valid } } }), `grant ${field}=${valid}`);
    }
    for (const invalid of [0, upper + 1]) {
      assert.throws(() => parseAuthorityWire("outcome-contract", { ...contract, limits: { ...limits, [field]: invalid } }), /must be [<>=]/i, `contract ${field}=${invalid}`);
      assert.throws(() => parseAuthorityWire("delegation-grant", { ...rootGrant, constraints: { ...constraints, limits: { ...limits, [field]: invalid } } }), /must be [<>=]/i, `grant ${field}=${invalid}`);
    }
  }
  const id128 = "x".repeat(128);
  assert.doesNotThrow(() => parseAuthorityWire("outcome-contract", { ...contract, sponsor: id128 }));
  assert.throws(() => parseAuthorityWire("outcome-contract", { ...contract, sponsor: "" }), /pattern/i);
  assert.throws(() => parseAuthorityWire("outcome-contract", { ...contract, sponsor: id128 + "x" }), /pattern/i);
  const schema256 = "x".repeat(256);
  assert.doesNotThrow(() => parseAuthorityWire("source-bundle", { ...sourceBundle, projectionSchemaId: schema256 }));
  assert.throws(() => parseAuthorityWire("source-bundle", { ...sourceBundle, projectionSchemaId: "" }), /pattern/i);
  assert.throws(() => parseAuthorityWire("source-bundle", { ...sourceBundle, projectionSchemaId: schema256 + "x" }), /pattern/i);
  const claim256 = "x".repeat(256);
  assert.doesNotThrow(() => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: { grounded: [], authored: [{ claimId: claim256, projectionPointer: "/copy" }], unresolved: [] } }));
  assert.throws(() => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: { grounded: [], authored: [{ claimId: "", projectionPointer: "/copy" }], unresolved: [] } }), /pattern/i);
  assert.throws(() => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: { grounded: [], authored: [{ claimId: claim256 + "x", projectionPointer: "/copy" }], unresolved: [] } }), /pattern/i);
  const pointer512 = "/" + "x".repeat(511);
  assert.doesNotThrow(() => parseAuthorityWire("outcome-contract", { ...contract, sourceAuthority: { ...contract.sourceAuthority, authorizedProjectionPointers: [pointer512] } }));
  assert.throws(() => parseAuthorityWire("outcome-contract", { ...contract, sourceAuthority: { ...contract.sourceAuthority, authorizedProjectionPointers: [""] } }), /pattern/i);
  assert.throws(() => parseAuthorityWire("outcome-contract", { ...contract, sourceAuthority: { ...contract.sourceAuthority, authorizedProjectionPointers: [pointer512 + "x"] } }), /more than 512 characters/i);
});

test("policy commitment Base64 accepts exact valid JCS boundaries and refuses outside them", () => {
  const commitmentFor = (value: unknown) => {
    const bytes = authorityCanonicalBytes(value);
    return { schemaId: contract.policyCommitment.schemaId, jcsBase64: bytes.toString("base64"), digest: "sha256:" + createHash("sha256").update(bytes).digest("hex") };
  };
  const exactMinimum = commitmentFor(0);
  assert.equal(exactMinimum.jcsBase64.length, 4);
  assert.doesNotThrow(() => parseAuthorityWire("outcome-contract", { ...contract, policyCommitment: exactMinimum }));

  const exactMaximum = commitmentFor("x".repeat(49_150));
  assert.equal(Buffer.from(exactMaximum.jcsBase64, "base64").length, 49_152);
  assert.equal(exactMaximum.jcsBase64.length, 65_536);
  assert.doesNotThrow(() => parseAuthorityWire("outcome-contract", { ...contract, policyCommitment: exactMaximum }));

  assert.throws(() => parseAuthorityWire("outcome-contract", { ...contract, policyCommitment: { ...exactMinimum, jcsBase64: "MA=" } }), /fewer than 4 characters|pattern/i);
  const aboveMaximum = commitmentFor("x".repeat(49_151));
  assert.equal(aboveMaximum.jcsBase64.length, 65_540);
  assert.throws(() => parseAuthorityWire("outcome-contract", { ...contract, policyCommitment: aboveMaximum }), /more than 65536 characters/i);
});

test("all comparable authority arrays are nonempty, bounded, and unique", () => {
  const repeated = (count: number) => Array.from({ length: count }, (_, index) => `id_${index}`);
  const contractArrays = [
    ["audiences", 64, (items: unknown[]) => ({ ...contract, audiences: items })],
    ["allowedReadEndpointIds", 64, (items: unknown[]) => ({ ...contract, sourceAuthority: { ...contract.sourceAuthority, allowedReadEndpointIds: items } })],
    ["authorizedProjectionPointers", 256, (items: unknown[]) => ({ ...contract, sourceAuthority: { ...contract.sourceAuthority, authorizedProjectionPointers: items.map((item) => `/${item}`) } })],
    ["riskClasses", 32, (items: unknown[]) => ({ ...contract, riskClasses: items })],
  ] as const;
  for (const [label, max, make] of contractArrays) {
    assert.throws(() => parseAuthorityWire("outcome-contract", make([])), /fewer than 1/i, `${label} empty`);
    assert.doesNotThrow(() => parseAuthorityWire("outcome-contract", make(repeated(max))), `${label} exact max`);
    assert.throws(() => parseAuthorityWire("outcome-contract", make(repeated(max + 1))), new RegExp(`more than ${max}`), `${label} max`);
    assert.throws(() => parseAuthorityWire("outcome-contract", make(["same", "same"])), /duplicate items/i, `${label} unique`);
  }
  const grantArrays = [
    ["definitionAliases", 64, (items: unknown[]) => items], ["audiences", 64, (items: unknown[]) => items],
    ["projectionPointers", 256, (items: unknown[]) => items.map((item) => `/${item}`)], ["riskClasses", 32, (items: unknown[]) => items],
  ] as const;
  for (const [field, max, map] of grantArrays) {
    assert.throws(() => parseAuthorityWire("delegation-grant", { ...rootGrant, constraints: { ...constraints, [field]: map([]) } }), /fewer than 1/i, `${field} empty`);
    assert.doesNotThrow(() => parseAuthorityWire("delegation-grant", { ...rootGrant, constraints: { ...constraints, [field]: map(repeated(max)) } }), `${field} exact max`);
    assert.throws(() => parseAuthorityWire("delegation-grant", { ...rootGrant, constraints: { ...constraints, [field]: map(repeated(max + 1)) } }), new RegExp(`more than ${max}`), `${field} max`);
    assert.throws(() => parseAuthorityWire("delegation-grant", { ...rootGrant, constraints: { ...constraints, [field]: map(["same", "same"]) } }), /duplicate items/i, `${field} unique`);
  }
  assert.throws(() => parseAuthorityWire("delegation-grant", { ...rootGrant, constraints: { ...constraints, connectorAccounts: [] } }), /fewer than 1/i);
  assert.doesNotThrow(() => parseAuthorityWire("delegation-grant", { ...rootGrant, constraints: { ...constraints, connectorAccounts: Array.from({ length: 64 }, (_, i) => ({ connectorId: "c", accountId: `a_${i}` })) } }));
  assert.throws(() => parseAuthorityWire("delegation-grant", { ...rootGrant, constraints: { ...constraints, connectorAccounts: Array.from({ length: 65 }, (_, i) => ({ connectorId: "c", accountId: `a_${i}` })) } }), /more than 64/i);
  assert.throws(() => parseAuthorityWire("delegation-grant", { ...rootGrant, constraints: { ...constraints, connectorAccounts: [constraints.connectorAccounts[0], { ...constraints.connectorAccounts[0] }] } }), /duplicate items/i);
  assert.doesNotThrow(() => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: { grounded: [], authored: Array.from({ length: 256 }, (_, i) => ({ claimId: `c_${i}`, projectionPointer: `/p_${i}` })), unresolved: [] } }));
  assert.throws(() => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: { grounded: [], authored: Array.from({ length: 257 }, (_, i) => ({ claimId: `c_${i}`, projectionPointer: `/p_${i}` })), unresolved: [] } }), /more than 256/i);
});

test("JSON Pointer escapes resolve own paths and malformed, missing, or inherited paths refuse", () => {
  const escaped = { ...sourceBundle, claims: { grounded: [{ claimId: "escaped", projectionPointer: "/a~0b/c~1d" }], authored: [], unresolved: [] }, projection: { "a~b": { "c/d": true } } };
  assert.deepEqual(parseAuthorityWire("source-bundle", escaped), escaped);
  for (const pointer of ["a", "/a~", "/a~2b"]) assert.throws(() => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: { grounded: [{ claimId: "bad", projectionPointer: pointer }], authored: [], unresolved: [] } }), /pattern/i, pointer);
  assert.throws(() => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: { grounded: [{ claimId: "missing", projectionPointer: "/missing" }], authored: [], unresolved: [] } }), /own path/i);
  const inheritedProjection = Object.create({ inherited: true }) as Record<string, unknown>;
  assert.throws(() => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: { grounded: [{ claimId: "inherited", projectionPointer: "/inherited" }], authored: [], unresolved: [] }, projection: inheritedProjection }), /own path/i);
});

test("claim IDs and pointers are disjoint across every source class pair", () => {
  const classes = ["grounded", "authored", "unresolved"] as const;
  for (let left = 0; left < classes.length; left++) for (let right = left + 1; right < classes.length; right++) {
    const duplicatePointer = { grounded: [], authored: [], unresolved: [] } as Record<typeof classes[number], { claimId: string; projectionPointer: string }[]>;
    duplicatePointer[classes[left]].push({ claimId: `id_${left}`, projectionPointer: "/same" });
    duplicatePointer[classes[right]].push({ claimId: `id_${right}`, projectionPointer: "/same" });
    const projection = { ...sourceBundle.projection, same: true, other: true };
    assert.throws(() => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: duplicatePointer, projection }), /projection pointer.*more than one class/i);
    const duplicateId = structuredClone(duplicatePointer);
    duplicateId[classes[right]][0] = { claimId: `id_${left}`, projectionPointer: "/other" };
    assert.throws(() => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: duplicateId, projection }), /claim id.*unique/i);
  }
  assert.throws(() => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: { grounded: [], authored: [{ claimId: "same", projectionPointer: "/one" }, { claimId: "same", projectionPointer: "/two" }], unresolved: [] } }), /claim id.*unique/i);
  assert.throws(() => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: { grounded: [], authored: [{ claimId: "one", projectionPointer: "/same" }, { claimId: "two", projectionPointer: "/same" }], unresolved: [] } }), /projection pointer.*more than one class/i);
  assert.doesNotThrow(() => parseAuthorityWire("source-bundle", { ...sourceBundle, claims: { grounded: [], authored: [{ claimId: "authored", projectionPointer: "/authored" }], unresolved: [{ claimId: "unresolved", projectionPointer: "/unresolved" }] } }));
});

test("v1 delegation uses an identical fixed window and only maxima may decrease", () => {
  const protocol = readFileSync(path.join(process.cwd(), "docs/specs/compiled-authority-v1.md"), "utf8");
  const pack = readFileSync(path.join(process.cwd(), "docs/specs/outcome-pack-v0.md"), "utf8");
  for (const text of [protocol, pack]) {
    assert.match(text, /windowSeconds` must (?:remain|be) (?:exactly )?(?:equal|identical)/i);
    assert.match(text, /maxEffectsPerWindow.*maxEffectsPerSourceTrigger.*maxBodyBytes.*(?:equal|decrease)/is);
  }
});

test("AuthorityReceipt fixed evidence claims are closed", () => {
  assert.deepEqual(parseAuthorityWire("authority-receipt", authorityReceipt), authorityReceipt);
  assert.throws(() => parseAuthorityWire("authority-receipt", { ...authorityReceipt, claims: { ...receiptClaims, safe: "verified" } }), /additional properties/i);
  for (const field of ["decisionContextDigest", "decisionContext", "gateEventDigest"] as const) {
    assert.throws(() => parseAuthorityWire("authority-receipt", without(authorityReceipt, field)), /required property/i, field);
  }
  assert.throws(() => parseAuthorityWire("authority-receipt", { ...authorityReceipt, decisionContextDigest: zeroDigest }), /pattern|digest mismatch/i);
});

test("GateEvent requires the exact non-sentinel DecisionContext digest", () => {
  assert.deepEqual(parseAuthorityWire("gate-event", gateEvent), gateEvent);
  assert.throws(() => parseAuthorityWire("gate-event", without(gateEvent, "decisionContextDigest")), /required property/i);
  assert.throws(() => parseAuthorityWire("gate-event", { ...gateEvent, decisionContextDigest: zeroDigest }), /pattern/i);
});

test("legacy verifier refuses an authority receipt instead of awarding a legacy pass", () => {
  const result = evaluateVerifyClaims({ record: { v: "reelier.authority-receipt/v1" } as never });
  assert.equal(result.exitCode, 1);
  assert.match(result.claims[0].line, /unsupported authority receipt/);
});

test("authority canonical bytes are JCS and digests are sha256-prefixed", () => {
  assert.equal(authorityCanonicalBytes({ z: 1, a: "\u2028" }).toString("utf8"), '{"a":"\u2028","z":1}');
  assert.match(authorityDigest(request), /^sha256:[0-9a-f]{64}$/);
});

test("every frozen wire kind has a valid, deterministic golden vector", () => {
  const vectors = JSON.parse(readFileSync(path.join(process.cwd(), "contract/authority/v1/golden-vectors.json"), "utf8")) as Record<
    AuthorityKind,
    { canonical: string; digest: string; value: unknown; compiledRequest?: { target: string; bodyUtf8: string }; variants?: { preCompileRefusal: { canonical: string; digest: string; value: unknown } } }
  >;
  for (const [kind, vector] of Object.entries(vectors) as [AuthorityKind, { canonical: string; digest: string; value: unknown; compiledRequest?: { target: string; bodyUtf8: string }; variants?: { preCompileRefusal: { canonical: string; digest: string; value: unknown } } }][]) {
    assert.deepEqual(parseAuthorityWire(kind, vector.value), vector.value, kind);
    assert.equal(authorityCanonicalBytes(vector.value).toString("utf8"), vector.canonical, kind);
    assert.equal(authorityDigest(vector.value), vector.digest, kind);
  }
  const refusal = vectors["decision-context"].variants?.preCompileRefusal;
  assert.ok(refusal);
  assert.deepEqual(parseAuthorityWire("decision-context", refusal.value), refusal.value);
  assert.equal(authorityCanonicalBytes(refusal.value).toString("utf8"), refusal.canonical);
  assert.equal(authorityDigest(refusal.value), refusal.digest);
  assert.deepEqual(vectors["transport-effect"].compiledRequest, { target: "/v1/messages?account=tenant_1&mode=send", bodyUtf8: "{}" });
  assert.throws(() => parseCanonicalAuthorityJson("outcome-request", JSON.stringify(request)), /not RFC 8785\/JCS canonical/);
});
