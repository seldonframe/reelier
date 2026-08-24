import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMissionControlBoardV1 } from "../../src/operator/mission-board.js";
import { createMissionEvidenceStoreV1 } from "../../src/operator/mission-evidence.js";
import { createMissionControlJournalV1 } from "../../src/operator/mission-journal.js";

const CAPABILITY = "c".repeat(64);

async function seed(root: string, ownership: "reelier" | "external", imported: boolean): Promise<void> {
  await (await createMissionControlJournalV1({ root })).appendMission({
    v: "reelier.mission-control-mission/v1",
    missionId: "mission-board",
    workspaceDigest: `sha256:${"a".repeat(64)}`,
    harness: "codex",
    harnessLifecycle: "running",
    outcomeLifecycle: "pending",
    attentionState: "none",
    attentionReasons: [],
    evidenceRefs: [],
    processOwnership: ownership,
    imported,
    updatedAt: "2026-08-24T12:00:00.000Z",
  });
}

test("the board binds to loopback and exposes no mission state without its fragment capability", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-board-"));
  await seed(root, "reelier", false);
  const board = await createMissionControlBoardV1({ root, capability: CAPABILITY, now: () => Date.parse("2026-08-24T12:00:00.000Z"), expiresAt: "2026-08-24T13:00:00.000Z" });
  try {
    assert.match(board.url, /^http:\/\/127\.0\.0\.1:\d+\/#c{64}$/);
    const shell = await fetch(board.origin);
    assert.equal(shell.status, 200);
    const html = await shell.text();
    assert.match(html, /Mission Control/);
    assert.doesNotMatch(html, /mission-board|https:\/\/|<script[^>]+src=/i);

    assert.equal((await fetch(`${board.origin}/api/state`)).status, 401);
    const authorized = await fetch(`${board.origin}/api/state`, { headers: { authorization: `Bearer ${CAPABILITY}` } });
    assert.equal(authorized.status, 200);
    const state = await authorized.json() as { missions: Array<{ missionId: string }> };
    assert.deepEqual(state.missions.map((mission) => mission.missionId), ["mission-board"]);
  } finally {
    await board.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("expired capabilities, foreign origins, and imported-session stop attempts fail closed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-board-refuse-"));
  await seed(root, "external", true);
  let stopCalls = 0;
  const board = await createMissionControlBoardV1({
    root,
    capability: CAPABILITY,
    now: () => Date.parse("2026-08-24T12:30:00.000Z"),
    expiresAt: "2026-08-24T13:00:00.000Z",
    stopMission: async () => { stopCalls += 1; },
  });
  try {
    const foreign = await fetch(`${board.origin}/api/actions/stop`, {
      method: "POST",
      headers: { authorization: `Bearer ${CAPABILITY}`, origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ missionId: "mission-board" }),
    });
    assert.equal(foreign.status, 403);
    const imported = await fetch(`${board.origin}/api/actions/stop`, {
      method: "POST",
      headers: { authorization: `Bearer ${CAPABILITY}`, origin: board.origin, "x-reelier-csrf": CAPABILITY, "content-type": "application/json" },
      body: JSON.stringify({ missionId: "mission-board" }),
    });
    assert.equal(imported.status, 409);
    assert.equal(stopCalls, 0);
  } finally {
    await board.close();
    await rm(root, { recursive: true, force: true });
  }

  const expiredRoot = await mkdtemp(path.join(tmpdir(), "reelier-mission-board-expired-"));
  const expired = await createMissionControlBoardV1({ root: expiredRoot, capability: CAPABILITY, now: () => Date.parse("2026-08-24T14:00:00.000Z"), expiresAt: "2026-08-24T13:00:00.000Z" });
  try {
    assert.equal((await fetch(`${expired.origin}/api/state`, { headers: { authorization: `Bearer ${CAPABILITY}` } })).status, 401);
  } finally {
    await expired.close();
    await rm(expiredRoot, { recursive: true, force: true });
  }
});

test("the board stops an exact Reelier-owned mission through the default process controller", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-board-owned-stop-"));
  await seed(root, "reelier", false);
  const stopped: string[] = [];
  const board = await createMissionControlBoardV1({
    root,
    capability: CAPABILITY,
    now: () => Date.parse("2026-08-24T12:30:00.000Z"),
    expiresAt: "2026-08-24T13:00:00.000Z",
    stopMission: async (missionId) => { stopped.push(missionId); },
  });
  try {
    const response = await fetch(`${board.origin}/api/actions/stop`, {
      method: "POST",
      headers: { authorization: `Bearer ${CAPABILITY}`, origin: board.origin, "x-reelier-csrf": CAPABILITY, "content-type": "application/json" },
      body: JSON.stringify({ missionId: "mission-board" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(stopped, ["mission-board"]);
  } finally {
    await board.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("the board returns only evidence already bound to the exact mission", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-board-evidence-"));
  const evidenceStore = await createMissionEvidenceStoreV1({ root });
  const bound = await evidenceStore.publish({ kind: "test", subjectDigest: `sha256:${"a".repeat(64)}`, resultDigest: `sha256:${"b".repeat(64)}`, status: "passed", observedAt: "2026-08-24T12:00:00.000Z" });
  const unbound = await evidenceStore.publish({ kind: "build", subjectDigest: `sha256:${"c".repeat(64)}`, resultDigest: `sha256:${"d".repeat(64)}`, status: "passed", observedAt: "2026-08-24T12:00:01.000Z" });
  await (await createMissionControlJournalV1({ root })).appendMission({
    v: "reelier.mission-control-mission/v1",
    missionId: "mission-evidence",
    workspaceDigest: `sha256:${"e".repeat(64)}`,
    harness: "codex",
    harnessLifecycle: "exited",
    outcomeLifecycle: "locally-observed",
    attentionState: "none",
    attentionReasons: [],
    evidenceRefs: [bound.evidenceRef],
    processOwnership: "reelier",
    imported: false,
    updatedAt: "2026-08-24T12:00:02.000Z",
  });
  const board = await createMissionControlBoardV1({ root, capability: CAPABILITY, now: () => Date.parse("2026-08-24T12:30:00.000Z"), expiresAt: "2026-08-24T13:00:00.000Z" });
  try {
    const response = await fetch(`${board.origin}/api/evidence`, {
      method: "POST",
      headers: { authorization: `Bearer ${CAPABILITY}`, origin: board.origin, "x-reelier-csrf": CAPABILITY, "content-type": "application/json" },
      body: JSON.stringify({ missionId: "mission-evidence" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { v: "reelier.mission-control-evidence-list/v1", missionId: "mission-evidence", evidence: [bound] });
    assert.doesNotMatch(await (await fetch(board.origin)).text(), /prompt|reasoning|provider body/i);

    const arbitrary = await fetch(`${board.origin}/api/evidence`, {
      method: "POST",
      headers: { authorization: `Bearer ${CAPABILITY}`, origin: board.origin, "x-reelier-csrf": CAPABILITY, "content-type": "application/json" },
      body: JSON.stringify({ missionId: "mission-evidence", evidenceRef: unbound.evidenceRef }),
    });
    assert.equal(arbitrary.status, 400);
  } finally {
    await board.close();
    await rm(root, { recursive: true, force: true });
  }
});
