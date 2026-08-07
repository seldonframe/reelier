import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The guard that would have caught two releases in a row.
 *
 * 0.30.0 was published nine PRs behind its own docs. 0.31.1 was published from
 * a tag that was NOT an ancestor of main, so a breaking `verify` guard and an
 * output-sanitization fix existed only in the npm tarball and the tag — main
 * had neither, and the next release cut from main would have silently
 * regressed both. Both were found by hand, hours apart, by accident.
 *
 * This exercises the script against real git repositories rather than mocking
 * git, because the whole failure mode is a fact about commit topology. A guard
 * asserted against a fake graph proves nothing about the real one.
 */

const SCRIPT = path.join(process.cwd(), "scripts", "check-release-ancestor.mjs");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A repo with `main`, plus a tag placed either on main or off it. */
async function repoWithTag(tagOnMain: boolean): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-guard-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  await writeFile(path.join(dir, "f.txt"), "one", "utf8");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "one");

  if (!tagOnMain) {
    // Diverge: tag a commit that main will never contain — the 0.31.1 shape.
    git(dir, "checkout", "-q", "-b", "sidebranch");
    await writeFile(path.join(dir, "f.txt"), "published-but-unmerged", "utf8");
    git(dir, "commit", "-qam", "published off-branch");
    git(dir, "tag", "v9.9.9");
    git(dir, "checkout", "-q", "main");
  } else {
    git(dir, "tag", "v9.9.9");
  }
  // The script resolves main as a remote branch in CI; a local ref stands in.
  git(dir, "branch", "-f", "origin-main-standin", "main");
  return dir;
}

function runGuard(cwd: string, ref: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ref, "origin-main-standin"], { cwd, encoding: "utf8" });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("passes when the release tag is an ancestor of main", async () => {
  const dir = await repoWithTag(true);
  try {
    const { code } = runGuard(dir, "v9.9.9");
    assert.equal(code, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FAILS when the release tag is not an ancestor of main — the 0.31.1 case", async () => {
  const dir = await repoWithTag(false);
  try {
    const { code, out } = runGuard(dir, "v9.9.9");
    assert.equal(code, 1, "a tag off main must fail the guard, not warn");
    assert.match(out, /not an ancestor/i);
    assert.match(out, /v9\.9\.9/, "the message must name the tag being published");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fails loudly when the ref does not exist, rather than passing by accident", async () => {
  const dir = await repoWithTag(true);
  try {
    const { code, out } = runGuard(dir, "v0.0.0-nope");
    assert.equal(code, 1);
    assert.match(out, /could not resolve/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fails when main cannot be resolved — a shallow clone must not read as a pass", async () => {
  const dir = await repoWithTag(true);
  try {
    const out = execFileSync(process.execPath, [SCRIPT, "v9.9.9", "refs/heads/does-not-exist"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.fail(`expected a failure, got: ${out}`);
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    assert.equal(e.status, 1);
    assert.match(`${e.stdout ?? ""}${e.stderr ?? ""}`, /could not resolve/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
