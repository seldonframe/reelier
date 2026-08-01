import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Plain-JS script, not part of src/, so tsc's rootDir mapping doesn't carry
// it into dist-test alongside this compiled test file (see the identical
// pattern in test/gha-pr-comment.test.ts). Resolved relative to
// process.cwd() (repo root — how `npm test` always invokes this suite)
// rather than a relative specifier, so the import keeps working no matter
// where tsc places the compiled test.
const badgeCheckUrl = pathToFileURL(path.resolve(process.cwd(), "scripts/badge-check.mjs")).href;
const { parsePassCount, parseSkippedCount, parseBadgeCount, checkBadge, describeCheckOutcome, CANONICAL_PLATFORM } =
  await import(badgeCheckUrl);

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

test("parseSkippedCount reads Node's '# skipped N' summary line", () => {
  const output = "# tests 10\n# pass 9\n# fail 0\n# skipped 1\n";
  assert.equal(parseSkippedCount(output), 1);
});

test("parseSkippedCount returns null when no skipped line is present", () => {
  assert.equal(parseSkippedCount("no test runner output here"), null);
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

// --- describeCheckOutcome: disposition (fail/report) varies by platform, ---
// --- the underlying rule (checkBadge above) never does. ---------------------

test("describeCheckOutcome passes through an ok result unchanged, regardless of platform", () => {
  const result = { ok: true, actualPass: 960, badgeCount: 960, message: "README says 960, suite has 960" };
  assert.deepEqual(describeCheckOutcome(result, { platform: "win32" }), { level: "ok", message: result.message });
  assert.deepEqual(describeCheckOutcome(result, { platform: CANONICAL_PLATFORM }), {
    level: "ok",
    message: result.message,
  });
});

test("describeCheckOutcome hard-fails a mismatch on the canonical platform (linux)", () => {
  const result = checkBadge({ testOutput: "# pass 960\n# skipped 0\n", readme: "tests-803 passing" });
  const outcome = describeCheckOutcome(result, { platform: CANONICAL_PLATFORM, skippedCount: 0 });
  assert.equal(outcome.level, "fail");
  assert.equal(outcome.message, result.message);
});

test("describeCheckOutcome never fails on a non-canonical platform, even for a large, unexplained mismatch", () => {
  const result = checkBadge({ testOutput: "# pass 500\n# skipped 0\n", readme: "tests-960 passing" });
  const outcome = describeCheckOutcome(result, { platform: "win32", skippedCount: 0 });
  assert.equal(outcome.level, "report");
  assert.notEqual(outcome.level, "fail");
});

// This is the exact shape of the real bug: one test skipped on win32
// (test/expect-mac.test.ts) that runs and passes on linux. actualPass +
// skippedCount reconciles with the badge, so the platform's own skip count
// accounts for the whole gap -- report, not fail.
test("describeCheckOutcome reports (not fails) a non-canonical mismatch fully explained by this run's own skipped count", () => {
  const result = checkBadge({ testOutput: "# pass 1236\n# skipped 1\n", readme: "tests-1237 passing" });
  const outcome = describeCheckOutcome(result, { platform: "win32", skippedCount: 1 });
  assert.equal(outcome.level, "report");
  assert.match(outcome.message, /1236 \+ 1 = 1237 matches the badge/);
  assert.match(outcome.message, new RegExp(`means the count on '${CANONICAL_PLATFORM}'`));
});

test("describeCheckOutcome still only reports (never fails) when skips do NOT fully explain a non-canonical mismatch", () => {
  const result = checkBadge({ testOutput: "# pass 1200\n# skipped 1\n", readme: "tests-1237 passing" });
  const outcome = describeCheckOutcome(result, { platform: "win32", skippedCount: 1 });
  assert.equal(outcome.level, "report");
  assert.match(outcome.message, /still does not match the badge/);
});

// A structural failure (the check itself broke) must never be laundered
// into "platform skew" — that's the same silent-no-op pathology this PR
// exists to catch, one level down. It fails everywhere, not just on the
// canonical platform.
test("describeCheckOutcome hard-fails an unparsable pass count even on a non-canonical platform", () => {
  const result = checkBadge({ testOutput: "nothing useful here", readme: "tests-960 passing" });
  assert.equal(result.actualPass, null);
  const outcome = describeCheckOutcome(result, { platform: "win32", skippedCount: null });
  assert.equal(outcome.level, "fail");
  assert.equal(outcome.message, result.message);
  assert.doesNotMatch(outcome.message, /platform/i);
});

test("describeCheckOutcome hard-fails a README with no badge at all, even on a non-canonical platform", () => {
  const result = checkBadge({ testOutput: "# pass 960\n", readme: "# My Project, no badge here" });
  assert.equal(result.badgeCount, null);
  const outcome = describeCheckOutcome(result, { platform: "win32", skippedCount: 0 });
  assert.equal(outcome.level, "fail");
  assert.equal(outcome.message, result.message);
  assert.doesNotMatch(outcome.message, /platform/i);
});

// The one branch of describeCheckOutcome with no reconciliation to attempt:
// a real numeric mismatch, off-canonical, but this particular test run's
// `npm test` output didn't carry a skipped count (parseSkippedCount
// returned null) to reason from at all. Still never a hard fail off
// canonical -- just an honest "can't even attempt it" rather than a
// fabricated reconciliation.
test("describeCheckOutcome reports (without attempting reconciliation) when skippedCount itself is unavailable", () => {
  const result = checkBadge({ testOutput: "# pass 1200\n", readme: "tests-1237 passing" });
  const outcome = describeCheckOutcome(result, { platform: "win32", skippedCount: null });
  assert.equal(outcome.level, "report");
  assert.match(outcome.message, /could not read this run's skipped count/);
});

test("describeCheckOutcome defaults to the running process's own platform when none is given", () => {
  const result = { ok: false, actualPass: 1, badgeCount: 2, message: "mismatch" };
  const outcome = describeCheckOutcome(result, { skippedCount: 0 });
  // Whatever this machine is, the level must be one of the three the
  // function ever returns -- and must be 'fail' only if this happens to be
  // running on the canonical platform itself.
  assert.ok(["fail", "report"].includes(outcome.level));
  assert.equal(outcome.level, process.platform === CANONICAL_PLATFORM ? "fail" : "report");
});

// --- Cross-file coupling: ci.yml's badge-step guard vs. CANONICAL_PLATFORM.
// Same idiom as test/action-version-pin.test.ts's action.yml<->package.json
// check -- two files assert the same fact independently, and nothing but a
// test stops them from drifting apart silently. Mutating CANONICAL_PLATFORM
// to any other string (or editing ci.yml's guard) must fail THIS test.

const RUNNER_OS_TO_NODE_PLATFORM: Record<string, string> = {
  Linux: "linux",
  Windows: "win32",
  macOS: "darwin",
};

test("ci.yml's badge-check step guard resolves to badge-check.mjs's CANONICAL_PLATFORM", () => {
  const ciYmlPath = path.resolve(process.cwd(), ".github/workflows/ci.yml");
  const ciYml = fs.readFileSync(ciYmlPath, "utf8");

  const stepMatch = ciYml.match(/Check README tests badge\r?\n\s*if:\s*(.+?)\r?\n/);
  assert.ok(
    stepMatch,
    "could not find the 'Check README tests badge' step's `if:` guard in ci.yml -- " +
      "did the step get renamed or restructured?"
  );
  const guard = stepMatch![1].trim();

  const osMatch = guard.match(/runner\.os\s*==\s*'([^']+)'/);
  assert.ok(
    osMatch,
    `ci.yml's badge-check guard is "${guard}", not the expected \`runner.os == '<OS>'\` form`
  );
  const runnerOs = osMatch![1];
  const mappedPlatform = RUNNER_OS_TO_NODE_PLATFORM[runnerOs];
  assert.ok(mappedPlatform, `unrecognized runner.os value "${runnerOs}" in ci.yml's badge-check guard`);

  assert.equal(
    mappedPlatform,
    CANONICAL_PLATFORM,
    `ci.yml gates the badge-check step on runner.os == '${runnerOs}' (Node platform ` +
      `'${mappedPlatform}'), but scripts/badge-check.mjs's CANONICAL_PLATFORM is ` +
      `'${CANONICAL_PLATFORM}' -- these define the same thing in two places and must ` +
      `agree, or the badge's stated definition and the platform that actually enforces ` +
      `it silently diverge.`
  );
});
