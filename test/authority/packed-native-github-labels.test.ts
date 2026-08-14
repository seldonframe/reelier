import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test("packed native GitHub labels harness rejects an existing non-tarball input", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "reelier-packed-native-test-"));
  try {
    const nonTarball = path.join(root, "not-a-tarball.txt");
    writeFileSync(nonTarball, "not a package", "utf8");
    assert.throws(() => execFileSync(process.execPath, ["test/packed/native-github-labels.mjs", nonTarball], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" }), /tgz|tarball/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
