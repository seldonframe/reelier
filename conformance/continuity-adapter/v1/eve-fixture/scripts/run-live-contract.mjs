import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const fixtureRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = process.argv[2] === "--out" ? resolve(process.argv[3] ?? "") : "";
if (!output) throw new TypeError("usage: run-live-contract.mjs --out <directory>");

const runtimeRoot = await mkdtemp(resolve(tmpdir(), "reelier-eve-live-contract-"));
try {
  const { runLiveContract } = await import(pathToFileURL(resolve(fixtureRoot, "scripts/eve-process.mjs")).href);
  const schema = JSON.parse(await readFile(resolve(fixtureRoot, "live-contract.schema.json"), "utf8"));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  await mkdir(output, { recursive: true });
  const resultPath = resolve(output, "live-contract-report.json");
  await runLiveContract(resultPath, runtimeRoot);
  const report = JSON.parse(await readFile(resultPath, "utf8"));
  if (!validate(report)) throw new TypeError(`live Eve contract report schema failed: ${JSON.stringify(validate.errors)}`);
  const { authorityDigest } = await import("reelier/authority");
  const { reportDigest, ...withoutDigest } = report;
  if (reportDigest !== authorityDigest(withoutDigest)) throw new TypeError("live Eve contract report digest failed");
  await writeFile(resolve(output, "schema.json"), `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: report.status, harnessId: report.harnessId, contractDigest: report.contract.digest, output })}\n`);
} catch (error) {
  process.stderr.write(`live Eve contract execution failed: ${String(error?.stack ?? error).slice(-8_000)}\n`);
  process.exitCode = 1;
} finally {
  await rm(runtimeRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
