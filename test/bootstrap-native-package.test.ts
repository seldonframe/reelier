import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("npm packaging declares the universal native artifact directory and refuses when generated artifacts are absent", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { files?: unknown; scripts?: Record<string, string> };
  assert.ok(Array.isArray(manifest.files) && manifest.files.includes("native/bootstrap-helper/manifest.json") && manifest.files.includes("native/bootstrap-helper/linux-x64/reelier-bootstrap-helper") && manifest.files.includes("native/bootstrap-helper/win32-x64/reelier-bootstrap-helper.exe"));
  assert.equal(manifest.scripts?.prepack, "node scripts/verify-bootstrap-native-artifacts.mjs");
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
  assert.notEqual(packed.status, 0);
  assert.match(`${packed.stdout}\n${packed.stderr}`, /native bootstrap artifacts unavailable: manifest\.json is missing/i);
});

test("native build and workflow gates reject an unsupported target without guessing", () => {
  const build = spawnSync(process.execPath, ["scripts/build-bootstrap-native.mjs", "--target", "darwin-arm64"], { cwd: root, encoding: "utf8" });
  assert.equal(build.status, 1);
  assert.match(build.stderr, /^native bootstrap build refused: unsupported target darwin-arm64\r?\n$/);
  const workflow = spawnSync(process.execPath, ["scripts/verify-bootstrap-native-workflow.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(workflow.status, 0, workflow.stderr);
  assert.equal(workflow.stdout, "native bootstrap workflow verified\n");
});
