import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CONFORMANCE_BRANCH, CONFORMANCE_PATH, CONFORMANCE_REPOSITORY } from "./disposable-github-mcp-server.mjs";

export const CONFORMANCE_REQUEST_KEY = "github-live-proxy-20260816-1";
export const CONFORMANCE_CONTENT = [
  "Reelier Path A live-proxy conformance proof",
  `repository=${CONFORMANCE_REPOSITORY}`,
  `branch=${CONFORMANCE_BRANCH}`,
  `requestKey=${CONFORMANCE_REQUEST_KEY}`,
  "",
].join("\n");

const execFileAsync = promisify(execFile);
const SHA = /^[0-9a-f]{40}$/;
const artifactOrder = ["descriptor", "delegation", "coverage", "dispatch", "providerState", "receipt"];

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function contentDigest(content) {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function summarizedState(value) {
  return {
    repository: value.repository,
    branch: value.branch,
    path: value.path,
    head: value.head,
    tree: value.tree,
    blob: value.blob,
    contentSha256: contentDigest(value.content),
    contentUtf8: value.content,
  };
}

export function buildEvidenceArtifacts(input) {
  const descriptor = {
    v: "reelier.github-live-proxy-descriptor/v1",
    classification: "path-a-live-proxy",
    execution: "live",
    repository: CONFORMANCE_REPOSITORY,
    branch: CONFORMANCE_BRANCH,
    path: CONFORMANCE_PATH,
    requestKey: CONFORMANCE_REQUEST_KEY,
    proxy: "dist/cli.js mcp --allow-writes --wrap <disposable-github-mcp-server>",
  };
  const delegation = {
    v: "reelier.github-live-proxy-delegation/v1",
    task: "update-one-predetermined-file-and-read-back-exact-git-state",
    allowed: { repository: CONFORMANCE_REPOSITORY, branch: CONFORMANCE_BRANCH, path: CONFORMANCE_PATH, providerWriteBudget: 1 },
    prohibited: ["any-other-repository", "main", "branch-creation", "pull-request-creation", "pull-request-merge"],
  };
  const coverage = {
    v: "reelier.github-live-proxy-coverage/v1",
    mode: "observed-live-mcp-traffic",
    topology: "client -> Reelier Path A live proxy -> disposable GitHub MCP server -> process-local gh api -> GitHub",
    exposedTools: input.tools,
    expectedCalls: ["github_read_conformance_state", "github_put_conformance_file", "github_put_conformance_file", "github_read_conformance_state"],
    completeness: "not-proved",
    trafficOutsideThisProxy: "not-observed",
  };
  const dispatch = {
    v: "reelier.github-live-proxy-dispatch/v1",
    requestKey: CONFORMANCE_REQUEST_KEY,
    providerWriteCount: input.first.effectDelta + input.retry.effectDelta,
    first: { disposition: input.first.disposition, effectDelta: input.first.effectDelta, commit: input.first.dispatch?.commit },
    retry: { disposition: input.retry.disposition, effectDelta: input.retry.effectDelta, commit: input.retry.dispatch?.commit },
  };
  const providerState = {
    v: "reelier.github-live-proxy-provider-state/v1",
    before: summarizedState(input.before),
    afterFirstDispatch: summarizedState(input.first.providerState),
    afterRetry: summarizedState(input.retry.providerState),
    finalRead: summarizedState(input.final),
  };
  const traceCalls = input.trace.filter((record) => record.t === "call").map((record) => ({ i: record.i, tool: record.tool, args: record.args }));
  const receipt = {
    v: "reelier.github-live-proxy-receipt/v1",
    classification: "path-a-live-proxy-trace",
    traceDigest: digest(input.trace),
    traceRecordCount: input.trace.length,
    calls: traceCalls,
    trace: input.trace,
  };
  const artifacts = { descriptor, delegation, coverage, dispatch, providerState, receipt };
  const finalReport = {
    v: "reelier.github-live-proxy-final-report/v1",
    status: "passed",
    artifactDigests: Object.fromEntries(artifactOrder.map((name) => [name, digest(artifacts[name])])),
    claims: {
      pathALiveProxyTrafficRecorded: "proved",
      exactBranchHeadTreeBlobReadback: "proved",
      sameKeyRetryNoSecondProviderWrite: "proved",
      pathCAuthorityCell: "not-proved",
      completeWriteCoverage: "not-proved",
      semanticContentSafety: "not-proved",
      protectedMainInteraction: "not-attempted",
      pullRequestCreationOrMerge: "not-attempted",
    },
  };
  return { ...artifacts, finalReport };
}

export function checkEvidenceArtifacts(artifacts) {
  assert.equal(artifacts.descriptor.classification, "path-a-live-proxy", "descriptor must classify this as Path A");
  assert.equal(artifacts.descriptor.repository, CONFORMANCE_REPOSITORY, "repository fence mismatch");
  assert.equal(artifacts.descriptor.branch, CONFORMANCE_BRANCH, "branch fence mismatch");
  assert.notEqual(artifacts.descriptor.branch, "main", "main must never be targeted");
  assert.deepEqual(artifacts.delegation.allowed, { repository: CONFORMANCE_REPOSITORY, branch: CONFORMANCE_BRANCH, path: CONFORMANCE_PATH, providerWriteBudget: 1 });
  assert.equal(artifacts.coverage.completeness, "not-proved", "coverage must not overclaim completeness");
  assert.equal(artifacts.dispatch.requestKey, CONFORMANCE_REQUEST_KEY, "dispatch request key mismatch");
  assert.equal(artifacts.dispatch.first.disposition, "written", "first dispatch must perform the bounded update");
  assert.equal(artifacts.dispatch.first.effectDelta, 1, "first dispatch must account for exactly one provider write");
  assert.equal(artifacts.dispatch.retry.disposition, "duplicate", "retry must be process-local duplicate handling");
  assert.equal(artifacts.dispatch.retry.effectDelta, 0, "retry must have zero provider effect");
  assert.equal(artifacts.dispatch.providerWriteCount, 1, "dispatch must contain exactly one provider write");
  const after = artifacts.providerState.afterFirstDispatch;
  for (const field of ["head", "tree", "blob"]) assert.match(after[field], SHA, `${field} must be an exact Git object SHA`);
  assert.equal(after.contentSha256, contentDigest(CONFORMANCE_CONTENT), "readback content digest mismatch");
  assert.equal(after.contentUtf8, CONFORMANCE_CONTENT, "readback content bytes mismatch");
  assert.deepEqual(artifacts.providerState.afterRetry, after, "retry changed provider state");
  assert.deepEqual(artifacts.providerState.finalRead, after, "final provider read differs from first readback");
  assert.deepEqual(artifacts.receipt.calls.map((call) => call.tool), artifacts.coverage.expectedCalls, "Path A trace call sequence mismatch");
  assert.equal(artifacts.finalReport.claims.pathCAuthorityCell, "not-proved", "Path C must be an explicit non-claim");
  assert.equal(artifacts.finalReport.claims.completeWriteCoverage, "not-proved", "completeness must be an explicit non-claim");
  for (const name of artifactOrder) assert.equal(artifacts.finalReport.artifactDigests[name], digest(artifacts[name]), `${name} digest mismatch`);
  return { v: "reelier.github-live-proxy-check/v1", status: "passed", checks: 20 };
}

function quote(value) {
  if (value.includes('"')) throw new TypeError("command path contains an unsupported quote");
  return `"${value}"`;
}

function parseToolJson(result, name) {
  const text = result?.content?.find((part) => part?.type === "text")?.text;
  if (typeof text !== "string") throw new TypeError(`${name} returned no JSON text`);
  const value = JSON.parse(text);
  if (result.isError) throw new Error(`${name} refused: ${value?.reason ?? "unknown error"}`);
  return value;
}

async function requireGhAuth() {
  try {
    await execFileAsync("gh", ["auth", "status"], { windowsHide: true, encoding: "utf8", maxBuffer: 1024 * 1024 });
  } catch {
    throw new Error("refused: gh auth is unavailable");
  }
}

async function runLive(output) {
  await requireGhAuth();
  const traceDir = path.join(output, "trace");
  await mkdir(traceDir, { recursive: true });
  const serverPath = path.resolve("scripts/disposable-github-mcp-server.mjs");
  const proxyPath = path.resolve("dist/cli.js");
  const wrap = `${quote(process.execPath)} ${quote(serverPath)}`;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [proxyPath, "mcp", "--allow-writes", "--trace-dir", traceDir, "--wrap", wrap],
    cwd: process.cwd(),
    env: process.env,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const client = new Client({ name: "reelier-disposable-github-proof", version: "1.0.0" }, { capabilities: {} });
  const target = { repository: CONFORMANCE_REPOSITORY, branch: CONFORMANCE_BRANCH, path: CONFORMANCE_PATH };
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    const start = await client.callTool({ name: "reelier_start_recording", arguments: { name: "github-live-proxy-conformance-2026-08-16" } });
    const startText = start.content?.find((part) => part?.type === "text")?.text;
    if (typeof startText !== "string" || !startText.startsWith("Recording started: ")) throw new Error("Path A recording did not start");
    const tracePath = startText.slice("Recording started: ".length);
    const before = parseToolJson(await client.callTool({ name: "github_read_conformance_state", arguments: target }), "initial read");
    const request = { ...target, content: CONFORMANCE_CONTENT, requestKey: CONFORMANCE_REQUEST_KEY };
    const first = parseToolJson(await client.callTool({ name: "github_put_conformance_file", arguments: request }), "first dispatch");
    const retry = parseToolJson(await client.callTool({ name: "github_put_conformance_file", arguments: request }), "retry");
    const final = parseToolJson(await client.callTool({ name: "github_read_conformance_state", arguments: target }), "final read");
    const stop = await client.callTool({ name: "reelier_stop_recording", arguments: {} });
    if (stop.isError) throw new Error("Path A recording did not stop cleanly");
    const trace = (await readFile(tracePath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const artifacts = buildEvidenceArtifacts({ before, first, retry, final, tools, trace });
    const check = checkEvidenceArtifacts(artifacts);
    await writeEvidence(output, artifacts, check);
    return { artifacts, check, stderr: stderr.slice(-2000) };
  } finally {
    await client.close().catch(() => {});
  }
}

function readme(artifacts, check) {
  const after = artifacts.providerState.afterFirstDispatch;
  return `# GitHub Path A live-proxy conformance — 2026-08-16\n\n` +
    `Status: **${check.status}**. This evidence was produced by an MCP client calling the existing Reelier live proxy (` + "`dist/cli.js mcp --wrap`" + `), which fronted a bounded downstream server using process-local ` + "`gh api`" + ` authentication. No token was read, printed, or serialized.\n\n` +
    `The only provider write updated ` + "`reelier-conformance-proof.txt`" + ` on ` + "`fixlyai/soloproof:reelier/conformance-20260816`" + `. The exact post-write Git objects were commit ` + "`" + `${after.head}` + "`" + `, tree ` + "`" + `${after.tree}` + "`" + `, and blob ` + "`" + `${after.blob}` + "`" + `. Retrying with the same request key returned the first result with zero additional provider effect.\n\n` +
    `Machine-checked artifacts: ` + "`descriptor.json`" + `, ` + "`delegation.json`" + `, ` + "`coverage.json`" + `, ` + "`dispatch.json`" + `, ` + "`provider-state.json`" + `, ` + "`receipt.json`" + `, and ` + "`final-report.json`" + `.\n\n` +
    `Non-claims: this is Path A observation/seatbelt evidence, not Path C authority-cell evidence. It does not prove complete write coverage, semantic content safety, review, PR creation or merge, or any interaction with protected ` + "`main`" + `.\n`;
}

async function writeEvidence(output, artifacts, check) {
  await mkdir(output, { recursive: true });
  const names = { descriptor: "descriptor.json", delegation: "delegation.json", coverage: "coverage.json", dispatch: "dispatch.json", providerState: "provider-state.json", receipt: "receipt.json", finalReport: "final-report.json" };
  for (const [key, filename] of Object.entries(names)) await writeFile(path.join(output, filename), `${JSON.stringify(artifacts[key], null, 2)}\n`, "utf8");
  await writeFile(path.join(output, "README.md"), readme(artifacts, check), "utf8");
}

async function main(argv) {
  if (argv.length !== 2 || argv[0] !== "--out" || !argv[1]) throw new TypeError("usage: disposable-github-live-proxy.mjs --out <evidence-directory>");
  const output = path.resolve(argv[1]);
  const result = await runLive(output);
  process.stdout.write(`${JSON.stringify({ status: result.check.status, classification: "path-a-live-proxy", repository: CONFORMANCE_REPOSITORY, branch: CONFORMANCE_BRANCH, output })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
