import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { __testSetAuthorityServeRuntime, composeAuthorityServeHost, parseAuthorityServeMode, runAuthorityCommand, type AuthorityServeHostCompositionDependencies } from "../../src/authority/cli.js";
import { validateAuthorityHostConfig } from "../../src/authority/host/config.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import { createGitHubReleaseRunnerFromOperatorConfig, parseGitHubReleaseRunnerOperatorConfig } from "../../src/authority/host/github-release-runner-config.js";
import { composeAuthorityServeStdioRuntime } from "../../src/authority/host/stdio-context.js";
import { createGitHubReleaseAuthorityRuntime, createLocalAuthorityRuntime, createStdioBoundLocalAuthorityRuntime } from "../../src/authority/host/local.js";
import { createAuthorityHostServer } from "../../src/authority/host/server.js";
import { githubReleaseAliases } from "../../src/packs/github-release/manifest.js";
import { releaseServeFixture } from "./github-release-serve-fixture.js";
import { parseArgv } from "../../src/cli.js";

/** The real production composition seam. Every factory is the real one, so every guard in
 * `createGitHubReleaseAuthorityRuntime` runs on the PUBLIC `authority serve` dispatch path; the
 * wrappers only record WHICH factory the composition selected, which is what separates
 * "the runner was injected" from "the runner was silently dropped". Only `startHost` is stubbed. */
function observedServeDependencies(factoryCalls: string[]): AuthorityServeHostCompositionDependencies {
  return {
    composeStdio: (config, registry, createRuntime) => { factoryCalls.push("stdio"); return composeAuthorityServeStdioRuntime(config, registry, createRuntime); },
    createStdioBoundRuntime: (config, executionContext, options) => { factoryCalls.push("stdio-bound-runtime"); return createStdioBoundLocalAuthorityRuntime(config, executionContext, options); },
    createLocalRuntime: (config, options) => { factoryCalls.push("local-runtime"); return createLocalAuthorityRuntime(config, options); },
    createGitHubReleaseRuntime: (config, runner, options) => { factoryCalls.push("release-runtime"); return createGitHubReleaseAuthorityRuntime(config, runner, options); },
    createHostServer: (config, runtime, options) => { factoryCalls.push("host-server"); return createAuthorityHostServer(config, runtime, options); },
  };
}

/** Mirrors `main()` in src/cli.ts: the command word is consumed before `parseArgv`, so
 * `runAuthorityCommand` receives the subcommand at positional[0]. */
async function serveThroughDispatch(argv: readonly string[], onStart?: () => void): Promise<Readonly<{ code: number; stderr: string[]; factoryCalls: string[] }>> {
  assert.equal(argv[0], "authority", "the dispatch helper must mirror the real root command word");
  const factoryCalls: string[] = [];
  const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
  const restoreRuntime = __testSetAuthorityServeRuntime({ hostCompositionDependencies: observedServeDependencies(factoryCalls), async startHost() { onStart?.(); } });
  const stderr: string[] = [];
  const previousError = console.error;
  console.error = (...values: unknown[]) => { stderr.push(values.map(value => String(value)).join(" ")); };
  try {
    const code = await runAuthorityCommand(parseArgv([...argv].slice(1)));
    return Object.freeze({ code, stderr, factoryCalls });
  } finally {
    console.error = previousError;
    restoreRuntime();
    restorePlatform();
  }
}

test("authority serve defaults to stdio and accepts an explicit authenticated HTTP bind", () => {
  assert.deepEqual(parseAuthorityServeMode({}), { transport: "stdio" });
  assert.deepEqual(parseAuthorityServeMode({ transport: "http", host: "0.0.0.0", port: "8080" }), {
    transport: "http",
    host: "0.0.0.0",
    port: 8080,
  });
});

test("authority serve refuses ambiguous transports, ports, and bind hosts", () => {
  assert.throws(() => parseAuthorityServeMode({ transport: "sse" }), /transport/);
  assert.throws(() => parseAuthorityServeMode({ transport: "http", port: "0" }), /port/);
  assert.throws(() => parseAuthorityServeMode({ transport: "http", port: "8080x" }), /port/);
  assert.throws(() => parseAuthorityServeMode({ transport: "http", host: "0.0.0.0\nattacker" }), /host/);
  assert.throws(() => parseAuthorityServeMode({ transport: "stdio", port: "8080" }), /stdio/);
});

test("the release runner operator config parser is closed and absolute", () => {
  const valid = {
    v: "reelier.github-release-runner-config/v1",
    rootDir: path.resolve("/data/runner"),
    journalSignerId: "release-journal-2026",
    journalKeyFile: path.resolve("/data/keys/journal.pem"),
    evidenceSignerId: "release-provider-verifier",
    evidenceKeyFile: path.resolve("/data/keys/evidence.pem"),
    releaseAuthority: { signerId: "release-authority-2026", publicKeySpkiBase64: "AA==" },
    authorizationDir: path.resolve("/data/authorizations"),
    provider: { kind: "loopback-fixture", fixtureDir: path.resolve("/data/fixtures") },
  };
  assert.deepEqual(parseGitHubReleaseRunnerOperatorConfig(valid), valid);
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, extra: true }), /closed/i);
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, v: "reelier.github-release-runner-config/v2" }), /closed/i);
  for (const key of ["rootDir", "journalKeyFile", "evidenceKeyFile", "authorizationDir"] as const) {
    assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, [key]: "relative/path" }), /absolute/i, key);
  }
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, provider: { kind: "loopback-fixture", fixtureDir: "relative/fixtures" } }), /absolute/i);
  // Lane B widens this enum with a live `github-https` kind. Until it lands, an unknown kind is a refusal.
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, provider: { kind: "github-https", fixtureDir: valid.provider.fixtureDir } }), /provider/i);
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, journalSignerId: "X" }), /signer/i);
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, evidenceSignerId: "X" }), /signer/i);
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, releaseAuthority: { signerId: "X", publicKeySpkiBase64: "AA==" } }), /signer/i);
  // Credential material never appears inline: only PEM key FILES and a PUBLIC SPKI reference.
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, journalPrivateKeyPem: "-----BEGIN PRIVATE KEY-----" }), /closed/i);
});

test("authority serve routes the explicit host-owned release runner to the production release factory", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const runner = Object.freeze({ run: async () => { throw new Error("not public"); }, recover: async () => [] });
  const config = { version: 1 as const, tenant: "tenant_1", requester: "agent_1", definitions: [...githubReleaseAliases], ledgerDir: "ledger", decisionDir: "decisions", receiptDir: "receipts", endpoints: [] };
  const runtime = { directOutcomeAliases: [], requiresAuthenticatedExecutionContext: false, async outcome() { return { verdict: "refused", reasonCode: "unused" }; }, async status() { return {}; } } as any;
  let received: unknown;
  let receivedOptions: Record<string, unknown> | undefined;
  let localCalls = 0;
  try {
    await composeAuthorityServeHost(config, "http", undefined, {}, runner as never, undefined, {
      async composeStdio() { throw new Error("stdio must not be selected"); },
      async createStdioBoundRuntime() { throw new Error("stdio must not be selected"); },
      async createLocalRuntime() { localCalls += 1; return runtime; },
      async createGitHubReleaseRuntime(_config, explicitRunner, options) { received = explicitRunner; receivedOptions = options as Record<string, unknown>; return runtime; },
      createHostServer(_config, host) { assert.equal(host.outcome, runtime.outcome); return { mcp: {} } as never; },
    });
    assert.equal(received, runner, "the runner is the explicit composition parameter, never an options key");
    assert.equal(Object.prototype.hasOwnProperty.call(receivedOptions ?? {}, "githubReleaseRunner"), false);
    assert.equal(localCalls, 0, "a release host must never fall through to the unbound local runtime");
    await assert.rejects(() => composeAuthorityServeHost(config, "stdio", undefined, {}, runner as never, undefined, {
      async composeStdio() { throw new Error("unreachable"); },
      async createStdioBoundRuntime() { throw new Error("unreachable"); },
      async createLocalRuntime() { return runtime; },
      async createGitHubReleaseRuntime() { return runtime; },
      createHostServer() { return { mcp: {} } as never; },
    }), /HTTP transport/);
  } finally { restore(); }
});

test("authority serve refuses the four reviewed release definitions without a constructible runner", async () => {
  const fixture = await releaseServeFixture();
  try {
    let started = 0;
    const result = await serveThroughDispatch(["authority", "serve", "--path", fixture.configFile, "--transport", "http", "--host", "127.0.0.1", "--port", "8080"], () => { started += 1; });
    assert.equal(result.code, 1);
    assert.equal(started, 0, "a refused start must never reach the host transport");
    assert.deepEqual(result.factoryCalls, [], "refusal precedes every runtime factory");
    const refusal = result.stderr.map(line => { try { return JSON.parse(line); } catch { return undefined; } }).find(value => value?.status === "refused");
    assert.equal(refusal?.reasonCode, "release-runner-config-required");
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("authority serve refuses an injected runner outside the exact four reviewed release definitions", async () => {
  const fixture = await releaseServeFixture();
  try {
    const widened = await fixture.writeConfig("authority-widened.yml", { ...fixture.configBody, definitions: [...githubReleaseAliases, "gmail_reply_send_v1"] });
    await assert.rejects(() => serveThroughDispatch(["authority", "serve", "--path", widened, "--transport", "http", "--host", "127.0.0.1", "--port", "8080", "--release-runner-config", fixture.runnerConfigFile]), /four reviewed/i);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("authority serve refuses an injected runner without a signed deployment and external trust pin", async () => {
  const fixture = await releaseServeFixture();
  try {
    const { deploymentPath: _deploymentPath, jobCardTrustPinPath: _jobCardTrustPinPath, ...unsigned } = fixture.configBody;
    const unsignedFile = await fixture.writeConfig("authority-unsigned.yml", unsigned);
    await assert.rejects(() => serveThroughDispatch(["authority", "serve", "--path", unsignedFile, "--transport", "http", "--host", "127.0.0.1", "--port", "8080", "--release-runner-config", fixture.runnerConfigFile]), /signed deployment|trust pin/i);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("authority serve refuses the release runner on the stdio transport", async () => {
  const fixture = await releaseServeFixture();
  try {
    await assert.rejects(() => serveThroughDispatch(["authority", "serve", "--path", fixture.configFile, "--release-runner-config", fixture.runnerConfigFile]), /HTTP transport/);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("authority serve starts the authenticated HTTP host with the constructed release runner", async () => {
  const fixture = await releaseServeFixture();
  try {
    let started = 0;
    const result = await serveThroughDispatch(["authority", "serve", "--path", fixture.configFile, "--transport", "http", "--host", "127.0.0.1", "--port", "8080", "--release-runner-config", fixture.runnerConfigFile], () => { started += 1; });
    assert.equal(result.code, 0);
    assert.equal(started, 1);
    // The load-bearing assertion: the release factory ran and the unbound local runtime never did.
    // Without it this test would also pass if composition silently dropped the runner.
    assert.deepEqual(result.factoryCalls, ["release-runtime", "host-server"]);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("a config-constructed release runner still refuses its public surface", async () => {
  const fixture = await releaseServeFixture();
  const restore = __testSetAuthorityCellHostPlatform("linux");
  try {
    const runner = await createGitHubReleaseRunnerFromOperatorConfig(parseGitHubReleaseRunnerOperatorConfig(JSON.parse(await readFile(fixture.runnerConfigFile, "utf8"))));
    await assert.rejects(() => runner.run({ alias: "github_release_candidate_publish_v1", allocationId: "release-candidate-branch-01", authorizationHandle: "h", requestId: "r", semanticsDigest: `sha256:${"1".repeat(64)}` }), /prepared-dispatch capability/);
    await assert.rejects(() => runner.recover(), /reconciliation capability/);
  } finally { restore(); await rm(fixture.root, { recursive: true, force: true }); }
});

test("the Fly Authority Cell starts the authenticated HTTP transport with durable state", async () => {
  const manifest = await readFile(path.resolve("infra/fly/authority-cell/authority-cell.toml"), "utf8");
  assert.match(manifest, /authority serve --transport http --host 0\.0\.0\.0 --port 8080/);
  assert.match(manifest, /destination = "\/data"/);
  assert.doesNotMatch(manifest, /(?:TOKEN|PASSWORD|SECRET)\s*=\s*"[^\"]+"/i);
});

test("the Fly Authority Cell bootstrap initializes through the image entrypoint without exposing HTTP", async () => {
  const manifest = await readFile(path.resolve("infra/fly/authority-cell/authority-cell-bootstrap.toml"), "utf8");
  assert.match(manifest, /app = "authority bootstrap --path \/data\/authority"/);
  assert.doesNotMatch(manifest, /\/bin\/sh|http_service|authority serve/);
  assert.match(manifest, /destination = "\/data"/);
});

test("authority bootstrap remains alive after initialization until it receives a shutdown signal", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-authority-bootstrap-"));
  const child = spawn(process.execPath, [path.resolve("dist-test/src/cli.js"), "authority", "bootstrap", "--path", root], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("authority bootstrap did not become ready")), 5_000);
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        if (!chunk.includes('"service":"authority-bootstrap"')) return;
        clearTimeout(timer);
        resolve();
      });
      child.once("error", reject);
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(child.exitCode, null);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once("exit", resolve));
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("every Fly certification manifest resolves the repository Dockerfile from its own directory", async () => {
  for (const name of ["authority-cell-bootstrap", "authority-cell", "agent-runtime", "egress-gateway"]) {
    const manifest = await readFile(path.resolve(`infra/fly/authority-cell/${name}.toml`), "utf8");
    assert.match(manifest, /dockerfile = "\.\.\/\.\.\/\.\.\/Dockerfile"/, `${name} must not resolve a nonexistent adjacent Dockerfile`);
  }
});

test("every Fly certification file mount resolves from the repository deploy context", async () => {
  for (const name of ["authority-cell-bootstrap", "authority-cell", "agent-runtime", "egress-gateway"]) {
    const manifest = await readFile(path.resolve(`infra/fly/authority-cell/${name}.toml`), "utf8");
    const localPaths = [...manifest.matchAll(/local_path = "([^"]+)"/g)].map(match => match[1]);
    assert.ok(localPaths.length > 0, `${name} must mount its probe manifest`);
    for (const localPath of localPaths) await access(path.resolve(localPath));
  }
});

test("the root CLI preserves authority HTTP and certification options as values", () => {
  const parsed = parseArgv(["serve", "--transport", "http", "--host", "0.0.0.0", "--port", "8080", "--certification-config", "/data/authority/certification.local.json", "--release-runner-config", "/data/authority/release-runner.json"]);
  assert.deepEqual(parsed.positional, ["serve"]);
  assert.equal(parsed.opts.transport, "http");
  assert.equal(parsed.opts.host, "0.0.0.0");
  assert.equal(parsed.opts.port, "8080");
  assert.equal(parsed.opts["certification-config"], "/data/authority/certification.local.json");
  assert.equal(parsed.opts["release-runner-config"], "/data/authority/release-runner.json");
});

test("the root CLI treats certification config as a value option", () => {
  const parsed = parseArgv(["authority", "certify", "preflight", "--config", "authority/certification.local.json"]);
  assert.deepEqual(parsed.positional, ["authority", "certify", "preflight"]);
  assert.equal(parsed.opts.config, "authority/certification.local.json");
});

test("authority ingress accepts one durable principal registry and refuses mixed authentication", () => {
  const base = { version: 1 as const, tenant: "tenant_1", requester: "operator", definitions: [], ledgerDir: "ledger", decisionDir: "decisions", receiptDir: "receipts", endpoints: [] };
  const config = validateAuthorityHostConfig({ ...base, ingress: { principalRegistryFile: "principals.jsonl" } }, "C:/authority");
  assert.match(config.ingress?.principalRegistryFile ?? "", /principals\.jsonl$/);
  assert.throws(() => validateAuthorityHostConfig({ ...base, ingress: { principalRegistryFile: "principals.jsonl", bearerRef: "env:TOKEN" } }, "C:/authority"), /mutually exclusive/);
  assert.throws(() => validateAuthorityHostConfig({ ...base, ingress: { principalRegistryFile: "principals.jsonl", extra: true } }, "C:/authority"), /closed/);
});
