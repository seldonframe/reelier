// Guards the one product claim we keep re-breaking.
//
// reelier's compiler states as a settled design principle (src/compile.ts
// header) that steps it cannot derive a meaningful assertion for "stay
// assertion-less and get listed as an open question rather than papered
// over". So any copy promising an assertion on EVERY step describes a
// guarantee the tool was deliberately built not to make.
//
// That rule was written down in reelier's docs/strategy/submissions.md on
// 2026-07-22. Two days later the claim was live on ~40 surfaces across both
// repos, including every public receipt permalink, llms.txt, the OG/Twitter
// descriptions and the homepage SVG. A written rule with nothing enforcing
// it did not hold, which is why this file exists.
//
// The QUALIFIED forms are fine and are deliberately allowed: "an assertion
// on every step IT CAN CHECK", "...THAT RECORDED A CLEAN RESULT". Those
// state the limit instead of hiding it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Walk up to the nearest package.json rather than assuming a fixed depth:
// this repo runs tests from test/, but reelier compiles them first and runs
// from dist-test/test/, where a hardcoded ".." points at the build output
// and the scan ends up reading a compiled copy of this file's own fixtures.
function repoRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate package.json above ${from}`);
}

const ROOT = repoRoot(import.meta.dirname);

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "dist-test",
  ".vercel",
  "coverage",
  // Mutation-testing artifacts: the live Stryker sandbox holds a COPY of the
  // repo (allowlisted files reappear under sandbox-relative paths and false-
  // positive), and the generated HTML report embeds mutated source verbatim.
  ".stryker-tmp",
  "reports",
]);

const SCAN_EXT = [".ts", ".tsx", ".js", ".mjs", ".md", ".mdx", ".json", ".svg", ".html", ".txt", ".yml", ".yaml"];

// Files whose JOB is to quote the banned phrase (guardrails, this test, and
// the honesty-anchor comments that tell a future author not to write it).
const ALLOWLIST = new Set(
  [
    "test/claim-guard.test.ts",
    "docs/strategy/submissions.md",
    "CONTRIBUTING.md",
  ].map((p) => p.split("/").join(sep)),
);

// A qualifier immediately after the phrase makes it honest.
const QUALIFIERS = [
  "it can check",
  "that recorded a clean result",
  "that recorded clean results",
  "they cover",
  "it can",
];

// The second pattern allows a short clause between "step" and the verb,
// because the real regression read "Every step in this run was asserted and
// passed" - words in between are exactly how it slipped past a naive grep.
const BANNED: { label: string; re: RegExp }[] = [
  { label: "assertion on/per every step", re: /assert(?:ion|ions)?\s+(?:on|per)\s+every\s+step/gi },
  { label: "every step asserted/assertion-checked", re: /every\s+step\b[^.!?\n]{0,40}?\bassert(?:ed|ion-checked)\b/gi },
  { label: "one assertion per step", re: /(?:one|an)\s+assertion\s+per\s+step/gi },
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (SCAN_EXT.some((e) => entry.endsWith(e))) yield full;
  }
}

/** Exported so the negative test can exercise the exact matcher the scan uses. */
export function findUnqualifiedClaims(text: string): string[] {
  const hits: string[] = [];
  for (const { re, label } of BANNED) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // Look at the match AND what follows it: a qualifier can sit either
      // inside the phrase ("every step it can check is asserted") or right
      // after it ("...on every step it can check").
      const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
      const window = (m[0] + tail).toLowerCase();
      const qualified = QUALIFIERS.some((q) => window.includes(q));
      if (!qualified) hits.push(`${label}: "${m[0]}"`);
    }
  }
  return hits;
}

test("no unqualified 'assertion on every step' claim anywhere in the repo", () => {
  const offenders: string[] = [];
  for (const file of walk(ROOT)) {
    const rel = relative(ROOT, file);
    // basename check covers the compiled dist-test/*.js twin of this file
    if (ALLOWLIST.has(rel) || file.includes("claim-guard.test")) continue;
    const hits = findUnqualifiedClaims(readFileSync(file, "utf8"));
    for (const h of hits) offenders.push(`${rel} -> ${h}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `Unqualified per-step assertion claim found. The compiler leaves steps assertion-less on purpose ` +
      `(see reelier src/compile.ts), so this promises a guarantee the tool does not make.\n` +
      `Either delete the claim or qualify it ("...every step it can check").\n\n` +
      offenders.join("\n"),
  );
});

test("the matcher catches a reintroduction and allows the qualified form", () => {
  // Would have caught the real regression.
  assert.equal(findUnqualifiedClaims("receipt: byte-identical, an assertion on every step").length, 1);
  assert.equal(findUnqualifiedClaims("Every step in this run was asserted and passed").length, 1);
  assert.equal(findUnqualifiedClaims("typed JSON out, one assertion per step.").length, 1);
  // Honest forms stay legal.
  assert.equal(findUnqualifiedClaims("a SKILL.md with an assertion on every step it can check").length, 0);
  assert.equal(
    findUnqualifiedClaims("an assertion on every step that recorded a clean result; others stay assertion-less").length,
    0,
  );
});
