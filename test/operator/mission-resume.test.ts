import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMissionResumeStoreV1 } from "../../src/operator/mission-resume.js";

test("native resume identities persist as closed mission and workspace-bound records", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-resume-"));
  try {
    const store = await createMissionResumeStoreV1({ root });
    const record = await store.save({ missionId: "mission-1", harness: "codex", resumeIdentity: "01a01530-38b5-7831-8309-5d61e42408c5", workspaceDigest: `sha256:${"a".repeat(64)}` });
    assert.deepEqual(await (await createMissionResumeStoreV1({ root })).load("mission-1"), record);
    const bytes = await readFile(path.join(root, ".reelier", "operator", "resume", "mission-1.json"), "utf8");
    assert.doesNotMatch(bytes, /prompt|reasoning|model|credential|provider/i);
    await assert.rejects(() => store.save({ missionId: "mission-1", harness: "codex", resumeIdentity: "different", workspaceDigest: `sha256:${"a".repeat(64)}` }), /conflict/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resume records reject extra fields and unknown mission identities", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-resume-refuse-"));
  try {
    const store = await createMissionResumeStoreV1({ root });
    await assert.rejects(() => store.save({ missionId: "../escape", harness: "codex", resumeIdentity: "thread", workspaceDigest: `sha256:${"a".repeat(64)}` }), /mission/i);
    assert.equal(await store.load("missing"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
