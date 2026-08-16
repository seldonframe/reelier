import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("real Eve process executes the shared Adapter Contract vector and emits closed evidence", async () => {
  const output = await mkdtemp(join(tmpdir(), "reelier-eve-live-contract-"));
  try {
    const result = await run(output);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(await readFile(join(output, "live-contract-report.json"), "utf8")) as Record<string, any>;
    assert.equal(report.v, "reelier.eve-live-contract-execution/v1");
    assert.equal(report.status, "passed");
    assert.equal(report.execution, "eve-process-tool-loop");
    assert.equal(report.contract.bound, true);
    assert.match(report.contract.digest, /^sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(report.semanticOperations, [
      "jobs.search",
      "jobs.load",
      "delegations.request",
      "outcomes.invoke",
      "outcomes.status",
    ]);
    assert.equal(report.pathC.authenticated, true);
    assert.equal(report.pathC.providerDispatches, 1);
    assert.equal(report.pathC.statusReads, 1);
    assert.equal(report.providerEffect.receipt, "verified");
    assert.equal(report.nonClaims.liveModel, "not-proved");
    assert.equal(report.nonClaims.contentCorrectness, "not-proved");
    assert.equal(report.continuity.fixture, "existing-continuity-fixture");
    assert.equal(existsSync(join(output, "schema.json")), true);
    assert.equal(existsSync(join(output, "adapter-events.jsonl")), true);
    assert.equal(existsSync(join(output, "eve-stream-events.json")), true);
    const search = report.transcript[0];
    const load = report.transcript[1];
    const invoke = report.transcript[3];
    assert.equal(load.input.jobId, search.response.jobs[0].jobRef);
    assert.equal(invoke.input.jobRef, load.response.jobRef);
    assert.equal(report.eveProcess.stepStartedCount >= 6, true);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

async function run(output: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [resolve("conformance/continuity-adapter/v1/eve-fixture/scripts/run-live-contract.mjs"), "--out", output], {
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
