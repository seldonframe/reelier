import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  createSignedReleaseAuthorizationBundleV1,
  createSignedReleaseOperationPlanV1,
  createSignedReleasePolicyV1,
  createSignedReleaseVerifierEvidenceV1,
  createSignedStagedCandidateManifestV1,
  type ReleaseEvidenceLaneV1,
} from "../../src/authority/release-contracts.js";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";

const scriptPath = path.resolve("scripts/verify-release-authorization.mjs");
const barrelUrl = pathToFileURL(path.resolve("dist-test/src/authority/index.js")).href;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const sha = (character: string): string => character.repeat(40);
const canonical = (value: unknown): string => authorityCanonicalBytes(value).toString("utf8");
const spki = (key: KeyObject): string => key.export({ format: "der", type: "spki" }).toString("base64");
const spkiDigest = (key: KeyObject): string => `sha256:${createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex")}`;

const authorityKeys = generateKeyPairSync("ed25519");
const foreignKeys = generateKeyPairSync("ed25519");
const evidenceKeys = generateKeyPairSync("ed25519");
const graphKeys = generateKeyPairSync("ed25519");
const evidenceSigner = { privateKey: evidenceKeys.privateKey, signerId: "release-provider-verifier" };
const allLanes: ReleaseEvidenceLaneV1[] = [
  "ci-coverage", "ci-full-tests", "ci-mutation", "candidate-branch", "candidate-pull-request", "ghcr-immutable-manifest",
  "ghcr-tags", "human-authorization", "human-exceptions", "human-interruptions", "human-post-release-review",
  "installed-linux", "installed-windows", "mcp-registry-version", "merge-exact-sha", "npm-integrity", "npm-provenance", "tag-immutable-ref",
];

/** The closed on-ref / on-disk artifact-set layout the Cell's mission tooling writes. */
const ARTIFACT_FILE_NAMES = {
  authorization: "authorization.json",
  candidateManifest: "candidate-manifest.json",
  "ci-coverage": "quality-evidence-ci-coverage.json",
  "ci-full-tests": "quality-evidence-ci-full-tests.json",
  "ci-mutation": "quality-evidence-ci-mutation.json",
  operationPlan: "operation-plan.json",
  policy: "policy.json",
} as const;

// R2 frozen-contract amendment (operator exception, 2026-08-19): the base commit travels in the
// signed bundle rather than a compiled-in constant, so it is a fixture knob here, not a pin.
const REVIEWED_BASE = "e600ad5c2dc5e1bde0714915e7a84980c8d5602b";
const AMENDED_BASE = "80c8084c1f2d3a4b5c6d7e8f9012345678abcdef";

interface FixtureOptions {
  readonly baseCommit?: string;
  readonly issuedAtMs?: number;
  readonly packedTarballDigest?: string;
  readonly signingKey?: KeyObject;
}

/** Builds a real, live-valid signed artifact set with the same helpers release-contracts.test.ts uses. */
function buildArtifactSet(options: FixtureOptions = {}): Record<string, string> {
  const issuedAtMs = options.issuedAtMs ?? Date.now() - 60_000;
  const baseCommit = options.baseCommit ?? REVIEWED_BASE;
  const signer = { privateKey: options.signingKey ?? authorityKeys.privateKey, signerId: "release-authority-2026" };
  const issuedAt = new Date(issuedAtMs).toISOString();
  const expiresAt = new Date(issuedAtMs + 43_200_000).toISOString();
  const observedAt = new Date(issuedAtMs + 30_000).toISOString();
  const files = [
    { blobSha: sha("b"), contentDigest: digest("b"), mode: "100644" as const, path: "CHANGELOG.md" },
    { blobSha: sha("c"), contentDigest: digest("c"), mode: "100644" as const, path: "src/cli.ts" },
    { blobSha: sha("d"), contentDigest: digest("d"), mode: "100644" as const, path: "test/cli-subcommand-help.test.ts" },
  ];
  const candidateTreeDigest = authorityDigest({ files, v: "reelier.release-candidate-tree/v1" });
  const workflows = [
    { digest: digest("3"), path: ".github/workflows/ci.yml" },
    { digest: digest("4"), path: ".github/workflows/docker-publish.yml" },
    { digest: digest("5"), path: ".github/workflows/mcp-publish.yml" },
    { digest: digest("6"), path: ".github/workflows/npm-publish.yml" },
  ];
  const operationPlan = createSignedReleaseOperationPlanV1({
    baseCommit,
    baseTreeSha: sha("b"),
    candidateBranch: "reelier/release/0.32.1",
    candidateTreeDigest,
    commit: {
      author: { date: issuedAt, email: "release@seldonframe.com", name: "SeldonFrame Release" },
      committer: { date: issuedAt, email: "release@seldonframe.com", name: "SeldonFrame Release" },
      message: "release: v0.32.1",
      parentSha: baseCommit,
    },
    destinationBranch: "main",
    expectedCommitSha: sha("a"),
    expectedTreeSha: sha("e"),
    files,
    npmPreflight: { packageName: "reelier", version: "0.32.1", versionMustBeAbsent: true },
    pullRequest: { base: "main", body: "Governed release v0.32.1", draft: true, head: "reelier/release/0.32.1", readyForReview: true, title: "Release v0.32.1" },
    repository: "seldonframe/reelier",
    requiredChecks: ["coverage", "full-tests", "mutation"],
    squash: { commitMessage: "release: v0.32.1", commitTitle: "Release v0.32.1" },
    tag: "v0.32.1",
    v: "reelier.release-operation-plan/v1",
    workflowCommitments: workflows,
  }, signer);
  const candidateManifest = createSignedStagedCandidateManifestV1({
    baseCommit,
    branch: "reelier/release/0.32.1",
    candidateCommit: sha("a"),
    candidateTreeDigest,
    changedBytes: 4_096,
    changedPaths: files.map(file => file.path),
    destinationBranch: "main",
    packageName: "reelier",
    packageVersion: "0.32.1",
    packedTarballDigest: options.packedTarballDigest ?? digest("2"),
    qualityEvidence: {
      coverageEvidenceDigest: digest("7"),
      coverageStatus: "non-regressed",
      fullTestEvidenceDigest: digest("8"),
      fullTestsStatus: "verified",
      headCommit: sha("a"),
      mutationEvidenceDigest: digest("9"),
      mutationScoreBasisPoints: 9_500,
    },
    repository: "seldonframe/reelier",
    tag: "v0.32.1",
    v: "reelier.staged-candidate-manifest/v1",
    workflowCommitments: workflows,
  }, signer);
  const policy = createSignedReleasePolicyV1({
    allowedPaths: files.map(file => file.path),
    destinations: ["ghcr", "mcp-registry", "npm"],
    effectAllocations: ["candidate-branch", "draft-pr", "exact-sha-merge", "non-force-tag"],
    expirySeconds: 43_200,
    forbiddenChangeClasses: ["authority-contract", "credential", "dependency", "generated-contract", "lockfile", "policy", "release-script", "workflow"],
    maxChangedBytes: 65_536,
    maxChangedFiles: 3,
    v: "reelier.release-policy/v1",
  }, signer);
  const effects = ["candidate-branch", "draft-pr", "exact-sha-merge", "non-force-tag"] as const;
  const authorization = createSignedReleaseAuthorizationBundleV1({
    authorityCellDigest: digest("a"),
    effectAllocations: effects.map((effect, index) => ({ allocationDigest: digest(String(index + 1)), allocationId: `release-${effect}-01`, effect, maxEffects: 1 as const })),
    evidenceVerifierBindings: allLanes.map(lane => ({ lane, publicKeySpkiDigest: spkiDigest(evidenceKeys.publicKey), signerId: evidenceSigner.signerId })),
    expiresAt,
    issuedAt,
    jobCardDigest: digest("b"),
    missionDigest: digest("c"),
    operationPlanDigest: operationPlan.digest,
    packDigest: digest("d"),
    policyDigest: policy.digest,
    receiptGraphMakerBinding: { publicKeySpkiDigest: spkiDigest(graphKeys.publicKey), signerId: "release-graph-maker-2026" },
    rootGrantDigest: digest("e"),
    stagedCandidateManifestDigest: candidateManifest.digest,
    taskDigest: digest("f"),
    v: "reelier.release-authorization-bundle/v1",
  }, signer);
  const evidenceEntries = ([["ci-coverage", digest("7"), 1], ["ci-full-tests", digest("8"), 1], ["ci-mutation", digest("9"), 9_500]] as const).map(([lane, subjectDigest, resultValue]) => ({
    lane,
    text: canonical({
      evidence: canonical(createSignedReleaseVerifierEvidenceV1({
        authorizationBundleDigest: null,
        candidateCommit: sha("a"),
        count: null,
        freshUntil: null,
        lane,
        observation: "workflow-run",
        observedAt,
        resultValue,
        status: "verified",
        subjectDigest,
        v: "reelier.release-verifier-evidence/v1",
        workflowDigest: digest("3"),
        workflowPath: ".github/workflows/ci.yml",
      }, evidenceSigner)),
      verifier: { publicKeySpkiBase64: spki(evidenceKeys.publicKey), signerId: evidenceSigner.signerId },
    }),
  }));
  return {
    [ARTIFACT_FILE_NAMES.authorization]: canonical(authorization),
    [ARTIFACT_FILE_NAMES.candidateManifest]: canonical(candidateManifest),
    [ARTIFACT_FILE_NAMES.operationPlan]: canonical(operationPlan),
    [ARTIFACT_FILE_NAMES.policy]: canonical(policy),
    ...Object.fromEntries(evidenceEntries.map(entry => [ARTIFACT_FILE_NAMES[entry.lane], entry.text])),
  };
}

function trustPin(publicKey: KeyObject, signerId = "release-authority-2026"): string {
  return `${JSON.stringify({ publicKeySpkiBase64: spki(publicKey), signerId, v: "reelier.release-authorization-trust-pin/v1" }, null, 2)}\n`;
}

function scratch(): string {
  return mkdtempSync(path.join(os.tmpdir(), "reelier-verify-release-"));
}

function writeArtifactDir(root: string, files: Record<string, string>, name = "artifacts"): string {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  // A trailing newline is the ordinary shape of a git blob / checked-out file; the verifier must
  // tolerate exactly one and still hold every other byte to the canonical form.
  for (const [file, text] of Object.entries(files)) writeFileSync(path.join(dir, file), `${text}\n`, "utf8");
  return dir;
}

/** The single-file `reelier.release-authorization-transport/v1` envelope form of the same set. */
function envelopeText(files: Record<string, string>): string {
  return JSON.stringify({
    artifacts: {
      authorization: files[ARTIFACT_FILE_NAMES.authorization],
      candidateManifest: files[ARTIFACT_FILE_NAMES.candidateManifest],
      operationPlan: files[ARTIFACT_FILE_NAMES.operationPlan],
      policy: files[ARTIFACT_FILE_NAMES.policy],
    },
    qualityEvidence: (["ci-coverage", "ci-full-tests", "ci-mutation"] as const).map(lane => JSON.parse(files[ARTIFACT_FILE_NAMES[lane]]!)),
    v: "reelier.release-authorization-transport/v1",
  });
}

interface RunOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}

function runVerifier(args: readonly string[], options: RunOptions = {}): { status: number | null; stderr: string; stdout: string } {
  const environment: Record<string, string> = { ...(process.env as Record<string, string>), GITHUB_REF_NAME: "", REELIER_RELEASE_BARREL: barrelUrl };
  delete environment.REELIER_RELEASE_SIGNER_ID;
  delete environment.REELIER_RELEASE_SIGNER_SPKI;
  Object.assign(environment, options.env ?? {});
  const run = spawnSync(process.execPath, [scriptPath, ...args], { cwd: options.cwd, encoding: "utf8", env: environment });
  return { status: run.status, stderr: run.stderr ?? "", stdout: run.stdout ?? "" };
}

function gitRepo(root: string): string {
  const repo = path.join(root, "scratch-repo");
  const git = (...args: string[]): void => {
    const run = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
  };
  assert.equal(spawnSync("git", ["init", "--initial-branch=main", repo], { encoding: "utf8" }).status, 0);
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("config", "core.autocrlf", "false");
  return repo;
}

function commitArtifactRef(repo: string, files: Record<string, string>, ref: string): void {
  const git = (...args: string[]): void => {
    const run = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(repo, name), `${text}\n`, "utf8");
  git("add", ".");
  git("commit", "-m", "release authorization artifacts");
  git("update-ref", ref, "HEAD");
}

test("--help prints usage, exits 0, and verifies nothing", () => {
  const run = runVerifier(["--help"]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /verify-release-authorization\.mjs/);
  assert.match(run.stdout, /--trust-pin/);
  assert.doesNotMatch(run.stdout, /release authorization verified/);
  assert.equal(run.stderr, "");
  // Help must stay side-effect free even when a bogus source and an unreadable pin are also present.
  const noisy = runVerifier(["--dir", path.join(os.tmpdir(), "does-not-exist-reelier"), "--trust-pin", path.join(os.tmpdir(), "no-pin.json"), "--help"]);
  assert.equal(noisy.status, 0, noisy.stderr);
  assert.equal(noisy.stderr, "");
});

test("no arguments fails closed with an actionable reason", () => {
  const run = runVerifier([]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /artifact source is required/i);
});

test("verifier accepts a live artifact directory, checks the tarball, and emits the verified summary", () => {
  const root = scratch();
  try {
    const tarballBytes = Buffer.from("packed-tarball-fixture-bytes");
    const tarballDigest = `sha256:${createHash("sha256").update(tarballBytes).digest("hex")}`;
    const dir = writeArtifactDir(root, buildArtifactSet({ packedTarballDigest: tarballDigest }));
    const pinPath = path.join(root, "pin.json");
    writeFileSync(pinPath, trustPin(authorityKeys.publicKey), "utf8");
    const tarballPath = path.join(root, "reelier-0.32.1.tgz");
    writeFileSync(tarballPath, tarballBytes);
    const emitPath = path.join(root, "summary.json");
    const run = runVerifier(["--dir", dir, "--trust-pin", pinPath, "--tag", "v0.32.1", "--tarball", tarballPath, "--emit", emitPath]);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^release authorization verified: sha256:[0-9a-f]{64} /);
    assert.match(run.stdout, /NOT CHECKED: receipt-graph verification/);
    assert.match(run.stdout, /NOT CHECKED: HEAD/);
    const summary = JSON.parse(readFileSync(emitPath, "utf8"));
    assert.equal(summary.v, "reelier.release-verification-summary/v1");
    assert.equal(summary.tag, "v0.32.1");
    assert.equal(summary.packageVersion, "0.32.1");
    assert.equal(summary.packedTarballDigest, tarballDigest);
    assert.equal(summary.candidateCommit, sha("a"));
    assert.match(summary.authorizationBundleDigest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(summary.checks.packedTarball, "verified");
    assert.equal(summary.checks.headCommit, "unchecked");
    assert.equal(summary.checks.receiptGraph, "unchecked");
  } finally { rmSync(root, { force: true, recursive: true }); }
});

// R2 frozen-contract amendment (operator exception, 2026-08-19). The offline verifier is data-driven
// on the base: it grades HEAD's parent against plan.baseCommit, never against a compiled-in value.
// A base other than the originally reviewed one must verify on exactly the same terms.
test("R2 amendment: the offline verifier accepts a signed artifact set carrying a base commit other than the originally reviewed one", () => {
  const root = scratch();
  try {
    const dir = writeArtifactDir(root, buildArtifactSet({ baseCommit: AMENDED_BASE }));
    const pinPath = path.join(root, "pin.json");
    writeFileSync(pinPath, trustPin(authorityKeys.publicKey), "utf8");
    const emitPath = path.join(root, "summary.json");
    const run = runVerifier(["--dir", dir, "--trust-pin", pinPath, "--tag", "v0.32.1", "--emit", emitPath]);
    assert.equal(run.status, 0, run.stderr);
    const plan = JSON.parse(readFileSync(path.join(dir, ARTIFACT_FILE_NAMES.operationPlan), "utf8"));
    assert.equal(plan.value.baseCommit, AMENDED_BASE);
    assert.notEqual(AMENDED_BASE, REVIEWED_BASE);
    assert.equal(JSON.parse(readFileSync(emitPath, "utf8")).checks.headCommit, "unchecked");
  } finally { rmSync(root, { force: true, recursive: true }); }
});

test("verifier reads the out-of-band authorization ref from a real git clone", () => {
  const root = scratch();
  try {
    const repo = gitRepo(root);
    const ref = "refs/reelier/release-authorizations/v0.32.1";
    commitArtifactRef(repo, buildArtifactSet(), ref);
    const pinPath = path.join(root, "pin.json");
    writeFileSync(pinPath, trustPin(authorityKeys.publicKey), "utf8");
    const run = runVerifier(["--ref", ref, "--trust-pin", pinPath, "--tag", "v0.32.1"], { cwd: repo });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^release authorization verified: sha256:/);
    const absent = runVerifier(["--ref", "refs/reelier/release-authorizations/v9.9.9", "--trust-pin", pinPath, "--tag", "v0.32.1"], { cwd: repo });
    assert.equal(absent.status, 1);
    assert.match(absent.stderr, /authorization ref .* is absent/i);
  } finally { rmSync(root, { force: true, recursive: true }); }
});

test("verifier refuses an artifact set signed by an untrusted signer", () => {
  const root = scratch();
  try {
    const dir = writeArtifactDir(root, buildArtifactSet({ signingKey: foreignKeys.privateKey }));
    const pinPath = path.join(root, "pin.json");
    writeFileSync(pinPath, trustPin(authorityKeys.publicKey), "utf8");
    const run = runVerifier(["--dir", dir, "--trust-pin", pinPath, "--tag", "v0.32.1"]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /refused/i);
    assert.match(run.stderr, /signature is invalid/i);
  } finally { rmSync(root, { force: true, recursive: true }); }
});

test("verifier refuses a tampered canonical artifact string", () => {
  const root = scratch();
  try {
    const files = buildArtifactSet();
    files[ARTIFACT_FILE_NAMES.candidateManifest] = files[ARTIFACT_FILE_NAMES.candidateManifest]!.replace("staged-candidate-manifest/v1", "staged-candidate-manifest/v2");
    const dir = writeArtifactDir(root, files);
    const pinPath = path.join(root, "pin.json");
    writeFileSync(pinPath, trustPin(authorityKeys.publicKey), "utf8");
    const run = runVerifier(["--dir", dir, "--trust-pin", pinPath, "--tag", "v0.32.1"]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /refused|invalid|canonical/i);
  } finally { rmSync(root, { force: true, recursive: true }); }
});

// Each artifact gets its own case: three of the four signed artifacts are held canonical by the
// barrel's parseCanonicalSigned* entries, but the operation plan and the quality-evidence wrapper
// have no exported canonical-string parser, so the script's own guard is the only thing on them.
// A case that perturbs several artifacts at once would pass on the barrel's guard alone and leave
// the hand-rolled ones unpinned.
for (const target of [
  { key: ARTIFACT_FILE_NAMES.authorization, label: "authorization bundle (barrel-guarded)" },
  { key: ARTIFACT_FILE_NAMES.candidateManifest, label: "candidate manifest (barrel-guarded)" },
  { key: ARTIFACT_FILE_NAMES.policy, label: "release policy (barrel-guarded)" },
  { key: ARTIFACT_FILE_NAMES.operationPlan, label: "operation plan (script-guarded)" },
  { key: ARTIFACT_FILE_NAMES["ci-coverage"], label: "quality evidence wrapper (script-guarded)" },
]) {
  test(`verifier refuses a non-canonical encoding of the ${target.label}`, () => {
    const root = scratch();
    try {
      const files = buildArtifactSet();
      files[target.key] = JSON.stringify(JSON.parse(files[target.key]!), null, 2);
      const dir = writeArtifactDir(root, files);
      const pinPath = path.join(root, "pin.json");
      writeFileSync(pinPath, trustPin(authorityKeys.publicKey), "utf8");
      const run = runVerifier(["--dir", dir, "--trust-pin", pinPath, "--tag", "v0.32.1"]);
      assert.equal(run.status, 1, run.stdout);
      assert.match(run.stderr, /canonical/i);
    } finally { rmSync(root, { force: true, recursive: true }); }
  });
}

test("verifier refuses a non-canonical encoding of the inner signed quality evidence", () => {
  const root = scratch();
  try {
    const files = buildArtifactSet();
    const wrapper = JSON.parse(files[ARTIFACT_FILE_NAMES["ci-mutation"]]!);
    files[ARTIFACT_FILE_NAMES["ci-mutation"]] = canonical({ evidence: JSON.stringify(JSON.parse(wrapper.evidence), null, 2), verifier: wrapper.verifier });
    const dir = writeArtifactDir(root, files);
    const pinPath = path.join(root, "pin.json");
    writeFileSync(pinPath, trustPin(authorityKeys.publicKey), "utf8");
    const run = runVerifier(["--dir", dir, "--trust-pin", pinPath, "--tag", "v0.32.1"]);
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stderr, /ci-mutation quality evidence .* is not RFC 8785\/JCS canonical/);
  } finally { rmSync(root, { force: true, recursive: true }); }
});

test("verifier refuses an expired authorization with new Date() as the clock", () => {
  const root = scratch();
  try {
    const dir = writeArtifactDir(root, buildArtifactSet({ issuedAtMs: Date.now() - 13 * 3_600_000 }));
    const pinPath = path.join(root, "pin.json");
    writeFileSync(pinPath, trustPin(authorityKeys.publicKey), "utf8");
    const run = runVerifier(["--dir", dir, "--trust-pin", pinPath, "--tag", "v0.32.1"]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /expired/i);
  } finally { rmSync(root, { force: true, recursive: true }); }
});

test("verifier refuses a wrong tag, an absent tag, and a wrong tarball digest", () => {
  const root = scratch();
  try {
    const dir = writeArtifactDir(root, buildArtifactSet());
    const pinPath = path.join(root, "pin.json");
    writeFileSync(pinPath, trustPin(authorityKeys.publicKey), "utf8");
    const wrongTag = runVerifier(["--dir", dir, "--trust-pin", pinPath, "--tag", "v9.9.9"]);
    assert.equal(wrongTag.status, 1);
    assert.match(wrongTag.stderr, /does not equal the signed release tag/);
    const noTag = runVerifier(["--dir", dir, "--trust-pin", pinPath]);
    assert.equal(noTag.status, 1);
    assert.match(noTag.stderr, /release tag name is unavailable/);
    const tarballPath = path.join(root, "other.tgz");
    writeFileSync(tarballPath, Buffer.from("different-bytes"));
    const wrongTarball = runVerifier(["--dir", dir, "--trust-pin", pinPath, "--tag", "v0.32.1", "--tarball", tarballPath]);
    assert.equal(wrongTarball.status, 1);
    assert.match(wrongTarball.stderr, /packedTarballDigest/);
  } finally { rmSync(root, { force: true, recursive: true }); }
});

test("--check-head executes real git readback and refuses a non-matching head", () => {
  const root = scratch();
  try {
    const dir = writeArtifactDir(root, buildArtifactSet());
    const pinPath = path.join(root, "pin.json");
    writeFileSync(pinPath, trustPin(authorityKeys.publicKey), "utf8");
    const repo = gitRepo(root);
    const git = (...args: string[]): void => {
      const run = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
    };
    writeFileSync(path.join(repo, "a.txt"), "one");
    git("add", "."); git("commit", "-m", "one");
    writeFileSync(path.join(repo, "a.txt"), "two");
    git("add", "."); git("commit", "-m", "two");
    const run = runVerifier(["--dir", dir, "--trust-pin", pinPath, "--tag", "v0.32.1", "--check-head"], { cwd: repo });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /HEAD tree .* does not equal the signed expected tree/);
  } finally { rmSync(root, { force: true, recursive: true }); }
});

test("verifier refuses a missing trust pin, a malformed trust pin, and a pin naming a different signer", () => {
  const root = scratch();
  try {
    const dir = writeArtifactDir(root, buildArtifactSet());
    const missing = runVerifier(["--dir", dir, "--trust-pin", path.join(root, "absent.json"), "--tag", "v0.32.1"]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /trust pin/i);
    const malformed = path.join(root, "malformed.json");
    writeFileSync(malformed, `${JSON.stringify({ publicKeySpkiBase64: spki(authorityKeys.publicKey) })}\n`, "utf8");
    const bad = runVerifier(["--dir", dir, "--trust-pin", malformed, "--tag", "v0.32.1"]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /trust pin/i);
    const wrongSigner = path.join(root, "wrong-signer.json");
    writeFileSync(wrongSigner, trustPin(authorityKeys.publicKey, "release-authority-other"), "utf8");
    const mismatched = runVerifier(["--dir", dir, "--trust-pin", wrongSigner, "--tag", "v0.32.1"]);
    assert.equal(mismatched.status, 1);
    assert.match(mismatched.stderr, /signature is invalid/i);
  } finally { rmSync(root, { force: true, recursive: true }); }
});

test("verifier refuses environment-supplied signer pins (R4: the pin is file-committed)", () => {
  const root = scratch();
  try {
    const dir = writeArtifactDir(root, buildArtifactSet());
    const pinPath = path.join(root, "pin.json");
    writeFileSync(pinPath, trustPin(authorityKeys.publicKey), "utf8");
    const run = runVerifier(["--dir", dir, "--trust-pin", pinPath, "--tag", "v0.32.1"], { env: { REELIER_RELEASE_SIGNER_ID: "release-authority-2026", REELIER_RELEASE_SIGNER_SPKI: spki(authorityKeys.publicKey) } });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /REELIER_RELEASE_SIGNER_(ID|SPKI)/);
    assert.match(run.stderr, /trust pin/i);
  } finally { rmSync(root, { force: true, recursive: true }); }
});

test("verifier refuses an artifact set that is missing or over-populated", () => {
  const root = scratch();
  try {
    const pinPath = path.join(root, "pin.json");
    writeFileSync(pinPath, trustPin(authorityKeys.publicKey), "utf8");
    const incomplete = buildArtifactSet();
    delete incomplete[ARTIFACT_FILE_NAMES["ci-mutation"]];
    const missingDir = writeArtifactDir(root, incomplete);
    const missing = runVerifier(["--dir", missingDir, "--trust-pin", pinPath, "--tag", "v0.32.1"]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /quality-evidence-ci-mutation\.json/);
    const extraDir = writeArtifactDir(root, buildArtifactSet(), "over-populated");
    writeFileSync(path.join(extraDir, "notes.txt"), "extra\n", "utf8");
    const extra = runVerifier(["--dir", extraDir, "--trust-pin", pinPath, "--tag", "v0.32.1"]);
    assert.equal(extra.status, 1);
    assert.match(extra.stderr, /notes\.txt/);
  } finally { rmSync(root, { force: true, recursive: true }); }
});

test("verifier accepts and refuses the single-file transport envelope on the same terms", () => {
  const root = scratch();
  try {
    const pinPath = path.join(root, "pin.json");
    writeFileSync(pinPath, trustPin(authorityKeys.publicKey), "utf8");
    const good = path.join(root, "artifact-set.json");
    writeFileSync(good, envelopeText(buildArtifactSet()), "utf8");
    const run = runVerifier(["--artifact-set", good, "--trust-pin", pinPath, "--tag", "v0.32.1"]);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^release authorization verified: sha256:/);
    const widened = JSON.parse(envelopeText(buildArtifactSet()));
    widened.extra = "not in the closed envelope";
    const bad = path.join(root, "widened.json");
    writeFileSync(bad, JSON.stringify(widened), "utf8");
    const refused = runVerifier(["--artifact-set", bad, "--trust-pin", pinPath, "--tag", "v0.32.1"]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /envelope/i);
  } finally { rmSync(root, { force: true, recursive: true }); }
});

test("verifier refuses the retired --from-tag carrier and the retired inline signer flags", () => {
  const retiredCarrier = runVerifier(["--from-tag", "v0.32.1"]);
  assert.equal(retiredCarrier.status, 1);
  assert.match(retiredCarrier.stderr, /--ref refs\/reelier\/release-authorizations/);
  for (const flag of ["--signer-id", "--signer-spki-base64"]) {
    const run = runVerifier([flag, "whatever"]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /--trust-pin/);
  }
});
