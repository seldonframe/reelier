// Shared "does the README tests badge match the suite" rule.
//
// This used to live only inside scripts/preflight.mjs, which is why it
// drifted for three releases: preflight is a release-time, run-by-hand
// script, so nothing forced it to run on every PR. Pulling the rule out
// into its own module lets scripts/preflight.mjs (release gate) and
// scripts/check-badge.mjs (CI gate) both call the *same* parsing and
// comparison logic instead of each carrying its own copy that can drift
// from the other — which would just reproduce the bug this fixes, one
// level up.

/**
 * Parse Node's test runner TAP-ish summary for the passing count.
 * Node prints both a "# tests N" total line and a "# pass N" passing line
 * (or "ℹ pass N" depending on reporter); this extracts the passing count.
 *
 * @param {string} testOutput - combined stdout/stderr of `npm test`
 * @returns {number|null} the parsed pass count, or null if not found
 */
export function parsePassCount(testOutput) {
  const passMatch = testOutput.match(/^[#ℹ]\s*pass\s+(\d+)\s*$/m);
  return passMatch ? parseInt(passMatch[1], 10) : null;
}

/**
 * Parse the tests badge count out of README.md content. Matches either the
 * shields.io badge URL form (tests-641%20passing) or the plain-text form
 * (tests-641 passing / tests 641 passing).
 *
 * @param {string} readme - contents of README.md
 * @returns {number|null} the badge's claimed count, or null if no badge found
 */
export function parseBadgeCount(readme) {
  const badgeMatch =
    readme.match(/tests-(\d+)(?:%20|-| )passing/i) || readme.match(/tests[\s-](\d+)\s+passing/i);
  return badgeMatch ? parseInt(badgeMatch[1], 10) : null;
}

/**
 * Compare the actual test-runner pass count against the README badge.
 * Pure function — callers own how the result is printed and how it affects
 * their own exit code.
 *
 * @param {{ testOutput: string, readme: string }} args
 * @returns {{ ok: boolean, actualPass: number|null, badgeCount: number|null, message: string }}
 */
export function checkBadge({ testOutput, readme }) {
  const actualPass = parsePassCount(testOutput);
  if (actualPass === null) {
    return {
      ok: false,
      actualPass: null,
      badgeCount: null,
      message: 'could not parse pass count from test output',
    };
  }

  const badgeCount = parseBadgeCount(readme);
  if (badgeCount === null) {
    return {
      ok: false,
      actualPass,
      badgeCount: null,
      message: 'no tests badge found in README.md',
    };
  }

  if (badgeCount === actualPass) {
    return {
      ok: true,
      actualPass,
      badgeCount,
      message: `README says ${badgeCount}, suite has ${actualPass}`,
    };
  }

  return {
    ok: false,
    actualPass,
    badgeCount,
    message: `README badge says ${badgeCount} but suite has ${actualPass} — update the badge`,
  };
}
