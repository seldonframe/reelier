import test from "node:test";
import assert from "node:assert/strict";
import path, { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";

const { runLiveMcpProbe } = await import(pathToFileURL(resolve("conformance/agent-adapter/v0/live-probe.mjs")).href);

test("live MCP probe exercises the public authority channel and records the semantic vector", async () => {
  const result = await runLiveMcpProbe({ harnessId: "codex", adapterId: "codex" });
  assert.equal(result.report.status, "passed");
  assert.deepEqual(result.toolCalls, [
    "reelier_jobs_search",
    "reelier_job_load",
    "reelier_delegation_request",
    "reelier_outcome_invoke",
    "reelier_outcome_status",
  ]);
  assert.equal(result.candidate.descriptor.agentHost, "codex");
  assert.equal(result.candidate.transcript[3].response.reasonCode, "adapter-contract-pending");
  assert.equal(result.candidate.transcript[4].response.claims.dispatch, "absent");
});

test("live MCP probe CLI emits a detached candidate, report, and capture bundle", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "reelier-live-probe-"));
  try {
    const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolveResult, reject) => {
      const child = spawn(process.execPath, ["scripts/run-agent-adapter-mcp-probe.mjs", "--harness", "codex", "--out", output], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", status => resolveResult({ status, stdout, stderr }));
    });
    assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`);
    const report = JSON.parse(await readFile(path.join(output, "report.json"), "utf8"));
    const captureReport = JSON.parse(await readFile(path.join(output, "capture-report.json"), "utf8"));
    assert.equal(report.status, "passed");
    assert.equal(captureReport.classification, "live-candidate-observed");
    assert.equal(captureReport.status, "failed");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
