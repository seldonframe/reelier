import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("real Eve process supplies a complete live agent-adapter v0 candidate", async () => {
  const output = await mkdtemp(join(tmpdir(), "reelier-eve-live-agent-adapter-v0-"));
  try {
    const result = await run(output);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const candidate = JSON.parse(await readFile(join(output, "candidate.json"), "utf8")) as Record<string, any>;
    const report = JSON.parse(await readFile(join(output, "report.json"), "utf8")) as Record<string, any>;
    const evidence = JSON.parse(await readFile(join(output, "execution-evidence.json"), "utf8")) as Record<string, any>;
    assert.equal(candidate.descriptor.agentHost, "eve");
    assert.equal(candidate.descriptor.adapterId, "eve");
    assert.equal(candidate.descriptor.execution, "live-candidate");
    assert.equal(candidate.descriptor.authorityContract.status, "frozen");
    assert.match(candidate.descriptor.authorityContract.digest, /^sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(evidence.semanticOperations, [
      "jobs.search",
      "jobs.load",
      "delegations.request",
      "delegations.status",
      "tasks.status",
      "outcomes.invoke",
      "outcomes.status",
    ]);
    assert.equal(evidence.execution, "eve-process-tool-loop");
    assert.equal(evidence.contract.bound, true);
    assert.equal(evidence.preFreezeRefusal, true);
    assert.equal(report.status, "passed");
    assert.equal(report.adapterId, "eve");
    assert.equal(report.checks.length, 7);
    assert.equal(report.checks.every((check: Record<string, unknown>) => check.status === "passed"), true);
    assert.equal(existsSync(join(output, "candidate.json")), true);
    assert.equal(existsSync(join(output, "report.json")), true);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

async function run(output: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [resolve("conformance/continuity-adapter/v1/eve-fixture/scripts/run-live-agent-adapter-v0.mjs"), "--out", output], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += String(chunk); });
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  const status = await new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", resolveExit);
  });
  return { status, stdout, stderr };
}
