import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdOperator, type CmdOperatorOverrides, type ParsedArgs } from "../../src/cli.js";
import { initializeOperatorWorkspaceV1 } from "../../src/operator/workspace.js";
import { createOperatorSessionStoreV1 } from "../../src/operator/session-store.js";
import { createMissionControlJournalV1 } from "../../src/operator/mission-journal.js";

const args = (subcommand: string): ParsedArgs => ({ positional: [subcommand], flags: new Set(), vars: {}, wraps: [], opts: {}, fails: [] });

test("operator status is explicit before initialization and succeeds after local state exists", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-cli-"));
  const previous = process.cwd();
  try {
    process.chdir(root);
    assert.equal(await cmdOperator(args("status")), 1);
    await initializeOperatorWorkspaceV1({ root, selectedHarnesses: ["codex"], now: "2026-08-21T00:00:00.000Z" });
    assert.equal(await cmdOperator(args("status")), 0);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test("operator status reads a persisted session and operator list exposes redacted sessions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-cli-sessions-"));
  const previous = process.cwd();
  const originalLog = console.log;
  const output: string[] = [];
  try {
    process.chdir(root);
    const store = createOperatorSessionStoreV1({ root, now: () => "2026-08-21T00:00:00.000Z" });
    await store.save({
      v: "reelier.operator-session/v1",
      sessionId: "session-cli",
      harness: "codex",
      requestId: "request-cli",
      promptDigest: `sha256:${"b".repeat(64)}`,
      harnessLifecycle: "completed",
      cellVerdict: "accepted",
      cellLifecycle: "reconciled",
      receiptRef: "receipt-cli",
      updatedAt: "2026-08-21T00:00:00.000Z",
    });
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    assert.equal(await cmdOperator({ positional: ["status", "session-cli"], flags: new Set(), vars: {}, wraps: [], opts: {}, fails: [] }), 0);
    assert.equal(await cmdOperator({ positional: ["list"], flags: new Set(), vars: {}, wraps: [], opts: {}, fails: [] }), 0);
    assert.match(output.join("\n"), /session-cli/);
    assert.doesNotMatch(output.join("\n"), /prompt|request-cli/);
  } finally {
    console.log = originalLog;
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test("operator review prints the Cloud review surface without exposing local prompts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-review-"));
  const previous = process.cwd();
  const originalLog = console.log;
  const output: string[] = [];
  try {
    process.chdir(root);
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    assert.equal(await cmdOperator({ positional: ["review"], flags: new Set(), vars: {}, wraps: [], opts: {}, fails: [] }), 0);
    assert.match(output.join("\n"), /dashboard\/outcomes/);
    assert.match(output.join("\n"), /Verified means reconciled/);
    assert.doesNotMatch(output.join("\n"), /prompt|request-cli/);
  } finally {
    console.log = originalLog;
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test("operator open launches the detached loopback board and import reports current-repository missions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-open-"));
  const originalLog = console.log;
  const output: string[] = [];
  let launched = 0;
  const overrides: CmdOperatorOverrides = {
    cwd: root,
    home: root,
    launchBoard: async () => {
      launched += 1;
      return { origin: "http://127.0.0.1:43111", url: `http://127.0.0.1:43111/#${"c".repeat(64)}`, pid: 4321, expiresAt: "2026-08-24T20:00:00.000Z" };
    },
    initialize: async () => ({
      workspace: await initializeOperatorWorkspaceV1({ root, selectedHarnesses: ["codex"], now: "2026-08-24T12:00:00.000Z" }),
      harnesses: [],
      missionCount: 3,
      currentWorkspaceMissionCount: 2,
      observedOnly: [{ harness: "cursor", sessions: 1, reason: "history-observed-control-unverified" }],
      next: ["run-local-cell", "review-authority"],
    }),
  };
  try {
    console.log = (...values: unknown[]) => output.push(values.join(" "));
    assert.equal(await cmdOperator(args("init"), overrides), 0);
    assert.equal(launched, 1);
    assert.match(output.join("\n"), /Mission Control: http:\/\/127\.0\.0\.1:43111/);
    output.length = 0;
    assert.equal(await cmdOperator(args("open"), overrides), 0);
    assert.equal(launched, 2);
    assert.match(output.join("\n"), /Mission Control: http:\/\/127\.0\.0\.1:43111/);
    output.length = 0;
    assert.equal(await cmdOperator(args("import"), overrides), 0);
    assert.match(output.join("\n"), /Imported missions: 3 \(2 current repository\)/);
    assert.match(output.join("\n"), /Cursor: 1 observed-only/);
  } finally {
    console.log = originalLog;
    await rm(root, { recursive: true, force: true });
  }
});

test("operator list and status prefer truthful Mission Control state over legacy session verdicts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-cli-missions-"));
  const originalLog = console.log;
  const output: string[] = [];
  try {
    await (await createMissionControlJournalV1({ root })).appendMission({
      v: "reelier.mission-control-mission/v1",
      missionId: "mission-cli",
      workspaceDigest: `sha256:${"e".repeat(64)}`,
      harness: "claude-code",
      harnessLifecycle: "exited",
      outcomeLifecycle: "completed-unverified",
      attentionState: "required",
      attentionReasons: ["completion-claim-unverified"],
      evidenceRefs: [],
      processOwnership: "external",
      imported: true,
      updatedAt: "2026-08-24T12:00:00.000Z",
    });
    console.log = (...values: unknown[]) => output.push(values.join(" "));
    assert.equal(await cmdOperator({ ...args("list") }, { cwd: root, home: root }), 0);
    assert.match(output.join("\n"), /mission-cli\tclaude-code\texited\tcompleted-unverified\trequired/);
    output.length = 0;
    assert.equal(await cmdOperator({ positional: ["status", "mission-cli"], flags: new Set(), vars: {}, wraps: [], opts: {}, fails: [] }, { cwd: root, home: root }), 0);
    assert.match(output.join("\n"), /Outcome: completed-unverified/);
    assert.match(output.join("\n"), /Attention: required \(completion-claim-unverified\)/);
    assert.doesNotMatch(output.join("\n"), /Outcome: reconciled|prompt|workspaceDigest/i);
  } finally {
    console.log = originalLog;
    await rm(root, { recursive: true, force: true });
  }
});

test("operator run sends the task only to the harness runner and prints truthful local completion", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-cli-run-"));
  const originalLog = console.log;
  const output: string[] = [];
  const secretTask = "SECRET RUN TASK";
  let receivedTask = "";
  try {
    console.log = (...values: unknown[]) => output.push(values.join(" "));
    const result = await cmdOperator({ positional: ["run", secretTask], flags: new Set(), vars: {}, wraps: [], opts: { harness: "codex" }, fails: [] }, {
      cwd: root,
      home: root,
      runMission: async (input) => {
        receivedTask = input.task;
        return {
          v: "reelier.mission-control-mission/v1",
          missionId: "mission-run",
          workspaceDigest: `sha256:${"a".repeat(64)}`,
          harness: "codex",
          harnessLifecycle: "exited",
          outcomeLifecycle: "locally-observed",
          attentionState: "none",
          attentionReasons: [],
          evidenceRefs: [`sha256:${"b".repeat(64)}`],
          processOwnership: "reelier",
          imported: false,
          updatedAt: "2026-08-24T12:00:00.000Z",
        };
      },
    });
    assert.equal(result, 0);
    assert.equal(receivedTask, secretTask);
    assert.match(output.join("\n"), /Mission: mission-run/);
    assert.match(output.join("\n"), /Outcome: locally-observed/);
    assert.doesNotMatch(output.join("\n"), new RegExp(secretTask));
  } finally {
    console.log = originalLog;
    await rm(root, { recursive: true, force: true });
  }
});

test("operator stop delegates only the exact mission reference to the owned-process controller", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-cli-stop-"));
  const originalLog = console.log;
  const output: string[] = [];
  const stopped: string[] = [];
  try {
    console.log = (...values: unknown[]) => output.push(values.join(" "));
    assert.equal(await cmdOperator({ positional: ["stop", "mission-owned"], flags: new Set(), vars: {}, wraps: [], opts: {}, fails: [] }, {
      cwd: root,
      home: root,
      stopMission: async (input) => {
        stopped.push(input.missionId);
        return { status: "stopped", missionId: input.missionId };
      },
    }), 0);
    assert.deepEqual(stopped, ["mission-owned"]);
    assert.deepEqual(output, ["Stopped Reelier-owned mission: mission-owned"]);
  } finally {
    console.log = originalLog;
    await rm(root, { recursive: true, force: true });
  }
});

test("operator doctor is local and resume refuses without a captured harness-native identity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-cli-doctor-"));
  const originalLog = console.log, originalError = console.error;
  const output: string[] = [];
  try {
    console.log = (...values: unknown[]) => output.push(values.join(" "));
    console.error = (...values: unknown[]) => output.push(values.join(" "));
    assert.equal(await cmdOperator(args("doctor"), { cwd: root, home: root, doctor: async () => ({ status: "ready", accountRequired: false, cloudRequired: false, productReadyHarnesses: ["codex"], journalReadable: true }) }), 0);
    assert.match(output.join("\n"), /Local Mission Control: ready/);
    output.length = 0;
    assert.equal(await cmdOperator({ positional: ["resume", "mission-unknown"], flags: new Set(), vars: {}, wraps: [], opts: {}, fails: [] }, { cwd: root, home: root }), 1);
    assert.match(output.join("\n"), /captured harness-native resume identity/i);
  } finally { console.log = originalLog; console.error = originalError; await rm(root, { recursive: true, force: true }); }
});

test("operator autopilot binds an exact manifest to an existing mission and opens only the returned handoff", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-autopilot-"));
  const manifestPath = path.join(root, "autopilot-manifest.json");
  const originalLog = console.log;
  const output: string[] = [];
  const opened: string[] = [];
  let handoffInput: Parameters<NonNullable<CmdOperatorOverrides["createAutopilotHandoff"]>>[0] | undefined;
  try {
    await (await createMissionControlJournalV1({ root })).appendMission({
      v: "reelier.mission-control-mission/v1",
      missionId: "mission-autopilot",
      workspaceDigest: `sha256:${"a".repeat(64)}`,
      harness: "codex",
      harnessLifecycle: "exited",
      outcomeLifecycle: "locally-observed",
      attentionState: "none",
      attentionReasons: [],
      evidenceRefs: [`sha256:${"b".repeat(64)}`],
      processOwnership: "reelier",
      imported: false,
      updatedAt: "2026-08-24T12:00:00.000Z",
    });
    await writeFile(manifestPath, JSON.stringify({
      version: "reelier.managed-upgrade-target-manifest/v1",
      missionRef: "mission-autopilot",
      repository: "fixlyai/reelier-beta",
      githubActions: ["github_release_pr_merge_v1"],
      linearTarget: "workspace/project/issue",
      linearActions: ["linear_evidence_comment_v1", "linear_status_transition_v1"],
      maximumWrites: 3,
      expiresAt: "2026-08-24T12:10:00.000Z",
    }), "utf8");
    console.log = (...values: unknown[]) => output.push(values.join(" "));
    assert.equal(await cmdOperator({ positional: ["autopilot", "mission-autopilot"], flags: new Set(), vars: {}, wraps: [], opts: { manifest: manifestPath }, fails: [] }, {
      cwd: root,
      home: root,
      createAutopilotHandoff: async (input) => {
        handoffInput = input;
        return { browserUrl: "https://www.reelier.com/autopilot?mission=mission-autopilot", intent: {} as never };
      },
      openBrowser: (url) => opened.push(url),
      now: () => new Date("2026-08-24T12:00:00.000Z"),
    }), 0);
    assert.equal(handoffInput?.missionRef, "mission-autopilot");
    assert.deepEqual(handoffInput?.localEvidenceRefs, [`sha256:${"b".repeat(64)}`]);
    assert.deepEqual(opened, ["https://www.reelier.com/autopilot?mission=mission-autopilot"]);
    assert.match(output.join("\n"), /Finish this mission without supervising the merge/);
    assert.doesNotMatch(output.join("\n"), /workspace\/project\/issue|fixlyai/);
  } finally {
    console.log = originalLog;
    await rm(root, { recursive: true, force: true });
  }
});
