import test from "node:test";
import assert from "node:assert/strict";
import { classifyHttpResponse, parseHttpResponseSemanticsProfileV1 } from "../../src/authority/host/http-response-semantics.js";

const profile = parseHttpResponseSemanticsProfileV1({ v: "reelier.http-response-semantics/v1", profileId: "github.labels.v1", acknowledgedStatuses: [200, 201, 202, 204] });
test("only reviewed 2xx responses are acknowledged", () => {
  for (const status of [200, 201, 202, 204]) assert.equal(classifyHttpResponse(profile, { kind: "response", status }), "acknowledged");
  for (const status of [300, 301, 302, 400, 404, 500, 503]) assert.equal(classifyHttpResponse(profile, { kind: "response", status }), "ambiguous");
});
test("disconnect, malformed, overflow, and post-send deadline are ambiguous", () => {
  for (const kind of ["disconnect", "malformed", "overflow", "deadline"] as const) assert.equal(classifyHttpResponse(profile, { kind }), "ambiguous");
});

