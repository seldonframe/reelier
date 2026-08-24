import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMissionControlJournalV1 } from "../../src/operator/mission-journal.js";
import type { MissionControlMissionV1 } from "../../src/operator/mission-control.js";

function mission(updatedAt: string, lifecycle: MissionControlMissionV1["harnessLifecycle"]): MissionControlMissionV1 {
  return {
    v: "reelier.mission-control-mission/v1",
    missionId: "mission-1",
    workspaceDigest: `sha256:${"a".repeat(64)}`,
    harness: "codex",
    harnessLifecycle: lifecycle,
    outcomeLifecycle: lifecycle === "exited" ? "completed-unverified" : "pending",
    attentionState: lifecycle === "exited" ? "watching" : "none",
    attentionReasons: lifecycle === "exited" ? ["harness-exited-without-evidence"] : [],
    evidenceRefs: [],
    processOwnership: "reelier",
    imported: false,
    updatedAt,
  };
}

test("append-only mission events reconstruct the same latest state after restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-journal-"));
  try {
    const journalA = await createMissionControlJournalV1({ root });
    await journalA.appendMission(mission("2026-08-24T12:00:00.000Z", "running"));
    await journalA.appendMission(mission("2026-08-24T12:01:00.000Z", "exited"));

    const journalB = await createMissionControlJournalV1({ root });
    assert.deepEqual(await journalB.reconstruct(), [mission("2026-08-24T12:01:00.000Z", "exited")]);
    const lines = (await readFile(path.join(root, ".reelier", "operator", "events.jsonl"), "utf8")).trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(lines.join("\n").includes("prompt"), false);
    assert.equal(lines.join("\n").includes("access_token"), false);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, ".reelier", "operator", "missions", "mission-1.json"), "utf8")), mission("2026-08-24T12:01:00.000Z", "exited"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restart reclaims only a closed journal lock whose owning process is gone", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-journal-dead-lock-"));
  const lockDirectory = path.join(root, ".reelier", "operator", "locks");
  const lockPath = path.join(lockDirectory, "journal.lock");
  try {
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({
      v: "reelier.mission-control-lock/v1",
      pid: 99_999_999,
      nonce: "d".repeat(64),
      acquiredAt: "2026-08-24T12:00:00.000Z",
    })}\n`, "utf8");
    const journal = await createMissionControlJournalV1({ root });
    assert.deepEqual(await journal.reconstruct(), []);
    await assert.rejects(() => readFile(lockPath, "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a truncated or hostile event journal fails closed instead of fabricating state", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-journal-bad-"));
  try {
    const journal = await createMissionControlJournalV1({ root });
    await journal.appendMission(mission("2026-08-24T12:00:00.000Z", "running"));
    const eventPath = path.join(root, ".reelier", "operator", "events.jsonl");
    await writeFile(eventPath, `${await readFile(eventPath, "utf8")}{"v":`, "utf8");
    await assert.rejects(() => journal.reconstruct(), /journal.*invalid|truncated/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("duplicate journal event identities fail closed instead of replaying ambiguous history", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-journal-duplicate-"));
  try {
    const journal = await createMissionControlJournalV1({ root });
    await journal.appendMission(mission("2026-08-24T12:00:00.000Z", "running"));
    const eventPath = path.join(root, ".reelier", "operator", "events.jsonl");
    const first = await readFile(eventPath, "utf8");
    await writeFile(eventPath, `${first}${first}`, "utf8");
    await assert.rejects(() => journal.reconstruct(), /duplicate.*event/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a linked workspace root is refused before journal creation", async (context) => {
  const parent = await mkdtemp(path.join(tmpdir(), "reelier-mission-journal-link-"));
  const target = path.join(parent, "target");
  const linked = path.join(parent, "linked");
  try {
    await mkdir(target);
    try {
      await symlink(target, linked, process.platform === "win32" ? "junction" : "dir");
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "EPERM") return context.skip("symlink creation is unavailable");
      throw error;
    }
    await assert.rejects(() => createMissionControlJournalV1({ root: linked }), /linked|symlink|root/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("a linked .reelier directory cannot redirect journal writes outside the workspace", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-journal-nested-link-"));
  const outside = await mkdtemp(path.join(tmpdir(), "reelier-mission-journal-outside-"));
  try {
    try {
      await symlink(outside, path.join(root, ".reelier"), process.platform === "win32" ? "junction" : "dir");
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "EPERM") return context.skip("symlink creation is unavailable");
      throw error;
    }
    const journal = await createMissionControlJournalV1({ root });
    await assert.rejects(() => journal.appendMission(mission("2026-08-24T12:00:00.000Z", "running")), /linked|symlink|operator root/i);
    await assert.rejects(() => readFile(path.join(outside, "operator", "events.jsonl"), "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
