#!/usr/bin/env node
// Measures the small disposable rehearsal candidate. This is not the production quality gate; it
// creates honest, candidate-bound rehearsal evidence for the same three lanes the release contract
// requires. The mutation lane runs two concrete mutants of the early-help behavior and refuses
// unless the fixed contract kills both.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const sha256 = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const fail = message => { process.stderr.write(`release rehearsal quality: ${message}\n`); process.exit(1); };
const values = new Map();
for (let index = 0; index < process.argv.slice(2).length; index += 1) {
  const argv = process.argv.slice(2), flag = argv[index];
  if (!["--repo", "--candidate", "--out"].includes(flag) || values.has(flag)) fail(`unknown or duplicate argument ${flag}`);
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
  values.set(flag, value); index += 1;
}
for (const flag of ["--repo", "--candidate", "--out"]) if (!values.has(flag)) fail(`${flag} is required`);
const repo = path.resolve(values.get("--repo")), candidate = values.get("--candidate"), out = path.resolve(values.get("--out"));
if (!/^[0-9a-f]{40}$/.test(candidate)) fail("--candidate must be a full lowercase Git commit SHA");
if (existsSync(out)) fail(`output ${out} already exists`);
const git = args => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
try {
  if (git(["rev-parse", "HEAD"]) !== candidate) fail("the candidate worktree HEAD does not equal --candidate");
  if (git(["status", "--porcelain"]) !== "") fail("the candidate worktree is not clean");
} catch (error) { fail(error instanceof Error ? error.message : "candidate Git inspection failed"); }

function commandLane(lane, command, args) {
  const result = spawnSync(command, args, { cwd: repo, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  const transcript = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) fail(`${lane} command failed with exit ${String(result.status)}\n${transcript}`);
  return Object.freeze({ lane, status: "verified", command: [command, ...args], exitCode: 0, transcriptDigest: sha256(transcript), transcript });
}

const fullTests = commandLane("ci-full-tests", process.execPath, ["--test", "test/cli-subcommand-help.test.ts"]);
const coverage = commandLane("ci-coverage", process.execPath, ["--test", "--experimental-test-coverage", "test/cli-subcommand-help.test.ts"]);

const source = readFileSync(path.join(repo, "src", "cli.ts"), "utf8");
async function probe(moduleSource) {
  const loaded = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}#${createHash("sha256").update(moduleSource).digest("hex")}`);
  for (const flag of ["--help", "-h"]) {
    let calls = 0;
    const result = loaded.dispatch(["init", flag], () => { calls += 1; });
    assert.deepEqual(result, { exitCode: 0, usage: true });
    assert.equal(calls, 0);
  }
  let calls = 0;
  assert.deepEqual(loaded.dispatch(["init"], () => { calls += 1; }), { exitCode: 0, usage: false });
  assert.equal(calls, 1);
}
await probe(source);
const mutations = [
  {
    id: "help-dispatch-side-effect",
    source: source.replace("return { exitCode: 0, usage: true };", "handler(); return { exitCode: 0, usage: true };")
  },
  {
    id: "short-help-flag-removed",
    source: source.replace('argv[1] === "-h"', 'argv[1] === "--help"')
  },
];
if (mutations.some(mutation => mutation.source === source)) fail("the candidate no longer contains a rehearsal mutation target");
const mutationResults = [];
for (const mutation of mutations) {
  let killed = false;
  try { await probe(mutation.source); } catch { killed = true; }
  mutationResults.push(Object.freeze({ id: mutation.id, killed, mutantDigest: sha256(mutation.source) }));
}
const killed = mutationResults.filter(result => result.killed).length;
const mutationScoreBasisPoints = Math.floor(killed * 10_000 / mutationResults.length);
if (mutationScoreBasisPoints < 9_000) fail(`mutation score ${mutationScoreBasisPoints}bp is below the 9000bp floor`);
const mutationBody = { lane: "ci-mutation", status: "verified", mutants: mutationResults.length, killed, mutationScoreBasisPoints, results: mutationResults };
const mutation = Object.freeze({ ...mutationBody, transcriptDigest: sha256(JSON.stringify(mutationBody)) });

const observedAt = new Date().toISOString();
const bind = lane => sha256(JSON.stringify({ v: "reelier.release-rehearsal-quality-lane/v1", candidateCommit: candidate, observedAt, lane }));
const evidence = {
  v: "reelier.release-rehearsal-quality/v1",
  candidateCommit: candidate,
  observedAt,
  lanes: {
    coverage: { ...coverage, evidenceDigest: bind(coverage) },
    fullTests: { ...fullTests, evidenceDigest: bind(fullTests) },
    mutation: { ...mutation, evidenceDigest: bind(mutation) },
  },
};
try { writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
catch { fail(`cannot create evidence output ${out}`); }
process.stdout.write(`rehearsal quality verified for ${candidate}\n`);
process.stdout.write(`coverage ${evidence.lanes.coverage.evidenceDigest}\n`);
process.stdout.write(`full-tests ${evidence.lanes.fullTests.evidenceDigest}\n`);
process.stdout.write(`mutation ${evidence.lanes.mutation.evidenceDigest} score=${mutationScoreBasisPoints}bp\n`);
