import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] === "--out" ? resolve(process.argv[3] ?? "") : "";
if (!output) throw new TypeError("usage: run-live-agent-adapter-v0.mjs --out <directory>");

const runtimeRoot = await mkdtemp(resolve(tmpdir(), "reelier-eve-live-agent-adapter-v0-"));
try {
  const fixtureRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const { runLiveAgentAdapterV0 } = await import(pathToFileURL(resolve(fixtureRoot, "scripts/eve-process.mjs")).href);
  await mkdir(output, { recursive: true });
  await runLiveAgentAdapterV0(resolve(output, "candidate.json"), runtimeRoot);
  const report = JSON.parse(await readFile(resolve(output, "report.json"), "utf8"));
  process.stdout.write(`${JSON.stringify({ status: report.status, harnessId: report.adapterId, output })}\n`);
} catch (error) {
  process.stderr.write(`live Eve v0 adapter execution failed: ${String(error?.stack ?? error).slice(-8_000)}\n`);
  process.exitCode = 1;
} finally {
  await rm(runtimeRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
