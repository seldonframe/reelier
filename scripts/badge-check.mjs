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
//
// DEFINITION: the badge means "tests passing on the canonical CI platform"
// — ubuntu-latest, the one leg .github/workflows/ci.yml actually runs
// scripts/check-badge.mjs against (see CANONICAL_PLATFORM below). It is
// not "tests passing on whatever machine last ran preflight." The pass
// count is not platform-uniform (at least one test is intentionally
// platform-conditional — test/expect-mac.test.ts's POSIX-only file-mode
// check, `{ skip: process.platform === "win32" }`), so that's the only
// definition that is reproducible for everyone, on any OS, at any time.

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
 * Parse Node's test runner TAP-ish summary for the skipped count
 * ("# skipped N" / "ℹ skipped N"). A test skipped on this run but not on
 * the canonical platform is exactly the gap a platform-conditional skip
 * produces — this is how describeCheckOutcome() derives the platform
 * difference instead of hardcoding it.
 *
 * @param {string} testOutput - combined stdout/stderr of `npm test`
 * @returns {number|null} the parsed skipped count, or null if not found
 */
export function parseSkippedCount(testOutput) {
  const skippedMatch = testOutput.match(/^[#ℹ]\s*skipped\s+(\d+)\s*$/m);
  return skippedMatch ? parseInt(skippedMatch[1], 10) : null;
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

// The platform .github/workflows/ci.yml actually runs scripts/check-badge.mjs
// against (see the `if: matrix.os == 'ubuntu-latest'` guard on the "Check
// README tests badge" step). This is not a policy choice made here — it's
// naming the platform the badge already, structurally, means.
export const CANONICAL_PLATFORM = 'linux';

/**
 * Decide how a checkBadge() result should be *disposed of* — failed,
 * passed, or merely reported — given the platform it ran on. This changes
 * disposition only; it never changes the rule itself (checkBadge above is
 * unchanged and is the only thing that decides whether the numbers match).
 *
 * On the canonical platform a mismatch is real drift: fail. Off it, a raw
 * mismatch is not evidence of anything on its own, because this platform's
 * own runner may have skipped tests the canonical platform runs (and
 * passes) — so this reasons from the runner's own `skipped` count rather
 * than asserting a fixed adjustment: if `actualPass + skippedCount`
 * reconciles with the badge, the whole gap is explained by this platform's
 * own skips. Either way, off-canonical is never a hard fail: only CI's
 * ubuntu-latest run (scripts/check-badge.mjs, unchanged by this function)
 * is authoritative there.
 *
 * @param {{ ok: boolean, actualPass: number|null, badgeCount: number|null, message: string }} result
 * @param {{ platform?: string, skippedCount?: number|null }} [opts]
 * @returns {{ level: 'ok'|'fail'|'report', message: string }}
 */
export function describeCheckOutcome(result, opts = {}) {
  const platform = opts.platform ?? globalThis.process?.platform;
  const skippedCount = opts.skippedCount ?? null;

  if (result.ok) {
    return { level: 'ok', message: result.message };
  }

  const { actualPass, badgeCount } = result;

  // A structural failure — the pass count couldn't be parsed at all, or
  // README has no badge in it — has nothing to do with platform skew. It
  // means the check itself broke, on every platform, and must never be
  // downgraded: reporting it as "platform skew" would explain away "the
  // badge is missing" as a quirk of running on Windows, which is false and
  // is the same silent-no-op pathology this whole PR exists to catch, one
  // level down. These always fail, everywhere.
  if (actualPass === null || badgeCount === null) {
    return { level: 'fail', message: result.message };
  }

  if (platform === CANONICAL_PLATFORM) {
    return { level: 'fail', message: result.message };
  }

  const base = `README says ${badgeCount}; this machine ('${platform}') ran and passed ${actualPass}`;

  if (skippedCount !== null) {
    const impliedCanonical = actualPass + skippedCount;
    if (impliedCanonical === badgeCount) {
      return {
        level: 'report',
        message:
          `${base}, and skipped ${skippedCount} (${actualPass} + ${skippedCount} = ${impliedCanonical} ` +
          `matches the badge) — consistent with this platform's own skips accounting for the whole gap. ` +
          `The badge means the count on '${CANONICAL_PLATFORM}' (CI's ubuntu-latest leg); trust that, not this run.`,
      };
    }
    return {
      level: 'report',
      message:
        `${base} and skipped ${skippedCount} (${actualPass} + ${skippedCount} = ${impliedCanonical}, which ` +
        `still does not match the badge) — this machine cannot confirm or deny the badge on its own. The badge ` +
        `means the count on '${CANONICAL_PLATFORM}' (CI's ubuntu-latest leg); trust that, not this run.`,
    };
  }

  return {
    level: 'report',
    message:
      `${base} — could not read this run's skipped count, so this machine cannot even attempt to reconcile ` +
      `the gap. The badge means the count on '${CANONICAL_PLATFORM}' (CI's ubuntu-latest leg); trust that.`,
  };
}
