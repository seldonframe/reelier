import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resumeMissionControlMissionV1, runMissionControlMissionV1 } from "../../src/operator/mission-runner.js";
import { createMissionResumeStoreV1 } from "../../src/operator/mission-resume.js";
import { createMissionControlJournalV1 } from "../../src/operator/mission-journal.js";
import { stopOwnedMissionProcessV1 } from "../../src/operator/mission-process-control.js";
import type { OperatorHarnessEventV1, OperatorHarnessProcessV1 } from "../../src/operator/process.js";

function fakeProcess(events: readonly OperatorHarnessEventV1[]): { launch(): Promise<OperatorHarnessProcessV1> } {
  return {
    async launch() {
      return {
        sessionId: "owned-session",
        resumeIdentity: Promise.resolve("owned-session"),
        invocation: { executable: "codex", args: [], cwd: "fixture" },
        events: (async function* () { for (const event of events) yield event; })(),
        async stop() {},
      };
    },
  };
}

test("a Reelier-owned harness run becomes locally observed only from independent workspace evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-runner-"));
  const secretTask = "SECRET TASK BODY MUST NEVER PERSIST";
  let observations = 0;
  try {
    const result = await runMissionControlMissionV1({
      root,
      cwd: root,
      harness: "codex",
      task: secretTask,
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-24T12:00:00.000Z") + tick++ * 1000).toISOString(); })(),
      processFactory: fakeProcess([{ v: "reelier.operator-event/v1", harness: "codex", sessionId: "owned-session", kind: "completed", payloadDigest: `sha256:${"c".repeat(64)}`, at: "2026-08-24T12:00:01.000Z" }]),
      observeWorkspace: async () => ({ subjectDigest: `sha256:${"a".repeat(64)}`, resultDigest: `sha256:${observations++ === 0 ? "b".repeat(64) : "c".repeat(64)}` }),
    });
    assert.equal(result.harnessLifecycle, "exited");
    assert.equal(result.outcomeLifecycle, "locally-observed");
    assert.equal(result.processOwnership, "reelier");
    assert.equal(result.evidenceRefs.length, 1);
    assert.deepEqual(await (await createMissionControlJournalV1({ root })).reconstruct(), [result]);
    assert.deepEqual(await (await createMissionResumeStoreV1({ root })).load("owned-session"), {
      v: "reelier.mission-resume/v1",
      missionId: "owned-session",
      harness: "codex",
      resumeIdentity: "owned-session",
      workspaceDigest: result.workspaceDigest,
    });
    const operatorRoot = path.join(root, ".reelier", "operator");
    const files = [
      path.join(operatorRoot, "events.jsonl"),
      path.join(operatorRoot, "missions", "owned-session.json"),
      ...((await readdir(path.join(operatorRoot, "evidence"))).map((name) => path.join(operatorRoot, "evidence", name))),
    ];
    assert.doesNotMatch((await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n"), new RegExp(secretTask));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an exact captured identity resumes the same mission without persisting the continuation instruction", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-runner-resume-"));
  const workspaceDigest = `sha256:${createHash("sha256").update(path.resolve(root), "utf8").digest("hex")}`;
  const requests: unknown[] = [];
  try {
    await (await createMissionControlJournalV1({ root })).appendMission({ v: "reelier.mission-control-mission/v1", missionId: "native-thread", workspaceDigest, harness: "codex", harnessLifecycle: "stopped", outcomeLifecycle: "pending", attentionState: "watching", attentionReasons: ["stopped"], evidenceRefs: [], processOwnership: "reelier", imported: false, updatedAt: "2026-08-24T12:00:00.000Z" });
    await (await createMissionResumeStoreV1({ root })).save({ missionId: "native-thread", harness: "codex", resumeIdentity: "native-thread", workspaceDigest });
    const result = await resumeMissionControlMissionV1({
      root,
      cwd: root,
      missionId: "native-thread",
      processFactory: {
        async launch(request) {
          requests.push(request);
          return { sessionId: "native-thread", resumeIdentity: Promise.resolve("native-thread"), invocation: { executable: "codex", args: [], cwd: root }, events: (async function* () { yield { v: "reelier.operator-event/v1" as const, harness: "codex" as const, sessionId: "native-thread", kind: "completed" as const, payloadDigest: null, at: "2026-08-24T12:00:01.000Z" }; })(), async stop() {} };
        },
      },
      observeWorkspace: async () => null,
      now: () => "2026-08-24T12:00:01.000Z",
    });
    assert.equal(result.missionId, "native-thread");
    assert.deepEqual(requests, [{ harness: "codex", cwd: root, prompt: "Continue the previous task. Inspect current state before acting and do not repeat completed external actions.", resume: true, sessionId: "native-thread" }]);
    const bytes = await readFile(path.join(root, ".reelier", "operator", "events.jsonl"), "utf8");
    assert.doesNotMatch(bytes, /Continue the previous task/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a completed harness without independent evidence remains completed-unverified", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-runner-unverified-"));
  try {
    const result = await runMissionControlMissionV1({
      root,
      cwd: root,
      harness: "claude-code",
      task: "do local work",
      now: () => "2026-08-24T12:00:00.000Z",
      processFactory: fakeProcess([{ v: "reelier.operator-event/v1", harness: "claude-code", sessionId: "owned-session", kind: "completed", payloadDigest: null, at: "2026-08-24T12:00:01.000Z" }]),
      observeWorkspace: async () => null,
    });
    assert.equal(result.outcomeLifecycle, "completed-unverified");
    assert.deepEqual(result.attentionReasons, ["harness-exited-without-evidence"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("experimental harnesses cannot enter the product-ready run path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-runner-experimental-"));
  try {
    await assert.rejects(() => runMissionControlMissionV1({ root, cwd: root, harness: "grok-build", task: "work" }), /experimental|product-ready|unsupported/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a second CLI can stop an active Reelier-owned mission through its exact loopback control", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-runner-stop-"));
  let releaseStop!: () => void;
  const stopped = new Promise<void>((resolve) => { releaseStop = resolve; });
  try {
    const running = runMissionControlMissionV1({
      root,
      cwd: root,
      harness: "codex",
      task: "bounded task",
      processFactory: {
        async launch() {
          return {
            sessionId: "mission-stoppable",
            resumeIdentity: Promise.resolve("mission-stoppable"),
            invocation: { executable: "codex", args: [], cwd: root },
            events: (async function* () {
              yield { v: "reelier.operator-event/v1" as const, harness: "codex" as const, sessionId: "mission-stoppable", kind: "started" as const, payloadDigest: null, at: "2026-08-24T12:00:00.000Z" };
              await stopped;
              yield { v: "reelier.operator-event/v1" as const, harness: "codex" as const, sessionId: "mission-stoppable", kind: "failed" as const, payloadDigest: null, at: "2026-08-24T12:00:01.000Z" };
            })(),
            async stop() { releaseStop(); },
          };
        },
      },
      observeWorkspace: async () => null,
    });
    const descriptor = path.join(root, ".reelier", "operator", "processes", "mission-stoppable.json");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { await readFile(descriptor, "utf8"); break; } catch { await new Promise((resolve) => setTimeout(resolve, 5)); }
    }
    assert.deepEqual(await stopOwnedMissionProcessV1({ root, missionId: "mission-stoppable" }), { status: "stopped", missionId: "mission-stoppable" });
    const result = await running;
    assert.equal(result.harnessLifecycle, "failed");
    await assert.rejects(() => readFile(descriptor, "utf8"), /ENOENT/);
  } finally {
    releaseStop?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("a silent owned harness becomes stalled in the live journal and recovers on activity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-runner-stalled-"));
  let releaseActivity!: () => void;
  const activity = new Promise<void>((resolve) => { releaseActivity = resolve; });
  try {
    const running = runMissionControlMissionV1({
      root,
      cwd: root,
      harness: "codex",
      task: "bounded task",
      idleLimitMs: 10,
      processFactory: {
        async launch() {
          return {
            sessionId: "mission-silent",
            resumeIdentity: Promise.resolve("mission-silent"),
            invocation: { executable: "codex", args: [], cwd: root },
            events: (async function* () {
              yield { v: "reelier.operator-event/v1" as const, harness: "codex" as const, sessionId: "mission-silent", kind: "started" as const, payloadDigest: null, at: "2026-08-24T12:00:00.000Z" };
              await activity;
              yield { v: "reelier.operator-event/v1" as const, harness: "codex" as const, sessionId: "mission-silent", kind: "tool-completed" as const, payloadDigest: null, at: "2026-08-24T12:00:01.000Z" };
              yield { v: "reelier.operator-event/v1" as const, harness: "codex" as const, sessionId: "mission-silent", kind: "completed" as const, payloadDigest: null, at: "2026-08-24T12:00:02.000Z" };
            })(),
            async stop() {},
          };
        },
      },
      observeWorkspace: async () => null,
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-24T12:00:00.000Z") + tick++).toISOString(); })(),
    });
    let stalled;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      stalled = (await (await createMissionControlJournalV1({ root })).reconstruct())[0];
      if (stalled?.harnessLifecycle === "stalled") break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(stalled?.harnessLifecycle, "stalled");
    assert.equal(stalled?.attentionState, "watching");
    assert.deepEqual(stalled?.attentionReasons, ["idle-threshold-exceeded"]);
    releaseActivity();
    const completed = await running;
    assert.equal(completed.harnessLifecycle, "exited");
    assert.deepEqual(completed.attentionReasons, ["harness-exited-without-evidence"]);
  } finally {
    releaseActivity?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("repeated identical harness errors become a live attention reason without storing error text", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-runner-errors-"));
  let releaseCompletion!: () => void;
  const completion = new Promise<void>((resolve) => { releaseCompletion = resolve; });
  const signature = `sha256:${"e".repeat(64)}`;
  let running: ReturnType<typeof runMissionControlMissionV1> | undefined;
  try {
    running = runMissionControlMissionV1({
      root,
      cwd: root,
      harness: "codex",
      task: "bounded task",
      processFactory: {
        async launch() {
          return {
            sessionId: "mission-repeated-errors",
            resumeIdentity: Promise.resolve("mission-repeated-errors"),
            invocation: { executable: "codex", args: [], cwd: root },
            events: (async function* () {
              for (let index = 0; index < 3; index += 1) {
                yield { v: "reelier.operator-event/v1" as const, harness: "codex" as const, sessionId: "mission-repeated-errors", kind: "failed" as const, payloadDigest: signature, at: `2026-08-24T12:00:0${index}.000Z` };
              }
              await completion;
            })(),
            async stop() {},
          };
        },
      },
      observeWorkspace: async () => null,
    });
    let observed;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      observed = (await (await createMissionControlJournalV1({ root })).reconstruct())[0];
      if (observed?.attentionReasons.includes("repeated-tool-error")) break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(observed?.attentionState, "watching");
    assert.deepEqual(observed?.attentionReasons, ["repeated-tool-error"]);
    releaseCompletion();
    const terminal = await running;
    assert.equal(terminal.harnessLifecycle, "failed");
    assert.deepEqual(terminal.attentionReasons, ["harness-failed", "repeated-tool-error"]);
    assert.doesNotMatch(await readFile(path.join(root, ".reelier", "operator", "events.jsonl"), "utf8"), /bounded task/i);
  } finally {
    releaseCompletion?.();
    await running?.catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("a harness wall-clock timeout is named explicitly without treating it as an Outcome", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-runner-timeout-"));
  try {
    const result = await runMissionControlMissionV1({
      root,
      cwd: root,
      harness: "codex",
      task: "bounded task",
      processFactory: fakeProcess([{ v: "reelier.operator-event/v1", harness: "codex", sessionId: "owned-session", kind: "timed-out", payloadDigest: null, at: "2026-08-24T12:30:00.000Z" }]),
      observeWorkspace: async () => null,
    });
    assert.equal(result.harnessLifecycle, "failed");
    assert.equal(result.outcomeLifecycle, "failed");
    assert.equal(result.attentionState, "required");
    assert.deepEqual(result.attentionReasons, ["harness-failed", "wall-clock-limit-exceeded"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exposed usage drives configured attention ceilings without certifying or persisting model output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-runner-usage-"));
  try {
    const result = await runMissionControlMissionV1({
      root,
      cwd: root,
      harness: "codex",
      task: "private bounded task",
      costLimitMicros: 100_000,
      tokenLimit: 100,
      contextLimit: 100,
      now: () => "2026-08-24T12:00:00.000Z",
      processFactory: fakeProcess([
        { v: "reelier.operator-event/v1", harness: "codex", sessionId: "owned-session", kind: "tool-completed", payloadDigest: `sha256:${"d".repeat(64)}`, at: "2026-08-24T12:00:01.000Z", usage: { inputTokens: 90, cachedInputTokens: 0, outputTokens: 20, contextUnits: 110, totalCostMicros: 200_000 } },
        { v: "reelier.operator-event/v1", harness: "codex", sessionId: "owned-session", kind: "completed", payloadDigest: null, at: "2026-08-24T12:00:02.000Z" },
      ]),
      observeWorkspace: async () => null,
    });
    assert.equal(result.startedAt, "2026-08-24T12:00:00.000Z");
    assert.deepEqual(result.usage, { inputTokens: 90, cachedInputTokens: 0, outputTokens: 20, contextUnits: 110, totalCostMicros: 200_000 });
    assert.equal(result.outcomeLifecycle, "completed-unverified");
    assert.equal(result.attentionState, "required");
    assert.deepEqual(result.attentionReasons, ["cost-ceiling-exceeded", "token-ceiling-exceeded", "context-growth-threshold-exceeded", "harness-exited-without-evidence"]);
    assert.doesNotMatch(await readFile(path.join(root, ".reelier", "operator", "events.jsonl"), "utf8"), /private bounded task/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
