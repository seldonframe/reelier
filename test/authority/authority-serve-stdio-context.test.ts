import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPrincipalRegistry, type PrincipalRegistry } from "../../src/authority/host/principal-registry.js";
import { composeAuthorityServeStdioRuntime, resolveAuthorityServeStdioExecutionContext, validatePrivateStdioCredentialFileMetadata } from "../../src/authority/host/stdio-context.js";
import { validateAuthorityHostConfig } from "../../src/authority/host/config.js";
import { composeAuthorityServeHost } from "../../src/authority/cli.js";

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
    createHostServer(_config, _runtime, options) { calls.push("host-server"); assert.deepEqual(options.stdioExecutionContext, executionContext); return server as never; },
  });
  assert.equal(result, server);
  assert.deepEqual(calls, ["compose", "bound-runtime", "host-server"]);
});
