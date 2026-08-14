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

test("local runtime forwards the injected recorder into the real gate path", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-local-latency-gate-"));
  try {
    let ticks = 0;
    const recorder = createAuthorityLatencyRecorder({ monotonicNow: () => ++ticks });
    const runtime = await createLocalAuthorityRuntime({ version: 1, tenant: "tenant_1", requester: "operator", definitions: ["gmail_reply_send_v1"], ledgerDir: path.join(root, "ledger"), decisionDir: path.join(root, "decisions"), receiptDir: path.join(root, "receipts"), endpoints: [] }, { latencyRecorder: recorder });
    const result = await runtime.outcome("gmail_reply_send_v1", { v: "reelier.outcome-request/v1", requestId: "latency_gate_1", sourceRefs: {}, choices: {} }, { tenant: "tenant_1", requester: "operator" });
    assert.equal(result.verdict, "refused");
    assert.deepEqual(recorder.observedPhases(), ["authority-load"]);
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});
