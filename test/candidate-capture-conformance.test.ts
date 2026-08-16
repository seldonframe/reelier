import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const capture = await import(pathToFileURL(resolve("conformance/candidate-capture/v0/check.mjs")).href);
const require = createRequire(import.meta.url);
const digest = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const identityDigest = (char: string) => `sha256:${char.repeat(64)}`;
const evaluatedAt = "2026-08-16T01:00:00.000Z";
const capturedAt = "2026-08-16T00:55:00.000Z";
const freshUntil = "2026-08-16T01:55:00.000Z";
const testClock = () => new Date(evaluatedAt);
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

const runCapture = (input: unknown) => capture.captureCandidate(input, { clock: testClock });

function withReportDigest(report: any) {
  return { ...report, reportDigest: capture.captureReportDigest(report) };
}

test("all five harnesses share one transport-neutral live candidate boundary", () => {
  for (const harnessId of Object.keys(adapters)) {
    const input = presentInput(harnessId);
    const report = runCapture(input);
    assert.equal(report.status, "failed", harnessId);
    assert.equal(report.classification, "live-candidate-observed", harnessId);
    assert.equal(report.harness.id, harnessId);
    assert.equal(report.adapter.id, adapters[harnessId]);
    assert.equal(report.artifact.kind, "candidate");
    assert.equal(report.artifact.rawDigest, input.artifact.rawDigest);
    assert.equal("rawJson" in report.artifact, false);
    assert.equal(report.freshness.status, "fresh");
    assert.equal(report.nonClaims.semanticConformance, "not-proved-by-capture");
    assert.equal(report.nonClaims.routeEnforcement, "not-proved");
    assert.ok(report.reasonCodes.includes("capture-boundary-non-passing"));
    assert.equal(capture.validateCandidateCaptureReport(report, input, { clock: testClock }), true);
  }
});

test("fixture and observed captures remain non-passing with explicit non-claims", () => {
  for (const mode of ["fixture", "observed"] as const) {
    const report = runCapture(presentInput("grok-build", { captureMode: mode }));
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
    missingCandidate: true,
  };
  const report = runCapture(input);
  assert.equal(report.status, "not-tested");
  assert.equal(report.classification, "not-tested");
  assert.equal(report.artifact, null);
  assert.equal(report.bindingDigest, null);
  assert.equal(report.freshness.status, "absent");
  assert.deepEqual(report.reasonCodes, ["candidate-missing", "not-tested"]);
  assert.equal(report.nonClaims.liveHarnessExecution, "not-proved");
  assert.equal(capture.validateCandidateCaptureReport(report, input, { clock: testClock }), true);
});

test("malformed supplied input emits failed invalid-candidate rather than candidate-missing", () => {
  for (const invalid of [
    { ...presentInput("codex"), surprise: true },
    { ...presentInput("codex"), missingCandidate: true },
    {
    v: "reelier.candidate-capture/v0",
    harness: { id: "made-up", instanceIdentityDigest: identityDigest("a") },
    adapter: { id: "made-up", instanceIdentityDigest: identityDigest("b") },
    artifact: { kind: "candidate", rawJson: "{", rawDigest: digest("{") },
    captureMode: "live-candidate",
    capturedAt,
    freshUntil,
    evidenceMode: "observed",
    bindingDigest: identityDigest("c"),
  }]) {
    const report = runCapture(invalid);
    assert.equal(report.status, "failed");
    assert.equal(report.classification, "invalid-candidate");
    assert.ok(report.reasonCodes.includes("invalid-candidate"));
    assert.equal(report.reasonCodes.includes("candidate-missing"), false);
    assert.equal(report.artifact === null || !("rawJson" in report.artifact), true);
  }
});

test("harness, adapter, raw artifact identity, and instance binding mismatches emit invalid-candidate", () => {
  const adapterMismatch = presentInput("codex", { adapter: { id: "claude-code", instanceIdentityDigest: identityDigest("b") } });
  const rawJson = rawCandidate("codex", "claude-code");
  const rawMismatch = presentInput("codex", { artifact: { kind: "candidate", rawJson, rawDigest: digest(rawJson) } });
  const bindingMismatch = presentInput("eve");
  bindingMismatch.harness.instanceIdentityDigest = identityDigest("c");
  for (const input of [adapterMismatch, rawMismatch, bindingMismatch]) {
    const report = runCapture(input);
    assert.equal(report.status, "failed");
    assert.equal(report.classification, "invalid-candidate");
    assert.ok(report.reasonCodes.includes("identity-invalid"));
    assert.equal(report.reasonCodes.includes("candidate-missing"), false);
  }
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
  const report = runCapture(input);
  assert.equal(report.status, "failed");
  assert.equal(report.classification, "live-candidate-enforced");
  assert.equal(report.nonClaims.routeEnforcement, "asserted-not-verified");

  const forged = structuredClone(input);
  forged.artifact.rawJson += " ";
  forged.bindingDigest = capture.captureBindingDigest(forged);
  assert.equal(runCapture(forged).classification, "invalid-candidate");
});

test("trusted runtime time rejects backdated replay, future dates, invalid timestamps, and caller clocks", () => {
  const cases = [
    presentInput("eve", { capturedAt: "2026-08-14T00:00:00.000Z", freshUntil: "2026-08-15T00:00:00.000Z" }),
    presentInput("eve", { capturedAt: "2026-08-16T01:00:00.001Z" }),
    presentInput("eve", { capturedAt: "2026-99-99T00:00:00.000Z" }),
    presentInput("eve", { freshUntil: "2026-08-17T00:55:00.001Z" }),
    { ...presentInput("eve"), evaluatedAt: capturedAt },
  ];
  for (const input of cases) {
    const report = runCapture(input);
    assert.equal(report.status, "failed");
    assert.equal(report.classification, "invalid-candidate");
    assert.ok(report.reasonCodes.some((reason: string) => reason.includes("freshness") || reason === "invalid-candidate"));
    assert.equal(report.reasonCodes.includes("candidate-missing"), false);
    assert.equal(report.freshness.evaluatedAt, evaluatedAt);
  }
});

test("raw boundary recursively rejects transport, credential, and common token variants without echoing payload", () => {
  const sensitive = [
    { authorization: "Bearer opaque" },
    { nested: { callbackUrl: "https://example.invalid/callback" } },
    { nested: { webhook_uri: "urn:secret:value" } },
    { nested: { apiEndpoint: "example.invalid" } },
    { nested: { requestHeaders: {} } },
    { nested: { session_cookie: "placeholder" } },
    { apiKey: "not-even-a-real-key" },
    { nested: { access_key_id: "placeholder" } },
    { authToken: "placeholder" },
    { nested: { clientSecret: "placeholder" } },
    { nested: { password: "placeholder" } },
    { value: "Bearer opaque" },
    { value: "sk-example" },
    { value: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" },
    { value: "xox-b-example" },
    { value: "npm_example" },
    { value: "eyJhbGciOiJIUzI1NiJ9.payload.signature" },
    { value: "-----BEGIN PRIVATE KEY-----" },
  ];
  for (const payload of sensitive) {
    const rawJson = JSON.stringify({ v: "reelier.black-box-candidate/v0", descriptor: { adapterId: "codex", agentHost: "codex" }, payload });
    const input = presentInput("codex", { artifact: { kind: "candidate", rawJson, rawDigest: digest(rawJson) } });
    const report = runCapture(input);
    assert.equal(report.status, "failed", JSON.stringify(payload));
    assert.equal(report.classification, "invalid-candidate", JSON.stringify(payload));
    assert.ok(report.reasonCodes.includes("sensitive-artifact"), JSON.stringify(payload));
    assert.deepEqual(report.artifact, { kind: "candidate", rawDigest: digest(rawJson) });
    assert.equal(JSON.stringify(report).includes(JSON.stringify(payload)), false);
  }
});

test("report validation detects status, digest, identity, reason, and freshness forgeries", () => {
  const input = presentInput("claude-code");
  const report = runCapture(input);
  const validates = (value: unknown) => capture.validateCandidateCaptureReport(value, input, { clock: testClock });
  assert.equal(validates({ ...report, extra: true }), false);
  assert.equal(validates({ ...report, classification: "not-tested" }), false);
  assert.equal(validates(withReportDigest({ ...report, harness: { ...report.harness, id: "codex" } })), false);
  assert.equal(validates(withReportDigest({ ...report, reasonCodes: ["forged"] })), false);
  assert.equal(validates(withReportDigest({ ...report, freshness: { ...report.freshness, status: "absent" } })), false);
  assert.equal(validates({ ...report, reportDigest: identityDigest("f") }), false);
});

test("standalone report schema is failed-only and closes every classification cross-field state", () => {
  const schema = JSON.parse(readFileSync(resolve("conformance/candidate-capture/v0/report.schema.json"), "utf8"));
  const Ajv2020 = require("ajv/dist/2020").default;
  const addFormats = require("ajv-formats").default;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const input = presentInput("codex");
  const report = runCapture(input);
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
  assert.equal(validate(withReportDigest({ ...report, status: "passed" })), false);
  assert.equal(validate(withReportDigest({ ...report, classification: "not-tested" })), false);
  assert.equal(validate(withReportDigest({ ...report, artifact: null })), false);
  assert.equal(validate(withReportDigest({ ...report, freshness: { ...report.freshness, status: "absent" } })), false);
  assert.equal(validate(withReportDigest({ ...report, adapter: { ...report.adapter, id: "claude-code" } })), false);
  assert.equal(validate(withReportDigest({ ...report, nonClaims: { ...report.nonClaims, routeEnforcement: "asserted-not-verified" } })), false);
  assert.equal(validate(withReportDigest({ ...report, nonClaims: { ...report.nonClaims, liveHarnessExecution: "not-proved" } })), false);
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

test("CLI malformed supplied input emits invalid-candidate instead of generic absence", () => {
  const root = mkdtempSync(resolve(tmpdir(), "reelier-candidate-capture-"));
  try {
    const inputPath = resolve(root, "malformed.json");
    writeFileSync(inputPath, "{", "utf8");
    const cli = spawnSync(process.execPath, [resolve("conformance/candidate-capture/v0/check.mjs"), inputPath], { encoding: "utf8" });
    assert.equal(cli.status, 1);
    const report = JSON.parse(cli.stdout);
    assert.equal(report.status, "failed");
    assert.equal(report.classification, "invalid-candidate");
    assert.ok(report.reasonCodes.includes("invalid-candidate"));
    assert.equal(report.reasonCodes.includes("candidate-missing"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
