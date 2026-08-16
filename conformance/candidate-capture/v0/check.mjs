import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION = "reelier.candidate-capture-report/v0";
const MAX_FRESHNESS_MS = 24 * 60 * 60_000;
const ADAPTERS = Object.freeze({
  codex: "codex",
  "claude-code": "claude-code",
  eve: "eve",
  "grok-build": "xai.grok-build",
  "grok-bot": "xai.grok-bot",
});
const SENSITIVE_KEYS = new Set([
  "authorization", "proxyauthorization", "apikey", "token", "authtoken", "sessiontoken",
  "accesstoken", "refreshtoken", "idtoken",
  "password", "passwd", "secret", "clientsecret", "privatekey", "cookie", "setcookie",
  "credential", "credentials",
]);
const TOKEN_PATTERNS = Object.freeze([
  /\bBearer\s+\S+/i,
  /\b(?:sk|gh[pousr]|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
]);
const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const load = (name) => JSON.parse(readFileSync(here(name), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateCapture = ajv.compile(load("./capture.schema.json"));
const validateReport = ajv.compile(load("./report.schema.json"));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function captureBindingDigest(input) {
  const commitment = {
    v: "reelier.candidate-capture-binding/v0",
    harness: input.harness,
    adapter: input.adapter,
    captureMode: input.captureMode,
    capturedAt: input.capturedAt,
    freshUntil: input.freshUntil,
    evaluatedAt: input.evaluatedAt,
    evidenceMode: input.evidenceMode,
    artifact: input.artifact && { kind: input.artifact.kind, rawDigest: input.artifact.rawDigest },
  };
  return sha256(JSON.stringify(canonical(commitment)));
}

export function captureReportDigest(report) {
  const { reportDigest: ignored, ...payload } = report;
  void ignored;
  return sha256(JSON.stringify(canonical({ v: "reelier.candidate-capture-report-integrity/v0", report: payload })));
}

function parseTimestamp(value, label) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new TypeError(`${label} timestamp is invalid`);
  }
  return timestamp;
}

function containsSensitiveData(value) {
  if (typeof value === "string") return TOKEN_PATTERNS.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some(containsSensitiveData);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return SENSITIVE_KEYS.has(normalized) || containsSensitiveData(child);
  });
}

function assertRawIdentity(raw, input) {
  const candidate = input.artifact.kind === "candidate";
  const identity = candidate
    ? { harnessId: raw?.descriptor?.agentHost, adapterId: raw?.descriptor?.adapterId }
    : { harnessId: raw?.harnessId, adapterId: raw?.adapterId };
  const harnessMismatch = candidate ? identity.harnessId !== input.harness.id : identity.harnessId !== undefined && identity.harnessId !== input.harness.id;
  if (harnessMismatch || identity.adapterId !== input.adapter.id) {
    throw new TypeError("raw artifact identity does not match the bound harness and adapter");
  }
}

function validatePresentCapture(input) {
  if (ADAPTERS[input.harness.id] !== input.adapter.id) {
    throw new TypeError("harness and adapter identity do not match");
  }
  const evaluated = parseTimestamp(input.evaluatedAt, "evaluatedAt");
  const captured = parseTimestamp(input.capturedAt, "capturedAt");
  const expiry = parseTimestamp(input.freshUntil, "freshUntil");
  if (captured > evaluated) throw new TypeError("capturedAt is future-dated");
  if (expiry <= captured || expiry - captured > MAX_FRESHNESS_MS) throw new TypeError("capture freshness window is invalid");
  if (evaluated >= expiry) throw new TypeError("capture freshness is stale");
  if (sha256(input.artifact.rawJson) !== input.artifact.rawDigest) throw new TypeError("raw artifact digest commitment is invalid");
  if (captureBindingDigest(input) !== input.bindingDigest) throw new TypeError("capture identity binding digest is invalid");
  let raw;
  try {
    raw = JSON.parse(input.artifact.rawJson);
  } catch {
    throw new TypeError("raw artifact JSON is invalid");
  }
  if (raw === null || Array.isArray(raw) || typeof raw !== "object") throw new TypeError("raw artifact must be a JSON object");
  if (containsSensitiveData(raw)) throw new TypeError("raw artifact contains credential-like or token-shaped sensitive data; redact before capture");
  assertRawIdentity(raw, input);
}

function nonClaimsFor(input) {
  return Object.freeze({
    semanticConformance: "not-proved-by-capture",
    liveHarnessExecution: input?.captureMode === "live-candidate" ? "candidate-supplied-not-proved" : "not-proved",
    routeEnforcement: input?.evidenceMode === "enforced" ? "asserted-not-verified" : "not-proved",
    outcomeCorrectness: "not-proved",
    trafficCompleteness: "not-proved",
    productionSafety: "not-proved",
  });
}

function missingReport(input) {
  const generic = input === undefined;
  const report = {
    v: VERSION,
    status: "not-tested",
    classification: "not-tested",
    harness: generic ? null : Object.freeze({ ...input.harness }),
    adapter: generic ? null : Object.freeze({ ...input.adapter }),
    captureMode: null,
    evidenceMode: null,
    artifact: null,
    freshness: Object.freeze({
      status: "absent",
      capturedAt: null,
      freshUntil: null,
      evaluatedAt: generic ? "1970-01-01T00:00:00.000Z" : input.evaluatedAt,
    }),
    bindingDigest: null,
    reasonCodes: Object.freeze(["candidate-missing", "not-tested"]),
    nonClaims: nonClaimsFor(undefined),
    reportDigest: null,
  };
  return Object.freeze(generic ? report : { ...report, reportDigest: captureReportDigest(report) });
}

function presentReport(input) {
  validatePresentCapture(input);
  const live = input.captureMode === "live-candidate";
  const classification = live ? `live-candidate-${input.evidenceMode}` : `${input.captureMode}-only`;
  const reasons = ["capture-boundary-only"];
  if (!live) reasons.push(`${input.captureMode}-capture-non-passing`, "live-harness-execution-not-proved");
  if (input.evidenceMode === "enforced") reasons.push("enforcement-asserted-not-verified");
  else reasons.push("route-enforcement-not-proved");
  reasons.sort();
  const report = {
    v: VERSION,
    status: live ? "passed" : "failed",
    classification,
    harness: Object.freeze({ ...input.harness }),
    adapter: Object.freeze({ ...input.adapter }),
    captureMode: input.captureMode,
    evidenceMode: input.evidenceMode,
    artifact: Object.freeze({ kind: input.artifact.kind, rawDigest: input.artifact.rawDigest }),
    freshness: Object.freeze({ status: "fresh", capturedAt: input.capturedAt, freshUntil: input.freshUntil, evaluatedAt: input.evaluatedAt }),
    bindingDigest: input.bindingDigest,
    reasonCodes: Object.freeze(reasons),
    nonClaims: nonClaimsFor(input),
    reportDigest: null,
  };
  return Object.freeze({ ...report, reportDigest: captureReportDigest(report) });
}

export function captureCandidate(input) {
  if (!validateCapture(input)) throw new TypeError(`candidate capture input is invalid (closed schema or harness/adapter identity): ${ajv.errorsText(validateCapture.errors)}`);
  const report = input.missingCandidate === true ? missingReport(input) : presentReport(input);
  if (!validateReport(report)) throw new TypeError(`candidate capture report is invalid: ${ajv.errorsText(validateReport.errors)}`);
  return report;
}

export function validateCandidateCaptureReport(value, originalInput) {
  if (!validateReport(value)) return false;
  if (originalInput === undefined) return JSON.stringify(canonical(value)) === JSON.stringify(canonical(missingReport()));
  try {
    return JSON.stringify(canonical(value)) === JSON.stringify(canonical(captureCandidate(originalInput)));
  } catch {
    return false;
  }
}

function main() {
  if (process.argv.length !== 3) {
    process.stdout.write(`${JSON.stringify(missingReport())}\n`);
    process.exitCode = 2;
    return;
  }
  try {
    const report = captureCandidate(JSON.parse(readFileSync(process.argv[2], "utf8")));
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = report.status === "passed" ? 0 : 1;
  } catch {
    process.stdout.write(`${JSON.stringify(missingReport())}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
