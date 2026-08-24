import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { startAutopilotTargetSelectionV1, waitForAutopilotTargetSelectionV1 } from "../../src/operator/autopilot-target-selection-client.js";

test("Operator starts a closed browser selection and claims exact targets once", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-target-selection-"));
  try {
    const started = await startAutopilotTargetSelectionV1({ root, cloudBaseUrl: "https://www.reelier.com", missionRef: "mission-1", now: () => new Date("2026-08-24T20:00:00.000Z"), fetch: async () => new Response(JSON.stringify({ status: "pending", pollSecret: "p".repeat(43), browserUrl: `https://www.reelier.com/autopilot/targets?mission=mission-1#selection=${"b".repeat(43)}`, expiresAt: "2026-08-24T20:15:00.000Z" }), { status: 201 }) });
    assert.equal(started.browserUrl, `https://www.reelier.com/autopilot/targets?mission=mission-1#selection=${"b".repeat(43)}`);
    const persisted = JSON.parse(await readFile(path.join(root, ".reelier", "operator", "target-selections", "mission-1.json"), "utf8"));
    assert.deepEqual(Object.keys(persisted).sort(), ["browserUrl", "cloudBaseUrl", "expiresAt", "missionRef", "pollSecret", "version"]);

    let calls = 0;
    const selection = await waitForAutopilotTargetSelectionV1({ root, missionRef: "mission-1", pollIntervalMs: 1, now: () => new Date("2026-08-24T20:01:00.000Z"), fetch: async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ status: "pending" }));
      return new Response(JSON.stringify({ status: "selected", selection: { version: "reelier.autopilot-target-selection/v1", missionRef: "mission-1", workspaceId: "workspace-1", teamId: "team-1", projectId: "project-1", composite: { issueId: "issue-1", preStatusId: "state-progress", targetStatusId: "state-done" }, linearOnly: { issueId: "issue-2", preStatusId: "state-todo", targetStatusId: "state-done" } } }));
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
    await assert.rejects(() => startAutopilotTargetSelectionV1({ root, cloudBaseUrl: "https://www.reelier.com", missionRef: "mission-1", now: () => new Date("2026-08-24T20:00:00.000Z"), fetch: async () => new Response(JSON.stringify({ status: "pending", pollSecret: "p".repeat(43), browserUrl: `https://attacker.example/autopilot/targets?mission=mission-1#selection=${"b".repeat(43)}`, expiresAt: "2026-08-24T20:15:00.000Z" }), { status: 201 }) }), /destination/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
