import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function runNode(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", status => resolve({ status, stdout, stderr }));
  });
}

test("five-harness matrix runner consumes an explicit evidence manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-matrix-runner-"));
  try {
    const inputPath = path.join(root, "input.json");
    const reportPath = path.join(root, "report.json");
    const manifestPath = path.join(root, "manifest.json");
    await writeFile(manifestPath, JSON.stringify({
      harnesses: {
        eve: { candidate: "conformance/agent-adapter/v0/fixtures/eve-observed.json" },
        "grok-build": { candidate: "conformance/agent-adapter/v0/fixtures/grok-build-observed.json" },
        "grok-bot": { candidate: "conformance/agent-adapter/v0/fixtures/grok-bot-observed.json" },
      },
      eveContinuityReport: "docs/evidence/eve-continuity-capture-2026-08-16/eve-continuity-detached-report.json",
    }));
    const result = await runNode(["scripts/run-five-harness-matrix.mjs", "--manifest", manifestPath, inputPath, reportPath]);
    assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`);
    if (!result.stdout.includes("grok-build")) throw new Error(`matrix runner produced no summary: ${result.stderr}\n${result.stdout}`);
    const input = JSON.parse(await readFile(inputPath, "utf8"));
    assert.equal(input.candidates.find((entry: any) => entry.harnessId === "codex").missing, true);
    assert.ok(input.candidates.find((entry: any) => entry.harnessId === "grok-build").candidate);
    assert.ok(input.candidates.find((entry: any) => entry.harnessId === "grok-bot").candidate);
    assert.ok(input.candidates.find((entry: any) => entry.harnessId === "eve").continuityEvidence);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.harnesses.find((entry: any) => entry.harnessId === "grok-build").evidenceMaturity, "fixture-only");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
