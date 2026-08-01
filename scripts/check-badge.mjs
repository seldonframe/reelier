#!/usr/bin/env node
// CI-only badge gate. Runs on every PR (see .github/workflows/ci.yml) so
// README badge drift is caught the moment it happens instead of at release
// time by hand, which is what let the badge sit wrong for three releases.
//
// Reads test output captured by the job's own `npm test` step (a file path
// given as argv[2]) instead of re-running the suite itself: the suite has
// already run once in this job, so re-running it here would just be a
// second full test run to recompute a number we already have.
//
// Uses the same rule as `npm run preflight` (scripts/badge-check.mjs), so
// the CI gate and the release gate can't drift into two different
// implementations of "does the badge match" — which is the bug this exists
// to catch, one level up.

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { checkBadge } from './badge-check.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/check-badge.mjs <captured-test-output-file>');
  process.exit(1);
}

let testOutput;
try {
  testOutput = readFileSync(file, 'utf8');
} catch (e) {
  console.error(`could not read captured test output at ${file}: ${e.message}`);
  process.exit(1);
}

let readme;
try {
  readme = readFileSync('README.md', 'utf8');
} catch (e) {
  console.error(`could not read README.md: ${e.message}`);
  process.exit(1);
}

const result = checkBadge({ testOutput, readme });

if (result.ok) {
  console.log(`✓ badge matches actual pass count — ${result.message}`);
  process.exit(0);
} else {
  console.log(`✗ badge matches actual pass count — ${result.message}`);
  process.exit(1);
}
