#!/usr/bin/env node
// Boots the REAL Eve 0.39.0 runtime from this fixture and drives ONE agent task against a REMOTE
// Reelier Authority Cell: `jobs.search` through the Cell binding, then `load` of ONE returned
// jobRef. Read-only by construction — the agent has no invoke tool on this path, nothing is written
// to the Cell, and no Outcome is requested.
//
//   REELIER_CELL_URL=https://reelier-authority-cell.fly.dev \
//   REELIER_CELL_TOKEN="$(cat <token-file>)" \
//   node scripts/eve-remote-smoke.mjs
//
// EXIT CODE 0 ONLY WHEN all of: the Cell answered 200, `jobs.search` returned `verdict: accepted`
// with at least one opaque jobRef, exactly one of those refs loaded with `verdict: accepted`, and the
// agent produced its summary message. A 401, a timeout, a refusal, a tool error, a failed session, or
// a missing summary exits 1 with the Cell's own reason. Nothing here fabricates a pass: `refused` and
// `absent` are failures, never rendered as success.
//
// THE BEARER. `REELIER_CELL_TOKEN` is consumed from the environment, forwarded only in the
// `Authorization` header by `agent/lib/cell.ts`, never written to disk by this script, and scrubbed
// out of EVERY line this script prints — including Eve's own captured diagnostics — by `say`/`fail`.
// A future edit that interpolates it by accident degrades to `<redacted>` instead of leaking.
//
// WHY THE LOOPBACK PATH C VARIABLES ARE STILL SET. `agent/instructions/continuity.ts` builds the
// resume projection on every `turn.started` and constructs the loopback continuity adapter to do it.
// The smoke therefore configures a throwaway ledger root and a Path C URL that is deliberately dead
// (`http://127.0.0.1:1`): this run never requests an Outcome, and if a future edit made it try, the
// attempt fails loudly with ECONNREFUSED rather than quietly reaching a real port.

import { randomBytes, createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startEveProcess, stopEveProcess } from "./eve-process.mjs";
import { readEveStream } from "./stream.mjs";

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(fixtureRoot, "../../../..");
const TASK = "search and load one job";
const SUMMARY_V = "reelier.eve-remote-cell-smoke/v1";
const BOUNDARY_TIMEOUT_MS = 180_000;

const secrets = [process.env.REELIER_CELL_TOKEN, process.env.REELIER_CELL_TOKEN?.trim()].filter(value => typeof value === "string" && value.length > 0);
const redact = text => secrets.reduce((value, secret) => value.split(secret).join("<redacted>"), String(text));
const say = message => { process.stdout.write(`${redact(message)}\n`); };

class SmokeFailure extends Error {}
const fail = message => { throw new SmokeFailure(String(message)); };

function cellOrigin() {
  const raw = process.env.REELIER_CELL_URL;
  if (!raw) fail("REELIER_CELL_URL is required; it names the remote Authority Cell to smoke");
  if (process.env.REELIER_CELL_TOKEN === undefined || process.env.REELIER_CELL_TOKEN.trim().length === 0) {
    fail("REELIER_CELL_TOKEN is required; export the operator-held session bearer into this process's environment");
  }
  let url;
  try { url = new URL(raw); } catch { return fail("REELIER_CELL_URL is not a URL"); }
  if (url.username || url.password) fail("REELIER_CELL_URL must not carry credentials");
  if (url.pathname !== "/" || url.search || url.hash) fail("REELIER_CELL_URL must be a bare origin");
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) fail("REELIER_CELL_URL must be https, or http only on loopback");
  return url;
}

/** The inherited set is deliberately narrow — no proxy, no credential, no provider variable reaches
 * the Eve child — plus the two Cell variables the remote binding reads. */
function smokeEnvironment(required) {
  const inherited = ["PATH", "Path", "PATHEXT", "SystemRoot", "COMSPEC", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"];
  return Object.fromEntries([
    ...inherited.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]),
    ...Object.entries(required),
  ]);
}

/** A FRESH Eve app root per run, mirroring the continuity matrix's `copyFixture` (minus its agent
 * patching). This is load-bearing, not tidiness: `eve dev` keeps a dev host and build cache under the
 * app root's `.eve/`, and a warm one answers from the environment IT was started with. Measured
 * 2026-08-19 in the fixture root: after one passing run, a second run with a deliberately WRONG
 * bearer still reported a pass, because the stale dev host still held the first run's token. Staging
 * a new root is what makes this smoke's verdict a claim about the Cell and bearer you just named. */
async function stageAppRoot() {
  const appRoot = resolve(repositoryRoot, ".superpowers", "eve-remote-smoke", `smoke-${randomBytes(6).toString("hex")}`);
  await mkdir(appRoot, { recursive: true });
  for (const entry of await readdir(fixtureRoot, { withFileTypes: true })) {
    if (["node_modules", ".eve", ".output", "dist"].includes(entry.name)) continue;
    await cp(resolve(fixtureRoot, entry.name), resolve(appRoot, entry.name), { recursive: true });
  }
  await symlink(resolve(fixtureRoot, "node_modules"), resolve(appRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  return appRoot;
}

async function post(server, path, token, body) {
  const response = await server.http.request(new URL(path, server.url), {
    method: "POST",
    redirect: "error",
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  let parsed = {};
  try { parsed = await response.json(); } catch {}
  return { status: response.status, body: parsed };
}

async function waitForBoundary(server, sessionId, token) {
  const deadline = Date.now() + BOUNDARY_TIMEOUT_MS;
  const rows = [];
  let cursor = 0;
  while (Date.now() < deadline) {
    const read = await readEveStream({ client: server.http, baseUrl: server.url, sessionId, token, startIndex: cursor });
    cursor = read.cursor;
    rows.push(...read.rows);
    if (rows.some(event => event.type === "session.failed")) {
      fail(`the Eve session failed before a boundary: ${JSON.stringify(rows.slice(-10))}`);
    }
    if (rows.some(event => event.type === "session.waiting")) return rows;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  return fail(`the Eve session did not reach a boundary within ${BOUNDARY_TIMEOUT_MS}ms; the Cell may be unreachable`);
}

function summaryFrom(rows) {
  const messages = rows
    .filter(event => event.type === "message.completed" && typeof event?.data?.message === "string")
    .map(event => event.data.message);
  for (const message of [...messages].reverse()) {
    let parsed;
    try { parsed = JSON.parse(message); } catch { continue; }
    if (parsed && typeof parsed === "object" && parsed.v === SUMMARY_V) return { parsed, message };
  }
  return fail(`the agent produced no ${SUMMARY_V} summary; observed messages: ${JSON.stringify(messages.slice(-5))}`);
}

async function main() {
  const origin = cellOrigin();
  const routeToken = randomBytes(32).toString("base64url");
  const continuityRoot = await mkdtemp(resolve(tmpdir(), "reelier-eve-remote-smoke-"));
  const env = smokeEnvironment({
    EVE_EVAL_AUTH_TOKEN: routeToken,
    REELIER_EVE_AUTH_REGISTRY_JSON: JSON.stringify({
      [createHash("sha256").update(routeToken).digest("hex")]: {
        principalId: "principal_eve_remote_smoke",
        taskId: "task_eve_remote_smoke",
        taskOwnerPrincipalId: "principal_eve_remote_smoke",
        workloadId: "workload_eve_remote_smoke",
      },
    }),
    REELIER_CONTINUITY_ROOT: continuityRoot,
    REELIER_CONTINUITY_PROTOCOL_V: "reelier.continuity-checkpoint/v1",
    REELIER_JOB_CARD_DIGEST: `sha256:${"a".repeat(64)}`,
    REELIER_AUTHORITY_SNAPSHOT_DIGEST: `sha256:${"b".repeat(64)}`,
    REELIER_PATH_C_PORT_URL: "http://127.0.0.1:1",
    REELIER_PATH_C_PORT_TOKEN: randomBytes(32).toString("base64url"),
    REELIER_CELL_URL: origin.origin,
    REELIER_CELL_TOKEN: process.env.REELIER_CELL_TOKEN,
  });

  let server;
  let appRoot;
  try {
    appRoot = await stageAppRoot();
    server = await startEveProcess({ cwd: appRoot, env });
    const created = await post(server, "/eve/v1/session", routeToken, { message: TASK, operationId: "eve-remote-cell-smoke" });
    if (created.status !== 202) fail(`Eve refused the smoke session with HTTP ${created.status}: ${JSON.stringify(created.body)}`);
    const rows = await waitForBoundary(server, created.body.sessionId, routeToken);
    const { parsed, message } = summaryFrom(rows);

    if (parsed.toolError) fail(`the ${parsed.toolError} tool failed against ${origin.origin}; the Cell's own reason is in the Eve diagnostics below\n${server.diagnostics()}`);
    if (parsed.searchVerdict !== "accepted") fail(`jobs.search returned verdict ${JSON.stringify(parsed.searchVerdict)}, not "accepted"`);
    if (!Number.isInteger(parsed.jobRefCount) || parsed.jobRefCount < 1) fail(`jobs.search returned ${parsed.jobRefCount} job references; the smoke needs at least one to load`);
    if (typeof parsed.loadedJobRef !== "string" || parsed.loadedJobRef.length === 0) fail("no job reference was loaded");
    if (parsed.loadVerdict !== "accepted") fail(`load returned verdict ${JSON.stringify(parsed.loadVerdict)}, not "accepted"`);

    say(`cell: ${origin.origin}`);
    say(`jobRefs: ${parsed.jobRefCount}`);
    say(`loaded: ${parsed.loadedJobRef} (alias: ${parsed.loadedAlias ?? "<none — a signed multi-definition Job Card exposes opaque refs only>"})`);
    say(`agent: ${message}`);
    say("verdict: passed (read-only; no Outcome invoked, nothing written)");
  } finally {
    await stopEveProcess(server?.child);
    await rm(continuityRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    if (appRoot) await rm(appRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`eve-remote-smoke: ${redact(error instanceof SmokeFailure ? error.message : String(error?.stack ?? error)).slice(-8_000)}\n`);
  process.exitCode = 1;
}
