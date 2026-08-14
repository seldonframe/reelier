import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { access, cp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStreamIngestor, readEveStream } from "./stream.mjs";

const sourceFixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(sourceFixtureRoot, "../../../..");
const eveCliPath = resolve(sourceFixtureRoot, "node_modules/eve/bin/eve.js");
const dist = (path) => pathToFileURL(resolve(repositoryRoot, path)).href;

export async function startEveProcess({ cwd, env }) {
  let last;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const port = await unusedLoopbackPort();
    const lines = [];
    const child = spawn(process.execPath, [eveCliPath, "dev", "--port", String(port)], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    capture(child.stdout, lines);
    capture(child.stderr, lines);
    try {
      await waitForHealth(`http://127.0.0.1:${port}`, child, env.EVE_EVAL_AUTH_TOKEN);
      return Object.freeze({ child, pid: child.pid, port, url: `http://127.0.0.1:${port}`, diagnostics: () => lines.slice(-80).join("\n") });
    } catch (error) {
      last = error;
      await stopEveProcess(child);
      if (!lines.join("\n").match(/EADDRINUSE|address already in use/i)) throw new Error(`${error.message}\n${lines.slice(-80).join("\n")}`);
    }
  }
  throw last ?? new Error("Eve could not reserve a loopback port");
}

export async function runEveCommand({ cwd, env, args }) {
  const child = spawn(process.execPath, [eveCliPath, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  child.stdout?.on("data", (chunk) => { output = `${output}${String(chunk)}`.slice(-32_000); });
  child.stderr?.on("data", (chunk) => { output = `${output}${String(chunk)}`.slice(-32_000); });
  const code = await new Promise((resolveExit, reject) => { child.once("error", reject); child.once("close", resolveExit); });
  return Object.freeze({ code, output });
}

export async function stopEveProcess(child) {
  if (!child || child.exitCode !== null || child.pid === undefined) return;
  const exactPid = child.pid;
  if (process.platform === "win32") {
    const treeStop = spawn("taskkill", ["/PID", String(exactPid), "/T"], { stdio: "ignore", windowsHide: true });
    await new Promise((resolveExit) => treeStop.once("close", resolveExit));
    if (await waitForExit(child, 5_000)) return;
    const forceTree = spawn("taskkill", ["/PID", String(exactPid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    await new Promise((resolveExit) => forceTree.once("close", resolveExit));
  } else {
    child.kill("SIGTERM");
    if (await waitForExit(child, 5_000)) return;
    try { process.kill(exactPid, "SIGKILL"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
  }
  await waitForExit(child, 5_000);
}

export async function crashEveProcess(processHandle) {
  const { child, pid: exactPid, url } = processHandle;
  if (!child || child.exitCode !== null || exactPid === undefined) return;
  if (process.platform === "win32") {
    const forceTree = spawn("taskkill", ["/PID", String(exactPid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    const code = await new Promise((resolveExit, reject) => { forceTree.once("error", reject); forceTree.once("close", resolveExit); });
    assert.equal(code, 0, `taskkill failed for exact Eve PID ${exactPid}`);
  } else {
    try { process.kill(exactPid, "SIGKILL"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
  }
  assert.equal(await waitForExit(child, 5_000), true, `exact Eve PID ${exactPid} survived the crash cut`);
  await waitForListenerClosed(url);
}

async function runMatrix(resultPath, runtimeRoot) {
  const [{ createGitHubIssueLabelsFixture }, { startPathCConformancePort }, continuity, authority] = await Promise.all([
    import(dist("dist-test/test/authority/fixtures/github-issue-labels.js")),
    import(dist("dist-test/test/continuity/support/path-c-port.js")),
    import(dist("dist-test/src/continuity/index.js")),
    import(dist("dist-test/src/authority/index.js")),
  ]);
  const context = { createGitHubIssueLabelsFixture, startPathCConformancePort, continuity, authority, runtimeRoot };
  const checkpointCut = await checkpointScenario(context);
  const outcomeCut = await outcomeScenario(context);
  const boundaries = await boundaryScenarios(context);
  const matrix = Object.freeze({
    scenarios: Object.freeze({ checkpointCut, outcomeCut, ...boundaries }),
    artifacts: Object.freeze({ ledgerHeadDigest: outcomeCut.ledgerHeadDigest, receiptGraphDigest: outcomeCut.receiptGraphDigest }),
  });
  await writeFile(resultPath, JSON.stringify(matrix), "utf8");
}

async function checkpointScenario(context) {
  const state = await createScenario(context, "checkpoint", { patchCheckpoint: true });
  let first;
  try {
    first = await startEveProcess({ cwd: state.appRoot, env: state.env });
    const created = await post(first.url, "/eve/v1/session", state.token, { message: "checkpoint", operationId: "checkpoint-cut" });
    assert.equal(created.status, 202, `${JSON.stringify(created.body)}\n${first.diagnostics()}`);
    const sessionId = created.body.sessionId;
    await waitForPath(join(state.root, "after-checkpoint-commit-before-return.marker"));
    const beforeCrash = await readEveStream({ baseUrl: first.url, sessionId, token: state.token, startIndex: 0 });
    await crashEveProcess(first);
    first = undefined;
    const restarted = await startEveProcess({ cwd: state.appRoot, env: state.env });
    try {
      await waitForAnyBoundary(restarted.url, sessionId, state.token, beforeCrash.cursor);
      const replay = await post(restarted.url, `/eve/v1/session/${encodeURIComponent(sessionId)}`, state.token, { message: "checkpoint" });
      assert.equal(replay.status, 202, JSON.stringify(replay.body));
      await waitForBoundary(restarted.url, sessionId, state.token, beforeCrash.cursor);
    } finally { await stopEveProcess(restarted.child); }
    const snapshot = await state.ledger.read(state.taskId);
    const projection = context.continuity.createResumeProjection(snapshot);
    return Object.freeze({ cursor: snapshot.cursor, segmentCount: await segmentCount(state.ledgerRoot, state.taskId), uncertainClaimCount: projection.sections.evidenceAndUncertainty.uncertainClaims.length, uncertainClaimStatus: projection.sections.evidenceAndUncertainty.uncertainClaims[0]?.status, noThirdSegmentAfterReplay: snapshot.cursor === 2, counters: state.port.counters() });
  } finally {
    await stopEveProcess(first?.child);
    await state.close();
  }
}

async function outcomeScenario(context) {
  const state = await createScenario(context, "outcome", { fault: "after-provider-apply-before-response" });
  let processHandle;
  try {
    processHandle = await startEveProcess({ cwd: state.appRoot, env: state.env });
    const created = await post(processHandle.url, "/eve/v1/session", state.token, { message: "request outcome", operationId: "outcome-cut" });
    assert.equal(created.status, 202, `${JSON.stringify(created.body)}\n${processHandle.diagnostics()}`);
    const sessionId = created.body.sessionId;
    await state.port.faultReached;
    const beforeCrash = await readEveStream({ baseUrl: processHandle.url, sessionId, token: state.token, startIndex: 0 });
    await crashEveProcess(processHandle);
    processHandle = undefined;
    state.port.release();
    const restarted = await startEveProcess({ cwd: state.appRoot, env: state.env });
    processHandle = restarted;
    let settled;
    try {
      settled = await waitForAnyBoundary(restarted.url, sessionId, state.token, beforeCrash.cursor);
    } catch (error) {
      throw new Error(`${error.message}\n${restarted.diagnostics()}`, { cause: error });
    }
    const recoveredSessionId = sessionId;
    const statusSend = await post(restarted.url, `/eve/v1/session/${encodeURIComponent(recoveredSessionId)}`, state.token, { message: "read status" });
    assert.equal(statusSend.status, 202);
    await waitForBoundary(restarted.url, recoveredSessionId, state.token, settled.cursor);
    const nativeStatus = await state.fixture.runner.status({ bearerToken: state.fixture.credential.token, requestId: "request_eve_1" });
    const verified = await state.port.exportVerifiedGraph();
    assert.equal(verified.status, "verified");
    const before = await state.ledger.read(state.taskId);
    const appended = await state.ledger.appendVerifiedAuthority(state.actor, {
      taskId: state.taskId,
      expectedCursor: before.cursor,
      actorPrincipalId: state.actor.principalId,
      workloadId: state.actor.workloadId,
      jobCardDigest: before.jobCardDigest,
    }, verified);
    assert.equal(appended.ok, true);
    const after = await state.ledger.read(state.taskId);
    const projection = context.continuity.createResumeProjection(after);
    const verifiedConsequence = projection.sections.consequentialState.some((item) => item.verification.status === "verified");
    const counters = state.port.counters();
    const receiptGraphDigest = context.authority.authorityDigest(verified);
    return Object.freeze({ ...counters, providerWrites: nativeStatus.providerWrites, verifierProducedConsequence: verifiedConsequence, ambiguousRequiresReconcile: nativeStatus.status !== "ambiguous" || projection.sections.nextSafeActions.includes("reconcile-before-retry"), ledgerHeadDigest: after.segmentDigest, receiptGraphDigest });
  } finally {
    state.port.release();
    await stopEveProcess(processHandle?.child);
    await state.close();
  }
}

async function boundaryScenarios(context) {
  const state = await createScenario(context, "boundaries", {});
  let processHandle;
  try {
    processHandle = await startEveProcess({ cwd: state.appRoot, env: { ...state.env, REELIER_EVE_MODEL_ID: "continuity-script-a" } });
    const created = await post(processHandle.url, "/eve/v1/session", state.token, { message: "continuity ready", operationId: "boundary-base" });
    const sessionId = created.body.sessionId;
    let settled = await waitForBoundary(processHandle.url, sessionId, state.token, 0);
    const before = await projectionBytes(state, context);
    const effectsBefore = state.port.counters();

    const firstRead = await readEveStream({ baseUrl: processHandle.url, sessionId, token: state.token, startIndex: 0 });
    const overlapStart = Math.max(0, firstRead.cursor - 3);
    const secondRead = await readEveStream({ baseUrl: processHandle.url, sessionId, token: state.token, startIndex: overlapStart });
    const ingestor = createStreamIngestor();
    ingestor.ingest(firstRead.rows, 0);
    ingestor.ingest(secondRead.rows, overlapStart);
    const ingested = ingestor.snapshot();
    const allIds = ingested.instrumentation.map((event) => event.meta.id);
    const streamOverlap = Object.freeze({ overlapCount: firstRead.cursor - overlapStart, duplicateInstrumentationIds: allIds.length - new Set(allIds).size, ledgerUnchanged: before.equals(await projectionBytes(state, context)) });

    const compact = await post(processHandle.url, `/eve/v1/session/${encodeURIComponent(sessionId)}/compact`, state.token);
    assert.equal(compact.status, 202);
    settled = await waitForBoundary(processHandle.url, sessionId, state.token, settled.cursor, "compaction.completed");
    const afterCompact = await projectionBytes(state, context);
    const clear = await post(processHandle.url, `/eve/v1/session/${encodeURIComponent(sessionId)}/clear`, state.token);
    assert.equal(clear.status, 202);
    settled = await waitForBoundary(processHandle.url, sessionId, state.token, settled.cursor, "context.cleared");
    const afterClear = await projectionBytes(state, context);
    const compactAndClear = Object.freeze({ compactProjectionUnchanged: before.equals(afterCompact), clearProjectionUnchanged: before.equals(afterClear), effectsUnchanged: sameCounters(effectsBefore, state.port.counters()) });

    const reset = await post(processHandle.url, `/eve/v1/session/${encodeURIComponent(sessionId)}/reset`, state.token, { reason: "replacement" });
    assert.equal(reset.status >= 200 && reset.status < 300, true, JSON.stringify(reset.body));
    const retired = await post(processHandle.url, `/eve/v1/session/${encodeURIComponent(sessionId)}`, state.token, { message: "continuity ready" });
    const replacement = await post(processHandle.url, "/eve/v1/session", state.token, { message: "continuity ready", operationId: "boundary-replacement" });
    const replacementId = replacement.body.sessionId;
    const replacementSettled = await waitForBoundary(processHandle.url, replacementId, state.token, 0);
    const resetAndReplace = Object.freeze({ retiredHttpStatus: retired.status, retiredCode: retired.body.code, projectionUnchanged: before.equals(await projectionBytes(state, context)), runtimeSessionChanged: replacementId !== sessionId });

    const crossBefore = await projectionBytes(state, context);
    const crossEffects = state.port.counters();
    const cross = await post(processHandle.url, `/eve/v1/session/${encodeURIComponent(replacementId)}`, state.otherToken, { message: "continuity ready" });
    const crossRead = await readEveStream({ baseUrl: processHandle.url, sessionId: replacementId, token: state.token, startIndex: replacementSettled.cursor });
    const crossPrincipal = Object.freeze({ failedBeforeStepStarted: cross.status >= 400 && !crossRead.rows.some((event) => event.type === "step.started"), httpStatus: cross.status, eventTypes: crossRead.rows.map((event) => event.type), ledgerUnchanged: crossBefore.equals(await projectionBytes(state, context)), effectsUnchanged: sameCounters(crossEffects, state.port.counters()) });

    await stopEveProcess(processHandle.child);
    processHandle = await startEveProcess({ cwd: state.appRoot, env: { ...state.env, REELIER_EVE_MODEL_ID: "continuity-script-b" } });
    const modelEffects = state.port.counters();
    const modelSession = await post(processHandle.url, "/eve/v1/session", state.token, { message: "continuity ready", operationId: "model-b" });
    await waitForBoundary(processHandle.url, modelSession.body.sessionId, state.token, 0);
    const modelNeutrality = Object.freeze({ projectionBytesUnchanged: before.equals(await projectionBytes(state, context)), effectsUnchanged: sameCounters(modelEffects, state.port.counters()) });
    return Object.freeze({ streamOverlap, compactAndClear, resetAndReplace, crossPrincipal, modelNeutrality });
  } finally {
    await stopEveProcess(processHandle?.child);
    await state.close();
  }
}

async function createScenario(context, name, options) {
  const root = resolve(context.runtimeRoot, name);
  const runKey = createHash("sha256").update(context.runtimeRoot).digest("hex").slice(0, 12);
  const appRoot = resolve(repositoryRoot, ".superpowers", "task5-eve-runtime", `task5-${runKey}-${name}`);
  const ledgerRoot = resolve(root, "ledger");
  await mkdir(root, { recursive: true });
  await copyFixture(appRoot, options.patchCheckpoint === true);
  const fixture = await context.createGitHubIssueLabelsFixture();
  const port = await context.startPathCConformancePort({ fixture, ...(options.fault ? { fault: options.fault } : {}) });
  const taskId = fixture.initialized.identifiers.taskId;
  const token = randomBytes(32).toString("base64url");
  const otherToken = randomBytes(32).toString("base64url");
  const actor = Object.freeze({ v: "reelier.authenticated-workload/v1", taskId, principalId: "principal_eve_1", workloadId: "workload_eve_1", runtimeSessionId: "provisioning", harnessId: "eve@0.37.1" });
  const evidenceSignerId = fixture.pin.keyDescriptors.find((item) => item.role === "authority-cell" && item.purpose === "authority-evidence")?.keyId;
  const replayAnchors = Object.freeze({ trustPin: fixture.pin, currentTrustObservation: { v: "reelier.portable-current-trust-observation/v1", observedAt: "2026-08-11T20:00:00.000Z", expiresAt: "2026-08-11T21:00:00.000Z", activeAuthorityEvidenceSignerIds: [evidenceSignerId] }, expectedResponseSemanticsProfile: { v: "reelier.http-response-semantics/v1", profileId: "github.issue-labels.hermetic-v1", acknowledgedStatuses: [200] }, verificationTime: "2026-08-11T20:10:00.000Z" });
  const ledger = new context.continuity.FsContinuityLedger(ledgerRoot, { resolveAuthorityAnchors: async () => replayAnchors });
  const provisioned = await ledger.append(actor, { v: "reelier.continuity-checkpoint/v1", taskId, expectedCursor: 0, actorPrincipalId: actor.principalId, workloadId: actor.workloadId, jobCardDigest: `sha256:${"a".repeat(64)}`, authoritySnapshotDigest: `sha256:${"b".repeat(64)}`, proposedEvents: [{ type: "task.opened", eventId: `event_${name}_opened`, outcome: "Eve continuity conformance", completionProjection: "Counters and canonical projections satisfy the matrix.", nonGoals: ["live providers", "content correctness"] }], evidenceRefs: [] });
  assert.equal(provisioned.ok, true);
  const registry = {
    [createHash("sha256").update(token).digest("hex")]: { principalId: actor.principalId, taskId, taskOwnerPrincipalId: actor.principalId, workloadId: actor.workloadId },
    [createHash("sha256").update(otherToken).digest("hex")]: { principalId: "principal_eve_2", taskId, taskOwnerPrincipalId: actor.principalId, workloadId: actor.workloadId },
  };
  const env = localOnlyEnvironment({ EVE_EVAL_AUTH_TOKEN: token, ...(options.patchCheckpoint ? { REELIER_CHECKPOINT_CUT_MARKER: join(root, "after-checkpoint-commit-before-return.marker") } : {}), REELIER_EVE_AUTH_REGISTRY_JSON: JSON.stringify(registry), REELIER_CONTINUITY_ROOT: ledgerRoot, REELIER_CONTINUITY_PROTOCOL_V: "reelier.continuity-checkpoint/v1", REELIER_JOB_CARD_DIGEST: `sha256:${"a".repeat(64)}`, REELIER_AUTHORITY_SNAPSHOT_DIGEST: `sha256:${"b".repeat(64)}`, REELIER_PATH_C_PORT_URL: port.url, REELIER_PATH_C_PORT_TOKEN: port.clientToken });
  return { root, appRoot, ledgerRoot, ledger, taskId, actor, token, otherToken, env, fixture, port, close: async () => { await port.close(); await fixture.close(); await rm(appRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } };
}

async function copyFixture(target, patchCheckpoint) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(sourceFixtureRoot, { withFileTypes: true })) {
    if (["node_modules", ".eve", ".output", "dist"].includes(entry.name)) continue;
    await cp(resolve(sourceFixtureRoot, entry.name), resolve(target, entry.name), { recursive: true });
  }
  await symlink(resolve(sourceFixtureRoot, "node_modules"), resolve(target, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const agentPath = resolve(target, "agent/agent.ts");
  let source = await readFile(agentPath, "utf8");
  source = source.replace("model: mockModel(({ lastUserMessage, messages, toolResults }) => {", "model: mockModel({ modelId: process.env.REELIER_EVE_MODEL_ID ?? \"continuity-script-a\", respond: ({ lastUserMessage, messages, toolResults }) => {");
  source = source.replace(/\n  \}\),\n\}\);\s*$/u, "\n  }}),\n});\n");
  if (patchCheckpoint) source = source.replace("events: [{\n    type: \"task.opened\",\n    eventId: \"event_eve_opened\",\n    outcome: \"Eve checkpoint outcome\",\n    completionProjection: \"The deterministic Eve conformance run completes without a failed action.\",\n    nonGoals: [\"external model calls\"],\n  }],", "events: [{ type: \"claim.recorded\", eventId: \"event_eve_checkpoint\", claimId: \"claim_eve_checkpoint\", statement: \"Checkpoint survived process termination.\", status: \"unchecked\", evidenceDigest: null }],").replace("expectedCursor: 0,", "expectedCursor: 1,");
  await writeFile(agentPath, source, "utf8");
  if (patchCheckpoint) {
    const toolPath = resolve(target, "agent/tools/continuity_checkpoint.ts");
    let toolSource = await readFile(toolPath, "utf8");
    toolSource = toolSource.replace('import { defineTool } from "eve/tools";', 'import { access, writeFile } from "node:fs/promises";\nimport { defineTool } from "eve/tools";')
      .replace("    const result = await continuityRuntime(ctx).checkpoint(checkpoint);", "    const result = await continuityRuntime(ctx).checkpoint(checkpoint);\n    if (process.env.REELIER_CHECKPOINT_CUT_MARKER) {\n      let cutAlreadyReached = false;\n      try { await access(process.env.REELIER_CHECKPOINT_CUT_MARKER); cutAlreadyReached = true; } catch {}\n      if (!cutAlreadyReached) {\n        await writeFile(process.env.REELIER_CHECKPOINT_CUT_MARKER, \"committed\\n\", \"utf8\");\n        await new Promise<never>(() => {});\n      }\n    }");
    await writeFile(toolPath, toolSource, "utf8");
  }
}

async function projectionBytes(state, context) {
  return context.authority.authorityCanonicalBytes(context.continuity.createResumeProjection(await state.ledger.read(state.taskId)));
}
async function segmentCount(root, taskId) { return (await readdir(resolve(root, taskId))).filter((name) => /^\d{16}-[0-9a-f]{64}\.json$/u.test(name)).length; }
async function post(baseUrl, path, token, body) {
  const response = await fetch(new URL(path, baseUrl), { method: "POST", redirect: "error", headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
  let parsed = {}; try { parsed = await response.json(); } catch {}
  return { status: response.status, body: parsed };
}
async function waitForEvent(baseUrl, sessionId, token, cursor, predicate) {
  const observed = [];
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const read = await readEveStream({ baseUrl, sessionId, token, startIndex: cursor });
    cursor = read.cursor;
    observed.push(...read.rows.map((event) => ({ type: event.type, data: event.data })));
    const event = read.rows.find(predicate);
    if (event) return { event, cursor };
    await delay(50);
  }
  throw new Error(`expected Eve event was not observed: ${JSON.stringify(observed.slice(-30))}`);
}
async function waitForBoundary(baseUrl, sessionId, token, cursor, requiredType) {
  let foundRequired = requiredType === undefined;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const read = await readEveStream({ baseUrl, sessionId, token, startIndex: cursor });
    cursor = read.cursor;
    foundRequired ||= read.rows.some((event) => event.type === requiredType);
    if (foundRequired && read.rows.some((event) => event.type === "session.waiting" || event.type === "session.failed")) return { cursor, rows: read.rows };
    await delay(50);
  }
  throw new Error("Eve session did not reach a boundary");
}
async function waitForAnyBoundary(baseUrl, sessionId, token, cursor) {
  const rows = [];
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const read = await readEveStream({ baseUrl, sessionId, token, startIndex: cursor });
    cursor = read.cursor; rows.push(...read.rows);
    if (rows.some((event) => event.type === "session.waiting" || event.type === "session.failed")) return { cursor, rows };
    await delay(50);
  }
  throw new Error("Eve session did not settle");
}
function sameCounters(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function localOnlyEnvironment(required) {
  const inherited = ["PATH", "Path", "PATHEXT", "SystemRoot", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"];
  return Object.fromEntries([...inherited.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]), ["NO_PROXY", "127.0.0.1,localhost"], ["no_proxy", "127.0.0.1,localhost"], ...Object.entries(required)]);
}
function capture(stream, lines) { let buffered = ""; stream?.on("data", (chunk) => { buffered += String(chunk); const split = buffered.split(/\r?\n/u); buffered = split.pop() ?? ""; lines.push(...split); if (lines.length > 80) lines.splice(0, lines.length - 80); }); }
async function unusedLoopbackPort() { const server = createServer(); await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); }); const address = server.address(); const port = address.port; await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); return port; }
async function waitForHealth(baseUrl, child, token) { for (let attempt = 0; attempt < 600; attempt += 1) { if (child.exitCode !== null) throw new Error(`Eve dev exited before health (${child.exitCode})`); try { const health = await fetch(new URL("/eve/v1/health", baseUrl), { redirect: "error", signal: AbortSignal.timeout(500) }); const info = health.ok && token ? await fetch(new URL("/eve/v1/info", baseUrl), { redirect: "error", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(500) }) : null; if (health.ok && info?.ok) return; } catch {} await delay(100); } throw new Error("Eve health timeout"); }
async function waitForListenerClosed(baseUrl) { for (let attempt = 0; attempt < 100; attempt += 1) { try { await fetch(new URL("/eve/v1/health", baseUrl), { redirect: "error", signal: AbortSignal.timeout(200) }); } catch { return; } await delay(50); } throw new Error(`Eve listener survived exact tree termination at ${baseUrl}`); }
async function waitForPath(path) { for (let attempt = 0; attempt < 600; attempt += 1) { try { await access(path); return; } catch {} await delay(50); } throw new Error(`expected crash-cut marker was not written: ${path}`); }
async function waitForExit(child, timeout) { if (child.exitCode !== null) return true; return new Promise((resolveExit) => { const timer = setTimeout(() => { child.off("close", close); resolveExit(false); }, timeout); timer.unref(); const close = () => { clearTimeout(timer); resolveExit(true); }; child.once("close", close); }); }
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

if (process.argv[2] === "--matrix") {
  const resultPath = process.argv[3];
  const rootFlag = process.argv[4];
  const runtimeRoot = process.argv[5];
  if (!resultPath || rootFlag !== "--runtime-root" || !runtimeRoot) throw new Error("usage: eve-process.mjs --matrix <result> --runtime-root <dir>");
  runMatrix(resolve(resultPath), resolve(runtimeRoot)).catch((error) => { process.stderr.write(`${String(error?.stack ?? error).slice(-4_000)}\n`); process.exitCode = 1; });
}
