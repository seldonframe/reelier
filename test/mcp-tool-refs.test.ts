import { test } from "node:test";
import assert from "node:assert/strict";
import { mcpResultToObservation } from "../src/mcp-tool.js";
import type { McpCallResult } from "../src/mcp-client.js";

// B2 — request-id refs, MCP body-level half (spec §3): "the proxy sees tool
// RESULTS, not HTTP transport" — capture an EXACT-match allowlist of
// top-level JSON body keys (request_id/requestId/x_request_id), single-
// JSON-body case only. A near-miss key (`requestIdentifier`) must NOT match.

test("mcpResultToObservation: captures request_id from a single JSON text block", () => {
  const result: McpCallResult = { content: [{ type: "text", text: JSON.stringify({ request_id: "req_1", ok: true }) }] };
  const obs = mcpResultToObservation(result);
  assert.deepEqual(obs.refs, [{ source: "body", key: "request_id", value: "req_1" }]);
});

test("mcpResultToObservation: captures requestId and x_request_id too, only the ones present", () => {
  const result: McpCallResult = { content: [{ type: "text", text: JSON.stringify({ requestId: "rid-2" }) }] };
  const obs = mcpResultToObservation(result);
  assert.deepEqual(obs.refs, [{ source: "body", key: "requestId", value: "rid-2" }]);
});

test("mcpResultToObservation: a near-miss key (requestIdentifier) must NOT match", () => {
  const result: McpCallResult = { content: [{ type: "text", text: JSON.stringify({ requestIdentifier: "nope" }) }] };
  const obs = mcpResultToObservation(result);
  assert.equal(obs.refs, undefined);
});

test("mcpResultToObservation: no allowlisted keys present -> refs omitted entirely", () => {
  const result: McpCallResult = { content: [{ type: "text", text: JSON.stringify({ sum: 5 }) }] };
  const obs = mcpResultToObservation(result);
  assert.equal(obs.refs, undefined);
});

test("mcpResultToObservation: a non-JSON single text body never fabricates refs", () => {
  const result: McpCallResult = { content: [{ type: "text", text: "plain text, not JSON" }] };
  const obs = mcpResultToObservation(result);
  assert.equal(obs.refs, undefined);
});

test("mcpResultToObservation: multiple text blocks (not the single-JSON-body case) never captures refs, even if one block is JSON with a matching key", () => {
  const result: McpCallResult = {
    content: [
      { type: "text", text: JSON.stringify({ request_id: "should-not-be-captured" }) },
      { type: "text", text: "second block" },
    ],
  };
  const obs = mcpResultToObservation(result);
  assert.equal(obs.refs, undefined);
});

test("mcpResultToObservation: a captured body ref matching a REELIER_REDACT-listed env var is redacted", () => {
  const originalEnv = process.env.REELIER_REDACT;
  const originalSecret = process.env.MY_TEST_SECRET;
  process.env.REELIER_REDACT = "MY_TEST_SECRET";
  process.env.MY_TEST_SECRET = "super-secret-value-456";
  try {
    const result: McpCallResult = {
      content: [{ type: "text", text: JSON.stringify({ request_id: "super-secret-value-456" }) }],
    };
    const obs = mcpResultToObservation(result);
    assert.ok(obs.refs);
    assert.equal(obs.refs![0].value, "«redacted:MY_TEST_SECRET»");
  } finally {
    if (originalEnv === undefined) delete process.env.REELIER_REDACT;
    else process.env.REELIER_REDACT = originalEnv;
    if (originalSecret === undefined) delete process.env.MY_TEST_SECRET;
    else process.env.MY_TEST_SECRET = originalSecret;
  }
});
