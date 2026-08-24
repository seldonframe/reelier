import { types as utilTypes } from "node:util";
import type { OperatorHarnessIdV1 } from "./harness.js";

export type HarnessLifecycleV1 =
  | "discovered"
  | "queued"
  | "running"
  | "stalled"
  | "exited"
  | "stopped"
  | "failed"
  | "unreachable";

export type OutcomeLifecycleV1 =
  | "unrequested"
  | "pending"
  | "completed-unverified"
  | "locally-observed"
  | "reconciled"
  | "refused"
  | "failed"
  | "ambiguous";

export type AttentionStateV1 = "none" | "watching" | "required";
export type ProcessOwnershipV1 = "reelier" | "external";
export type AttentionReasonV1 =
  | "idle-threshold-exceeded"
  | "wall-clock-limit-exceeded"
  | "cost-ceiling-exceeded"
  | "token-ceiling-exceeded"
  | "repeated-tool-error"
  | "restart-loop"
  | "context-growth-threshold-exceeded"
  | "repository-head-drift"
  | "missing-expected-evidence"
  | "completion-claim-unverified";
export type AttentionActionV1 = "inspect" | "stop-or-restart" | "verify-evidence";
export type MissionAttentionAssessmentV1 = Readonly<{
  state: AttentionStateV1;
  reasons: readonly AttentionReasonV1[];
  suggestedActions: readonly AttentionActionV1[];
}>;

export type MissionControlMissionV1 = Readonly<{
  v: "reelier.mission-control-mission/v1";
  missionId: string;
  workspaceDigest: string;
  harness: OperatorHarnessIdV1;
  harnessLifecycle: HarnessLifecycleV1;
  outcomeLifecycle: OutcomeLifecycleV1;
  attentionState: AttentionStateV1;
  attentionReasons: readonly string[];
  evidenceRefs: readonly string[];
  processOwnership: ProcessOwnershipV1;
  imported: boolean;
  updatedAt: string;
  startedAt?: string;
  usage?: MissionControlUsageV1;
}>;

export type MissionControlUsageV1 = Readonly<{
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  contextUnits: number;
  totalCostMicros?: number;
}>;

const REQUIRED_KEYS = Object.freeze([
  "v",
  "missionId",
  "workspaceDigest",
  "harness",
  "harnessLifecycle",
  "outcomeLifecycle",
  "attentionState",
  "attentionReasons",
  "evidenceRefs",
  "processOwnership",
  "imported",
  "updatedAt",
] as const);
const REQUIRED_KEY_SET = new Set<string>(REQUIRED_KEYS);
const OPTIONAL_KEY_SET = new Set(["startedAt", "usage"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const HARNESS_LIFECYCLES = new Set<HarnessLifecycleV1>(["discovered", "queued", "running", "stalled", "exited", "stopped", "failed", "unreachable"]);
const OUTCOME_LIFECYCLES = new Set<OutcomeLifecycleV1>(["unrequested", "pending", "completed-unverified", "locally-observed", "reconciled", "refused", "failed", "ambiguous"]);
const ATTENTION_STATES = new Set<AttentionStateV1>(["none", "watching", "required"]);

function inertRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) throw new TypeError("mission record must be an inert non-proxy object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("mission record shape is invalid");
  const keys = Reflect.ownKeys(value);
  if (keys.length < REQUIRED_KEYS.length || keys.length > REQUIRED_KEYS.length + OPTIONAL_KEY_SET.size || keys.some((key) => typeof key !== "string" || (!REQUIRED_KEY_SET.has(key) && !OPTIONAL_KEY_SET.has(key))) || REQUIRED_KEYS.some((key) => !Object.hasOwn(value, key))) throw new TypeError("mission record has unknown fields or an incomplete shape");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("mission record must use inert data descriptors without accessors");
  }
  return Object.fromEntries((keys as string[]).map((key) => [key, descriptors[key]!.value])) as Record<string, unknown>;
}

function boundedString(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) throw new TypeError(`mission ${name} is invalid`);
  return value;
}

function stringList(value: unknown, name: string, maximumItems: number): readonly string[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximumItems) throw new TypeError(`mission ${name} must be a bounded inert array`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expectedKeys = new Set([...Array.from({ length: value.length }, (_, index) => String(index)), "length"]);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !expectedKeys.has(key)) || Reflect.ownKeys(descriptors).length !== expectedKeys.size) throw new TypeError(`mission ${name} array shape is invalid`);
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError(`mission ${name} must use inert data descriptors`);
    result.push(boundedString(descriptor.value, `${name}[${index}]`, 256));
  }
  if (new Set(result).size !== result.length) throw new TypeError(`mission ${name} contains duplicates`);
  return Object.freeze(result);
}

function missionUsage(value: unknown): MissionControlUsageV1 {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("mission usage must be an inert object");
  const allowed = new Set(["inputTokens", "cachedInputTokens", "outputTokens", "contextUnits", "totalCostMicros"]);
  const required = ["inputTokens", "cachedInputTokens", "outputTokens", "contextUnits"] as const;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key)) || required.some((key) => !Object.hasOwn(value, key))) throw new TypeError("mission usage shape is invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, number> = {};
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) throw new TypeError("mission usage must contain nonnegative inert integers");
    result[key] = descriptor.value as number;
  }
  return Object.freeze({
    inputTokens: result.inputTokens!,
    cachedInputTokens: result.cachedInputTokens!,
    outputTokens: result.outputTokens!,
    contextUnits: result.contextUnits!,
    ...(result.totalCostMicros === undefined ? {} : { totalCostMicros: result.totalCostMicros }),
  });
}

export function parseMissionControlMissionV1(value: unknown): MissionControlMissionV1 {
  const record = inertRecord(value);
  if (record.v !== "reelier.mission-control-mission/v1") throw new TypeError("mission record version is invalid");
  const missionId = boundedString(record.missionId, "id", 128);
  if (!ID.test(missionId)) throw new TypeError("mission id is invalid");
  const workspaceDigest = boundedString(record.workspaceDigest, "workspace digest", 71);
  if (!DIGEST.test(workspaceDigest)) throw new TypeError("mission workspace digest is invalid");
  const harness = record.harness;
  if (harness !== "codex" && harness !== "claude-code" && harness !== "grok-build") throw new TypeError("mission harness is invalid");
  const harnessLifecycle = record.harnessLifecycle;
  if (typeof harnessLifecycle !== "string" || !HARNESS_LIFECYCLES.has(harnessLifecycle as HarnessLifecycleV1)) throw new TypeError("mission harness lifecycle is invalid");
  const outcomeLifecycle = record.outcomeLifecycle;
  if (typeof outcomeLifecycle !== "string" || !OUTCOME_LIFECYCLES.has(outcomeLifecycle as OutcomeLifecycleV1)) throw new TypeError("mission outcome lifecycle is invalid");
  const attentionState = record.attentionState;
  if (typeof attentionState !== "string" || !ATTENTION_STATES.has(attentionState as AttentionStateV1)) throw new TypeError("mission attention state is invalid");
  if (typeof record.imported !== "boolean") throw new TypeError("mission imported flag is invalid");
  if (record.processOwnership !== "reelier" && record.processOwnership !== "external") throw new TypeError("mission process ownership is invalid");
  if (record.imported && record.processOwnership !== "external") throw new TypeError("imported missions must have external process ownership");
  const updatedAt = boundedString(record.updatedAt, "updatedAt", 64);
  if (Number.isNaN(Date.parse(updatedAt))) throw new TypeError("mission updatedAt is invalid");
  const startedAt = record.startedAt === undefined ? undefined : boundedString(record.startedAt, "startedAt", 64);
  if (startedAt !== undefined && (Number.isNaN(Date.parse(startedAt)) || Date.parse(startedAt) > Date.parse(updatedAt))) throw new TypeError("mission startedAt is invalid");
  const usage = record.usage === undefined ? undefined : missionUsage(record.usage);
  return Object.freeze({
    v: "reelier.mission-control-mission/v1",
    missionId,
    workspaceDigest,
    harness,
    harnessLifecycle: harnessLifecycle as HarnessLifecycleV1,
    outcomeLifecycle: outcomeLifecycle as OutcomeLifecycleV1,
    attentionState: attentionState as AttentionStateV1,
    attentionReasons: stringList(record.attentionReasons, "attention reasons", 32),
    evidenceRefs: stringList(record.evidenceRefs, "evidence refs", 64),
    processOwnership: record.processOwnership,
    imported: record.imported,
    updatedAt,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(usage === undefined ? {} : { usage }),
  });
}

export function deriveOutcomeLifecycleV1(input: Readonly<{
  harnessLifecycle: HarnessLifecycleV1;
  localEvidenceCount: number;
  managedLifecycle?: "pending" | "reconciled" | "refused" | "failed" | "ambiguous";
}>): OutcomeLifecycleV1 {
  if (!Number.isSafeInteger(input.localEvidenceCount) || input.localEvidenceCount < 0) throw new TypeError("local evidence count is invalid");
  if (input.managedLifecycle) return input.managedLifecycle;
  if (input.harnessLifecycle === "failed") return "failed";
  if (input.harnessLifecycle === "exited") return input.localEvidenceCount > 0 ? "locally-observed" : "completed-unverified";
  if (input.harnessLifecycle === "discovered" || input.harnessLifecycle === "queued") return "unrequested";
  return "pending";
}

function timestamp(value: string, name: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} is invalid`);
  return parsed;
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} is invalid`);
  return value;
}

export function analyzeMissionAttentionV1(input: Readonly<{
  now: string;
  startedAt: string;
  lastActivityAt: string;
  idleLimitMs: number;
  wallClockLimitMs: number;
  exposedCostMicros?: number;
  costLimitMicros?: number;
  exposedTokens?: number;
  tokenLimit?: number;
  contextUnits?: number;
  contextLimit?: number;
  recentErrorSignatures: readonly string[];
  recentRestartCount: number;
  restartLimit: number;
  expectedRepositoryHead?: string;
  actualRepositoryHead?: string;
  expectedEvidenceCount: number;
  actualEvidenceCount: number;
  harnessClaimedComplete: boolean;
}>): MissionAttentionAssessmentV1 {
  const now = timestamp(input.now, "attention now");
  const startedAt = timestamp(input.startedAt, "attention startedAt");
  const lastActivityAt = timestamp(input.lastActivityAt, "attention lastActivityAt");
  const idleLimitMs = nonnegativeInteger(input.idleLimitMs, "idle limit");
  const wallClockLimitMs = nonnegativeInteger(input.wallClockLimitMs, "wall-clock limit");
  const recentRestartCount = nonnegativeInteger(input.recentRestartCount, "restart count");
  const restartLimit = nonnegativeInteger(input.restartLimit, "restart limit");
  const expectedEvidenceCount = nonnegativeInteger(input.expectedEvidenceCount, "expected evidence count");
  const actualEvidenceCount = nonnegativeInteger(input.actualEvidenceCount, "actual evidence count");
  if (startedAt > now || lastActivityAt < startedAt || lastActivityAt > now || typeof input.harnessClaimedComplete !== "boolean") throw new TypeError("attention chronology is invalid");
  if (!Array.isArray(input.recentErrorSignatures) || input.recentErrorSignatures.length > 32 || input.recentErrorSignatures.some((item) => typeof item !== "string" || item.length === 0 || item.length > 256)) throw new TypeError("recent error signatures are invalid");

  const reasons: AttentionReasonV1[] = [];
  if (now - lastActivityAt > idleLimitMs) reasons.push("idle-threshold-exceeded");
  if (now - startedAt > wallClockLimitMs) reasons.push("wall-clock-limit-exceeded");
  if (input.exposedCostMicros !== undefined || input.costLimitMicros !== undefined) {
    const exposed = nonnegativeInteger(input.exposedCostMicros ?? -1, "exposed cost");
    const limit = nonnegativeInteger(input.costLimitMicros ?? -1, "cost limit");
    if (exposed > limit) reasons.push("cost-ceiling-exceeded");
  }
  if (input.exposedTokens !== undefined || input.tokenLimit !== undefined) {
    const exposed = nonnegativeInteger(input.exposedTokens ?? -1, "exposed tokens");
    const limit = nonnegativeInteger(input.tokenLimit ?? -1, "token limit");
    if (exposed > limit) reasons.push("token-ceiling-exceeded");
  }
  const signatureCounts = new Map<string, number>();
  for (const signature of input.recentErrorSignatures) signatureCounts.set(signature, (signatureCounts.get(signature) ?? 0) + 1);
  if ([...signatureCounts.values()].some((count) => count >= 3)) reasons.push("repeated-tool-error");
  if (recentRestartCount > restartLimit) reasons.push("restart-loop");
  if (input.contextUnits !== undefined || input.contextLimit !== undefined) {
    const units = nonnegativeInteger(input.contextUnits ?? -1, "context units");
    const limit = nonnegativeInteger(input.contextLimit ?? -1, "context limit");
    if (units > limit) reasons.push("context-growth-threshold-exceeded");
  }
  if (input.expectedRepositoryHead !== undefined || input.actualRepositoryHead !== undefined) {
    if (typeof input.expectedRepositoryHead !== "string" || typeof input.actualRepositoryHead !== "string" || input.expectedRepositoryHead.length === 0 || input.actualRepositoryHead.length === 0) throw new TypeError("repository heads are invalid");
    if (input.expectedRepositoryHead !== input.actualRepositoryHead) reasons.push("repository-head-drift");
  }
  if (actualEvidenceCount < expectedEvidenceCount) reasons.push("missing-expected-evidence");
  if (input.harnessClaimedComplete && actualEvidenceCount === 0) reasons.push("completion-claim-unverified");

  const stoppingReasons = new Set<AttentionReasonV1>(["idle-threshold-exceeded", "wall-clock-limit-exceeded", "cost-ceiling-exceeded", "token-ceiling-exceeded", "repeated-tool-error", "restart-loop", "context-growth-threshold-exceeded"]);
  const evidenceReasons = new Set<AttentionReasonV1>(["repository-head-drift", "missing-expected-evidence", "completion-claim-unverified"]);
  const requiredReasons = new Set<AttentionReasonV1>(["wall-clock-limit-exceeded", "cost-ceiling-exceeded", "token-ceiling-exceeded", "restart-loop", "repository-head-drift"]);
  const actions: AttentionActionV1[] = [];
  if (reasons.length > 0) actions.push("inspect");
  if (reasons.some((reason) => stoppingReasons.has(reason))) actions.push("stop-or-restart");
  if (reasons.some((reason) => evidenceReasons.has(reason))) actions.push("verify-evidence");
  const state: AttentionStateV1 = reasons.length === 0 ? "none" : reasons.some((reason) => requiredReasons.has(reason)) ? "required" : "watching";
  return Object.freeze({ state, reasons: Object.freeze(reasons), suggestedActions: Object.freeze(actions) });
}
