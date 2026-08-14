import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workflowPath = path.resolve(".github/workflows/native-github-live.yml");
const runnerPath = path.resolve("scripts/native-github-live-runner.mjs");
const candidateId = "sha256:e46498b6441a44e7de42264ebf243e4462aae6e4c4b3d33ed4276fcc50190e96";
const publicCommit = "03ac48e";
const tarballDigest = "sha256:0659c2f402002d733dfd2621c5d8cce5df301975606a3fcb1b802e492bec5309";
const packDigest = "sha256:8101632acbacaf2738b8a7e698b0fb301539163edc713a37e74df0a6d233d689";
const task9Digest = "sha256:9999999999999999999999999999999999999999999999999999999999999999";

async function source(): Promise<{ workflow: string; runner: string }> {
  return { workflow: await readFile(workflowPath, "utf8"), runner: await readFile(runnerPath, "utf8") };
}

function runPreflight(candidate: string, mode: "preflight" | "run"): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [runnerPath, "--candidate", candidate, "--mode", mode], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "", NATIVE_GITHUB_LIVE_APPROVED: "", NATIVE_GITHUB_LIVE_EXECUTE: "" },
  });
}

test("guarded workflow is manual-only, approval-protected, least-privilege, and explicitly pinned", async () => {
  const { workflow } = await source();
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule|repository_dispatch):/m);
  assert.match(workflow, /permissions:\s*\n\s+contents:\s*read/);
  assert.match(workflow, /environment:\s*\n\s+name:\s*native-github-live/);
  assert.match(workflow, /matrix:\s*\n[\s\S]*os:\s*\n\s+-\s*ubuntu-latest\s*\n\s+-\s*windows-latest/);
  for (const pin of [candidateId, publicCommit, tarballDigest, packDigest, task9Digest]) assert.match(workflow, new RegExp(pin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(workflow, /disposable[_-]?target|target/i);
  assert.doesNotMatch(workflow, /production/i);
  assert.doesNotMatch(workflow, /continue-on-error|retry|timeout-minutes:\s*0/i);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\.[^}]+\s*\}\}/);
  assert.match(workflow, /if:\s*\$\{\{[^}]*approved|approval|environment/i);
  const verification = workflow.search(/verify|preflight/i);
  const upload = workflow.search(/upload-artifact/);
  assert.ok(verification >= 0 && upload > verification, "artifacts upload only after verification");
});

test("runner source is fail-closed and never interpolates credentials or unsafe target defaults", async () => {
  const { runner } = await source();
  assert.match(runner, /--candidate/);
  assert.match(runner, /--mode/);
  assert.match(runner, /preflight/);
  assert.match(runner, /NATIVE_GITHUB_LIVE_APPROVED/);
  assert.match(runner, /NATIVE_GITHUB_LIVE_EXECUTE/);
  assert.match(runner, /ambiguous|resend/i);
  assert.doesNotMatch(runner, /secrets\.|GITHUB_TOKEN|production/i);
  assert.doesNotMatch(runner, /fetch\(|https?:\/\//);
});

test("preflight emits deterministic sanitized status and local run refuses", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-native-live-runner-"));
  const candidate = path.join(root, "candidate.json");
  await writeFile(candidate, JSON.stringify({ candidateId, publicCommitSha: publicCommit, tarballDigest, packDigest, task9VerificationDigest: task9Digest, canary: "canary-private-token" }));
  const preflight = runPreflight(candidate, "preflight");
  assert.equal(preflight.status, 0, String(preflight.stderr));
  assert.match(String(preflight.stdout), /preflight|candidate/i);
  assert.doesNotMatch(String(preflight.stdout), /canary-private-token|candidate\.json|03ac48e/);
  assert.equal(runPreflight(candidate, "run").status, 1);
});

test("runner refuses relative, duplicate, missing, and mismatched candidates", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-native-live-runner-invalid-"));
  const candidate = path.join(root, "candidate.json");
  await writeFile(candidate, JSON.stringify({ candidateId, publicCommitSha: publicCommit, tarballDigest, packDigest, task9VerificationDigest: task9Digest }));
  assert.equal(runPreflight("candidate.json", "preflight").status, 1);
  const duplicate = spawnSync(process.execPath, [runnerPath, "--candidate", candidate, "--candidate", candidate, "--mode", "preflight"], { encoding: "utf8" });
  assert.equal(duplicate.status, 1);
  const mismatch = path.join(root, "mismatch.json");
  await writeFile(mismatch, JSON.stringify({ candidateId: "sha256:deadbeef", publicCommitSha: publicCommit, tarballDigest, packDigest, task9VerificationDigest: task9Digest }));
  assert.equal(runPreflight(mismatch, "preflight").status, 1);
});
