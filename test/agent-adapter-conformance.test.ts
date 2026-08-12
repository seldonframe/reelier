import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

interface ConformanceCheck {
  id: string;
  status: "passed" | "failed";
  detail: string;
}

interface ConformanceReport {
  v: "reelier.agent-adapter-conformance-report/v0";
  status: "passed" | "failed";
  adapterId: string | null;
  checks: ConformanceCheck[];
}

const checker = path.join(process.cwd(), "conformance", "agent-adapter", "v0", "check.mjs");

function runChecker(args: string[]): Readonly<{ status: number | null; report: ConformanceReport }> {
  const result = spawnSync(process.execPath, [checker, ...args], { cwd: process.cwd(), encoding: "utf8" });
  assert.notEqual(result.stdout.trim(), "", `checker emitted no JSON; stderr=${result.stderr}`);
  return { status: result.status, report: JSON.parse(result.stdout) as ConformanceReport };
}

function runCandidate(value: unknown): Readonly<{ status: number | null; report: ConformanceReport }> {
  const root = mkdtempSync(path.join(tmpdir(), "reelier-agent-adapter-"));
  const candidate = path.join(root, "candidate.json");
  try {
    writeFileSync(candidate, JSON.stringify(value), "utf8");
    return runChecker([candidate]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

test("the checker refuses an open or malformed candidate before semantic checks", () => {
  const result = runCandidate({ v: "reelier.agent-adapter-candidate/v0", extra: true });
  assert.equal(result.status, 1);
  assert.equal(result.report.v, "reelier.agent-adapter-conformance-report/v0");
  assert.equal(result.report.status, "failed");
  assert.equal(result.report.adapterId, null);
  assert.deepEqual(result.report.checks.map((check) => check.id), ["closed-schema"]);
  assert.equal(result.report.checks[0].status, "failed");
});

test("the checker reports missing candidate input as a machine-readable usage failure", () => {
  const result = runChecker([]);
  assert.equal(result.status, 2);
  assert.equal(result.report.status, "failed");
  assert.deepEqual(result.report.checks, [{
    id: "usage",
    status: "failed",
    detail: "usage: check.mjs <candidate.json>",
  }]);
});
