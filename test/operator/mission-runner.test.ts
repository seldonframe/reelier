import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMissionControlMissionV1 } from "../../src/operator/mission-runner.js";
import { createMissionControlJournalV1 } from "../../src/operator/mission-journal.js";
import type { OperatorHarnessEventV1, OperatorHarnessProcessV1 } from "../../src/operator/process.js";

function fakeProcess(events: readonly OperatorHarnessEventV1[]): { launch(): Promise<OperatorHarnessProcessV1> } {
  return {
    async launch() {
      return {
        sessionId: "owned-session",
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
