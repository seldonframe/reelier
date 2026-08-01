#!/usr/bin/env node
// Pre-publish gate for reelier.
//
// Catches the two slips that actually happened:
//   1. Publishing from a checkout that's on an already-published version
//      (or a dirty/behind-origin tree).
//   2. A README test-count badge that has drifted from the real suite size.
//
// Dependency-free: node:child_process + node:fs + node:process only.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { checkBadge } from './badge-check.mjs';

const results = [];

function ok(label, detail) {
  results.push({ pass: true, label, detail });
  console.log(`✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail) {
  results.push({ pass: false, label, detail });
  console.log(`✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

function warn(label, detail) {
  // Warnings print but do not fail the gate on their own.
  console.log(`⚠ ${label}${detail ? ` — ${detail}` : ''}`);
}

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function runAllowFail(cmd) {
  try {
    return { ok: true, stdout: run(cmd) };
  } catch (err) {
    return {
      ok: false,
      stdout: (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : ''),
      err,
    };
  }
}

console.log('reelier release preflight\n');

// --- 1. Clean working tree -------------------------------------------------
{
  const status = runAllowFail('git status --porcelain');
  if (!status.ok) {
    fail('clean working tree', 'could not run git status');
  } else if (status.stdout.trim() === '') {
    ok('clean working tree');
  } else {
    fail('clean working tree', 'commit or stash first');
  }
}

// --- 2. On main & synced with origin ---------------------------------------
{
  const branchRes = runAllowFail('git branch --show-current');
  const branch = branchRes.ok ? branchRes.stdout.trim() : '';

  if (branch !== 'main') {
    warn('on main branch', `currently on '${branch || '(detached)'}', not 'main'`);
  } else {
    ok('on main branch');
  }

  const headRes = runAllowFail('git rev-parse HEAD');
  const upstreamRes = runAllowFail('git rev-parse @{u}');

  if (!headRes.ok) {
    warn('synced with origin', 'could not resolve HEAD');
  } else if (!upstreamRes.ok) {
    warn('synced with origin', 'no upstream tracking branch configured');
  } else {
    const head = headRes.stdout.trim();
    const upstream = upstreamRes.stdout.trim();
    if (head === upstream) {
      ok('synced with origin');
    } else {
      warn('synced with origin', `HEAD ${head.slice(0, 7)} != upstream ${upstream.slice(0, 7)} (behind or ahead)`);
    }
  }
}

// --- 3. Version not already published on npm -------------------------------
{
  let pkg;
  try {
    pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  } catch (e) {
    fail('version not already published', `could not read package.json: ${e.message}`);
    pkg = null;
  }

  if (pkg) {
    const name = pkg.name;
    const version = pkg.version;
    const viewRes = runAllowFail(`npm view ${name}@${version} version`);

    if (viewRes.ok && viewRes.stdout.trim() === version) {
      fail('version not already published', `${name}@${version} already on npm, bump first`);
    } else if (!viewRes.ok && /E404|404/.test(viewRes.stdout)) {
      ok('version not already published', `${name}@${version} is free`);
    } else if (!viewRes.ok) {
      // Some other failure (network, auth, etc.) — don't silently pass.
      warn('version not already published', `npm view failed unexpectedly: ${viewRes.stdout.split('\n')[0]}`);
    } else {
      // npm view succeeded but returned something unexpected.
      warn('version not already published', `unexpected npm view output: ${viewRes.stdout.trim()}`);
    }
  }
}

// --- 4. Build passes ---------------------------------------------------------
{
  const buildRes = runAllowFail('npm run build');
  if (buildRes.ok) {
    ok('build passes');
  } else {
    fail('build passes', 'npm run build failed — see output above');
    console.log(buildRes.stdout);
  }
}

// --- 5. Tests pass + README badge matches -----------------------------------
{
  const testRes = runAllowFail('npm test');
  const testOutput = testRes.stdout;

  if (!testRes.ok) {
    fail('tests pass', 'npm test failed — see output below');
    console.log(testOutput);
  } else {
    ok('tests pass');
  }

  // Badge-vs-suite comparison lives in scripts/badge-check.mjs so this
  // release-time gate and the CI gate (scripts/check-badge.mjs) share one
  // implementation instead of drifting apart from each other.
  let readme = null;
  try {
    readme = readFileSync('README.md', 'utf8');
  } catch (e) {
    fail('badge matches actual pass count', `could not read README.md: ${e.message}`);
  }

  if (readme !== null) {
    const result = checkBadge({ testOutput, readme });
    if (result.ok) {
      ok('badge matches actual pass count', result.message);
    } else {
      fail('badge matches actual pass count', result.message);
    }
  }
}

// --- Summary -----------------------------------------------------------------
console.log('\nsummary:');
const failed = results.filter((r) => !r.pass);
for (const r of results) {
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.label}`);
}

if (failed.length > 0) {
  console.log(`\n${failed.length} check(s) FAILED. Fix these before publishing.`);
  process.exit(1);
} else {
  console.log('\nAll checks passed. Safe to proceed with release.');
  process.exit(0);
}
