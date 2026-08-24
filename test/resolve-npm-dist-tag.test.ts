import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const script = path.resolve("scripts/resolve-npm-dist-tag.mjs");

function resolve(version: string) {
  return spawnSync(process.execPath, [script, "--version", version], { encoding: "utf8" });
}

test("npm dist-tag resolver keeps stable releases on latest and prereleases on beta", () => {
  const stable = resolve("1.2.3");
  assert.equal(stable.status, 0, stable.stderr);
  assert.equal(stable.stdout.trim(), "latest");

  for (const version of ["1.2.3-beta.0", "1.2.3-rc.4", "1.2.3-alpha.1"]) {
    const prerelease = resolve(version);
    assert.equal(prerelease.status, 0, prerelease.stderr);
    assert.equal(prerelease.stdout.trim(), "beta");
  }
});

test("npm dist-tag resolver refuses malformed or build-only versions", () => {
  for (const version of ["latest", "1.2", "v1.2.3", "1.2.3+build", "1.2.3-beta..1"]) {
    const result = resolve(version);
    assert.notEqual(result.status, 0, version);
    assert.match(result.stderr, /invalid npm release version/i);
  }
});
