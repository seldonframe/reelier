import test from "node:test";
import assert from "node:assert/strict";
import { classifyHttpResponse, materializedHttpRequestDigest, parseHttpResponseSemanticsProfileV1 } from "../../src/authority/host/http-response-semantics.js";
import { buildMaterializedHttpRequestProjection } from "../../src/authority/drivers/json-https.js";
import { malformedJsonResponse } from "../../src/authority/host/json-https-connector.js";

const profile = parseHttpResponseSemanticsProfileV1({ v: "reelier.http-response-semantics/v1", profileId: "github.labels.v1", acknowledgedStatuses: [200, 201, 202, 204] });
test("only reviewed 2xx responses are acknowledged", () => {
  for (const status of [200, 201, 202, 204]) assert.equal(classifyHttpResponse(profile, { kind: "response", status }), "acknowledged");
  for (const status of [300, 301, 302, 400, 404, 500, 503]) assert.equal(classifyHttpResponse(profile, { kind: "response", status }), "ambiguous");
});
test("disconnect, malformed, overflow, and post-send deadline are ambiguous", () => {
  for (const kind of ["disconnect", "malformed", "overflow", "deadline"] as const) assert.equal(classifyHttpResponse(profile, { kind }), "ambiguous");
});
test("JSON content-type with malformed body is not acknowledged", () => {
  assert.equal(malformedJsonResponse({ headers: { "content-type": "application/json" }, body: Buffer.from("{bad") }), true);
  assert.equal(malformedJsonResponse({ headers: { "content-type": "application/json" }, body: Buffer.from("{}") }), false);
});
test("materialized request projection binds route and body while excluding credentials", () => {
  const projection = buildMaterializedHttpRequestProjection({ endpointId: "e", baseUrl: "https://api.github.com", allowedMethods: ["PUT"], allowedPathPrefixes: ["/repos"], accountIdentity: "acct" }, "PUT", "/repos/a", "b=2&a=1", { Authorization: "Bearer secret", Accept: "application/json" }, Buffer.from("body"));
  assert.equal(projection.origin, "https://api.github.com");
  assert.equal(projection.normalizedQuery, "a=1&b=2");
  assert.deepEqual(projection.reviewedHeaders, { accept: "application/json" });
  assert.equal(JSON.stringify(projection).includes("secret"), false);
  assert.throws(() => buildMaterializedHttpRequestProjection({ endpointId: "e", baseUrl: "https://api.github.com", allowedMethods: ["PUT"], allowedPathPrefixes: ["/repos"], accountIdentity: "acct" }, "PUT", "/repos/a", "api_key=secret", {}, Buffer.from("body")), /secret query/i);
  for (const query of ["%61pi_key=secret", "api%5Fkey=secret", "%61uthorization=secret"]) {
    assert.throws(() => buildMaterializedHttpRequestProjection({ endpointId: "e", baseUrl: "https://api.github.com", allowedMethods: ["PUT"], allowedPathPrefixes: ["/repos"], accountIdentity: "acct" }, "PUT", "/repos/a", query, {}, Buffer.from("body")), /secret query/i);
  }
});

test("direct projection digest rejects encoded sensitive and malformed query keys", () => {
  const base = { v: "reelier.materialized-http-request/v1" as const, method: "PUT" as const, origin: "https://api.github.com", normalizedPath: "/repos/a", reviewedHeaders: {}, bodyDigest: "sha256:" + "1".repeat(64) };
  for (const normalizedQuery of ["%61pi_key=secret", "api%5Fkey=secret", "%61uthorization=secret", "%bad=secret"]) {
    assert.throws(() => materializedHttpRequestDigest({ ...base, normalizedQuery }), /query/i);
  }
});
