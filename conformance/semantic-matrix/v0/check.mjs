import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkCandidate } from "../../agent-adapter/v0/check.mjs";
import { aggregateReports } from "../../aggregate/v0/check.mjs";

const VERSION = "reelier.semantic-matrix-report/v0";
const INPUT_VERSION = "reelier.semantic-matrix-input/v0";
const HARNESS_IDS = Object.freeze(["codex", "claude-code", "eve", "grok-build", "grok-bot"]);
const ADAPTER_IDS = Object.freeze({ "grok-build": "xai.grok-build", "grok-bot": "xai.grok-bot" });
const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(JSON.parse(readFileSync(here("../../aggregate/v0/report.schema.json"), "utf8")), "https://reelier.dev/contracts/aggregate/v0/report.schema.json");
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
      },
      oneOf: [
        { properties: { candidate: { type: "object" } }, required: ["candidate"] },
        { properties: { report: { type: "object" } }, required: ["report"] },
        { properties: { candidate: { type: "object" }, report: { type: "object" } }, not: { anyOf: [{ required: ["candidate"] }, { required: ["report"] }] } },
      ],
    } },
  },
});
const validateOutput = ajv.compile(JSON.parse(readFileSync(here("./report.schema.json"), "utf8")));

function canonicalId(harnessId) { return ADAPTER_IDS[harnessId] ?? harnessId; }
function missingReport(harnessId, adapterPath) {
  return { harnessId: canonicalId(harnessId), adapterPath, report: null };
}

export function runSemanticMatrix(input) {
  if (!validateInput(input)) throw new TypeError(`semantic matrix input is invalid: ${ajv.errorsText(validateInput.errors)}`);
  const supplied = new Map(input.candidates.map((entry) => [entry.harnessId, entry]));
  if (new Set(input.candidates.map((entry) => entry.harnessId)).size !== input.candidates.length) throw new TypeError("semantic matrix harnesses must be unique");
  const records = [];
  const semanticChecks = [];
  const adapterPaths = { codex: "agent-adapter/v0", "claude-code": "agent-adapter/v0", eve: "continuity-adapter/v1/eve-fixture", "grok-build": "agent-adapter/v0", "grok-bot": "agent-adapter/v0" };
  for (const harnessId of HARNESS_IDS) {
    const entry = supplied.get(harnessId);
    let report;
    const adapterPath = entry?.adapterPath ?? adapterPaths[harnessId];
    if (entry?.candidate) report = checkCandidate(entry.candidate);
    else if (entry?.report) report = entry.report;
    if (report) {
      for (const check of report.checks ?? []) semanticChecks.push({ harnessId, id: check.id, status: check.status, detail: check.detail });
      records.push({ harnessId: canonicalId(harnessId), adapterPath, report });
    } else records.push(missingReport(harnessId, adapterPath));
  }
  const aggregate = aggregateReports(records);
  const aggregateById = new Map(aggregate.harnesses.map((row) => [row.harnessId, row]));
  const harnesses = HARNESS_IDS.map((harnessId) => ({ ...aggregateById.get(canonicalId(harnessId)), harnessId }));
  const result = { v: VERSION, status: aggregate.status, aggregate, harnesses, semanticChecks };
  if (!validateOutput(result)) throw new TypeError(`semantic matrix report is invalid: ${ajv.errorsText(validateOutput.errors)}`);
  return Object.freeze(result);
}

export const checkMatrix = runSemanticMatrix;

function main() {
  if (process.argv.length !== 3) { process.stdout.write(`${JSON.stringify({ v: VERSION, status: "failed", aggregate: null, harnesses: [], semanticChecks: [] })}\n`); process.exitCode = 2; return; }
  try {
    const result = runSemanticMatrix(JSON.parse(readFileSync(process.argv[2], "utf8")));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === "passed" ? 0 : 1;
  } catch {
    process.stdout.write(`${JSON.stringify({ v: VERSION, status: "failed", aggregate: null, harnesses: [], semanticChecks: [] })}\n`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
