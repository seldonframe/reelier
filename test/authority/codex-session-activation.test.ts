import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexDogfoodPlan } from "../../src/authority/host/codex-dogfood.js";
import { activateCodexPrincipalSessions } from "../../src/authority/host/codex-session-activation.js";
import { createPrincipalRegistry } from "../../src/authority/host/principal-registry.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

test("Codex activation binds every profile to its live grant and writes no token into its evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-codex-activation-"));
  const credentials = path.join(root, "private-sessions");
  const plan = createCodexDogfoodPlan({ taskId: "task_cert", endpoint: "https://cell.example.test/mcp" });
  const bindings = new Map(plan.profiles.map((profile, index) => [profile.principalId, {
    taskId: plan.taskId,
    grantId: profile.profile === "coordinator" ? "root" : `grant_${profile.profile}`,
    grantDigest: digest(String((index % 9) + 1)),
    grantee: profile.principalId,
    allocationId: profile.profile === "coordinator" ? "root" : `grant_${profile.profile}`,
    expiresAt: "2026-08-10T14:00:00.000Z",
    effects: profile.authorityMode === "preparation-only" ? 0 : 2,
    lifecycleState: "allocated" as const,
  }]));
  const registry = createPrincipalRegistry({ tenant: "tenant_1" });

  const result = await activateCodexPrincipalSessions({
    tenant: "tenant_1",
    plan,
    jobId: "job_founder_release",
    authorityCellId: "cell_1",
    credentialDirectory: credentials,
    principalRegistry: registry,
    resolveBinding: async ({ principalId }) => bindings.get(principalId),
    now: new Date("2026-08-10T12:00:00.000Z"),
  });

  assert.equal(result.sessions.length, 10);
  assert.equal("token" in result, false);
  assert.doesNotMatch(JSON.stringify(result), /rat_/);
  for (const profile of plan.profiles) {
    const session = result.sessions.find(item => item.profile === profile.profile);
    assert.ok(session);
    const token = (await readFile(session.tokenFile, "utf8")).trim();
    assert.match(token, /^rat_/);
    const context = await registry.resolve(token, new Date("2026-08-10T12:30:00.000Z"));
    assert.equal(context.principalId, profile.principalId);
    assert.equal(context.grantDigest, bindings.get(profile.principalId)?.grantDigest);
    assert.equal(context.allocationId, bindings.get(profile.principalId)?.allocationId);
    assert.equal(context.runtimeSessionId, profile.runtimeSessionId);
    if (process.platform !== "win32") assert.equal((await stat(session.tokenFile)).mode & 0o777, 0o600);
  }
});

test("Codex activation rolls back every issued session when one private token path already exists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-codex-activation-rollback-"));
  const credentials = path.join(root, "private-sessions");
  await mkdir(credentials);
  await writeFile(path.join(credentials, "release.token"), "operator-owned-file", { flag: "wx" });
  const plan = createCodexDogfoodPlan({ taskId: "task_cert", endpoint: "https://cell.example.test/mcp" });
  const registry = createPrincipalRegistry({ tenant: "tenant_1" });
  const issued: Array<{ token: string; digest: string }> = [];
  const capturingRegistry = {
    ...registry,
    async issue(input: Parameters<typeof registry.issue>[0]) {
      const credential = await registry.issue(input);
      issued.push({ token: credential.token, digest: credential.context.sessionTokenDigest });
      return credential;
    },
  };

  await assert.rejects(() => activateCodexPrincipalSessions({
    tenant: "tenant_1",
    plan,
    jobId: "job_founder_release",
    authorityCellId: "cell_1",
    credentialDirectory: credentials,
    principalRegistry: capturingRegistry,
    resolveBinding: async ({ principalId }) => {
      const profile = plan.profiles.find(item => item.principalId === principalId)!;
      return {
        taskId: plan.taskId,
        grantId: profile.profile === "coordinator" ? "root" : `grant_${profile.profile}`,
        grantDigest: digest(String((plan.profiles.indexOf(profile) % 9) + 1)),
        grantee: profile.principalId,
        allocationId: profile.profile === "coordinator" ? "root" : `grant_${profile.profile}`,
        expiresAt: "2026-08-10T14:00:00.000Z",
        effects: profile.authorityMode === "preparation-only" ? 0 : 2,
        lifecycleState: "allocated" as const,
      };
    },
    now: new Date("2026-08-10T12:00:00.000Z"),
  }), /already exists/i);

  assert.ok(issued.length > 0);
  for (const item of issued) await assert.rejects(() => registry.resolve(item.token, new Date("2026-08-10T12:30:00.000Z")), /revoked/i);
  assert.equal(await readFile(path.join(credentials, "release.token"), "utf8"), "operator-owned-file");
});

test("Codex activation refuses grant drift and non-zero preparation allocations before issuing credentials", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-codex-activation-refuse-"));
  const plan = createCodexDogfoodPlan({ taskId: "task_cert", endpoint: "https://cell.example.test/mcp" });
  const registry = createPrincipalRegistry({ tenant: "tenant_1" });
  let issues = 0;
  const countingRegistry = { ...registry, async issue(input: Parameters<typeof registry.issue>[0]) { issues += 1; return registry.issue(input); } };

  await assert.rejects(() => activateCodexPrincipalSessions({
    tenant: "tenant_1",
    plan,
    jobId: "job_founder_release",
    authorityCellId: "cell_1",
    credentialDirectory: path.join(root, "private-sessions"),
    principalRegistry: countingRegistry,
    resolveBinding: async ({ principalId }) => {
      const profile = plan.profiles.find(item => item.principalId === principalId)!;
      return {
        taskId: plan.taskId,
        grantId: `grant_${profile.profile}`,
        grantDigest: digest("a"),
        grantee: profile.principalId,
        allocationId: `grant_${profile.profile}`,
        expiresAt: "2026-08-10T14:00:00.000Z",
        effects: profile.authorityMode === "outcome-capable" || profile.profile === "test_agent" ? 1 : 0,
        lifecycleState: "allocated" as const,
      };
    },
    now: new Date("2026-08-10T12:00:00.000Z"),
  }), /preparation-only/i);
  assert.equal(issues, 0);
});
