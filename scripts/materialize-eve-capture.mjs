import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { captureBindingDigest, captureCandidateForTest, validateCandidateCaptureReportForTest } from "../conformance/candidate-capture/v0/check.mjs";

const [sourceLog, outputDir] = process.argv.slice(2);
if (!sourceLog || !outputDir) throw new Error("usage: materialize-eve-capture.mjs <source-log> <output-dir>");

const sha256 = (value) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const source = await readFile(resolve(sourceLog), "utf8");
const reportLine = source.split(/\r?\n/).find((line) => line.startsWith("{\"artifacts\""));
if (!reportLine) throw new Error("closed Eve report JSON line was not found");
const sourceReport = JSON.parse(reportLine);
if (sourceReport.status !== "passed" || sourceReport.reelierCommit !== "994785489dd6fd2b85b95e96b1ace16533094f2b") {
  throw new Error("source report is not the passed 9947854 Eve report");
}

const capturedAt = new Date().toISOString();
const freshUntil = new Date(Date.parse(capturedAt) + 24 * 60 * 60_000 - 1).toISOString();
const instanceIdentityDigest = sha256("reelier-eve-instance:v1:linux:9947854");
const sanitizedReport = {
  v: sourceReport.v,
  status: sourceReport.status,
  maturity: sourceReport.maturity,
  reelierCommit: sourceReport.reelierCommit,
  eveVersion: sourceReport.eveVersion,
  nodeVersion: sourceReport.nodeVersion,
  checks: sourceReport.checks,
  nonClaims: sourceReport.nonClaims,
  sourceReportRef: "eve-continuity-detached-report.json",
};
const raw = JSON.stringify({
  v: "reelier.eve-continuity-detached-capture/v1",
  harnessId: "eve",
  adapterId: "eve",
  report: sanitizedReport,
});
const input = {
  v: "reelier.candidate-capture/v0",
  harness: { id: "eve", instanceIdentityDigest },
  adapter: { id: "eve", instanceIdentityDigest },
  captureMode: "observed",
  capturedAt,
  freshUntil,
  evidenceMode: "observed",
  artifact: { kind: "report", rawJson: raw, rawDigest: sha256(raw) },
};
input.bindingDigest = captureBindingDigest(input);
const evaluationTime = new Date(capturedAt);
const captureReport = captureCandidateForTest(input, () => evaluationTime);
if (!validateCandidateCaptureReportForTest(captureReport, input, () => evaluationTime)) throw new Error("candidate capture report failed self-validation");

const destination = resolve(outputDir);
await mkdir(destination, { recursive: true });
await writeFile(resolve(destination, "eve-continuity-detached-report.json"), `${JSON.stringify(sourceReport, null, 2)}\n`);
await writeFile(resolve(destination, "eve-continuity-detached-capture.json"), `${JSON.stringify(input, null, 2)}\n`);
await writeFile(resolve(destination, "eve-continuity-detached-capture-report.json"), `${JSON.stringify(captureReport, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: captureReport.status, classification: captureReport.classification, reasonCodes: captureReport.reasonCodes, reportDigest: captureReport.reportDigest })}\n`);
