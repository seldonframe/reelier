import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { startAutopilotTargetSelectionV1, waitForAutopilotTargetSelectionV1 } from "../../src/operator/autopilot-target-selection-client.js";

test("Operator starts a closed browser selection and claims exact targets once", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-target-selection-"));
  try {
    const started = await startAutopilotTargetSelectionV1({ root, cloudBaseUrl: "https://www.reelier.com", missionRef: "mission-1", now: () => new Date("2026-08-24T20:00:00.000Z"), fetch: async (_url, init) => { const body = JSON.parse(String(init?.body)) as { pollSecret: string; browserSecret: string }; return new Response(JSON.stringify({ status: "pending", pollSecret: body.pollSecret, browserUrl: `https://www.reelier.com/autopilot/targets?mission=mission-1#selection=${body.browserSecret}`, expiresAt: "2026-08-24T20:15:00.000Z" }), { status: 201 }); } });
    assert.match(started.browserUrl, /^https:\/\/www\.reelier\.com\/autopilot\/targets\?mission=mission-1#selection=/);
    const persisted = JSON.parse(await readFile(path.join(root, ".reelier", "operator", "target-selections", "mission-1.json"), "utf8"));
    assert.deepEqual(Object.keys(persisted).sort(), ["browserUrl", "cloudBaseUrl", "expiresAt", "missionRef", "pollSecret", "version"]);

    let calls = 0;
    const selection = await waitForAutopilotTargetSelectionV1({ root, missionRef: "mission-1", pollIntervalMs: 1, now: () => new Date("2026-08-24T20:01:00.000Z"), fetch: async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ status: "pending" }));
      return new Response(JSON.stringify({ status: "selected", selection: { version: "reelier.autopilot-target-selection/v1", missionRef: "mission-1", workspaceId: "workspace-1", teamId: "team-1", projectId: "project-1", composite: { issueId: "issue-1", preStatusId: "state-progress", preStatusName: "In Progress", targetStatusId: "state-done", targetStatusName: "Done" }, linearOnly: { issueId: "issue-2", preStatusId: "state-todo", preStatusName: "Todo", targetStatusId: "state-done", targetStatusName: "Done" } } }));
    } });
    assert.equal(selection.linearOnly.issueId, "issue-2");
    const claimed = JSON.parse(await readFile(path.join(root, ".reelier", "operator", "target-selections", "mission-1.json"), "utf8"));
    assert.equal(claimed.version, "reelier.autopilot-target-selection/v1");
    assert.equal(claimed.pollSecret, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Operator refuses crossed target responses and foreign browser destinations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-target-selection-refuse-"));
  try {
    await assert.rejects(() => startAutopilotTargetSelectionV1({ root, cloudBaseUrl: "https://www.reelier.com", missionRef: "mission-1", now: () => new Date("2026-08-24T20:00:00.000Z"), fetch: async (_url, init) => { const body = JSON.parse(String(init?.body)) as { pollSecret: string; browserSecret: string }; return new Response(JSON.stringify({ status: "pending", pollSecret: body.pollSecret, browserUrl: `https://attacker.example/autopilot/targets?mission=mission-1#selection=${body.browserSecret}`, expiresAt: "2026-08-24T20:15:00.000Z" }), { status: 201 }); } }), /destination/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Operator retries a lost start response with the exact same locally journaled secrets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-target-selection-retry-"));
  try {
    const bodies: unknown[] = [];
    let calls = 0;
    const request = async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      calls += 1;
      if (calls === 1) throw new Error("response lost after accept");
      const body = bodies[0] as { pollSecret: string; browserSecret: string };
      return new Response(JSON.stringify({ status: "pending", pollSecret: body.pollSecret, browserUrl: `https://www.reelier.com/autopilot/targets?mission=mission-retry#selection=${body.browserSecret}`, expiresAt: "2026-08-24T20:15:00.000Z" }), { status: 201 });
    };
    await assert.rejects(() => startAutopilotTargetSelectionV1({ root, cloudBaseUrl: "https://www.reelier.com", missionRef: "mission-retry", now: () => new Date("2026-08-24T20:00:00.000Z"), fetch: request as typeof fetch }), /response lost/);
    const started = await startAutopilotTargetSelectionV1({ root, cloudBaseUrl: "https://www.reelier.com", missionRef: "mission-retry", now: () => new Date("2026-08-24T20:00:01.000Z"), fetch: request as typeof fetch });
    assert.match(started.browserUrl, /mission-retry/);
    assert.deepEqual(bodies[1], bodies[0]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Operator refreshes an expired pending selector with its exact cached secrets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-target-selection-expired-"));
  try {
    const bodies: Array<{ missionRef: string; pollSecret: string; browserSecret: string }> = [];
    const request = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { missionRef: string; pollSecret: string; browserSecret: string };
      bodies.push(body);
      const expiresAt = bodies.length === 1 ? "2026-08-24T20:15:00.000Z" : "2026-08-24T20:31:00.000Z";
      return new Response(JSON.stringify({ status: "pending", pollSecret: body.pollSecret, browserUrl: `https://www.reelier.com/autopilot/targets?mission=mission-expired#selection=${body.browserSecret}`, expiresAt }), { status: 201 });
    };
    await startAutopilotTargetSelectionV1({ root, cloudBaseUrl: "https://www.reelier.com", missionRef: "mission-expired", now: () => new Date("2026-08-24T20:00:00.000Z"), fetch: request as typeof fetch });
    await startAutopilotTargetSelectionV1({ root, cloudBaseUrl: "https://www.reelier.com", missionRef: "mission-expired", now: () => new Date("2026-08-24T20:16:00.000Z"), fetch: request as typeof fetch });
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[1], bodies[0]);
    const persisted = JSON.parse(await readFile(path.join(root, ".reelier", "operator", "target-selections", "mission-expired.json"), "utf8"));
    assert.equal(persisted.expiresAt, "2026-08-24T20:31:00.000Z");
  } finally { await rm(root, { recursive: true, force: true }); }
});
