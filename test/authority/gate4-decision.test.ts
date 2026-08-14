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
  candidateId: "sha256:e46498b6441a44e7de42264ebf243e4462aae6e4c4b3d33ed4276fcc50190e96",
  publicCommitSha: "03ac48e",
  tarballDigest: digest("a"),
  packDigest: digest("b"),
  task8BaselineDigest: digest("8"),
  task9VerificationDigest: digest("9"),
  portableEvidenceContractDigest: digest("e"),
  laneCommits: [
    { laneId: "operator-evidence", commitSha: "c".repeat(40) },
    { laneId: "provider-authority", commitSha: "a".repeat(40) },
    { laneId: "reconciliation-verifier", commitSha: "b".repeat(40) },
  ],
  checkerIdentities: [
    { role: "contract", signerId: "checker-contract", verdictDigest: digest("e") },
    { role: "pack", signerId: "checker-pack", verdictDigest: digest("b") },
    { role: "task8", signerId: "checker-task8", verdictDigest: digest("8") },
    { role: "task9", signerId: "checker-task9", verdictDigest: digest("9") },
  ],
};

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
    repo: { publicCommitSha: candidate.publicCommitSha, workflowRef: "refs/heads/codex/reelier-acceleration-design", workflowSha: "03ac48e" },
    toolchain: { nodeMajor: 20, npmVersion: "10.8.2", runnerImage: os },
    provenance: { source, createdAt: "2026-08-14T12:00:00.000Z", expiresAt: "2026-08-15T12:00:00.000Z", jobId: `${os}-job` },
    skips: { count: 0, reviewed: true },
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

const inputs = () => ({ candidate, now: "2026-08-14T13:00:00.000Z", verifier: { signerId, publicKey: signer.publicKey }, execution: "offline-fixture" as const });

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

test("candidate, artifact, provenance, signature, parity, stale, and skip mutations refuse", () => {
  const fixture = bundle("hosted-run");
  const expected = { ...inputs(), execution: "hosted-run" as const, artifactBytes: fixture.bytes };
  const mutations: Array<[string, (value: any) => void]> = [
    ["candidate", value => { value.candidate = { ...value.candidate, candidateId: digest("0") }; }],
    ["artifact", value => { value.jobs[0] = { ...value.jobs[0], artifactDigest: digest("0") }; }],
    ["signature", value => { value.jobs[1] = { ...value.jobs[1], signature: { ...value.jobs[1].signature, sig: Buffer.alloc(64).toString("base64") } }; }],
    ["parity", value => { value.jobs[1] = { ...value.jobs[1], portable: { ...value.jobs[1].portable, graphDigest: digest("0") } }; }],
    ["stale", value => { value.jobs[0] = { ...value.jobs[0], provenance: { ...value.jobs[0].provenance, expiresAt: "2026-08-14T12:30:00.000Z" } }; }],
    ["skip", value => { value.jobs[1] = { ...value.jobs[1], skips: { count: 1, reviewed: false } }; }],
    ["secret", value => { value.jobs[0] = { ...value.jobs[0], canary: "canary-private-token" }; }],
    ["os", value => { value.jobs[1] = { ...value.jobs[1], os: "ubuntu-latest" }; }],
  ];
  for (const [label, mutate] of mutations) {
    const mutated = structuredClone(fixture.value);
    mutate(mutated);
    assert.throws(() => verifyGate4Bundle(mutated, expected), /refus|invalid|mismatch|stale|secret|signature|candidate|platform|skip/i, label);
  }
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
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /gh api|curl|fetch\(/i);
  const verifier = await readFile(path.join(process.cwd(), "scripts/verify-native-github-hosted.mjs"), "utf8");
  assert.doesNotMatch(verifier, /workflow_dispatch|gh api|child_process|fetch\(|http:\/\//i);
});
