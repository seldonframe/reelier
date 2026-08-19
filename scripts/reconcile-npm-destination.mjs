#!/usr/bin/env node
// npm destination reconciliation — runs BEFORE any publish and before any retry.
//   version absent               -> "absent"     (exit 0; publish may proceed)
//   matching published integrity -> "reconciled" (exit 0; publish is skipped)
//   conflicting integrity        -> terminal (exit 1; never republish over a conflict)
//   registry state uncertain     -> pending  (exit 2; never resent; rerun re-checks first)
// Usage: node scripts/reconcile-npm-destination.mjs --package <name> --version <v>
//        --tarball <path> [--registry <origin>] [--expect reconciled|absent]
import { createHash } from "node:crypto";
import { readFileSync, appendFileSync } from "node:fs";
import process from "node:process";

function fail(code, message) { console.error(`npm destination reconciliation: ${message}`); process.exit(code); }

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

let response;
try { response = await fetch(`${registry}/${args.package}`, { headers: { accept: "application/json" } }); }
catch { fail(2, "registry is unreachable; destination state is uncertain — pending, never resent"); }

let state;
if (response.status === 404) state = "absent";
else if (!response.ok) fail(2, `registry answered ${response.status}; destination state is uncertain — pending, never resent`);
else {
  let packument;
  try { packument = await response.json(); } catch { fail(2, "registry payload is unreadable; destination state is uncertain — pending, never resent"); }
  const version = packument && typeof packument === "object" && packument.versions && typeof packument.versions === "object" ? packument.versions[args.version] : undefined;
  if (!version) state = "absent";
  else {
    const integrity = typeof version.dist?.integrity === "string" ? version.dist.integrity : null;
    const shasum = typeof version.dist?.shasum === "string" ? version.dist.shasum : null;
    if (integrity === localIntegrity || (integrity === null && shasum === localShasum)) state = "reconciled";
    else if (integrity === null && shasum === null) fail(2, `published ${args.package}@${args.version} carries no integrity metadata; destination state is uncertain — pending, never resent`);
    else fail(1, `published ${args.package}@${args.version} integrity ${integrity ?? shasum} conflicts with the local tarball ${localIntegrity}; terminal — never republish over a conflicting destination`);
  }
}
if (args.expect && state !== args.expect) fail(args.expect === "reconciled" ? 2 : 1, `destination state is ${state}, expected ${args.expect}`);
console.log(`state=${state}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `state=${state}\n`);
console.log(`npm destination reconciliation: ${args.package}@${args.version} is ${state}`);
