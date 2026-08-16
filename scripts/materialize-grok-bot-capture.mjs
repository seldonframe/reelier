import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { captureBindingDigest, captureCandidateForTest, validateCandidateCaptureReportForTest } from "../conformance/candidate-capture/v0/check.mjs";

const [sourcePath, outputDir] = process.argv.slice(2);
if (!sourcePath || !outputDir) throw new Error("usage: materialize-grok-bot-capture.mjs <source-json> <output-dir>");
const sha256 = (value) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const raw = (await readFile(resolve(sourcePath), "utf8")).trim();
const source = JSON.parse(raw);
if (source.harnessId !== "grok-bot" || source.adapterId !== "xai.grok-bot" || source.status !== "unsupported") throw new Error("unexpected Grok Bot source identity/status");
const capturedAt = new Date().toISOString();
const freshUntil = new Date(Date.parse(capturedAt) + 24 * 60 * 60_000 - 1).toISOString();
const instanceIdentityDigest = sha256("reelier-grok-bot-instance:v1:desktop:2026-08-16");
const input = {
  v: "reelier.candidate-capture/v0",
  harness: { id: "grok-bot", instanceIdentityDigest },
  adapter: { id: "xai.grok-bot", instanceIdentityDigest },
  captureMode: "observed",
  capturedAt,
  freshUntil,
  evidenceMode: "observed",
  artifact: { kind: "report", rawJson: raw, rawDigest: sha256(raw) },
};
input.bindingDigest = captureBindingDigest(input);
const evaluationTime = new Date(capturedAt);
const report = captureCandidateForTest(input, () => evaluationTime);
if (!validateCandidateCaptureReportForTest(report, input, () => evaluationTime)) throw new Error("Grok Bot capture failed self-validation");
const destination = resolve(outputDir);
await mkdir(destination, { recursive: true });
await writeFile(resolve(destination, "grok-bot-observed-response.json"), `${JSON.stringify(source, null, 2)}\n`);
await writeFile(resolve(destination, "grok-bot-capture.json"), `${JSON.stringify(input, null, 2)}\n`);
await writeFile(resolve(destination, "grok-bot-capture-report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: report.status, classification: report.classification, reasonCodes: report.reasonCodes, reportDigest: report.reportDigest })}\n`);
