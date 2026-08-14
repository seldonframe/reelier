import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../../src/authority/wire.js";
import { signAuthorityDigest } from "../../src/authority/crypto.js";
import {
  verifyGate4Bundle,
  createGate4Decision,
  verifyGate4Decision,
  type Gate4CandidateBindingV1,
  type Gate4HostedBundleV1,
} from "../../src/authority/certification/gate4-decision.js";

const digest = (char: string) => `sha256:${char.repeat(64)}`;
const candidate: Gate4CandidateBindingV1 = {
  v: "reelier.native-github-candidate/v1",
  candidateId: "sha256:e46498b6441a44e7de42264ebf243e4462aae6e4c4b3d33ed4276fcc50190e96",
  publicCommitSha: "03ac48e",
  tarballDigest: "sha256:0659c2f402002d733dfd2621c5d8cce5df301975606a3fcb1b802e492bec5309",
  laneCommits: [
    { laneId: "operator-evidence", commitSha: "c".repeat(40) },
    { laneId: "provider-authority", commitSha: "a".repeat(40) },
    { laneId: "reconciliation-verifier", commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
  ],
  packDigest: "sha256:8101632acbacaf2738b8a7e698b0fb301539163edc713a37e74df0a6d233d689",
  task8BaselineDigest: digest("8"),
  task9VerificationDigest: digest("9"),
  portableEvidenceContractDigest: digest("e"),
  checkerIdentities: [
    { role: "contract", signerId: "checker-contract", publicKeyDigest: digest("c"), verifierVersion: "authority-contract-checker/v1", verdictDigest: digest("e") },
    { role: "pack", signerId: "checker-pack", publicKeyDigest: digest("d"), verifierVersion: "packed-consumer/v1", verdictDigest: "sha256:8101632acbacaf2738b8a7e698b0fb301539163edc713a37e74df0a6d233d689" },
    { role: "task8", signerId: "checker-task8", publicKeyDigest: digest("8"), verifierVersion: "task8-baseline-verifier/v1", verdictDigest: digest("8") },
    { role: "task9", signerId: "checker-task9", publicKeyDigest: digest("9"), verifierVersion: "portable-evidence-verifier/v1", verdictDigest: digest("9") },
  ],
  provenance: { v: "reelier.native-candidate-provenance/v1", source: "clean-export", reproducibility: "hermetic-offline", liveProviderStatus: "absent", credentialStatus: "absent", workflowDispatch: "absent" },
} as unknown as Gate4CandidateBindingV1;

const signer = generateKeyPairSync("ed25519");
const signerId = "hosted-checker";

function job(os: "ubuntu-latest" | "windows-latest", source: "offline-fixture" | "hosted-run" = "offline-fixture") {
  const portable = {
    schema: "reelier.sanitized-portable-outcome-evidence/v1",
    graphDigest: digest("d"),
    graphCount: 1,
    outcomeCollectionDigest: digest("f"),
    outcomeCount: 1,
  };
  const payload = {
    v: "reelier.native-github-hosted-artifact/v1",
    candidate,
    os,
    portable,
    lifecycle: { terminal: true, reconciliation: "matched", noResendCount: 0, cleanupReceipt: digest("c") },
    providerClaim: os === "ubuntu-latest" && source === "hosted-run" ? "verified" : "absent",
    nativeHostRefusedBeforeMutation: os === "windows-latest",
    repo: { publicCommitSha: candidate.publicCommitSha, workflowRef: "refs/heads/codex/reelier-acceleration-design", workflowSha: "03ac48e", runnerSourceCommitSha: "03ac48e", checkoutSha: "03ac48e", verifierSourceCommitSha: "03ac48e" },
    toolchain: { nodeMajor: 20, npmVersion: "10.8.2", runnerImage: os },
    provenance: { source, createdAt: "2026-08-14T12:00:00.000Z", expiresAt: "2026-08-15T12:00:00.000Z", jobId: `${os}-job` },
    skips: { count: 0, reviewed: true },
    status: "completed",
    conclusion: "success",
    secretsScan: "clean",
  };
  const body = { ...payload, artifactDigest: authorityDigest(payload), signerId };
  const signed = { ...body, signature: signAuthorityDigest(signer.privateKey, "authority-evidence", authorityDigest(body)) };
  const bytes = Buffer.from(JSON.stringify(signed), "utf8");
  return { signed, bytes };
}

function bundle(source: "offline-fixture" | "hosted-run" = "offline-fixture"): { value: Gate4HostedBundleV1; bytes: { ubuntu: Uint8Array; windows: Uint8Array } } {
  const ubuntu = job("ubuntu-latest", source);
  const windows = job("windows-latest", source);
  const value = {
    v: "reelier.native-github-hosted-bundle/v1" as const,
    candidate,
    workflow: { runId: "run-123", attempt: 1, source, workflowSha: candidate.publicCommitSha },
    jobs: [ubuntu.signed, windows.signed],
    signerId,
  } as Gate4HostedBundleV1;
  return { value, bytes: { ubuntu: ubuntu.bytes, windows: windows.bytes } };
}

const inputs = () => ({ candidate, now: "2026-08-14T13:00:00.000Z", verifier: { signerId, publicKey: signer.publicKey }, execution: "offline-fixture" as const, expectedRunnerSourceCommitSha: candidate.publicCommitSha });

test("valid Ubuntu and Windows artifact pair remains explicitly insufficient offline", () => {
  const fixture = bundle();
  const result = verifyGate4Bundle(fixture.value, { ...inputs(), artifactBytes: fixture.bytes });
  assert.equal(result.state, "insufficient");
  assert.equal(result.decision, "blocked");
  assert.equal(result.liveProviderClaim, "absent");
  assert.match(result.reasons.join(";"), /offline/i);
});

test("hosted-shaped evidence can only reach founder-decision readiness with an explicit hosted context", () => {
  const fixture = bundle("hosted-run");
  const result = verifyGate4Bundle(fixture.value, { ...inputs(), execution: "hosted-run", artifactBytes: fixture.bytes });
  assert.equal(result.state, "ready-for-founder-decision");
  assert.equal(result.decision, "blocked");
  assert.equal(result.liveProviderClaim, "verified");
});

test("hosted evidence separates the candidate public commit from the runner source commit", () => {
  const fixture = bundle("hosted-run");
  const runnerSourceCommit = "ce33b20";
  const value = structuredClone(fixture.value) as any;
  value.workflow.workflowSha = runnerSourceCommit;
  const bytes = {} as { ubuntu: Uint8Array; windows: Uint8Array };
  for (const item of value.jobs) {
    item.repo.workflowSha = runnerSourceCommit;
    item.repo.checkoutSha = runnerSourceCommit;
    item.repo.verifierSourceCommitSha = runnerSourceCommit;
    item.repo.runnerSourceCommitSha = runnerSourceCommit;
    const { signature: _oldSignature, artifactDigest: _oldDigest, signerId: _oldSigner, ...payload } = item;
    const body = { ...payload, artifactDigest: authorityDigest(payload), signerId };
    Object.assign(item, { ...body, signature: signAuthorityDigest(signer.privateKey, "authority-evidence", authorityDigest(body)) });
    bytes[item.os === "ubuntu-latest" ? "ubuntu" : "windows"] = Buffer.from(JSON.stringify(item), "utf8");
  }
  assert.doesNotThrow(() => verifyGate4Bundle(value, { ...inputs(), execution: "hosted-run", expectedRunnerSourceCommitSha: runnerSourceCommit, artifactBytes: bytes }));
});

test("runner source cannot be substituted when the hosted execution SHA differs", () => {
  const fixture = bundle("hosted-run");
  const runnerSourceCommit = "ce33b20";
  const value = structuredClone(fixture.value) as any;
  value.workflow.workflowSha = runnerSourceCommit;
  const bytes = {} as { ubuntu: Uint8Array; windows: Uint8Array };
  for (const item of value.jobs) {
    item.repo.workflowSha = runnerSourceCommit;
    item.repo.checkoutSha = runnerSourceCommit;
    item.repo.verifierSourceCommitSha = runnerSourceCommit;
    item.repo.runnerSourceCommitSha = runnerSourceCommit;
    const { signature: _oldSignature, artifactDigest: _oldDigest, signerId: _oldSigner, ...payload } = item;
    const body = { ...payload, artifactDigest: authorityDigest(payload), signerId };
    Object.assign(item, { ...body, signature: signAuthorityDigest(signer.privateKey, "authority-evidence", authorityDigest(body)) });
    bytes[item.os === "ubuntu-latest" ? "ubuntu" : "windows"] = Buffer.from(JSON.stringify(item), "utf8");
  }
  assert.throws(() => verifyGate4Bundle(value, { ...inputs(), execution: "hosted-run", expectedRunnerSourceCommitSha: "deadbee", artifactBytes: bytes }), /runner|source|commit|refus/i);
});

test("candidate, artifact, provenance, signature, parity, stale, and skip mutations refuse", () => {
  const fixture = bundle("hosted-run");
  const expected = { ...inputs(), execution: "hosted-run" as const, artifactBytes: fixture.bytes };
  const mutations: Array<[string, (value: any) => void]> = [
    ["candidate", value => { value.candidate = { ...value.candidate, candidateId: digest("0") }; }],
    ["candidate-version", value => { value.candidate = { ...value.candidate, v: "reelier.native-github-candidate/v0" }; }],
    ["candidate-pack", value => { value.candidate = { ...value.candidate, packDigest: digest("0") }; }],
    ["candidate-checker", value => { value.candidate = { ...value.candidate, checkerIdentities: value.candidate.checkerIdentities.map((item: any) => item.role === "task9" ? { ...item, publicKeyDigest: digest("0") } : item) }; }],
    ["candidate-provenance", value => { value.candidate = { ...value.candidate, provenance: { ...value.candidate.provenance, workflowDispatch: "present" } }; }],
    ["artifact", value => { value.jobs[0] = { ...value.jobs[0], artifactDigest: digest("0") }; }],
    ["signature", value => { value.jobs[1] = { ...value.jobs[1], signature: { ...value.jobs[1].signature, sig: Buffer.alloc(64).toString("base64") } }; }],
    ["parity", value => { value.jobs[1] = { ...value.jobs[1], portable: { ...value.jobs[1].portable, graphDigest: digest("0") } }; }],
    ["stale", value => { value.jobs[0] = { ...value.jobs[0], provenance: { ...value.jobs[0].provenance, expiresAt: "2026-08-14T12:30:00.000Z" } }; }],
    ["skip", value => { value.jobs[1] = { ...value.jobs[1], skips: { count: 1, reviewed: false } }; }],
    ["secret", value => { value.jobs[0] = { ...value.jobs[0], canary: "canary-private-token" }; }],
    ["os", value => { value.jobs[1] = { ...value.jobs[1], os: "ubuntu-latest" }; }],
    ["duplicate-job", value => { value.jobs[1] = { ...value.jobs[1], provenance: { ...value.jobs[1].provenance, jobId: value.jobs[0].provenance.jobId } }; }],
    ["failed-job", value => { value.jobs[1] = { ...value.jobs[1], conclusion: "failure" }; }],
    ["skipped-job", value => { value.jobs[1] = { ...value.jobs[1], status: "completed", conclusion: "skipped" }; }],
    ["checkout", value => { value.jobs[0] = { ...value.jobs[0], repo: { ...value.jobs[0].repo, checkoutSha: "deadbee" } }; }],
  ];
  for (const [label, mutate] of mutations) {
    const mutated = structuredClone(fixture.value);
    mutate(mutated);
    assert.throws(() => verifyGate4Bundle(mutated, expected), /refus|invalid|mismatch|stale|secret|signature|candidate|platform|skip/i, label);
  }
});

test("offline fixtures cannot carry a verified provider claim", () => {
  const fixture = bundle();
  const mutated = structuredClone(fixture.value);
  (mutated.jobs as any)[0] = { ...mutated.jobs[0], providerClaim: "verified" };
  assert.throws(() => verifyGate4Bundle(mutated, { ...inputs(), artifactBytes: fixture.bytes }), /offline|provider|claim|refus/i);
});

test("signed Gate 4 decision refuses approval without live evidence and verifies a blocked decision", () => {
  const fixture = bundle();
  const verified = verifyGate4Bundle(fixture.value, { ...inputs(), artifactBytes: fixture.bytes });
  const decision = createGate4Decision(verified, { signerId, privateKey: signer.privateKey, signedAt: "2026-08-14T13:01:00.000Z" });
  assert.equal(decision.decision, "blocked");
  assert.equal(verifyGate4Decision(decision, { signerId, publicKey: signer.publicKey }), "verified");
  assert.throws(() => verifyGate4Decision({ ...decision, decision: "approved", liveProviderClaim: "absent" }, { signerId, publicKey: signer.publicKey }), /approval|live|refus/i);
});

test("authoritative workflow is manual, protected, matrixed, and never dispatches from the verifier", async () => {
  const workflow = await readFile(path.join(process.cwd(), ".github/workflows/native-github-authoritative.yml"), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule|repository_dispatch):/m);
  assert.match(workflow, /environment:\s*\n\s+name:\s*native-github-live/);
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /GITHUB_SHA/);
  assert.match(workflow, /RUNNER_SOURCE_COMMIT/);
  assert.match(workflow, /EXPECTED_RUNNER_SOURCE_COMMIT/);
  assert.match(workflow, /NATIVE_PUBLIC_COMMIT/);
  assert.doesNotMatch(workflow, /git rev-parse HEAD\)\" = \"\$NATIVE_PUBLIC_COMMIT/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /gh api|curl|fetch\(/i);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /Stage retained signed evidence/);
  assert.match(workflow, /test -f "\$BUNDLE_PATH"/);
  assert.match(workflow, /test -f "\$CHECKER_PUBLIC_KEY_PATH"/);
  assert.match(workflow, /\.superpowers\/input/);
  const verifier = await readFile(path.join(process.cwd(), "scripts/verify-native-github-hosted.mjs"), "utf8");
  assert.doesNotMatch(verifier, /workflow_dispatch|gh api|child_process|fetch\(|http:\/\//i);
});
