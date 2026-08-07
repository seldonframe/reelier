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
    assert.deepEqual(response, { schemaVersion: "ReelierLocalDiscoveryV1", plugin, opportunities: [] } satisfies LocalDiscoveryResponse);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
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
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
