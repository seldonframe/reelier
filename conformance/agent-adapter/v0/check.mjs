import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPORT_VERSION = "reelier.agent-adapter-conformance-report/v0";
const schemaPath = fileURLToPath(new URL("./candidate.schema.json", import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validate = ajv.compile(schema);

function passed(id, detail) {
  return Object.freeze({ id, status: "passed", detail });
}

function failed(id, detail) {
  return Object.freeze({ id, status: "failed", detail });
}

function report(adapterId, checks) {
  return Object.freeze({
    v: REPORT_VERSION,
    status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    adapterId,
    checks: Object.freeze(checks),
  });
}

function semanticChecks() {
  return [passed("closed-schema", "candidate is closed and structurally valid")];
}

export function checkCandidate(value) {
  if (!validate(value)) {
    return report(null, [failed("closed-schema", ajv.errorsText(validate.errors, { separator: "; " }))]);
  }
  return report(value.descriptor.adapterId, semanticChecks(structuredClone(value)));
}

function usageReport() {
  return report(null, [failed("usage", "usage: check.mjs <candidate.json>")]);
}

function unreadableCandidateReport() {
  return report(null, [failed("closed-schema", "candidate could not be read or parsed")]);
}

function writeReport(value, exitCode) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exitCode = exitCode;
}

function main() {
  if (process.argv.length !== 3) {
    writeReport(usageReport(), 2);
    return;
  }
  let value;
  try {
    value = JSON.parse(readFileSync(process.argv[2], "utf8"));
  } catch {
    writeReport(unreadableCandidateReport(), 1);
    return;
  }
  const result = checkCandidate(value);
  writeReport(result, result.status === "passed" ? 0 : 1);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
