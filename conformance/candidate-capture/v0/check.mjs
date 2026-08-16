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
const TOKEN_PATTERNS = Object.freeze([
  /\bBearer\s+\S+/i,
  /\bsk-[A-Za-z0-9_-]+\b/i,
  /\bgh[pousr]_[A-Za-z0-9_-]+\b/i,
  /\bxox(?:[baprs]-|-)[A-Za-z0-9_-]+\b/i,
  /\bnpm_[A-Za-z0-9_-]+\b/i,
  /\beyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+){0,2}\b/,
  /\b[a-z][a-z0-9+.-]*:\/\/\S+/i,
  /\b(?:urn|file|ssh):\S+/i,
  /\bBasic\s+[A-Za-z0-9+/]+={0,2}\b/i,
  /\b(?:password|passwd|api[_ -]?key|access[_ -]?key|auth(?:orization)?|token|secret|credentials?)\s*[:=]\s*\S+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
]);
const SENSITIVE_KEY_WORDS = new Set([
  "url", "uri", "endpoint", "header", "headers", "cookie", "cookies", "auth",
  "authorization", "authentication", "token", "secret", "password", "passwd",
  "credential", "credentials", "transport", "protocol", "host", "hostname", "port",
  "socket", "connection",
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

class InvalidCandidateError extends TypeError {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function trustedNow(options) {
  const value = options?.clock ? options.clock() : new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("trusted candidate-capture clock returned an invalid Date");
  }
  return Object.freeze({ timestamp: value.getTime(), iso: value.toISOString() });
}

function sensitiveKey(key) {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.some((word) => SENSITIVE_KEY_WORDS.has(word))) return true;
  for (let index = 0; index < words.length - 1; index += 1) {
    if ((words[index] === "api" || words[index] === "access") && words[index + 1] === "key") return true;
  }
  const normalized = words.join("");
  return /^(?:proxy)?authorization$/.test(normalized)
    || /^(?:api|access|private)key(?:id|value)?$/.test(normalized)
    || /^(?:auth|session|access|refresh|id)token$/.test(normalized)
    || /^(?:client)?secret$/.test(normalized);
}

function containsSensitiveData(value, path = []) {
  if (typeof value === "string") return TOKEN_PATTERNS.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some((child, index) => containsSensitiveData(child, [...path, index]));
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    const semanticAgentHost = path.length === 1 && path[0] === "descriptor" && key === "agentHost";
    return (!semanticAgentHost && sensitiveKey(key)) || containsSensitiveData(child, [...path, key]);
  });
}

function assertRawIdentity(raw, input) {
  const candidate = input.artifact.kind === "candidate";
  const identity = candidate
    ? { harnessId: raw?.descriptor?.agentHost, adapterId: raw?.descriptor?.adapterId }
    : { harnessId: raw?.harnessId, adapterId: raw?.adapterId };
  const harnessMismatch = candidate ? identity.harnessId !== input.harness.id : identity.harnessId !== undefined && identity.harnessId !== input.harness.id;
  if (harnessMismatch || identity.adapterId !== input.adapter.id) {
    throw new InvalidCandidateError("identity-invalid", "raw artifact identity does not match the bound harness and adapter");
  }
}

function validatePresentCapture(input, now) {
  if (ADAPTERS[input.harness.id] !== input.adapter.id) {
    throw new InvalidCandidateError("identity-invalid", "harness and adapter identity do not match");
  }
  const captured = parseTimestamp(input.capturedAt, "capturedAt");
  const expiry = parseTimestamp(input.freshUntil, "freshUntil");
  if (captured > now.timestamp) throw new InvalidCandidateError("freshness-invalid", "capturedAt is future-dated");
  if (expiry <= captured || expiry - captured > MAX_FRESHNESS_MS) throw new InvalidCandidateError("freshness-invalid", "capture freshness window is invalid");
  if (now.timestamp >= expiry) throw new InvalidCandidateError("freshness-invalid", "capture freshness is stale");
  if (sha256(input.artifact.rawJson) !== input.artifact.rawDigest) throw new InvalidCandidateError("artifact-digest-invalid", "raw artifact digest commitment is invalid");
  if (captureBindingDigest(input) !== input.bindingDigest) throw new InvalidCandidateError("identity-invalid", "capture identity binding digest is invalid");
  let raw;
  try {
    raw = JSON.parse(input.artifact.rawJson);
  } catch {
    throw new InvalidCandidateError("artifact-json-invalid", "raw artifact JSON is invalid");
  }
  if (raw === null || Array.isArray(raw) || typeof raw !== "object") throw new InvalidCandidateError("artifact-json-invalid", "raw artifact must be a JSON object");
  if (containsSensitiveData(raw)) throw new InvalidCandidateError("sensitive-artifact", "raw artifact contains transport, credential-like, or token-shaped sensitive data; remove before capture");
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

function missingReport(input, now = Object.freeze({ iso: "1970-01-01T00:00:00.000Z" })) {
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
      evaluatedAt: now.iso,
    }),
    bindingDigest: null,
    reasonCodes: Object.freeze(["candidate-missing", "not-tested"]),
    nonClaims: nonClaimsFor(undefined),
    reportDigest: null,
  };
  return Object.freeze(generic ? report : { ...report, reportDigest: captureReportDigest(report) });
}

function presentReport(input, now) {
  validatePresentCapture(input, now);
  const live = input.captureMode === "live-candidate";
  const classification = live ? `live-candidate-${input.evidenceMode}` : `${input.captureMode}-only`;
  const reasons = ["capture-boundary-only"];
  if (!live) reasons.push(`${input.captureMode}-capture-non-passing`, "live-harness-execution-not-proved");
  if (input.evidenceMode === "enforced") reasons.push("enforcement-asserted-not-verified");
  else reasons.push("route-enforcement-not-proved");
  reasons.push("capture-boundary-non-passing");
  reasons.sort();
  const report = {
    v: VERSION,
    status: "failed",
    classification,
    harness: Object.freeze({ ...input.harness }),
    adapter: Object.freeze({ ...input.adapter }),
    captureMode: input.captureMode,
    evidenceMode: input.evidenceMode,
    artifact: Object.freeze({ kind: input.artifact.kind, rawDigest: input.artifact.rawDigest }),
    freshness: Object.freeze({ status: "fresh", capturedAt: input.capturedAt, freshUntil: input.freshUntil, evaluatedAt: now.iso }),
    bindingDigest: input.bindingDigest,
    reasonCodes: Object.freeze(reasons),
    nonClaims: nonClaimsFor(input),
    reportDigest: null,
  };
  return Object.freeze({ ...report, reportDigest: captureReportDigest(report) });
}

function artifactDigestOnly(input) {
  const artifact = input?.artifact;
  if (!artifact || !["candidate", "report"].includes(artifact.kind) || typeof artifact.rawJson !== "string") return null;
  return Object.freeze({ kind: artifact.kind, rawDigest: sha256(artifact.rawJson) });
}

function invalidReport(input, now, code) {
  const reasons = Object.freeze(["invalid-candidate", code].sort());
  const report = {
    v: VERSION,
    status: "failed",
    classification: "invalid-candidate",
    harness: null,
    adapter: null,
    captureMode: null,
    evidenceMode: null,
    artifact: artifactDigestOnly(input),
    freshness: Object.freeze({ status: "invalid", capturedAt: null, freshUntil: null, evaluatedAt: now.iso }),
    bindingDigest: null,
    reasonCodes: reasons,
    nonClaims: nonClaimsFor(undefined),
    reportDigest: null,
  };
  return Object.freeze({ ...report, reportDigest: captureReportDigest(report) });
}

function captureCandidateAt(input, now) {
  if (input?.harness?.id && input?.adapter?.id && ADAPTERS[input.harness.id] !== input.adapter.id) {
    return invalidReport(input, now, "identity-invalid");
  }
  if (!validateCapture(input)) return invalidReport(input, now, "schema-invalid");
  let report;
  try {
    report = input.missingCandidate === true ? missingReport(input, now) : presentReport(input, now);
  } catch (error) {
    if (error instanceof InvalidCandidateError) report = invalidReport(input, now, error.code);
    else if (error instanceof TypeError) report = invalidReport(input, now, "freshness-invalid");
    else throw error;
  }
  if (!validateReport(report)) throw new TypeError(`candidate capture report is invalid: ${ajv.errorsText(validateReport.errors)}`);
  return report;
}

export function captureCandidate(input) {
  return captureCandidateAt(input, trustedNow());
}

export function captureCandidateForTest(input, clock) {
  return captureCandidateAt(input, trustedNow({ clock }));
}

function validateCandidateCaptureReportAt(value, originalInput, now) {
  if (!validateReport(value)) return false;
  if (originalInput === undefined) return JSON.stringify(canonical(value)) === JSON.stringify(canonical(missingReport()));
  try {
    return JSON.stringify(canonical(value)) === JSON.stringify(canonical(captureCandidateAt(originalInput, now)));
  } catch {
    return false;
  }
}

export function validateCandidateCaptureReport(value, originalInput) {
  return validateCandidateCaptureReportAt(value, originalInput, trustedNow());
}

export function validateCandidateCaptureReportForTest(value, originalInput, clock) {
  return validateCandidateCaptureReportAt(value, originalInput, trustedNow({ clock }));
}

function main() {
  if (process.argv.length === 2) {
    process.stdout.write(`${JSON.stringify(missingReport())}\n`);
    process.exitCode = 2;
    return;
  }
  if (process.argv.length !== 3) {
    process.stdout.write(`${JSON.stringify(invalidReport(undefined, trustedNow(), "schema-invalid"))}\n`);
    process.exitCode = 1;
    return;
  }
  try {
    const report = captureCandidate(JSON.parse(readFileSync(process.argv[2], "utf8")));
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = 1;
  } catch {
    const now = trustedNow();
    process.stdout.write(`${JSON.stringify(invalidReport(undefined, now, "artifact-json-invalid"))}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
