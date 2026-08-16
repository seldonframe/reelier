import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputIndex = process.argv.indexOf("--out");
const output = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1] ?? "") : "";
if (!output) throw new TypeError("usage: run-eve-v0-scale.mjs --out <directory>");

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runner = resolve(fixtureRoot, "scripts", "run-live-agent-adapter-v0.mjs");
const levels = [1, 5, 20, 100];
const concurrency = 10;

function runWorker(level, index, target) {
  return new Promise((resolveWorker) => {
    const suffix = `scale_${level}_${index}`;
    const child = spawn(process.execPath, [runner, "--out", target, "--suffix", suffix], { cwd: fixtureRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 120_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", async (code, signal) => {
      clearTimeout(timer);
      let report = null;
      let candidate = null;
      try { report = JSON.parse(await readFile(resolve(target, "report.json"), "utf8")); } catch {}
      try { candidate = JSON.parse(await readFile(resolve(target, "candidate.json"), "utf8")); } catch {}
      resolveWorker({ level, index, suffix, code, signal, report, candidate, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function runLevel(level) {
  const levelRoot = resolve(output, `scale-${level}`);
  await mkdir(levelRoot, { recursive: true });
  const results = [];
  let next = 0;
  let active = 0;
  let peak = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= level) return;
      active += 1;
      peak = Math.max(peak, active);
      const result = await runWorker(level, index, resolve(levelRoot, `worker-${String(index).padStart(3, "0")}`));
      active -= 1;
      results.push(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, level) }, () => worker()));
  results.sort((a, b) => a.index - b.index);
  const taskIds = results.map((result) => result.candidate?.session?.taskId).filter(Boolean);
  const principalIds = results.map((result) => result.candidate?.session?.principalId).filter(Boolean);
  const failures = results.filter((result) => result.code !== 0 || result.report?.status !== "passed" || result.candidate?.liveEvidence?.preFreezeRefusal !== true || JSON.stringify(result.candidate?.liveEvidence?.semanticOperations) !== JSON.stringify(["jobs.search", "jobs.load", "delegations.request", "delegations.status", "tasks.status", "outcomes.invoke", "outcomes.status"]));
  return {
    requested: level,
    completed: results.length - failures.length,
    failed: failures.length,
    peakConcurrency: peak,
    uniqueTaskIds: new Set(taskIds).size,
    uniquePrincipalIds: new Set(principalIds).size,
    identityIsolated: taskIds.length === level && new Set(taskIds).size === level && principalIds.length === level && new Set(principalIds).size === level,
    failures: failures.map(({ level: failureLevel, index, suffix, code, signal, report, stderr }) => ({ level: failureLevel, index, suffix, code, signal, reportStatus: report?.status ?? "missing", stderr: stderr.slice(-2_000) })),
  };
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const levelsReport = [];
for (const level of levels) levelsReport.push(await runLevel(level));
const report = {
  v: "reelier.eve-live-agent-adapter-v0-scale/v0",
  status: levelsReport.every((level) => level.failed === 0 && level.identityIsolated) ? "passed" : "failed",
  harnessId: "eve",
  execution: "eve-process-tool-loop",
  levels: levelsReport,
  contract: { v: "reelier.adapter-contract/v1", semanticOperations: ["jobs.search", "jobs.load", "delegations.request", "delegations.status", "tasks.status", "outcomes.invoke", "outcomes.status"] },
  nonClaims: { providerWrites: "not-proved", retryIdempotency: "not-proved", routeCompleteness: "not-proved", productionSafety: "not-proved" },
};
await import("node:fs/promises").then(({ writeFile }) => writeFile(resolve(output, "scale-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"));
assert.equal(report.status, "passed", JSON.stringify(report));
process.stdout.write(`${JSON.stringify({ status: report.status, levels: levelsReport.map(({ requested, completed, failed, peakConcurrency }) => ({ requested, completed, failed, peakConcurrency })), output })}\n`);
