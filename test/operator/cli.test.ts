import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdOperator, type CmdOperatorOverrides, type ParsedArgs } from "../../src/cli.js";
import { initializeOperatorWorkspaceV1 } from "../../src/operator/workspace.js";
import { createOperatorSessionStoreV1 } from "../../src/operator/session-store.js";
import { createMissionControlJournalV1 } from "../../src/operator/mission-journal.js";
import { stageManagedUpgradeTargetBundleV1 } from "../../src/operator/managed-upgrade-target-store.js";

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

test("operator review stays local and accountless without exposing local prompts or a Cloud nag", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-review-"));
  const previous = process.cwd();
  const originalLog = console.log;
  const output: string[] = [];
  try {
    process.chdir(root);
    await (await createMissionControlJournalV1({ root })).appendMission({
      v: "reelier.mission-control-mission/v1",
      missionId: "mission-review",
      workspaceDigest: `sha256:${"a".repeat(64)}`,
      harness: "codex",
      harnessLifecycle: "exited",
      outcomeLifecycle: "completed-unverified",
      attentionState: "watching",
      attentionReasons: ["harness-exited-without-evidence"],
      evidenceRefs: [],
      processOwnership: "reelier",
      imported: false,
      updatedAt: "2026-08-24T12:00:00.000Z",
    });
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    assert.equal(await cmdOperator({ positional: ["review"], flags: new Set(), vars: {}, wraps: [], opts: {}, fails: [] }), 0);
    assert.match(output.join("\n"), /mission-review\tcodex\texited\tcompleted-unverified\twatching/);
    assert.match(output.join("\n"), /Local review: 1 mission; 1 needs attention/);
    assert.doesNotMatch(output.join("\n"), /https?:\/\/|pricing|upgrade|dashboard|prompt|request-cli/i);
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
    const resumed: string[] = [];
    assert.equal(await cmdOperator({ positional: ["resume", "mission-native"], flags: new Set(), vars: {}, wraps: [], opts: {}, fails: [] }, {
      cwd: root,
      home: root,
      resumeMission: async (input) => {
        resumed.push(input.missionId);
        return { v: "reelier.mission-control-mission/v1", missionId: input.missionId, workspaceDigest: `sha256:${"a".repeat(64)}`, harness: "codex", harnessLifecycle: "exited", outcomeLifecycle: "completed-unverified", attentionState: "watching", attentionReasons: ["harness-exited-without-evidence"], evidenceRefs: [], processOwnership: "reelier", imported: false, updatedAt: "2026-08-24T12:00:00.000Z" };
      },
    }), 0);
    assert.deepEqual(resumed, ["mission-native"]);
    assert.match(output.join("\n"), /Resumed mission: mission-native/);
    output.length = 0;
    assert.equal(await cmdOperator({ positional: ["resume", "mission-unknown"], flags: new Set(), vars: {}, wraps: [], opts: {}, fails: [] }, { cwd: root, home: root }), 1);
    assert.match(output.join("\n"), /captured harness-native resume identity/i);
  } finally { console.log = originalLog; console.error = originalError; await rm(root, { recursive: true, force: true }); }
});

test("operator autopilot binds an exact manifest to an existing mission and opens only the returned handoff", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-autopilot-"));
  const candidate = Buffer.from("exact candidate bytes", "utf8");
  const artifactDigest = `sha256:${createHash("sha256").update(candidate).digest("hex")}`;
  const originalLog = console.log;
  const output: string[] = [];
  const opened: string[] = [];
  const waited: string[] = [];
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
    const targetManifest = {
      version: "reelier.managed-upgrade-target-manifest/v2",
      missionRef: "mission-autopilot",
      repository: "fixlyai/reelier-beta",
      githubActions: ["github_release_candidate_publish_v1", "github_release_pr_ensure_v1", "github_release_pr_merge_v1"],
      linearTarget: { workspaceId: "workspace", teamId: "team", projectId: "project", issueIds: ["issue-1", "issue-2"] },
      linearActions: ["linear_evidence_comment_v1", "linear_status_transition_v1", "linear_only_evidence_comment_v1", "linear_only_status_transition_v1"],
      maximumWrites: 7,
      expiresAt: "2026-08-24T12:10:00.000Z",
      artifactDigest,
      authority: { github: { repository: "fixlyai/reelier-beta", baseBranch: "main", baseSha: "a".repeat(40), headBranch: "reelier/mission-autopilot", headSha: "b".repeat(40), candidateDigest: artifactDigest, workflowPath: ".github/workflows/ci.yml", workflowDigest: `sha256:${"c".repeat(64)}`, requiredChecks: ["test"], postMergeTreeSha: "d".repeat(40) }, linear: { githubLinear: { workspace: "workspace", team: "team", project: "project", issue: "issue-1", preStatus: "In Progress", targetStatus: "Done", commentMarker: "reelier:composite", evidenceUrl: "https://www.reelier.com/r/one", evidenceContentDigest: `sha256:${"e".repeat(64)}` }, linearOnly: { workspace: "workspace", team: "team", project: "project", issue: "issue-2", preStatus: "Todo", targetStatus: "Done", commentMarker: "reelier:linear", evidenceUrl: "https://www.reelier.com/r/two", evidenceContentDigest: `sha256:${"f".repeat(64)}` } } },
    } as const;
    await stageManagedUpgradeTargetBundleV1({ root, operation: "github_release_pr_merge_v1", targetManifest, artifactBytes: candidate, seen: new Set() });
    console.log = (...values: unknown[]) => output.push(values.join(" "));
    assert.equal(await cmdOperator({ positional: ["autopilot", "mission-autopilot"], flags: new Set(), vars: {}, wraps: [], opts: {}, fails: [] }, {
      cwd: root,
      home: root,
      createAutopilotHandoff: async (input) => {
        handoffInput = input;
        return { browserUrl: "https://www.reelier.com/autopilot?mission=mission-autopilot", pollSecret: "p".repeat(43), intent: {} as never };
      },
      waitForAutopilotReady: async input => { waited.push(input.missionRef); return { status: "ready", agentRef: "agent-opaque", configurationDigest: `sha256:${"c".repeat(64)}` }; },
      openBrowser: (url) => opened.push(url),
      now: () => new Date("2026-08-24T12:00:00.000Z"),
    }), 0);
    assert.equal(handoffInput?.missionRef, "mission-autopilot");
    assert.deepEqual(handoffInput?.localEvidenceRefs, [`sha256:${"b".repeat(64)}`]);
    assert.deepEqual(Buffer.from(handoffInput!.artifactBytes!), candidate);
    assert.deepEqual(opened, ["https://www.reelier.com/autopilot?mission=mission-autopilot"]);
    assert.deepEqual(waited, ["mission-autopilot"]);
    assert.match(output.join("\n"), /Finish this mission without supervising the merge/);
    assert.match(output.join("\n"), /Autopilot is ready for this mission/);
    assert.doesNotMatch(output.join("\n"), /workspace|project|issue|fixlyai/);
  } finally {
    console.log = originalLog;
    await rm(root, { recursive: true, force: true });
  }
});

test("operator benchmark records closed runs and exports only the signed redacted comparison", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-operator-benchmark-"));
  const originalLog = console.log;
  const output: string[] = [];
  const digest = `sha256:${"a".repeat(64)}`;
  const makeRun = (mode: "native" | "reelier", milliseconds: number) => ({
    version: "reelier.autonomy-benchmark-run/v1",
    benchmarkId: `customer-1-${mode}`,
    workloadDigest: digest,
    mode,
    harness: "codex",
    reconciledOutcomeRefs: [`${mode}-outcome-1`],
    attentionEvents: [{ version: "reelier.human-attention-event/v1", eventId: `${mode}-review`, benchmarkId: `customer-1-${mode}`, kind: "review", startedAt: "2026-08-24T12:00:00.000Z", endedAt: new Date(Date.parse("2026-08-24T12:00:00.000Z") + milliseconds).toISOString(), activeMilliseconds: milliseconds, source: mode === "native" ? "baseline-observer" : "operator" }],
    duplicateWrites: 0,
    credentialDisclosures: 0,
    falseVerifiedOutcomes: 0,
    unresolvedOutcomes: 0,
    startedAt: "2026-08-24T12:00:00.000Z",
    endedAt: "2026-08-24T13:00:00.000Z",
  });
  try {
    const nativeFile = path.join(root, "native.json"), reelierFile = path.join(root, "reelier.json"), bundleFile = path.join(root, "bundle.json");
    await writeFile(nativeFile, JSON.stringify(makeRun("native", 600_000)));
    await writeFile(reelierFile, JSON.stringify(makeRun("reelier", 60_000)));
    console.log = (...values: unknown[]) => output.push(values.join(" "));
    assert.equal(await cmdOperator({ positional: ["benchmark", "record"], flags: new Set(), vars: {}, wraps: [], opts: { input: nativeFile }, fails: [] }, { cwd: root, home: root }), 0);
    assert.equal(await cmdOperator({ positional: ["benchmark", "record"], flags: new Set(), vars: {}, wraps: [], opts: { input: reelierFile }, fails: [] }, { cwd: root, home: root }), 0);
    assert.equal(await cmdOperator({ positional: ["benchmark", "export"], flags: new Set(), vars: {}, wraps: [], opts: { native: "customer-1-native", reelier: "customer-1-reelier", out: bundleFile }, fails: [] }, { cwd: root, home: root }), 0);
    const bundle = JSON.parse(await readFile(bundleFile, "utf8")) as Record<string, unknown>;
    assert.equal((bundle.comparison as { improvement: number }).improvement, 10);
    assert.deepEqual(Object.keys(bundle).sort(), ["bundleDigest", "comparison", "harness", "nativeRunDigest", "reelierRunDigest", "signature", "version", "workloadDigest"].sort());
    assert.doesNotMatch(JSON.stringify(bundle), /attentionEvents|reconciledOutcomeRefs|customer-1-native|customer-1-reelier/);
    assert.match(output.join("\n"), /Benchmark recorded: customer-1-native/);
    assert.match(output.join("\n"), /Matched benchmark exported/);
  } finally {
    console.log = originalLog;
    await rm(root, { recursive: true, force: true });
  }
});
