import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadManagedUpgradeTargetBundleV1,
  stageManagedUpgradeTargetBundleV1,
} from "../../src/operator/managed-upgrade-target-store.js";

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function manifest() {
  return {
    version: "reelier.managed-upgrade-target-manifest/v1" as const,
    missionRef: "mission-1",
    repository: "fixlyai/reelier-beta",
    githubActions: ["github_release_pr_merge_v1"] as const,
    linearTarget: { workspaceId: "workspace-1", teamId: "team-1", projectId: "project-1", issueIds: ["issue-1"] },
    linearActions: ["linear_evidence_comment_v1"] as const,
    maximumWrites: 2,
    expiresAt: "2026-08-24T12:10:00.000Z",
  };
}

test("an exact reviewed consequence stages the target bundle behind the one-line Autopilot command", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-autopilot-target-"));
  try {
    const seen = new Set<string>();
    const staged = await stageManagedUpgradeTargetBundleV1({ root, operation: "github_release_pr_merge_v1", targetManifest: manifest(), seen });
    assert.equal(staged.cta, "Ready to merge. Continue natively, or let Reelier execute and verify it with bounded authority: reelier operator autopilot mission-1");
    assert.deepEqual(await loadManagedUpgradeTargetBundleV1({ root, missionRef: "mission-1" }), { targetManifest: manifest() });
    assert.equal((await stageManagedUpgradeTargetBundleV1({ root, operation: "github_release_pr_merge_v1", targetManifest: manifest(), seen })).cta, null);
    assert.equal((await stageManagedUpgradeTargetBundleV1({ root, operation: "github_release_pr_merge_v1", targetManifest: manifest(), seen: new Set() })).cta, null);
    await assert.rejects(() => stageManagedUpgradeTargetBundleV1({
      root,
      operation: "github_release_pr_merge_v1",
      targetManifest: { ...manifest(), repository: "fixlyai/widened-target" },
      seen: new Set(),
    }), /existing.*target.*conflict/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("target staging rejects an operation outside the exact manifest and mismatched candidate bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-autopilot-target-refuse-"));
  try {
    await assert.rejects(() => stageManagedUpgradeTargetBundleV1({ root, operation: "github_release_pr_ensure_v1", targetManifest: manifest(), seen: new Set() }), /operation.*manifest/i);
    const candidate = Buffer.from("exact candidate", "utf8");
    await assert.rejects(() => stageManagedUpgradeTargetBundleV1({
      root,
      operation: "github_release_candidate_publish_v1",
      seen: new Set(),
      artifactBytes: Buffer.from("substituted", "utf8"),
      targetManifest: {
        ...manifest(),
        version: "reelier.managed-upgrade-target-manifest/v2",
        githubActions: ["github_release_candidate_publish_v1"],
        artifactDigest: digest(candidate.toString("utf8")),
        authority: {
          github: { repository: "fixlyai/reelier-beta", baseBranch: "main", baseSha: "a".repeat(40), headBranch: "reelier/mission-1", headSha: "b".repeat(40), candidateDigest: digest(candidate.toString("utf8")), workflowPath: ".github/workflows/ci.yml", workflowDigest: digest("workflow"), requiredChecks: ["test"], postMergeTreeSha: "c".repeat(40) },
          linear: {
            githubLinear: { workspace: "workspace-1", team: "team-1", project: "project-1", issue: "issue-1", preStatus: "In Progress", targetStatus: "Done", commentMarker: "reelier:one", evidenceUrl: "https://www.reelier.com/r/one", evidenceContentDigest: digest("one") },
            linearOnly: { workspace: "workspace-1", team: "team-1", project: "project-1", issue: "issue-1", preStatus: "Todo", targetStatus: "Done", commentMarker: "reelier:two", evidenceUrl: "https://www.reelier.com/r/two", evidenceContentDigest: digest("two") },
          },
        },
      },
    }), /artifact.*digest/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
