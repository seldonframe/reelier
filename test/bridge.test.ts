import assert from "node:assert/strict";
import test from "node:test";
import { createBridgeServer } from "../src/bridge.js";
import { discoverLocalPlugin, type LocalDiscoveryResponse } from "../src/bridge-client.js";
import type { ReelierPluginV1 } from "../src/plugin.js";

const plugin: ReelierPluginV1 = {
  schemaVersion: "ReelierPluginV1",
  id: "com.example.writer",
  name: "Example writer",
  version: "1.2.3",
  capabilities: ["discovery"],
};

test("local discovery bridge returns a validated plugin and honest discovery result", async () => {
  const server = createBridgeServer({ discovery: async () => [] });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await discoverLocalPlugin(plugin, `http://127.0.0.1:${address.port}`);
    assert.deepEqual(response, { schemaVersion: "ReelierRecommendationV1", plugin, opportunities: [] } satisfies LocalDiscoveryResponse);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
  }
});

test("local discovery bridge exposes health without exposing a plugin package mcp manifest", async () => {
  const server = createBridgeServer({ discovery: async () => [] });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { protocol: "ReelierPluginV1", status: "ok" });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
  }
});

test("local discovery bridge requires the capabilities nonce and exposes safe local recommendations", async () => {
  const server = createBridgeServer({ discovery: async () => [{
    fingerprint: { version: "workflow-shape-v1", sourceAgent: "test", steps: [], dataflow: [], digest: "digest" },
    displayLabel: "workflow",
    observedCount: 1,
    lastUsedAt: "2026-08-07T00:00:00.000Z",
    durationMs: { total: 0, average: 0 },
    servers: ["public-server"],
    sourceAgents: ["test"],
    effectCounts: { read: 1, "idempotent-write": 0, destructive: 0 },
    evaluationPotential: "none",
    configuredServerCount: 1,
    approvalBoundary: "draft_only",
    sessionPaths: ["C:\\Users\\maxim\\private.jsonl"],
  }]});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const capabilities = await fetch(`${baseUrl}/v1/capabilities`);
    assert.equal(capabilities.status, 200);
    const capabilityBody = await capabilities.json() as { nonce: string; endpoints: Record<string, string> };
    assert.match(capabilityBody.nonce, /^[A-Za-z0-9_-]{32,}$/);
    assert.equal(capabilityBody.endpoints.recommend, "/v1/recommend");
    const denied = await fetch(`${baseUrl}/v1/recommend`, { method: "POST", body: JSON.stringify(plugin) });
    assert.equal(denied.status, 401);
    const response = await discoverLocalPlugin(plugin, baseUrl);
    assert.equal(response.opportunities[0]?.sessionPaths.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
  }
});

test("local discovery bridge accepts a nonce handshake and CORS preflight for work cards", async () => {
  const server = createBridgeServer({ discovery: async () => [] });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const capabilities = await (await fetch(`${baseUrl}/v1/capabilities`)).json() as { nonce: string };
    const preflight = await fetch(`${baseUrl}/v1/work-card`, { method: "OPTIONS", headers: { origin: "http://localhost", "access-control-request-method": "POST" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost");
    const workCard = await fetch(`${baseUrl}/v1/work-card`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-reelier-nonce": capabilities.nonce, origin: "http://localhost" },
      body: JSON.stringify({ plugin, workCard: { title: "Draft", apiKey: "secret", transcriptPath: "C:\\Users\\maxim\\trace.jsonl", url: "http://127.0.0.1:4000/private" } }),
    });
    assert.equal(workCard.status, 200);
    const body = await workCard.json() as { workCard: Record<string, unknown>; removedFields: string[] };
    assert.equal(body.workCard.apiKey, undefined);
    assert.equal(body.workCard.transcriptPath, undefined);
    assert.match(body.removedFields.join(","), /apiKey|transcriptPath/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
  }
});

test("local bridge client validates the loopback origin before making a request", async () => {
  let fetchCalled = false;
  await assert.rejects(
    () => discoverLocalPlugin(plugin, "https://attacker.example", async () => { fetchCalled = true; throw new Error("network should not be reached"); }),
    /localhost/,
  );
  assert.equal(fetchCalled, false);
});
