import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

interface MutableCandidate {
  descriptor: { operations: string[] };
  session: { principalId: string };
  transcript: Array<{
    operation: string;
    request: Record<string, unknown>;
    response: Record<string, unknown>;
  }>;
  coverageProbes: Array<Record<string, unknown>>;
}

const checker = path.join(process.cwd(), "conformance", "agent-adapter", "v0", "check.mjs");
const fixtureDirectory = path.join(process.cwd(), "conformance", "agent-adapter", "v0", "fixtures");
const semanticCheckIds = [
  "universal-operations",
  "dynamic-job-discovery",
  "host-bound-outcome-input",
  "attenuated-child-principal",
  "pre-freeze-no-dispatch",
  "observed-coverage-honesty",
  "enforced-mode-unavailable",
];

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

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixtureDirectory, name), "utf8"));
}

function mutableFixture(name = "grok-build-observed.json"): MutableCandidate {
  return structuredClone(fixture(name)) as MutableCandidate;
}

function event(candidate: MutableCandidate, operation: string): MutableCandidate["transcript"][number] {
  const found = candidate.transcript.find((item) => item.operation === operation);
  assert.ok(found, operation);
  return found;
}

function assertFailedCheck(result: Readonly<{ report: ConformanceReport }>, id: string): void {
  const check = result.report.checks.find((item) => item.id === id);
  assert.ok(check, `${id} was not reported`);
  assert.equal(check.status, "failed");
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

test("the Grok Build candidate satisfies every universal pre-freeze semantic check", () => {
  const result = runCandidate(fixture("grok-build-observed.json"));
  assert.equal(result.status, 0);
  assert.equal(result.report.adapterId, "xai.grok-build");
  assert.equal(result.report.status, "passed");
  assert.deepEqual(result.report.checks.map((check) => check.id), semanticCheckIds);
  assert.ok(result.report.checks.every((check) => check.status === "passed"));
});

test("Outcome choices cannot inject authenticated tenant identity", () => {
  const candidate = mutableFixture();
  const invoke = event(candidate, "outcomes.invoke");
  (invoke.request.choices as Record<string, unknown>).tenant = "tenant_attacker";
  assertFailedCheck(runCandidate(candidate), "host-bound-outcome-input");
});

test("an adapter cannot load or invoke a job absent from catalog discovery", () => {
  const candidate = mutableFixture();
  const load = event(candidate, "jobs.load");
  load.request.jobRef = "job_undiscovered";
  load.response.jobRef = "job_undiscovered";
  event(candidate, "outcomes.invoke").request.jobRef = "job_undiscovered";
  assertFailedCheck(runCandidate(candidate), "dynamic-job-discovery");
});

test("a child delegation cannot reuse the parent principal", () => {
  const candidate = mutableFixture();
  const delegation = event(candidate, "delegations.request");
  delegation.request.childPrincipalId = candidate.session.principalId;
  delegation.response.principalId = candidate.session.principalId;
  assertFailedCheck(runCandidate(candidate), "attenuated-child-principal");
});

test("a pre-freeze adapter cannot report an accepted Outcome", () => {
  const candidate = mutableFixture();
  const invoke = event(candidate, "outcomes.invoke");
  invoke.response.verdict = "accepted";
  invoke.response.reasonCode = "accepted";
  invoke.response.lifecycleState = "accepted";
  assertFailedCheck(runCandidate(candidate), "pre-freeze-no-dispatch");
});

test("observed mode cannot upgrade completeness", () => {
  const candidate = mutableFixture();
  const observed = candidate.coverageProbes.find((probe) => probe.mode === "observed");
  assert.ok(observed);
  observed.completeness = "verified";
  assertFailedCheck(runCandidate(candidate), "observed-coverage-honesty");
});

test("enforced mode cannot activate with unchecked topology", () => {
  const candidate = mutableFixture();
  const enforced = candidate.coverageProbes.find((probe) => probe.mode === "enforced");
  assert.ok(enforced);
  enforced.activation = "available";
  assertFailedCheck(runCandidate(candidate), "enforced-mode-unavailable");
});

test("a provider-specific tool cannot replace a universal semantic operation", () => {
  const candidate = mutableFixture();
  candidate.descriptor.operations[candidate.descriptor.operations.indexOf("tasks.status")] = "stripe.refunds.create";
  assertFailedCheck(runCandidate(candidate), "universal-operations");
});

test("Grok Build and Grok Bot share identical transport-neutral semantics", () => {
  const build = runCandidate(fixture("grok-build-observed.json"));
  const bot = runCandidate(fixture("grok-bot-observed.json"));
  assert.equal(build.report.status, "passed");
  assert.equal(bot.report.status, "passed");
  assert.equal(bot.report.adapterId, "xai.grok-bot");
  assert.deepEqual(bot.report.checks.map((check) => check.id), build.report.checks.map((check) => check.id));
  assert.deepEqual(bot.report.checks.map((check) => check.status), build.report.checks.map((check) => check.status));
});

test("the package script checks an adapter candidate end to end", () => {
  const candidate = path.join("conformance", "agent-adapter", "v0", "fixtures", "grok-build-observed.json");
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd", "run", "check:agent-adapter", "--", candidate]
    : ["run", "check:agent-adapter", "--", candidate];
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const lines = result.stdout.trim().split(/\r?\n/);
  const report = JSON.parse(lines.at(-1) ?? "") as ConformanceReport;
  assert.equal(report.v, "reelier.agent-adapter-conformance-report/v0");
  assert.equal(report.adapterId, "xai.grok-build");
  assert.equal(report.status, "passed");
});
