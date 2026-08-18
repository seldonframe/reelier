import test from "node:test";
import assert from "node:assert/strict";
import { createPrincipalRegistry, type PrincipalRegistry } from "../../src/authority/host/principal-registry.js";
import { resolveAuthorityServeStdioExecutionContext } from "../../src/authority/host/stdio-context.js";
import { validateAuthorityHostConfig } from "../../src/authority/host/config.js";

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
