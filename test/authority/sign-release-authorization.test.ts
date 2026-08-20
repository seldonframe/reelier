import assert from "node:assert/strict";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const signScript = path.resolve("scripts/sign-release-authorization.mjs");
const verifyScript = path.resolve("scripts/verify-release-authorization.mjs");
const barrelUrl = pathToFileURL(path.resolve("dist-test/src/authority/index.js")).href;
const repoRoot = path.resolve(".");

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const sha = (character: string): string => character.repeat(40);
const spki = (key: KeyObject): string => key.export({ format: "der", type: "spki" }).toString("base64");
const spkiDigest = (key: KeyObject): string => `sha256:${createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex")}`;

/** The four workflow files are read from this repository's real bytes, which is the whole point of
 * the commitment: a signed digest that was not computed from a real blob proves nothing. */
const workflowCommit = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const EXPECTED_FILES = [
  "authorization.json", "candidate-manifest.json", "operation-plan.json", "policy.json",
  "quality-evidence-ci-coverage.json", "quality-evidence-ci-full-tests.json", "quality-evidence-ci-mutation.json",
].sort();

interface Workspace {
  readonly root: string;
  readonly keysDir: string;
  readonly outDir: string;
  readonly parametersFile: string;
  readonly trustPinFile: string;
  readonly authorizationKeys: ReturnType<typeof generateKeyPairSync>;
}

function baseParameters(): Record<string, unknown> {
  return {
    v: "reelier.release-signing-parameters/v1",
    baseCommit: sha("e"),
    candidateCommit: sha("a"),
    baseTreeSha: sha("b"),
    expectedTreeSha: sha("f"),
    changedBytes: 4_096,
    workflowCommit,
    packedTarballDigest: digest("2"),
    files: [
      { blobSha: sha("b"), contentDigest: digest("b"), mode: "100644", path: "CHANGELOG.md" },
      { blobSha: sha("c"), contentDigest: digest("c"), mode: "100644", path: "src/cli.ts" },
      { blobSha: sha("d"), contentDigest: digest("d"), mode: "100644", path: "test/cli-subcommand-help.test.ts" },
    ],
    qualityEvidence: {
      coverageEvidenceDigest: digest("6"),
      fullTestEvidenceDigest: digest("7"),
      mutationEvidenceDigest: digest("8"),
      mutationScoreBasisPoints: 9_137,
    },
    commit: {
      author: { date: "2026-08-19T05:00:00.000Z", email: "release@seldonframe.com", name: "SeldonFrame Release" },
      committer: { date: "2026-08-19T05:00:00.000Z", email: "release@seldonframe.com", name: "SeldonFrame Release" },
      message: "release: v0.32.1",
    },
    pullRequest: { title: "Release v0.32.1", body: "Governed release v0.32.1" },
    squash: { commitTitle: "Release v0.32.1", commitMessage: "release: v0.32.1" },
    requiredChecks: ["coverage", "full-tests", "mutation"],
    signerIds: { authorization: "release-authority-2026", evidence: "release-evidence-2026", graphMaker: "release-graph-maker-2026" },
    digests: {
      authorityCell: digest("9"), jobCard: digest("e"), mission: digest("f"),
      pack: digest("0"), rootGrant: digest("1"), task: digest("3"),
    },
    effectAllocations: [
      { effect: "candidate-branch", allocationId: "release-candidate-branch-01", allocationDigest: digest("a") },
      { effect: "draft-pr", allocationId: "release-draft-pr-01", allocationDigest: digest("b") },
      { effect: "exact-sha-merge", allocationId: "release-exact-sha-merge-01", allocationDigest: digest("c") },
      { effect: "non-force-tag", allocationId: "release-non-force-tag-01", allocationDigest: digest("d") },
    ],
  };
}

function workspace(patch: (parameters: Record<string, any>) => void = () => {}, options: { readonly sharedKeys?: boolean } = {}): Workspace {
  const root = mkdtempSync(path.join(os.tmpdir(), "reelier-sign-release-"));
  const keysDir = path.join(root, "keys");
  const outDir = path.join(root, "artifacts");
  mkdirSync(keysDir, { recursive: true });
  const authorizationKeys = generateKeyPairSync("ed25519");
  const evidenceKeys = options.sharedKeys ? authorizationKeys : generateKeyPairSync("ed25519");
  const graphMakerKeys = generateKeyPairSync("ed25519");
  writeFileSync(path.join(keysDir, "authorization.key.pem"), authorizationKeys.privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  writeFileSync(path.join(keysDir, "evidence.key.pem"), evidenceKeys.privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  writeFileSync(path.join(keysDir, "graph-maker.pub.pem"), graphMakerKeys.publicKey.export({ format: "pem", type: "spki" }));
  const parameters = baseParameters();
  patch(parameters);
  const parametersFile = path.join(root, "parameters.json");
  writeFileSync(parametersFile, `${JSON.stringify(parameters, null, 2)}\n`, "utf8");
  const trustPinFile = path.join(root, "trust-pin.json");
  writeFileSync(trustPinFile, `${JSON.stringify({
    publicKeySpkiBase64: spki(authorizationKeys.publicKey),
    signerId: (parameters as any).signerIds.authorization,
    v: "reelier.release-authorization-trust-pin/v1",
  })}\n`, "utf8");
  return { root, keysDir, outDir, parametersFile, trustPinFile, authorizationKeys };
}

function runSigner(space: Workspace, extra: string[] = []): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [
    signScript, "--candidate", space.parametersFile, "--keys", space.keysDir,
    "--out", space.outDir, "--repo", repoRoot, ...extra,
  ], { encoding: "utf8", env: { ...process.env, REELIER_RELEASE_BARREL: barrelUrl } });
}

test("the signing ceremony writes a seven-file set the production verifier accepts", () => {
  const space = workspace();
  try {
    const signed = runSigner(space);
    assert.equal(signed.status, 0, `${signed.stdout}\n${signed.stderr}`);
    assert.deepEqual(readdirSync(space.outDir).sort(), EXPECTED_FILES);
    assert.match(signed.stdout, /release authorization signed: sha256:[0-9a-f]{64}/);
    assert.match(signed.stdout, /VERIFIED: verifyReleaseAuthorizationBundleV1 accepts this set/);
    // The honesty lines are load-bearing: exit 0 must never read as "the candidate is correct".
    assert.match(signed.stdout, /NOT CHECKED: that the parameters describe the candidate you intended/);
    assert.match(signed.stdout, /NOT CHECKED: that CI actually ran/);
    assert.match(signed.stdout, /NOT CHECKED: the receipt graph/);
    // No private key material ever reaches stdout or stderr.
    assert.equal(signed.stdout.includes("PRIVATE KEY"), false);
    assert.equal(signed.stderr.includes("PRIVATE KEY"), false);

    const verified = spawnSync(process.execPath, [
      verifyScript, "--dir", space.outDir, "--trust-pin", space.trustPinFile, "--tag", "v0.32.1",
    ], { encoding: "utf8", env: { ...process.env, REELIER_RELEASE_BARREL: barrelUrl } });
    assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`);
    assert.match(verified.stdout, /release authorization verified: sha256:[0-9a-f]{64}/);
  } finally { rmSync(space.root, { force: true, recursive: true }); }
});

test("workflow commitments are computed from the repository's real workflow bytes", () => {
  const space = workspace();
  try {
    assert.equal(runSigner(space).status, 0);
    const plan = JSON.parse(readFileSync(path.join(space.outDir, "operation-plan.json"), "utf8"));
    const commitments: Array<{ digest: string; path: string }> = plan.value.workflowCommitments;
    assert.deepEqual(commitments.map(item => item.path), [
      ".github/workflows/ci.yml", ".github/workflows/docker-publish.yml",
      ".github/workflows/mcp-publish.yml", ".github/workflows/npm-publish.yml",
    ]);
    for (const commitment of commitments) {
      const bytes = execFileSync("git", ["-C", repoRoot, "cat-file", "blob", `${workflowCommit}:${commitment.path}`], { encoding: "buffer" });
      assert.equal(commitment.digest, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    }
  } finally { rmSync(space.root, { force: true, recursive: true }); }
});

test("the authorization window is exactly twelve hours from the supplied issue instant", () => {
  const space = workspace();
  try {
    assert.equal(runSigner(space, ["--now", "2026-08-19T05:00:00.000Z"]).status, 0);
    const bundle = JSON.parse(readFileSync(path.join(space.outDir, "authorization.json"), "utf8"));
    assert.equal(bundle.value.issuedAt, "2026-08-19T05:00:00.000Z");
    assert.equal(bundle.value.expiresAt, "2026-08-19T17:00:00.000Z");
    assert.equal(Date.parse(bundle.value.expiresAt) - Date.parse(bundle.value.issuedAt), 43_200_000);
  } finally { rmSync(space.root, { force: true, recursive: true }); }
});

test("a reused signing key refuses before anything is written", () => {
  const space = workspace(() => {}, { sharedKeys: true });
  try {
    const signed = runSigner(space);
    assert.equal(signed.status, 1);
    assert.match(signed.stderr, /same key by SPKI digest/);
    assert.throws(() => readdirSync(space.outDir));
  } finally { rmSync(space.root, { force: true, recursive: true }); }
});

test("a mutation score below the contract floor refuses rather than signing a weak claim", () => {
  const space = workspace(parameters => { parameters.qualityEvidence.mutationScoreBasisPoints = 8_999; });
  try {
    const signed = runSigner(space);
    assert.equal(signed.status, 1);
    assert.match(signed.stderr, /mutationScoreBasisPoints/);
  } finally { rmSync(space.root, { force: true, recursive: true }); }
});

test("unsorted required checks and out-of-order release paths refuse", () => {
  for (const [patch, pattern] of [
    [(parameters: Record<string, any>) => { parameters.requiredChecks = ["mutation", "coverage"]; }, /sorted and unique/],
    [(parameters: Record<string, any>) => { parameters.files.reverse(); }, /files\[0\]\.path must be CHANGELOG\.md/],
    [(parameters: Record<string, any>) => { parameters.effectAllocations.reverse(); }, /effect must be candidate-branch/],
  ] as const) {
    const space = workspace(patch);
    try {
      const signed = runSigner(space);
      assert.equal(signed.status, 1);
      assert.match(signed.stderr, pattern);
    } finally { rmSync(space.root, { force: true, recursive: true }); }
  }
});

test("--tarball measures the artifact instead of trusting the parameters file", () => {
  const space = workspace();
  try {
    const tarball = path.join(space.root, "reelier-0.32.1.tgz");
    writeFileSync(tarball, "not the signed tarball");
    const mismatch = runSigner(space, ["--tarball", tarball]);
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /does not describe the artifact on disk/);

    // Re-point the parameters at the real digest and the same run succeeds and says so.
    const measured = `sha256:${createHash("sha256").update(readFileSync(tarball)).digest("hex")}`;
    const parameters = JSON.parse(readFileSync(space.parametersFile, "utf8"));
    parameters.packedTarballDigest = measured;
    writeFileSync(space.parametersFile, `${JSON.stringify(parameters, null, 2)}\n`, "utf8");
    const signed = runSigner(space, ["--tarball", tarball]);
    assert.equal(signed.status, 0, `${signed.stdout}\n${signed.stderr}`);
    assert.match(signed.stdout, /VERIFIED: packedTarballDigest equals the measured digest/);
  } finally { rmSync(space.root, { force: true, recursive: true }); }
});

test("--envelope writes the transport form the verifier reads with --artifact-set", () => {
  const space = workspace();
  try {
    const envelope = path.join(space.root, "artifact-set.json");
    assert.equal(runSigner(space, ["--envelope", envelope]).status, 0);
    const verified = spawnSync(process.execPath, [
      verifyScript, "--artifact-set", envelope, "--trust-pin", space.trustPinFile, "--tag", "v0.32.1",
    ], { encoding: "utf8", env: { ...process.env, REELIER_RELEASE_BARREL: barrelUrl } });
    assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`);
  } finally { rmSync(space.root, { force: true, recursive: true }); }
});

test("--help and the parameters template answer before any key is read", () => {
  const help = spawnSync(process.execPath, [signScript, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /operator release-authorization signing ceremony/);
  const template = spawnSync(process.execPath, [signScript, "--print-parameters-template"], { encoding: "utf8" });
  assert.equal(template.status, 0);
  assert.equal(JSON.parse(template.stdout).v, "reelier.release-signing-parameters/v1");
});
