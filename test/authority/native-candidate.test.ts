import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { authorityDigest } from "../../src/authority/wire.js";
import { verifyNativeCandidate, createNativeCandidate } from "../../src/authority/certification/native-candidate.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const bytes = Buffer.from("hermetic-native-tarball-v1", "utf8");
const tarballDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const lanes = [
  { laneId: "operator-evidence", commitSha: "cccccccccccccccccccccccccccccccccccccccc" },
  { laneId: "provider-authority", commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  { laneId: "reconciliation-verifier", commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
] as const;
const packDigest = authorityDigest({ v: "reelier.native-pack/v1", publicCommitSha: "03ac48e", tarballDigest, laneCommits: lanes });
const checkers = [
  { role: "contract", signerId: "checker-contract", publicKeyDigest: digest("c"), verifierVersion: "authority-contract-checker/v1", verdictDigest: digest("e") },
  { role: "pack", signerId: "checker-pack", publicKeyDigest: digest("d"), verifierVersion: "packed-consumer/v1", verdictDigest: packDigest },
  { role: "task8", signerId: "checker-task8", publicKeyDigest: digest("8"), verifierVersion: "task8-baseline-verifier/v1", verdictDigest: digest("8") },
  { role: "task9", signerId: "checker-task9", publicKeyDigest: digest("9"), verifierVersion: "portable-evidence-verifier/v1", verdictDigest: digest("e") },
] as const;

function input() {
  return {
    publicCommitSha: "03ac48e",
    tarballBytes: bytes,
    task8Verification: { status: "verified" as const, digest: digest("8") },
    task9Verification: { status: "verified" as const, digest: digest("9") },
    laneCommits: lanes,
    packDigest,
    portableEvidenceContractDigest: digest("e"),
    checkerIdentities: checkers,
  };
}

test("native candidate creation is hermetic and verification is content addressed", () => {
  const created = createNativeCandidate(input());
  assert.equal(created.candidate.candidateId, created.digest);
  assert.equal(created.candidate.tarballDigest, tarballDigest);
  assert.equal(created.candidate.task9VerificationDigest, digest("9"));
  assert.equal(created.candidate.provenance.liveProviderStatus, "absent");
  assert.deepEqual(verifyNativeCandidate(created.candidate, { tarballBytes: bytes, publicCommitSha: "03ac48e", task8BaselineDigest: digest("8"), task9VerificationDigest: digest("9"), portableEvidenceContractDigest: digest("e") }), { status: "verified", candidateDigest: created.digest });
});

test("candidate identity binds the exact accepted Task 9 verification verdict", () => {
  const first = createNativeCandidate(input());
  const second = createNativeCandidate({ ...input(), task9Verification: { status: "verified", digest: digest("a") } });
  assert.notEqual(second.digest, first.digest);
  const expected = { tarballBytes: bytes, publicCommitSha: "03ac48e", task8BaselineDigest: digest("8"), task9VerificationDigest: digest("9"), portableEvidenceContractDigest: digest("e") };
  assert.throws(() => verifyNativeCandidate(second.candidate, expected), /Task 9|verdict|digest/i);
});

test("candidate creation refuses missing acceptance and verifier refuses every binding mutation", () => {
  assert.throws(() => createNativeCandidate({ ...input(), task9Verification: { status: "unchecked", digest: digest("9") } } as any), /Task 9|verified/i);
  const candidate = createNativeCandidate(input()).candidate as any;
  const expected = { tarballBytes: bytes, publicCommitSha: "03ac48e", task8BaselineDigest: digest("8"), task9VerificationDigest: digest("9"), portableEvidenceContractDigest: digest("e") };
  for (const [label, mutation] of [
    ["commit", { publicCommitSha: "deadbee" }],
    ["tarball", { tarballBytes: Buffer.from("substituted") }],
    ["baseline", { task8BaselineDigest: digest("f") }],
    ["contract", { portableEvidenceContractDigest: digest("f") }],
  ] as const) {
    const mutated = { ...candidate, ...(label === "commit" ? { publicCommitSha: "deadbee" } : {}), ...(label === "tarball" ? {} : {}) };
    if (label === "tarball") assert.throws(() => verifyNativeCandidate(candidate, { ...expected, ...mutation } as any), /tarball/i);
    else if (label === "commit") assert.throws(() => verifyNativeCandidate(mutated, expected), /commit|candidate/i);
    else assert.throws(() => verifyNativeCandidate(candidate, { ...expected, ...mutation } as any), /digest|baseline|contract/i);
  }
  assert.throws(() => verifyNativeCandidate({ ...candidate, laneCommits: [candidate.laneCommits[0], candidate.laneCommits[0], ...candidate.laneCommits.slice(2)] }, expected), /lane|duplicate|digest/i);
  assert.throws(() => verifyNativeCandidate({ ...candidate, checkerIdentities: [...candidate.checkerIdentities, candidate.checkerIdentities[0]] }, expected), /checker|duplicate|closed/i);
  assert.throws(() => verifyNativeCandidate({ ...candidate, provenance: { ...candidate.provenance, liveProviderStatus: "verified" } }, expected), /provenance|live/i);
  assert.throws(() => verifyNativeCandidate({ ...candidate, secret: "canary-private-token" }, expected), /closed|secret/i);
});

test("non-JCS candidate bytes and stale or unknown provenance refuse", () => {
  const candidate = createNativeCandidate(input()).candidate;
  const raw = JSON.stringify(candidate, null, 2);
  assert.throws(() => verifyNativeCandidate(raw, { tarballBytes: bytes, publicCommitSha: "03ac48e", task8BaselineDigest: digest("8"), task9VerificationDigest: digest("9"), portableEvidenceContractDigest: digest("e") }), /canonical|JCS/i);
  assert.throws(() => verifyNativeCandidate({ ...candidate, laneCommits: [...candidate.laneCommits, { laneId: "unknown", commitSha: "d".repeat(40) }] }, { tarballBytes: bytes, publicCommitSha: "03ac48e", task8BaselineDigest: digest("8"), task9VerificationDigest: digest("9"), portableEvidenceContractDigest: digest("e") }), /lane|unknown|closed/i);
});
