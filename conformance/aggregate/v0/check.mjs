import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION = "reelier.aggregate-conformance-report/v0";
const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateReport = ajv.compile(JSON.parse(readFileSync(here("./report.schema.json"), "utf8")));

const NON_CLAIMS = Object.freeze([
  "observed route discovery is not write enforcement",
  "continuity does not prove universal agent-adapter execution",
  "fixture evidence is not live harness execution",
  "outcome correctness and production safety are not proved",
]);

const PASSING = new Set(["execution-proven", "enforced", "verified"]);
export function isPassingStatus(status) { return PASSING.has(status); }

function row(harnessId, adapterPath, values, reasons) {
  return Object.freeze({ harnessId, adapterPath, ...values, nonClaims: NON_CLAIMS, reasons: Object.freeze(reasons) });
}

function classify(record) {
  const report = record?.report;
  if (!report || typeof report.v !== "string") {
    return row(record?.harnessId ?? "unknown", record?.adapterPath ?? "unknown", {
      evidenceMaturity: "unsupported", coverageStatus: "coverage-unknown", executionStatus: "not-tested", outcomeStatus: "not-tested", overallStatus: "unsupported",
    }, ["no supported conformance report was supplied"]);
  }
  if (report.v === "reelier.agent-adapter-conformance-report/v0") {
    const failed = report.status !== "passed";
    return row(record.harnessId, record.adapterPath, {
      evidenceMaturity: failed ? "failed" : "fixture-only", coverageStatus: failed ? "failed" : "observed-only", executionStatus: failed ? "failed" : "not-tested", outcomeStatus: failed ? "failed" : "not-tested", overallStatus: failed ? "failed" : "fixture-only",
    }, [failed ? "the v0 semantic checks failed" : "the v0 descriptor is explicitly fixture-only", "the v0 report has no live governed execution evidence"]);
  }
  if (report.v === "reelier.continuity-adapter-conformance-report/v1" || report.v === "reelier.continuity-eve-conformance-report/v1") {
    const failed = report.status !== "passed";
    return row(record.harnessId, record.adapterPath, {
      evidenceMaturity: failed ? "failed" : "continuity-proven", coverageStatus: "coverage-unknown", executionStatus: failed ? "failed" : "not-tested", outcomeStatus: failed ? "failed" : "not-tested", overallStatus: failed ? "failed" : "continuity-proven",
    }, [failed ? "the continuity checks failed" : "continuity checks passed", "continuity evidence does not establish universal agent-adapter execution"]);
  }
  return row(record.harnessId, record.adapterPath, {
    evidenceMaturity: "unsupported", coverageStatus: "coverage-unknown", executionStatus: "not-tested", outcomeStatus: "not-tested", overallStatus: "unsupported",
  }, [`unsupported report version: ${report.v}`]);
}

function aggregateStatus(harnesses) {
  return harnesses.length > 0 && harnesses.every((item) => isPassingStatus(item.evidenceMaturity) && isPassingStatus(item.coverageStatus) && isPassingStatus(item.executionStatus) && isPassingStatus(item.outcomeStatus)) ? "passed" : "failed";
}

export function aggregateReports(records) {
  if (!Array.isArray(records)) throw new TypeError("aggregate input must be an array");
  const harnesses = Object.freeze(records.map((record) => classify(record)));
  const report = Object.freeze({ v: VERSION, status: aggregateStatus(harnesses), harnesses });
  if (!validateReport(report)) throw new TypeError(`aggregate report is invalid: ${ajv.errorsText(validateReport.errors)}`);
  return report;
}

function main() {
  if (process.argv.length !== 3) { process.stdout.write(`${JSON.stringify({ v: VERSION, status: "failed", harnesses: [] })}\n`); process.exitCode = 2; return; }
  try {
    const result = aggregateReports(JSON.parse(readFileSync(process.argv[2], "utf8")));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === "passed" ? 0 : 1;
  } catch {
    process.stdout.write(`${JSON.stringify({ v: VERSION, status: "failed", harnesses: [] })}\n`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
