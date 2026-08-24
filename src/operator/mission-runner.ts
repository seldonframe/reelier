import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createMissionControlJournalV1 } from "./mission-journal.js";
import { createMissionEvidenceStoreV1 } from "./mission-evidence.js";
import { createOperatorHarnessProcessV1, type OperatorHarnessEventV1, type OperatorHarnessLaunchRequestV1, type OperatorHarnessProcessV1 } from "./process.js";
import { deriveOutcomeLifecycleV1, parseMissionControlMissionV1, type MissionControlMissionV1 } from "./mission-control.js";
import type { OperatorHarnessIdV1 } from "./harness.js";
import { createMissionProcessControlV1 } from "./mission-process-control.js";
import { createMissionResumeStoreV1 } from "./mission-resume.js";

const execFileAsync = promisify(execFile);
type WorkspaceObservationV1 = Readonly<{ subjectDigest: string; resultDigest: string }>;
type ProcessFactoryV1 = Readonly<{ launch(request: OperatorHarnessLaunchRequestV1): Promise<OperatorHarnessProcessV1> }>;
type NextHarnessEventV1 = IteratorResult<OperatorHarnessEventV1>;

async function waitForEventOrIdle<T>(pending: Promise<IteratorResult<T>>, idleLimitMs: number): Promise<Readonly<{ kind: "event"; result: IteratorResult<T> }> | Readonly<{ kind: "idle" }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(Object.freeze({ kind: "idle" as const })), idleLimitMs);
    pending.then(
      (result) => { clearTimeout(timer); resolve(Object.freeze({ kind: "event" as const, result })); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

async function observeGitWorkspace(cwd: string): Promise<WorkspaceObservationV1 | null> {
  try {
    const [head, status] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd, timeout: 5_000, maxBuffer: 64 * 1024 }),
      execFileAsync("git", ["status", "--porcelain=v1", "-z"], { cwd, timeout: 5_000, maxBuffer: 2 * 1024 * 1024 }),
    ]);
    return Object.freeze({ subjectDigest: digest(path.resolve(cwd)), resultDigest: digest(`${head.stdout.trim()}\0${status.stdout}`) });
  } catch {
    return null;
  }
}

export async function runMissionControlMissionV1(input: Readonly<{
  root: string;
  cwd: string;
  harness: OperatorHarnessIdV1;
  task: string;
  now?: () => string;
  processFactory?: ProcessFactoryV1;
  observeWorkspace?: (cwd: string) => Promise<WorkspaceObservationV1 | null>;
  missionId?: string;
  resumeIdentity?: string;
  idleLimitMs?: number;
  costLimitMicros?: number;
  tokenLimit?: number;
  contextLimit?: number;
  restartCount?: number;
  restartLimit?: number;
}>): Promise<MissionControlMissionV1> {
  if (input.harness !== "codex" && input.harness !== "claude-code") throw new Error(`${input.harness} is experimental and unavailable in the product-ready run path`);
  if (typeof input.task !== "string" || input.task.length === 0 || input.task.length > 128_000) throw new TypeError("Mission Control task is invalid");
  const now = input.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const idleLimitMs = input.idleLimitMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(idleLimitMs) || idleLimitMs < 1 || idleLimitMs > 24 * 60 * 60_000) throw new TypeError("Mission Control idle limit is invalid");
  for (const [name, value] of [["cost", input.costLimitMicros], ["token", input.tokenLimit], ["context", input.contextLimit]] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new TypeError(`Mission Control ${name} limit is invalid`);
  }
  const restartCount = input.restartCount ?? 0;
  const restartLimit = input.restartLimit ?? 3;
  if (!Number.isSafeInteger(restartCount) || restartCount < 0 || !Number.isSafeInteger(restartLimit) || restartLimit < 0) throw new TypeError("Mission Control restart limit is invalid");
  const restartLoop = restartCount > restartLimit;
  const attentionLimits = {
    ...(input.costLimitMicros === undefined ? {} : { costLimitMicros: input.costLimitMicros }),
    ...(input.tokenLimit === undefined ? {} : { tokenLimit: input.tokenLimit }),
    ...(input.contextLimit === undefined ? {} : { contextLimit: input.contextLimit }),
  };
  const hasAttentionLimits = Object.keys(attentionLimits).length > 0;
  const observe = input.observeWorkspace ?? observeGitWorkspace;
  const before = await observe(input.cwd);
  const processFactory = input.processFactory ?? createOperatorHarnessProcessV1();
  const process = await processFactory.launch({ harness: input.harness, cwd: input.cwd, prompt: input.task, ...(input.resumeIdentity ? { resume: true, sessionId: input.resumeIdentity } : {}) });
  const journal = await createMissionControlJournalV1({ root: input.root });
  const evidenceStore = await createMissionEvidenceStoreV1({ root: input.root });
  const resumeStore = await createMissionResumeStoreV1({ root: input.root });
  const missionId = input.missionId ?? process.sessionId;
  const workspaceDigest = digest(path.resolve(input.cwd));
  let current = parseMissionControlMissionV1({
    v: "reelier.mission-control-mission/v1",
    missionId,
    workspaceDigest,
    harness: input.harness,
    harnessLifecycle: "running",
    outcomeLifecycle: "pending",
    attentionState: restartLoop ? "required" : "none",
    attentionReasons: restartLoop ? ["restart-loop"] : [],
    evidenceRefs: [],
    processOwnership: "reelier",
    imported: false,
    updatedAt: startedAt,
    startedAt,
    restartCount,
    ...(hasAttentionLimits ? { attentionLimits } : {}),
  });
  await journal.appendMission(current);
  const captureResumeIdentity = process.resumeIdentity.then(async (resumeIdentity) => {
    if (!resumeIdentity) return;
    await resumeStore.save({ missionId, harness: input.harness, resumeIdentity, workspaceDigest });
  });
  let terminal: "exited" | "failed" | null = null;
  const errorSignatureCounts = new Map<string, number>();
  let repeatedToolError = false;
  let wallClockExceeded = false;
  let usage: OperatorHarnessEventV1["usage"];
  const usageAttention = new Set<string>();
  const control = await createMissionProcessControlV1({ root: input.root, missionId, stop: process.stop });
  try {
    const iterator = process.events[Symbol.asyncIterator]();
    while (true) {
      const pending = iterator.next();
      const waited = await waitForEventOrIdle(pending, idleLimitMs);
      let next: NextHarnessEventV1;
      if (waited.kind === "idle") {
        current = parseMissionControlMissionV1({ ...current, harnessLifecycle: "stalled", attentionState: restartLoop ? "required" : "watching", attentionReasons: [...(restartLoop ? ["restart-loop"] : []), "idle-threshold-exceeded"], updatedAt: now() });
        await journal.appendMission(current);
        next = await pending as NextHarnessEventV1;
      } else {
        next = waited.result as NextHarnessEventV1;
      }
      if (next.done) break;
      const event = next.value;
      if (event.usage) {
        usage = event.usage;
        const exposedTokens = event.usage.inputTokens + event.usage.outputTokens;
        if (input.costLimitMicros !== undefined && event.usage.totalCostMicros !== undefined && event.usage.totalCostMicros > input.costLimitMicros) usageAttention.add("cost-ceiling-exceeded");
        if (input.tokenLimit !== undefined && exposedTokens > input.tokenLimit) usageAttention.add("token-ceiling-exceeded");
        if (input.contextLimit !== undefined && event.usage.contextUnits > input.contextLimit) usageAttention.add("context-growth-threshold-exceeded");
      }
      if (event.kind === "timed-out") {
        terminal = "failed";
        wallClockExceeded = true;
      } else if (event.kind === "failed") {
        terminal = "failed";
        if (event.payloadDigest) {
          const count = (errorSignatureCounts.get(event.payloadDigest) ?? 0) + 1;
          errorSignatureCounts.set(event.payloadDigest, count);
          if (count >= 3) {
            repeatedToolError = true;
            current = parseMissionControlMissionV1({ ...current, harnessLifecycle: "running", attentionState: restartLoop ? "required" : "watching", attentionReasons: [...(restartLoop ? ["restart-loop"] : []), "repeated-tool-error"], updatedAt: now() });
            await journal.appendMission(current);
          }
        }
      }
      else if (event.kind === "completed" && terminal !== "failed") terminal = "exited";
      else {
        const liveReasons = [...(restartLoop ? ["restart-loop"] : []), ...usageAttention];
        current = parseMissionControlMissionV1({ ...current, harnessLifecycle: "running", attentionState: liveReasons.some((reason) => reason === "restart-loop" || reason === "cost-ceiling-exceeded" || reason === "token-ceiling-exceeded") ? "required" : liveReasons.length ? "watching" : "none", attentionReasons: liveReasons, ...(usage ? { usage } : {}), updatedAt: now() });
        await journal.appendMission(current);
      }
    }
  } finally {
    await control.close();
    await captureResumeIdentity;
  }
  const after = await observe(input.cwd);
  const evidenceRefs: string[] = [];
  if (terminal === "exited" && before && after && before.resultDigest !== after.resultDigest) {
    evidenceRefs.push((await evidenceStore.publish({ kind: "git-head", subjectDigest: after.subjectDigest, resultDigest: after.resultDigest, status: "observed", observedAt: now() })).evidenceRef);
  }
  const harnessLifecycle = terminal ?? "unreachable";
  const outcomeLifecycle = deriveOutcomeLifecycleV1({ harnessLifecycle, localEvidenceCount: evidenceRefs.length });
  const durableAttention = [...(restartLoop ? ["restart-loop"] : []), ...usageAttention];
  const attentionReasons = outcomeLifecycle === "completed-unverified"
    ? [...durableAttention, "harness-exited-without-evidence"]
    : outcomeLifecycle === "failed"
      ? [...durableAttention, "harness-failed", ...(wallClockExceeded ? ["wall-clock-limit-exceeded"] : []), ...(repeatedToolError ? ["repeated-tool-error"] : [])]
      : harnessLifecycle === "unreachable"
        ? [...durableAttention, "harness-unreachable"]
        : [...durableAttention];
  current = parseMissionControlMissionV1({
    ...current,
    harnessLifecycle,
    outcomeLifecycle,
    attentionState: attentionReasons.length === 0 ? "none" : outcomeLifecycle === "failed" || harnessLifecycle === "unreachable" || attentionReasons.some((reason) => reason === "restart-loop" || reason === "cost-ceiling-exceeded" || reason === "token-ceiling-exceeded") ? "required" : "watching",
    attentionReasons,
    evidenceRefs,
    ...(usage ? { usage } : {}),
    updatedAt: now(),
  });
  await journal.appendMission(current);
  return current;
}

const CONTINUATION_INSTRUCTION = "Continue the previous task. Inspect current state before acting and do not repeat completed external actions.";

export async function resumeMissionControlMissionV1(input: Readonly<{
  root: string;
  cwd: string;
  missionId: string;
  now?: () => string;
  processFactory?: ProcessFactoryV1;
  observeWorkspace?: (cwd: string) => Promise<WorkspaceObservationV1 | null>;
}>): Promise<MissionControlMissionV1> {
  const mission = (await (await createMissionControlJournalV1({ root: input.root })).reconstruct()).find((item) => item.missionId === input.missionId);
  if (!mission) throw new Error("mission is not present in the local Mission Control journal");
  if (mission.harness !== "codex" && mission.harness !== "claude-code") throw new Error("mission harness does not support verified resume");
  const resume = await (await createMissionResumeStoreV1({ root: input.root })).load(input.missionId);
  if (!resume || resume.harness !== mission.harness || resume.workspaceDigest !== mission.workspaceDigest) throw new Error("captured harness-native resume identity is unavailable or crossed");
  if (digest(path.resolve(input.cwd)) !== mission.workspaceDigest) throw new Error("mission resume workspace does not match the current repository");
  return runMissionControlMissionV1({
    root: input.root,
    cwd: input.cwd,
    harness: mission.harness,
    task: CONTINUATION_INSTRUCTION,
    missionId: mission.missionId,
    resumeIdentity: resume.resumeIdentity,
    restartCount: (mission.restartCount ?? 0) + 1,
    ...(mission.attentionLimits?.costLimitMicros === undefined ? {} : { costLimitMicros: mission.attentionLimits.costLimitMicros }),
    ...(mission.attentionLimits?.tokenLimit === undefined ? {} : { tokenLimit: mission.attentionLimits.tokenLimit }),
    ...(mission.attentionLimits?.contextLimit === undefined ? {} : { contextLimit: mission.attentionLimits.contextLimit }),
    ...(input.now ? { now: input.now } : {}),
    ...(input.processFactory ? { processFactory: input.processFactory } : {}),
    ...(input.observeWorkspace ? { observeWorkspace: input.observeWorkspace } : {}),
  });
}
