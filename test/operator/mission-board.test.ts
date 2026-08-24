import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMissionControlBoardV1 } from "../../src/operator/mission-board.js";
import { createMissionEvidenceStoreV1 } from "../../src/operator/mission-evidence.js";
import { createMissionControlJournalV1 } from "../../src/operator/mission-journal.js";

const CAPABILITY = "c".repeat(64);

function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return (0.2126 * channel(1)) + (0.7152 * channel(3)) + (0.0722 * channel(5));
}

function contrast(left: string, right: string): number {
  const a = relativeLuminance(left);
  const b = relativeLuminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

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
    startedAt: "2026-08-24T11:55:00.000Z",
    usage: { inputTokens: 1_200, cachedInputTokens: 400, outputTokens: 300, contextUnits: 1_500, totalCostMicros: 123_456 },
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
    assert.match(html, /setInterval\(loadState,2000\)/);
    assert.match(html, /Last activity: "\+m\.updatedAt/);
    assert.match(html, /Elapsed: /);
    assert.match(html, /Exposed cost: /);
    assert.match(html, /Tokens: /);
    assert.match(html, /button,select,textarea\{min-height:44px\}/);
    assert.match(html, /button\{min-width:44px\}/);
    const colors = Object.fromEntries([...html.matchAll(/--([a-z]+):(#[0-9a-f]{6})/g)].map((match) => [match[1], match[2]]));
    for (const foreground of ["ink", "muted", "signal", "watch", "calm", "harness"]) {
      assert.ok(contrast(colors[foreground]!, colors.sheet!) >= 4.5, `${foreground} text must retain 4.5:1 contrast on the mission sheet`);
    }
    assert.doesNotMatch(html, /mission-board|https:\/\/|<script[^>]+src=/i);

    const favicon = await fetch(`${board.origin}/favicon.ico`);
    assert.equal(favicon.status, 204);
    assert.equal(await favicon.text(), "");

    assert.equal((await fetch(`${board.origin}/api/state`)).status, 401);
    const authorized = await fetch(`${board.origin}/api/state`, { headers: { authorization: `Bearer ${CAPABILITY}` } });
    assert.equal(authorized.status, 200);
    const state = await authorized.json() as { currentWorkspaceDigest: string; missions: Array<{ missionId: string; startedAt?: string; usage?: { totalCostMicros?: number } }> };
    assert.deepEqual(state.missions.map((mission) => mission.missionId), ["mission-board"]);
    assert.equal(state.missions[0]?.startedAt, "2026-08-24T11:55:00.000Z");
    assert.equal(state.missions[0]?.usage?.totalCostMicros, 123_456);
    assert.equal(state.currentWorkspaceDigest, `sha256:${createHash("sha256").update(path.resolve(root), "utf8").digest("hex")}`);
  } finally {
    await board.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("the board orders current-repository work first and exposes a local/global switcher", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-board-current-"));
  const currentWorkspaceDigest = `sha256:${createHash("sha256").update(path.resolve(root), "utf8").digest("hex")}`;
  const journal = await createMissionControlJournalV1({ root });
  const record = (missionId: string, workspaceDigest: string) => ({ v: "reelier.mission-control-mission/v1" as const, missionId, workspaceDigest, harness: "codex" as const, harnessLifecycle: "discovered" as const, outcomeLifecycle: "unrequested" as const, attentionState: "none" as const, attentionReasons: [], evidenceRefs: [], processOwnership: "external" as const, imported: true, updatedAt: "2026-08-24T12:00:00.000Z" });
  await journal.appendMission(record("mission-other", `sha256:${"f".repeat(64)}`));
  await journal.appendMission(record("mission-current", currentWorkspaceDigest));
  const board = await createMissionControlBoardV1({ root, capability: CAPABILITY, now: () => Date.parse("2026-08-24T12:30:00.000Z"), expiresAt: "2026-08-24T13:00:00.000Z" });
  try {
    const response = await fetch(`${board.origin}/api/state`, { headers: { authorization: `Bearer ${CAPABILITY}` } });
    const state = await response.json() as { missions: Array<{ missionId: string }> };
    assert.deepEqual(state.missions.map((mission) => mission.missionId), ["mission-current", "mission-other"]);
    const html = await (await fetch(board.origin)).text();
    assert.match(html, /Current repository/);
    assert.match(html, /All work/);
    assert.match(html, /Exception inbox/);
    assert.match(html, />Running</);
    assert.match(html, />Needs attention</);
    assert.match(html, />Ambiguous</);
    assert.match(html, /Harness state: /);
    assert.match(html, /Outcome state: /);
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

test("the board resumes only an exact non-imported Reelier-owned mission", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-board-resume-"));
  await (await createMissionControlJournalV1({ root })).appendMission({ v: "reelier.mission-control-mission/v1", missionId: "mission-resume", workspaceDigest: `sha256:${"a".repeat(64)}`, harness: "claude-code", harnessLifecycle: "stopped", outcomeLifecycle: "pending", attentionState: "watching", attentionReasons: ["stopped"], evidenceRefs: [], processOwnership: "reelier", imported: false, updatedAt: "2026-08-24T12:00:00.000Z" });
  const resumed: string[] = [];
  const board = await createMissionControlBoardV1({ root, capability: CAPABILITY, now: () => Date.parse("2026-08-24T12:30:00.000Z"), expiresAt: "2026-08-24T13:00:00.000Z", resumeMission: async (missionId) => { resumed.push(missionId); } });
  try {
    const response = await fetch(`${board.origin}/api/actions/resume`, { method: "POST", headers: { authorization: `Bearer ${CAPABILITY}`, origin: board.origin, "x-reelier-csrf": CAPABILITY, "content-type": "application/json" }, body: JSON.stringify({ missionId: "mission-resume" }) });
    assert.equal(response.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(resumed, ["mission-resume"]);
  } finally {
    await board.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("the board starts one exact product-ready harness mission without reflecting its task", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-board-run-"));
  const received: unknown[] = [];
  const board = await createMissionControlBoardV1({ root, capability: CAPABILITY, now: () => Date.parse("2026-08-24T12:30:00.000Z"), expiresAt: "2026-08-24T13:00:00.000Z", runMission: async (input) => { received.push(input); } });
  try {
    const task = "PRIVATE TASK SENT ONLY TO CODEX";
    const response = await fetch(`${board.origin}/api/actions/run`, { method: "POST", headers: { authorization: `Bearer ${CAPABILITY}`, origin: board.origin, "x-reelier-csrf": CAPABILITY, "content-type": "application/json" }, body: JSON.stringify({ harness: "codex", task }) });
    assert.equal(response.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(received, [{ harness: "codex", task }]);
    assert.doesNotMatch(await response.text(), new RegExp(task));
    const unsupported = await fetch(`${board.origin}/api/actions/run`, { method: "POST", headers: { authorization: `Bearer ${CAPABILITY}`, origin: board.origin, "x-reelier-csrf": CAPABILITY, "content-type": "application/json" }, body: JSON.stringify({ harness: "grok-build", task: "x" }) });
    assert.equal(unsupported.status, 400);
  } finally {
    await board.close();
    await rm(root, { recursive: true, force: true });
  }
});
