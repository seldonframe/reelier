import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(fixtureRoot, "../../../..");
const schema = JSON.parse(await readFile(resolve(fixtureRoot, "conformance-report.schema.json"), "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const nonClaims = Object.freeze({ contentCorrectness: "not-proved", grokBot: "not-tested", productionReadiness: "not-proved", safety: "not-proved", topology: "not-proved", trafficCompleteness: "not-proved" });
export function assertClosedInertReport(value) {
  assertInertJson(value, "report");
}

function assertInertJson(value, path) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (!value || typeof value !== "object") throw new TypeError(`${path} must contain only inert JSON values`);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`${path} has an altered array prototype`);
    const keys = Reflect.ownKeys(value);
    const expected = [...value.keys()].map(String).concat("length");
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new TypeError(`${path} array keys are not exact`);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError(`${path}[${index}] is not an inert data descriptor`);
      assertInertJson(descriptor.value, `${path}[${index}]`);
    }
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (!length || !("value" in length) || length.enumerable || length.configurable) throw new TypeError(`${path}.length is not canonical`);
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${path} has an altered record prototype`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError(`${path} contains a symbol key`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError(`${path}.${key} is not an inert enumerable data descriptor`);
    assertInertJson(descriptor.value, `${path}.${key}`);
  }
}

async function main() {
const logsRoot = await mkdtemp(resolve(tmpdir(), "reelier-eve-conformance-"));
try {
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error(`Node 24 is required; received ${process.version}`);
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath is required for the clean-checkout runner");
  await command(process.execPath, [npmCli, "run", "build"], "root-build");
  await command(process.execPath, [resolve(repositoryRoot, "node_modules/typescript/bin/tsc"), "-p", resolve(repositoryRoot, "tsconfig.test.json")], "test-compile");
  const { authorityCanonicalBytes, authorityDigest } = await import("../../../../../dist/authority/index.js");
  await command(process.execPath, [resolve(repositoryRoot, "conformance/continuity-adapter/v1/check.mjs"), resolve(repositoryRoot, "conformance/continuity-adapter/v1/fixtures/core-candidate.mjs")], "generic-candidate");
  const matrixPath = resolve(logsRoot, "matrix.json");
  await command(process.execPath, ["--test", "--test-concurrency=1", resolve(repositoryRoot, "dist-test/test/continuity/eve-kill-resume.test.js")], "eve-process-matrix", { REELIER_EVE_MATRIX_RESULT_PATH: matrixPath });
  await command(process.execPath, ["--test", "--test-concurrency=1", resolve(repositoryRoot, "dist-test/test/continuity/adapter.test.js"), resolve(repositoryRoot, "dist-test/test/continuity/authority-bridge.test.js"), resolve(repositoryRoot, "dist-test/test/continuity/path-c-port.test.js")], "focused-continuity");
  const matrix = JSON.parse(await readFile(matrixPath, "utf8"));
  const reelierCommit = (await command("git", ["rev-parse", "HEAD"], "git-commit")).trim();
  const candidate = JSON.parse((await command(process.execPath, [resolve(repositoryRoot, "conformance/continuity-adapter/v1/check.mjs"), resolve(repositoryRoot, "conformance/continuity-adapter/v1/fixtures/core-candidate.mjs")], "candidate-report")).trim());
  const base = {
    v: "reelier.continuity-eve-conformance-report/v1",
    status: "passed",
    maturity: "reproduced",
    reelierCommit,
    authorityAdapterContractDigest: candidate.authorityAdapterContractDigest,
    eveVersion: "0.37.1",
    nodeVersion: process.version,
    checks: Object.freeze([
      { id: "generic-candidate", status: "passed", detail: "public continuity adapter candidate checks passed" },
      { id: "eve-process-matrix", status: "passed", detail: "real Eve kill, resume, stream, control, identity, and model matrix passed" },
      { id: "focused-continuity", status: "passed", detail: "focused Path C and Continuity suites passed" },
    ]),
    artifacts: { ledgerHeadDigest: matrix.artifacts.ledgerHeadDigest, receiptGraphDigest: matrix.artifacts.receiptGraphDigest },
    nonClaims,
  };
  assertClosedInertReport(base);
  const reportDigest = authorityDigest(base);
  const report = Object.freeze({ ...base, artifacts: Object.freeze({ ...base.artifacts, reportDigest }) });
  assertClosedInertReport(report);
  if (!validate(report)) throw new Error(`closed report validation failed: ${JSON.stringify(validate.errors)}`);
  process.stdout.write(`${authorityCanonicalBytes(report).toString("utf8")}\n`);
  await rm(logsRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
} catch (error) {
  process.stderr.write(`continuity Eve conformance failed: ${String(error?.message ?? error).slice(-4_000)}\n`);
  process.exitCode = 1;
}
}

async function command(executable, args, label, extraEnv = {}) {
  const child = spawn(executable, args, { cwd: repositoryRoot, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  child.stdout.on("data", (chunk) => { output = bounded(output + String(chunk)); });
  child.stderr.on("data", (chunk) => { output = bounded(output + String(chunk)); });
  const code = await new Promise((resolveExit, reject) => { child.once("error", reject); child.once("close", resolveExit); });
  if (code !== 0) throw new Error(`${label} exited ${code}\n${output}`);
  return output;
}
function bounded(value) { return value.length > 16_000 ? value.slice(-16_000) : value; }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
