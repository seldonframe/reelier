import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runSemanticMatrix } from "../conformance/semantic-matrix/v0/check.mjs";

const HARNESS_IDS = ["codex", "claude-code", "eve", "grok-build", "grok-bot"];
const args = process.argv.slice(2);
const manifestMode = args[0] === "--manifest";
const [manifestPath, inputPath, reportPath] = manifestMode ? args.slice(1) : [args[0], args[1], args[2]];
if (!inputPath || !reportPath || (manifestMode ? !manifestPath : !args[0])) {
  throw new Error("usage: run-five-harness-matrix.mjs <eve-report> <input> <report> | --manifest <manifest> <input> <report>");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(resolve(filePath), "utf8"));
}

function assertPlainRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be an object`);
}

function assertManifestShape(manifest) {
  assertPlainRecord(manifest, "evidence manifest");
  if (Object.keys(manifest).some(key => !["harnesses", "eveContinuityReport"].includes(key))) throw new TypeError("evidence manifest contains an unknown field");
  assertPlainRecord(manifest.harnesses, "evidence manifest harnesses");
  if (Object.keys(manifest.harnesses).some(id => !HARNESS_IDS.includes(id))) throw new TypeError("evidence manifest contains an unknown harness");
  for (const [harnessId, entry] of Object.entries(manifest.harnesses)) {
    assertPlainRecord(entry, `${harnessId} evidence entry`);
    if (Object.keys(entry).some(key => !["candidate", "report"].includes(key))) throw new TypeError(`${harnessId} evidence entry contains an unknown field`);
    if (entry.candidate !== undefined && entry.report !== undefined) throw new TypeError(`${harnessId} evidence entry cannot contain both candidate and report`);
    if (entry.candidate !== undefined && typeof entry.candidate !== "string") throw new TypeError(`${harnessId} candidate path must be a string`);
    if (entry.report !== undefined && typeof entry.report !== "string") throw new TypeError(`${harnessId} report path must be a string`);
  }
  if (manifest.eveContinuityReport !== undefined && typeof manifest.eveContinuityReport !== "string") throw new TypeError("Eve continuity report path must be a string");
}

async function inputFromManifest(manifest) {
  assertManifestShape(manifest);
  const candidates = [];
  for (const harnessId of HARNESS_IDS) {
    const entry = manifest.harnesses[harnessId];
    const adapterPath = harnessId === "eve" && entry?.candidate ? "agent-adapter/v0" : harnessId === "eve" ? "continuity-adapter/v1/eve-fixture" : "agent-adapter/v0";
    const record = { harnessId, adapterPath };
    if (entry?.candidate) record.candidate = await readJson(entry.candidate);
    else if (entry?.report) record.report = await readJson(entry.report);
    else if (!entry) record.missing = true;
    else record.missing = true;
    if (harnessId === "eve" && manifest.eveContinuityReport) record.continuityEvidence = { adapterPath: "continuity-adapter/v1/eve-fixture", report: await readJson(manifest.eveContinuityReport) };
    candidates.push(record);
  }
  return { v: "reelier.semantic-matrix-input/v0", candidates };
}

const input = manifestMode
  ? await inputFromManifest(await readJson(manifestPath))
  : {
    v: "reelier.semantic-matrix-input/v0",
    candidates: [
      { harnessId: "codex", adapterPath: "agent-adapter/v0", missing: true },
      { harnessId: "claude-code", adapterPath: "agent-adapter/v0", missing: true },
      { harnessId: "eve", adapterPath: "continuity-adapter/v1/eve-fixture", report: await readJson(manifestPath) },
      { harnessId: "grok-build", adapterPath: "agent-adapter/v0", missing: true },
      { harnessId: "grok-bot", adapterPath: "agent-adapter/v0", missing: true },
    ],
  };
const report = runSemanticMatrix(input);
await writeFile(resolve(inputPath), `${JSON.stringify(input, null, 2)}\n`);
await writeFile(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: report.status, harnesses: report.harnesses.map(({ harnessId, overallStatus, executionStatus, coverageStatus }) => ({ harnessId, overallStatus, executionStatus, coverageStatus })) })}\n`);
process.exitCode = report.status === "passed" ? 0 : 1;
