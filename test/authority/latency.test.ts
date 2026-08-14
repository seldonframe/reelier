import test from "node:test";
import assert from "node:assert/strict";
import { AUTHORITY_LATENCY_PHASES, createAuthorityLatencyRecorder } from "../../src/authority/host/latency.js";
import { evaluateLatencyEvidence } from "../../src/authority/certification/evaluation.js";

const expectedPhaseOrder = [
  "authority-load", "identity-probe", "source-pre-read", "compile", "reserve",
  "route-reread", "authority-validation-before-prepare", "prepare", "credential",
  "authority-validation-after-prepare", "dispatch-commit-cas", "authority-send-boundary",
  "dns", "connect", "tls", "upload", "response-headers", "response-body",
  "reconcile-read", "receipt-publish", "terminal-transition",
] as const;

test("latency recorder emits only the closed critical-path phase order with monotonic non-negative durations", async () => {
  let now = 100;
  const recorder = createAuthorityLatencyRecorder({ monotonicNow: () => now });
  for (const phase of expectedPhaseOrder) {
    await recorder.measure(phase, () => { now += 3; });
  }

  const trace = recorder.finish();
  assert.deepEqual(AUTHORITY_LATENCY_PHASES, expectedPhaseOrder);
  assert.deepEqual(trace.phases.map(item => item.name), expectedPhaseOrder);
  assert.equal(trace.phases.every(item => item.durationMs >= 0), true);
  assert.equal(trace.modelCalls, 0);
  assert.equal(trace.reviewerCalls, 0);
  assert.equal(trace.graphExportsOnCriticalPath, 0);
  assert.deepEqual(Object.keys(trace).sort(), ["graphExportsOnCriticalPath", "modelCalls", "phases", "reviewerCalls", "totalMs", "v"]);
});

test("latency recorder publishes only executed chronological phases after a terminal transition", async () => {
  let now = 0;
  const recorder = createAuthorityLatencyRecorder({ monotonicNow: () => now });
  await recorder.measure("authority-load", () => { now += 2; });
  await recorder.measure("compile", () => { now += 3; });
  assert.throws(() => recorder.finish(), /terminal/i);
  await recorder.measure("terminal-transition", () => { now += 1; });
  const trace = recorder.finish();
  assert.deepEqual(trace.phases, [
    { name: "authority-load", durationMs: 2 },
    { name: "compile", durationMs: 3 },
    { name: "terminal-transition", durationMs: 1 },
  ]);
  assert.equal(trace.totalMs, 6);
  assert.throws(() => recorder.measure("reserve", () => undefined), /terminal|chronological/i);
});

test("latency recorder rejects out-of-order and nested double-counted phase instrumentation", async () => {
  let now = 0;
  const recorder = createAuthorityLatencyRecorder({ monotonicNow: () => now });
  await recorder.measure("compile", () => { now += 1; });
  await assert.rejects(() => recorder.measure("authority-load", () => undefined), /chronological/i);
  await assert.rejects(() => recorder.measure("reserve", async () => recorder.measure("credential", () => undefined)), /nested/i);
});

test("latency evidence remains an honest baseline until its configured sample count is met", async () => {
  let now = 0;
  const traces = await Promise.all([1, 2].map(async duration => {
    const recorder = createAuthorityLatencyRecorder({ monotonicNow: () => now });
    await recorder.measure("authority-load", () => { now += duration; });
    return recorder.finish();
  }));

  const insufficient = evaluateLatencyEvidence(traces, { minimumSampleCount: 3 });
  assert.deepEqual(insufficient, {
    v: "reelier.authority-latency-evaluation/v1",
    baselineStatus: "insufficient-samples",
    sampleCount: 2,
    minimumSampleCount: 3,
    sloStatus: "absent",
    regressionBudgetStatus: "absent",
  });

  const measured = evaluateLatencyEvidence([...traces, traces[1]!], { minimumSampleCount: 3 });
  assert.equal(measured.baselineStatus, "measured");
  assert.deepEqual(measured.percentiles, { p50Ms: 2, p95Ms: 3, p99Ms: 3 });
  assert.equal(measured.sloStatus, "absent");
  assert.equal(measured.regressionBudgetStatus, "absent");
});
