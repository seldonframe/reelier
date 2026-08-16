import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkCandidate } from "../../agent-adapter/v0/check.mjs";
import { aggregateReports } from "../../aggregate/v0/check.mjs";

const VERSION = "reelier.semantic-matrix-report/v0";
const INPUT_VERSION = "reelier.semantic-matrix-input/v0";
const HARNESS_IDS = Object.freeze(["codex", "claude-code", "eve", "grok-build", "grok-bot"]);
const ADAPTER_IDS = Object.freeze({ "grok-build": "xai.grok-build", "grok-bot": "xai.grok-bot" });
const UNIVERSAL_CHECKS = Object.freeze(["universal-operations", "dynamic-job-discovery", "host-bound-outcome-input", "attenuated-child-principal", "pre-freeze-no-dispatch", "observed-coverage-honesty", "enforced-mode-unavailable"]);
const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(JSON.parse(readFileSync(here("../../aggregate/v0/report.schema.json"), "utf8")), "https://reelier.dev/contracts/aggregate-conformance/v0/report.schema.json");
const validateInput = ajv.compile({
  type: "object", additionalProperties: false, required: ["v", "candidates"],
  properties: {
    v: { const: INPUT_VERSION },
    candidates: { type: "array", maxItems: 5, items: {
      type: "object", additionalProperties: false, required: ["harnessId", "adapterPath"],
      properties: {
        harnessId: { enum: HARNESS_IDS },
        adapterPath: { enum: ["agent-adapter/v0", "continuity-adapter/v1", "continuity-adapter/v1/eve-fixture"] },
        candidate: { type: "object" },
        report: { type: "object" },
        missing: { const: true },
      },
      oneOf: [
        { properties: { candidate: { type: "object" }, report: { type: "object" }, missing: { const: true } }, required: ["candidate"], not: { anyOf: [{ properties: { report: { type: "object" } }, required: ["report"] }, { properties: { missing: { const: true } }, required: ["missing"] }] } },
        { properties: { candidate: { type: "object" }, report: { type: "object" }, missing: { const: true } }, required: ["report"], not: { anyOf: [{ properties: { candidate: { type: "object" } }, required: ["candidate"] }, { properties: { missing: { const: true } }, required: ["missing"] }] } },
        { properties: { candidate: { type: "object" }, report: { type: "object" }, missing: { const: true } }, required: ["missing"], not: { anyOf: [{ required: ["candidate"] }, { required: ["report"] }] } },
      ],
    } },
  },
});
const validateOutput = ajv.compile(JSON.parse(readFileSync(here("./report.schema.json"), "utf8")));
export function validateSemanticMatrixReport(value) { return validateOutput(value); }

function canonicalId(harnessId) { return ADAPTER_IDS[harnessId] ?? harnessId; }
function missingReport(harnessId, adapterPath) {
  return { harnessId: canonicalId(harnessId), adapterPath, report: null };
}

function validAgentReport(report, harnessId) {
  return report?.v === "reelier.agent-adapter-conformance-report/v0"
    && report.adapterId === canonicalId(harnessId)
    && ["passed", "failed"].includes(report.status)
    && Array.isArray(report.checks)
    && report.checks.length === UNIVERSAL_CHECKS.length
    && report.checks.every((check, index) => check?.id === UNIVERSAL_CHECKS[index] && ["passed", "failed"].includes(check.status) && typeof check.detail === "string" && check.detail.length > 0)
    && (report.status === "passed" ? report.checks.every((check) => check.status === "passed") : report.checks.some((check) => check.status === "failed"));
}

export function runSemanticMatrix(input) {
  if (!validateInput(input)) throw new TypeError(`semantic matrix input is invalid: ${ajv.errorsText(validateInput.errors)}`);
  const supplied = new Map(input.candidates.map((entry) => [entry.harnessId, entry]));
  if (new Set(input.candidates.map((entry) => entry.harnessId)).size !== input.candidates.length) throw new TypeError("semantic matrix harnesses must be unique");
  const records = [];
  const pendingChecks = [];
  const semanticChecks = [];
  const adapterPaths = { codex: "agent-adapter/v0", "claude-code": "agent-adapter/v0", eve: "continuity-adapter/v1/eve-fixture", "grok-build": "agent-adapter/v0", "grok-bot": "agent-adapter/v0" };
  for (const harnessId of HARNESS_IDS) {
    const entry = supplied.get(harnessId);
    let report;
    const adapterPath = entry?.adapterPath ?? adapterPaths[harnessId];
    if (entry?.candidate) report = checkCandidate(entry.candidate);
    else if (entry?.report) report = entry.report;
    if (report) {
      const sourceValid = entry?.candidate || validAgentReport(report, harnessId) || report.v !== "reelier.agent-adapter-conformance-report/v0";
      if (sourceValid && (entry?.candidate || validAgentReport(report, harnessId))) pendingChecks.push({ harnessId, report });
      records.push({ harnessId: canonicalId(harnessId), adapterPath, report: sourceValid ? report : { v: "reelier.invalid-source-report/v0" } });
    } else records.push(missingReport(harnessId, adapterPath));
  }
  const aggregate = aggregateReports(records);
  const aggregateById = new Map(aggregate.harnesses.map((row) => [row.harnessId, row]));
  const harnesses = HARNESS_IDS.map((harnessId) => ({ ...aggregateById.get(canonicalId(harnessId)), harnessId }));
  for (const source of pendingChecks) {
    const aggregateRow = aggregateById.get(canonicalId(source.harnessId));
    if (aggregateRow?.overallStatus !== "unsupported") for (const check of source.report.checks ?? []) semanticChecks.push({ harnessId: source.harnessId, id: check.id, status: check.status, detail: check.detail });
  }
  const result = { v: VERSION, status: aggregate.status, aggregate, harnesses, semanticChecks };
  if (!validateSemanticMatrixReport(result)) throw new TypeError(`semantic matrix report is invalid: ${ajv.errorsText(validateOutput.errors)}`);
  return Object.freeze(result);
}

export const checkMatrix = runSemanticMatrix;

function main() {
  const failure = () => runSemanticMatrix({ v: INPUT_VERSION, candidates: [] });
  if (process.argv.length !== 3) { process.stdout.write(`${JSON.stringify(failure())}\n`); process.exitCode = 2; return; }
  try {
    const result = runSemanticMatrix(JSON.parse(readFileSync(process.argv[2], "utf8")));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === "passed" ? 0 : 1;
  } catch {
    process.stdout.write(`${JSON.stringify(failure())}\n`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
