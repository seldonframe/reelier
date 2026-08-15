import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("npm packaging declares the universal native artifact directory and refuses when generated artifacts are absent", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { files?: unknown; scripts?: Record<string, string> };
  assert.ok(Array.isArray(manifest.files) && manifest.files.includes("native/bootstrap-helper/manifest.json") && manifest.files.includes("native/bootstrap-helper/linux-x64/reelier-bootstrap-helper") && manifest.files.includes("native/bootstrap-helper/win32-x64/reelier-bootstrap-helper.exe"));
  assert.equal(manifest.scripts?.prepack, "node scripts/verify-bootstrap-native-artifacts.mjs");
  const npmCli = [process.env.npm_execpath, path.join(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js"), path.join(process.execPath, "..", "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")].find(value => value && existsSync(value));
  assert.ok(npmCli, "npm CLI path is available");
  const hasCertifiedArtifacts = existsSync(path.join(root, "native", "bootstrap-helper", "manifest.json"));
  const packed = spawnSync(process.execPath, [npmCli, "pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8" });
  if (!hasCertifiedArtifacts) {
    assert.notEqual(packed.status, 0);
    assert.match(`${packed.stdout}\n${packed.stderr}`, /native bootstrap artifacts unavailable: manifest\.json is missing/i);
    return;
  }
  assert.equal(packed.status, 0, packed.stderr);
  const jsonStart = packed.stdout.indexOf("[");
  assert.notEqual(jsonStart, -1, packed.stdout);
  const files = JSON.parse(packed.stdout.slice(jsonStart)) as [{ files: Array<{ path: string }> }];
  assert.deepEqual(files[0]?.files.map(file => file.path).filter(file => file.startsWith("native/bootstrap-helper/")).sort(), [
    "native/bootstrap-helper/linux-x64/reelier-bootstrap-helper",
    "native/bootstrap-helper/manifest.json",
    "native/bootstrap-helper/win32-x64/reelier-bootstrap-helper.exe",
  ]);
});

test("native build and workflow gates reject an unsupported target without guessing", () => {
  const build = spawnSync(process.execPath, ["scripts/build-bootstrap-native.mjs", "--target", "darwin-arm64"], { cwd: root, encoding: "utf8" });
  assert.equal(build.status, 1);
  assert.match(build.stderr, /^native bootstrap build refused: unsupported target darwin-arm64\r?\n$/);
  const workflow = spawnSync(process.execPath, ["scripts/verify-bootstrap-native-workflow.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(workflow.status, 0, workflow.stderr);
  assert.equal(workflow.stdout, "native bootstrap workflow verified\n");
});
