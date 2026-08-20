#!/usr/bin/env node
// Converts the verifier's signed transport envelope into the closed file the Authority Cell's
// release runner resolves by opaque handle. This step owns no signing key and performs no network
// call. It first runs the production offline verifier over an immutable copy of the supplied
// envelope, then reads each authorized file from the signed candidate commit and independently
// checks both its Git blob id and sha256 content digest before writing anything.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `materialize-release-runner-authorization.mjs — build a verified Cell runner bundle

Usage:
  node scripts/materialize-release-runner-authorization.mjs \\
    --artifact-set <transport-envelope.json> --repo <git-dir> \\
    --trust-pin <release-authority-pin.json> --tag <vX.Y.Z> --out <handle.json>

The output contains exactly authorization, candidateManifest, operationPlan, policy, evidence,
and fileContents. It contains no credential or private key. Existing output is never overwritten.
`;

function fail(message) {
  process.stderr.write(`release runner authorization materializer: ${message}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(USAGE);
  process.exit(0);
}

function parseArgs(args) {
  const names = new Set(["artifact-set", "repo", "trust-pin", "tag", "out"]);
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag.startsWith("--") || !names.has(flag.slice(2))) fail(`unknown argument: ${flag} (run --help for the usage)`);
    const name = flag.slice(2);
    if (values.has(name)) fail(`${flag} was supplied more than once`);
    const value = args[index + 1];
    if (typeof value !== "string" || value.startsWith("--")) fail(`${flag} requires a value`);
    values.set(name, value);
    index += 1;
  }
  for (const name of names) if (!values.has(name)) fail(`--${name} is required (run --help for the usage)`);
  const resolved = Object.fromEntries([...values].map(([name, value]) => [name, path.resolve(value)]));
  const out = resolved.out;
  if (existsSync(out)) fail(`output ${out} already exists; refusing to overwrite a runner authorization`);
  if ([resolved["artifact-set"], resolved.repo, resolved["trust-pin"]].includes(out)) fail("--out must not replace an input");
  return Object.freeze({ artifactSet: resolved["artifact-set"], repo: resolved.repo, trustPin: resolved["trust-pin"], tag: values.get("tag"), out });
}

function closedRecord(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} is not a plain record`);
  const actual = Object.keys(value).sort();
  if (actual.join("\0") !== [...keys].sort().join("\0")) fail(`${label} is not closed`);
  return value;
}

function git(repo, args, label) {
  try {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    fail(`${label} could not be read from the candidate repository`);
  }
}

const args = parseArgs(argv);
let envelopeBytes;
try { envelopeBytes = readFileSync(args.artifactSet); }
catch { fail(`cannot read artifact set ${args.artifactSet}`); }

// Verify the same immutable bytes this process parses. This closes the otherwise small race where
// a caller replaces the envelope between the verifier child reading it and this process reading it.
const scratch = mkdtempSync(path.join(os.tmpdir(), "reelier-runner-authorization-"));
const verifiedEnvelope = path.join(scratch, "artifact-set.json");
try {
  writeFileSync(verifiedEnvelope, envelopeBytes, { flag: "wx", mode: 0o600 });
  execFileSync(process.execPath, [
    fileURLToPath(new URL("./verify-release-authorization.mjs", import.meta.url)),
    "--artifact-set", verifiedEnvelope,
    "--trust-pin", args.trustPin,
    "--tag", args.tag,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (error) {
  const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr).trim() : "";
  rmSync(scratch, { recursive: true, force: true });
  fail(`offline verification refused the artifact set${stderr ? `: ${stderr}` : ""}`);
}
rmSync(scratch, { recursive: true, force: true });

let envelope;
try { envelope = JSON.parse(envelopeBytes.toString("utf8")); }
catch { fail("artifact set is not valid JSON after verification"); }
closedRecord(envelope, ["v", "artifacts", "qualityEvidence"], "artifact set");
if (envelope.v !== "reelier.release-authorization-transport/v1") fail("artifact set has the wrong version");
const transported = closedRecord(envelope.artifacts, ["authorization", "candidateManifest", "operationPlan", "policy"], "artifact set artifacts");
for (const name of Object.keys(transported)) if (typeof transported[name] !== "string") fail(`artifact ${name} is not canonical JSON text`);
if (!Array.isArray(envelope.qualityEvidence) || envelope.qualityEvidence.length !== 3) fail("artifact set does not contain exactly three quality-evidence lanes");

const parseTransported = (name) => {
  try { return JSON.parse(transported[name]); }
  catch { fail(`artifact ${name} is not valid JSON after verification`); }
};
const authorization = parseTransported("authorization");
const candidateManifest = parseTransported("candidateManifest");
const operationPlan = parseTransported("operationPlan");
const policy = parseTransported("policy");
const plan = operationPlan?.value;
if (!plan || typeof plan !== "object" || typeof plan.expectedCommitSha !== "string" || !Array.isArray(plan.files)) fail("verified operation plan is unavailable");

const fileContents = plan.files.map((descriptor, index) => {
  closedRecord(descriptor, ["blobSha", "contentDigest", "mode", "path"], `operation plan file ${index + 1}`);
  const bytes = git(args.repo, ["cat-file", "blob", `${plan.expectedCommitSha}:${descriptor.path}`], `authorized file ${descriptor.path}`);
  const blobSha = git(args.repo, ["rev-parse", `${plan.expectedCommitSha}:${descriptor.path}`], `authorized blob ${descriptor.path}`).toString("utf8").trim();
  const contentDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (blobSha !== descriptor.blobSha || contentDigest !== descriptor.contentDigest) fail(`authorized file ${descriptor.path} does not match its signed blob and content digests`);
  return Object.freeze({ path: descriptor.path, bytesBase64: bytes.toString("base64") });
});

const evidence = envelope.qualityEvidence.map((entry, index) => {
  closedRecord(entry, ["evidence", "verifier"], `quality evidence ${index + 1}`);
  if (typeof entry.evidence !== "string") fail(`quality evidence ${index + 1} is not canonical JSON text`);
  let signed;
  try { signed = JSON.parse(entry.evidence); }
  catch { fail(`quality evidence ${index + 1} is not valid JSON after verification`); }
  return Object.freeze({ evidence: signed, verifier: entry.verifier });
});

const bundle = { authorization, candidateManifest, operationPlan, policy, evidence, fileContents };
try { writeFileSync(args.out, `${JSON.stringify(bundle)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
catch { fail(`cannot create runner authorization output ${args.out}`); }
process.stdout.write(`verified runner authorization materialized: ${args.out}\n`);
process.stdout.write(`candidate: ${plan.expectedCommitSha}   files: ${fileContents.length}   tag: ${args.tag}\n`);
process.stdout.write("completeness: unchecked   semantic safety: not claimed\n");
