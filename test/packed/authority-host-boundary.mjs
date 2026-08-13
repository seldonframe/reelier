import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

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
  const npmOptions = { cwd: consumer, stdio: "pipe" };
  const runNpm = (npmArgs) => process.platform === "win32"
    ? execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", `npm ${npmArgs.join(" ")}`], npmOptions)
    : execFileSync("npm", npmArgs, npmOptions);
  runNpm(["init", "-y"]);
  runNpm(["install", "--ignore-scripts", "--no-package-lock", tarball]);
  const host = await import(pathToFileURL(createRequire(path.join(consumer, "consumer.cjs")).resolve("reelier/authority/host")).href);
  for (const root of SUPPORTED_LINUX_HOST_ROOTS) assert.equal(Object.hasOwn(host, root), true, root);
  assert.equal(Object.hasOwn(host, "FsAuthorityLedger"), false);
  const require = createRequire(path.join(consumer, "consumer.cjs"));
  writeFileSync(path.join(consumer, "private-subpath.mjs"), 'import("reelier/authority/host/fs-ledger.js").catch(error => { if (error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") process.exit(0); throw error; }).then(() => process.exitCode ??= 1);');
  assert.equal(execFileSync(process.execPath, ["private-subpath.mjs"], { cwd: consumer }).toString(), "");
  const packageJson = require.resolve("reelier/package.json");
  assert.equal(existsSync(path.join(path.dirname(packageJson), "dist", "authority", "host", "fs-ledger.js")), true);
  const names = Object.keys(host).sort();
  const excluded = names.filter(name => !SUPPORTED_LINUX_HOST_ROOTS.includes(name));
  for (const witness of ["FsDelegationBudgetLedger", "executeJsonHttpsEffect", "launchCodexDogfood", "runCertification", "runCertificationSuite"]) assert.equal(excluded.includes(witness), true, witness);
  assert.match(`sha256:${createHash("sha256").update(JSON.stringify(excluded), "utf8").digest("hex")}`, /^sha256:[0-9a-f]{64}$/);
  if (mode === "windows-native") {
    let dependencyAccesses = 0;
    let callbackInvocations = 0;
    const roots = SUPPORTED_LINUX_HOST_ROOTS.map(name => mkdtempSync(path.join(os.tmpdir(), `reelier-authority-host-${name}-`)));
    const callback = () => { callbackInvocations += 1; throw new Error("callback invoked"); };
    const dependency = (value) => new Proxy(value, { get(target, key, receiver) { dependencyAccesses += 1; return Reflect.get(target, key, receiver); } });
    const assertRefusal = async (operation, name) => {
      await assert.rejects(async () => operation(), error => error?.code === "AUTHORITY_CELL_LINUX_REQUIRED", name);
    };
    await assertRefusal(() => host.createAuthorityEgressGateway(dependency({ config: { v: "reelier.egress-gateway-config/v1", bearerRef: "env:TOKEN", allowedHosts: ["example.com"] }, secrets: dependency({ resolve: callback }) })), "createAuthorityEgressGateway");
    await assertRefusal(() => host.createAuthorityHostRuntime(dependency({})), "createAuthorityHostRuntime");
    await assertRefusal(() => host.createAuthorityHostServer(dependency({ ledgerDir: roots[2] }), dependency({}), dependency({ principalRegistry: dependency({ resolve: callback }) })), "createAuthorityHostServer");
    await assertRefusal(() => host.createCertificationCellHost(dependency({ workspace: roots[3], currentTrustPinPath: path.join(roots[3], "trust.json"), delegationAuthority: dependency({ signGrant: callback }) })), "createCertificationCellHost");
    await assertRefusal(() => host.createDelegationAuthority(dependency({ root: roots[4], signGrant: callback })), "createDelegationAuthority");
    await assertRefusal(() => host.createDispatchCoordinator(dependency({}), dependency({ dispatch: callback }), dependency({ write: callback }), dependency({ publish: callback }), dependency({ reserve: callback })), "createDispatchCoordinator");
    await assertRefusal(() => host.createFileReceiptPublication(dependency({ root: roots[6] })), "createFileReceiptPublication");
    await assertRefusal(() => host.createLocalAuthorityRuntime(dependency({ ledgerDir: roots[7], decisionDir: roots[7], receiptDir: roots[7], tenant: "tenant", requester: "requester", definitions: [] }), dependency({ dispatchAdapter: dependency({ dispatch: callback }) })), "createLocalAuthorityRuntime");
    assert.equal(dependencyAccesses, 0, "native Windows refusal precedes every dependency property access");
    assert.equal(callbackInvocations, 0, "native Windows refusal invokes no callback");
    for (const root of roots) assert.deepEqual(readdirSync(root), [], `native Windows refusal leaves ${root} empty`);
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
