/** The staging, signing, registration, and serve helpers the Cell smoke tests share.
 *
 * Extracted from `test/cell-smoke-tooling.test.ts` so a second suite can drive the SAME production
 * composition boundary — a real staged bundle, a real signed root grant, the real
 * `composeAuthorityServeHost`, and the real `scripts/cell-register-and-probe.mjs` — instead of
 * re-deriving a lookalike. A lookalike harness is how two suites end up proving different things
 * while reading as if they proved the same one. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { composeAuthorityServeHost } from "../../../src/authority/cli.js";
import { createDelegationAuthority } from "../../../src/authority/host/delegation-service.js";
import { createFilePrincipalRegistry } from "../../../src/authority/host/principal-registry.js";
import { createGitHubReleaseRunnerFromOperatorConfig, parseGitHubReleaseRunnerOperatorConfig } from "../../../src/authority/host/github-release-runner-config.js";
import { loadAuthorityHostConfig } from "../../../src/authority/host/config.js";
import type { AuthorityHostServer } from "../../../src/authority/host/server.js";

export const stagerScript = path.resolve("scripts/stage-cell-bundle.mjs");
export const signScript = path.resolve("scripts/sign-root-grant.mjs");
export const probeScript = path.resolve("scripts/cell-register-and-probe.mjs");
/** Both scripts import BUILT modules; point them at the same `dist-test/src` output `npm test`
 * already produced, so the hermetic run needs no separate production build. */
export const distRoot = path.resolve("dist-test/src");
export const STAGER_REQUIRED_KEYS = ["release-authority.key.pem", "journal-signer.key.pem", "evidence-signer.key.pem"] as const;
export const GUEST_ROOT = "/data/authority/";
export const TASK_ID = "task_release_smoke_hermetic";

export interface Harness {
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
export function stage(): Harness {
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

export function sign(harness: Harness, extra: readonly string[] = [], out = harness.grantFile) {
  const taskId = extra.includes("--task-id") ? [] : ["--task-id", TASK_ID];
  return spawnSync(process.execPath, [signScript, "--keys", harness.keysDir, "--out", out, ...taskId, ...extra], {
    encoding: "utf8",
    env: { ...(process.env as Record<string, string>), REELIER_SIGN_GRANT_DIST: distRoot },
  });
}

export interface Ran { readonly status: number | null; readonly stdout: string; readonly stderr: string }

/** The probe MUST run through async `spawn`, never `spawnSync`: the serve host under test lives in
 * THIS process, and `spawnSync` blocks its event loop, so the subprocess's authenticated fetch would
 * deadlock against a server that can never answer it. */
export async function probe(harness: Harness, port: number, extra: readonly string[] = [], grant = harness.grantFile): Promise<Ran> {
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
export async function serve(harness: Harness): Promise<Readonly<{ server: AuthorityHostServer; port: number }>> {
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
