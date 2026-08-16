import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runSemanticMatrix } from "../conformance/semantic-matrix/v0/check.mjs";

const [eveReportPath, inputPath, reportPath] = process.argv.slice(2);
if (!eveReportPath || !inputPath || !reportPath) throw new Error("usage: run-five-harness-matrix.mjs <eve-report> <input> <report>");

const eveReport = JSON.parse(await readFile(resolve(eveReportPath), "utf8"));
const input = {
  v: "reelier.semantic-matrix-input/v0",
  candidates: [
    { harnessId: "codex", adapterPath: "agent-adapter/v0", missing: true },
    { harnessId: "claude-code", adapterPath: "agent-adapter/v0", missing: true },
    { harnessId: "eve", adapterPath: "continuity-adapter/v1/eve-fixture", report: eveReport },
    { harnessId: "grok-build", adapterPath: "agent-adapter/v0", missing: true },
    { harnessId: "grok-bot", adapterPath: "agent-adapter/v0", missing: true },
  ],
};
const report = runSemanticMatrix(input);
await writeFile(resolve(inputPath), `${JSON.stringify(input, null, 2)}\n`);
await writeFile(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: report.status, harnesses: report.harnesses.map(({ harnessId, overallStatus, executionStatus, coverageStatus }) => ({ harnessId, overallStatus, executionStatus, coverageStatus })) })}\n`);
