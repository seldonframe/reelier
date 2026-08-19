#!/usr/bin/env node
// npm destination reconciliation — runs BEFORE any publish and before any retry.
//   version absent               -> "absent"     (exit 0; publish may proceed)
//   matching published integrity -> "reconciled" (exit 0; publish is skipped)
//   conflicting integrity        -> terminal (exit 1; never republish over a conflict)
//   registry state uncertain     -> pending  (exit 2; never resent; rerun re-checks first)
// Usage: node scripts/reconcile-npm-destination.mjs --package <name> --version <v>
//        --tarball <path> [--registry <origin>] [--expect reconciled|absent]
//
// --expect reconciled is the post-publish path. npm's registry can lag a
// few seconds behind a successful `npm publish`, so before declaring the
// destination merely "pending" this path polls the version-specific
// endpoint (`<registry>/<package>/<version>`) up to 3 attempts with short
// backoff (~5s, then ~10s) looking for the publish to land. It never
// resends anything — only rereads. The pre-publish path (no --expect, or
// --expect absent) stays single-shot against the full packument, as
// before.
//
// RECONCILE_POLL_BACKOFFS_MS overrides the two poll backoffs (comma-
// separated milliseconds) for tests; production always uses the ~5s/~10s
// default.
import { createHash } from "node:crypto";
import { readFileSync, appendFileSync } from "node:fs";
import process from "node:process";

const FETCH_TIMEOUT_MS = 30_000;
const POLL_ATTEMPTS = 3;
const POLL_BACKOFFS_MS = process.env.RECONCILE_POLL_BACKOFFS_MS
  ? process.env.RECONCILE_POLL_BACKOFFS_MS.split(",").map(value => Number(value.trim()))
  : [5_000, 10_000];

// Only used for argument/tarball-read validation, all of which happens
// before any network activity — safe to hard-exit here.
function fail(code, message) { console.error(`npm destination reconciliation: ${message}`); process.exit(code); }
// Used for anything decided after a fetch has happened. Reproduced locally
// on Windows: calling process.exit() once this process has made any
// fetch() call can crash the process with "Assertion failed:
// !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c" — a
// libuv/undici socket-teardown race that process.exit()'s abrupt shutdown
// loses. Setting process.exitCode and letting the script fall off the end
// (nothing runs after this point) drains the event loop normally instead,
// which avoids the race and is also just better practice: process.exit()
// can truncate stdout/stderr before they finish flushing.
function reportAndSetExit(code, message) { console.error(`npm destination reconciliation: ${message}`); process.exitCode = code; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Equivalent to `fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })`,
// but with the timer explicitly cleared once the fetch settles, so nothing
// is left pending regardless of how the process eventually exits.
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try { return await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

const args = {};
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const flag = argv[index], value = argv[++index];
  if (!["--package", "--version", "--tarball", "--registry", "--expect"].includes(flag) || typeof value !== "string") fail(1, `invalid argument ${flag}`);
  args[flag.slice(2)] = value;
}
if (!args.package || !args.version || !args.tarball) fail(1, "--package, --version, and --tarball are required");
if (args.expect && !["reconciled", "absent"].includes(args.expect)) fail(1, "--expect must be reconciled or absent");
const registry = args.registry ?? "https://registry.npmjs.org";

let bytes;
try { bytes = readFileSync(args.tarball); } catch { fail(1, `cannot read local tarball ${args.tarball}`); }
const localIntegrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
const localShasum = createHash("sha1").update(bytes).digest("hex");

// Classifies one already-fetched version manifest (the shape npm serves
// both under packument.versions[version] and at the version-specific
// endpoint) against the local tarball's digest. `version` is undefined
// when the registry has no record of this version at all.
function classifyVersionManifest(version) {
  if (!version) return { state: "absent" };
  const integrity = typeof version.dist?.integrity === "string" ? version.dist.integrity : null;
  const shasum = typeof version.dist?.shasum === "string" ? version.dist.shasum : null;
  if (integrity === localIntegrity || (integrity === null && shasum === localShasum)) return { state: "reconciled" };
  if (integrity === null && shasum === null) return { state: "uncertain", reason: `published ${args.package}@${args.version} carries no integrity metadata; destination state is uncertain — pending, never resent` };
  return { state: "conflict", reason: `published ${args.package}@${args.version} integrity ${integrity ?? shasum} conflicts with the local tarball ${localIntegrity}; terminal — never republish over a conflicting destination` };
}

// Single-shot: fetches the full packument and classifies this version out
// of it. Used by the pre-publish path (no --expect, or --expect absent).
async function checkPackument() {
  let response;
  try { response = await fetchWithTimeout(`${registry}/${args.package}`); }
  catch { return { state: "uncertain", reason: "registry is unreachable or timed out; destination state is uncertain — pending, never resent" }; }

  if (response.status === 404) return { state: "absent" };
  if (!response.ok) return { state: "uncertain", reason: `registry answered ${response.status}; destination state is uncertain — pending, never resent` };

  let packument;
  try { packument = await response.json(); } catch { return { state: "uncertain", reason: "registry payload is unreadable; destination state is uncertain — pending, never resent" }; }

  // A 200 for a package name is never supposed to omit "versions" — the
  // real npm registry always includes it for a package that exists. A
  // 200 without one is not "this version doesn't exist" (which would be
  // safe to read as absent/publish-permitted); it's an unrecognized
  // payload shape, so treat it as anomalous and refuse to guess.
  if (!packument || typeof packument !== "object" || !packument.versions || typeof packument.versions !== "object") {
    return { state: "uncertain", reason: `registry answered 200 for ${args.package} with no "versions" object in the packument — anomalous; destination state is uncertain — pending, never resent` };
  }

  return classifyVersionManifest(packument.versions[args.version]);
}

// One attempt of the post-publish poll: fetches the version-specific
// endpoint directly (never the whole packument).
async function checkVersionEndpoint() {
  let response;
  try { response = await fetchWithTimeout(`${registry}/${args.package}/${args.version}`); }
  catch { return { state: "uncertain", reason: "registry is unreachable or timed out; destination state is uncertain — pending, never resent" }; }

  if (response.status === 404) return { state: "absent" };
  if (!response.ok) return { state: "uncertain", reason: `registry answered ${response.status}; destination state is uncertain — pending, never resent` };

  let manifest;
  try { manifest = await response.json(); } catch { return { state: "uncertain", reason: "registry payload is unreadable; destination state is uncertain — pending, never resent" }; }
  if (!manifest || typeof manifest !== "object") {
    return { state: "uncertain", reason: `registry answered 200 for ${args.package}@${args.version} with an unreadable payload; destination state is uncertain — pending, never resent` };
  }

  return classifyVersionManifest(manifest);
}

let result;
if (args.expect === "reconciled") {
  // Post-publish: poll, never resending, until the destination settles on
  // a decisive answer (reconciled or conflict) or the attempts run out.
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    result = await checkVersionEndpoint();
    if (result.state === "reconciled" || result.state === "conflict") break;
    if (attempt < POLL_ATTEMPTS) await sleep(POLL_BACKOFFS_MS[attempt - 1] ?? POLL_BACKOFFS_MS[POLL_BACKOFFS_MS.length - 1]);
  }
} else {
  result = await checkPackument();
}

if (result.state === "conflict") {
  reportAndSetExit(1, result.reason);
} else if (result.state === "uncertain") {
  reportAndSetExit(2, result.reason);
} else {
  const state = result.state; // "absent" | "reconciled"
  if (args.expect && state !== args.expect) {
    reportAndSetExit(args.expect === "reconciled" ? 2 : 1, `destination state is ${state}, expected ${args.expect}`);
  } else {
    console.log(`state=${state}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `state=${state}\n`);
    console.log(`npm destination reconciliation: ${args.package}@${args.version} is ${state}`);
  }
}
