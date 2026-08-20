#!/usr/bin/env node
// Operator-side release-authorization SIGNING ceremony — the counterpart to
// scripts/verify-release-authorization.mjs, which is the authority on the output
// format. This script exists so that the artifact set a mission publishes is built
// by reviewed code rather than by hand: the seven-file set is closed, every byte is
// RFC 8785/JCS canonical, and a hand-assembled set that is one field wrong fails at
// the workflow gate hours later instead of here, in front of the operator.
//
// WHAT IT DOES
//   - Reads a closed reelier.release-signing-parameters/v1 file (the candidate's
//     measured facts: commits, tree/blob SHAs, changed bytes, quality digests).
//   - Computes workflowCommitments from the repository's ACTUAL workflow bytes at a
//     named commit (git cat-file blob <commit>:<path>, sha256 over the raw bytes —
//     the same digest the provider recomputes at readback, github-release-https-provider.ts).
//   - Composes StagedCandidateManifestV1, ReleaseOperationPlanV1, ReleasePolicyV1,
//     the three signed CI quality-evidence lanes, and ReleaseAuthorizationBundleV1.
//   - Signs manifest/plan/policy/bundle with the release-authority key and the three
//     quality lanes with the evidence-checker key.
//   - SELF-VERIFIES by calling verifyReleaseAuthorizationBundleV1 over its own output
//     before writing anything. An artifact set this script writes is one the workflow
//     verifier accepts, or nothing is written.
//   - Writes the closed seven-file set and prints the out-of-band ref push command.
//
// WHAT IT DOES NOT DO — and never let the output imply otherwise
//   - It does not measure the candidate. Every commit, tree SHA, blob SHA, byte count,
//     and quality digest comes from the parameters file. Signing a wrong number
//     produces a perfectly valid signature over a wrong claim.
//   - It does not run CI. The three quality lanes ATTEST results the operator already
//     obtained; minting them here is a claim about what the operator observed, never
//     evidence that the workflow ran.
//   - It does not verify the receipt graph. That is post-publish and belongs to
//     verifyReleaseReceiptGraphV1.
//   - It never prints, echoes, or copies a private key. Keys are read from files and
//     used in-process only.
//
// KEYS (--keys <dir>), and the separation the contract enforces:
//   authorization.key.pem    PRIVATE (pkcs8) — signs manifest, plan, policy, bundle
//   evidence.key.pem         PRIVATE (pkcs8) — signs the three CI quality lanes
//   graph-maker.pub.pem      PUBLIC  (spki)  — bound into the bundle, never used to sign
// The receipt-graph maker's PRIVATE key deliberately never enters this ceremony: the
// bundle only needs its SPKI digest, and release-contracts.ts refuses a bundle whose
// authorization signer, graph maker, or evidence checker share an SPKI digest. Three
// distinct keys are a contract requirement, not a style preference.
//
// TRANSPORT: refs/reelier/release-authorizations/<tag>, a flat tree of exactly the
// seven blobs verify-release-authorization.mjs reads. This script writes that layout
// to --out and prints the exact push command; it never touches the network or git refs
// itself, because creating the carrier ref is an operator action with a review step.
//
// BUILD PREREQUISITE: imports the built authority barrel (dist/authority/index.js).
// REELIER_RELEASE_BARREL overrides the barrel module URL (test seam; same as the verifier).

import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const QUALITY_LANES = ["ci-coverage", "ci-full-tests", "ci-mutation"];
const RECEIPT_LANES = [
  "candidate-branch", "candidate-pull-request", "ghcr-immutable-manifest", "ghcr-tags",
  "human-authorization", "human-exceptions", "human-interruptions", "human-post-release-review",
  "installed-linux", "installed-windows", "mcp-registry-version", "merge-exact-sha",
  "npm-integrity", "npm-provenance", "tag-immutable-ref",
];
/** `parseReleaseAuthorizationBundleV1` pins this exact order for evidenceVerifierBindings. */
const BOUND_LANES = [...QUALITY_LANES, ...RECEIPT_LANES];
/** `RELEASE_EFFECTS`, in the order the bundle parser requires. */
const RELEASE_EFFECTS = ["candidate-branch", "draft-pr", "exact-sha-merge", "non-force-tag"];
/** `RELEASE_PATHS`, in the order the manifest and plan parsers require. */
const RELEASE_PATHS = ["CHANGELOG.md", "src/cli.ts", "test/cli-subcommand-help.test.ts"];
/** `RELEASE_WORKFLOWS`, in the order the workflow-commitment parsers require. */
const RELEASE_WORKFLOWS = [
  ".github/workflows/ci.yml", ".github/workflows/docker-publish.yml",
  ".github/workflows/mcp-publish.yml", ".github/workflows/npm-publish.yml",
];
const FORBIDDEN_CHANGE_CLASSES = [
  "authority-contract", "credential", "dependency", "generated-contract",
  "lockfile", "policy", "release-script", "workflow",
];
const ARTIFACT_FILE_NAMES = Object.freeze({
  authorization: "authorization.json",
  candidateManifest: "candidate-manifest.json",
  "ci-coverage": "quality-evidence-ci-coverage.json",
  "ci-full-tests": "quality-evidence-ci-full-tests.json",
  "ci-mutation": "quality-evidence-ci-mutation.json",
  operationPlan: "operation-plan.json",
  policy: "policy.json",
});
const KEY_FILE_NAMES = Object.freeze({
  authorization: "authorization.key.pem",
  evidence: "evidence.key.pem",
  graphMaker: "graph-maker.pub.pem",
});
const TWELVE_HOURS_MS = 43_200_000;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SIGNER_ID = /^[a-z0-9][a-z0-9._:-]{7,127}$/;
const ALLOCATION_ID = /^[a-z0-9][a-z0-9-]{7,127}$/;

const USAGE = `sign-release-authorization.mjs — operator release-authorization signing ceremony (fail closed)

Usage:
  node scripts/sign-release-authorization.mjs --candidate <params.json> --keys <dir> --out <dir> [options]

Required:
  --candidate <file>   closed reelier.release-signing-parameters/v1 parameters file
  --keys <dir>         directory holding ${KEY_FILE_NAMES.authorization} (private),
                       ${KEY_FILE_NAMES.evidence} (private), and ${KEY_FILE_NAMES.graphMaker} (public)
  --out <dir>          directory to write the closed seven-file artifact set into

Options:
  --repo <dir>         repository to read workflow bytes from (default: the current directory)
  --now <iso8601>      issuedAt instant; expiresAt is exactly +12h (default: now)
  --tarball <path>     recompute packedTarballDigest from this file and require the
                       parameters file to already agree — a measured value, not a supplied one
  --envelope <file>    also write the single-file reelier.release-authorization-transport/v1
                       form that verify-release-authorization.mjs --artifact-set reads
  --print-parameters-template   write a commented parameters skeleton to stdout and exit 0
  --help, -h           print this text and exit 0 without reading keys or writing anything

Artifact set written to --out (closed, flat, exactly seven files):
${Object.values(ARTIFACT_FILE_NAMES).slice().sort().map(name => `  ${name}`).join("\n")}

Never claimed by this script: that the parameters describe the candidate you meant, that CI
actually ran, that the receipt graph verifies, or that the release is semantically safe. It
proves only that a complete artifact set was signed by the keys in --keys and that the
production verifier accepts it.

Requires: npm ci && npm run build (imports the built barrel dist/authority/index.js).
Environment: REELIER_RELEASE_BARREL overrides the barrel module URL (test seam).
`;

const PARAMETERS_TEMPLATE = `{
  "v": "reelier.release-signing-parameters/v1",

  "//": "Every value below is a MEASURED fact about the candidate. This script signs them; it never checks them against reality.",

  "baseCommit": "<40-hex commit the candidate branches from; must equal heads/main at dispatch>",
  "candidateCommit": "<40-hex candidate commit SHA; also the plan's expectedCommitSha and the quality headCommit>",
  "baseTreeSha": "<40-hex tree SHA of baseCommit>",
  "expectedTreeSha": "<40-hex tree SHA of candidateCommit>",
  "changedBytes": 0,
  "workflowCommit": "<40-hex commit to read .github/workflows bytes at>",
  "packedTarballDigest": "sha256:<64-hex over the exact npm pack bytes>",

  "files": [
    { "blobSha": "<40-hex>", "contentDigest": "sha256:<64-hex>", "mode": "100644", "path": "CHANGELOG.md" },
    { "blobSha": "<40-hex>", "contentDigest": "sha256:<64-hex>", "mode": "100644", "path": "src/cli.ts" },
    { "blobSha": "<40-hex>", "contentDigest": "sha256:<64-hex>", "mode": "100644", "path": "test/cli-subcommand-help.test.ts" }
  ],

  "qualityEvidence": {
    "coverageEvidenceDigest": "sha256:<64-hex>",
    "fullTestEvidenceDigest": "sha256:<64-hex>",
    "mutationEvidenceDigest": "sha256:<64-hex>",
    "mutationScoreBasisPoints": 9000
  },

  "commit": {
    "author": { "date": "<ISO 8601>", "email": "release@example.com", "name": "Release" },
    "committer": { "date": "<ISO 8601>", "email": "release@example.com", "name": "Release" },
    "message": "release: v0.32.1"
  },
  "pullRequest": { "title": "Release v0.32.1", "body": "<PR body>" },
  "squash": { "commitTitle": "Release v0.32.1", "commitMessage": "<squash body>" },
  "requiredChecks": ["<sorted unique check names, exactly the CI workflow's check set>"],

  "signerIds": {
    "authorization": "<signer id, 8-128 chars of [a-z0-9._:-]>",
    "evidence": "<signer id>",
    "graphMaker": "<signer id>"
  },

  "//digests": "Digests of the Cell-side objects this authorization binds. Read them from the Cell; do not invent them.",
  "digests": {
    "authorityCell": "sha256:<64-hex>",
    "jobCard": "sha256:<64-hex>",
    "mission": "sha256:<64-hex>",
    "pack": "sha256:<64-hex>",
    "rootGrant": "sha256:<64-hex>",
    "task": "sha256:<64-hex>"
  },

  "//effectAllocations": "One entry per effect, in this exact order. IDs and digests come from the Cell's allocations.",
  "effectAllocations": [
    { "effect": "candidate-branch", "allocationId": "release-candidate-branch-01", "allocationDigest": "sha256:<64-hex>" },
    { "effect": "draft-pr", "allocationId": "release-draft-pr-01", "allocationDigest": "sha256:<64-hex>" },
    { "effect": "exact-sha-merge", "allocationId": "release-exact-sha-merge-01", "allocationDigest": "sha256:<64-hex>" },
    { "effect": "non-force-tag", "allocationId": "release-non-force-tag-01", "allocationDigest": "sha256:<64-hex>" }
  ]
}
`;

function fail(message) {
  process.stderr.write(`release authorization signer: ${message}\n`);
  process.exit(1);
}

// --help and the template must be answerable before any key is read or any file written.
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (argv.includes("--print-parameters-template")) {
  process.stdout.write(PARAMETERS_TEMPLATE);
  process.exit(0);
}

function parseArgs(args) {
  const parsed = { candidate: null, envelope: null, keys: null, now: null, out: null, repo: ".", tarball: null };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const take = () => {
      const value = args[index + 1];
      if (typeof value !== "string" || value.startsWith("--")) fail(`${flag} requires a value`);
      index += 1;
      return value;
    };
    if (flag === "--candidate") parsed.candidate = take();
    else if (flag === "--keys") parsed.keys = take();
    else if (flag === "--out") parsed.out = take();
    else if (flag === "--repo") parsed.repo = take();
    else if (flag === "--now") parsed.now = take();
    else if (flag === "--tarball") parsed.tarball = take();
    else if (flag === "--envelope") parsed.envelope = take();
    else fail(`unknown argument: ${flag} (run --help for the usage)`);
  }
  for (const [flag, value] of [["--candidate", parsed.candidate], ["--keys", parsed.keys], ["--out", parsed.out]]) {
    if (!value) fail(`${flag} is required (run --help for the usage)`);
  }
  return parsed;
}

function closedObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} is not a plain object`);
  // Keys beginning with "//" are comment slots in the template and are dropped before validation.
  const keys = Object.keys(value).filter(key => !key.startsWith("//")).sort();
  const expected = fields.slice().sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail(`${label} must have exactly the keys ${expected.join(", ")} (saw ${keys.join(", ") || "none"})`);
  }
  return value;
}

function requireDigest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(`${label} must be a lowercase sha256: digest`);
  return value;
}

function requireCommit(value, label) {
  if (typeof value !== "string" || !COMMIT.test(value)) fail(`${label} must be a 40-character lowercase hex Git SHA`);
  return value;
}

function requireText(value, label, min, max) {
  if (typeof value !== "string" || value.length < min || value.length > max) fail(`${label} must be ${min}-${max} characters`);
  return value;
}

function requireSignerId(value, label) {
  if (typeof value !== "string" || !SIGNER_ID.test(value)) fail(`${label} must be 8-128 characters of [a-z0-9._:-] starting alphanumeric`);
  return value;
}

function git(repo, args, failureMessage) {
  try {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return fail(failureMessage ?? `git ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The provider recomputes this exact value at readback: sha256 over the raw workflow bytes. */
function workflowCommitments(repo, commit) {
  return RELEASE_WORKFLOWS.map(workflowPath => {
    const bytes = git(repo, ["cat-file", "blob", `${commit}:${workflowPath}`],
      `cannot read ${workflowPath} at ${commit} in ${repo}; the signed workflow commitment must be computed from real bytes, never assumed`);
    return { digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, path: workflowPath };
  });
}

function readPrivateKey(file, label) {
  let pem;
  try {
    pem = readFileSync(file, "utf8");
  } catch {
    return fail(`cannot read the ${label} private key at ${file}`);
  }
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "ed25519") throw new TypeError(`key type is ${String(key.asymmetricKeyType)}`);
    return key;
  } catch (error) {
    // The message names the file and the fault, never any key material.
    return fail(`the ${label} key at ${file} is not an Ed25519 private key: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readPublicKey(file, label) {
  let pem;
  try {
    pem = readFileSync(file, "utf8");
  } catch {
    return fail(`cannot read the ${label} public key at ${file}`);
  }
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519") throw new TypeError(`key type is ${String(key.asymmetricKeyType)}`);
    return key;
  } catch (error) {
    return fail(`the ${label} key at ${file} is not an Ed25519 public key: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const spkiBytes = key => key.export({ format: "der", type: "spki" });
const spkiDigest = key => `sha256:${createHash("sha256").update(spkiBytes(key)).digest("hex")}`;

function parseParameters(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return fail(`cannot read the signing parameters file ${file}`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return fail(`signing parameters file ${file} is not valid JSON`);
  }
  closedObject(value, [
    "baseCommit", "baseTreeSha", "candidateCommit", "changedBytes", "commit", "digests", "effectAllocations",
    "expectedTreeSha", "files", "packedTarballDigest", "pullRequest", "qualityEvidence", "requiredChecks",
    "signerIds", "squash", "v", "workflowCommit",
  ], `signing parameters ${file}`);
  if (value.v !== "reelier.release-signing-parameters/v1") fail(`signing parameters ${file} is not reelier.release-signing-parameters/v1`);

  requireCommit(value.baseCommit, "baseCommit");
  requireCommit(value.candidateCommit, "candidateCommit");
  requireCommit(value.baseTreeSha, "baseTreeSha");
  requireCommit(value.expectedTreeSha, "expectedTreeSha");
  requireCommit(value.workflowCommit, "workflowCommit");
  requireDigest(value.packedTarballDigest, "packedTarballDigest");
  if (!Number.isSafeInteger(value.changedBytes) || value.changedBytes < 0 || value.changedBytes > 65_536) {
    fail("changedBytes must be an integer in [0, 65536] — the release policy caps the candidate at 65536 bytes");
  }

  if (!Array.isArray(value.files) || value.files.length !== RELEASE_PATHS.length) {
    fail(`files must list exactly the ${RELEASE_PATHS.length} release paths in order: ${RELEASE_PATHS.join(", ")}`);
  }
  const files = value.files.map((raw, index) => {
    const file_ = closedObject(raw, ["blobSha", "contentDigest", "mode", "path"], `files[${index}]`);
    if (file_.path !== RELEASE_PATHS[index]) fail(`files[${index}].path must be ${RELEASE_PATHS[index]} (the release path set is closed and ordered)`);
    if (file_.mode !== "100644") fail(`files[${index}].mode must be 100644`);
    requireCommit(file_.blobSha, `files[${index}].blobSha`);
    requireDigest(file_.contentDigest, `files[${index}].contentDigest`);
    return { blobSha: file_.blobSha, contentDigest: file_.contentDigest, mode: "100644", path: file_.path };
  });

  const quality = closedObject(value.qualityEvidence, ["coverageEvidenceDigest", "fullTestEvidenceDigest", "mutationEvidenceDigest", "mutationScoreBasisPoints"], "qualityEvidence");
  requireDigest(quality.coverageEvidenceDigest, "qualityEvidence.coverageEvidenceDigest");
  requireDigest(quality.fullTestEvidenceDigest, "qualityEvidence.fullTestEvidenceDigest");
  requireDigest(quality.mutationEvidenceDigest, "qualityEvidence.mutationEvidenceDigest");
  if (!Number.isSafeInteger(quality.mutationScoreBasisPoints) || quality.mutationScoreBasisPoints < 9_000 || quality.mutationScoreBasisPoints > 10_000) {
    fail("qualityEvidence.mutationScoreBasisPoints must be an integer in [9000, 10000]; the contract refuses a mutation score below 90%");
  }

  const commit = closedObject(value.commit, ["author", "committer", "message"], "commit");
  const identity = (raw, label) => {
    const item = closedObject(raw, ["date", "email", "name"], label);
    requireText(item.name, `${label}.name`, 1, 128);
    requireText(item.email, `${label}.email`, 3, 254);
    if (!/^[^\s@]+@[^\s@]+$/.test(item.email)) fail(`${label}.email is not an email address`);
    if (Number.isNaN(Date.parse(item.date))) fail(`${label}.date is not a parseable timestamp`);
    return { date: item.date, email: item.email, name: item.name };
  };
  requireText(commit.message, "commit.message", 1, 512);

  const pullRequest = closedObject(value.pullRequest, ["body", "title"], "pullRequest");
  requireText(pullRequest.title, "pullRequest.title", 1, 256);
  requireText(pullRequest.body, "pullRequest.body", 1, 16_384);
  const squash = closedObject(value.squash, ["commitMessage", "commitTitle"], "squash");
  requireText(squash.commitTitle, "squash.commitTitle", 1, 256);
  requireText(squash.commitMessage, "squash.commitMessage", 1, 16_384);

  if (!Array.isArray(value.requiredChecks) || value.requiredChecks.length === 0 || value.requiredChecks.length > 32) {
    fail("requiredChecks must be a non-empty list of at most 32 check names");
  }
  const requiredChecks = value.requiredChecks.map((check, index) => requireText(check, `requiredChecks[${index}]`, 1, 128));
  const sorted = [...requiredChecks].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (requiredChecks.join("\0") !== sorted.join("\0") || new Set(requiredChecks).size !== requiredChecks.length) {
    fail("requiredChecks must be sorted and unique — the operation-plan parser refuses any other ordering");
  }

  const signerIds = closedObject(value.signerIds, ["authorization", "evidence", "graphMaker"], "signerIds");
  for (const name of ["authorization", "evidence", "graphMaker"]) requireSignerId(signerIds[name], `signerIds.${name}`);

  const digests = closedObject(value.digests, ["authorityCell", "jobCard", "mission", "pack", "rootGrant", "task"], "digests");
  for (const name of Object.keys(digests)) requireDigest(digests[name], `digests.${name}`);

  if (!Array.isArray(value.effectAllocations) || value.effectAllocations.length !== RELEASE_EFFECTS.length) {
    fail(`effectAllocations must list exactly the ${RELEASE_EFFECTS.length} effects in order: ${RELEASE_EFFECTS.join(", ")}`);
  }
  const seenIds = new Set();
  const seenDigests = new Set();
  const effectAllocations = value.effectAllocations.map((raw, index) => {
    const item = closedObject(raw, ["allocationDigest", "allocationId", "effect"], `effectAllocations[${index}]`);
    if (item.effect !== RELEASE_EFFECTS[index]) fail(`effectAllocations[${index}].effect must be ${RELEASE_EFFECTS[index]} (the effect order is pinned)`);
    if (typeof item.allocationId !== "string" || !ALLOCATION_ID.test(item.allocationId)) fail(`effectAllocations[${index}].allocationId must be 8-128 characters of [a-z0-9-] starting alphanumeric`);
    requireDigest(item.allocationDigest, `effectAllocations[${index}].allocationDigest`);
    if (seenIds.has(item.allocationId)) fail(`effectAllocations[${index}].allocationId is a duplicate; each effect needs a distinct allocation identity`);
    if (seenDigests.has(item.allocationDigest)) fail(`effectAllocations[${index}].allocationDigest is a duplicate; each effect needs a distinct allocation digest`);
    seenIds.add(item.allocationId);
    seenDigests.add(item.allocationDigest);
    return { allocationDigest: item.allocationDigest, allocationId: item.allocationId, effect: item.effect, maxEffects: 1 };
  });

  return {
    baseCommit: value.baseCommit,
    baseTreeSha: value.baseTreeSha,
    candidateCommit: value.candidateCommit,
    changedBytes: value.changedBytes,
    commit: { author: identity(commit.author, "commit.author"), committer: identity(commit.committer, "commit.committer"), message: commit.message },
    digests,
    effectAllocations,
    expectedTreeSha: value.expectedTreeSha,
    files,
    packedTarballDigest: value.packedTarballDigest,
    pullRequest: { body: pullRequest.body, title: pullRequest.title },
    qualityEvidence: quality,
    requiredChecks,
    signerIds,
    squash: { commitMessage: squash.commitMessage, commitTitle: squash.commitTitle },
    workflowCommit: value.workflowCommit,
  };
}

const args = parseArgs(argv);
const parameters = parseParameters(args.candidate);

const barrelUrl = process.env.REELIER_RELEASE_BARREL || new URL("../dist/authority/index.js", import.meta.url).href;
let barrel;
try {
  barrel = await import(barrelUrl);
} catch (error) {
  fail(`cannot import the built authority barrel at ${barrelUrl}; run "npm ci && npm run build" first (${error instanceof Error ? error.message : String(error)})`);
}
const {
  authorityCanonicalBytes,
  authorityDigest,
  createSignedReleaseAuthorizationBundleV1,
  createSignedReleasePolicyV1,
  createSignedReleaseVerifierEvidenceV1,
  createSignedStagedCandidateManifestV1,
  verifyReleaseAuthorizationBundleV1,
} = barrel;
for (const [name, value] of Object.entries({
  authorityCanonicalBytes, authorityDigest, createSignedReleaseAuthorizationBundleV1,
  createSignedReleasePolicyV1, createSignedReleaseVerifierEvidenceV1, createSignedStagedCandidateManifestV1, verifyReleaseAuthorizationBundleV1,
})) {
  if (typeof value !== "function") fail(`the authority barrel at ${barrelUrl} does not export ${name}; the build is stale or the barrel moved`);
}

// The Path C ABI barrel exports every other createSigned* helper but NOT the operation-plan one
// (src/authority/index.ts) — the same asymmetry verify-release-authorization.mjs works around on
// the parse side. Resolved from the sibling module in the same built tree rather than by widening
// the frozen ABI barrel, which is not this script's call to make.
const contractsUrl = new URL("./release-contracts.js", barrelUrl).href;
let createSignedReleaseOperationPlanV1;
try {
  ({ createSignedReleaseOperationPlanV1 } = await import(contractsUrl));
} catch (error) {
  fail(`cannot import the release contracts module at ${contractsUrl} (${error instanceof Error ? error.message : String(error)})`);
}
if (typeof createSignedReleaseOperationPlanV1 !== "function") {
  fail(`the release contracts module at ${contractsUrl} does not export createSignedReleaseOperationPlanV1; the build is stale or the module moved`);
}

const authorizationKey = readPrivateKey(path.join(args.keys, KEY_FILE_NAMES.authorization), "release-authority");
const evidenceKey = readPrivateKey(path.join(args.keys, KEY_FILE_NAMES.evidence), "evidence-checker");
const graphMakerPublicKey = readPublicKey(path.join(args.keys, KEY_FILE_NAMES.graphMaker), "receipt-graph maker");

// Three-way SPKI separation is a contract requirement (release-contracts.ts refuses a bundle whose
// authorization signer, graph maker, or evidence checker share a key). Checking it here turns a
// confusing downstream refusal into an actionable one, naming the two files that collide.
const authorizationSpki = spkiDigest(createPublicKey(authorizationKey));
const evidenceSpki = spkiDigest(createPublicKey(evidenceKey));
const graphMakerSpki = spkiDigest(graphMakerPublicKey);
for (const [left, right, leftFile, rightFile] of [
  [authorizationSpki, evidenceSpki, KEY_FILE_NAMES.authorization, KEY_FILE_NAMES.evidence],
  [authorizationSpki, graphMakerSpki, KEY_FILE_NAMES.authorization, KEY_FILE_NAMES.graphMaker],
  [evidenceSpki, graphMakerSpki, KEY_FILE_NAMES.evidence, KEY_FILE_NAMES.graphMaker],
]) {
  if (left === right) fail(`${leftFile} and ${rightFile} are the same key by SPKI digest; the authorization signer, evidence checker, and receipt-graph maker must be three distinct keys`);
}

if (args.tarball) {
  let measured;
  try {
    measured = `sha256:${createHash("sha256").update(readFileSync(args.tarball)).digest("hex")}`;
  } catch {
    fail(`cannot read the tarball ${args.tarball}`);
  }
  if (measured !== parameters.packedTarballDigest) {
    fail(`tarball ${args.tarball} digests to ${measured} but the parameters file declares ${parameters.packedTarballDigest}; refusing to sign a manifest that does not describe the artifact on disk`);
  }
}

const issuedAtMs = args.now === null ? Date.now() : Date.parse(args.now);
if (!Number.isFinite(issuedAtMs)) fail(`--now ${args.now} is not a parseable ISO 8601 instant`);
const issuedAt = new Date(issuedAtMs).toISOString();
const expiresAt = new Date(issuedAtMs + TWELVE_HOURS_MS).toISOString();
// Quality evidence must satisfy issuedAt <= observedAt <= verificationNow < expiresAt. The CI runs
// happened before signing; their signed attestation records are minted now, at issue time.
const observedAt = issuedAt;

const workflows = workflowCommitments(args.repo, parameters.workflowCommit);
const candidateTreeDigest = authorityDigest({ files: parameters.files, v: "reelier.release-candidate-tree/v1" });
const authorizationSigner = { privateKey: authorizationKey, signerId: parameters.signerIds.authorization };
const evidenceSigner = { privateKey: evidenceKey, signerId: parameters.signerIds.evidence };

let artifacts;
try {
  const operationPlan = createSignedReleaseOperationPlanV1({
    baseCommit: parameters.baseCommit,
    baseTreeSha: parameters.baseTreeSha,
    candidateBranch: "reelier/release/0.32.1",
    candidateTreeDigest,
    commit: { ...parameters.commit, parentSha: parameters.baseCommit },
    destinationBranch: "main",
    expectedCommitSha: parameters.candidateCommit,
    expectedTreeSha: parameters.expectedTreeSha,
    files: parameters.files,
    npmPreflight: { packageName: "reelier", version: "0.32.1", versionMustBeAbsent: true },
    pullRequest: { base: "main", body: parameters.pullRequest.body, draft: true, head: "reelier/release/0.32.1", readyForReview: true, title: parameters.pullRequest.title },
    repository: "seldonframe/reelier",
    requiredChecks: parameters.requiredChecks,
    squash: parameters.squash,
    tag: "v0.32.1",
    v: "reelier.release-operation-plan/v1",
    workflowCommitments: workflows,
  }, authorizationSigner);

  const candidateManifest = createSignedStagedCandidateManifestV1({
    baseCommit: parameters.baseCommit,
    branch: "reelier/release/0.32.1",
    candidateCommit: parameters.candidateCommit,
    candidateTreeDigest,
    changedBytes: parameters.changedBytes,
    changedPaths: [...RELEASE_PATHS],
    destinationBranch: "main",
    packageName: "reelier",
    packageVersion: "0.32.1",
    packedTarballDigest: parameters.packedTarballDigest,
    qualityEvidence: {
      coverageEvidenceDigest: parameters.qualityEvidence.coverageEvidenceDigest,
      coverageStatus: "non-regressed",
      fullTestEvidenceDigest: parameters.qualityEvidence.fullTestEvidenceDigest,
      fullTestsStatus: "verified",
      headCommit: parameters.candidateCommit,
      mutationEvidenceDigest: parameters.qualityEvidence.mutationEvidenceDigest,
      mutationScoreBasisPoints: parameters.qualityEvidence.mutationScoreBasisPoints,
    },
    repository: "seldonframe/reelier",
    tag: "v0.32.1",
    v: "reelier.staged-candidate-manifest/v1",
    workflowCommitments: workflows,
  }, authorizationSigner);

  // Every field of the release policy is fixed by the frozen contract, so it is composed here
  // rather than supplied: a policy the operator could vary would not be the reviewed policy.
  const policy = createSignedReleasePolicyV1({
    allowedPaths: [...RELEASE_PATHS],
    destinations: ["ghcr", "mcp-registry", "npm"],
    effectAllocations: [...RELEASE_EFFECTS],
    expirySeconds: 43_200,
    forbiddenChangeClasses: [...FORBIDDEN_CHANGE_CLASSES],
    maxChangedBytes: 65_536,
    maxChangedFiles: 3,
    v: "reelier.release-policy/v1",
  }, authorizationSigner);

  // One evidence-checker key bound to every lane. The contract explicitly permits this
  // ("One evidence-checker key may be explicitly bound to multiple evidence lanes") and requires
  // only that it differ from the authorization signer and the graph maker by SPKI digest.
  const evidenceVerifierBindings = BOUND_LANES.map(lane => ({ lane, publicKeySpkiDigest: evidenceSpki, signerId: parameters.signerIds.evidence }));

  const authorization = createSignedReleaseAuthorizationBundleV1({
    authorityCellDigest: parameters.digests.authorityCell,
    effectAllocations: parameters.effectAllocations,
    evidenceVerifierBindings,
    expiresAt,
    issuedAt,
    jobCardDigest: parameters.digests.jobCard,
    missionDigest: parameters.digests.mission,
    operationPlanDigest: operationPlan.digest,
    packDigest: parameters.digests.pack,
    policyDigest: policy.digest,
    receiptGraphMakerBinding: { publicKeySpkiDigest: graphMakerSpki, signerId: parameters.signerIds.graphMaker },
    rootGrantDigest: parameters.digests.rootGrant,
    stagedCandidateManifestDigest: candidateManifest.digest,
    taskDigest: parameters.digests.task,
    v: "reelier.release-authorization-bundle/v1",
  }, authorizationSigner);

  // The three CI lanes bind to the candidate head and to the CI workflow's exact path and digest.
  const ciWorkflow = workflows[0];
  const laneInputs = [
    { lane: "ci-coverage", resultValue: 1, subjectDigest: parameters.qualityEvidence.coverageEvidenceDigest },
    { lane: "ci-full-tests", resultValue: 1, subjectDigest: parameters.qualityEvidence.fullTestEvidenceDigest },
    { lane: "ci-mutation", resultValue: parameters.qualityEvidence.mutationScoreBasisPoints, subjectDigest: parameters.qualityEvidence.mutationEvidenceDigest },
  ];
  const qualityEvidence = laneInputs.map(input => ({
    evidence: createSignedReleaseVerifierEvidenceV1({
      authorizationBundleDigest: null,
      candidateCommit: parameters.candidateCommit,
      count: null,
      freshUntil: null,
      lane: input.lane,
      observation: "workflow-run",
      observedAt,
      resultValue: input.resultValue,
      status: "verified",
      subjectDigest: input.subjectDigest,
      v: "reelier.release-verifier-evidence/v1",
      workflowDigest: ciWorkflow.digest,
      workflowPath: ciWorkflow.path,
    }, evidenceSigner),
    verifier: { publicKeySpkiBase64: spkiBytes(createPublicKey(evidenceKey)).toString("base64"), signerId: parameters.signerIds.evidence },
  }));

  artifacts = { authorization, candidateManifest, operationPlan, policy, qualityEvidence };
} catch (error) {
  fail(`cannot compose the release artifact set: ${error instanceof Error ? error.message : String(error)}`);
}

// SELF-VERIFICATION. This is the point of the script: the set is held to the production
// verifier before a single byte reaches disk, so a malformed ceremony fails here rather than
// in a publish workflow hours later. The verification clock is the issue instant, which is the
// earliest moment the set is valid — if it does not verify then, it never will.
try {
  verifyReleaseAuthorizationBundleV1(
    { authorization: artifacts.authorization, candidateManifest: artifacts.candidateManifest, operationPlan: artifacts.operationPlan, policy: artifacts.policy },
    { publicKeySpkiBase64: spkiBytes(createPublicKey(authorizationKey)).toString("base64"), signerId: parameters.signerIds.authorization },
    new Date(issuedAtMs),
    artifacts.qualityEvidence,
  );
} catch (error) {
  fail(`the composed artifact set does not verify and was NOT written: ${error instanceof Error ? error.message : String(error)}`);
}

const canonical = value => authorityCanonicalBytes(value).toString("utf8");
const outputs = {
  [ARTIFACT_FILE_NAMES.authorization]: canonical(artifacts.authorization),
  [ARTIFACT_FILE_NAMES.candidateManifest]: canonical(artifacts.candidateManifest),
  [ARTIFACT_FILE_NAMES.operationPlan]: canonical(artifacts.operationPlan),
  [ARTIFACT_FILE_NAMES.policy]: canonical(artifacts.policy),
};
QUALITY_LANES.forEach((lane, index) => {
  outputs[ARTIFACT_FILE_NAMES[lane]] = canonical({ evidence: canonical(artifacts.qualityEvidence[index].evidence), verifier: artifacts.qualityEvidence[index].verifier });
});

try {
  mkdirSync(args.out, { recursive: true });
  for (const [name, text] of Object.entries(outputs)) writeFileSync(path.join(args.out, name), `${text}\n`, { encoding: "utf8", mode: 0o600 });
} catch (error) {
  fail(`cannot write the artifact set to ${args.out}: ${error instanceof Error ? error.message : String(error)}`);
}

if (args.envelope) {
  const envelope = {
    artifacts: {
      authorization: outputs[ARTIFACT_FILE_NAMES.authorization],
      candidateManifest: outputs[ARTIFACT_FILE_NAMES.candidateManifest],
      operationPlan: outputs[ARTIFACT_FILE_NAMES.operationPlan],
      policy: outputs[ARTIFACT_FILE_NAMES.policy],
    },
    qualityEvidence: QUALITY_LANES.map((lane, index) => ({
      evidence: canonical(artifacts.qualityEvidence[index].evidence),
      verifier: artifacts.qualityEvidence[index].verifier,
    })),
    v: "reelier.release-authorization-transport/v1",
  };
  try {
    writeFileSync(args.envelope, `${canonical(envelope)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    fail(`cannot write the transport envelope to ${args.envelope}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const tag = artifacts.candidateManifest.value.tag;
const ref = `refs/reelier/release-authorizations/${tag}`;
const lines = [
  `release authorization signed: ${artifacts.authorization.digest}`,
  `  release: reelier@${artifacts.candidateManifest.value.packageVersion}, tag ${tag}, repository ${artifacts.candidateManifest.value.repository}`,
  `  candidate commit: ${parameters.candidateCommit} on base ${parameters.baseCommit}`,
  `  window: ${issuedAt} -> ${expiresAt} (exactly 12h)`,
  `  signers: authorization ${parameters.signerIds.authorization} (${authorizationSpki}); evidence ${parameters.signerIds.evidence} (${evidenceSpki}); graph maker ${parameters.signerIds.graphMaker} (${graphMakerSpki})`,
  `  workflow commitments computed from ${args.repo} at ${parameters.workflowCommit}:`,
  ...workflows.map(workflow => `    ${workflow.path} ${workflow.digest}`),
  `  artifact set: ${args.out} (${Object.keys(outputs).length} files)`,
  ...(args.envelope ? [`  transport envelope: ${args.envelope}`] : []),
  "  VERIFIED: verifyReleaseAuthorizationBundleV1 accepts this set at its issue instant, with the three signed CI quality lanes",
  args.tarball
    ? `  VERIFIED: packedTarballDigest equals the measured digest of ${args.tarball}`
    : "  NOT CHECKED: packedTarballDigest against a real tarball — pass --tarball <path> to measure it instead of trusting the parameters file",
  "  NOT CHECKED: that the parameters describe the candidate you intended. Every commit, tree, blob, and quality digest was taken on trust from the parameters file.",
  "  NOT CHECKED: that CI actually ran. The quality lanes attest results you supplied; they are not evidence of a workflow run.",
  "  NOT CHECKED: the receipt graph. That is post-publish and is never this script's claim.",
  "",
  "Publish the artifact set on its out-of-band carrier ref (review the set first; this script never touches git refs or the network):",
  `  cd ${args.out} && git init -q . 2>/dev/null; true`,
  `  TREE=$(git -C ${args.repo} mktree < <(for f in ${Object.keys(outputs).sort().join(" ")}; do printf '100644 blob %s\\t%s\\n' "$(git -C ${args.repo} hash-object -w ${path.resolve(args.out)}/$f)" "$f"; done))`,
  `  COMMIT=$(git -C ${args.repo} commit-tree "$TREE" -m "release authorization ${tag}")`,
  `  git -C ${args.repo} update-ref ${ref} "$COMMIT"`,
  `  git -C ${args.repo} push origin ${ref}`,
  "",
  "Then verify it exactly as the publish workflows will:",
  `  node scripts/verify-release-authorization.mjs --ref ${ref} --tag ${tag}`,
];
process.stdout.write(`${lines.join("\n")}\n`);
