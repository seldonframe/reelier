#!/usr/bin/env node
// Shared offline release-authorization verifier — called by all three tag publish
// workflows (npm-publish.yml, mcp-publish.yml, docker-publish.yml). Shared script
// over inline run for the same reason as check-release-ancestor.mjs: a guard
// duplicated in three places drifts in one of them.
//
// WHAT IT VERIFIES, OFFLINE, AND NOTHING MORE
//   - Ed25519 signatures on the authorization bundle, staged candidate manifest,
//     release operation plan, and release policy, against the COMMITTED trust pin.
//   - That every artifact travelled as its exact RFC 8785/JCS canonical bytes.
//   - The digest links bundle -> manifest / plan / policy, and manifest <-> plan
//     (which since the R2 amendment of 2026-08-19 includes manifest.baseCommit ==
//     plan.baseCommit: the base is carried by the signed bundle, not by a constant,
//     so agreement across the two signed artifacts is what makes it one claim).
//   - The 12-hour validity window, graded against new Date() at run time.
//   - The three signed CI quality lanes (ci-coverage, ci-full-tests, ci-mutation)
//     against the bundle's own evidence-verifier bindings.
//   - The release tag name equals the signed tag.
//   - (--check-head) the checked-out HEAD tree, parent, and package identity.
//   - (--tarball)   the packed tarball digest equals the signed packedTarballDigest.
//
// WHAT IT DOES NOT VERIFY — stated in its own output, never implied by exit 0:
//   - Receipt-graph verification (verifyReleaseReceiptGraphV1, 15 provider lanes)
//     is POST-PUBLISH. It is the mission's final verification and the Task-8 gate,
//     and it is never this script's claim.
//   - That the artifact set is the one a human meant to authorize. The transport is
//     untrusted by construction; only the signatures and digests are checked.
//   - That everything the release will do is safe. Proof of scope is not proof of
//     semantics.
//
// TRANSPORT (decided 2026-08-19 by the operator after the B1 contract check
// escalated; see .superpowers/sdd/2026-08-19-breaker-fixes-and-tasks-6-8/):
// the artifacts travel on an out-of-band ref, refs/reelier/release-authorizations/<tag>,
// written by the Cell's mission tooling. Workflows run
//   git fetch origin "+refs/reelier/*:refs/reelier/*"
// before this script. The ref's tree is a CLOSED, FLAT set of exactly seven blobs:
//
//   authorization.json                    canonical SignedReleaseAuthorizationBundleV1
//   candidate-manifest.json               canonical SignedStagedCandidateManifestV1
//   operation-plan.json                   canonical SignedReleaseOperationPlanV1
//   policy.json                           canonical SignedReleasePolicyV1
//   quality-evidence-ci-coverage.json     {"evidence": <canonical JSON string>, "verifier": {...}}
//   quality-evidence-ci-full-tests.json   idem
//   quality-evidence-ci-mutation.json     idem
//
// Each file may carry exactly one trailing newline; every other byte must be the
// canonical form. A missing entry, an extra entry, or a non-canonical encoding
// refuses. --dir reads the same layout from a checked-out directory; --artifact-set
// reads the equivalent single-file `reelier.release-authorization-transport/v1`
// envelope, which is the rehearsal-fixture form.
//
// TRUST PIN (R4): the authorization signer is read from a COMMITTED file, default
// release/trust/release-authorization-signer.json, never from environment or
// repository variables — a repo variable an actor can edit is not a trust pin.
// Schema (closed):
//   {"publicKeySpkiBase64": "<base64 SPKI>",
//    "signerId": "<signer id>",
//    "v": "reelier.release-authorization-trust-pin/v1"}
// REELIER_RELEASE_SIGNER_ID / REELIER_RELEASE_SIGNER_SPKI are REFUSED rather than
// ignored: a trust knob that is present and silently dead is the exact failure this
// mission exists to close.
//
// BUILD PREREQUISITE: imports the built authority barrel (dist/authority/index.js);
// workflows run `npm ci && npm run build` first (R6; same dist dependency as
// scripts/build-packs.mjs). REELIER_RELEASE_BARREL overrides the barrel module URL
// and exists for the hermetic tests (precedent: REELIER_JOURNAL_MODULE).
//
// Exit 0 only on full verification of everything it claims. Any failure exits 1
// with a single actionable line on stderr. No network access: git reads the local
// clone only.

import { execFileSync } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_TRUST_PIN = "release/trust/release-authorization-signer.json";
const QUALITY_LANES = ["ci-coverage", "ci-full-tests", "ci-mutation"];
const ARTIFACT_FILE_NAMES = Object.freeze({
  authorization: "authorization.json",
  candidateManifest: "candidate-manifest.json",
  "ci-coverage": "quality-evidence-ci-coverage.json",
  "ci-full-tests": "quality-evidence-ci-full-tests.json",
  "ci-mutation": "quality-evidence-ci-mutation.json",
  operationPlan: "operation-plan.json",
  policy: "policy.json",
});
const EXPECTED_ENTRIES = Object.values(ARTIFACT_FILE_NAMES).slice().sort();

const USAGE = `verify-release-authorization.mjs — offline release-authorization verifier (fail closed)

Usage:
  node scripts/verify-release-authorization.mjs <source> [options]

Source (exactly one is required):
  --ref <refname>        read the artifact tree from a local git ref, e.g.
                         refs/reelier/release-authorizations/v0.33.0-beta.0 (production carrier;
                         the workflow must fetch it first: git fetch origin "+refs/reelier/*:refs/reelier/*")
  --dir <path>           read the same closed file set from a checked-out directory
  --artifact-set <file>  read a single-file reelier.release-authorization-transport/v1 envelope

Options:
  --trust-pin <path>     committed authorization-signer trust pin
                         (default ${DEFAULT_TRUST_PIN})
  --tag <name>           expected release tag; defaults to $GITHUB_REF_NAME when it starts with "v"
  --check-head           also require the checked-out HEAD tree, parent, and package identity
                         to equal the signed operation plan and manifest
  --tarball <path>       also require the packed tarball digest to equal the signed
                         StagedCandidateManifestV1.packedTarballDigest
  --emit <file>          write the reelier.release-verification-summary/v1 JSON on success
  --help, -h             print this text and exit 0 without reading, verifying, or writing anything

Artifact set (closed, flat, exactly seven files):
${EXPECTED_ENTRIES.map(name => `  ${name}`).join("\n")}

Trust pin file (closed):
  {"publicKeySpkiBase64": "<base64 SPKI>", "signerId": "<id>", "v": "reelier.release-authorization-trust-pin/v1"}

Never claimed by this script: receipt-graph verification (post-publish), operator intent,
and semantic safety of the release. Exit 0 means signatures, digests, window, quality lanes,
tag — and whichever of --check-head/--tarball were requested — all held.

Requires: npm ci && npm run build (imports the built barrel dist/authority/index.js).
Environment: REELIER_RELEASE_BARREL overrides the barrel module URL (test seam).
REELIER_RELEASE_SIGNER_ID / REELIER_RELEASE_SIGNER_SPKI are refused: R4 pins the signer to a
committed file, so an environment-supplied signer is a configuration error, not a fallback.
`;

function fail(message) {
  process.stderr.write(`release authorization verifier: ${message}\n`);
  process.exit(1);
}

// --help must be answerable before anything is read, imported, or executed. This is
// checked first, and deliberately wins over every other argument: a help flag that
// only works when the rest of the command line already happens to be valid is not help.
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(USAGE);
  process.exit(0);
}

function parseArgs(args) {
  const parsed = { checkHead: false, dir: null, emit: null, envelope: null, ref: null, tag: null, tarball: null, trustPin: DEFAULT_TRUST_PIN };
  let source = null;
  const claimSource = flag => {
    if (source) fail(`exactly one artifact source is allowed; --ref, --dir, and --artifact-set are mutually exclusive (saw ${source} and ${flag})`);
    source = flag;
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const take = () => {
      const value = args[index + 1];
      if (typeof value !== "string" || value.startsWith("--")) fail(`${flag} requires a value`);
      index += 1;
      return value;
    };
    if (flag === "--ref" || flag === "--from-ref") { claimSource(flag); parsed.ref = take(); }
    else if (flag === "--dir") { claimSource(flag); parsed.dir = take(); }
    else if (flag === "--artifact-set") { claimSource(flag); parsed.envelope = take(); }
    else if (flag === "--from-tag") fail("the annotated-tag-message carrier was rejected by the B1 contract check (tag creation is a lightweight ref with no message surface); use --ref refs/reelier/release-authorizations/<tag>");
    else if (flag === "--signer-id" || flag === "--signer-spki-base64") fail(`${flag} is refused: R4 pins the authorization signer to a committed file; pass --trust-pin <path> instead`);
    else if (flag === "--trust-pin") parsed.trustPin = take();
    else if (flag === "--tag") parsed.tag = take();
    else if (flag === "--check-head") parsed.checkHead = true;
    else if (flag === "--tarball") parsed.tarball = take();
    else if (flag === "--emit") parsed.emit = take();
    else fail(`unknown argument: ${flag} (run --help for the usage)`);
  }
  for (const name of ["REELIER_RELEASE_SIGNER_ID", "REELIER_RELEASE_SIGNER_SPKI"]) {
    if (typeof process.env[name] === "string" && process.env[name] !== "") {
      fail(`${name} is set but is never honored: R4 pins the authorization signer to a committed trust pin file (${parsed.trustPin}). Remove it from the workflow rather than leaving a dead trust knob in place.`);
    }
  }
  if (!source) fail("an artifact source is required: --ref <refname>, --dir <path>, or --artifact-set <file> (run --help for the usage)");
  return parsed;
}

function git(args, failureMessage) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).replace(/\n$/, "");
  } catch (error) {
    return fail(failureMessage ?? `git ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A blob or checked-out file may carry exactly one trailing newline; every other byte is held to the canonical form. */
function trimOneNewline(text) {
  return text.replace(/\r?\n$/, "");
}

function requireClosedEntrySet(names, sourceLabel) {
  const seen = names.slice().sort();
  for (const name of seen) {
    if (!EXPECTED_ENTRIES.includes(name)) fail(`${sourceLabel} carries an unexpected entry ${name}; the authorization artifact set is closed to exactly ${EXPECTED_ENTRIES.join(", ")}`);
  }
  for (const name of EXPECTED_ENTRIES) {
    if (!seen.includes(name)) fail(`${sourceLabel} is missing ${name}; the authorization artifact set is incomplete and an incomplete authorization never passes`);
  }
}

function loadFromRef(ref) {
  const tree = (() => {
    try {
      return execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{tree}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch {
      return fail(`authorization ref ${ref} is absent or does not resolve to a tree in this clone; fetch it first (git fetch origin "+refs/reelier/*:refs/reelier/*") — an absent authorization never passes`);
    }
  })();
  const listing = git(["ls-tree", "--full-tree", tree], `cannot list the authorization tree at ${ref}`);
  const entries = listing === "" ? [] : listing.split("\n").map(line => {
    const [meta, name] = line.split("\t");
    const [, type] = meta.split(" ");
    if (type !== "blob") fail(`authorization ref ${ref} carries a non-blob entry ${name}; the artifact set is a flat set of seven blobs`);
    return name;
  });
  requireClosedEntrySet(entries, `authorization ref ${ref}`);
  const files = {};
  for (const name of EXPECTED_ENTRIES) files[name] = trimOneNewline(git(["cat-file", "blob", `${tree}:${name}`], `cannot read ${name} from the authorization ref ${ref}`));
  return { files, sourceLabel: `git ref ${ref}` };
}

function loadFromDir(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return fail(`cannot read the authorization artifact directory ${dir}; an absent authorization never passes`);
  }
  requireClosedEntrySet(entries, `authorization directory ${dir}`);
  const files = {};
  for (const name of EXPECTED_ENTRIES) {
    const full = path.join(dir, name);
    if (!statSync(full).isFile()) fail(`authorization directory ${dir} entry ${name} is not a regular file`);
    files[name] = trimOneNewline(readFileSync(full, "utf8"));
  }
  return { files, sourceLabel: `directory ${dir}` };
}

function closedObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} is not a plain object`);
  const keys = Object.keys(value).sort();
  const expected = fields.slice().sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) fail(`${label} must have exactly the keys ${expected.join(", ")} (saw ${keys.join(", ") || "none"})`);
  return value;
}

function loadFromEnvelope(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return fail(`cannot read the artifact set envelope ${file}; an absent authorization never passes`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return fail(`artifact set envelope ${file} is not valid JSON`);
  }
  closedObject(value, ["artifacts", "qualityEvidence", "v"], `artifact set envelope ${file}`);
  if (value.v !== "reelier.release-authorization-transport/v1") fail(`artifact set envelope ${file} is not reelier.release-authorization-transport/v1`);
  const artifacts = closedObject(value.artifacts, ["authorization", "candidateManifest", "operationPlan", "policy"], `artifact set envelope ${file} artifacts`);
  const files = {};
  for (const key of ["authorization", "candidateManifest", "operationPlan", "policy"]) {
    if (typeof artifacts[key] !== "string") fail(`artifact set envelope ${file} artifact ${key} must be a canonical JSON string`);
    files[ARTIFACT_FILE_NAMES[key]] = artifacts[key];
  }
  if (!Array.isArray(value.qualityEvidence) || value.qualityEvidence.length !== QUALITY_LANES.length) fail(`artifact set envelope ${file} must carry exactly ${QUALITY_LANES.length} quality evidence entries (${QUALITY_LANES.join(", ")})`);
  value.qualityEvidence.forEach((entry, index) => {
    closedObject(entry, ["evidence", "verifier"], `artifact set envelope ${file} quality evidence entry ${index}`);
    files[ARTIFACT_FILE_NAMES[QUALITY_LANES[index]]] = JSON.stringify(entry);
  });
  return { files, sourceLabel: `envelope ${file}` };
}

function loadTrustPin(pinPath) {
  let text;
  try {
    text = readFileSync(pinPath, "utf8");
  } catch {
    return fail(`cannot read the committed authorization-signer trust pin at ${pinPath}; pass --trust-pin <path> or land the file (R4 forbids an environment-supplied signer, so there is no fallback)`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return fail(`authorization-signer trust pin ${pinPath} is not valid JSON`);
  }
  closedObject(value, ["publicKeySpkiBase64", "signerId", "v"], `authorization-signer trust pin ${pinPath}`);
  if (value.v !== "reelier.release-authorization-trust-pin/v1") fail(`authorization-signer trust pin ${pinPath} is not reelier.release-authorization-trust-pin/v1`);
  if (typeof value.signerId !== "string" || value.signerId === "") fail(`authorization-signer trust pin ${pinPath} signerId is invalid`);
  if (typeof value.publicKeySpkiBase64 !== "string" || value.publicKeySpkiBase64 === "") fail(`authorization-signer trust pin ${pinPath} publicKeySpkiBase64 is invalid`);
  let spki;
  try {
    spki = Buffer.from(value.publicKeySpkiBase64, "base64");
    const key = createPublicKey({ format: "der", key: spki, type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") throw new TypeError(`key type is ${String(key.asymmetricKeyType)}`);
  } catch (error) {
    return fail(`authorization-signer trust pin ${pinPath} publicKeySpkiBase64 is not an Ed25519 SPKI public key: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { publicKeySpkiBase64: value.publicKeySpkiBase64, signerId: value.signerId, spkiDigest: `sha256:${createHash("sha256").update(spki).digest("hex")}` };
}

const args = parseArgs(argv);

const barrelUrl = process.env.REELIER_RELEASE_BARREL || new URL("../dist/authority/index.js", import.meta.url).href;
let barrel;
try {
  barrel = await import(barrelUrl);
} catch (error) {
  fail(`cannot import the built authority barrel at ${barrelUrl}; run "npm ci && npm run build" first (${error instanceof Error ? error.message : String(error)})`);
}
const {
  authorityCanonicalBytes,
  parseCanonicalSignedReleaseAuthorizationBundleV1,
  parseCanonicalSignedReleasePolicyV1,
  parseCanonicalSignedStagedCandidateManifestV1,
  verifyReleaseAuthorizationBundleV1,
} = barrel;
for (const [name, value] of Object.entries({ authorityCanonicalBytes, parseCanonicalSignedReleaseAuthorizationBundleV1, parseCanonicalSignedReleasePolicyV1, parseCanonicalSignedStagedCandidateManifestV1, verifyReleaseAuthorizationBundleV1 })) {
  if (typeof value !== "function") fail(`the authority barrel at ${barrelUrl} does not export ${name}; the build is stale or the barrel moved`);
}

const trust = loadTrustPin(args.trustPin);
const { files, sourceLabel } = args.ref ? loadFromRef(args.ref) : args.dir ? loadFromDir(args.dir) : loadFromEnvelope(args.envelope);

/**
 * Holds a transported artifact to its exact JCS canonical bytes and returns the parsed value.
 * The three parseCanonicalSigned* barrel entries do this internally; the operation plan has no
 * canonical-string parser exported, so it gets the same treatment here and is then parsed and
 * signature-checked value-level inside verifyReleaseAuthorizationBundleV1.
 */
function parseCanonicalValue(name, label) {
  const text = files[name];
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return fail(`${label} (${name}) is not valid JSON`);
  }
  if (authorityCanonicalBytes(value).toString("utf8") !== text) fail(`${label} (${name}) is not RFC 8785/JCS canonical; the transported bytes do not equal the signed canonical form`);
  return value;
}

const qualityEvidence = QUALITY_LANES.map(lane => {
  const name = ARTIFACT_FILE_NAMES[lane];
  const entry = parseCanonicalValue(name, `${lane} quality evidence entry`);
  closedObject(entry, ["evidence", "verifier"], `${lane} quality evidence entry (${name})`);
  if (typeof entry.evidence !== "string") fail(`${lane} quality evidence (${name}) evidence must be a canonical JSON string`);
  const verifier = closedObject(entry.verifier, ["publicKeySpkiBase64", "signerId"], `${lane} quality evidence verifier (${name})`);
  if (typeof verifier.signerId !== "string" || typeof verifier.publicKeySpkiBase64 !== "string") fail(`${lane} quality evidence verifier (${name}) descriptor is invalid`);
  let evidence;
  try {
    evidence = JSON.parse(entry.evidence);
  } catch {
    return fail(`${lane} quality evidence (${name}) is not valid JSON`);
  }
  if (authorityCanonicalBytes(evidence).toString("utf8") !== entry.evidence) fail(`${lane} quality evidence (${name}) is not RFC 8785/JCS canonical`);
  return { evidence, verifier: { publicKeySpkiBase64: verifier.publicKeySpkiBase64, signerId: verifier.signerId } };
});

let verified;
try {
  const authorization = parseCanonicalSignedReleaseAuthorizationBundleV1(files[ARTIFACT_FILE_NAMES.authorization]);
  const candidateManifest = parseCanonicalSignedStagedCandidateManifestV1(files[ARTIFACT_FILE_NAMES.candidateManifest]);
  const policy = parseCanonicalSignedReleasePolicyV1(files[ARTIFACT_FILE_NAMES.policy]);
  const operationPlan = parseCanonicalValue(ARTIFACT_FILE_NAMES.operationPlan, "release operation plan");
  verified = verifyReleaseAuthorizationBundleV1(
    { authorization, candidateManifest, operationPlan, policy },
    { publicKeySpkiBase64: trust.publicKeySpkiBase64, signerId: trust.signerId },
    new Date(),
    qualityEvidence,
  );
} catch (error) {
  fail(`signed release authorization refused: ${error instanceof Error ? error.message : String(error)}`);
}

const manifest = verified.candidateManifest.value;
const plan = verified.operationPlan.value;

const refName = typeof process.env.GITHUB_REF_NAME === "string" ? process.env.GITHUB_REF_NAME : "";
const tagName = args.tag ?? (refName.startsWith("v") ? refName : null);
if (!tagName) fail("release tag name is unavailable; pass --tag <name> (an unnamed tag is never assumed to be the signed one)");
if (tagName !== manifest.tag) fail(`tag ${tagName} does not equal the signed release tag ${manifest.tag}`);

if (args.checkHead) {
  const headTree = git(["rev-parse", "HEAD^{tree}"], "cannot read HEAD's tree; --check-head needs a git checkout of the release commit");
  if (headTree !== plan.expectedTreeSha) fail(`HEAD tree ${headTree} does not equal the signed expected tree ${plan.expectedTreeSha}`);
  const headParent = git(["rev-parse", "HEAD^"], "cannot read HEAD's parent; --check-head needs the release commit's history (fetch-depth: 0)");
  if (headParent !== plan.baseCommit) fail(`HEAD parent ${headParent} does not equal the authorized base commit ${plan.baseCommit}`);
  const manifestText = git(["show", "HEAD:package.json"], "HEAD:package.json is unreadable");
  let pkg;
  try {
    pkg = JSON.parse(manifestText);
  } catch {
    fail("HEAD:package.json is not valid JSON");
  }
  if (pkg.name !== manifest.packageName || pkg.version !== manifest.packageVersion) fail(`HEAD package ${String(pkg.name)}@${String(pkg.version)} does not equal the signed ${manifest.packageName}@${manifest.packageVersion}`);
}

if (args.tarball) {
  let tarballDigest;
  try {
    tarballDigest = `sha256:${createHash("sha256").update(readFileSync(args.tarball)).digest("hex")}`;
  } catch {
    fail(`cannot read tarball ${args.tarball}`);
  }
  if (tarballDigest !== manifest.packedTarballDigest) fail(`tarball digest ${tarballDigest} does not equal the signed packedTarballDigest ${manifest.packedTarballDigest}; refusing to publish`);
}

const checks = {
  headCommit: args.checkHead ? "verified" : "unchecked",
  packedTarball: args.tarball ? "verified" : "unchecked",
  receiptGraph: "unchecked",
};

if (args.emit) {
  const summary = {
    authorizationBundleDigest: verified.authorization.digest,
    candidateCommit: manifest.candidateCommit,
    checks,
    expiresAt: verified.authorization.value.expiresAt,
    packageVersion: manifest.packageVersion,
    packedTarballDigest: manifest.packedTarballDigest,
    tag: manifest.tag,
    v: "reelier.release-verification-summary/v1",
  };
  try {
    writeFileSync(args.emit, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  } catch (error) {
    fail(`cannot write the verification summary to ${args.emit}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const lines = [
  `release authorization verified: ${verified.authorization.digest} (${manifest.packageName}@${manifest.packageVersion}, tag ${manifest.tag}, expires ${verified.authorization.value.expiresAt})`,
  `  source: ${sourceLabel}`,
  `  trust pin: ${args.trustPin} (signer ${trust.signerId}, spki ${trust.spkiDigest})`,
  "  VERIFIED: Ed25519 signatures on the authorization bundle, staged candidate manifest, operation plan, and release policy against that pin",
  "  VERIFIED: every artifact travelled as its exact RFC 8785/JCS canonical bytes",
  "  VERIFIED: bundle -> manifest / plan / policy digest links, plan <-> manifest agreement, and policy size/path/effect bounds",
  `  VERIFIED: the 12-hour authorization window against the local clock (issued ${verified.authorization.value.issuedAt})`,
  "  VERIFIED: the three signed CI quality lanes (ci-coverage, ci-full-tests, ci-mutation) against the bundle's evidence-verifier bindings",
  `  VERIFIED: release tag ${tagName} equals the signed tag`,
  args.checkHead
    ? `  VERIFIED: HEAD tree, parent, and package identity equal the signed plan (${manifest.packageName}@${manifest.packageVersion})`
    : "  NOT CHECKED: HEAD tree, parent, and package identity — pass --check-head to bind this run to the checked-out commit",
  args.tarball
    ? `  VERIFIED: packed tarball ${args.tarball} digest equals the signed packedTarballDigest`
    : "  NOT CHECKED: the packed tarball digest — pass --tarball <path> to bind this run to the artifact being published",
  "  NOT CHECKED: receipt-graph verification (verifyReleaseReceiptGraphV1, 15 provider lanes) — post-publish only, and never this script's claim",
  "  NOT CHECKED: that this artifact set is the one the operator intended; the transport is untrusted by construction, so only the signatures and digests are proven",
  "  NOT CHECKED: semantic safety of the release. Proof of scope is never proof of correctness.",
];
process.stdout.write(`${lines.join("\n")}\n`);
