import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createMissionControlJournalV1 } from "./mission-journal.js";
import { createMissionEvidenceStoreV1 } from "./mission-evidence.js";
import { createOperatorHarnessProcessV1, type OperatorHarnessLaunchRequestV1, type OperatorHarnessProcessV1 } from "./process.js";
import { deriveOutcomeLifecycleV1, parseMissionControlMissionV1, type MissionControlMissionV1 } from "./mission-control.js";
import type { OperatorHarnessIdV1 } from "./harness.js";
import { createMissionProcessControlV1 } from "./mission-process-control.js";

const execFileAsync = promisify(execFile);
type WorkspaceObservationV1 = Readonly<{ subjectDigest: string; resultDigest: string }>;
type ProcessFactoryV1 = Readonly<{ launch(request: OperatorHarnessLaunchRequestV1): Promise<OperatorHarnessProcessV1> }>;

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
}>): Promise<MissionControlMissionV1> {
  if (input.harness !== "codex" && input.harness !== "claude-code") throw new Error(`${input.harness} is experimental and unavailable in the product-ready run path`);
  if (typeof input.task !== "string" || input.task.length === 0 || input.task.length > 128_000) throw new TypeError("Mission Control task is invalid");
  const now = input.now ?? (() => new Date().toISOString());
  const observe = input.observeWorkspace ?? observeGitWorkspace;
  const before = await observe(input.cwd);
  const processFactory = input.processFactory ?? createOperatorHarnessProcessV1();
  const process = await processFactory.launch({ harness: input.harness, cwd: input.cwd, prompt: input.task });
  const journal = await createMissionControlJournalV1({ root: input.root });
  const evidenceStore = await createMissionEvidenceStoreV1({ root: input.root });
  let current = parseMissionControlMissionV1({
    v: "reelier.mission-control-mission/v1",
    missionId: process.sessionId,
    workspaceDigest: digest(path.resolve(input.cwd)),
    harness: input.harness,
    harnessLifecycle: "running",
    outcomeLifecycle: "pending",
    attentionState: "none",
    attentionReasons: [],
    evidenceRefs: [],
    processOwnership: "reelier",
    imported: false,
    updatedAt: now(),
  });
  await journal.appendMission(current);
  let terminal: "exited" | "failed" | null = null;
  const control = await createMissionProcessControlV1({ root: input.root, missionId: process.sessionId, stop: process.stop });
  try {
    for await (const event of process.events) {
      if (event.kind === "failed") terminal = "failed";
      else if (event.kind === "completed" && terminal !== "failed") terminal = "exited";
    }
  } finally {
    await control.close();
  }
  const after = await observe(input.cwd);
  const evidenceRefs: string[] = [];
  if (terminal === "exited" && before && after && before.resultDigest !== after.resultDigest) {
    evidenceRefs.push((await evidenceStore.publish({ kind: "git-head", subjectDigest: after.subjectDigest, resultDigest: after.resultDigest, status: "observed", observedAt: now() })).evidenceRef);
  }
  const harnessLifecycle = terminal ?? "unreachable";
  const outcomeLifecycle = deriveOutcomeLifecycleV1({ harnessLifecycle, localEvidenceCount: evidenceRefs.length });
  const attentionReasons = outcomeLifecycle === "completed-unverified"
    ? ["harness-exited-without-evidence"]
    : outcomeLifecycle === "failed"
      ? ["harness-failed"]
      : harnessLifecycle === "unreachable"
        ? ["harness-unreachable"]
        : [];
  current = parseMissionControlMissionV1({
    ...current,
    harnessLifecycle,
    outcomeLifecycle,
    attentionState: attentionReasons.length === 0 ? "none" : outcomeLifecycle === "failed" || harnessLifecycle === "unreachable" ? "required" : "watching",
    attentionReasons,
    evidenceRefs,
    updatedAt: now(),
  });
  await journal.appendMission(current);
  return current;
}
