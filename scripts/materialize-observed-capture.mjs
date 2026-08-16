import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { captureBindingDigest, captureCandidateForTest, validateCandidateCaptureReportForTest } from "../conformance/candidate-capture/v0/check.mjs";

const [sourcePath, outputDir, harnessId, adapterId] = process.argv.slice(2);
if (!sourcePath || !outputDir || !harnessId || !adapterId) {
  throw new Error("usage: materialize-observed-capture.mjs <source-json> <output-dir> <harness-id> <adapter-id>");
}

const sha256 = (value) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const raw = (await readFile(resolve(sourcePath), "utf8")).trim();
const source = JSON.parse(raw);
if (source.harnessId !== harnessId || source.adapterId !== adapterId) {
  throw new Error("source identity does not match the requested capture identity");
}

const capturedAt = new Date().toISOString();
const freshUntil = new Date(Date.parse(capturedAt) + 24 * 60 * 60_000 - 1).toISOString();
const instanceIdentityDigest = sha256(`reelier-${harnessId}-observed-instance:v1:${source.instanceIdentity ?? "local"}`);
const adapterIdentityDigest = sha256(`reelier-${adapterId}-observed-adapter:v1:${source.adapterIdentity ?? "local"}`);
const input = {
  v: "reelier.candidate-capture/v0",
  harness: { id: harnessId, instanceIdentityDigest },
  adapter: { id: adapterId, instanceIdentityDigest: adapterIdentityDigest },
  captureMode: "observed",
  capturedAt,
  freshUntil,
  evidenceMode: "observed",
  artifact: { kind: "report", rawJson: raw, rawDigest: sha256(raw) },
};
input.bindingDigest = captureBindingDigest(input);
const evaluationTime = new Date(capturedAt);
const report = captureCandidateForTest(input, () => evaluationTime);
if (!validateCandidateCaptureReportForTest(report, input, () => evaluationTime)) {
  throw new Error("observed capture failed self-validation");
}

const destination = resolve(outputDir);
await mkdir(destination, { recursive: true });
await writeFile(resolve(destination, "observed-response.json"), `${JSON.stringify(source, null, 2)}\n`);
await writeFile(resolve(destination, "capture.json"), `${JSON.stringify(input, null, 2)}\n`);
await writeFile(resolve(destination, "capture-report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: report.status, classification: report.classification, reasonCodes: report.reasonCodes, reportDigest: report.reportDigest })}\n`);
