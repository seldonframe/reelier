import test from "node:test";
import assert from "node:assert/strict";
import { createCodexDogfoodPlan } from "../../src/authority/host/codex-dogfood.js";
import { runCodexCertification, type CodexCertificationEvent } from "../../src/authority/host/codex-certification.js";

const plan = createCodexDogfoodPlan({ taskId: "task_1", endpoint: "https://authority.example.test/mcp" });

function operations(events: readonly CodexCertificationEvent[] = []): Parameters<typeof runCodexCertification>[0]["operations"] {
  return {
    async startProfile(profile) { return { principalId: profile.principalId, runtimeSessionId: profile.runtimeSessionId, providerCredentials: "absent" as const }; },
    async stopProfile() {},
    async readEvents() { return events; },
    async revokeRoot() { return true; },
  };
}

test("Codex certification starts ten distinct profiles and exports the task graph", async () => {
  const result = await runCodexCertification({ plan, operations: operations([{ kind: "outcome", principalId: "codex_release", identitySource: "hook", outcomeKey: "release-1", status: "dispatched", digest: "sha256:" + "a".repeat(64) }]) });
  assert.equal(result.graph.v, "reelier.task-receipt-graph/v1");
  assert.equal(result.graph.principals.length, 10);
  assert.equal(result.graph.outcomes.length, 1);
  assert.equal(result.rootRevoked, true);
});

test("Codex certification rejects model-supplied identity and preserves conflict/partial exceptions", async () => {
  await assert.rejects(() => runCodexCertification({ plan, operations: operations([{ kind: "outcome", principalId: "spoofed", identitySource: "body", outcomeKey: "release-1", status: "dispatched", digest: "sha256:" + "a".repeat(64) }]) }), /model-supplied identity/);
  const result = await runCodexCertification({ plan, operations: operations([
    { kind: "outcome", principalId: "codex_release", identitySource: "hook", outcomeKey: "release-1", status: "dispatched", digest: "sha256:" + "a".repeat(64) },
    { kind: "outcome", principalId: "codex_independent_verifier", identitySource: "hook", outcomeKey: "release-1", status: "duplicate", digest: "sha256:" + "a".repeat(64) },
    { kind: "outcome", principalId: "codex_infrastructure", identitySource: "hook", outcomeKey: "infra-1", status: "conflict", digest: "sha256:" + "b".repeat(64) },
    { kind: "outcome", principalId: "codex_secret_lifecycle", identitySource: "hook", outcomeKey: "secret-1", status: "partial", digest: "sha256:" + "c".repeat(64) },
  ]) });
  assert.equal(result.graph.outcomes.length, 2);
  assert.equal(result.graph.exceptions.length, 2);
});
