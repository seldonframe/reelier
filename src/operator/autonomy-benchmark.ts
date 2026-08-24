import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import canonicalize from "canonicalize";

export type HumanAttentionKindV1 = "mission-selection" | "activation" | "monitoring" | "intervention" | "provider-action" | "recovery" | "exception" | "review";
export type HumanAttentionEventV1 = Readonly<{
  version: "reelier.human-attention-event/v1";
  eventId: string;
  benchmarkId: string;
  kind: HumanAttentionKindV1;
  startedAt: string;
  endedAt: string;
  activeMilliseconds: number;
  source: "operator" | "browser" | "baseline-observer";
}>;
export type AutonomyBenchmarkRunV1 = Readonly<{
  version: "reelier.autonomy-benchmark-run/v1";
  benchmarkId: string;
  workloadDigest: string;
  mode: "native" | "reelier";
  harness: "codex" | "claude-code" | "cursor" | "grok-build";
  reconciledOutcomeRefs: readonly string[];
  attentionEvents: readonly HumanAttentionEventV1[];
  duplicateWrites: number;
  credentialDisclosures: number;
  falseVerifiedOutcomes: number;
  unresolvedOutcomes: number;
  startedAt: string;
  endedAt: string;
}>;

const RUN_KEYS = Object.freeze(["version", "benchmarkId", "workloadDigest", "mode", "harness", "reconciledOutcomeRefs", "attentionEvents", "duplicateWrites", "credentialDisclosures", "falseVerifiedOutcomes", "unresolvedOutcomes", "startedAt", "endedAt"] as const);
const EVENT_KEYS = Object.freeze(["version", "eventId", "benchmarkId", "kind", "startedAt", "endedAt", "activeMilliseconds", "source"] as const);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const KINDS = new Set<HumanAttentionKindV1>(["mission-selection", "activation", "monitoring", "intervention", "provider-action", "recovery", "exception", "review"]);

function record(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) throw new TypeError(`${name} must be an inert record`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} shape is invalid`);
  const expected = new Set(keys);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !expected.has(key))) throw new TypeError(`${name} shape is not closed`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError(`${name} fields must be inert and enumerable`);
    output[key] = descriptor.value;
  }
  return output;
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${name} is invalid`);
  return value;
}

function timestamp(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length > 64 || Number.isNaN(Date.parse(value))) throw new TypeError(`${name} is invalid`);
  return value;
}

function count(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} is invalid`);
  return value;
}

function denseArray(value: unknown, maximum: number, name: string): readonly unknown[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) throw new TypeError(`${name} must be a bounded inert array`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expected = new Set([...Array.from({ length: value.length }, (_, index) => String(index)), "length"]);
  if (Reflect.ownKeys(descriptors).length !== expected.size || Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !expected.has(key))) throw new TypeError(`${name} array shape is invalid`);
  return Object.freeze(Array.from({ length: value.length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError(`${name} array must contain inert items`);
    return descriptor.value;
  }));
}

function parseAttentionEventV1(value: unknown, benchmarkId: string): HumanAttentionEventV1 {
  const item = record(value, EVENT_KEYS, "human attention event");
  if (item.version !== "reelier.human-attention-event/v1" || item.benchmarkId !== benchmarkId) throw new TypeError("human attention event identity is invalid");
  if (typeof item.kind !== "string" || !KINDS.has(item.kind as HumanAttentionKindV1)) throw new TypeError("human attention kind is invalid");
  if (item.source !== "operator" && item.source !== "browser" && item.source !== "baseline-observer") throw new TypeError("human attention source is invalid");
  const startedAt = timestamp(item.startedAt, "human attention start");
  const endedAt = timestamp(item.endedAt, "human attention end");
  const activeMilliseconds = count(item.activeMilliseconds, "human attention duration");
  if (Date.parse(endedAt) < Date.parse(startedAt) || Date.parse(endedAt) - Date.parse(startedAt) !== activeMilliseconds) throw new TypeError("human attention chronology is invalid");
  return Object.freeze({ version: "reelier.human-attention-event/v1", eventId: identifier(item.eventId, "attention event id"), benchmarkId, kind: item.kind as HumanAttentionKindV1, startedAt, endedAt, activeMilliseconds, source: item.source });
}

export function parseAutonomyBenchmarkRunV1(value: unknown): AutonomyBenchmarkRunV1 {
  const item = record(value, RUN_KEYS, "autonomy benchmark run");
  if (item.version !== "reelier.autonomy-benchmark-run/v1") throw new TypeError("autonomy benchmark version is invalid");
  const benchmarkId = identifier(item.benchmarkId, "benchmark id");
  if (typeof item.workloadDigest !== "string" || !DIGEST.test(item.workloadDigest)) throw new TypeError("benchmark workload digest is invalid");
  if (item.mode !== "native" && item.mode !== "reelier") throw new TypeError("benchmark mode is invalid");
  if (item.harness !== "codex" && item.harness !== "claude-code" && item.harness !== "cursor" && item.harness !== "grok-build") throw new TypeError("benchmark harness is invalid");
  const outcomeRefs = denseArray(item.reconciledOutcomeRefs, 10_000, "reconciled Outcome references").map((candidate) => identifier(candidate, "Outcome reference"));
  if (new Set(outcomeRefs).size !== outcomeRefs.length) throw new TypeError("benchmark contains a duplicate Outcome reference");
  const attentionEvents = denseArray(item.attentionEvents, 100_000, "attention events").map((candidate) => parseAttentionEventV1(candidate, benchmarkId));
  if (new Set(attentionEvents.map((event) => event.eventId)).size !== attentionEvents.length) throw new TypeError("benchmark contains a duplicate attention event");
  const startedAt = timestamp(item.startedAt, "benchmark start");
  const endedAt = timestamp(item.endedAt, "benchmark end");
  if (Date.parse(endedAt) < Date.parse(startedAt) || attentionEvents.some((event) => Date.parse(event.startedAt) < Date.parse(startedAt) || Date.parse(event.endedAt) > Date.parse(endedAt))) throw new TypeError("benchmark chronology is invalid");
  return Object.freeze({
    version: "reelier.autonomy-benchmark-run/v1",
    benchmarkId,
    workloadDigest: item.workloadDigest,
    mode: item.mode,
    harness: item.harness,
    reconciledOutcomeRefs: Object.freeze(outcomeRefs),
    attentionEvents: Object.freeze(attentionEvents),
    duplicateWrites: count(item.duplicateWrites, "duplicate writes"),
    credentialDisclosures: count(item.credentialDisclosures, "credential disclosures"),
    falseVerifiedOutcomes: count(item.falseVerifiedOutcomes, "false verified Outcomes"),
    unresolvedOutcomes: count(item.unresolvedOutcomes, "unresolved Outcomes"),
    startedAt,
    endedAt,
  });
}

function activeHumanMilliseconds(events: readonly HumanAttentionEventV1[]): number {
  const windows = events.map((event) => [Date.parse(event.startedAt), Date.parse(event.endedAt)] as const).sort((left, right) => left[0] - right[0]);
  let total = 0;
  let start = -1;
  let end = -1;
  for (const [nextStart, nextEnd] of windows) {
    if (start < 0) { start = nextStart; end = nextEnd; continue; }
    if (nextStart <= end) { end = Math.max(end, nextEnd); continue; }
    total += end - start;
    start = nextStart;
    end = nextEnd;
  }
  return start < 0 ? 0 : total + end - start;
}

export function calculateAutonomyLeverageV1(value: AutonomyBenchmarkRunV1): Readonly<{ reconciledOutcomes: number; activeHumanMilliseconds: number; outcomesPerActiveHumanMinute: number }> {
  const run = parseAutonomyBenchmarkRunV1(value);
  if (run.unresolvedOutcomes > 0) throw new Error("unresolved Outcomes cannot contribute to autonomy leverage");
  if (run.duplicateWrites > 0 || run.credentialDisclosures > 0 || run.falseVerifiedOutcomes > 0) throw new Error("guardrail violation invalidates autonomy leverage");
  const milliseconds = activeHumanMilliseconds(run.attentionEvents);
  if (milliseconds === 0) throw new Error("active human time is required for autonomy leverage");
  return Object.freeze({ reconciledOutcomes: run.reconciledOutcomeRefs.length, activeHumanMilliseconds: milliseconds, outcomesPerActiveHumanMinute: run.reconciledOutcomeRefs.length / (milliseconds / 60_000) });
}

export function compareAutonomyBenchmarkRunsV1(input: Readonly<{ native: AutonomyBenchmarkRunV1; reelier: AutonomyBenchmarkRunV1 }>): Readonly<{ native: ReturnType<typeof calculateAutonomyLeverageV1>; reelier: ReturnType<typeof calculateAutonomyLeverageV1>; improvement: number }> {
  const native = parseAutonomyBenchmarkRunV1(input.native);
  const reelier = parseAutonomyBenchmarkRunV1(input.reelier);
  if (native.mode !== "native" || reelier.mode !== "reelier" || native.workloadDigest !== reelier.workloadDigest || native.harness !== reelier.harness || native.reconciledOutcomeRefs.length !== reelier.reconciledOutcomeRefs.length) throw new Error("autonomy benchmark runs are not matched");
  const nativeLeverage = calculateAutonomyLeverageV1(native);
  const reelierLeverage = calculateAutonomyLeverageV1(reelier);
  return Object.freeze({ native: nativeLeverage, reelier: reelierLeverage, improvement: reelierLeverage.outcomesPerActiveHumanMinute / nativeLeverage.outcomesPerActiveHumanMinute });
}

export function createSignedAutonomyBenchmarkBundleV1(input: Readonly<{ native: AutonomyBenchmarkRunV1; reelier: AutonomyBenchmarkRunV1; sign: (payloadDigest: string) => string }>): Readonly<{ version: "reelier.autonomy-benchmark-bundle/v1"; workloadDigest: string; harness: AutonomyBenchmarkRunV1["harness"]; nativeRunDigest: string; reelierRunDigest: string; comparison: ReturnType<typeof compareAutonomyBenchmarkRunsV1>; bundleDigest: string; signature: string }> {
  const native = parseAutonomyBenchmarkRunV1(input.native);
  const reelier = parseAutonomyBenchmarkRunV1(input.reelier);
  const comparison = compareAutonomyBenchmarkRunsV1({ native, reelier });
  const hash = (value: unknown): string => {
    const bytes = canonicalize(value);
    if (bytes === undefined) throw new TypeError("benchmark bundle is not canonicalizable");
    return `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;
  };
  const unsigned = Object.freeze({ version: "reelier.autonomy-benchmark-bundle/v1" as const, workloadDigest: native.workloadDigest, harness: native.harness, nativeRunDigest: hash(native), reelierRunDigest: hash(reelier), comparison });
  const bundleDigest = hash(unsigned);
  const signature = input.sign(bundleDigest);
  if (typeof signature !== "string" || signature.length === 0 || signature.length > 4096) throw new TypeError("benchmark bundle signature is invalid");
  return Object.freeze({ ...unsigned, bundleDigest, signature });
}
