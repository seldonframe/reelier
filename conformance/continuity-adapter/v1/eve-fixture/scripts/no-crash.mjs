import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHubIssueLabelsFixture } from "../../../../../dist-test/test/authority/fixtures/github-issue-labels.js";
import { startPathCConformancePort } from "../../../../../dist-test/test/continuity/support/path-c-port.js";

const eveRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const eveBin = resolve(eveRoot, "node_modules/eve/bin/eve.js");
const fixture = await createGitHubIssueLabelsFixture();
const port = await startPathCConformancePort({ fixture });
const continuityRoot = await mkdtemp(resolve(tmpdir(), "reelier-eve-continuity-"));
const routeToken = randomBytes(32).toString("base64url");
const routeDigest = createHash("sha256").update(routeToken).digest("hex");
const evePort = await unusedLoopbackPort();
const env = localOnlyEnvironment({
  EVE_EVAL_AUTH_TOKEN: routeToken,
  REELIER_EVE_AUTH_REGISTRY_JSON: JSON.stringify({
    [routeDigest]: { principalId: "principal_eve_1", taskId: "task_eve_1", workloadId: "workload_eve_1" },
  }),
  REELIER_CONTINUITY_ROOT: continuityRoot,
  REELIER_CONTINUITY_PROTOCOL_V: "reelier.continuity-checkpoint/v1",
  REELIER_JOB_CARD_DIGEST: `sha256:${"a".repeat(64)}`,
  REELIER_AUTHORITY_SNAPSHOT_DIGEST: `sha256:${"b".repeat(64)}`,
  REELIER_PATH_C_PORT_URL: port.url,
  REELIER_PATH_C_PORT_TOKEN: port.clientToken,
});
const server = launch(["dev", "--host", "127.0.0.1", "--port", String(evePort), "--no-ui"], env);
server.stdout?.resume();
server.stderr?.resume();
try {
  const eveUrl = `http://127.0.0.1:${evePort}`;
  await waitForLoopback(eveUrl, server);
  const evaluation = await run(["eval", "--url", eveUrl, "--skip-report", "--verbose"], env);
  assert.equal(evaluation.code, 0, redact(evaluation.output, routeToken, port.clientToken));
  const counters = port.counters();
  assert.deepEqual(counters, { outcomeRequests: 1, statusReads: 1, providerDispatches: 1, reservations: 1 });
  const verified = await port.exportVerifiedGraph();
  assert.equal(verified.status, "verified");
  console.log(`EVE_EVAL_EXIT ${evaluation.code}`);
  console.log(`PATH_C_COUNTERS ${JSON.stringify(counters)}`);
  console.log(`VERIFIED_GRAPH_STATUS ${verified.status}`);
} finally {
  await stop(server);
  await port.close();
  await fixture.close();
  await rm(continuityRoot, { recursive: true, force: true });
}

function localOnlyEnvironment(required) {
  const inherited = ["PATH", "Path", "PATHEXT", "SystemRoot", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"];
  return Object.fromEntries([
    ...inherited.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]),
    ["NO_PROXY", "127.0.0.1,localhost"],
    ["no_proxy", "127.0.0.1,localhost"],
    ...Object.entries(required),
  ]);
}

function launch(args, env) {
  return spawn(process.execPath, [eveBin, ...args], { cwd: eveRoot, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
}

async function run(args, env) {
  const child = launch(args, env);
  let output = "";
  child.stdout?.on("data", chunk => { output += String(chunk); });
  child.stderr?.on("data", chunk => { output += String(chunk); });
  const code = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", resolveExit);
  });
  return { code, output };
}

async function waitForLoopback(url, child) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Eve dev exited before becoming ready (${child.exitCode})`);
    try {
      await fetch(url, { redirect: "error", signal: AbortSignal.timeout(500) });
      return;
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error("Eve dev did not become ready on loopback");
}

async function unusedLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const value = server.address().port;
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return value;
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise(resolveExit => {
    child.once("close", resolveExit);
    setTimeout(resolveExit, 5_000).unref();
  });
}

function redact(output, ...secrets) {
  return secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), output);
}
