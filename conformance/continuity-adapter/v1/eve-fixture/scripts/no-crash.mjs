import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHubIssueLabelsFixture } from "../../../../../dist-test/test/authority/fixtures/github-issue-labels.js";
import { startPathCConformancePort } from "../../../../../dist-test/test/continuity/support/path-c-port.js";
import { runEveCommand, startEveProcess, stopEveProcess } from "./eve-process.mjs";

const eveRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = await createGitHubIssueLabelsFixture();
const port = await startPathCConformancePort({ fixture });
const continuityRoot = await mkdtemp(resolve(tmpdir(), "reelier-eve-continuity-"));
const routeToken = randomBytes(32).toString("base64url");
const routeDigest = createHash("sha256").update(routeToken).digest("hex");
const env = localOnlyEnvironment({
  EVE_EVAL_AUTH_TOKEN: routeToken,
  REELIER_EVE_AUTH_REGISTRY_JSON: JSON.stringify({
    [routeDigest]: { principalId: "principal_eve_1", taskId: "task_eve_1", taskOwnerPrincipalId: "principal_eve_1", workloadId: "workload_eve_1" },
  }),
  REELIER_CONTINUITY_ROOT: continuityRoot,
  REELIER_CONTINUITY_PROTOCOL_V: "reelier.continuity-checkpoint/v1",
  REELIER_JOB_CARD_DIGEST: `sha256:${"a".repeat(64)}`,
  REELIER_AUTHORITY_SNAPSHOT_DIGEST: `sha256:${"b".repeat(64)}`,
  REELIER_PATH_C_PORT_URL: port.url,
  REELIER_PATH_C_PORT_TOKEN: port.clientToken,
});
const server = await startEveProcess({ cwd: eveRoot, env });
try {
  const evaluation = await runEveCommand({ cwd: eveRoot, env, args: ["eval", "--url", server.url, "--skip-report", "--verbose"] });
  assert.equal(evaluation.code, 0, redact(evaluation.output, routeToken, port.clientToken));
  const counters = port.counters();
  assert.deepEqual(counters, { outcomeRequests: 1, statusReads: 1, providerDispatches: 1, reservations: 1 });
  const verified = await port.exportVerifiedGraph();
  assert.equal(verified.status, "verified");
  console.log(`EVE_EVAL_EXIT ${evaluation.code}`);
  console.log(`PATH_C_COUNTERS ${JSON.stringify(counters)}`);
  console.log(`VERIFIED_GRAPH_STATUS ${verified.status}`);
} finally {
  await stopEveProcess(server.child);
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

function redact(output, ...secrets) {
  return secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), output);
}
