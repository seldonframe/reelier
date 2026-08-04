#!/usr/bin/env node
// Answers "what newly broke?" against a recorded baseline, which is step 7 of the slice loop and so
// runs on every slice forever.
//
// It exists because that comparison was hand-rolled as a shell pipeline once per slice and got it
// wrong twice: a malformed sed expression, and a silent cwd reset that pointed the run at a
// different checkout. Paths here resolve from this file, never from cwd.
//
// It also refuses to measure a loaded machine. A baseline taken while three agents were running
// reported 411 pass as 410 and produced a phantom regression; the failure was a crashed child in a
// 100-process test, not a defect. Load is measured, not assumed.
//
//   --save     record the current result as the baseline (refuses under load)
//   --force    measure anyway, and mark the result untrusted
//   --target   test glob to run (default: the authority ledger suite)

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.join(import.meta.dirname, ".."));
const argv = process.argv.slice(2);
const save = argv.includes("--save");
const force = argv.includes("--force");
const targetArg = argv.indexOf("--target");
const target = targetArg >= 0 ? argv[targetArg + 1] : "dist-test/test/authority/ledger.test.js";
const store = path.join(root, ".baseline");
const file = path.join(store, `${target.replaceAll(/[^a-z0-9]+/gi, "-")}.json`);

// Sample CPU idle across a short window. os.loadavg() is always zero on Windows, so it cannot be used.
function busyFraction(ms = 600) {
  const sample = () => os.cpus().reduce((acc, c) => {
    const total = Object.values(c.times).reduce((a, b) => a + b, 0);
    return { idle: acc.idle + c.times.idle, total: acc.total + total };
  }, { idle: 0, total: 0 });
  const first = sample();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const second = sample();
  const idle = second.idle - first.idle;
  const total = second.total - first.total;
  return total <= 0 ? 0 : 1 - idle / total;
}

function run() {
  try {
    return execFileSync(process.execPath, ["--test", "--test-concurrency=1", target], {
      cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // A non-zero exit is the normal case whenever anything fails; the output is what matters.
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
}

function parse(output) {
  const pass = Number(/^\D*pass (\d+)$/m.exec(output)?.[1] ?? NaN);
  const fail = Number(/^\D*fail (\d+)$/m.exec(output)?.[1] ?? NaN);
  const failing = new Set();
  for (const [, name] of output.matchAll(/^\s*✖ (.+?) \(\d+(?:\.\d+)?ms\)$/gm)) failing.add(name);
  return { pass, fail, failing: [...failing].sort() };
}

const busy = busyFraction();
const loaded = busy > 0.35;
if (loaded && !force) {
  console.error(`refusing to measure: cpu ${(busy * 100).toFixed(0)}% busy over the sample window.`);
  console.error("a loaded machine crashes child processes in the heavier tests and fabricates regressions.");
  console.error("wait for the machine to settle, or pass --force to record the result as untrusted.");
  process.exit(2);
}

const result = parse(run());
if (!Number.isFinite(result.pass) || !Number.isFinite(result.fail)) {
  console.error("could not parse a pass/fail summary from the test output.");
  process.exit(2);
}

if (save) {
  mkdirSync(store, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ target, ...result, trusted: !loaded, recorded: null }, null, 2)}\n`);
  console.log(`baseline saved: ${result.pass} pass / ${result.fail} fail${loaded ? " (UNTRUSTED — machine was loaded)" : ""}`);
  console.log(`  ${path.relative(root, file).replaceAll("\\", "/")}`);
  process.exit(0);
}

if (!existsSync(file)) {
  console.error(`no baseline for ${target}. Record one on a quiet machine with --save.`);
  process.exit(2);
}

const base = JSON.parse(readFileSync(file, "utf8"));
const had = new Set(base.failing);
const has = new Set(result.failing);
const broke = result.failing.filter(name => !had.has(name));
const fixed = base.failing.filter(name => !has.has(name));

console.log(`baseline : ${base.pass} pass / ${base.fail} fail${base.trusted === false ? "  (recorded untrusted)" : ""}`);
console.log(`current  : ${result.pass} pass / ${result.fail} fail${loaded ? "  (UNTRUSTED — machine loaded)" : ""}`);

if (fixed.length) {
  console.log(`\nNEWLY PASSING (${fixed.length}):`);
  for (const name of fixed) console.log(`  + ${name}`);
}
if (broke.length) {
  console.log(`\nNEWLY FAILING (${broke.length}):`);
  for (const name of broke) console.log(`  - ${name}`);
}
if (!fixed.length && !broke.length) console.log("\nno change in the failing set.");

// The gate: pass must not drop and the failing set must gain no names.
const regressed = broke.length > 0 || result.pass < base.pass;
if (regressed) {
  console.error("\nGATE FAILED: keep the change only if every newly failing test is explained and intended.");
  console.error("re-run any load-sensitive test in isolation before calling it a regression.");
}
process.exit(regressed ? 1 : 0);
