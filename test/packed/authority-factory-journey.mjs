import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  const exec = (command, arguments_) => { const result = spawnSync(command, arguments_, { cwd: consumer, encoding: "utf8" }); assert.equal(result.error, undefined); return result; };
  const npm = arguments_ => { const result = exec(process.execPath, [npmCli, ...arguments_]); assert.equal(result.status, 0, result.stderr); }; npm(["init", "-y"]); npm(["install", "--ignore-scripts", "--no-package-lock", tarball]);
  const bin = path.join(consumer, "node_modules", ".bin", process.platform === "win32" ? "reelier.cmd" : "reelier");
  const result = exec(bin, ["authority", "certify", "factory-journey", "--out", out]); assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, ""); assert.match(result.stdout, /^[^\r\n]+\r?\n$/);
  const line = JSON.parse(result.stdout.trim()); assert.deepEqual(Object.keys(line).sort(), ["graphDigest", "graphPath", "journey", "status", "summaryDigest", "summaryPath", "trustPath"]); assert.equal(line.status, "verified"); assert.equal(line.journey, "github-issue-labels");
  const require = createRequire(path.join(consumer, "consumer.cjs")), authorityPath = require.resolve("reelier/authority"); assert.equal(path.relative(consumer, authorityPath).startsWith(".."), false, "installed module stays in clean consumer");
  const authority = await import(pathToFileURL(authorityPath).href), graph = JSON.parse(readFileSync(line.graphPath, "utf8")), trustPin = JSON.parse(readFileSync(line.trustPath, "utf8")), summary = JSON.parse(readFileSync(line.summaryPath, "utf8"));
  assert.equal(authority.verifyCertificationTaskReceiptGraph(graph, { trustPin }).status, "verified"); assert.equal(line.graphDigest, authority.authorityDigest(graph)); assert.equal(line.summaryDigest, authority.authorityDigest(summary)); assert.equal(summary.graphDigest, line.graphDigest);
  for (const file of [line.graphPath, line.trustPath, line.summaryPath]) { assert.equal(path.relative(out, file).startsWith(".."), false); assert.ok(existsSync(file)); }
  assert.deepEqual(require("node:fs").readdirSync(out).sort(), ["factory-journey-summary.json", "graph.json", "trust-pin.json"]);
} finally { rmSync(consumer, { recursive: true, force: true }); }
