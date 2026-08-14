import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const workflowPath = path.resolve(".github/workflows/native-github-live.yml");
const runnerPath = path.resolve("scripts/native-github-live-runner.mjs");
const candidateId = "sha256:e46498b6441a44e7de42264ebf243e4462aae6e4c4b3d33ed4276fcc50190e96";
const publicCommit = "03ac48e";
const tarballDigest = "sha256:0659c2f402002d733dfd2621c5d8cce5df301975606a3fcb1b802e492bec5309";
const packDigest = "sha256:8101632acbacaf2738b8a7e698b0fb301539163edc713a37e74df0a6d233d689";
const task9Digest = "sha256:9999999999999999999999999999999999999999999999999999999999999999";
const task8BaselineDigest = "sha256:8888888888888888888888888888888888888888888888888888888888888888";
const portableContractDigest = "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const lanes = [
  { laneId: "operator-evidence", commitSha: "cccccccccccccccccccccccccccccccccccccccc" },
  { laneId: "provider-authority", commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  { laneId: "reconciliation-verifier", commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
];
const checkers = [
  { role: "contract", signerId: "checker-contract", publicKeyDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", verifierVersion: "authority-contract-checker/v1", verdictDigest: portableContractDigest },
  { role: "pack", signerId: "checker-pack", publicKeyDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", verifierVersion: "packed-consumer/v1", verdictDigest: packDigest },
  { role: "task8", signerId: "checker-task8", publicKeyDigest: task8BaselineDigest, verifierVersion: "task8-baseline-verifier/v1", verdictDigest: task8BaselineDigest },
  { role: "task9", signerId: "checker-task9", publicKeyDigest: task9Digest, verifierVersion: "portable-evidence-verifier/v1", verdictDigest: task9Digest },
];

async function source(): Promise<{ workflow: string; runner: string }> {
  return { workflow: await readFile(workflowPath, "utf8"), runner: await readFile(runnerPath, "utf8") };
}

// The runner is a checked-in ESM authoring boundary, so policy tests exercise its real parser.
// @ts-ignore no declaration is emitted for the standalone .mjs script
const { validateWorkflowText } = await import(pathToFileURL(runnerPath).href);

function runPreflight(candidate: string, mode: "preflight" | "run"): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [runnerPath, "--candidate", candidate, "--mode", mode], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "", NATIVE_GITHUB_LIVE_APPROVED: "", NATIVE_GITHUB_LIVE_EXECUTE: "" },
  });
}

function validCandidate(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: "reelier.native-github-candidate/v1",
    candidateId,
    publicCommitSha: publicCommit,
    tarballDigest,
    packDigest,
    task8BaselineDigest,
    task9VerificationDigest: task9Digest,
    portableEvidenceContractDigest: portableContractDigest,
    laneCommits: lanes,
    checkerIdentities: checkers,
    provenance: { v: "reelier.native-candidate-provenance/v1", source: "clean-export", reproducibility: "hermetic-offline", liveProviderStatus: "absent", credentialStatus: "absent", workflowDispatch: "absent" },
    ...extra,
  };
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
  assert.match(workflow, /EXPECTED_CANDIDATE_ID/);
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
  assert.match(runner, /EXPECTED_CANDIDATE_ID/);
  assert.match(runner, /ambiguous|resend/i);
  assert.doesNotMatch(runner, /fetch\(|https?:\/\//);
});

test("preflight emits deterministic sanitized status and local run refuses", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-native-live-runner-"));
  const candidate = path.join(root, "candidate.json");
  await writeFile(candidate, JSON.stringify(validCandidate()));
  const preflight = runPreflight(candidate, "preflight");
  assert.equal(preflight.status, 0, String(preflight.stderr));
  assert.match(String(preflight.stdout), /preflight|candidate/i);
  assert.doesNotMatch(String(preflight.stdout), /candidate\.json|03ac48e/);
  const canary = path.join(root, "canary.json");
  await writeFile(canary, JSON.stringify(validCandidate({ secret: "canary-private-token" })));
  const refusedCanary = runPreflight(canary, "preflight");
  assert.equal(refusedCanary.status, 1);
  assert.doesNotMatch(`${String(refusedCanary.stdout)}${String(refusedCanary.stderr)}`, /canary-private-token/);
  assert.equal(runPreflight(candidate, "run").status, 1);
});

test("runner refuses relative, duplicate, missing, and mismatched candidates", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-native-live-runner-invalid-"));
  const candidate = path.join(root, "candidate.json");
  await writeFile(candidate, JSON.stringify(validCandidate()));
  assert.equal(runPreflight("candidate.json", "preflight").status, 1);
  const duplicate = spawnSync(process.execPath, [runnerPath, "--candidate", candidate, "--candidate", candidate, "--mode", "preflight"], { encoding: "utf8" });
  assert.equal(duplicate.status, 1);
  const mismatch = path.join(root, "mismatch.json");
  await writeFile(mismatch, JSON.stringify(validCandidate({ candidateId: "sha256:deadbeef" })));
  assert.equal(runPreflight(mismatch, "preflight").status, 1);
});

test("runner refuses schema, contract, lane, checker, and provenance mutations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-native-live-runner-bindings-"));
  const mutations: Record<string, unknown>[] = [
    { v: "reelier.native-github-candidate/v2" },
    { portableEvidenceContractDigest: "sha256:deadbeef" },
    { laneCommits: [{ ...lanes[0], commitSha: "d".repeat(40) }, ...lanes.slice(1)] },
    { checkerIdentities: [{ ...checkers[0], signerId: "substituted" }, ...checkers.slice(1)] },
    { provenance: { ...(validCandidate().provenance as Record<string, unknown>), workflowDispatch: "verified" } },
  ];
  for (const [index, mutation] of mutations.entries()) {
    const candidate = path.join(root, `candidate-${Math.random().toString(16).slice(2)}.json`);
    await writeFile(candidate, JSON.stringify(validCandidate(mutation)));
    assert.equal(runPreflight(candidate, "preflight").status, 1, `mutation ${index} must refuse`);
  }
});

test("workflow policy parser refuses unsafe mutations", async () => {
  const { workflow } = await source();
  const unsafe = [
    workflow.replace("workflow_dispatch:", "push:\n  branches: [main]\n  workflow_dispatch:"),
    workflow.replace("contents: read", "contents: write"),
    workflow.replace("name: native-github-live", "name: unprotected"),
    workflow.replace("ubuntu-latest\n          - windows-latest", "ubuntu-latest"),
    workflow.replaceAll(candidateId, "sha256:deadbeef"),
    workflow.replace("if: ${{ success() }}", "if: ${{ success() }}\n        continue-on-error: true"),
    workflow.replace("disposable fixture target", "production target"),
  ];
  for (const variant of unsafe) assert.ok(validateWorkflowText(variant).length > 0);
  assert.deepEqual(validateWorkflowText(workflow), [], "the authored workflow itself must pass the same parser");
  assert.match(workflow, /ref:\s*\$\{\{\s*github\.sha\s*\}\}/, "runner source must come from the workflow revision");
  assert.match(workflow, /NATIVE_PUBLIC_COMMIT:\s*03ac48e/);
});
