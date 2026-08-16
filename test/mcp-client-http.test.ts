import test from "node:test";
import assert from "node:assert/strict";
import { connectDownstreamHttp } from "../src/mcp-client.js";

test("HTTP MCP adoption rejects ambient or non-TLS endpoint forms before connecting", async () => {
  await assert.rejects(() => connectDownstreamHttp("http://example.test/mcp"), /HTTPS/);
  await assert.rejects(() => connectDownstreamHttp("https://user:pass@example.test/mcp"), /userinfo/);
  await assert.rejects(() => connectDownstreamHttp("https://example.test/mcp#fragment"), /fragments/);
});
