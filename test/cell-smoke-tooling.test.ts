import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { authorityDigest, signAuthorityDigest } from "../src/authority/index.js";
import { composeAuthorityServeHost } from "../src/authority/cli.js";
import { createDelegationAuthority } from "../src/authority/host/delegation-service.js";
import { createFilePrincipalRegistry } from "../src/authority/host/principal-registry.js";
import { createGitHubReleaseRunnerFromOperatorConfig, parseGitHubReleaseRunnerOperatorConfig } from "../src/authority/host/github-release-runner-config.js";
import { loadAuthorityDeployment } from "../src/authority/host/deployment.js";
import { loadAuthorityHostConfig } from "../src/authority/host/config.js";
import { __testSetAuthorityCellHostPlatform } from "../src/authority/host/platform.js";
import type { AuthorityHostServer } from "../src/authority/host/server.js";
import { githubReleaseAliases } from "../src/packs/github-release/manifest.js";
import { verifyTrustedAuthority } from "../src/authority/trust.js";

const stagerScript = path.resolve("scripts/stage-cell-bundle.mjs");
const signScript = path.resolve("scripts/sign-root-grant.mjs");
const probeScript = path.resolve("scripts/cell-register-and-probe.mjs");
/** Both scripts import BUILT modules; point them at the same `dist-test/src` output `npm test`
 * already produced, so the hermetic run needs no separate production build. */
const distRoot = path.resolve("dist-test/src");
const STAGER_REQUIRED_KEYS = ["release-authority.key.pem", "journal-signer.key.pem", "evidence-signer.key.pem"] as const;
const GUEST_ROOT = "/data/authority/";
const TASK_ID = "task_release_smoke_hermetic";

let restorePlatform: (() => void) | undefined;
test.before(() => { restorePlatform = __testSetAuthorityCellHostPlatform("linux"); });
test.after(() => { restorePlatform?.(); });

interface Harness {
  readonly root: string;
  readonly keysDir: string;
  readonly authorityDir: string;
  readonly configFile: string;
  readonly grantFile: string;
  readonly tokenFile: string;
  readonly preloadFile: string;
  readonly authorityCellId: string;
  readonly operatorTrustKey: string;
}

/** Stages a REAL bundle with the real stager and throwaway ceremony keys, then relocates the guest
 * paths in `authority.yml` to this workspace. Only `authority.yml` carries absolute `/data/authority`
 * paths; `deployment.json` stores its trust keys and source directory RELATIVE to itself, so the
 * staged deployment is already location-independent and is used exactly as staged. */
function stage(): Harness {
  const root = mkdtempSync(path.join(os.tmpdir(), "reelier-cell-smoke-"));
  const keysDir = path.join(root, "keys");
  const outDir = path.join(root, "out");
  mkdirSync(keysDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  for (const name of STAGER_REQUIRED_KEYS) writeFileSync(path.join(keysDir, name), generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }));
  const staged = spawnSync(process.execPath, [stagerScript, "--keys", keysDir, "--out", outDir, "--repository", "seldonframe/reelier"], {
    encoding: "utf8",
    env: { ...(process.env as Record<string, string>), REELIER_STAGE_CELL_DIST: distRoot },
  });
  assert.equal(staged.status, 0, `stage-cell-bundle failed: ${staged.stdout}\n${staged.stderr}`);

  const authorityDir = path.join(outDir, "authority");
  const configFile = path.join(authorityDir, "authority.yml");
  const config = JSON.parse(readFileSync(configFile, "utf8")) as Record<string, unknown>;
  const relative = (value: string) => { assert.equal(value.startsWith(GUEST_ROOT), true, `not a guest path: ${value}`); return value.slice(GUEST_ROOT.length); };
  for (const key of ["ledgerDir", "decisionDir", "receiptDir", "gateKeyFile", "deploymentPath", "jobCardTrustPinPath"] as const) {
    config[key] = relative(String(config[key]));
  }
  const ingress = config.ingress as Record<string, unknown>;
  ingress.principalRegistryFile = relative(String(ingress.principalRegistryFile));
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);

  // Test-only: lets the spawned scripts construct Cell-only host objects on a developer machine.
  // It uses the SAME internal seam 69 other tests use; neither script carries a platform bypass.
  const preloadFile = path.join(root, "linux-platform-preload.mjs");
  writeFileSync(preloadFile, `import { __testSetAuthorityCellHostPlatform } from ${JSON.stringify(pathToFileURL(path.join(distRoot, "authority", "host", "platform.js")).href)};\n__testSetAuthorityCellHostPlatform("linux");\n`);

  return {
    root, keysDir, authorityDir, configFile,
    grantFile: path.join(root, "smoke-root-grant.json"),
    tokenFile: path.join(authorityDir, "principals", "smoke-session.token"),
    preloadFile,
    authorityCellId: String(config.authorityCellId),
    operatorTrustKey: path.join(authorityDir, "deployment", "trust", "keys", "operator.pem"),
  };
}

function sign(harness: Harness, extra: readonly string[] = [], out = harness.grantFile) {
  const taskId = extra.includes("--task-id") ? [] : ["--task-id", TASK_ID];
  return spawnSync(process.execPath, [signScript, "--keys", harness.keysDir, "--out", out, ...taskId, ...extra], {
    encoding: "utf8",
    env: { ...(process.env as Record<string, string>), REELIER_SIGN_GRANT_DIST: distRoot },
  });
}

interface Ran { readonly status: number | null; readonly stdout: string; readonly stderr: string }

/** The probe MUST run through async `spawn`, never `spawnSync`: the serve host under test lives in
 * THIS process, and `spawnSync` blocks its event loop, so the subprocess's authenticated fetch would
 * deadlock against a server that can never answer it. */
async function probe(harness: Harness, port: number, extra: readonly string[] = [], grant = harness.grantFile): Promise<Ran> {
  const child = spawn(process.execPath, [
    "--import", pathToFileURL(harness.preloadFile).href, probeScript,
    "--grant", grant, "--config", harness.configFile,
    "--base-url", `http://127.0.0.1:${port}`, "--token-file", harness.tokenFile, ...extra,
  ], { env: { ...(process.env as Record<string, string>), REELIER_CELL_PROBE_DIST: distRoot } });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8"); child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => { stderr += chunk; });
  const status = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", code => resolve(code)); });
  return { status, stdout, stderr };
}

/** The PRODUCTION composition boundary `authority serve` itself calls, with the same principal
 * registry, delegation authority, and release runtime the Cell constructs — only the provider is a
 * loopback fixture, because the probe never dispatches. */
async function serve(harness: Harness): Promise<Readonly<{ server: AuthorityHostServer; port: number }>> {
  const loaded = await loadAuthorityHostConfig(harness.configFile);
  const config = loaded.config;
  const staged = JSON.parse(readFileSync(path.join(harness.authorityDir, "release-runner.config.json"), "utf8")) as Record<string, unknown>;
  for (const name of ["release-runner", "provider-fixtures"]) mkdirSync(path.join(harness.authorityDir, name), { recursive: true });
  const runner = await createGitHubReleaseRunnerFromOperatorConfig(parseGitHubReleaseRunnerOperatorConfig({
    v: "reelier.github-release-runner-config/v1",
    rootDir: path.join(harness.authorityDir, "release-runner"),
    journalSignerId: staged.journalSignerId,
    journalKeyFile: path.join(harness.authorityDir, "keys", "journal-signer.key.pem"),
    evidenceSignerId: staged.evidenceSignerId,
    evidenceKeyFile: path.join(harness.authorityDir, "keys", "evidence-signer.key.pem"),
    releaseAuthority: staged.releaseAuthority,
    authorizationDir: path.join(harness.authorityDir, "authorizations"),
    provider: { kind: "loopback-fixture", fixtureDir: path.join(harness.authorityDir, "provider-fixtures") },
  }));
  const principalRegistry = createFilePrincipalRegistry({ tenant: config.tenant, file: config.ingress!.principalRegistryFile! });
  const delegation = createDelegationAuthority({
    // The same siting `delegationRoot` in `src/authority/cli.ts` computes for `authority serve`.
    root: path.join(path.dirname(path.resolve(config.ledgerDir)), "delegations"),
    signGrant: async () => { throw new TypeError("the smoke never mints child grants"); },
  });
  const server = await composeAuthorityServeHost(config, "http", principalRegistry, { delegation }, runner);
  await server.startHttp(0, "127.0.0.1");
  return Object.freeze({ server, port: (server.http.address() as AddressInfo).port });
}

function jobRefsFrom(stdout: string): string[] {
  const line = stdout.split("\n").find(value => value.startsWith("jobs body: "));
  assert.ok(line, `no jobs body line in:\n${stdout}`);
  const body = JSON.parse(line.slice("jobs body: ".length)) as { verdict: string; jobs: Array<{ jobRef: string }> };
  assert.equal(body.verdict, "accepted");
  return body.jobs.map(job => job.jobRef);
}

test("sign-root-grant emits a key-free payload the deployment's own trust roots verify", async () => {
  const harness = stage();
  try {
    const result = sign(harness, ["--trust-key", harness.operatorTrustKey, "--authority-cell-id", harness.authorityCellId]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const raw = readFileSync(harness.grantFile, "utf8");
    // The payload is uploaded to a production volume: nothing key-shaped may be in it.
    for (const marker of ["BEGIN", "PRIVATE KEY", "-----"]) assert.equal(raw.includes(marker), false, `signed payload leaks ${marker}`);
    const payload = JSON.parse(raw) as { v: string; taskId: string; allocationId: string; effects: number; scope: string; authorityCellId: string; rootGrant: { grant: Record<string, unknown>; digest: string; signerId: string; signature: { alg: string; sig: string } } };
    assert.equal(payload.v, "reelier.cell-smoke-root-grant-registration/v1");
    assert.equal(payload.taskId, TASK_ID);
    assert.equal(payload.allocationId, "root");
    assert.equal(payload.effects, 1);
    assert.equal(payload.scope, "listing");
    assert.equal(payload.authorityCellId, harness.authorityCellId);
    assert.equal(payload.rootGrant.signerId, "operator");
    assert.equal(payload.rootGrant.grant.parentDigest, null);
    assert.equal(payload.rootGrant.grant.grantee, "agent_release");
    assert.equal(payload.rootGrant.grant.tenant, "tenant_release");
    assert.equal(authorityDigest(payload.rootGrant.grant), payload.rootGrant.digest);
    // The schema floor: one alias, not the four the mission needs.
    const constraints = payload.rootGrant.grant.constraints as { definitionAliases: string[]; limits: Record<string, number> };
    assert.deepEqual(constraints.definitionAliases, [githubReleaseAliases[0]]);
    assert.deepEqual(constraints.limits, { maxEffectsPerWindow: 1, windowSeconds: 1, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 1 });

    // The exact check `verifyRootGrant` runs in-Cell, against the STAGED deployment's trust roots.
    const config = (await loadAuthorityHostConfig(harness.configFile)).config;
    const deployment = await loadAuthorityDeployment(config.deploymentPath!, { jobCardTrustPin: JSON.parse(readFileSync(config.jobCardTrustPinPath!, "utf8")) });
    verifyTrustedAuthority(deployment.trustRoots, {
      tenant: config.tenant, signerId: payload.rootGrant.signerId, purpose: "delegation-grant",
      advertisedDigest: payload.rootGrant.digest, value: payload.rootGrant.grant, signature: payload.rootGrant.signature as never,
    });

    // `--scope release` widens to the four reviewed definitions, and only there.
    const releaseFile = path.join(harness.root, "release-root-grant.json");
    const widened = sign(harness, ["--scope", "release", "--trust-key", harness.operatorTrustKey], releaseFile);
    assert.equal(widened.status, 0, `${widened.stdout}\n${widened.stderr}`);
    const releasePayload = JSON.parse(readFileSync(releaseFile, "utf8")) as { rootGrant: { grant: { constraints: { definitionAliases: string[] } } } };
    assert.deepEqual(releasePayload.rootGrant.grant.constraints.definitionAliases, [...githubReleaseAliases]);
  } finally { rmSync(harness.root, { recursive: true, force: true }); }
});

test("sign-root-grant refuses a missing key, a key that is not the deployed trust root, and an existing output", () => {
  const harness = stage();
  try {
    const emptyKeys = path.join(harness.root, "empty-keys");
    mkdirSync(emptyKeys, { recursive: true });
    const missing = spawnSync(process.execPath, [signScript, "--keys", emptyKeys, "--out", harness.grantFile], {
      encoding: "utf8", env: { ...(process.env as Record<string, string>), REELIER_SIGN_GRANT_DIST: distRoot },
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /deployment delegation-grant key is missing/);
    assert.equal(existsSync(harness.grantFile), false, "a refused signing run must leave no payload behind");

    // A correctly-shaped ed25519 key that is NOT the deployed one. This is the failure the Cell
    // would otherwise only surface after upload, as "authority signature verification failed".
    const wrongKeys = path.join(harness.root, "wrong-keys");
    mkdirSync(wrongKeys, { recursive: true });
    writeFileSync(path.join(wrongKeys, "deployment-operator.key.pem"), generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }));
    const wrong = spawnSync(process.execPath, [signScript, "--keys", wrongKeys, "--out", harness.grantFile, "--trust-key", harness.operatorTrustKey], {
      encoding: "utf8", env: { ...(process.env as Record<string, string>), REELIER_SIGN_GRANT_DIST: distRoot },
    });
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /not the deployment delegation-grant key/);
    assert.equal(existsSync(harness.grantFile), false);
    // Nothing key-shaped is ever echoed, not even on the refusal paths.
    for (const stream of [missing.stdout, missing.stderr, wrong.stdout, wrong.stderr]) assert.equal(stream.includes("PRIVATE KEY"), false);

    assert.equal(sign(harness, ["--trust-key", harness.operatorTrustKey]).status, 0);
    const again = sign(harness, ["--trust-key", harness.operatorTrustKey]);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /refusing to overwrite a signed registration payload/);
  } finally { rmSync(harness.root, { recursive: true, force: true }); }
});

test("cell-register-and-probe completes the first authenticated conversation without printing the bearer", async () => {
  const harness = stage();
  let running: Readonly<{ server: AuthorityHostServer; port: number }> | undefined;
  try {
    assert.equal(sign(harness, ["--trust-key", harness.operatorTrustKey, "--authority-cell-id", harness.authorityCellId]).status, 0);
    running = await serve(harness);
    const result = await probe(harness, running.port);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const refs = jobRefsFrom(result.stdout);
    assert.equal(refs.length, githubReleaseAliases.length, "the four reviewed definitions must each yield one opaque reference");
    assert.equal(refs.length, 4);
    assert.equal(new Set(refs).size, 4);
    for (const ref of refs) assert.match(ref, /^jobref_[0-9a-f]{64}$/);
    assert.match(result.stdout, /^HTTP 200 http:\/\/127\.0\.0\.1:\d+\/v1\/jobs$/m);
    assert.match(result.stdout, /^session: issued /m);
    assert.match(result.stdout, new RegExp(`^binding: task=${TASK_ID} grant=grant_${TASK_ID} allocation=root effects=1 `, "m"));

    const token = readFileSync(harness.tokenFile, "utf8").trim();
    assert.match(token, /^rat_[A-Za-z0-9_-]+$/);
    // The load-bearing assertion: the raw bearer exists on disk and NOWHERE in the operator's terminal.
    assert.equal(result.stdout.includes(token), false, "the raw bearer must never reach stdout");
    assert.equal(result.stderr.includes(token), false, "the raw bearer must never reach stderr");
    assert.match(result.stdout, new RegExp(`^token sha256: sha256:${createHash("sha256").update(token, "utf8").digest("hex")}$`, "m"));
    assert.ok(result.stdout.includes(`token file: ${harness.tokenFile} (mode 0600)`), result.stdout);
    // Windows reports synthesized permission bits, so the real mode is asserted where it is real.
    if (process.platform !== "win32") assert.equal(statSync(harness.tokenFile).mode & 0o777, 0o600);
  } finally {
    await running?.server.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test("a re-run reuses the one session, and a divergent task refuses instead of forking authority", async () => {
  const harness = stage();
  let running: Readonly<{ server: AuthorityHostServer; port: number }> | undefined;
  try {
    assert.equal(sign(harness, ["--trust-key", harness.operatorTrustKey]).status, 0);
    running = await serve(harness);
    const first = await probe(harness, running.port);
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const token = readFileSync(harness.tokenFile, "utf8");

    const second = await probe(harness, running.port);
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.match(second.stdout, /^session: reused /m);
    assert.deepEqual(jobRefsFrom(second.stdout), jobRefsFrom(first.stdout), "a re-run must not re-key the job references");
    assert.equal(readFileSync(harness.tokenFile, "utf8"), token, "a re-run must not rotate the token file");
    assert.equal(second.stdout.includes(token.trim()), false);

    // A second registration under a different task id would fork the audience's authority. It does
    // not: allocation ids are unique across the whole delegation root, so the budget refuses first.
    const otherFile = path.join(harness.root, "other-root-grant.json");
    const other = sign(harness, ["--task-id", "task_release_smoke_other"], otherFile);
    assert.equal(other.status, 0, `${other.stdout}\n${other.stderr}`);
    const forked = await probe(harness, running.port, [], otherFile);
    assert.equal(forked.status, 1);
    assert.match(forked.stderr, /already registered with a DIFFERENT grant|budget allocation identity conflict/);
    assert.equal(readFileSync(harness.tokenFile, "utf8"), token, "a refused registration must not touch the issued session");
  } finally {
    await running?.server.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test("cell-register-and-probe refuses a foreign-signed root grant and mints no session at all", async () => {
  const harness = stage();
  let running: Readonly<{ server: AuthorityHostServer; port: number }> | undefined;
  try {
    assert.equal(sign(harness, ["--trust-key", harness.operatorTrustKey]).status, 0);
    // Same grant, same advertised signer id, re-signed by a key the deployment does not trust.
    const payload = JSON.parse(readFileSync(harness.grantFile, "utf8")) as { rootGrant: { grant: unknown; digest: string; signerId: string; signature: unknown } };
    payload.rootGrant.signature = signAuthorityDigest(generateKeyPairSync("ed25519").privateKey, "delegation-grant", payload.rootGrant.digest);
    const forgedFile = path.join(harness.root, "forged-root-grant.json");
    writeFileSync(forgedFile, `${JSON.stringify(payload, null, 2)}\n`);

    running = await serve(harness);
    const result = await probe(harness, running.port, [], forgedFile);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not signed by a delegation-grant trust root/);
    assert.equal(existsSync(harness.tokenFile), false, "a refused grant must mint no bearer");
    assert.equal(existsSync(path.join(harness.authorityDir, "principals", "registry.jsonl")), false, "a refused grant must write no principal registry event");

    // The genuine payload still works afterwards: the refusal left nothing behind to block a retry.
    const retry = await probe(harness, running.port);
    assert.equal(retry.status, 0, `${retry.stdout}\n${retry.stderr}`);
    assert.equal(jobRefsFrom(retry.stdout).length, 4);
  } finally {
    await running?.server.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

/** The public SPKI in the staged trust directory is the public half of the operator key the signer
 * reads. If this ever diverges, every signed grant is refused in-Cell and nowhere else. */
test("the deployment trust key is the public half of the operator key sign-root-grant reads", () => {
  const harness = stage();
  try {
    const derived = createPublicKey(readFileSync(path.join(harness.keysDir, "deployment-operator.key.pem"))).export({ format: "der", type: "spki" }).toString("base64");
    const deployed = createPublicKey(readFileSync(harness.operatorTrustKey)).export({ format: "der", type: "spki" }).toString("base64");
    assert.equal(derived, deployed);
  } finally { rmSync(harness.root, { recursive: true, force: true }); }
});
