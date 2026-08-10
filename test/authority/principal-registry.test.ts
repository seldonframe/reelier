import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFilePrincipalRegistry, createPrincipalRegistry } from "../../src/authority/host/principal-registry.js";

test("principal registry resolves a scoped token without exposing its value", async () => {
  const registry = createPrincipalRegistry({ tenant: "tenant_1" });
  const issued = await registry.issue({
    principalId: "agent_release",
    taskId: "task_1",
    grantId: "grant_release",
    grantDigest: "sha256:" + "1".repeat(64),
    allocationId: "grant_release",
    runtimeSessionId: "session_1",
    jobId: "job_release",
    authorityCellId: "cell_1",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });

  assert.match(issued.token, /^rat_/);
  assert.equal("token" in issued.context, false);
  assert.deepEqual(await registry.resolve(issued.token, new Date("2026-08-10T00:00:00.000Z")), issued.context);
});

test("principal registry refuses wrong tenant, expiry, reuse, and revoked credentials", async () => {
  const registry = createPrincipalRegistry({ tenant: "tenant_1" });
  const issued = await registry.issue({
    principalId: "agent_test",
    taskId: "task_1",
    grantId: "grant_test",
    grantDigest: "sha256:" + "2".repeat(64),
    allocationId: "grant_test",
    runtimeSessionId: "session_1",
    jobId: "job_test",
    authorityCellId: "cell_1",
    expiresAt: "2026-08-10T00:00:01.000Z",
  });

  assert.deepEqual(await registry.resolve(issued.token, new Date("2026-08-10T00:00:00.000Z")), issued.context);
  await registry.revoke(issued.context.sessionTokenDigest);
  await assert.rejects(() => registry.resolve(issued.token, new Date("2026-08-10T00:00:00.000Z")), /revoked/i);

  const expired = await registry.issue({ ...issued.context, principalId: "agent_expired", expiresAt: "2026-08-09T00:00:00.000Z" });
  await assert.rejects(() => registry.resolve(expired.token, new Date("2026-08-10T00:00:00.000Z")), /expired/i);
  await assert.rejects(() => registry.resolve("rat_not-a-token", new Date("2026-08-10T00:00:00.000Z")), /invalid/i);
});

test("file principal registry survives restart and stores only token digests", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-principal-registry-"));
  const file = path.join(root, "principals.jsonl");
  const first = createFilePrincipalRegistry({ tenant: "tenant_1", file });
  const issued = await first.issue({
    principalId: "agent_release",
    taskId: "task_1",
    grantId: "grant_release",
    grantDigest: "sha256:" + "3".repeat(64),
    allocationId: "grant_release",
    runtimeSessionId: "session_1",
    jobId: "job_release",
    authorityCellId: "cell_1",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  const onDisk = await readFile(file, "utf8");
  assert.doesNotMatch(onDisk, new RegExp(issued.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(onDisk, /sessionTokenDigest/);

  const restarted = createFilePrincipalRegistry({ tenant: "tenant_1", file });
  assert.deepEqual(await restarted.resolve(issued.token, new Date("2026-08-10T00:00:00.000Z")), issued.context);
  await restarted.revokeTask("task_1");
  const afterRevocation = createFilePrincipalRegistry({ tenant: "tenant_1", file });
  await assert.rejects(() => afterRevocation.resolve(issued.token, new Date("2026-08-10T00:00:00.000Z")), /revoked/);
  await assert.rejects(() => afterRevocation.issue({ ...issued.context, principalId: "agent_late", runtimeSessionId: "session_late" }), /task is revoked/);
});

test("file principal registry fails closed on truncated or foreign events", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-principal-corrupt-"));
  const file = path.join(root, "principals.jsonl");
  const registry = createFilePrincipalRegistry({ tenant: "tenant_1", file });
  await import("node:fs/promises").then(({ writeFile }) => writeFile(file, '{"v":"reelier.principal-registry-event/v1"'));
  await assert.rejects(() => registry.resolve("rat_12345678"), /corrupt/);
});
