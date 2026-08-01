#!/usr/bin/env node
// Local, on-demand end-to-end smoke: drive the REAL `reelier` binary (the
// compiled dist/cli.js, not the runner functions directly — that's what
// test/determinism.test.ts covers) against a network-free fixture skill,
// twice, and prove the two runs produce byte-identical run records. This is
// the determinism claim one level up the stack: not just "runSkill() is
// deterministic" but "the CLI a real user types is deterministic."
//
// Dependency-free: node:child_process + node:fs + node:os + node:path only.
// NOT wired into `npm test` or CI — run it by hand: `npm run test:e2e`.
//
// Hermetic: the fixture skill (test/fixtures/e2e/hermetic.skill.md)
// references a tool name that isn't registered in the CLI's default (no
// --wrap) tool set, so `reelier run` fails Step 1 deterministically
// ("Unknown tool") without ever touching the network. Both runs execute in
// a fresh temp cwd so `.reelier/runs/*.jsonl` never touches the repo tree.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_PATH = path.join(REPO_ROOT, "dist", "cli.js");
const FIXTURE_PATH = path.join(REPO_ROOT, "test", "fixtures", "e2e", "hermetic.skill.md");
const SKILL_NAME = "hermetic-e2e-fixture";
const NORMALIZED_TS = "1970-01-01T00:00:00.000Z";

let failed = false;

function ok(label, detail) {
  console.log(`✓ ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label, detail) {
  failed = true;
  console.log(`✗ ${label}`);
  if (detail) console.log(`    ${detail}`);
}

function fatal(label, err) {
  fail(label, err && err.message ? err.message : String(err));
  console.log("\nFAILED: cannot continue — aborting.");
  process.exit(1);
}

/** Normalize the only fields runSkill legitimately derives from the wall clock (see src/runner.ts / test/determinism.test.ts). */
function normalizeRecord(r) {
  return {
    ...r,
    startedAt: NORMALIZED_TS,
    finishedAt: NORMALIZED_TS,
    totals: { ...r.totals, ms: 0 },
    steps: r.steps.map((s) => ({ ...s, ms: 0 })),
  };
}

/** Run `node dist/cli.js run <fixture>` once in a fresh temp cwd; return {exitCode, record, stdout, stderr}. */
function runOnce() {
  const cwd = mkdtempSync(path.join(tmpdir(), "reelier-e2e-"));
  const result = spawnSync(process.execPath, [CLI_PATH, "run", FIXTURE_PATH], { cwd, encoding: "utf8" });
  if (result.error) {
    throw new Error(`failed to spawn CLI: ${result.error.message}`);
  }
  const runRecordPath = path.join(cwd, ".reelier", "runs", `${SKILL_NAME}.jsonl`);
  if (!existsSync(runRecordPath)) {
    throw new Error(
      `no run record written at ${runRecordPath}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  const lines = readFileSync(runRecordPath, "utf8").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error(`run record file was empty at ${runRecordPath}`);
  }
  const record = JSON.parse(lines[lines.length - 1]);
  rmSync(cwd, { recursive: true, force: true });
  return { exitCode: result.status, record, stdout: result.stdout, stderr: result.stderr };
}

// ---------------------------------------------------------------------------
// 0. Build the CLI, then confirm the CLI + fixture both exist.
// ---------------------------------------------------------------------------

console.log("Building CLI (npm run build)...");
try {
  execFileSync("npm", ["run", "build"], { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" });
} catch (err) {
  fatal("npm run build succeeded", err);
}
ok("npm run build succeeded");

if (!existsSync(CLI_PATH)) fatal("dist/cli.js exists after build", `expected ${CLI_PATH}`);
ok("dist/cli.js exists", CLI_PATH);

if (!existsSync(FIXTURE_PATH)) fatal("fixture skill exists", `expected ${FIXTURE_PATH}`);
ok("fixture skill exists", FIXTURE_PATH);

// ---------------------------------------------------------------------------
// 1. Run the binary twice, each in a fresh temp cwd, against the same fixture.
// ---------------------------------------------------------------------------

let run1, run2;

try {
  run1 = runOnce();
  if (run1.record.steps.length !== 2) throw new Error(`expected 2 steps, got ${run1.record.steps.length}`);
  ok("run 1 produced a run record", `exit ${run1.exitCode}, passed=${run1.record.passed}, ${run1.record.steps.length} steps`);
} catch (err) {
  fatal("run 1 produced a run record", err);
}

try {
  run2 = runOnce();
  if (run2.record.steps.length !== 2) throw new Error(`expected 2 steps, got ${run2.record.steps.length}`);
  ok("run 2 produced a run record", `exit ${run2.exitCode}, passed=${run2.record.passed}, ${run2.record.steps.length} steps`);
} catch (err) {
  fatal("run 2 produced a run record", err);
}

// ---------------------------------------------------------------------------
// 2. Determinism proof: same exit code, deep-equal normalized records, and
//    an identical digestSha256 of each normalized record.
// ---------------------------------------------------------------------------

if (run1.exitCode === run2.exitCode) {
  ok("both runs exited with the same exit code", `${run1.exitCode}`);
} else {
  fail("both runs exited with the same exit code", `run1=${run1.exitCode} run2=${run2.exitCode}`);
}

const n1 = normalizeRecord(run1.record);
const n2 = normalizeRecord(run2.record);
const s1 = JSON.stringify(n1);
const s2 = JSON.stringify(n2);

if (s1 === s2) {
  ok("normalized run records are byte-identical (deep equality) run-to-run");
} else {
  fail("normalized run records are byte-identical (deep equality) run-to-run", `run1: ${s1}\n    run2: ${s2}`);
}

const canonicalJsonUrl = pathToFileURL(path.join(REPO_ROOT, "dist", "canonical-json.js")).href;
const { digestSha256 } = await import(canonicalJsonUrl);
const digest1 = digestSha256(n1);
const digest2 = digestSha256(n2);

if (digest1 === digest2) {
  ok("digestSha256 of the normalized record is identical run-to-run", digest1);
} else {
  fail("digestSha256 of the normalized record is identical run-to-run", `run1: ${digest1}\n    run2: ${digest2}`);
}

console.log("");
if (failed) {
  console.log("FAILED: local e2e determinism smoke found a divergence.");
  process.exit(1);
} else {
  console.log("PASSED: local e2e determinism smoke — the real binary produced byte-identical run records across 2 runs.");
  process.exit(0);
}
