import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const SUPPORTED_LINUX_HOST_ROOTS = ["createAuthorityEgressGateway", "createAuthorityHostRuntime", "createAuthorityHostServer", "createCertificationCellHost", "createDelegationAuthority", "createDispatchCoordinator", "createFileReceiptPublication", "createLocalAuthorityRuntime"];
const args = process.argv.slice(2);
const tarballIndex = args.indexOf("--tarball");
const modeIndex = args.indexOf("--mode");
if (tarballIndex < 0 || modeIndex < 0 || !args[tarballIndex + 1] || !args[modeIndex + 1]) throw new Error("usage: --tarball <absolute-path> --mode surface|windows-native");
const tarball = args[tarballIndex + 1];
const mode = args[modeIndex + 1];
assert.equal(path.isAbsolute(tarball), true, "tarball path is absolute");
assert.equal(existsSync(tarball), true, "tarball exists");
assert.ok(["surface", "windows-native"].includes(mode), "known mode");
if (mode === "windows-native") assert.equal(process.platform, "win32", "native Windows is required");
const consumer = mkdtempSync(path.join(os.tmpdir(), "reelier-authority-host-boundary-"));
try {
  execFileSync("npm", ["init", "-y"], { cwd: consumer, stdio: "pipe" });
  execFileSync("npm", ["install", "--ignore-scripts", "--no-package-lock", tarball], { cwd: consumer, stdio: "pipe" });
  const host = await import(createRequire(path.join(consumer, "consumer.cjs")).resolve("reelier/authority/host"));
  for (const root of SUPPORTED_LINUX_HOST_ROOTS) assert.equal(Object.hasOwn(host, root), true, root);
  assert.equal(Object.hasOwn(host, "FsAuthorityLedger"), false);
  await assert.rejects(() => import("reelier/authority/host/fs-ledger.js"), error => error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED");
  const require = createRequire(path.join(consumer, "consumer.cjs"));
  const packageJson = require.resolve("reelier/package.json");
  assert.equal(existsSync(path.join(path.dirname(packageJson), "dist", "authority", "host", "fs-ledger.js")), true);
  const names = Object.keys(host).sort();
  const excluded = names.filter(name => !SUPPORTED_LINUX_HOST_ROOTS.includes(name));
  for (const witness of ["FsDelegationBudgetLedger", "executeJsonHttpsEffect", "launchCodexDogfood", "runCertification", "runCertificationSuite"]) assert.equal(excluded.includes(witness), true, witness);
  assert.match(`sha256:${createHash("sha256").update(JSON.stringify(excluded), "utf8").digest("hex")}`, /^sha256:[0-9a-f]{64}$/);
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
