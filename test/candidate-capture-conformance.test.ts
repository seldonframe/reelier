import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const capture = await import(pathToFileURL(resolve("conformance/candidate-capture/v0/check.mjs")).href);
const digest = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const identityDigest = (char: string) => `sha256:${char.repeat(64)}`;
const evaluatedAt = "2026-08-16T01:00:00.000Z";
const capturedAt = "2026-08-16T00:55:00.000Z";
const freshUntil = "2026-08-16T01:55:00.000Z";
const adapters: Record<string, string> = {
  codex: "codex",
  "claude-code": "claude-code",
  eve: "eve",
  "grok-build": "xai.grok-build",
  "grok-bot": "xai.grok-bot",
};

function rawCandidate(harnessId: string, adapterId = adapters[harnessId]) {
  return JSON.stringify({
    v: "reelier.black-box-candidate/v0",
    descriptor: { adapterId, agentHost: harnessId },
    result: { coverageMode: "observed", dispatch: "unchecked" },
  });
}

function presentInput(harnessId: string, overrides: Record<string, unknown> = {}) {
  const rawJson = rawCandidate(harnessId);
  const base = {
    v: "reelier.candidate-capture/v0",
    harness: { id: harnessId, instanceIdentityDigest: identityDigest("a") },
    adapter: { id: adapters[harnessId], instanceIdentityDigest: identityDigest("b") },
    evaluatedAt,
    captureMode: "live-candidate",
    capturedAt,
    freshUntil,
    evidenceMode: "observed",
    artifact: { kind: "candidate", rawJson, rawDigest: digest(rawJson) },
  };
  const merged = { ...base, ...overrides } as any;
  merged.bindingDigest = capture.captureBindingDigest(merged);
  return merged;
}

function withReportDigest(report: any) {
  return { ...report, reportDigest: capture.captureReportDigest(report) };
}

test("all five harnesses share one transport-neutral live candidate boundary", () => {
  for (const harnessId of Object.keys(adapters)) {
    const input = presentInput(harnessId);
    const report = capture.captureCandidate(input);
    assert.equal(report.status, "passed", harnessId);
    assert.equal(report.classification, "live-candidate-observed", harnessId);
    assert.equal(report.harness.id, harnessId);
    assert.equal(report.adapter.id, adapters[harnessId]);
    assert.equal(report.artifact.kind, "candidate");
    assert.equal(report.artifact.rawDigest, input.artifact.rawDigest);
    assert.equal("rawJson" in report.artifact, false);
    assert.equal(report.freshness.status, "fresh");
    assert.equal(report.nonClaims.semanticConformance, "not-proved-by-capture");
    assert.equal(report.nonClaims.routeEnforcement, "not-proved");
    assert.equal(capture.validateCandidateCaptureReport(report, input), true);
  }
});

test("fixture and observed captures remain non-passing with explicit non-claims", () => {
  for (const mode of ["fixture", "observed"] as const) {
    const report = capture.captureCandidate(presentInput("grok-build", { captureMode: mode }));
    assert.equal(report.status, "failed", mode);
    assert.equal(report.classification, `${mode}-only`);
    assert.ok(report.reasonCodes.includes(`${mode}-capture-non-passing`));
    assert.equal(report.nonClaims.liveHarnessExecution, "not-proved");
    assert.equal(report.nonClaims.routeEnforcement, "not-proved");
    assert.equal(report.nonClaims.outcomeCorrectness, "not-proved");
    assert.equal(report.nonClaims.productionSafety, "not-proved");
  }
});

test("an explicit missing candidate is not-tested and never synthesized", () => {
  const input = {
    v: "reelier.candidate-capture/v0",
    harness: { id: "grok-bot", instanceIdentityDigest: identityDigest("a") },
    adapter: { id: "xai.grok-bot", instanceIdentityDigest: identityDigest("b") },
    evaluatedAt,
    missingCandidate: true,
  };
  const report = capture.captureCandidate(input);
  assert.equal(report.status, "not-tested");
  assert.equal(report.classification, "not-tested");
  assert.equal(report.artifact, null);
  assert.equal(report.bindingDigest, null);
  assert.equal(report.freshness.status, "absent");
  assert.deepEqual(report.reasonCodes, ["candidate-missing", "not-tested"]);
  assert.equal(report.nonClaims.liveHarnessExecution, "not-proved");
  assert.equal(capture.validateCandidateCaptureReport(report, input), true);
});

test("closed capture input rejects extra fields and mixed missing/present states", () => {
  assert.throws(() => capture.captureCandidate({ ...presentInput("codex"), surprise: true }), /invalid|additional/i);
  assert.throws(() => capture.captureCandidate({ ...presentInput("codex"), missingCandidate: true }), /invalid|oneOf/i);
  assert.throws(() => capture.captureCandidate({
    v: "reelier.candidate-capture/v0",
    harness: { id: "made-up", instanceIdentityDigest: identityDigest("a") },
    adapter: { id: "made-up", instanceIdentityDigest: identityDigest("b") },
    evaluatedAt,
    missingCandidate: true,
  }), /invalid|harness/i);
});

test("harness, adapter, raw artifact identity, and instance binding mismatches reject", () => {
  const adapterMismatch = presentInput("codex", { adapter: { id: "claude-code", instanceIdentityDigest: identityDigest("b") } });
  assert.throws(() => capture.captureCandidate(adapterMismatch), /harness.*adapter|identity/i);

  const rawJson = rawCandidate("codex", "claude-code");
  const rawMismatch = presentInput("codex", { artifact: { kind: "candidate", rawJson, rawDigest: digest(rawJson) } });
  assert.throws(() => capture.captureCandidate(rawMismatch), /raw.*identity|artifact.*identity/i);

  const bindingMismatch = presentInput("eve");
  bindingMismatch.harness.instanceIdentityDigest = identityDigest("c");
  assert.throws(() => capture.captureCandidate(bindingMismatch), /binding|instance/i);
});

test("raw report identity is bound and its exact bytes are committed", () => {
  const rawJson = JSON.stringify({
    v: "reelier.agent-adapter-conformance-report/v0",
    adapterId: "xai.grok-bot",
    status: "passed",
    checks: [],
  });
  const input = presentInput("grok-bot", {
    evidenceMode: "enforced",
    artifact: { kind: "report", rawJson, rawDigest: digest(rawJson) },
  });
  const report = capture.captureCandidate(input);
  assert.equal(report.status, "passed");
  assert.equal(report.classification, "live-candidate-enforced");
  assert.equal(report.nonClaims.routeEnforcement, "asserted-not-verified");

  const forged = structuredClone(input);
  forged.artifact.rawJson += " ";
  forged.bindingDigest = capture.captureBindingDigest(forged);
  assert.throws(() => capture.captureCandidate(forged), /raw.*digest|commitment/i);
});

test("stale, future-dated, malformed, and overlong freshness windows reject", () => {
  assert.throws(() => capture.captureCandidate(presentInput("eve", { evaluatedAt: freshUntil })), /stale|freshness/i);
  assert.throws(() => capture.captureCandidate(presentInput("eve", { capturedAt: "2026-08-16T01:00:00.001Z" })), /future|capturedAt/i);
  assert.throws(() => capture.captureCandidate(presentInput("eve", { capturedAt: "2026-99-99T00:00:00.000Z" })), /timestamp|capturedAt/i);
  assert.throws(() => capture.captureCandidate(presentInput("eve", { freshUntil: "2026-08-17T00:55:00.001Z" })), /freshness|window/i);
});

test("credential-like fields and token-shaped values are rejected rather than redacted", () => {
  const sensitive = [
    { authorization: "Bearer opaque" },
    { apiKey: "not-even-a-real-key" },
    { authToken: "placeholder" },
    { nested: { sessionToken: "placeholder" } },
    { nested: { password: "placeholder" } },
    { value: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" },
    { value: "-----BEGIN PRIVATE KEY-----" },
  ];
  for (const payload of sensitive) {
    const rawJson = JSON.stringify({ v: "reelier.black-box-candidate/v0", descriptor: { adapterId: "codex", agentHost: "codex" }, payload });
    const input = presentInput("codex", { artifact: { kind: "candidate", rawJson, rawDigest: digest(rawJson) } });
    assert.throws(() => capture.captureCandidate(input), /credential|secret|token|sensitive|redact/i);
  }
});

test("report validation detects status, digest, identity, reason, and freshness forgeries", () => {
  const input = presentInput("claude-code");
  const report = capture.captureCandidate(input);
  assert.equal(capture.validateCandidateCaptureReport({ ...report, extra: true }, input), false);
  assert.equal(capture.validateCandidateCaptureReport({ ...report, status: "failed" }, input), false);
  assert.equal(capture.validateCandidateCaptureReport(withReportDigest({ ...report, harness: { ...report.harness, id: "codex" } }), input), false);
  assert.equal(capture.validateCandidateCaptureReport(withReportDigest({ ...report, reasonCodes: ["forged"] }), input), false);
  assert.equal(capture.validateCandidateCaptureReport(withReportDigest({ ...report, freshness: { ...report.freshness, status: "stale" } }), input), false);
  assert.equal(capture.validateCandidateCaptureReport({ ...report, reportDigest: identityDigest("f") }, input), false);
});

test("CLI absence emits a closed not-tested report without a synthetic candidate", () => {
  const cli = spawnSync(process.execPath, [resolve("conformance/candidate-capture/v0/check.mjs")], { encoding: "utf8" });
  assert.equal(cli.status, 2);
  const report = JSON.parse(cli.stdout);
  assert.equal(report.status, "not-tested");
  assert.equal(report.harness, null);
  assert.equal(report.adapter, null);
  assert.equal(report.artifact, null);
  assert.equal(report.bindingDigest, null);
  assert.equal(report.reportDigest, null);
  assert.equal(capture.validateCandidateCaptureReport(report), true);
});
