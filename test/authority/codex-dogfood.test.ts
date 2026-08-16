import test from "node:test";
import assert from "node:assert/strict";
import { assertCodexDogfoodPlan, createCodexDogfoodPlan } from "../../src/authority/host/codex-dogfood.js";

test("Codex dogfood plan gives ten profiles distinct principal sessions and no provider credentials", () => {
  const plan = createCodexDogfoodPlan({ taskId: "task_codex", endpoint: "https://authority.example/v1/mcp" });
  assertCodexDogfoodPlan(plan);
  assert.equal(new Set(plan.profiles.map(profile => profile.principalId)).size, 10);
  assert.equal(plan.hook.bodyIdentityAllowed, false);
  assert.equal(plan.profiles.every(profile => profile.providerCredentials === "absent"), true);
  assert.throws(() => assertCodexDogfoodPlan({ ...plan, profiles: plan.profiles.slice(0, 9) }), /incomplete/);
});
