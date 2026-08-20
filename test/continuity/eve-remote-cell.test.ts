/** The first real-model-shaped Eve -> Authority-Cell-ingress round trip.
 *
 * Everything on both sides is the production article: a REAL staged Cell bundle, a REAL signed root
 * grant, the REAL `composeAuthorityServeHost` composition `authority serve` calls, the REAL
 * `scripts/cell-register-and-probe.mjs` session issuance, and the REAL Eve 0.39.0 runtime executing
 * the fixture agent. Only two things are hermetic: the release runner's provider is the loopback
 * fixture (the smoke never dispatches an Outcome), and the model is Eve's deterministic `mockModel`
 * (the fixture's charter is "no external model calls"). The HTTP conversation itself — Bearer
 * authentication, `GET /v1/jobs`, `POST /v1/jobs/<ref>/load` — is exactly what the live Cell serves.
 *
 * WHAT THIS PROVES: an Eve agent, given only a Cell origin and a bearer in its environment, reaches
 * an authenticated ingress over HTTP and resolves the four-definition Job Card down to one loaded
 * opaque reference. WHAT IT DOES NOT PROVE: anything about the LIVE Fly Cell, its TLS, or its
 * network path. Those are an operator run of the same `npm run smoke:remote` entry point. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import type { AuthorityHostServer } from "../../src/authority/host/server.js";
import { githubReleaseAliases } from "../../src/packs/github-release/manifest.js";
import { probe, serve, sign, stage } from "../authority/support/cell-smoke-harness.js";

const fixtureRoot = path.resolve("conformance/continuity-adapter/v1/eve-fixture");
const smokeScript = path.join(fixtureRoot, "scripts", "eve-remote-smoke.mjs");
/** CI installs the fixture's dependencies on the Ubuntu leg only (`.github/workflows/ci.yml`), and a
 * developer clone has them only after `npm --prefix conformance/continuity-adapter/v1/eve-fixture ci`.
 * The gate is the dependency, not the platform: the real Eve runtime boots on win32 too, verified
 * 2026-08-19 on Windows 11 / Node 24.9.0. */
const skip = existsSync(path.join(fixtureRoot, "node_modules", "eve"))
  ? false
  : "requires `npm --prefix conformance/continuity-adapter/v1/eve-fixture ci --ignore-scripts`";

interface Ran { readonly status: number | null; readonly stdout: string; readonly stderr: string }

/** Spawned, never `spawnSync`: the serve host under test lives in THIS process, so a blocked event
 * loop would deadlock the child's authenticated fetch against a server that can never answer. */
async function runSmoke(cellUrl: string, token: string): Promise<Ran> {
  const child = spawn(process.execPath, [smokeScript], {
    env: { ...(process.env as Record<string, string>), REELIER_CELL_URL: cellUrl, REELIER_CELL_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8"); child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => { stderr += chunk; });
  const status = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", code => resolve(code)); });
  return { status, stdout, stderr };
}

function summaryFrom(stdout: string): Record<string, unknown> {
  const line = stdout.split(/\r?\n/u).find(value => value.startsWith("agent: "));
  assert.ok(line, `no agent summary line in:\n${stdout}`);
  return JSON.parse(line.slice("agent: ".length)) as Record<string, unknown>;
}

test("a real Eve 0.39.0 agent searches and loads through the Authority Cell's HTTP ingress", { skip }, async (t) => {
  const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
  const harness = stage();
  let running: Readonly<{ server: AuthorityHostServer; port: number }> | undefined;
  try {
    assert.equal(sign(harness, ["--trust-key", harness.operatorTrustKey, "--authority-cell-id", harness.authorityCellId]).status, 0);
    running = await serve(harness);
    const cellUrl = `http://127.0.0.1:${running.port}`;

    // The SAME registration ceremony the operator runs in-Cell: register the signed root, resolve the
    // binding, mint the `agent_release` session. The raw bearer exists only in this token file.
    const registered = await probe(harness, running.port);
    assert.equal(registered.status, 0, `${registered.stdout}\n${registered.stderr}`);
    const token = readFileSync(harness.tokenFile, "utf8").trim();
    assert.match(token, /^rat_[A-Za-z0-9_-]+$/);

    await t.test("jobs.search returns the four signed definitions and one ref loads", async () => {
      const ran = await runSmoke(cellUrl, token);
      assert.equal(ran.status, 0, `${ran.stdout}\n${ran.stderr}`);
      assert.match(ran.stdout, new RegExp(`^jobRefs: ${githubReleaseAliases.length}$`, "m"));
      assert.match(ran.stdout, /^loaded: jobref_[0-9a-f]{64} /m);

      const summary = summaryFrom(ran.stdout);
      assert.equal(summary.v, "reelier.eve-remote-cell-smoke/v1");
      assert.equal(summary.jobRefCount, 4);
      assert.equal(summary.searchVerdict, "accepted");
      assert.equal(summary.loadVerdict, "accepted");
      assert.equal(summary.toolError, null);
      assert.match(String(summary.loadedJobRef), /^jobref_[0-9a-f]{64}$/);
      // A signed multi-definition Job Card exposes opaque references only — no alias, no provider
      // identity, no credential material reaches the model.
      assert.equal(summary.loadedAlias, null);

      // The load-bearing assertion: the bearer authenticated a real HTTP conversation and is nowhere
      // in the operator's terminal.
      assert.equal(ran.stdout.includes(token), false, "the raw bearer must never reach stdout");
      assert.equal(ran.stderr.includes(token), false, "the raw bearer must never reach stderr");
    });

    await t.test("a bearer the Cell will not resolve fails loudly instead of fabricating a pass", async () => {
      const ran = await runSmoke(cellUrl, "rat_not_a_registered_session");
      assert.equal(ran.status, 1, `${ran.stdout}\n${ran.stderr}`);
      assert.equal(ran.stdout, "", "a refused run must print no result at all");
      assert.match(ran.stderr, /reelier_jobs_search tool failed/);
      // The Cell's OWN refusal, surfaced verbatim: never a generic harness message.
      assert.match(ran.stderr, /HTTP 401/);
      assert.match(ran.stderr, /authentication-required/);
      assert.equal(ran.stderr.includes(token), false);
    });
  } finally {
    await running?.server.close();
    rmSync(harness.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    restorePlatform();
  }
});
