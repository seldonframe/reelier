import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Plain-JS script, not part of src/, so tsc's rootDir mapping doesn't carry
// it into dist-test alongside this compiled test file (see the identical
// pattern in test/gha-pr-comment.test.ts). Resolved relative to
// process.cwd() (repo root — how `npm test` always invokes this suite)
// rather than a relative specifier, so the import keeps working no matter
// where tsc places the compiled test.
const badgeCheckUrl = pathToFileURL(path.resolve(process.cwd(), "scripts/badge-check.mjs")).href;
const { parsePassCount, parseBadgeCount, checkBadge } = await import(badgeCheckUrl);

test("parsePassCount reads Node's '# pass N' summary line", () => {
  const output = "# tests 10\n# pass 10\n# fail 0\n";
  assert.equal(parsePassCount(output), 10);
});

test("parsePassCount reads the 'ℹ pass N' form", () => {
  const output = "ℹ tests 7\nℹ pass 7\nℹ fail 0\n";
  assert.equal(parsePassCount(output), 7);
});

test("parsePassCount returns null when no pass line is present", () => {
  assert.equal(parsePassCount("no test runner output here"), null);
});

test("parseBadgeCount reads the shields.io URL-encoded form", () => {
  const readme = "![tests](https://img.shields.io/badge/tests-641%20passing-brightgreen)";
  assert.equal(parseBadgeCount(readme), 641);
});

test("parseBadgeCount reads the plain-text form", () => {
  assert.equal(parseBadgeCount("tests-1161 passing"), 1161);
  assert.equal(parseBadgeCount("tests 1161 passing"), 1161);
});

test("parseBadgeCount returns null when README has no badge", () => {
  assert.equal(parseBadgeCount("# My Project\n\nNo badge here."), null);
});

// This is the test that proves the gate can fail: a badge that disagrees
// with the actual suite must produce ok: false. Without this, "the check
// fails when the badge is wrong" is only an assertion, not a fact — which
// is exactly the gap that let the badge sit stale at 803 for three
// releases while nothing forced the check to run and fail.
test("checkBadge fails (RED) when the README badge disagrees with the actual pass count", () => {
  const testOutput = "# tests 960\n# pass 960\n# fail 0\n";
  const readme = "tests-803 passing";

  const result = checkBadge({ testOutput, readme });

  assert.equal(result.ok, false);
  assert.equal(result.actualPass, 960);
  assert.equal(result.badgeCount, 803);
  assert.match(result.message, /README badge says 803 but suite has 960/);
});

test("checkBadge passes (GREEN) when the README badge matches the actual pass count", () => {
  const testOutput = "# tests 960\n# pass 960\n# fail 0\n";
  const readme = "tests-960 passing";

  const result = checkBadge({ testOutput, readme });

  assert.equal(result.ok, true);
  assert.equal(result.actualPass, 960);
  assert.equal(result.badgeCount, 960);
});

test("checkBadge fails when the pass count can't be parsed from test output", () => {
  const result = checkBadge({ testOutput: "nothing useful", readme: "tests-960 passing" });
  assert.equal(result.ok, false);
  assert.equal(result.actualPass, null);
  assert.match(result.message, /could not parse pass count/);
});

test("checkBadge fails when README has no badge at all", () => {
  const result = checkBadge({ testOutput: "# pass 960\n", readme: "# My Project" });
  assert.equal(result.ok, false);
  assert.equal(result.badgeCount, null);
  assert.match(result.message, /no tests badge found/);
});
