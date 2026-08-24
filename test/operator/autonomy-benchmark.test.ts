import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateAutonomyLeverageV1, compareAutonomyBenchmarkRunsV1, createSignedAutonomyBenchmarkBundleV1, parseAutonomyBenchmarkRunV1 } from "../../src/operator/autonomy-benchmark.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const run = (mode: "native" | "reelier", outcomes: readonly string[], milliseconds: number) => ({
  version: "reelier.autonomy-benchmark-run/v1" as const,
  benchmarkId: `benchmark-${mode}`,
  workloadDigest: digest("a"),
  mode,
  harness: "codex" as const,
  reconciledOutcomeRefs: outcomes,
  attentionEvents: [{ version: "reelier.human-attention-event/v1" as const, eventId: `event-${mode}`, benchmarkId: `benchmark-${mode}`, kind: "review" as const, startedAt: "2026-08-24T12:00:00.000Z", endedAt: new Date(Date.parse("2026-08-24T12:00:00.000Z") + milliseconds).toISOString(), activeMilliseconds: milliseconds, source: mode === "native" ? "baseline-observer" as const : "operator" as const }],
  duplicateWrites: 0,
  credentialDisclosures: 0,
  falseVerifiedOutcomes: 0,
  unresolvedOutcomes: 0,
  startedAt: "2026-08-24T12:00:00.000Z",
  endedAt: "2026-08-24T13:00:00.000Z",
});

test("autonomy leverage counts only unique reconciled Outcomes over active human minutes", () => {
  const parsed = parseAutonomyBenchmarkRunV1(run("reelier", ["receipt-1", "receipt-2"], 120_000));
  assert.deepEqual(calculateAutonomyLeverageV1(parsed), { reconciledOutcomes: 2, activeHumanMilliseconds: 120_000, outcomesPerActiveHumanMinute: 1 });
  assert.throws(() => parseAutonomyBenchmarkRunV1(run("reelier", ["receipt-1", "receipt-1"], 120_000)), /duplicate Outcome/);
  assert.throws(() => parseAutonomyBenchmarkRunV1({ ...run("reelier", ["receipt-1"], 60_000), prompt: "secret" }), /shape/);
  assert.throws(() => calculateAutonomyLeverageV1(parseAutonomyBenchmarkRunV1({ ...run("reelier", ["receipt-1"], 60_000), unresolvedOutcomes: 1 })), /unresolved/);
});

test("matched native and Reelier runs produce an honest signed offline comparison bundle", () => {
  const native = parseAutonomyBenchmarkRunV1(run("native", ["native-1", "native-2"], 600_000));
  const reelier = parseAutonomyBenchmarkRunV1(run("reelier", ["reelier-1", "reelier-2"], 60_000));
  const comparison = compareAutonomyBenchmarkRunsV1({ native, reelier });
  assert.equal(comparison.improvement, 10);
  const bundle = createSignedAutonomyBenchmarkBundleV1({ native, reelier, sign: (payloadDigest) => `signature:${payloadDigest}` });
  assert.equal(bundle.comparison.improvement, 10);
  assert.match(bundle.bundleDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(bundle.signature, `signature:${bundle.bundleDigest}`);
  assert.doesNotMatch(JSON.stringify(bundle), /prompt|reasoning|credential/i);
});
