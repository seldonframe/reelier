import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runLiveMcpProbe } from "../conformance/agent-adapter/v0/live-probe.mjs";
import { captureBindingDigest, captureCandidate } from "../conformance/candidate-capture/v0/check.mjs";

const ADAPTER_IDS = Object.freeze({ codex: "codex", "claude-code": "claude-code", eve: "eve", "grok-build": "xai.grok-build", "grok-bot": "xai.grok-bot" });

function sha256(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function parseArgs(argv) {
  if (argv.length !== 4 || argv[0] !== "--harness" || argv[2] !== "--out" || !ADAPTER_IDS[argv[1]] || !argv[3]) throw new TypeError("usage: run-agent-adapter-mcp-probe.mjs --harness <codex|claude-code|eve|grok-build|grok-bot> --out <directory>");
  return { harnessId: argv[1], output: path.resolve(argv[3]) };
}

const { harnessId, output } = parseArgs(process.argv.slice(2));
const result = await runLiveMcpProbe({ harnessId, adapterId: ADAPTER_IDS[harnessId] });
const candidateJson = `${JSON.stringify(result.candidate, null, 2)}\n`;
const reportJson = `${JSON.stringify(result.report, null, 2)}\n`;
const captureArtifactJson = `${JSON.stringify({ adapterId: result.report.adapterId, status: result.report.status, checkCount: result.report.checks.length, checksDigest: sha256(JSON.stringify(result.report.checks)).slice(7) }, null, 2)}\n`;
const capturedAt = new Date();
const capture = {
  v: "reelier.candidate-capture/v0",
  harness: { id: harnessId, instanceIdentityDigest: sha256(`reelier-harness-instance:${harnessId}`) },
  adapter: { id: ADAPTER_IDS[harnessId], instanceIdentityDigest: sha256(`reelier-adapter-instance:${ADAPTER_IDS[harnessId]}`) },
  captureMode: "live-candidate",
  capturedAt: capturedAt.toISOString(),
  freshUntil: new Date(capturedAt.getTime() + 60 * 60_000).toISOString(),
  evidenceMode: "observed",
  artifact: { kind: "report", rawJson: captureArtifactJson, rawDigest: sha256(captureArtifactJson) },
};
capture.bindingDigest = captureBindingDigest(capture);
const captureReport = captureCandidate(capture);
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "candidate.json"), candidateJson);
await writeFile(path.join(output, "report.json"), reportJson);
await writeFile(path.join(output, "capture.json"), `${JSON.stringify(capture, null, 2)}\n`);
await writeFile(path.join(output, "capture-report.json"), `${JSON.stringify(captureReport, null, 2)}\n`);
await writeFile(path.join(output, "tool-inventory.json"), `${JSON.stringify({ harnessId, adapterId: ADAPTER_IDS[harnessId], tools: result.toolInventory, called: result.toolCalls }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ harnessId, adapterId: ADAPTER_IDS[harnessId], semanticStatus: result.report.status, captureStatus: captureReport.status, captureClassification: captureReport.classification, output })}\n`);
process.exitCode = captureReport.status === "not-tested" ? 2 : 1;
