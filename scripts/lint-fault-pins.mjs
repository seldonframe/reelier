#!/usr/bin/env node
// Reports tests pinned to fault points the implementation cannot emit.
//
// A test that injects at a fault point absent from src/ does not fail because the feature is
// missing — it fails because its injector never fires, so no implementation of that feature can
// turn it green. In a suite run it is indistinguishable from an honest RED pin, which is how one
// becomes an unsatisfiable acceptance criterion: `before-lock-publication-rename` cost a slice its
// stated goal exactly that way.
//
// Diagnostic by default (exit 0) because the spec's unimplemented backlog is legitimately large.
// Pass --strict to exit 1 on any unsatisfiable pin, once that backlog is closed.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.join(import.meta.dirname, ".."));
const strict = process.argv.includes("--strict");
const SHAPE = /^(?:before|after)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SPEC = path.join(root, "docs/specs/compiled-authority-v1.md");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.ts$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

const srcFiles = walk(path.join(root, "src"));
const testFiles = walk(path.join(root, "test"));

// Emitted: the literal actually reaches an injector. Matches `this.fault("x")` and bare `fault("x")`.
const emitted = new Set();
for (const file of srcFiles) {
  for (const [, point] of readFileSync(file, "utf8").matchAll(/\bfault\(\s*"([^"]+)"/g)) emitted.add(point);
}

// Declared: appears as a fault-point-shaped literal anywhere in src — i.e. some registry claims it.
const declared = new Set();
for (const file of srcFiles) {
  for (const [, point] of readFileSync(file, "utf8").matchAll(/"([^"]+)"/g)) if (SHAPE.test(point)) declared.add(point);
}

// Specified: named in the signed spec's ledger-lock taxonomy.
const specified = new Set();
try {
  const spec = readFileSync(SPEC, "utf8");
  const from = spec.indexOf("The ledger-lock fault surface is the following exact");
  const to = spec.indexOf("The exported fault list is the stable registry");
  if (from >= 0 && to > from) {
    for (const [, point] of spec.slice(from, to).matchAll(/`((?:before|after)-[a-z0-9-]+)`/g)) specified.add(point);
  }
} catch { /* spec is context, not a gate */ }

// Referenced: a fault-point-shaped literal a test compares against or injects at.
const referenced = new Map();
for (const file of testFiles) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  readFileSync(file, "utf8").split("\n").forEach((line, index) => {
    for (const [, point] of line.matchAll(/"([^"]+)"/g)) {
      if (!SHAPE.test(point)) continue;
      if (!referenced.has(point)) referenced.set(point, []);
      const sites = referenced.get(point);
      if (sites.length < 3) sites.push(`${rel}:${index + 1}`);
    }
  });
}

const unsatisfiable = [...referenced.keys()].filter(point => !emitted.has(point)).sort();
const backlog = unsatisfiable.filter(point => specified.has(point));
const suspect = unsatisfiable.filter(point => !specified.has(point) && !declared.has(point));

console.log(`emitted in src      : ${emitted.size}`);
console.log(`referenced by tests : ${referenced.size}`);
console.log(`declared in spec    : ${specified.size}`);

if (backlog.length) {
  console.log(`\nUNSATISFIABLE — specified but not emitted (${backlog.length}). Tests pinned here cannot pass until the point is emitted at its specified boundary; treating them as acceptance criteria for unrelated work is the trap this check exists for:`);
  for (const point of backlog) console.log(`  ${point}\n    ${referenced.get(point).join("\n    ")}`);
}

if (suspect.length) {
  console.log(`\nUNRECOGNISED (${suspect.length}) — fault-point-shaped, referenced by tests, named by neither the spec nor src. Usually a local subtest label, occasionally a typo. Verify, do not assume:`);
  for (const point of suspect) console.log(`  ${point}  (${referenced.get(point)[0]})`);
}

if (!backlog.length && !suspect.length) console.log("\nOK: every fault point a test pins is emitted somewhere in src/.");

process.exit(strict && backlog.length ? 1 : 0);
