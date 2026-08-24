import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAutopilotHandoffV1 } from "../../src/operator/autopilot-handoff-client.js";

test("Autopilot client creates a signed exact manifest handoff without prompts or credentials", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-autopilot-client-"));
  let request: any;
  try {
    const result = await createAutopilotHandoffV1({
      root, cloudBaseUrl: "https://www.reelier.com", missionRef: "mission-1", localEvidenceRefs: [`sha256:${"a".repeat(64)}`], now: () => new Date("2026-08-24T12:00:00.000Z"),
      targetManifest: { version: "reelier.managed-upgrade-target-manifest/v1", missionRef: "mission-1", repository: "fixlyai/reelier-beta", githubActions: ["github_release_pr_merge_v1"], linearTarget: "Reelier / Paid beta / REEL-101", linearActions: ["linear_evidence_comment_v1", "linear_status_transition_v1"], maximumWrites: 3, expiresAt: "2026-08-24T12:10:00.000Z" },
      fetch: async (_url, init) => { request = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ browserPath: "/autopilot?mission=mission-1" }), { status: 201 }); },
    });
    assert.equal(result.browserUrl, "https://www.reelier.com/autopilot?mission=mission-1");
    assert.equal(request.intent.missionRef, "mission-1");
    assert.deepEqual(request.intent.requestedOperations, ["github_release_pr_merge_v1", "linear_evidence_comment_v1", "linear_status_transition_v1"]);
    assert.equal(typeof request.publicKeyPem, "string");
    assert.equal(JSON.stringify(request).includes("PRIVATE KEY"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
