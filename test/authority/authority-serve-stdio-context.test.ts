import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFilePrincipalRegistry, createPrincipalRegistry, type PrincipalRegistry } from "../../src/authority/host/principal-registry.js";
import { composeAuthorityServeStdioRuntime, resolveAuthorityServeStdioExecutionContext, validatePrivateStdioCredentialFileMetadata } from "../../src/authority/host/stdio-context.js";
import { validateAuthorityHostConfig } from "../../src/authority/host/config.js";
import { __testSetAuthorityServeRuntime, composeAuthorityServeHost, runAuthorityCommand } from "../../src/authority/cli.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";

const digest = `sha256:${"a".repeat(64)}`;
const base = { version: 1 as const, tenant: "tenant_1", requester: "agent_1", authorityCellId: "cell_1", definitions: ["gmail_reply_send_v1", "slack_channel_topic_set_v1"], ledgerDir: "ledger", decisionDir: "decisions", receiptDir: "receipts", endpoints: [] };

test("authority serve config accepts only a referenced stdio principal credential paired with its registry", () => {
  const parsed = validateAuthorityHostConfig({ ...base, ingress: { principalRegistryFile: "principal.jsonl", stdioPrincipalCredentialRef: "env:REELIER_STDIO_PRINCIPAL" } });
  assert.equal(parsed.ingress?.stdioPrincipalCredentialRef, "env:REELIER_STDIO_PRINCIPAL");
  assert.match(parsed.ingress!.principalRegistryFile!, /principal\.jsonl$/);
  assert.throws(() => validateAuthorityHostConfig({ ...base, ingress: { stdioPrincipalCredentialRef: "env:REELIER_STDIO_PRINCIPAL" } }), /principal registry|stdio/i);
  assert.throws(() => validateAuthorityHostConfig({ ...base, ingress: { principalRegistryFile: "principal.jsonl", stdioPrincipalCredentialRef: "rat_raw_token" } }), /reference|stdio/i);
  assert.throws(() => validateAuthorityHostConfig({ ...base, ingress: { principalRegistryFile: "principal.jsonl", stdioPrincipalCredentialRef: "file:relative.token" } }), /reference|stdio/i);
});

test("authority serve resolves a short-lived stdio principal before server construction and refuses identity drift", async () => {
  const registry = createPrincipalRegistry({ tenant: "tenant_1" });
  const issued = await registry.issue({ principalId: "agent_1", taskId: "task_1", grantId: "grant_1", grantDigest: digest, allocationId: "root", runtimeSessionId: "session_1", jobId: "production_release", authorityCellId: "cell_1", expiresAt: "2099-01-01T00:00:00.000Z" });
  const config = validateAuthorityHostConfig({ ...base, ingress: { principalRegistryFile: "principal.jsonl", stdioPrincipalCredentialRef: "env:REELIER_STDIO_PRINCIPAL" } });
  const resolved = await resolveAuthorityServeStdioExecutionContext(config, registry, { env: { REELIER_STDIO_PRINCIPAL: issued.token } });
  assert.deepEqual(resolved, { v: "reelier.authority-execution-context/v1", taskId: "task_1", principalId: "agent_1", grantId: "grant_1", grantDigest: digest, allocationId: "root", runtimeSessionId: "session_1", jobId: "production_release", authorityCellId: "cell_1" });
  assert.equal(JSON.stringify(resolved).includes(issued.token), false);
  const credentialRoot = await mkdtemp(path.join(os.tmpdir(), "reelier-stdio-principal-"));
  try {
    const credentialFile = path.join(credentialRoot, "principal.token");
    await writeFile(credentialFile, `${issued.token}\n`, { mode: 0o600 });
    const fileConfig = validateAuthorityHostConfig({ ...base, ingress: { principalRegistryFile: "principal.jsonl", stdioPrincipalCredentialRef: `file:${credentialFile}` } });
    assert.deepEqual(await resolveAuthorityServeStdioExecutionContext(fileConfig, registry), resolved);
  } finally { await rm(credentialRoot, { recursive: true, force: true }); }

  const context = issued.context;
  const registryReturning = (patch: Partial<typeof context>): PrincipalRegistry => ({
    async resolve() { return { ...context, ...patch }; },
    async issue() { throw new Error("unused"); }, async revoke() {}, async revokeTask() {},
  });
  for (const patch of [{ tenant: "tenant_other" }, { principalId: "agent_other" }, { authorityCellId: "cell_other" }]) {
    await assert.rejects(() => resolveAuthorityServeStdioExecutionContext(config, registryReturning(patch), { env: { REELIER_STDIO_PRINCIPAL: issued.token } }), /identity|tenant|requester|cell/i);
  }
  await assert.rejects(() => resolveAuthorityServeStdioExecutionContext(config, registry, { env: {} }), /credential|unavailable|missing/i);
  await registry.revoke(issued.context.sessionTokenDigest);
  await assert.rejects(() => resolveAuthorityServeStdioExecutionContext(config, registry, { env: { REELIER_STDIO_PRINCIPAL: issued.token } }), /credential|revoked|principal/i);

  const expiredRegistry = createPrincipalRegistry({ tenant: "tenant_1" });
  const expired = await expiredRegistry.issue({ ...issued.context, expiresAt: "2020-01-01T00:00:00.000Z", runtimeSessionId: "session_expired" });
  await assert.rejects(() => resolveAuthorityServeStdioExecutionContext(config, expiredRegistry, { env: { REELIER_STDIO_PRINCIPAL: expired.token } }), /credential|expired|principal/i);
});

test("stdio credential files accept exact token bytes with at most one terminal LF or CRLF", async () => {
  const credentialRoot = await mkdtemp(path.join(os.tmpdir(), "reelier-stdio-principal-bytes-"));
  const context = { tenant: "tenant_1", principalId: "agent_1", taskId: "task_1", grantId: "grant_1", grantDigest: digest, allocationId: "root", runtimeSessionId: "session_1", jobId: "production_release", authorityCellId: "cell_1", expiresAt: "2099-01-01T00:00:00.000Z", sessionTokenDigest: digest };
  let observedToken = "";
  const registry: PrincipalRegistry = {
    async resolve(token) { observedToken = token; return context; },
    async issue() { throw new Error("unused"); }, async revoke() {}, async revokeTask() {},
  };
  try {
    const credentialFile = path.join(credentialRoot, "principal.token");
    const config = validateAuthorityHostConfig({ ...base, ingress: { principalRegistryFile: "principal.jsonl", stdioPrincipalCredentialRef: `file:${credentialFile}` } });
    for (const contents of ["rat_exact", "rat_exact\n", "rat_exact\r\n"]) {
      observedToken = "";
      await writeFile(credentialFile, contents, { mode: 0o600 });
      await resolveAuthorityServeStdioExecutionContext(config, registry);
      assert.equal(observedToken, "rat_exact");
    }
    for (const contents of [" rat_exact", "rat_exact ", "rat_exact\n\n", "rat_exact\r\n\r\n", "rat_\nexact", "rat_exact\0"]) {
      await writeFile(credentialFile, contents, { mode: 0o600 });
      await assert.rejects(() => resolveAuthorityServeStdioExecutionContext(config, registry), /credential|unavailable/i, JSON.stringify(contents));
    }
  } finally { await rm(credentialRoot, { recursive: true, force: true }); }
});

test("stdio credential resolver rejects an actual group-readable file on Linux", { skip: process.platform !== "linux" }, async () => {
  const credentialRoot = await mkdtemp(path.join(os.tmpdir(), "reelier-stdio-principal-mode-"));
  try {
    const credentialFile = path.join(credentialRoot, "principal.token");
    await writeFile(credentialFile, "rat_exact", { mode: 0o600 });
    await chmod(credentialFile, 0o640);
    const config = validateAuthorityHostConfig({ ...base, ingress: { principalRegistryFile: "principal.jsonl", stdioPrincipalCredentialRef: `file:${credentialFile}` } });
    await assert.rejects(() => resolveAuthorityServeStdioExecutionContext(config, {} as PrincipalRegistry), /credential|unavailable/i);
  } finally { await rm(credentialRoot, { recursive: true, force: true }); }
});

test("authority serve production composition passes only the resolved context into runtime construction", async () => {
  const registry = createPrincipalRegistry({ tenant: "tenant_1" });
  const issued = await registry.issue({ principalId: "agent_1", taskId: "task_1", grantId: "grant_1", grantDigest: digest, allocationId: "root", runtimeSessionId: "session_1", jobId: "production_release", authorityCellId: "cell_1", expiresAt: "2099-01-01T00:00:00.000Z" });
  const config = validateAuthorityHostConfig({ ...base, ingress: { principalRegistryFile: "principal.jsonl", stdioPrincipalCredentialRef: "env:REELIER_STDIO_PRINCIPAL" } });
  let captured: unknown;
  const composed = await composeAuthorityServeStdioRuntime(config, registry, async context => { captured = context; return { requiresAuthenticatedExecutionContext: true }; }, { env: { REELIER_STDIO_PRINCIPAL: issued.token } });
  assert.deepEqual(captured, composed.executionContext);
  assert.equal(composed.runtime.requiresAuthenticatedExecutionContext, true);
  const missing = validateAuthorityHostConfig({ ...base, ingress: { principalRegistryFile: "principal.jsonl" } });
  await assert.rejects(() => composeAuthorityServeStdioRuntime(missing, registry, async () => ({ requiresAuthenticatedExecutionContext: true })), /authenticated principal|credential/i);
});

test("stdio credential file metadata requires the effective host owner and private mode", () => {
  assert.doesNotThrow(() => validatePrivateStdioCredentialFileMetadata({ uid: 1001, mode: 0o100600 }, 1001));
  assert.throws(() => validatePrivateStdioCredentialFileMetadata({ uid: 1002, mode: 0o100600 }, 1001), /owner|uid|private/i);
  for (const permission of [0o040, 0o020, 0o010, 0o004, 0o002, 0o001]) {
    assert.throws(() => validatePrivateStdioCredentialFileMetadata({ uid: 1001, mode: 0o100600 | permission }, 1001), /permission|private|mode/i);
  }
});

test("authority serve host composition binds stdio resolver, bound runtime, and host server without starting stdio", async () => {
  const config = validateAuthorityHostConfig({ ...base, ingress: { principalRegistryFile: "principal.jsonl", stdioPrincipalCredentialRef: "env:REELIER_STDIO_PRINCIPAL" } });
  const executionContext = { v: "reelier.authority-execution-context/v1" as const, taskId: "task_1", principalId: "agent_1", grantId: "grant_1", grantDigest: digest, allocationId: "root", runtimeSessionId: "session_1", jobId: "production_release", authorityCellId: "cell_1" };
  const calls: string[] = [];
  const server = { marker: "server" };
  const result = await composeAuthorityServeHost(config, "stdio", {} as PrincipalRegistry, {}, undefined, {
    async composeStdio(_config, _registry, createRuntime) { calls.push("compose"); return { executionContext, runtime: await createRuntime(executionContext) }; },
    async createStdioBoundRuntime(_config, context) { calls.push("bound-runtime"); assert.deepEqual(context, executionContext); return { outcome: async () => ({ requestId: "", verdict: "refused" as const, reasonCode: "unused", lifecycleState: "refused" }), status: async () => ({ requestId: "", verdict: "refused" as const, reasonCode: "unused", lifecycleState: "refused" }) } as never; },
    async createLocalRuntime() { calls.push("unbound-runtime"); throw new Error("must not use unbound runtime"); },
    createHostServer(_config, _runtime, options) { calls.push("host-server"); assert.deepEqual(options?.stdioExecutionContext, executionContext); return server as never; },
  });
  assert.equal(result, server);
  assert.deepEqual(calls, ["compose", "bound-runtime", "host-server"]);
});

test("authority serve command dispatch uses production host composition with the resolved stdio context", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-authority-serve-dispatch-"));
  const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
  try {
    const registryFile = path.join(root, "principal.jsonl");
    const credentialFile = path.join(root, "principal.token");
    const configFile = path.join(root, "authority.json");
    const registry = createFilePrincipalRegistry({ tenant: "tenant_1", file: registryFile });
    const issued = await registry.issue({ principalId: "agent_1", taskId: "task_1", grantId: "grant_1", grantDigest: digest, allocationId: "root", runtimeSessionId: "session_1", jobId: "production_release", authorityCellId: "cell_1", expiresAt: "2099-01-01T00:00:00.000Z" });
    const executionContext = { v: "reelier.authority-execution-context/v1" as const, taskId: "task_1", principalId: "agent_1", grantId: "grant_1", grantDigest: digest, allocationId: "root", runtimeSessionId: "session_1", jobId: "production_release", authorityCellId: "cell_1" };
    await writeFile(credentialFile, `${issued.token}\n`, { mode: 0o600 });
    await writeFile(configFile, JSON.stringify({ ...base, ledgerDir: "ledger", decisionDir: "decisions", receiptDir: "receipts", gateKeyFile: "keys/local-gate.pem", ingress: { principalRegistryFile: registryFile, stdioPrincipalCredentialRef: `file:${credentialFile}` } }), { mode: 0o600 });

    const calls: string[] = [];
    const server = { async startStdio() { throw new Error("stdio must not start"); }, async startHttp() { throw new Error("HTTP must not start"); } };
    const restoreRuntime = __testSetAuthorityServeRuntime({
      hostCompositionDependencies: {
        composeStdio: composeAuthorityServeStdioRuntime,
        async createStdioBoundRuntime(_config, context) { calls.push("bound-runtime"); assert.deepEqual(context, executionContext); return { outcome: async () => ({ requestId: "", verdict: "refused" as const, reasonCode: "unused", lifecycleState: "refused" }), status: async () => ({ requestId: "", verdict: "refused" as const, reasonCode: "unused", lifecycleState: "refused" }) } as never; },
        async createLocalRuntime() { calls.push("unbound-runtime"); throw new Error("must not use unbound runtime"); },
        createHostServer(_config, _runtime, options) { calls.push("host-server"); assert.deepEqual(options?.stdioExecutionContext, executionContext); return server as never; },
      },
      async startHost(composed, mode) { calls.push("no-start"); assert.equal(composed, server); assert.deepEqual(mode, { transport: "stdio" }); },
    });
    try {
      assert.equal(await runAuthorityCommand({ positional: ["serve"], flags: new Set(), opts: { path: configFile } }), 0);
      assert.deepEqual(calls, ["bound-runtime", "host-server", "no-start"]);
    } finally { restoreRuntime(); }
  } finally { restorePlatform(); await rm(root, { recursive: true, force: true }); }
});
