import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2), tarballIndex = args.indexOf("--tarball"), outIndex = args.indexOf("--out");
if (args.length !== 4 || tarballIndex < 0 || outIndex < 0) throw new Error("usage: --tarball <absolute-path> --out <absolute-path>");
const tarball = args[tarballIndex + 1], out = args[outIndex + 1];
assert.ok(path.isAbsolute(tarball) && existsSync(tarball), "tarball must be an existing absolute path"); assert.ok(path.isAbsolute(out) && !existsSync(out), "out must be an absent absolute path");
const consumer = mkdtempSync(path.join(os.tmpdir(), "reelier-factory-consumer-"));
try {
  const npmCli = [process.env.npm_execpath, path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")].find(value => value && existsSync(value)); assert.ok(npmCli);
  const npm = arguments_ => execFileSync(process.execPath, [npmCli, ...arguments_], { cwd: consumer, stdio: "pipe" }); npm(["init", "-y"]); npm(["install", "--ignore-scripts", "--no-package-lock", tarball]);
  const bin = path.join(consumer, "node_modules", ".bin", process.platform === "win32" ? "reelier.cmd" : "reelier");
  const stdout = execFileSync(bin, ["authority", "certify", "factory-journey", "--out", out], { cwd: consumer, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const line = JSON.parse(stdout.trim()); assert.deepEqual(Object.keys(line).sort(), ["graphDigest", "graphPath", "journey", "status", "summaryDigest", "summaryPath", "trustPath"]);
  const require = createRequire(path.join(consumer, "consumer.cjs")), authorityPath = require.resolve("reelier/authority"); assert.ok(authorityPath.startsWith(consumer));
  const authority = await import(pathToFileURL(authorityPath).href), graph = JSON.parse(readFileSync(line.graphPath, "utf8")), trustPin = JSON.parse(readFileSync(line.trustPath, "utf8")), summary = JSON.parse(readFileSync(line.summaryPath, "utf8"));
  assert.equal(authority.verifyCertificationTaskReceiptGraph(graph, { trustPin }).status, "verified"); assert.equal(line.graphDigest, authority.authorityDigest(graph)); assert.equal(line.summaryDigest, authority.authorityDigest(summary)); assert.equal(summary.graphDigest, line.graphDigest);
  for (const file of [line.graphPath, line.trustPath, line.summaryPath]) assert.ok(file.startsWith(out) && existsSync(file));
} finally { rmSync(consumer, { recursive: true, force: true }); }
