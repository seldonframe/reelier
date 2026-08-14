import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLocalAuthorityRuntime } from "../../src/authority/host/local.js";
import { createAuthorityLatencyRecorder } from "../../src/authority/host/latency.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";

test("local authority composition accepts one injected latency recorder without serializing it", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-local-latency-"));
  try {
    const recorder = createAuthorityLatencyRecorder({ monotonicNow: () => 1 });
    const runtime = await createLocalAuthorityRuntime({ version: 1, tenant: "tenant_1", requester: "operator", definitions: [], ledgerDir: path.join(root, "ledger"), decisionDir: path.join(root, "decisions"), receiptDir: path.join(root, "receipts"), endpoints: [] }, { latencyRecorder: recorder });
    assert.equal(typeof runtime.outcome, "function");
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});
