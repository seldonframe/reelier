import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAutopilotHandoffV1, waitForAutopilotReadyV1 } from "../../src/operator/autopilot-handoff-client.js";

test("Autopilot client creates a signed exact manifest handoff without prompts or credentials", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-autopilot-client-"));
  let request: any;
  try {
    const result = await createAutopilotHandoffV1({
      root, cloudBaseUrl: "https://www.reelier.com", missionRef: "mission-1", localEvidenceRefs: [`sha256:${"a".repeat(64)}`], now: () => new Date("2026-08-24T12:00:00.000Z"),
      targetManifest: { version: "reelier.managed-upgrade-target-manifest/v1", missionRef: "mission-1", repository: "fixlyai/reelier-beta", githubActions: ["github_release_pr_merge_v1"], linearTarget: "Reelier / Paid beta / REEL-101", linearActions: ["linear_evidence_comment_v1", "linear_status_transition_v1"], maximumWrites: 3, expiresAt: "2026-08-24T12:10:00.000Z" },
      fetch: async (_url, init) => { request = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ browserPath: `/autopilot?mission=mission-1#init=${"b".repeat(43)}`, pollSecret: "p".repeat(43) }), { status: 201 }); },
    });
    assert.equal(result.browserUrl, `https://www.reelier.com/autopilot?mission=mission-1#init=${"b".repeat(43)}`);
    assert.equal(result.pollSecret, "p".repeat(43));
    assert.equal(request.intent.missionRef, "mission-1");
    assert.deepEqual(request.intent.requestedOperations, ["github_release_pr_merge_v1", "linear_evidence_comment_v1", "linear_status_transition_v1"]);
    assert.equal(typeof request.publicKeyPem, "string");
    assert.equal(JSON.stringify(request).includes("PRIVATE KEY"), false);
    const persisted = JSON.parse(await readFile(path.join(root, ".reelier", "operator", "handoffs", "mission-1.json"), "utf8"));
    assert.equal(persisted.pollSecret, "p".repeat(43));
    assert.equal(JSON.stringify(persisted).includes("PRIVATE KEY"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Autopilot polling returns Ready once and removes the local poll capability", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-autopilot-poll-"));
  const missionRef = "mission-poll";
  let calls = 0;
  try {
    await createAutopilotHandoffV1({
      root, cloudBaseUrl: "https://www.reelier.com", missionRef, localEvidenceRefs: [], now: () => new Date("2026-08-24T12:00:00.000Z"),
      targetManifest: { version: "reelier.managed-upgrade-target-manifest/v1", missionRef, repository: "fixlyai/reelier-beta", githubActions: ["github_release_pr_merge_v1"], linearTarget: "Reelier / Paid beta / REEL-101", linearActions: ["linear_evidence_comment_v1"], maximumWrites: 2, expiresAt: "2026-08-24T12:10:00.000Z" },
      fetch: async () => new Response(JSON.stringify({ browserPath: `/autopilot?mission=${missionRef}#init=${"b".repeat(43)}`, pollSecret: "p".repeat(43) }), { status: 201 }),
    });
    const ready = await waitForAutopilotReadyV1({ root, missionRef, sleep: async () => {}, fetch: async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).pollSecret, "p".repeat(43));
      calls += 1;
      return new Response(JSON.stringify(calls === 1 ? { status: "pending" } : { status: "ready", agentRef: "agent-opaque", browserUrl: "https://www.reelier.com/init", configurationDigest: `sha256:${"c".repeat(64)}` }), { status: 200 });
    } });
    assert.equal(ready.status, "ready");
    assert.equal(calls, 2);
    const persisted = JSON.parse(await readFile(path.join(root, ".reelier", "operator", "handoffs", `${missionRef}.json`), "utf8"));
    assert.deepEqual(persisted, { version: "reelier.autopilot-ready/v1", missionRef, agentRef: "agent-opaque", configurationDigest: `sha256:${"c".repeat(64)}` });
  } finally { await rm(root, { recursive: true, force: true }); }
});
