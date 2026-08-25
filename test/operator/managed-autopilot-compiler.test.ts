import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { compileAndStageGitHubOnlyManagedAutopilotBundleV1, compileAndStageManagedAutopilotBundleV1 } from "../../src/operator/managed-autopilot-compiler.js";
import { loadManagedUpgradeTargetBundleV1 } from "../../src/operator/managed-upgrade-target-store.js";

const run = promisify(execFile);
const git = async (root: string, ...args: string[]) => (await run("git", args, { cwd: root, encoding: "utf8" })).stdout.trim();
const selection = Object.freeze({
  version: "reelier.autopilot-target-selection/v1" as const,
  missionRef: "mission-1",
  workspaceId: "workspace-1",
  teamId: "team-1",
  projectId: "project-1",
  composite: Object.freeze({ issueId: "issue-1", preStatusId: "state-progress", preStatusName: "In Progress", targetStatusId: "state-done", targetStatusName: "Done" }),
  linearOnly: Object.freeze({ issueId: "issue-2", preStatusId: "state-todo", preStatusName: "Todo", targetStatusId: "state-done", targetStatusName: "Done" }),
});

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-autopilot-compile-"));
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "Reelier Test");
  await git(root, "config", "user.email", "receipts@reelier.com");
  await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await writeFile(path.join(root, ".github", "workflows", "ci.yml"), "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps: []\n", "utf8");
  await writeFile(path.join(root, "README.md"), "base\n", "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "base");
  const base = await git(root, "rev-parse", "HEAD");
  await git(root, "remote", "add", "origin", "https://github.com/fixlyai/reelier-beta.git");
  await git(root, "update-ref", "refs/remotes/origin/main", base);
  await git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  await writeFile(path.join(root, "README.md"), "candidate\n", "utf8");
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "new.txt"), "new\n", "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "candidate work");
  return root;
}

test("compiler freezes a clean Git candidate and selected Linear targets into the reviewed seven-definition bundle", async () => {
  const root = await repository();
  try {
    const compiled = await compileAndStageManagedAutopilotBundleV1({ root, missionRef: "mission-1", selection, now: () => new Date("2026-08-24T20:00:00.000Z") });
    assert.equal(compiled.targetManifest.version, "reelier.managed-upgrade-target-manifest/v2");
    assert.deepEqual(compiled.targetManifest.githubActions, ["github_release_candidate_publish_v1", "github_release_pr_ensure_v1", "github_release_pr_merge_v1"]);
    assert.deepEqual(compiled.targetManifest.linearActions, ["linear_evidence_comment_v1", "linear_status_transition_v1", "linear_only_evidence_comment_v1", "linear_only_status_transition_v1"]);
    assert.equal(compiled.targetManifest.authority.linear.githubLinear.preStatus, "In Progress");
    assert.equal(compiled.targetManifest.authority.linear.linearOnly.targetStatus, "Done");
    assert.equal(compiled.targetManifest.authority.github.postMergeTreeSha, await git(root, "rev-parse", "HEAD^{tree}"));
    assert.ok(compiled.artifactBytes);
    const artifact = JSON.parse(Buffer.from(compiled.artifactBytes).toString("utf8"));
    assert.deepEqual(artifact.files.map((file: { path: string }) => file.path), ["README.md", "src/new.txt"]);
    assert.equal(compiled.targetManifest.artifactDigest, `sha256:${createHash("sha256").update(compiled.artifactBytes).digest("hex")}`);
    assert.deepEqual(await loadManagedUpgradeTargetBundleV1({ root, missionRef: "mission-1" }), compiled);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("GitHub-only compiler freezes the current repository into the reviewed three-definition v3 bundle", async () => {
  const root = await repository();
  try {
    const compiled = await compileAndStageGitHubOnlyManagedAutopilotBundleV1({ root, missionRef: "mission-github-only", now: () => new Date("2026-08-24T20:00:00.000Z") });
    assert.equal(compiled.targetManifest.version, "reelier.managed-upgrade-target-manifest/v3");
    assert.equal(compiled.targetManifest.mode, "github-only");
    assert.deepEqual(compiled.targetManifest.githubActions, ["github_release_candidate_publish_v1", "github_release_pr_ensure_v1", "github_release_pr_merge_v1"]);
    assert.equal(compiled.targetManifest.maximumWrites, 3);
    assert.equal("linearTarget" in compiled.targetManifest, false);
    assert.equal("linear" in compiled.targetManifest.authority, false);
    assert.equal(compiled.targetManifest.authority.github.postMergeTreeSha, await git(root, "rev-parse", "HEAD^{tree}"));
    assert.ok(compiled.artifactBytes);
    assert.deepEqual(await loadManagedUpgradeTargetBundleV1({ root, missionRef: "mission-github-only" }), compiled);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("compiler refuses dirty worktrees, deletions, crossed selections, and post-selection widening", async () => {
  const root = await repository();
  try {
    await writeFile(path.join(root, "dirty.txt"), "not committed\n", "utf8");
    await assert.rejects(() => compileAndStageManagedAutopilotBundleV1({ root, missionRef: "mission-1", selection, requiredChecks: ["test"] }), /clean|dirty/i);
    await rm(path.join(root, "dirty.txt"));
    await assert.rejects(() => compileAndStageManagedAutopilotBundleV1({ root, missionRef: "mission-2", selection, requiredChecks: ["test"] }), /mission/i);
    await rm(path.join(root, "README.md"));
    await git(root, "add", "-u");
    await git(root, "commit", "-m", "delete");
    await assert.rejects(() => compileAndStageManagedAutopilotBundleV1({ root, missionRef: "mission-1", selection, requiredChecks: ["test"] }), /deletion/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
