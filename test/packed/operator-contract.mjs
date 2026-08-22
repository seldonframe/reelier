import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

let ownedTarball = false;
let tarball = process.argv[2];
const npmCliPath = [process.env.npm_execpath, path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")].find(value => value && existsSync(value));
assert.ok(npmCliPath, "npm CLI is required");
if (process.argv.length === 2) {
  const packed = spawnSync(process.execPath, [npmCliPath, "pack", "--ignore-scripts", "--json"], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const metadata = JSON.parse(packed.stdout);
  tarball = path.resolve(metadata[0]?.filename);
  ownedTarball = true;
} else {
  assert.equal(process.argv.length, 3, "usage: operator-contract.mjs [absolute-tarball-path]");
}
assert.ok(tarball && path.isAbsolute(tarball) && path.extname(tarball) === ".tgz");
assert.ok(existsSync(tarball) && lstatSync(tarball).isFile() && !lstatSync(tarball).isSymbolicLink());

const consumer = mkdtempSync(path.join(os.tmpdir(), "reelier-operator-packed-consumer-"));
try {
  const run = args => { const result = spawnSync(process.execPath, [npmCliPath, ...args], { cwd: consumer, encoding: "utf8" }); assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr); };
  run(["init", "-y"]);
  run(["install", "--offline", "--ignore-scripts", "--no-package-lock", tarball]);
  const require = createRequire(path.join(consumer, "consumer.cjs"));
  const operatorPath = require.resolve("reelier/operator");
  assert.ok(path.relative(consumer, operatorPath) && !path.relative(consumer, operatorPath).startsWith(".."), "Operator must resolve from installed package");
  const operator = await import(pathToFileURL(operatorPath).href);
  assert.equal(typeof operator.createOperatorHarnessRegistryV1, "function");
  assert.equal(typeof operator.createOperatorManagedHandoffV1, "function");
  assert.equal(typeof operator.createOperatorLocalCellV1, "function");
  assert.equal(typeof operator.operatorPlanV1, "function");
  assert.equal(operator.operatorPlanV1("managed-personal").monthlyPriceUsd, 49);
  const hostPath = require.resolve("reelier/authority/host");
  const host = await import(pathToFileURL(hostPath).href);
  assert.deepEqual(host.AGENT_TOOL_NAMES_V1, ["reelier_agent_status", "reelier_outcome_proposal", "reelier_outcome_request", "reelier_outcome_status"]);
  console.log(JSON.stringify({ v: "reelier.operator-packed-contract/v1", operator: "verified", authority: "delegated-to-cell", credentials: "absent" }));
} finally {
  rmSync(consumer, { recursive: true, force: true });
  if (ownedTarball && tarball && existsSync(tarball)) unlinkSync(tarball);
}
