import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const tarball = process.argv[2];
assert.equal(process.argv.length, 3, "usage: native-github-labels.mjs <absolute-tarball-path>");
assert.ok(tarball && path.isAbsolute(tarball) && path.extname(tarball) === ".tgz", "an absolute .tgz tarball path is required");
assert.ok(existsSync(tarball) && lstatSync(tarball).isFile() && !lstatSync(tarball).isSymbolicLink(), "packed tarball must be a regular file");
const consumer = mkdtempSync(path.join(os.tmpdir(), "reelier-native-github-labels-consumer-"));
try {
  const npmCli = [process.env.npm_execpath, path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")].find(value => value && existsSync(value));
  assert.ok(npmCli, "npm CLI is required");
  const run = args => { const result = spawnSync(process.execPath, [npmCli, ...args], { cwd: consumer, encoding: "utf8" }); assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr); };
  run(["init", "-y"]);
  run(["install", "--offline", "--ignore-scripts", "--no-package-lock", tarball]);
  const require = createRequire(path.join(consumer, "consumer.cjs"));
  const authorityPath = require.resolve("reelier/authority");
  assert.equal(path.relative(consumer, authorityPath).startsWith(".."), false, "verification surface must come from the installed tarball");
  const authority = await import(pathToFileURL(authorityPath).href);
  const contractRoot = path.resolve(authorityPath, "..", "..", "..", "contract", "authority", "v1");
  const contractFiles = new Map(authority.AUTHORITY_ADAPTER_CONTRACT_V1.members.map(member => [member.path, readFileSync(path.join(contractRoot, member.path))]));
  assert.equal(authority.verifyAuthorityAdapterContractV1(authority.AUTHORITY_ADAPTER_CONTRACT_V1, contractFiles).digest, authority.AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST);
  const tarballDigest = `sha256:${createHash("sha256").update(readFileSync(tarball)).digest("hex")}`;
  console.log(JSON.stringify({ v: "reelier.native-github-labels-packed/v1", tarballDigest, verification: "verified", liveProviderStatus: "absent", namedHostConformance: "unchecked" }));
} finally { rmSync(consumer, { recursive: true, force: true }); }
