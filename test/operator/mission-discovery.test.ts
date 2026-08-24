import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverMissionControlV1, scanMissionControlSessionMetadataV1 } from "../../src/operator/mission-discovery.js";

test("Mission Control discovery scans bounded file metadata without replay-parsing transcripts", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "reelier-mission-metadata-home-"));
  try {
    const directory = path.join(home, ".codex", "sessions", "2026", "08", "24");
    await mkdir(directory, { recursive: true });
    const transcript = path.join(directory, "rollout-hostile.jsonl");
    await writeFile(transcript, "not replayable and never parsed by discovery\n".repeat(10_000));
    const result = await scanMissionControlSessionMetadataV1(home);
    assert.equal(result.length, 1);
    assert.deepEqual(Object.keys(result[0]!).sort(), ["mtimeMs", "path", "sourceId", "sourceLabel"]);
    assert.equal(result[0]!.sourceId, "codex");
    assert.equal(result[0]!.path, transcript);
    assert.equal("replayableCount" in result[0]!, false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("global Codex and Claude histories import as observe-only missions with the current repository first", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "reelier-mission-discovery-home-"));
  const current = path.join(home, "work", "current");
  const other = path.join(home, "work", "other");
  try {
    await mkdir(path.join(home, ".codex", "sessions", "2026", "08", "24"), { recursive: true });
    await mkdir(path.join(home, ".claude", "projects", "other"), { recursive: true });
    await mkdir(current, { recursive: true });
    await mkdir(other, { recursive: true });
    await writeFile(path.join(home, ".codex", "sessions", "2026", "08", "24", "rollout-current.jsonl"), [
      JSON.stringify({ timestamp: "2026-08-24T12:00:00.000Z", type: "session_meta", payload: { id: "codex-current", cwd: current } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: "SECRET PROMPT MUST NOT PERSIST" } }),
    ].join("\n") + "\n");
    await writeFile(path.join(home, ".claude", "projects", "other", "claude-other.jsonl"), [
      JSON.stringify({ type: "user", sessionId: "claude-other", cwd: other, message: { content: [{ type: "text", text: "ANOTHER SECRET" }] } }),
    ].join("\n") + "\n");

    const result = await discoverMissionControlV1({ cwd: current, home });
    assert.equal(result.missions.length, 2);
    assert.equal(result.missions[0]?.harness, "codex");
    assert.equal(result.missions[0]?.currentWorkspace, true);
    assert.equal(result.missions[0]?.mission.imported, true);
    assert.equal(result.missions[0]?.mission.processOwnership, "external");
    assert.equal(result.missions[0]?.mission.harnessLifecycle, "discovered");
    assert.equal(result.missions[0]?.mission.outcomeLifecycle, "unrequested");
    assert.equal(result.missions[1]?.harness, "claude-code");
    assert.equal(result.missions[1]?.currentWorkspace, false);
    assert.doesNotMatch(JSON.stringify(result), /SECRET PROMPT|ANOTHER SECRET|\.codex|\.claude/i);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("uncontrolled harness histories are reported as observed-only, never imported as controllable missions", async () => {
  const result = await discoverMissionControlV1({
    cwd: "C:\\workspace",
    home: "C:\\home",
    scan: async () => [{
      path: "C:\\home\\.cursor\\projects\\session.jsonl",
      totalToolCalls: 0,
      replayableCount: 0,
      skippedCount: 0,
      servers: [],
      malformedLines: 0,
      effects: { read: 0, "idempotent-write": 0, destructive: 0 },
      readOnly: false,
      unknownCount: 0,
      unknownTools: [],
      project: "project",
      mtimeMs: Date.parse("2026-08-24T12:00:00.000Z"),
      sourceId: "cursor",
      sourceLabel: "Cursor",
    }],
    readTranscript: async () => "SECRET",
  });
  assert.deepEqual(result.missions, []);
  assert.deepEqual(result.observedOnly, [{ harness: "cursor", sessions: 1, reason: "history-observed-control-unverified" }]);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|session\.jsonl/i);
});
