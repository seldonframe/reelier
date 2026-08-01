import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

// scripts/check-badge.mjs is a plain script, not compiled from src/, so it's
// invoked directly at its repo-root-relative path (same as how ci.yml
// invokes it: `node scripts/check-badge.mjs test-output.txt`).
const CHECK_BADGE_PATH = path.resolve(process.cwd(), "scripts/check-badge.mjs");

// This is the exit-code wiring that IS the CI gate (scripts/check-badge.mjs
// is what .github/workflows/ci.yml's "Check README tests badge" step
// actually runs) -- unlike badge-check.mjs's pure functions, nothing else
// in the suite exercises this file as a process: its argv handling, its
// file I/O, and its exit codes were previously verified only by hand.
async function withScratchDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-check-badge-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("check-badge.mjs exits 1 with a usage message when no capture-file argument is given", async () => {
  await withScratchDir(async (dir) => {
    await assert.rejects(
      execFileAsync(process.execPath, [CHECK_BADGE_PATH], { cwd: dir }),
      (err: any) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /usage: node scripts\/check-badge\.mjs <captured-test-output-file>/);
        return true;
      }
    );
  });
});

test("check-badge.mjs exits 1 when the given capture file does not exist", async () => {
  await withScratchDir(async (dir) => {
    await writeFile(path.join(dir, "README.md"), "tests-10 passing");
    await assert.rejects(
      execFileAsync(process.execPath, [CHECK_BADGE_PATH, "missing-file.txt"], { cwd: dir }),
      (err: any) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /could not read captured test output/);
        return true;
      }
    );
  });
});

test("check-badge.mjs exits 1 (to stderr) when the badge does not match the captured pass count", async () => {
  await withScratchDir(async (dir) => {
    await writeFile(path.join(dir, "README.md"), "tests-803 passing");
    await writeFile(path.join(dir, "test-output.txt"), "# tests 960\n# pass 960\n# fail 0\n# skipped 0\n");

    await assert.rejects(
      execFileAsync(process.execPath, [CHECK_BADGE_PATH, "test-output.txt"], { cwd: dir }),
      (err: any) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /badge does not match actual pass count/);
        assert.match(err.stderr, /README badge says 803 but suite has 960/);
        // Never on stdout: the CI step's log-level filtering and any
        // future `2>/dev/null` reproduction locally should still surface
        // a failure.
        assert.doesNotMatch(err.stdout, /badge/);
        return true;
      }
    );
  });
});

test("check-badge.mjs exits 0 (to stdout) when the badge matches the captured pass count", async () => {
  await withScratchDir(async (dir) => {
    await writeFile(path.join(dir, "README.md"), "tests-960 passing");
    await writeFile(path.join(dir, "test-output.txt"), "# tests 960\n# pass 960\n# fail 0\n# skipped 0\n");

    const { stdout } = await execFileAsync(process.execPath, [CHECK_BADGE_PATH, "test-output.txt"], { cwd: dir });
    assert.match(stdout, /✓ badge matches actual pass count — README says 960, suite has 960/);
  });
});

test("check-badge.mjs exits 1 when README.md itself is missing from the working directory", async () => {
  await withScratchDir(async (dir) => {
    await writeFile(path.join(dir, "test-output.txt"), "# pass 960\n# skipped 0\n");
    await assert.rejects(
      execFileAsync(process.execPath, [CHECK_BADGE_PATH, "test-output.txt"], { cwd: dir }),
      (err: any) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /could not read README\.md/);
        return true;
      }
    );
  });
});
