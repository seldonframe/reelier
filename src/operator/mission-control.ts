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
  if (keys.length !== REQUIRED_KEYS.length || keys.some((key) => typeof key !== "string" || !REQUIRED_KEY_SET.has(key))) throw new TypeError("mission record has unknown fields or an incomplete shape");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of REQUIRED_KEYS) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("mission record must use inert data descriptors without accessors");
  }
  return Object.fromEntries(REQUIRED_KEYS.map((key) => [key, descriptors[key]!.value])) as Record<string, unknown>;
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
