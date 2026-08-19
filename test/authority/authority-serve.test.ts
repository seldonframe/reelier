import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { __testSetAuthorityServeRuntime, composeAuthorityServeHost, parseAuthorityServeMode, runAuthorityCommand, type AuthorityServeHostCompositionDependencies } from "../../src/authority/cli.js";
import { validateAuthorityHostConfig } from "../../src/authority/host/config.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import { createGitHubReleaseRunnerFromOperatorConfig, createReleaseAuthorizationResolver, parseGitHubReleaseRunnerOperatorConfig } from "../../src/authority/host/github-release-runner-config.js";
import { assertGitHubReleaseRunnerCapability } from "../../src/authority/host/github-release-runner.js";
import { assertVerifiedReleaseAuthorizationV1 } from "../../src/authority/release-contracts.js";
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

/** A REAL canonical ed25519 SPKI. The parser now resolves it with `createPublicKey`, so a
 * placeholder like "AA==" is no longer a usable positive fixture — it is a negative case below. */
const operatorSpkiBase64 = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64");

function validRunnerConfig() {
  return {
    v: "reelier.github-release-runner-config/v1",
    rootDir: path.resolve("/data/runner"),
    journalSignerId: "release-journal-2026",
    journalKeyFile: path.resolve("/data/keys/journal.pem"),
    evidenceSignerId: "release-provider-verifier",
    evidenceKeyFile: path.resolve("/data/keys/evidence.pem"),
    releaseAuthority: { signerId: "release-authority-2026", publicKeySpkiBase64: operatorSpkiBase64 },
    authorizationDir: path.resolve("/data/authorizations"),
    provider: { kind: "loopback-fixture", fixtureDir: path.resolve("/data/fixtures") },
  };
}

/** Every entry the walk creates, relative to `root`, sorted. Directories included. */
async function listTree(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    names.push(relative);
    if (entry.isDirectory()) names.push(...await listTree(root, relative));
  }
  return names.sort();
}

test("the release runner operator config parser is closed and absolute", () => {
  const valid = validRunnerConfig();
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
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, releaseAuthority: { signerId: "X", publicKeySpkiBase64: operatorSpkiBase64 } }), /signer/i);
  // Credential material never appears inline: only PEM key FILES and a PUBLIC SPKI reference.
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, journalPrivateKeyPem: "-----BEGIN PRIVATE KEY-----" }), /closed/i);
});

test("the release runner provider is a closed discriminated union with per-kind key sets", () => {
  const valid = validRunnerConfig();
  const fixtureDir = valid.provider.fixtureDir;
  // The loopback arm's key set is its OWN, so a field belonging to no arm is refused even when the
  // discriminant is recognized — this is what keeps Lane B's live arm from widening THIS arm.
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, provider: { kind: "loopback-fixture", fixtureDir, tokenRef: "env:GITHUB_TOKEN" } }), /loopback-fixture provider is not a closed record/i);
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, provider: { kind: "loopback-fixture" } }), /loopback-fixture provider is not a closed record/i);
  // The discriminant is read BEFORE the record is closed, so an unrecognized kind reports the kind
  // rather than the loopback arm's key set. `github-https` is now a REAL arm (Lane B landed), so an
  // unrecognized kind needs a kind no arm claims; the live arm is refused on its own key set
  // instead, which is the property this test exists to hold.
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, provider: { kind: "github-rest", tokenRef: "env:GITHUB_TOKEN" } }), /provider kind must be one of: loopback-fixture, github-https/);
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, provider: { kind: "github-https", tokenRef: "env:GITHUB_TOKEN" } }), /github-https provider is not a closed record/i);
  for (const provider of [null, [], "loopback-fixture", { fixtureDir }, Object.assign(Object.create(null), { kind: "loopback-fixture", fixtureDir })]) {
    assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, provider }), /release runner provider/i, JSON.stringify(provider));
  }
});

test("the release runner operator config refuses every shape that is not an exact closed record", () => {
  const valid = validRunnerConfig();
  // A MISSING key is the same refusal as an extra one — exact set equality in both directions.
  for (const key of Object.keys(valid)) {
    const { [key]: _removed, ...missing } = valid as Record<string, unknown>;
    assert.throws(() => parseGitHubReleaseRunnerOperatorConfig(missing), /operator config is not a closed record/i, key);
  }
  const { signerId: _signerId, ...missingAuthoritySigner } = valid.releaseAuthority;
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, releaseAuthority: missingAuthoritySigner }), /authorization authority is not a closed record/i);
  // JSON.parse materializes "__proto__" as an OWN enumerable key, so it is a refused key, never a
  // silently-ignored one — and it never reaches Object.prototype.
  const protoOwnKeysBeforeProbe = Object.getOwnPropertyNames(Object.prototype);
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig(JSON.parse('{"__proto__":{}}')), /operator config is not a closed record/i);
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, releaseAuthority: JSON.parse('{"__proto__":{}}') }), /authorization authority is not a closed record/i);
  // The previous assertion here checked for a "polluted" key that no payload above ever plants, so
  // it passed unconditionally. This compares Object.prototype's actual own-key set before and after
  // both "__proto__" payloads are parsed and refused, which fails if either call had actually
  // written through to the shared prototype.
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype), protoOwnKeysBeforeProbe, "parsing a JSON-parsed __proto__ payload must add no own key to Object.prototype");
  const shapes = [["null", null], ["undefined", undefined], ["empty array", []], ["array of configs", [valid]], ["string", "config"], ["number", 7], ["boolean", true], ["null-prototype record", Object.assign(Object.create(null), valid)]] as const;
  for (const [label, value] of shapes) assert.throws(() => parseGitHubReleaseRunnerOperatorConfig(value), /operator config is not a closed record/i, label);
});

test("the release authority public SPKI is resolved at parse time, not at first dispatch", () => {
  const valid = validRunnerConfig();
  const rsaSpki = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "der", type: "spki" }).toString("base64");
  for (const [label, publicKeySpkiBase64] of [
    ["empty", ""],
    ["one zero byte", "AA=="],
    // Decodes to the exact same DER, but is not the canonical encoding of it.
    ["unpadded base64", operatorSpkiBase64.replace(/=+$/, "")],
    ["not base64 at all", "-----BEGIN PUBLIC KEY-----"],
    ["truncated DER", operatorSpkiBase64.slice(0, 8)],
    ["wrong algorithm", rsaSpki],
  ] as const) {
    assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, releaseAuthority: { ...valid.releaseAuthority, publicKeySpkiBase64 } }), /public SPKI/i, label);
  }
  assert.equal(parseGitHubReleaseRunnerOperatorConfig(valid).releaseAuthority.publicKeySpkiBase64, operatorSpkiBase64);
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
    const before = await listTree(fixture.root);
    const result = await serveThroughDispatch(["authority", "serve", "--path", fixture.configFile, "--transport", "http", "--host", "127.0.0.1", "--port", "8080"], () => { started += 1; });
    assert.equal(result.code, 1);
    assert.equal(started, 0, "a refused start must never reach the host transport");
    assert.deepEqual(result.factoryCalls, [], "refusal precedes every runtime factory");
    assert.deepEqual(await listTree(fixture.root), before, "refusal precedes every filesystem side effect");
    const refusal = result.stderr.map(line => { try { return JSON.parse(line); } catch { return undefined; } }).find(value => value?.status === "refused");
    assert.equal(refusal?.reasonCode, "release-runner-config-required");
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("authority serve refuses an injected runner outside the exact four reviewed release definitions before any side effect", async () => {
  const fixture = await releaseServeFixture();
  try {
    const widened = await fixture.writeConfig("authority-widened.yml", { ...fixture.configBody, definitions: [...githubReleaseAliases, "gmail_reply_send_v1"] });
    let started = 0;
    const before = await listTree(fixture.root);
    // This is the case the factory-level guard (`local.ts:106`) used to be the ONLY thing deciding:
    // flag PRESENT + HTTP transport + definitions != the exact four. That guard fires only after the
    // runner is constructed (journal + rootDir) and both artifact keys are written, so a refusal here
    // used to leave a half-initialized Cell. It is decided pre-side-effect now, same as its sibling
    // above; the factory guard stays as defense in depth (still pinned directly in
    // local-multi-definition-jobs.test.ts).
    const result = await serveThroughDispatch(["authority", "serve", "--path", widened, "--transport", "http", "--host", "127.0.0.1", "--port", "8080", "--release-runner-config", fixture.runnerConfigFile], () => { started += 1; });
    assert.equal(result.code, 1);
    assert.equal(started, 0, "a refused start must never reach the host transport");
    assert.deepEqual(result.factoryCalls, [], "refusal precedes every runtime factory");
    assert.deepEqual(await listTree(fixture.root), before, "refusal precedes every filesystem side effect, including the runner journal and both artifact keys");
    const refusal = result.stderr.map(line => { try { return JSON.parse(line); } catch { return undefined; } }).find(value => value?.status === "refused");
    assert.equal(refusal?.reasonCode, "release-runner-config-mismatched-definitions");
    assert.match(refusal?.message ?? "", /four reviewed/i);
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

test("a config-constructed release runner is really built from the operator config, and still refuses its public surface", async () => {
  const fixture = await releaseServeFixture();
  const restore = __testSetAuthorityCellHostPlatform("linux");
  try {
    const config = parseGitHubReleaseRunnerOperatorConfig(JSON.parse(await readFile(fixture.runnerConfigFile, "utf8")));
    const runner = await createGitHubReleaseRunnerFromOperatorConfig(config, () => fixture.authorizationNow);
    // The two refusals below are the ONLY thing this test used to assert, and an inert stub
    // (`{ run: reject, recover: reject }`) satisfies both. These three assertions do not:
    //   1. the WeakMap brand is set only by `createGitHubReleaseRunner` in this process;
    //   2. the journal root is the config's `rootDir`, so the config reached the constructor;
    //   3. an unreadable `journalKeyFile` refuses, so the config's key FILES are really opened.
    assertGitHubReleaseRunnerCapability(runner);
    await access(path.join(config.rootDir, "journal"));
    await assert.rejects(() => createGitHubReleaseRunnerFromOperatorConfig({ ...config, journalKeyFile: path.join(config.rootDir, "absent.pem") }), /ENOENT|no such file/i);
    // The authorization resolver the constructed runner is wired to is pinned end to end by
    // "the release authorization resolver verifies a real signed bundle end to end" below.
    await assert.rejects(() => runner.run({ alias: "github_release_candidate_publish_v1", allocationId: "release-candidate-branch-01", authorizationHandle: fixture.authorizationHandle, requestId: "r", semanticsDigest: `sha256:${"1".repeat(64)}` }), /prepared-dispatch capability/);
    await assert.rejects(() => runner.recover(), /reconciliation capability/);
  } finally { restore(); await rm(fixture.root, { recursive: true, force: true }); }
});

test("the release runner constructor re-parses its argument instead of trusting a pre-built object", async () => {
  const fixture = await releaseServeFixture();
  const restore = __testSetAuthorityCellHostPlatform("linux");
  try {
    const config = parseGitHubReleaseRunnerOperatorConfig(JSON.parse(await readFile(fixture.runnerConfigFile, "utf8")));
    // Every field is valid and every key file is readable, so the ONLY thing that can refuse this
    // is the constructor re-running the closed parse on its own argument. Drop that re-parse and a
    // config carrying an unreviewed extra field constructs a live runner.
    await assert.rejects(() => createGitHubReleaseRunnerFromOperatorConfig({ ...config, extra: true } as never), /operator config is not a closed record/i);
    await assert.rejects(() => createGitHubReleaseRunnerFromOperatorConfig({ ...config, rootDir: "relative/runner" }), /absolute/i);
    await assert.rejects(() => createGitHubReleaseRunnerFromOperatorConfig({ ...config, releaseAuthority: { ...config.releaseAuthority, publicKeySpkiBase64: "AA==" } }), /public SPKI/i);
  } finally { restore(); await rm(fixture.root, { recursive: true, force: true }); }
});

test("the release authorization resolver verifies a real signed bundle end to end", async () => {
  const fixture = await releaseServeFixture();
  try {
    const config = parseGitHubReleaseRunnerOperatorConfig(JSON.parse(await readFile(fixture.runnerConfigFile, "utf8")));
    const resolve = createReleaseAuthorizationResolver(config, () => fixture.authorizationNow);
    const resolved = await resolve(fixture.authorizationHandle);
    // The brand is granted only by `verifyReleaseAuthorizationBundleV1` and cannot be
    // deserialized, so reaching it proves the four signed artifacts, the operator's verifier
    // descriptor, the clock, and the quality-evidence array all arrived in their correct slots.
    assertVerifiedReleaseAuthorizationV1(resolved.authorization);
    assert.equal(resolved.authorization.authorization.digest, fixture.authorizationDigest);
    assert.equal(resolved.authorization.authorization.signerId, config.releaseAuthority.signerId);
    assert.equal(resolved.authorization.authorization.value.operationPlanDigest, resolved.authorization.operationPlan.digest);
    assert.equal(resolved.authorization.authorization.value.policyDigest, resolved.authorization.policy.digest);
    assert.equal(resolved.authorization.authorization.value.stagedCandidateManifestDigest, resolved.authorization.candidateManifest.digest);
    assert.deepEqual(resolved.fileContents, []);
    assert.equal(Object.isFrozen(resolved), true);

    const body = fixture.authorizationBundleBody;
    // …and these are the falsifiers for "arrived in their correct slots".
    await fixture.writeAuthorizationBundle("swapped-plan-policy", { ...body, operationPlan: body.policy, policy: body.operationPlan });
    await assert.rejects(() => resolve("swapped-plan-policy"), /release/i);
    await fixture.writeAuthorizationBundle("dropped-evidence", { ...body, evidence: [] });
    await assert.rejects(() => resolve("dropped-evidence"), /evidence/i);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("the release authorization resolver refuses a wrong signer, an unclosed bundle, and an escaping handle", async () => {
  const fixture = await releaseServeFixture();
  try {
    const config = parseGitHubReleaseRunnerOperatorConfig(JSON.parse(await readFile(fixture.runnerConfigFile, "utf8")));
    const resolve = createReleaseAuthorizationResolver(config, () => fixture.authorizationNow);
    // Same artifact shapes, every one re-signed by a foreign key under the SAME signerId.
    await assert.rejects(() => resolve(fixture.wrongSignerHandle), /signature is invalid/i);
    await fixture.writeAuthorizationBundle("extra-key", { ...fixture.authorizationBundleBody, extra: true });
    await assert.rejects(() => resolve("extra-key"), /authorization bundle is not a closed record/i);
    const { fileContents: _fileContents, ...missingFileContents } = fixture.authorizationBundleBody;
    await fixture.writeAuthorizationBundle("missing-key", missingFileContents);
    await assert.rejects(() => resolve("missing-key"), /authorization bundle is not a closed record/i);
    // The handle is checked before it ever reaches `path.join`, so a real readable file one
    // directory up is still unreachable.
    await writeFile(path.join(fixture.authorizationDir, "..", "escape.json"), `${JSON.stringify(fixture.authorizationBundleBody)}\n`);
    await assert.rejects(() => resolve("../escape"), /authorization handle is invalid/i);
    for (const handle of ["", ".", "..", "a/b", "a\\b", "-leading", "x".repeat(129)]) {
      await assert.rejects(() => resolve(handle), /authorization handle is invalid/i, JSON.stringify(handle));
    }
    // An expired-window clock refuses even the genuine bundle: the verifier's clock is the config's.
    await assert.rejects(() => createReleaseAuthorizationResolver(config, () => new Date("2027-01-01T00:00:00.000Z"))(fixture.authorizationHandle), /expired/i);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("a pre-side-effect release-runner refusal creates no keys, journals, or state directories", async () => {
  const fixture = await releaseServeFixture();
  try {
    const before = await listTree(fixture.root);
    await assert.rejects(() => serveThroughDispatch(["authority", "serve", "--path", fixture.configFile, "--release-runner-config", fixture.runnerConfigFile]), /HTTP transport/);
    // The transport and the flag are both known before anything is constructed. A refusal that has
    // already minted artifact keys and a runner journal leaves the operator a half-initialized Cell.
    assert.deepEqual(await listTree(fixture.root), before, "the stdio+runner refusal must precede every filesystem side effect");
    const widened = await fixture.writeConfig("authority-widened.yml", { ...fixture.configBody, definitions: ["gmail_reply_send_v1"] });
    const afterWiden = await listTree(fixture.root);
    await assert.rejects(() => serveThroughDispatch(["authority", "serve", "--path", widened, "--release-runner-config", fixture.runnerConfigFile]), /HTTP transport/);
    assert.deepEqual(await listTree(fixture.root), afterWiden, "the refusal does not depend on the definition set");
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
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
