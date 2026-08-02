import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  authorityCanonicalBytes,
  authorityDigest,
  parseCanonicalAuthorityJson,
  parseAuthorityWire,
} from "../../src/authority/wire.js";
import type { AuthorityKind } from "../../src/authority/types.js";
import { evaluateVerifyClaims } from "../../src/verify.js";

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
  for (const key of ["tenant", "body", "url", "credentials", "providerArgs"]) {
    assert.throws(() => parseAuthorityWire("outcome-request", { ...request, choices: { [key]: "x" } }), /property name/i, key);
  }
  assert.throws(() => parseAuthorityWire("outcome-request", { ...request, choices: { x: { nested: "no" } } }), /must be/i);
  assert.throws(() => parseAuthorityWire("outcome-request", { ...request, choices: { x: "x".repeat(257) } }), /more than 256 characters/i);
});

test("TransportEffect seals headers, query, base64 bytes, preconditions, and reconciliation", () => {
  const effect = {
    v: "reelier.transport-effect/v1", endpointId: "connector_1", method: "POST", path: "/v1/messages", query: [],
    headers: { "Content-Type": "application/json" }, bodyBase64: "e30=", riskClass: "message", idempotency: "native",
    preconditions: [], reconciliation: { recipeId: "message-readback" },
  };
  assert.deepEqual(parseAuthorityWire("transport-effect", effect), effect);
  for (const header of ["AUTHORIZATION", "cOOKIE", "HOST"]) assert.throws(() => parseAuthorityWire("transport-effect", { ...effect, headers: { [header]: "x" } }), /property name/i);
  assert.throws(() => parseAuthorityWire("transport-effect", { ...effect, bodyBase64: "e3=" }), /pattern/i);
  assert.throws(() => parseAuthorityWire("transport-effect", { ...effect, query: [{ key: "z", value: "y" }, { key: "a", value: "y" }] }), /canonically ordered/i);
});

test("SourceBundle provenance and AuthorityReceipt fixed evidence claims are closed", () => {
  const source = { v: "reelier.source-bundle/v1", tenant: "tenant_1", sourceIdentity: "source_1", triggerIdentity: "trigger_1", observedAt: "2026-01-01T00:00:00.000Z", rawDigest: "sha256:" + "0".repeat(64), freshUntil: "2026-01-01T00:01:00.000Z", provenance: { resolverId: "resolver_1", endpointId: "read_1" }, claims: { grounded: ["x"], authored: [], unresolved: [] }, projection: {} };
  assert.deepEqual(parseAuthorityWire("source-bundle", source), source);
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
    { canonical: string; digest: string; value: unknown }
  >;
  for (const [kind, vector] of Object.entries(vectors) as [AuthorityKind, { canonical: string; digest: string; value: unknown }][]) {
    assert.deepEqual(parseAuthorityWire(kind, vector.value), vector.value, kind);
    assert.equal(authorityCanonicalBytes(vector.value).toString("utf8"), vector.canonical, kind);
    assert.equal(authorityDigest(vector.value), vector.digest, kind);
  }
  assert.throws(() => parseCanonicalAuthorityJson("outcome-request", JSON.stringify(request)), /not RFC 8785\/JCS canonical/);
});
