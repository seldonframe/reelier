#!/usr/bin/env node
// Refuses to publish a release whose commit is not on the default branch.
//
// This exists because it happened twice in a row. 0.30.0 was published nine
// PRs behind its own docs. 0.31.1 was published from a tag that was NOT an
// ancestor of main, so a breaking `verify` guard and an output-sanitization
// fix lived only in the npm tarball and the tag — main had neither, and the
// next release cut from main would have silently regressed both. Nothing
// failed. Both were found by hand, hours apart, by accident.
//
// The check is one `git merge-base --is-ancestor`. The reason it is a script
// rather than an inline `run:` step is that two workflows publish on tags
// (mcp-publish.yml, docker-publish.yml) and a guard duplicated in two places
// drifts in one of them.
//
// Usage:  node scripts/check-release-ancestor.mjs [<ref>] [<main-ref>]
//   ref       defaults to $GITHUB_REF_NAME, else HEAD
//   main-ref  defaults to origin/main
//
// REQUIRES FULL HISTORY. actions/checkout defaults to depth 1, where a
// merge-base cannot be computed; the calling workflow must set
// `fetch-depth: 0`. A shallow clone fails this check rather than passing it,
// which is the correct direction for a guard.

import { execFileSync } from "node:child_process";
import process from "node:process";

const ref = process.argv[2] || process.env.GITHUB_REF_NAME || "HEAD";
const mainRef = process.argv[3] || "origin/main";

function rev(target) {
  try {
    return execFileSync("git", ["rev-parse", "--verify", `${target}^{commit}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

const releaseSha = rev(ref);
if (!releaseSha) {
  console.error(`release guard: could not resolve release ref "${ref}" to a commit.`);
  console.error("If this is a shallow checkout, set `fetch-depth: 0` on actions/checkout.");
  process.exit(1);
}

const mainSha = rev(mainRef);
if (!mainSha) {
  console.error(`release guard: could not resolve "${mainRef}" to a commit.`);
  console.error("If this is a shallow checkout, set `fetch-depth: 0` on actions/checkout.");
  process.exit(1);
}

let isAncestor = false;
try {
  execFileSync("git", ["merge-base", "--is-ancestor", releaseSha, mainSha], { stdio: "ignore" });
  isAncestor = true;
} catch {
  isAncestor = false;
}

if (isAncestor) {
  console.log(`release guard: ok — ${ref} (${releaseSha.slice(0, 7)}) is on ${mainRef}.`);
  process.exit(0);
}

let missing = "";
try {
  missing = execFileSync("git", ["log", "--oneline", `${mainSha}..${releaseSha}`], { encoding: "utf8" }).trim();
} catch {
  missing = "(could not list the divergent commits)";
}

console.error(`release guard: ${ref} (${releaseSha.slice(0, 7)}) is NOT an ancestor of ${mainRef}.`);
console.error("");
console.error("Publishing this would ship code your default branch does not have, and the next");
console.error("release cut from that branch would silently regress it. This has happened twice:");
console.error("0.30.0 shipped nine PRs behind its own docs, and 0.31.1 was published off-branch");
console.error("with a breaking verify guard that main did not contain.");
console.error("");
console.error(`Commits in ${ref} that are missing from ${mainRef}:`);
console.error(missing || "  (none listed — the refs may have diverged in the other direction)");
console.error("");
console.error(`Fix: merge ${ref} into ${mainRef}, then re-tag from the merged commit.`);
process.exit(1);
