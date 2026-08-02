import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  authorityCanonicalBytes,
  authorityDigest,
  parseCanonicalAuthorityJson,
  parseAuthorityWire,
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
  policyCommitment: { schemaId: "highlevel.sms-reminder-policy/v1", jcsBase64: policyBytes.toString("base64"), digest: "sha256:" + createRequire(import.meta.url)("node:crypto").createHash("sha256").update(policyBytes).digest("hex") },
};
const rootGrant = {
  v: "reelier.delegation-grant/v1", tenant: "tenant_1", grantId: "grant_root", parentDigest: null,
  sponsor: "sponsor_1", grantor: "operator_1", grantee: "gate_1", issuedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-02-01T00:00:00.000Z", constraints,
};

const request = {
  v: "reelier.outcome-request/v1",
  requestId: "req_01HZY3Y7V6K8M4Q2P9N5R1T0X",
  sourceRefs: { appointment: "ref_01HZY3Y7V6K8M4Q2P9N5R1T0X" },
  choices: {},
};

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
  const source = { v: "reelier.source-bundle/v1", tenant: "tenant_1", definitionDigest: zeroDigest, projectionSchemaId: "highlevel.appointment-reminder/v1", sourceIdentity: "source_1", triggerIdentity: "trigger_1", observedAt: "2026-01-01T00:00:00.000Z", rawDigest: zeroDigest, freshUntil: "2026-01-01T00:01:00.000Z", provenance: { resolverId: "resolver_1", endpointId: "read_1" }, claims: { grounded: [{ claimId: "appointment_time", projectionPointer: "/appointment/startTime" }], authored: [], unresolved: [] }, projection: { appointment: { startTime: "2026-01-02T12:00:00.000Z" } } };
  assert.deepEqual(parseAuthorityWire("source-bundle", source), source);
  assert.throws(() => parseAuthorityWire("source-bundle", { ...source, claims: { ...source.claims, authored: [{ claimId: "copy", projectionPointer: "/appointment/startTime" }] } }), /projection pointer.*more than one class/i);
  assert.throws(() => parseAuthorityWire("source-bundle", { ...source, claims: { ...source.claims, authored: [{ claimId: "appointment_time", projectionPointer: "/copy" }] } }), /claim id.*unique/i);
  assert.throws(() => parseAuthorityWire("source-bundle", { ...source, claims: { ...source.claims, grounded: [{ claimId: "appointment_time", projectionPointer: "appointment/startTime" }] } }), /pattern/i);
  assert.throws(() => parseAuthorityWire("source-bundle", { ...source, claims: { ...source.claims, grounded: [{ claimId: "missing", projectionPointer: "/appointment/missing" }] } }), /projection pointer.*own path/i);
});

test("AuthorityReceipt fixed evidence claims are closed", () => {
  const claims = { authorization: "verified", sourceCompleteness: "verified", dispatch: "verified", providerAcknowledgment: "unchecked", reconciliation: "absent", topology: "unchecked", completeness: "unchecked" };
  assert.deepEqual(parseAuthorityWire("authority-receipt", { v: "reelier.authority-receipt/v1", receiptId: "receipt_1", gateEventDigest: "sha256:" + "0".repeat(64), claims }), { v: "reelier.authority-receipt/v1", receiptId: "receipt_1", gateEventDigest: "sha256:" + "0".repeat(64), claims });
  assert.throws(() => parseAuthorityWire("authority-receipt", { v: "reelier.authority-receipt/v1", receiptId: "receipt_1", gateEventDigest: "sha256:" + "0".repeat(64), claims: { ...claims, safe: "verified" } }), /additional properties/i);
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
    { canonical: string; digest: string; value: unknown; compiledRequest?: { target: string; bodyUtf8: string } }
  >;
  for (const [kind, vector] of Object.entries(vectors) as [AuthorityKind, { canonical: string; digest: string; value: unknown; compiledRequest?: { target: string; bodyUtf8: string } }][]) {
    assert.deepEqual(parseAuthorityWire(kind, vector.value), vector.value, kind);
    assert.equal(authorityCanonicalBytes(vector.value).toString("utf8"), vector.canonical, kind);
    assert.equal(authorityDigest(vector.value), vector.digest, kind);
  }
  assert.deepEqual(vectors["transport-effect"].compiledRequest, { target: "/v1/messages?account=tenant_1&mode=send", bodyUtf8: "{}" });
  assert.throws(() => parseCanonicalAuthorityJson("outcome-request", JSON.stringify(request)), /not RFC 8785\/JCS canonical/);
});
